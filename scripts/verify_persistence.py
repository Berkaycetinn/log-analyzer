"""Check a browser-created synthetic analysis against PostgreSQL and the real API.

Run before and after a backend restart. Receipt contains hashes/counts, not logs
or report text. Requires an isolated database whose name ends with _test.
"""
import argparse
import hashlib
import json
import os
import subprocess
import urllib.request
import uuid


def canonical_json(value):
    # JSON.stringify writes integral floating-point values (including 0.0) as integers.
    # Performance measurements use finite seconds rounded to three decimal places.
    def numbers(item):
        if isinstance(item, dict):
            return {key: numbers(value) for key, value in item.items()}
        if isinstance(item, list):
            return [numbers(value) for value in item]
        if isinstance(item, float) and item.is_integer():
            return int(item)
        return item
    return json.dumps(numbers(value), sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def verify(args):
    if not args.database.endswith("_test"):
        raise ValueError("Verification requires a synthetic-only database ending in _test")
    with open(args.receipt, encoding="utf-8") as file:
        receipt = json.load(file)
    job_id = str(uuid.UUID(receipt["job_id"]))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get(path):
        with opener.open(args.backend_url.rstrip("/") + "/api/v1/analyses/" + job_id + path, timeout=15) as response:
            return json.load(response)

    metadata, result = get(""), get("/result")
    assert metadata["filename"] == "synthetic-browser.log", "Unexpected test upload"
    assert metadata["status"] in ("COMPLETED", "COMPLETED_WITH_WARNINGS")
    assert result["run_id"] == receipt["run_id"]
    # Match JavaScript's stable key order and compact UTF-8 serialization.
    serialized = canonical_json(result)
    assert hashlib.sha256(serialized.encode("utf-8")).hexdigest() == receipt["result_sha256"]
    events = get("/events?size=100")["content"]
    attempts = get("/attempts")
    assert len(events) == receipt["event_count"]
    assert len(attempts) == metadata["attemptCount"] == 1
    assert attempts[0]["outcome"] == ("SUCCEEDED" if result["validation"]["valid"] else "SUCCEEDED_WITH_WARNINGS")
    sql = f"""
SELECT json_build_object(
 'status',j.status,'input_hex',encode(j.input_data,'hex'),'sha256',j.sha256,'result',j.result,
 'events',COALESCE((SELECT json_agg(json_build_object('eventId',e.event_id,'source',e.source,
   'analysis',e.analysis) ORDER BY e.event_id) FROM analysis_events e WHERE e.job_id=j.id),'[]'::json),
 'evidence',COALESCE((SELECT json_agg(json_build_object('eventId',v.event_id,'ordinal',v.ordinal,
   'time',v.log_time,'quote',v.quote) ORDER BY v.event_id,v.ordinal)
   FROM analysis_evidence v WHERE v.job_id=j.id),'[]'::json),
 'attempts',(SELECT count(*) FROM analysis_attempts a WHERE a.job_id=j.id),
 'migration_ok',(SELECT count(*)>0 AND bool_and(success) FROM flyway_schema_history)
) FROM analysis_jobs j WHERE j.id='{job_id}'::uuid;
"""
    completed = subprocess.run([args.psql, "-X", "-w", "-h", args.pg_host, "-p", str(args.pg_port),
                                "-U", args.pg_user, "-d", args.database, "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
                               check=True, capture_output=True, encoding="utf-8",
                               env={**os.environ, "PGCLIENTENCODING": "UTF8"})
    stored = json.loads(completed.stdout)
    assert stored["migration_ok"], "Flyway did not finish successfully"
    assert stored["status"] == metadata["status"]
    assert stored["sha256"] == receipt["input_sha256"]
    assert hashlib.sha256(bytes.fromhex(stored["input_hex"])).hexdigest() == receipt["input_sha256"]
    assert stored["result"] == result, "API result differs from stored JSONB"
    source = {event["event_id"]: event for event in result["package"]["events"]}
    analyses = {event["event_id"]: event for event in result["report"]["events"]}
    for event in stored["events"]:
        assert event["source"] == source[event["eventId"]]
        assert event["analysis"] == analyses[event["eventId"]]
    assert len(stored["events"]) == len(events) == receipt["event_count"]
    expected_evidence = [
        {"eventId": event["event_id"], "ordinal": ordinal, "time": item["time"], "quote": item["quote"]}
        for event in sorted(result["report"]["events"], key=lambda item: item["event_id"])
        for ordinal, item in enumerate(event["evidence"])
    ]
    assert stored["evidence"] == expected_evidence
    assert len(stored["evidence"]) == receipt["evidence_count"]
    assert stored["attempts"] == len(attempts)
    print(json.dumps({"database_persistence": "passed", "flyway": "passed", "input_hash": "passed",
                      "result_hash": "passed", "events": len(events), "evidence": len(expected_evidence),
                      "attempts": len(attempts), "validation_valid": result["validation"]["valid"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-url", default="http://127.0.0.1:8080")
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--pg-host", default="127.0.0.1")
    parser.add_argument("--pg-port", type=int, default=5432)
    parser.add_argument("--pg-user", default="backend_test")
    parser.add_argument("--psql", default="psql")
    verify(parser.parse_args())
