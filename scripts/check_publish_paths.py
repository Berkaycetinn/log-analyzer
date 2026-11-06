"""Reject tracked secrets, weights, uploads and generated artifacts before publishing."""
import argparse
import json
from pathlib import PurePosixPath
import subprocess

FORBIDDEN_DIRECTORIES = {
    "runs", "uploads", "outputs", "__pycache__", ".venv", "venv",
    "models", "hf-cache", "model-cache", "postgres-data", "ai-runs",
    "target", ".m2", "work", ".git",
}

def prohibited(path: str) -> bool:
    path = PurePosixPath(path.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts:
        return True
    if any(part in FORBIDDEN_DIRECTORIES for part in path.parts[:-1]):
        return True
    name = path.name.lower()
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        return True
    return name == "pytorch_model.bin" or name.endswith(
        (".safetensors", ".onnx", ".log", ".class", ".war")
    )

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--paths-file", help="JSON list of proposed repository-relative paths")
    args = parser.parse_args()
    if args.paths_file:
        with open(args.paths_file, encoding="utf-8") as file:
            paths = json.load(file)
        if not isinstance(paths, list) or not all(isinstance(path, str) for path in paths):
            raise ValueError("Expected a JSON list of paths")
    else:
        paths = subprocess.check_output(["git", "ls-files", "-z"], text=True).split("\0")
        paths = [path for path in paths if path]
    rejected = [path for path in paths if prohibited(path)]
    if rejected:
        raise SystemExit("Refusing to publish prohibited paths:\n" + "\n".join(rejected))
    print(f"Publish path check passed: {len(paths)} files")

if __name__ == "__main__":
    main()

