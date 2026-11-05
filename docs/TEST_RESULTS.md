# Verification outside Google Colab

Environment: Windows, Python 3.13.7. Verification date: 6 November 2026.
The service and research notebook ran as ordinary local Python programs.
No Colab runtime, notebook globals, cached r2 analysis or replayed model output was
used by the service.

## Completed checks

- Final automated API/regression suite: **17 passed in 66.82 seconds**.
- The HTTP contract tests use FastAPI TestClient and injected test model objects;
  they cover upload processing, invalid/oversized input, concurrent request rejection,
  empty-event inference bypass, isolated artefacts, failed inference, event IDs,
  evidence checks and exact 30-second/noise behavior.
- A parser regression executes the original notebook parsing code against the
  extracted parser on identical input and compares the complete DataFrames.
- A separate local run executed every code cell of the untouched
  04_kumeleme.ipynb, skipping only shell install/clone commands and supplying the
  same Loghub file. Its **complete event package equals the service package**,
  including preceding/related lines, variable-field ranges and Hadoop context.

| Hadoop sample measurement | Result |
|---|---|
| Matched / unmatched lines | 2,000 / 0 |
| Drain3 templates | 99 |
| Flagged lines | 1,121 |
| Embedding shape | (99, 768) |
| HDBSCAN clusters / noise templates | 25 / 30 |
| Event sizes | [1, 1, 1119] |
| Entire EventPackage equality to original notebook | Pass |

The original notebook Git blobs were preserved; for example:
04_kumeleme.ipynb = bee0486ce2683cc8ad49168f97d21132bc5a72ca,
05_llm_analiz.ipynb = f3adb266d06184c11102937ec15bae8731c6a662.

## Dataset and models

- Loghub revision: dd61d0952749ee7963bde24220d1be5ede023033.
- Hadoop_2k.log SHA256:
  9ecaeb807d50d5fb5a20982ea66f1c8d32545259a51ce7456c1ab78db0509732.
- Embedding: sentence-transformers/all-mpnet-base-v2,
  revision e8c3b32edf5434bc2275fc9bab85f82640a19130.
- Real inference smoke model: Qwen/Qwen3-0.6B,
  revision c1899de289a04d12100db370d81485cdf75e47ca.
- CPU, float32, thinking disabled, max_new_tokens=6000.
- Exact dependency pins: requirements-tested.txt.

## Real inference

The final **2,000-line Hadoop end-to-end run passed** with real local models,
HTTP 200, all three analyzed event IDs and valid exact evidence (zero validation
errors). After inference, the smoke script executed the untouched clustering
notebook locally and asserted full equality with the service's event package.
Run ID: 400b8bff337342e1a669d1429b8114f2.

The small real-model smoke test passed with HTTP 200, one analyzed event and
valid exact evidence. Four log lines produced three templates, all retained as
HDBSCAN noise, and one four-row event. No test model objects were used.
Run ID: b41d3fc8c1dd49a495aefb07a49039a2.

This successful run used optional JSON-schema decoding, thinking=false and
float32 CPU inference. Schema decoding constrains token choices; it does not
coerce or silently rewrite the model response. The production default retains
the original unconstrained thinking mode. Both successful smoke tests used the
pinned transformers 4.51.3 / sentence-transformers 4.1.0 stack and
lm-format-enforcer 0.11.3.

An earlier unconstrained Qwen3-0.6B Hadoop run returned an object for
cross_event_notes instead of a string and was correctly rejected with HTTP 422.
A regression test checks this rejection and retention of the parsed model
response. Optional constrained decoding addresses the observed format failure
at generation time; it does not silently convert the object to a string.

## Limits of this verification

The repository's Qwen/Qwen3-14B remains the production default. It was not
executed in this verification: the available GPU has 8 GB memory, while the
original notebook recorded approximately 29.5 GB model allocation. The smaller
model verifies wiring and execution, not equivalent diagnostic quality.
Schema/quote validation does not establish a causal explanation's correctness.

Uvicorn startup succeeded. A separate sandbox process could not connect to its
loopback port; network-socket reachability was therefore not claimed as passing.
Request/response testing runs through the real ASGI app with TestClient.

The restricted Windows test environment rejected temporary directory permissions
used by pip/pytest. The external test harness normalized mkdir mode to 0o777 and
used workspace-local dependencies/cache; the production algorithms were not
patched for this workaround. Drain3 0.9.11 source was loaded from its official
PyPI source archive. Models were downloaded before the offline local inference
run. These environment workarounds are not requirements for an ordinary venv.

