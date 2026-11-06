package com.loganalyzer.backend;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.*;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import static com.loganalyzer.backend.ApiModels.*;

@Repository
public class JobStore {
    // Coordinates admission and global AI capacity across backend replicas.
    private static final long QUEUE_LOCK = 71720261106L;
    private static final String JOB_COLUMNS = """
        id,filename,content_type,size_bytes,sha256,status,attempt_count,cycle_attempts,
        created_at,updated_at,started_at,finished_at,next_attempt_at,
        error_code,error_message,upstream_status
        """;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final BackendProperties properties;
    public JobStore(JdbcTemplate jdbc, ObjectMapper json, BackendProperties properties) {
        this.jdbc = jdbc; this.json = json; this.properties = properties;
    }
    private Instant instant(ResultSet row, String name) throws SQLException {
        Timestamp value = row.getTimestamp(name);
        return value == null ? null : value.toInstant();
    }
    private Job map(ResultSet row, int n) throws SQLException {
        JobStatus status = JobStatus.valueOf(row.getString("status"));
        return new Job(row.getObject("id", UUID.class), row.getString("filename"),
            row.getString("content_type"), row.getLong("size_bytes"), row.getString("sha256"),
            status, row.getInt("attempt_count"), row.getInt("cycle_attempts"),
            instant(row,"created_at"), instant(row,"updated_at"), instant(row,"started_at"),
            instant(row,"finished_at"), status == JobStatus.QUEUED ? instant(row,"next_attempt_at") : null,
            row.getString("error_code"), row.getString("error_message"),
            row.getObject("upstream_status", Integer.class));
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Job get(UUID id) {
        return jdbc.query("SELECT "+JOB_COLUMNS+" FROM analysis_jobs WHERE id=?", this::map, id)
            .stream().findFirst().orElseThrow(() -> new ApiFailure(404,"ANALYSIS_NOT_FOUND","Analysis not found"));
    }
    @Transactional
    public Job create(String filename, String contentType, byte[] data, String hash, String key) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(?) IS NULL", Boolean.class, QUEUE_LOCK);
        if (key != null) {
            List<Job> existing = jdbc.query("SELECT "+JOB_COLUMNS+" FROM analysis_jobs WHERE idempotency_key=?", this::map, key);
            if (!existing.isEmpty()) {
                Job job = existing.getFirst();
                if (!job.sha256().equals(hash) || !job.filename().equals(filename)
                        || !job.contentType().equals(contentType)) {
                    throw new ApiFailure(409,"IDEMPOTENCY_CONFLICT","Idempotency key was used for a different upload");
                }
                return job;
            }
        }
        Long pending = jdbc.queryForObject(
            "SELECT count(*) FROM analysis_jobs WHERE status IN ('QUEUED','PROCESSING')", Long.class);
        if (pending >= properties.maxPendingJobs()) {
            throw new ApiFailure(429,"QUEUE_FULL","Analysis queue is full; retry later");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO analysis_jobs(id,filename,content_type,input_data,size_bytes,sha256,idempotency_key,status)
            VALUES(?,?,?,?,?,?,?,'QUEUED')
            """, id, filename, contentType, data, data.length, hash, key);
        return get(id);
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Page<Job> list(JobStatus status, int page, int size) {
        String where = status == null ? "" : " WHERE status=?";
        List<Object> args = new ArrayList<>();
        if (status != null) args.add(status.name());
        long count = jdbc.queryForObject("SELECT count(*) FROM analysis_jobs" + where,
            Long.class, args.toArray());
        args.add(size); args.add((long) page * size);
        List<Job> jobs = jdbc.query("SELECT "+JOB_COLUMNS+" FROM analysis_jobs" + where
            + " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?", this::map, args.toArray());
        return new Page<>(jobs, page, size, count);
    }
    @Transactional
    public Optional<ClaimedJob> claim() {
        Boolean locked = jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(?)", Boolean.class, QUEUE_LOCK);
        if (!Boolean.TRUE.equals(locked)) return Optional.empty();
        long active = jdbc.queryForObject("""
            SELECT count(*) FROM analysis_jobs WHERE status='PROCESSING'
                AND lease_expires_at > clock_timestamp()
            """, Long.class);
        if (active >= properties.parallelism()) return Optional.empty();
        List<Job> candidates = jdbc.query("""
            SELECT %s FROM analysis_jobs
            WHERE (status='QUEUED' AND next_attempt_at<=clock_timestamp())
               OR (status='PROCESSING' AND lease_expires_at<=clock_timestamp())
            ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
            """.formatted(JOB_COLUMNS), this::map);
        if (candidates.isEmpty()) return Optional.empty();
        Job job = candidates.getFirst();
        if (job.status() == JobStatus.PROCESSING) {
            jdbc.update("""
                UPDATE analysis_attempts SET finished_at=clock_timestamp(),outcome='LEASE_EXPIRED',
                    error_code='WORKER_LOST',error_message='Worker lease expired'
                WHERE job_id=? AND finished_at IS NULL
                """, job.id());
        }
        if (job.cycleAttempts() >= properties.maxAttempts()) {
            jdbc.update("""
                UPDATE analysis_jobs SET status='FAILED',finished_at=clock_timestamp(),
                  updated_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,
                  error_code='ATTEMPTS_EXHAUSTED',error_message='Worker attempts exhausted'
                WHERE id=?
                """, job.id());
            return Optional.empty();
        }
        UUID token = UUID.randomUUID();
        jdbc.update("""
            UPDATE analysis_jobs SET status='PROCESSING',attempt_count=attempt_count+1,
                cycle_attempts=cycle_attempts+1,started_at=coalesce(started_at,clock_timestamp()),
                updated_at=clock_timestamp(),lease_token=?,
                lease_expires_at=clock_timestamp()+(? * interval '1 millisecond'),
                error_code=NULL,error_message=NULL,upstream_status=NULL
            WHERE id=?
            """, token, properties.leaseDuration().toMillis(), job.id());
        jdbc.update("INSERT INTO analysis_attempts(job_id,attempt_no,lease_token) VALUES(?,?,?)",
            job.id(), job.attemptCount()+1, token);
        byte[] input = jdbc.queryForObject("SELECT input_data FROM analysis_jobs WHERE id=?", byte[].class, job.id());
        return Optional.of(new ClaimedJob(job.id(), job.filename(), input, token,
            job.attemptCount()+1, job.cycleAttempts()+1));
    }
    public boolean heartbeat(UUID id, UUID token) {
        return jdbc.update("""
            UPDATE analysis_jobs SET lease_expires_at=clock_timestamp()+(? * interval '1 millisecond'),
                updated_at=clock_timestamp()
            WHERE id=? AND status='PROCESSING' AND lease_token=?
                AND lease_expires_at>clock_timestamp()
            """, properties.leaseDuration().toMillis(), id, token) == 1;
    }
    @Transactional
    public boolean complete(ClaimedJob job, JsonNode result) {
        boolean valid = result.path("validation").path("valid").booleanValue();
        String status = valid ? "COMPLETED" : "COMPLETED_WITH_WARNINGS";
        int changed = jdbc.update("""
            UPDATE analysis_jobs SET status=?,result=CAST(? AS jsonb),finished_at=clock_timestamp(),
                updated_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,
                error_code=NULL,error_message=NULL,upstream_status=NULL
            WHERE id=? AND status='PROCESSING' AND lease_token=? AND lease_expires_at>clock_timestamp()
            """, status, result.toString(), job.id(), job.leaseToken());
        if (changed == 0) return false;
        Map<Integer,JsonNode> analyses = new HashMap<>();
        result.path("report").path("events").forEach(e -> analyses.put(e.path("event_id").intValue(),e));
        for (JsonNode event : result.path("package").path("events")) {
            int id = event.path("event_id").intValue();
            JsonNode analysis = analyses.get(id);
            jdbc.update("""
                INSERT INTO analysis_events(job_id,event_id,start_time,end_time,row_count,severity,confidence,source,analysis)
                VALUES(?,?,?,?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb))
                """, job.id(), id, event.path("start").textValue(), event.path("end").textValue(),
                event.path("n_rows").intValue(), analysis.path("severity").textValue(),
                analysis.path("confidence").textValue(), event.toString(), analysis.toString());
            int ordinal = 0;
            for (JsonNode evidence : analysis.path("evidence")) {
                jdbc.update("""
                    INSERT INTO analysis_evidence(job_id,event_id,ordinal,log_time,quote) VALUES(?,?,?,?,?)
                    """, job.id(), id, ordinal++, evidence.path("time").textValue(),
                    evidence.path("quote").textValue());
            }
        }
        finishAttempt(job, valid ? "SUCCEEDED" : "SUCCEEDED_WITH_WARNINGS", null, null, 200);
        return true;
    }
    @Transactional
    public boolean fail(ClaimedJob job, AiFailure failure) {
        boolean retry = failure.retryable() && job.cycleAttempts() < properties.maxAttempts();
        long delay = Math.min(300000L, Math.min(300000L,properties.retryDelay().toMillis())
            * (1L << Math.min(job.cycleAttempts()-1, 12)));
        int changed = jdbc.update("""
            UPDATE analysis_jobs SET status=?,error_code=?,error_message=?,upstream_status=?,
                updated_at=clock_timestamp(),finished_at=CASE WHEN ? THEN NULL ELSE clock_timestamp() END,
                next_attempt_at=clock_timestamp()+(? * interval '1 millisecond'),
                lease_token=NULL,lease_expires_at=NULL
            WHERE id=? AND status='PROCESSING' AND lease_token=? AND lease_expires_at>clock_timestamp()
            """, retry ? "QUEUED" : "FAILED", failure.code(), failure.getMessage(),
                failure.upstreamStatus(), retry, delay, job.id(), job.leaseToken());
        if (changed == 0) return false;
        finishAttempt(job, retry ? "RETRY_SCHEDULED" : "FAILED", failure.code(),
            failure.getMessage(), failure.upstreamStatus());
        return true;
    }
    private void finishAttempt(ClaimedJob job, String outcome, String code, String message, Integer status) {
        jdbc.update("""
            UPDATE analysis_attempts SET finished_at=clock_timestamp(),outcome=?,error_code=?,
                error_message=?,upstream_status=? WHERE job_id=? AND lease_token=? AND finished_at IS NULL
            """, outcome, code, message, status, job.id(), job.leaseToken());
    }
    @Transactional
    public Job retry(UUID id) {
        Job job = lock(id);
        if (job.status() != JobStatus.FAILED && job.status() != JobStatus.CANCELLED) {
            throw new ApiFailure(409,"INVALID_STATE","Only failed or cancelled analyses can be retried");
        }
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(?) IS NULL", Boolean.class, QUEUE_LOCK);
        long pending = jdbc.queryForObject(
            "SELECT count(*) FROM analysis_jobs WHERE status IN ('QUEUED','PROCESSING')", Long.class);
        if (pending >= properties.maxPendingJobs()) throw new ApiFailure(429,"QUEUE_FULL","Analysis queue is full");
        jdbc.update("""
            UPDATE analysis_jobs SET status='QUEUED',cycle_attempts=0,started_at=NULL,finished_at=NULL,
                updated_at=clock_timestamp(),next_attempt_at=clock_timestamp(),
                error_code=NULL,error_message=NULL,upstream_status=NULL WHERE id=?
            """, id);
        return get(id);
    }
    @Transactional
    public Job cancel(UUID id) {
        Job job = lock(id);
        if (job.status() != JobStatus.QUEUED && job.status() != JobStatus.PROCESSING) {
            throw new ApiFailure(409,"INVALID_STATE","Only queued or processing analyses can be cancelled");
        }
        jdbc.update("""
            UPDATE analysis_jobs SET status='CANCELLED',updated_at=clock_timestamp(),finished_at=clock_timestamp(),
                lease_token=NULL,lease_expires_at=NULL WHERE id=?
            """, id);
        jdbc.update("""
            UPDATE analysis_attempts SET finished_at=clock_timestamp(),outcome='CANCELLED'
            WHERE job_id=? AND finished_at IS NULL
            """, id);
        return get(id);
    }
    @Transactional
    public void delete(UUID id) {
        Job job = lock(id);
        if (!job.status().terminal()) throw new ApiFailure(409,"INVALID_STATE","Cancel an active analysis before deleting");
        jdbc.update("DELETE FROM analysis_jobs WHERE id=?",id);
    }
    private Job lock(UUID id) {
        return jdbc.query("SELECT "+JOB_COLUMNS+" FROM analysis_jobs WHERE id=? FOR UPDATE",this::map,id)
            .stream().findFirst().orElseThrow(() -> new ApiFailure(404,"ANALYSIS_NOT_FOUND","Analysis not found"));
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public JsonNode result(UUID id) {
        Job job = get(id);
        if (!job.status().hasResult()) throw new ApiFailure(409,"RESULT_NOT_READY","Analysis has no completed result");
        return parse(jdbc.queryForObject("SELECT result::text FROM analysis_jobs WHERE id=?",String.class,id));
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Page<Event> events(UUID id, int page, int size) {
        requireResult(id);
        long count = jdbc.queryForObject("SELECT count(*) FROM analysis_events WHERE job_id=?",Long.class,id);
        return new Page<>(jdbc.query("""
            SELECT * FROM analysis_events WHERE job_id=? ORDER BY event_id LIMIT ? OFFSET ?
            """,this::event,id,size,(long)page*size),page,size,count);
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Event event(UUID id, int eventId) {
        requireResult(id);
        return jdbc.query("SELECT * FROM analysis_events WHERE job_id=? AND event_id=?",
            this::event,id,eventId).stream().findFirst()
            .orElseThrow(() -> new ApiFailure(404,"EVENT_NOT_FOUND","Analysis event not found"));
    }
    private Event event(ResultSet row, int index) throws SQLException {
        return new Event(row.getInt("event_id"),row.getString("start_time"),row.getString("end_time"),
            row.getInt("row_count"),row.getString("severity"),row.getString("confidence"),
            parse(row.getString("source")),parse(row.getString("analysis")));
    }
    private void requireResult(UUID id) {
        if (!get(id).status().hasResult()) throw new ApiFailure(409,"RESULT_NOT_READY","Analysis has no completed result");
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public List<Attempt> attempts(UUID id) {
        get(id);
        return jdbc.query("""
            SELECT * FROM analysis_attempts WHERE job_id=? ORDER BY attempt_no
            """,(row,n) -> new Attempt(row.getInt("attempt_no"),instant(row,"started_at"),
                instant(row,"finished_at"),row.getString("outcome"),row.getString("error_code"),
                row.getString("error_message"),row.getObject("upstream_status",Integer.class)),id);
    }
    private JsonNode parse(String value) {
        try { return json.readTree(value); }
        catch (JsonProcessingException error) { throw new IllegalStateException("Invalid persisted JSON",error); }
    }
}

