import json
import re
import torch

SYSTEM = """You are an SRE assistant that analyzes pre-processed application logs.
You receive a JSON package: log events (time-windowed groups of flagged log lines), each with templates,
counts, time ranges, raw example lines, ranges of masked values, and surrounding context.
The log comes from a single process (an application master), so lines from other components are NOT visible.

Rules:
1. Use ONLY the data in the package. Anything that depends on outside knowledge (what a port number usually means,
   how a framework typically behaves) must be listed under "assumptions", never stated as fact.
2. "evidence" quotes must be EXACT substrings copied from the package, at most 200 characters each. Never paraphrase inside a quote.
3. Confidence: "high" only if the log itself states the cause. "medium" if several consistent pieces of evidence
   point to one explanation but other explanations remain possible. "low" otherwise.
4. Severity describes the impact on the running job (none, low, medium, high), NOT the log level of the lines.
5. The sample is cut at "sample_end". Never state or imply that a problem ended, was resolved, or lasted a certain
   total duration beyond what the data shows.
6. If the data cannot answer something, say so under "unknowns". Do not fill gaps with guesses.
7. Write all explanations in Turkish. Keep quotes verbatim in their original language. Output ONLY valid JSON, no markdown.

Schema:
{
  "events": [
    {
      "event_id": <int>,
      "summary": "<1-2 sentences>",
      "severity": "none|low|medium|high",
      "likely_root_cause": "<hypothesis, or null if the data does not support one>",
      "confidence": "low|medium|high",
      "confidence_reason": "<why this level>",
      "evidence": [{"time": "<HH:MM:SS.mmm>", "quote": "<exact substring>"}],
      "assumptions": ["<anything not directly in the data>"],
      "alternative_explanations": ["..."],
      "unknowns": ["..."],
      "recommended_checks": ["<what a human should look at next>"],
      "recommended_fix": "<string or null>"
    }
  ],
  "cross_event_notes": "<relations between events, only if the data supports them>"
}"""


# ==========================================
# YENİ HÜCRE: Kök Neden Analiz Modülü & Pipeline Entegrasyonu
# ==========================================

import json
import re

class QwenLocalAnalyzer:
    def __init__(self, model, tok, system_prompt, json_schema=None):
        self.model = model
        self.tok = tok
        self.system_prompt = system_prompt
        self.json_schema = json_schema

    def analyze_package(self, payload_str: str, thinking: bool = True, max_new_tokens: int = 12000):
        """
        Log paketini (JSON payload) alıp Qwen3-14B ile analiz eder.
        Düşünce zincirini (<think>) temizleyerek sadece doğrulanmış JSON döndürür.
        """
        user_content = "Analyze every event in the following package.\n\n" + payload_str
        msgs = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_content}
        ]

        text = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=thinking)
        inputs = self.tok(text, return_tensors="pt").to(self.model.device)

        params = dict(temperature=0.6, top_p=0.95, top_k=20) if thinking else dict(temperature=0.7, top_p=0.8, top_k=20)
        if self.json_schema is not None:
            if thinking:
                raise ValueError("JSON schema decoding requires thinking=False")
            from lmformatenforcer import JsonSchemaParser
            from lmformatenforcer.integrations.transformers import build_transformers_prefix_allowed_tokens_fn
            params["prefix_allowed_tokens_fn"] = build_transformers_prefix_allowed_tokens_fn(
                self.tok, JsonSchemaParser(self.json_schema))

        with torch.no_grad():
            out = self.model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=True, **params)

        gen = out[0][inputs["input_ids"].shape[1]:]
        raw_output = self.tok.decode(gen, skip_special_tokens=True).strip()

        # </think> etiketini ayıkla
        body = raw_output.split("</think>")[-1] if "</think>" in raw_output else raw_output

        # JSON objesini cımbızla (regex)
        m = re.search(r'\{\s*"events"', body)
        body = body[m.start(): body.rfind("}") + 1] if m else body[body.find("{"): body.rfind("}") + 1]

        parsed_json = json.loads(body)
        return parsed_json


