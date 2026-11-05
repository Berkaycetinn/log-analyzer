"""Real outside-Colab HTTP pipeline test. No fake embedding or analyzer."""
import argparse
import json
import urllib.request
import contextlib
import io
import os
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from ai_service.api import create_app
from ai_service.config import Settings

parser = argparse.ArgumentParser()
parser.add_argument("--model", default="Qwen/Qwen3-14B")
parser.add_argument("--max-new-tokens", type=int, default=12000)
parser.add_argument("--no-thinking", action="store_true")
parser.add_argument("--sample", default="work/Hadoop_2k.log")
args = parser.parse_args()
sample = Path(args.sample)
if not sample.exists():
    sample.parent.mkdir(parents=True, exist_ok=True)
    sample.write_bytes(urllib.request.urlopen(
        "https://raw.githubusercontent.com/logpai/loghub/dd61d0952749ee7963bde24220d1be5ede023033/Hadoop/Hadoop_2k.log",
        timeout=60).read())
settings = Settings(llm_model=args.model, max_new_tokens=args.max_new_tokens,
                    thinking=not args.no_thinking)
with TestClient(create_app(settings)) as client:
    response = client.post("/analyze", files={"file": ("Hadoop_2k.log", sample.read_bytes())})
    if response.status_code != 200:
        raise RuntimeError(f"{response.status_code}: {response.text}")
    result = response.json()
    assert result["stats"]["matched_lines"] == 2000
    assert result["stats"]["templates"] == 99
    assert result["stats"]["important_lines"] == 1121
    assert [e["n_rows"] for e in result["package"]["events"]] == [1, 1, 1119]
    assert len(result["report"]["events"]) == 3
    assert result["validation"]["valid"], result["validation"]
    # Execute the untouched research notebook as a reference outside Colab.
    # Skip shell installation/clone commands; provide the same downloaded sample.
    notebook = json.loads(Path("04_kumeleme.ipynb").read_text(encoding="utf-8"))
    original_dir = Path.cwd()
    sample_bytes = sample.read_bytes()
    with tempfile.TemporaryDirectory() as tmp:
        try:
            os.chdir(tmp)
            fixture = Path("loghub/Hadoop/Hadoop_2k.log")
            fixture.parent.mkdir(parents=True)
            fixture.write_bytes(sample_bytes)
            namespace = {}
            with contextlib.redirect_stdout(io.StringIO()):
                for cell in notebook["cells"]:
                    if cell["cell_type"] != "code":
                        continue
                    source = "".join(cell["source"])
                    source = "\n".join(line for line in source.splitlines()
                                       if not line.startswith("!"))
                    exec(compile(source, "04_kumeleme.ipynb", "exec"), namespace)
            assert namespace["out"] == result["package"], "Notebook event package regression"
        finally:
            os.chdir(original_dir)
    Path("smoke-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2),
                                         encoding="utf-8")
    print(json.dumps({"run_id": result["run_id"], "stats": result["stats"],
                      "validation": result["validation"]}, ensure_ascii=False))

