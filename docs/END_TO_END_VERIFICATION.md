# Complete end-to-end verification

The verification uses real Spring Boot, PostgreSQL, Python FastAPI, embeddings,
HDBSCAN and Qwen inference. The browser can exercise either the Vite development
server or the compiled production bundle served by Vite preview. No production
mock API or synthetic success fallback is used.

## Reproduce against an isolated test stack

Use a dedicated PostgreSQL database ending in `_test`. Configure Spring Boot to
use it and start the actual AI service as described in [BACKEND.md](BACKEND.md).
Use the CPU Qwen3-0.6B configuration when reproducing the integration check on a
machine without enough memory for Qwen3-14B. This verifies integration and does
not assert equivalent diagnostic quality. Models must be available locally or
downloadable. The API health endpoint alone does not prove model readiness.

Run the component checks from the repository root:

```sh
python -m pytest tests -q
mvn -f backend/pom.xml -Ppostgres-it verify
cd frontend
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run preview -- --port 5173 --strictPort
```

The Maven integration profile requires `BACKEND_TEST_DB_URL`,
`BACKEND_TEST_DB_USERNAME` and optionally `BACKEND_TEST_DB_PASSWORD` for its own
isolated test database. `BACKEND_PROXY_TARGET` configures the preview proxy when
Spring is not running on port 8080. Keep the preview process running and use a
second terminal for browser verification. In PowerShell, from the repository root:

```powershell
New-Item -ItemType Directory -Force work | Out-Null
$env:FRONTEND_URL = 'http://127.0.0.1:5173'
$env:E2E_KEEP_JOB = '1'
$env:E2E_RECEIPT = Join-Path (Get-Location) 'work/e2e-receipt.json'
Push-Location frontend
npm run test:e2e
Pop-Location
```

The seven scenarios verify upload, idempotent replay, parser/cluster statistics,
event data, evidence rendering, source templates, JSON download contents,
attempt history, retry, cancellation, deletion, normal-only input, health,
invalid routes, filtered pagination, mobile overflow, dialog keyboard handling
and transport failure. A normal-only upload skips LLM inference and correctly
renders an empty event report. The network-failure scenario intentionally aborts
browser transport; all processing scenarios use the actual application APIs.

`E2E_KEEP_JOB=1` retains only the first completed synthetic job so restart
verification can inspect it. Without that option, the browser suite deletes it.
The receipt records IDs, hashes, counts and validation status, not report text.
Other scenarios remove their own synthetic jobs. Run only against a synthetic-only
test database; the tests intentionally create, cancel, retry and delete jobs.

In a desktop sandbox that denies browser filesystem downloads, set
`E2E_IN_MEMORY_DOWNLOAD=1` to compare the exact export Blob contents in the browser
instead of reading a saved file. This mode is annotated in the browser test
report. The default remains a strict completed-download/content check. The
in-memory mode verifies the application payload, not OS file-saving permission.

## Inspect PostgreSQL and restart Spring Boot

Use PostgreSQL's `psql` client, supplying the actual test port/user:

```sh
python scripts/verify_persistence.py --receipt work/e2e-receipt.json --database verification_test --pg-user backend_test --pg-port 5432
```

`--backend-url` overrides the API origin; `--psql` overrides the client executable
path. `PGPASSWORD` or a local PostgreSQL password file may provide authentication.
Keep credentials out of tracked files. The script refuses a database name that
does not end in `_test` and checks the synthetic upload's filename.

It checks the input byte hash, canonical result hash, full stored JSONB result,
normalized events, evidence order/content, completed attempt, and Flyway success
directly against PostgreSQL and the API. It does not change database contents.

Restart Spring Boot using the same test database. Run the same persistence check
again, then verify rendering from the retained record:

```sh
node frontend/scripts/verify-restart.mjs
```

The browser script uses `FRONTEND_URL` and `E2E_RECEIPT`, checks the persisted event
and evidence, catches browser runtime errors, and confirms `/assets/` production
scripts are loaded instead of the development entry point. Finally, delete the
retained synthetic job through `DELETE /api/v1/analyses/{job_id}`. Check that its
events, evidence and attempts cascade and that the isolated database has no test
jobs left. Screenshots, receipts, traces, logs, model caches and reports are
runtime artifacts and must remain outside tracked source paths.

## Production Docker verification

The `Complete Docker pipeline verification` GitHub Actions workflow builds the
actual frontend/Nginx, Spring Boot and FastAPI images and starts PostgreSQL using
`compose.yml` plus `compose.e2e.yml`. The overlay selects a synthetic-only
`log_analyzer_e2e_test` database and exposes its client port on loopback 55432 for
direct SQL inspection. The CI project, volumes and randomly generated password
are disposable. Ports 5173, 8080 and 55432 must be free when reproducing locally.

