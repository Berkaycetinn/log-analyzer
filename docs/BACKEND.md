# Spring Boot application backend

The Java backend owns uploads, durable jobs, polling, history and database
persistence. Python FastAPI owns parsing, embeddings, HDBSCAN, time windows and
LLM inference. The existing Python processing code and research notebooks are
unchanged by this backend implementation.

Java 21, Spring Boot 3.5.16, Spring JDBC and PostgreSQL are used. Flyway 11.20.3 applies
the versioned schema at startup and validates existing migration checksums.
There is no H2 substitute, in-memory job queue or requirement for RabbitMQ.

## Architecture

~~~mermaid
flowchart LR
    UI[Client] -->|multipart upload / poll| API[Spring Boot API]
    API -->|atomic upload + job| PG[(PostgreSQL)]
    PG -->|durable claims / leases| W[Bounded background worker]
    W -->|multipart POST /analyze| AI[Python FastAPI]
    AI -->|full event package / report / validation| W
    W -->|atomic result / events / evidence / attempts| PG
    API -->|persisted result| UI
~~~

Uploaded bytes, metadata and QUEUED job are committed in one database transaction
before HTTP 202 is returned. A scheduled dispatcher claims committed jobs with
row locks and SKIP LOCKED. A short PostgreSQL advisory transaction lock coordinates
admission and the configured global number of leased jobs across replicas.
No transaction remains open while Python processes a file.

Workers renew leases while waiting for Python. Expired jobs are reclaimed after
a crash. Every claim gets a new token; completion and failure updates require
the current unexpired token. A stale or cancelled worker cannot overwrite a
newer result. Completion, normalized events, evidence and attempt history commit
together. Retries of transient network/429/5xx failures use bounded exponential
backoff. HTTP 413/422 and invalid response contracts are terminal failures.

Remote execution is **at least once**. A timeout or lease recovery may cause
Python to process an upload again: the existing FastAPI API has no idempotency
or cancellation protocol. Database ownership tokens prevent duplicate/stale
commits, not duplicate remote computation. Keep parallelism=1 for the existing
single-inference FastAPI process. All replicas must use the same setting.

## Run

With Docker Compose:

~~~bash
cp .env.example .env
# Set a local POSTGRES_PASSWORD in .env.
docker compose up --build
curl http://localhost:8080/actuator/health
curl -F "file=@sample.log" -H "Idempotency-Key: example-upload-1" \
  http://localhost:8080/api/v1/analyses
~~~

Compose exposes only the Java API on loopback. PostgreSQL data, AI model cache
and Python reports use named volumes. Real .env files, uploads, reports, weights
and build output are excluded from Git and from the Docker build context.
The Compose example uses Qwen3-0.6B CPU with constrained JSON decoding; it does
not claim equivalent diagnostic quality to the original 14B model.
The first flagged request may download model weights.

Without Docker, start PostgreSQL and the existing Python service, then:

~~~bash
export DB_URL=jdbc:postgresql://localhost:5432/log_analyzer
export DB_USERNAME=log_analyzer
export DB_PASSWORD='<your local password>'
export AI_SERVICE_URL=http://localhost:8000
mvn -f backend/pom.xml verify
mvn -f backend/pom.xml spring-boot:run
~~~

Use the equivalent environment assignments in PowerShell on Windows.
The database must already exist; Flyway creates application tables, not roles
or databases. The application role needs table/migration permissions.

## API

| Method and route | Behavior |
|---|---|
| POST /api/v1/analyses | multipart field file; 202 + Location and job metadata |
| GET /api/v1/analyses | page, size (1–100), optional status filter |
| GET /api/v1/analyses/{id} | persisted status, timestamps, attempts and failure information |
| GET /api/v1/analyses/{id}/result | complete unchanged FastAPI response snapshot |
| GET /api/v1/analyses/{id}/events | paginated normalized events plus original source/analysis |
| GET /api/v1/analyses/{id}/events/{eventId} | one event and its evidence in analysis |
| GET /api/v1/analyses/{id}/attempts | durable attempt outcomes |
| POST /api/v1/analyses/{id}/retry | requeue failed/cancelled job; retain lifetime history |
| POST /api/v1/analyses/{id}/cancel | cancel queued/processing job; discard late completion |
| DELETE /api/v1/analyses/{id} | delete a terminal job and cascade its stored data |
| GET /actuator/health | backend/database health; no inference/model download |

