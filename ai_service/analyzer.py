import json
import re
import torch

SYSTEM = """Uygulama loglarını inceleyen bir SRE asistanısın. Yalnız verilen olay paketindeki bilgileri kullan.
BÜTÜN açıklamaları TÜRKÇE yaz: summary, likely_root_cause, confidence_reason, assumptions,
alternative_explanations, unknowns, recommended_checks, recommended_fix ve cross_event_notes.
İngilizce JSON anahtarlarını ve enum değerlerini değiştirme. Kanıt alıntılarını (evidence.quote)
kaynak metinden AYNEN kopyala; çevirme, düzeltme veya yeni alıntı üretme. Alıntı en fazla 200 karakter.
Her event_id tam bir kez bulunmalı. Özet ve gerekçeler birer kısa Türkçe cümle olsun.
En fazla 3 kanıt, 2 kontrol, 2 bilinmeyen, 1 varsayım ve 1 alternatif açıklama seç; gereksiz tekrar yapma.
likely_root_cause kesinleşmiş neden değil, kanıtla desteklenen EN OLASI açıklamadır. Belirsizlik güveni düşürür;
belirsizliği gerekçe gösterip olası nedeni ve çözümü boş bırakma. Hiç ipucu yoksa nedenin belirlenemediğini açıkla.
diagnostic_hints varsa yalnız eşleşen hata için bu teknik bilgiden yararlan; bunlar giderilme kanıtı değildir.
recommended_fix somut bir müdahale planı olmalı: hangi kullanıcı/servis, hangi kaynak, hangi ayar değişmeli?
2-3 sıralı adımı tek metin içinde yaz. Yalnız 'kontrol edin' demek çözüm değildir. Doğrulanmamış kullanıcı,
işletim sistemi, komut veya yapılandırma değeri uydurma. chmod 777, herkese yetki veya korumaları kapatma önerme.
resolution_check alanında yeniden çalıştırma ve beklenen başarılı sonucu belirt. 'Bu neden doğrulanırsa bu
adımlarla hata giderilmelidir' gibi koşullu konuş; yeni başarılı log olmadan 'hata giderildi' deme.
Özet gerçek işlemi anlatmalı: dosya okuma hatasını kullanıcı girişi hatası olarak sunma.
severity etkiyi (none/low/medium/high), confidence güveni (low/medium/high) belirtir; log seviyesini kopyalama.
Örnek sample_end anında kesilir; olayın çözüldüğünü veya toplam süresini varsayma.
Kesin çözüm bilinmiyorsa güvenli bir sonraki müdahaleyi ve gerekli ek bilgiyi yaz. Yalnız geçerli JSON döndür."""

SYSTEM += """\nTürkçe üslup örnekleri: 'Kayıtlarda hata görülüyor.', 'Kesin neden bu örnekten belirlenemiyor.',
'Bağlantı ayarlarını kontrol edin.' Bunlar yalnız dil örneğidir; analizi gerçek olaylara göre yaz.
İngilizce açıklama yazma. resolution_check dahil tüm açıklamalar Türkçe olmalı.
Her şablonu ayrı olay sayma; yalnız paketteki event_id değerlerini kullan."""


class QwenLocalAnalyzer:
    def __init__(self, model, tok, system_prompt=SYSTEM, json_schema=None):
        self.model, self.tok = model, tok
        self.system_prompt, self.json_schema = system_prompt, json_schema
        self._tokenizer_data = None
        self.last_metrics = {}
        self.last_raw_output = None

    def prepare_decoder(self):
        if self.json_schema is not None and self._tokenizer_data is None:
            from lmformatenforcer.integrations.transformers import build_token_enforcer_tokenizer_data
            self._tokenizer_data = build_token_enforcer_tokenizer_data(self.tok)

    def messages(self, payload_str, language_retry=False):
        instruction = "Her olayı kısa TÜRKÇE cümlelerle değerlendir. JSON anahtarlarını ve kaynak alıntıları koru."
        if language_retry:
            instruction += " Önceki yanıt rapor kontrollerinden geçmedi. Tüm açıklamaları Türkçe yaz; olası neden, müdahale ve doğrulama adımları boş kalmasın. Onarım yapılmış gibi 'hata giderildi' deme."
        return [{"role": "system", "content": self.system_prompt},
                {"role": "user", "content": instruction + "\n" + payload_str}]

    def analyze_package(self, payload_str, thinking=False, max_new_tokens=1200, language_retry=False):
        from time import perf_counter
        started = perf_counter()
        self.last_raw_output = None
        text = self.tok.apply_chat_template(self.messages(payload_str, language_retry), tokenize=False,
                                            add_generation_prompt=True, enable_thinking=thinking)
        inputs = self.tok(text, return_tensors="pt").to(self.model.device)
        params = dict(do_sample=True, temperature=0.6, top_p=0.95, top_k=20) if thinking else dict(
            do_sample=False, temperature=1.0, top_p=1.0, top_k=50)
        if self.json_schema is not None:
            if thinking:
                raise ValueError("JSON schema decoding requires thinking=False")
            from .decoding import prefix_function
            self.prepare_decoder()
            params["prefix_allowed_tokens_fn"] = prefix_function(self._tokenizer_data, self.json_schema, payload_str)
        with torch.inference_mode():
            out = self.model.generate(**inputs, max_new_tokens=max_new_tokens, use_cache=True, **params)
        gen = out[0][inputs["input_ids"].shape[1]:]
        self.last_metrics = {"input_tokens": int(inputs["input_ids"].shape[1]),
                             "output_tokens": len(gen), "seconds": round(perf_counter() - started, 3)}
        raw = self.tok.decode(gen, skip_special_tokens=True).strip().split("</think>")[-1]
        self.last_raw_output = raw
        match = re.search(r'\{\s*"events"', raw)
        body = raw[match.start():raw.rfind("}") + 1] if match else raw[raw.find("{"):raw.rfind("}") + 1]
        try:
            return json.loads(body)
        except json.JSONDecodeError as error:
            raise ValueError("Model geçerli ve tam bir JSON raporu üretemedi; çıktı token sınırını kontrol edin.") from error
