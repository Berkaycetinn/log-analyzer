import hashlib
import json
from pathlib import Path
from threading import Lock, RLock
from time import perf_counter
from uuid import uuid4
from .processing import parse_logs, cluster_templates, build_package
from .validation import validate_report, require_actionable, ReportPlanError
from .language import require_turkish, ReportLanguageError
from .diagnostics import diagnostic_hints

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
        self.model_lock = RLock()
        self.model_state = "ready" if embedder is not None and analyzer is not None else "unloaded"
        self.model_error = None

    def load_models(self):
        with self.model_lock:
            if self.embedder is not None and self.analyzer is not None:
                self.model_state = "ready"
                return
            self.model_state = "loading"
            try:
                self._load_models()
                self.model_state = "ready"
                self.model_error = None
            except Exception:
                self.model_state = "error"
                self.model_error = "Model hazırlığı başarısız; AI servisinin loglarını kontrol edin."
                raise

    def _load_models(self):
        if self.embedder is None:
            from sentence_transformers import SentenceTransformer
            self.embedder = SentenceTransformer(self.settings.embedding_model,
                                                device=self.settings.device)
        if self.analyzer is None:
            from transformers import AutoModelForCausalLM, AutoTokenizer
            from .analyzer import QwenLocalAnalyzer, SYSTEM
            from .schemas import brief_report_schema
            tokenizer = AutoTokenizer.from_pretrained(self.settings.llm_model)
            model = AutoModelForCausalLM.from_pretrained(
                self.settings.llm_model, torch_dtype=self.settings.llm_dtype,
                device_map=self.settings.device)
            analyzer = QwenLocalAnalyzer(model.eval(), tokenizer, SYSTEM,
                json_schema=brief_report_schema() if self.settings.enforce_json else None)
            analyzer.prepare_decoder()
            self.analyzer = analyzer

    def run(self, content: bytes):
        # Serialize model loading and inference; run this synchronous method in a worker thread.
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError("An analysis is already running")
        try:
            return self._run(content)
        finally:
            self.lock.release()

    def _run(self, content):
        started = perf_counter()
        model_wait = 0.0
        if len(content) > self.settings.max_upload_bytes:
            raise OverflowError("Upload exceeds configured limit")
        text = content.decode("utf-8-sig")
        lines = text.splitlines()
        if len(lines) > self.settings.max_lines:
            raise OverflowError("Log exceeds configured line limit")
        df, tpl, tmap, masks = parse_logs(lines)
        # No inference is needed for input with no flagged rows.
        if df["important"].any():
            loading_started = perf_counter()
            self.load_models()
            model_wait = perf_counter() - loading_started
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
                model_input = strip(package)
                hints = diagnostic_hints(package)
                if hints:
                    model_input['diagnostic_hints'] = hints
                payload = json.dumps(model_input, ensure_ascii=False, separators=(",", ":"))
                token_budget = min(self.settings.max_new_tokens,
                                   self.settings.tokens_per_event * len(package["events"]))
                # The production analyzer has a real tokenizer; injected test doubles need not.
                if hasattr(self.analyzer, "tok"):
                    messages = self.analyzer.messages(payload, language_retry=True)
                    tokens = self.analyzer.tok.apply_chat_template(
                        messages, tokenize=True, add_generation_prompt=True,
                        enable_thinking=self.settings.thinking)
                    if len(tokens) + token_budget > self.settings.context_tokens:
                        raise OverflowError("LLM context budget exceeded")
                llm_started = perf_counter()
                for language_attempt in range(self.settings.language_retries + 1):
                    result = self.analyzer.analyze_package(payload, thinking=self.settings.thinking,
                        max_new_tokens=token_budget, language_retry=language_attempt > 0)
                    save("model_response.json" if language_attempt == 0 else "language_retry_response.json", result)
                    report, validation = validate_report(result, strip(package))
                    try:
                        require_actionable(report)
                        require_turkish(report)
                        break
                    except (ReportLanguageError, ReportPlanError):
                        if language_attempt >= self.settings.language_retries:
                            raise
                llm_seconds = perf_counter() - llm_started
            else:
                result = {"events": [], "cross_event_notes": ""}
                language_attempt, llm_seconds = -1, 0.0
            save("model_response.json", result)
            report, validation = validate_report(result, strip(package))
            require_turkish(report)
            validation["language"] = "tr"
            save("validation.json", validation)
            save("final_root_cause_report.json", report)
        except Exception as error:
            raw = getattr(self.analyzer, "last_raw_output", None)
            if raw:
                save("failed_model_response.json", {"raw": raw})
            save("error.json", {"type": type(error).__name__, "message": str(error)})
            raise
        return {"run_id": run_id, "stats": stats, "package": package,
                "report": report, "validation": validation,
                "performance": {"total_seconds": round(perf_counter() - started, 3),
                    "model_wait_seconds": round(model_wait, 3), "llm_seconds": round(llm_seconds, 3),
                    "language_attempts": language_attempt + 1,
                    "generation": getattr(self.analyzer, "last_metrics", {})}}

