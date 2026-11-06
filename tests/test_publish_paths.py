import pytest
from scripts.check_publish_paths import prohibited

@pytest.mark.parametrize("path", [
    ".env", "backend/.env", ".env.production", "weights/model.safetensors",
    "nested/pytorch_model.bin", "embedding/model.onnx", "runs/result.json",
    "backend/uploads/private.txt", "outputs/report.json", "nested/server.log",
    "__pycache__/api.pyc", ".venv/lib/package.py", "venv/bin/python",
    "backend/target/backend.jar", ".m2/cache.xml", "models/config.json",
    "hf-cache/token", "work/pg/data", "nested\\uploads\\data.txt",
    "../outside.txt", "/absolute/file", "ai-runs/report.json",
    "frontend/node_modules/react/index.js", "frontend/dist/index.html",
    "frontend/.vite/cache.json", "frontend/coverage/index.html",
    "frontend/playwright-report/index.html", "frontend/test-results/trace.zip",
    "frontend/npm-cache/_logs/debug.txt", "frontend/tsconfig.app.tsbuildinfo",
])
def test_forbidden_publish_path(path):
    assert prohibited(path)

@pytest.mark.parametrize("path", [
    ".env.example", ".gitignore", "backend/pom.xml", "compose.yml",
    "backend/src/test/resources/ai-success.json", "ai_service/processing.py",
    "docs/BACKEND.md", ".github/workflows/backend.yml", "scripts/run.py",
])
def test_source_and_synthetic_fixtures_allowed(path):
    assert not prohibited(path)

