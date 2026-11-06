"""Live Spring Boot -> PostgreSQL -> Python smoke test. Servers must already run.
Uses synthetic input only; writes no files unless --output is explicitly provided.
"""
import argparse
import json
import time
import urllib.request
import uuid
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--backend-url", default="http://localhost:8080")
parser.add_argument("--timeout", type=int, default=1800)
parser.add_argument("--normal-only", action="store_true")
parser.add_argument("--output")
args = parser.parse_args()
base = args.backend_url.rstrip("/")
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def request(path, data=None, headers=None):
    with opener.open(urllib.request.Request(base + path, data=data, headers=headers or {}),
                     timeout=15) as response:
        return response.status, json.load(response)

if args.normal_only:
    sample = "2020-01-01 00:00:00,000 INFO [main] example.Worker: Synthetic startup\n"
else:
    sample = "\n".join([
        "2020-01-01 00:00:00,000 ERROR [main] example.Network: Connection failed: java.net.NoRouteToHostException: No route to host 127.0.0.1:9000",
        "2020-01-01 00:00:01,000 WARN [main] example.Lease: Failed to renew lease for 30 seconds. Will retry shortly",
        "2020-01-01 00:00:02,000 ERROR [main] example.RM: ERROR IN CONTACTING RM.",
        "2020-01-01 00:00:03,000 ERROR [main] example.Network: Connection failed: java.net.NoRouteToHostException: No route to host 127.0.0.1:9000",
    ]) + "\n"
boundary = "smoke-" + uuid.uuid4().hex
payload = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic-smoke.log\"\r\n"
           f"Content-Type: text/plain\r\n\r\n{sample}\r\n--{boundary}--\r\n").encode("utf-8")
headers = {"Content-Type": f"multipart/form-data; boundary={boundary}",
           "Idempotency-Key": "live-smoke-" + uuid.uuid4().hex}
status, job = request("/api/v1/analyses", payload, headers)
assert status == 202
print(json.dumps({"accepted": job["id"], "status": job["status"]}), flush=True)
deadline = time.monotonic() + args.timeout
while time.monotonic() < deadline:
    _, current = request("/api/v1/analyses/" + job["id"])
    if current["status"] in ("COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"):
        break
    time.sleep(1)
else:
    raise TimeoutError("Backend analysis did not complete")
assert current["status"] == "COMPLETED", current
_, result = request("/api/v1/analyses/" + job["id"] + "/result")
_, events = request("/api/v1/analyses/" + job["id"] + "/events")
_, attempts = request("/api/v1/analyses/" + job["id"] + "/attempts")
assert result["validation"]["valid"], result["validation"]
assert result["stats"]["matched_lines"] == (1 if args.normal_only else 4)
assert len(result["report"]["events"]) == (0 if args.normal_only else 1)
assert events["totalElements"] == (0 if args.normal_only else 1)
assert attempts[-1]["outcome"] == "SUCCEEDED"
_, replay = request("/api/v1/analyses", payload, headers)
assert replay["id"] == job["id"]
_, after = request("/api/v1/analyses/" + job["id"] + "/attempts")
assert len(after) == len(attempts)
summary = {"job_id": job["id"], "status": current["status"], "ai_run_id": result["run_id"],
           "stats": result["stats"], "validation_valid": result["validation"]["valid"],
           "events": events["totalElements"], "attempts": len(attempts),
           "idempotency_replay": True}
if args.output:
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps(summary), flush=True)