```sh
docker compose -p pipeline-verification -f compose.yml -f compose.e2e.yml up -d --build --wait --wait-timeout 300
```

Provide `POSTGRES_PASSWORD` through an ignored local `.env` or shell environment.
Run the browser and persistence commands above with database
`log_analyzer_e2e_test`, PostgreSQL user `log_analyzer` and port 55432. On an
unrestricted machine, leave `E2E_IN_MEMORY_DOWNLOAD` unset so the browser must save
the JSON file and the test must read and compare its contents. The workflow
performs that strict check, restarts the real backend container, repeats SQL
verification, checks production rendering and removes the synthetic job.

After restarting a container, its process can be running before HTTP is ready.
The verification readiness request uses bounded retries for connection resets,
refused connections and non-success health responses. It does not treat container
startup alone as proof that Spring Boot or the database is ready.

## Verified environment and limits

Native verification uses PostgreSQL 18.6, Java 21, the packaged Spring Boot JAR,
Python FastAPI, all-mpnet-base-v2, Qwen3-0.6B CPU, and Chromium. The original parser,
clustering and LLM implementation modules are unchanged. Python tests additionally
compare parsing with the original notebook and verify that HDBSCAN separates two
dense groups, alongside the live small-input noise case.

Docker Compose configuration can be checked with `docker compose config --quiet`.
Container execution remains a separate requirement: this environment denies
access to both Docker Desktop engine pipes. Native production-bundle verification
does not claim to validate the Nginx container or container image builds.

## Results from the follow-up run

- 57 Python checks passed: 18 service/algorithm/contract checks and 39 publish-path
  cases. The notebook parser comparison and the new two-dense-group HDBSCAN case passed.
- 26 Java checks passed, including real PostgreSQL migration, persistence,
  asynchronous worker, retry, fencing and HTTP-client integration.
- 13 frontend tests, strict type checking, production build and browser-test
  collection passed.
- A real browser upload completed real parsing, embeddings, HDBSCAN and Qwen
  inference: four matched lines, three templates, three retained noise templates,
  one event and three evidence entries. Quote validation passed for this sampled
  response. Idempotency replay returned the same job and no second attempt.
- The initial strict export check exposed sandbox download cancellation. Isolated
  HTTP attachment, Blob URL and data URL probes all failed to save a file, showing
  that the restriction also affects downloads outside the application.
- Browser verification resumed against the real persisted report using the
  explicitly annotated in-memory export check. All seven scenarios passed.
- Direct SQL/API comparisons passed before and after restarting Spring Boot.
  Input bytes, full report JSONB, normalized events/evidence, completed attempt and
  Flyway state matched. The report hash remained unchanged across the restart.
- A separate Chromium check loaded the production `/assets/` bundle after the
  restart and rendered the stored event/evidence without a browser runtime error.
- Synthetic jobs were deleted through the API; the test database had zero jobs
  after cleanup. Original processing algorithms and production application code
  were preserved; this follow-up adds verification coverage and repeatable tools.

Those local sandbox limits were subsequently covered on an unrestricted Linux
runner with the actual Docker production stack, as recorded below.

## Final production Docker result

The [complete Docker workflow](https://github.com/Berkaycetinn/log-analyzer/actions/runs/42281175628)
passed on source commit `f3548353c162ced95938327b0e8a262532632ea2`.

- The actual Nginx/frontend, Spring Boot and FastAPI images built and started with
  PostgreSQL 17.11. Model inference used real all-mpnet-base-v2 and Qwen3-0.6B CPU.
- All seven browser scenarios passed in about two minutes, including a fresh
  upload, real inference and reading the completed JSON download from disk. The
  sandbox in-memory export option was not enabled.
- Direct PostgreSQL comparisons passed before and after restarting the backend:
  unchanged input/report hashes, one event, three evidence rows, one successful
  attempt and a successful Flyway migration. Quote validation passed.
- A fresh Chromium context rendered the stored report and evidence from the
  production bundle through Nginx after the container restarted.
- The test deleted the retained job, checked that zero jobs remained, and removed
  the disposable containers, database, reports and model-cache volumes.

The first container run uncovered a readiness-check race: `curl --retry-connrefused`
did not retry a connection reset immediately after restart. The verification now
uses bounded `--retry-all-errors` polling. The successful rerun observed two such
resets, waited until health returned `UP`, and completed persistence/rendering
checks. No parsing, clustering or LLM algorithm changes were necessary.
