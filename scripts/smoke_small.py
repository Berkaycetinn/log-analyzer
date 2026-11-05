"""A small, real-model end-to-end API smoke test; no model doubles."""
import argparse
import json
from pathlib import Path
from fastapi.testclient import TestClient
from ai_service.api import create_app
from ai_service.config import Settings

parser = argparse.ArgumentParser()
parser.add_argument("--model", default="Qwen/Qwen3-14B")
args = parser.parse_args()
settings = Settings(llm_model=args.model, thinking=False, max_new_tokens=1800)
sample = "\n".join([
    "2015-10-18 18:05:27,570 ERROR [main] example.Network: Connection failed: java.net.NoRouteToHostException: No route to host 10.0.0.1:9000",
    "2015-10-18 18:05:28,570 WARN [main] example.Lease: Failed to renew lease for 30 seconds. Will retry shortly",
    "2015-10-18 18:05:29,570 ERROR [main] example.RM: ERROR IN CONTACTING RM.",
    "2015-10-18 18:05:30,570 ERROR [main] example.Network: Connection failed: java.net.NoRouteToHostException: No route to host 10.0.0.1:9000",
])
with TestClient(create_app(settings)) as client:
    response = client.post("/analyze", files={"file": ("small.log", sample.encode())})
    if response.status_code != 200:
        raise RuntimeError(f"{response.status_code}: {response.text}")
    result = response.json()
    assert result["stats"]["matched_lines"] == 4
    assert result["stats"]["templates"] == 3
    assert result["package"]["events"][0]["n_rows"] == 4
    assert len(result["report"]["events"]) == 1
    assert result["validation"]["valid"], result["validation"]
    Path("smoke-small-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"run_id": result["run_id"], "stats": result["stats"], "validation": result["validation"]}), flush=True)
