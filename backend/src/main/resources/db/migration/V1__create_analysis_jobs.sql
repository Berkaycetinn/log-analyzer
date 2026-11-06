CREATE TABLE analysis_jobs (
    id uuid PRIMARY KEY,
    filename varchar(255) NOT NULL,
    content_type varchar(128) NOT NULL,
    input_data bytea NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    sha256 char(64) NOT NULL,
    idempotency_key varchar(128) UNIQUE,
    status varchar(32) NOT NULL CHECK (status IN
        ('QUEUED','PROCESSING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED','CANCELLED')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    cycle_attempts integer NOT NULL DEFAULT 0 CHECK (cycle_attempts >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    started_at timestamptz,
    finished_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_token uuid,
    lease_expires_at timestamptz,
    error_code varchar(64),
    error_message text,
    upstream_status integer,
    result jsonb,
    CHECK ((status = 'PROCESSING') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
    CHECK ((status IN ('COMPLETED','COMPLETED_WITH_WARNINGS')) = (result IS NOT NULL))
);
CREATE INDEX analysis_jobs_queue_idx ON analysis_jobs (next_attempt_at, created_at)
    WHERE status = 'QUEUED';
CREATE INDEX analysis_jobs_lease_idx ON analysis_jobs (lease_expires_at)
    WHERE status = 'PROCESSING';
CREATE INDEX analysis_jobs_created_idx ON analysis_jobs (created_at DESC, id DESC);
CREATE TABLE analysis_attempts (
    job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    attempt_no integer NOT NULL,
    lease_token uuid NOT NULL UNIQUE,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    outcome varchar(32),
    error_code varchar(64),
    error_message text,
    upstream_status integer,
    PRIMARY KEY(job_id, attempt_no)
);
CREATE TABLE analysis_events (
    job_id uuid NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    event_id integer NOT NULL CHECK(event_id >= 0),
    start_time text NOT NULL,
    end_time text NOT NULL,
    row_count integer NOT NULL CHECK(row_count >= 0),
    severity varchar(8) NOT NULL CHECK(severity IN ('none','low','medium','high')),
    confidence varchar(8) NOT NULL CHECK(confidence IN ('low','medium','high')),
    source jsonb NOT NULL,
    analysis jsonb NOT NULL,
    PRIMARY KEY(job_id,event_id)
);
CREATE TABLE analysis_evidence (
    job_id uuid NOT NULL,
    event_id integer NOT NULL,
    ordinal integer NOT NULL,
    log_time text NOT NULL,
    quote text NOT NULL CHECK(length(quote) BETWEEN 1 AND 200),
    PRIMARY KEY(job_id,event_id,ordinal),
    FOREIGN KEY(job_id,event_id) REFERENCES analysis_events(job_id,event_id) ON DELETE CASCADE
);

