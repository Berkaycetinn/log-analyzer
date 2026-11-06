# React TypeScript frontend

The frontend implements the batch-analysis workflow defined in the architecture.
It talks only to Spring Boot. Python parsing, embedding, clustering and LLM logic
remain unchanged. No production feature uses mock data or browser persistence.

## Run locally

Requirements: Node 22.12+ and npm. Start PostgreSQL, FastAPI and Spring Boot as
described in [BACKEND.md](BACKEND.md), then:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/actuator/health` to
`http://127.0.0.1:8080`. To use another backend, set `BACKEND_PROXY_TARGET` in the
shell or copy `frontend/.env.example` to the ignored `frontend/.env`. This value
configures the development server, not a browser API origin. `FRONTEND_PORT`
overrides port 5173. The browser uses same-origin URLs, so CORS changes are not
required. Never place credentials in `VITE_*` values; they are public bundle data.

## Docker Compose

Set `POSTGRES_PASSWORD` in an ignored local root `.env`, then:

```sh
docker compose up --build
```

Open `http://127.0.0.1:5173`. The frontend image builds TypeScript with Node and
serves the resulting SPA with Nginx, forwarding API calls to `backend:8080`.
Deep links fall back to `index.html`; API failures are never replaced by HTML.
Upload requests remain limited by Spring/FastAPI. The browser cap is 10,000,000
bytes; keep server limits aligned or expect the server's rejection. Nginx accepts
12 MB requests to allow multipart overhead. The UI and backend ports bind to
loopback. Existing MVP has no authentication and is intended for a trusted local
environment. Model downloads/cache and analysis outputs remain on runtime volumes.

## Routes and API integration

| Route / feature | Real backend calls |
| --- | --- |
| `/analyses` | `GET /api/v1/analyses?page=&size=&status=`; global counts use size=1 per status |
| New analysis dialog | `POST /api/v1/analyses` multipart `file` with per-selection `Idempotency-Key` |
| `/analyses/:id` | `GET /api/v1/analyses/{id}`, `/{id}/result`, `/{id}/events`, `/{id}/attempts` |
| `/analyses/:id/events/:eventId` | `GET /api/v1/analyses/{id}/events/{eventId}` plus job/result warning state |
| Cancel / retry / delete | `POST /{id}/cancel`, `POST /{id}/retry`, `DELETE /{id}` under `/api/v1/analyses` |
| `/system` / connection badge | `GET /actuator/health` |
| JSON download | Browser Blob of the API result already fetched; no export service or filesystem write on server |

Lists/counts poll every 5 seconds, active metadata/attempts every 2 seconds and
health every 30 seconds while the tab is active. Completed result data is cached
in memory. React Query cancels obsolete requests. Actions invalidate affected
queries. POST/DELETE operations are never automatically retried. An upload retry
uses the same idempotency key until the file selection changes, avoiding duplicate
jobs after a lost response. No file contents, keys or reports enter localStorage.

Zod checks response contracts, including nullable hypotheses, optional fields,
retained noise (`embedding_cluster=-1`) and unknown source extensions. Problem
details are presented as errors. Requests have timeouts; unavailable services,
not-found routes, invalid IDs, empty results, malformed responses and unfinished
jobs have explicit states. Cancellation discards late AI results; it does not
abort a Python inference request. Deletion removes the persisted analysis, input,
events, evidence and attempt history according to the backend contract.

The overview displays parser counts, optional minute activity, package notes and
cross-event evaluation. Event detail exposes severity, confidence reasoning,
quoted evidence, hypotheses, unknowns, checks, recommendations, templates,
varying fields and source context. Extra Hadoop-specific fields remain available
in the JSON view without imposing a new required parsing schema.

## Source layout

- `src/domain.ts`: API schemas/types and display formatting.
- `src/api.ts`: same-origin HTTP adapter, multipart and ProblemDetail handling.
- `src/queries.ts`: asynchronous server state, polling and cache invalidation.
- `src/components/`: shell, upload flow and accessible shared primitives.
- `src/pages/`: analysis list, job detail, event evidence and service health.
- `src/styles.css`: approved visual tokens and responsive component styles.
- `src/test/`: contract, transport, safety and interaction tests; synthetic data only.
- `e2e/`: browser scenarios against a running real backend/AI stack.

## Verification

```sh
cd frontend
npm run typecheck
npm test
npm run build
npx playwright install chromium
# Start the complete stack with an isolated synthetic-only test database first.
npm run test:e2e
```

`FRONTEND_URL` overrides the browser-test base URL. `PLAYWRIGHT_CHANNEL=msedge`
can use installed Edge. `VISUAL_OUTPUT` optionally redirects screenshots. Browser
tests create/delete synthetic analyses through real APIs; run only against a test
database. One test runs genuine inference and needs local models and sufficient
time. Tests do not assert exact sampled LLM wording. CI verifies types, frontend
tests, production build and prohibited publish paths. Full live inference requires
the model-equipped integration environment; it is not simulated in CI.

See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and
[FRONTEND_TEST_RESULTS.md](FRONTEND_TEST_RESULTS.md).
