import json
import numpy as np
import pytest
from fastapi.testclient import TestClient
from ai_service.api import create_app
from ai_service.config import Settings
from ai_service.pipeline import Pipeline
from ai_service.processing import parse_logs, build_package
from ai_service.validation import validate_report

def line(t="00:00:00,000", level="ERROR", message="Connection timeout"):
    return f"2026-01-01 {t} {level} [main] example.Worker: {message}\n"

class Embedder:
    def encode(self, texts, **kwargs):
        return np.eye(len(texts), dtype=np.float32)

class Analyzer:
    def analyze_package(self, payload, **kwargs):
        package = json.loads(payload)
        return {"events": [dict(event_id=e["event_id"], summary="Test response",
                    severity="low", likely_root_cause=None, confidence="low",
                    confidence_reason="Injected test analyzer", evidence=[],
                    assumptions=[], alternative_explanations=[], unknowns=[],
                    recommended_checks=[], recommended_fix=None) for e in package["events"]],
                "cross_event_notes": ""}

@pytest.fixture
def client(tmp_path):
    settings = Settings(output_dir=tmp_path, max_upload_bytes=20000)
    return TestClient(create_app(settings, Pipeline(settings, Embedder(), Analyzer())))

def test_upload_full_service_contract_and_artifacts(client, tmp_path):
    response = client.post("/analyze", files={"file": ("sample.log", line().encode())})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["stats"]["matched_lines"] == 1
    assert result["package"]["events"][0]["n_rows"] == 1
    assert result["report"]["events"][0]["event_id"] == 0
    assert result["validation"]["valid"]
    assert (tmp_path / result["run_id"] / "final_root_cause_report.json").exists()

@pytest.mark.parametrize("content", [b"", b"not a log", b"\xff"])
def test_invalid_upload(client, content):
    assert client.post("/analyze", files={"file": ("x.log", content)}).status_code == 422

def test_upload_limit(client):
    assert client.post("/analyze", files={"file": ("x", b"x"*20001)}).status_code == 413

def test_busy(client):
    client.app.state.pipeline.lock.acquire()
    try:
        assert client.post("/analyze", files={"file": ("x", line())}).status_code == 503
    finally:
        client.app.state.pipeline.lock.release()

def test_no_important_rows_skips_models(tmp_path):
    settings = Settings(output_dir=tmp_path)
    result = Pipeline(settings).run(line(level="INFO", message="Started normally").encode())
    assert result["report"]["events"] == []
    assert not result["package"]["events"]

def test_gap_boundary_and_noise():
    df, tpl, tmap, masks = parse_logs([
        line("00:00:00,000"), line("00:00:30,000"), line("00:01:00,001")])
    tpl["hdb"] = -1
    package = build_package(df, tpl, tmap, masks)
    assert [e["n_rows"] for e in package["events"]] == [2, 1]
    assert package["events"][0]["templates"][0]["embedding_cluster"] == -1

def test_reject_duplicate_or_missing_ids():
    with pytest.raises(ValueError, match="exactly once"):
        validate_report({"events": [], "cross_event_notes": ""}, {"events": [{"event_id": 0}]})

def test_evidence_validation_is_event_scoped():
    package = {"events": [{"event_id": 0, "templates": [{"example": "real quote"}]}]}
    result = Analyzer().analyze_package(json.dumps(package))
    result["events"][0]["evidence"] = [{"time": "00:00:00", "quote": "invented"}]
    _, validation = validate_report(result, package)
    assert not validation["valid"]

def test_parser_matches_original_notebook():
    import io
    import re
    from pathlib import Path
    from unittest.mock import patch
    import pandas as pd
    from drain3 import TemplateMiner
    from drain3.template_miner_config import TemplateMinerConfig
    from drain3.masking import MaskingInstruction
    notebook = json.loads(Path("04_kumeleme.ipynb").read_text(encoding="utf-8"))
    source = "".join(notebook["cells"][1]["source"])
    source = source[source.index("pattern ="):source.index("device =")]
    namespace = dict(re=re, pd=pd, TemplateMiner=TemplateMiner,
                     TemplateMinerConfig=TemplateMinerConfig, MaskingInstruction=MaskingInstruction)
    text = line(message="Retrying connect to host 10.0.0.1:8030") + line(level="INFO", message="Started normally")
    with patch("builtins.open", return_value=io.StringIO(text)):
        exec(compile(source, "notebook-parser", "exec"), namespace)
    df, tpl, _, masks = parse_logs(text.splitlines())
    pd.testing.assert_frame_equal(df, namespace["df"])
    pd.testing.assert_frame_equal(tpl, namespace["tpl"])
    assert masks == namespace["MASKS"]

