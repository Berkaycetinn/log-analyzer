# React frontend verification

Verified on 6 November 2026 outside Google Colab with Node 22.20.0,
React 19.3.1, TypeScript 5.9.3, Vite 8.3.6 and Playwright 1.65.0 Chromium.

## Automated checks

- TypeScript strict type checking and the production build passed.
- All 13 Vitest tests passed: shared Spring/FastAPI contract, retained noise,
  null hypotheses, query-state rules, multipart/idempotency behavior, errors,
  malformed responses, health DOWN, deletion, upload validation/retry, dialogs
  and unverified-evidence notices.
- All 39 publish-path tests passed. The full proposed 104-file repository
  manifest passed the guard against secrets, model weights, uploads, reports,
  dependency directories and generated artifacts.
- `npm ci --dry-run` validated the lockfile. The production dependency audit
  reported zero vulnerabilities at verification time.
- Docker Compose configuration validation passed.

## Real stack and browser verification

The final full Playwright run passed all six scenarios with zero failures
against the running four-service stack (about 2.3 minutes).

Native PostgreSQL 18.6, packaged Spring Boot, the actual Python FastAPI service
and Vite ran as separate processes on isolated local ports. Test databases
contained synthetic data only. Browser interaction used the real same-origin
Spring endpoints; no substitute API server or production mock data was added.

Four synthetic Hadoop log lines went through upload, durable queue admission,
real all-mpnet-base-v2 embeddings, HDBSCAN and local Qwen3-0.6B CPU inference.
They produced three retained noise templates and one four-row event. A sampled
model result had quote-validation warnings; the UI prominently displayed the
warning, original report quotes and source template examples. This verified the
warning path without treating model text as validated evidence or proven cause.

A persisted result remained usable after Spring Boot restarted. Browser checks
covered overview statistics, event evidence, templates, retained `-1` labels,
attempt history (including `SUCCEEDED_WITH_WARNINGS`), JSON download, reload,
deletion, real failed-input retry, cancellation, status filters, pagination,
health and invalid routes. A transport-abort test verified that an unreachable
backend is presented as an error rather than an empty success.

Desktop and 390px mobile views were inspected from browser screenshots. Mobile
checks include containing horizontal table scrolling, keyboard focus within the
upload dialog and Escape dismissal. The table's positioned scroll container
also contains its hidden accessibility labels, preventing page-wide overflow.

Generated screenshots, downloaded reports, traces, model files, uploaded input,
process logs and database files remain outside the published source tree.

## Scope and limits

A subsequent complete-stack verification reran component checks and extended the
browser coverage to seven scenarios, compiled production assets, direct SQL
comparisons and rendering after backend restart. That run also identified the
sandbox's browser-download filesystem restriction; the export payload was checked
in memory while the default test retains strict saved-file verification. See
[END_TO_END_VERIFICATION.md](END_TO_END_VERIFICATION.md) for exact results,
reproduction commands and remaining environment limits.

The source change preserves the existing Python algorithms and Java backend.
The smaller Qwen model verifies integration, not diagnostic equivalence to
Qwen3-14B. Model output is sampled, so tests check contracts and displayed data,
not a fixed summary. Cold CPU inference needs several minutes; the live browser
scenario allows up to 15 minutes for the job to reach a terminal state.

The initial frontend verification used native services because this desktop
sandbox cannot access Docker Desktop. The follow-up adds a separate complete
Docker workflow for actual image builds, Nginx, real inference, strict JSON file
download, SQL persistence and backend restart verification. It downloads and uses
the real model rather than simulating inference. The faster frontend CI workflow
continues to run types, unit/interaction tests, bundling, browser-test collection,
verification-script syntax and the publish-path guard. Detailed follow-up results
are recorded in [END_TO_END_VERIFICATION.md](END_TO_END_VERIFICATION.md).

The [final Docker run](https://github.com/Berkaycetinn/log-analyzer/actions/runs/42281175628)
passed actual image builds, all seven strict browser scenarios, saved JSON
download validation, direct SQL checks before/after backend restart, production
rendering through Nginx and disposable-data cleanup. The local sandbox's engine
and download restrictions therefore do not leave those application paths
unverified. The restart verification's transient-connection readiness race was
fixed and validated in that run.