Idempotency-Key is optional, 1–128 ASCII letters/digits or . _ : -. Reusing a
key with the same bytes, filename and content type returns the existing job.
Reusing it for different input returns 409. Replays do not consume queue capacity.

Status transitions:

~~~text
QUEUED -> PROCESSING -> COMPLETED
                    -> COMPLETED_WITH_WARNINGS
                    -> QUEUED (retryable failure, attempts remain)
                    -> FAILED
QUEUED / PROCESSING -> CANCELLED
FAILED / CANCELLED -> QUEUED (explicit retry)
~~~

COMPLETED_WITH_WARNINGS retains Python's validation.valid=false, errors and
original report. It is never presented as verified evidence. Result/event
endpoints return 409 until a completed result exists. Cancellation does not
interrupt an already running Python request; its response is fenced out.
Deletion is allowed only for terminal jobs.

Input is bounded to 10 MB by default, must be nonempty UTF-8, and is forwarded
byte-for-byte. Basenames are stored without client paths. Java does not parse
log messages or alter clustering. Unsupported log formats become asynchronous
AI failures. Error responses use ProblemDetail with a stable code property:
400 invalid input, 404 missing job/event, 409 state/idempotency conflicts,
413 oversized input, 429 full durable queue, 500 unexpected backend failure.
An AI failure is persisted on the job; it is not a synchronous upload failure.

Status and list queries fetch metadata only, without loading uploaded bytes or
large result documents. Multi-query reads use a consistent database snapshot.

## Configuration

| Environment variable | Default |
|---|---|
| DB_URL / DB_USERNAME / DB_PASSWORD | localhost:5432/log_analyzer / log_analyzer / empty |
| AI_SERVICE_URL | http://localhost:8000 |
| MAX_UPLOAD_BYTES | 10000000; cannot exceed Python's default limit |
| MAX_PENDING_JOBS | 100 |
| JOB_PARALLELISM | 1; same value on all backend replicas |
| JOB_MAX_ATTEMPTS | 3 per retry cycle |
| JOB_POLL_DELAY | 1s |
| JOB_HEARTBEAT_DELAY / JOB_LEASE_DURATION | 15s / 90s |
| JOB_RETRY_DELAY | 30s, exponential, capped at 5 minutes |
| AI_CONNECT_TIMEOUT / AI_READ_TIMEOUT | 5s / 30m |
| JOB_WORKER_ENABLED | true |
| SERVER_PORT | 8080 |

Graceful shutdown waits up to 30 seconds. Work remaining after shutdown is
recovered through expired leases. Database timestamps use timestamptz; log
event timestamps remain the original strings because the log has no declared
timezone. Completed input/history is retained until explicitly deleted.

The original MVP excludes authentication, multi-user access and automatic fixes.
This backend implements that scope. No model recommendation is executed as code.

## Verification

~~~bash
mvn -f backend/pom.xml test

# A disposable PostgreSQL database whose name ends in _test is mandatory.
export BACKEND_TEST_DB_URL=jdbc:postgresql://localhost:5432/backend_test
export BACKEND_TEST_DB_USERNAME=backend_test
export BACKEND_TEST_DB_PASSWORD='<test-only password>'
mvn -f backend/pom.xml -Ppostgres-it verify
~~~

The PostgreSQL profile fails if no explicit disposable database is supplied.
Tests clear application rows in that database, so never point it at production.
HTTP client tests use a synthetic contract fixture, not stored user logs or real
analysis outputs. PostgreSQL integration checks cover migrations, transactional
results, normalized evidence, concurrent claims, stale-worker fencing, retry
history, cancellation, pagination and asynchronous HTTP processing.
CI runs the same profile against a PostgreSQL service.

With real services running, exercise the entire HTTP path with synthetic data:

~~~bash
python scripts/smoke_backend.py --backend-url http://localhost:8080
~~~

This invokes real AI inference. Use --normal-only for a fast no-inference wiring
check. No file is written unless --output is explicitly supplied; save any such
output under an ignored directory. Local verification and remaining limitations
are recorded in [BACKEND_TEST_RESULTS.md](BACKEND_TEST_RESULTS.md).

Before publishing, run python scripts/check_publish_paths.py. CI rejects tracked
.env files, model weights, logs, uploaded data, generated reports, virtual
environments and build/cache directories. The .env.example contains placeholders
only. No real credentials or analysis artifacts belong in Git.

