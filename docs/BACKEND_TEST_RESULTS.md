# Spring Boot backend verification

Verified on 6 November 2026 using Java 21.0.7, Maven 3.9.11, Spring Boot 3.5.16,
Flyway 11.20.3 and an isolated native PostgreSQL 18.6 cluster. Application tests
used a disposable database, without touching the machine's existing databases.

## Automated verification

The final Maven verification passed with **26 tests, zero failures, zero errors
and zero skipped tests**:

| Suite | Tests | Coverage |
|---|---:|---|
| AI response contract | 6 | real contract shape, warnings, invalid IDs/types/enums/quotes |
| HTTP FastAPI client | 3 | multipart bytes, HTTP/1.1, busy/invalid responses, malformed JSON |
| Upload validation | 4 | unchanged input, filename, encoding, actual byte limit, idempotency key |
| PostgreSQL persistence/API | 8 | Flyway, idempotency/capacity, transactional results, evidence, fencing, history, cancellation, pagination |
| Asynchronous worker | 5 | background HTTP calls, retry success/exhaustion, terminal input failure, heartbeat beyond lease interval |

These PostgreSQL tests use actual SQL transactions, JSONB, row/advisory locks and
constraints. They do not substitute H2. HTTP fixtures are manually authored,
synthetic contract data, not real user uploads or stored model reports.

The publish-path checker also passed **31 tests** covering the excluded runtime,
secret, weight, upload and output paths and permitted source/template paths.

## Live three-service verification

A packaged Spring Boot application, PostgreSQL and the actual Python FastAPI
service ran as separate native processes and communicated over local HTTP/TCP.
This was not a mocked HTTP bridge or a TestClient-only backend test.

The live test passed with real all-mpnet-base-v2 embeddings and Qwen3-0.6B CPU
inference with JSON-schema decoding:

- The upload returned HTTP 202 with QUEUED status.
- Four synthetic log lines produced three templates and one four-row event.
- HDBSCAN noise was retained: all three templates remained available.
- The job reached COMPLETED after one attempt; Python evidence validation passed.
- The result, event details and attempt history were readable from PostgreSQL.
- Replaying the idempotency key returned the same job without another attempt.
- A completed result remained available after restarting Spring Boot.
- A job uploaded while workers were disabled remained QUEUED across a backend
  restart and completed automatically when workers resumed.

Generated report bodies, upload files, database data and process logs were kept
in ignored local working directories and are not part of the source commit.

## Packaging and scope

Docker Compose configuration validation passed, and the referenced base-image
tags were checked. Container builds/runs were not executed because this sandbox
cannot access the Docker Desktop engine. Native service execution and database
integration were verified instead. Compose and CI use PostgreSQL 17; local SQL
and migration tests additionally passed on PostgreSQL 18.6.

The original Python processing modules and notebooks were not modified.
Qwen3-14B remains the Python standalone default and was not rerun for this backend
change; the available GPU has 8 GB memory. The smaller model verifies integration,
not equivalent diagnostic quality. Valid JSON/evidence does not prove causality.

Backend remote invocation is at least once. Lease tokens fence database writes;
the current Python API cannot cancel or deduplicate computation already started.
