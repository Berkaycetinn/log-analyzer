# FastAPI AI processing service

The service extracts the existing Hadoop parser, Drain3 masks, template statistics,
normalized all-mpnet-base-v2 embeddings, sklearn HDBSCAN (2/1/euclidean), 30-second
gap event grouping, masked parameter statistics and context from 04_kumeleme.ipynb.
Notebook files remain the research reference. No Colab imports or notebook execution
are needed.

## Run

Python 3.11+:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m uvicorn api:app --host 127.0.0.1 --port 8000
curl -F "file=@Hadoop_2k.log" http://127.0.0.1:8000/analyze
python -m pytest -q
python -m scripts.smoke
```

GET /health reports liveness and model loading state; POST /analyze accepts one UTF-8
multipart file. /docs provides OpenAPI. Response includes run_id, parser/cluster
statistics, enriched event package, report and validation. Runs are persisted under
runs/<run_id>. Validation failures in exact evidence matching remain visible in the
response; they are not claimed to be verified reports.
Parsed model output is retained as model_response.json before schema validation;
schema/inference failures additionally produce error.json and do not produce a
successful final report.

Optional JSON-schema decoding is enabled with LOG_AI_ENFORCE_JSON=true and
LOG_AI_THINKING=false. It filters allowed next tokens using
[LM Format Enforcer](https://github.com/noamgat/lm-format-enforcer), without
rewriting returned content. Event-ID and evidence validation still runs after
generation. The original thinking/generation mode remains the default.

Models load lazily on the first flagged input, inside a serialized worker-thread
pipeline. Concurrent work returns 503 with Retry-After; no unbounded job queue.
Malformed/empty input and malformed model JSON/schema return 422, size/token budget
limits 413, unexpected model/runtime failures 500. The service is a local batch
processor; use one Uvicorn worker to avoid duplicated model memory.

Configuration uses LOG_AI_ environment variables: EMBEDDING_MODEL, LLM_MODEL,
DEVICE (default cpu), LLM_DTYPE (auto/float32/float16/bfloat16), THINKING, MAX_NEW_TOKENS, CONTEXT_TOKENS, MAX_UPLOAD_BYTES,
MAX_LINES, OUTPUT_DIR. Original Qwen/Qwen3-14B is the default and requires enough
RAM/VRAM; the notebook's 29.5 GB GPU allocation is not a peak memory estimate.

For a smaller real inference smoke test without changing parsing/clustering:

```bash
python -m scripts.smoke --model Qwen/Qwen3-0.6B --no-thinking --max-new-tokens 6000
```

A smaller model tests service integration, not equivalence to the 14B model's
diagnostic quality. Model generation remains sampled and JSON/schema failure is
reported explicitly. No replay/mock mode is exposed by the production API.
The health endpoint does not imply either model has been downloaded.
For CPU smoke runs, LOG_AI_LLM_DTYPE=float32 can avoid slow low-precision CPU kernels.
For the smaller Qwen model, enable schema decoding and disable thinking explicitly;
for example in PowerShell:

```powershell
$env:LOG_AI_ENFORCE_JSON = "true"
$env:LOG_AI_THINKING = "false"
$env:LOG_AI_LLM_DTYPE = "float32"
python -m scripts.smoke_small --model Qwen/Qwen3-0.6B
```

The compatible decoder stack is pinned to transformers 4.51.3 and
sentence-transformers 4.1.0. The real test exposed an import incompatibility
between lm-format-enforcer 0.11.3 and transformers 5.22.1.
requirements-tested.txt records the exact dependency versions from the verification
environment; requirements-dev.txt is the portable installation entry point.

For a four-line fixture that still executes real parsing, embedding, HDBSCAN,
event packaging, Qwen inference and validation, run:

```bash
python -m scripts.smoke_small --model Qwen/Qwen3-0.6B
```

Observed successes and failures are recorded in [TEST_RESULTS.md](TEST_RESULTS.md).

## Preserved behavior and boundaries

Drain3 sees messages in source order; templates are finalized after all messages.
retry/retrying are included in the final notebook importance rule. HDBSCAN noise
is retained. Exactly 30 seconds stays in the current event. Context remains
120 seconds, five preceding lines and up to 15 related lines for small events.
Only embedding_cluster is stripped before the LLM call. Qwen prompt, sampling
parameters and JSON extraction are preserved from 05_llm_analiz.ipynb.

Boundary handling adds an explicit empty/invalid-log error, singleton clustering
as noise and empty-event inference bypass. These cases were undefined or crashed
in the notebook. Hadoop progress facts are omitted when no progress records exist.
Timestamp timezone assumptions and minute-only activity keys are inherited.
Unmatched physical lines are counted and skipped by the original regex, including
multiline stack traces. The response reports that count.

Evidence checks enforce schema, complete unique event IDs, maximum quote length
and exact event-scoped substring membership. They do not prove causal correctness
or check timestamp-to-line alignment. Reports expose validation results separately.

