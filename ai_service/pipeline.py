import hashlib
import json
from pathlib import Path
from threading import Lock
from uuid import uuid4
from .processing import parse_logs, cluster_templates, build_package
from .validation import validate_report

def strip(value):
    if isinstance(value, dict):
        return {k: strip(v) for k, v in value.items() if k != "embedding_cluster"}
    if isinstance(value, list):
        return [strip(v) for v in value]
    return value

class Pipeline:
    def __init__(self, settings, embedder=None, analyzer=None):
        self.settings = settings
        self.embedder = embedder
        self.analyzer = analyzer
        self.lock = Lock()

    def load_models(self):
        if self.embedder is None:
            from sentence_transformers import SentenceTransformer
            self.embedder = SentenceTransformer(self.settings.embedding_model,
                                                device=self.settings.device)
        if self.analyzer is None:
            from transformers import AutoModelForCausalLM, AutoTokenizer
            from .analyzer import QwenLocalAnalyzer, SYSTEM
            from .schemas import Report
            tokenizer = AutoTokenizer.from_pretrained(self.settings.llm_model)
            model = AutoModelForCausalLM.from_pretrained(
                self.settings.llm_model, torch_dtype=self.settings.llm_dtype,
                device_map=self.settings.device)
            self.analyzer = QwenLocalAnalyzer(model, tokenizer, SYSTEM,
                json_schema=Report.model_json_schema() if self.settings.enforce_json else None)

    def run(self, content: bytes):
        # Serialize model loading and inference; run this synchronous method in a worker thread.
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError("An analysis is already running")
        try:
            return self._run(content)
        finally:
            self.lock.release()

    def _run(self, content):
        if len(content) > self.settings.max_upload_bytes:
            raise OverflowError("Upload exceeds configured limit")
        text = content.decode("utf-8-sig")
        lines = text.splitlines()
        if len(lines) > self.settings.max_lines:
            raise OverflowError("Log exceeds configured line limit")
        df, tpl, tmap, masks = parse_logs(lines)
        # No inference is needed for input with no flagged rows.
        if df["important"].any():
            self.load_models()
            vectors = self.embedder.encode(tpl["template"].tolist(),
                                           normalize_embeddings=True, show_progress_bar=False)
            tpl["hdb"] = cluster_templates(vectors)
        else:
            tpl["hdb"] = -1
        package = build_package(df, tpl, tmap, masks)
        run_id = uuid4().hex
        directory = self.settings.output_dir / run_id
        directory.mkdir(parents=True)
        def save(name, data):
            (directory / name).write_text(json.dumps(data, ensure_ascii=False, indent=2),
                                         encoding="utf-8")
        stats = {"matched_lines": len(df), "unmatched_lines": len(lines) - len(df),
                 "templates": len(tpl), "important_lines": int(df["important"].sum()),
                 "noise_templates": int((tpl["hdb"] == -1).sum()),
                 "clusters": len(set(tpl["hdb"]) - {-1})}
        save("events.json", package)
        save("manifest.json", {"run_id": run_id, "input_sha256": hashlib.sha256(content).hexdigest(),
                              "settings": self.settings.model_dump(mode="json"), "stats": stats})
        try:
            if package["events"]:
                payload = json.dumps(strip(package), ensure_ascii=False, indent=1)
                # The production analyzer has a real tokenizer; injected test doubles need not.
                if hasattr(self.analyzer, "tok"):
                    messages = [{"role": "system", "content": self.analyzer.system_prompt},
                                {"role": "user", "content": "Analyze every event in the following package.\n\n" + payload}]
                    tokens = self.analyzer.tok.apply_chat_template(
                        messages, tokenize=True, add_generation_prompt=True,
                        enable_thinking=self.settings.thinking)
                    if len(tokens) + self.settings.max_new_tokens > self.settings.context_tokens:
                        raise OverflowError("LLM context budget exceeded")
                result = self.analyzer.analyze_package(payload, thinking=self.settings.thinking,
                                                       max_new_tokens=self.settings.max_new_tokens)
            else:
                result = {"events": [], "cross_event_notes": ""}
            save("model_response.json", result)
            report, validation = validate_report(result, strip(package))
            save("validation.json", validation)
            save("final_root_cause_report.json", report)
        except Exception as error:
            save("error.json", {"type": type(error).__name__, "message": str(error)})
            raise
        return {"run_id": run_id, "stats": stats, "package": package,
                "report": report, "validation": validation}

