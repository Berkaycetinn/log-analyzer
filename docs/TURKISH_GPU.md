# Türkçe analiz ve GPU ile çalıştırma

Yeni raporların açıklamaları Türkçe üretilir ve kaydedilmeden önce dil kontrolünden
geçer. JSON anahtarları, enum değerleri ve kaynak kanıt alıntıları korunur. Dil
kontrolü başarısızsa en fazla bir yeniden üretim yapılır; yine başarısızsa
`REPORT_LANGUAGE_INVALID` / `AI_REPORT_LANGUAGE_INVALID` hatası döner. Önceden
kaydedilmiş İngilizce raporlar değişmez; yeni rapor için dosyayı yeniden yükleyin.

Compose varsayılanı Qwen3-1.7B'dir. Mevcut `.env` içindeki `LLM_MODEL` CPU seçimini
korur. GPU profili `GPU_LLM_MODEL` kullanır; varsayılanı Qwen3-1.7B'dir. Küçük 0.6B
model, bu örnekte Türkçe talimatını tutarlı izleyemedi. Araştırmadaki 14B modelin
tanı kalitesiyle eşdeğerlik iddia edilmez.

NVIDIA GPU erişimi olan Docker Desktop / WSL2 üzerinde:

```powershell
docker compose -p log-analyzer -f compose.yml -f compose.gpu.yml up -d --build --wait --wait-timeout 300
```

İlk CUDA imajı ve model indirmesi birkaç GB veri aktarır. Arayüz
`http://localhost:5173` adresindedir. Üst bölümde önce model hazırlığı, ardından
`AI modeli hazır · NVIDIA GPU` görünür. GPU erişimi yoksa aynı komutu yalnız
`-f compose.yml` ile CPU üzerinde çalıştırın; CPU süreleri daha uzun olabilir.
`down -v` kullanmayın; bu seçenek kalıcı verileri siler.

Servis başlangıçta modelleri arka planda hazırlar. `GET /health` liveness bilgisinden
ayrı olarak `model_state`, `models_loaded` ve `device` döndürür. Spring Boot
`GET /api/v1/system/ai` bu bilgiyi kısa zaman aşımıyla arayüze aktarır.
`LOG_AI_PRELOAD_MODELS`, `LOG_AI_TOKENS_PER_EVENT` (1200),
`LOG_AI_MAX_NEW_TOKENS` (4096) ve `LOG_AI_LANGUAGE_RETRIES` (1) ayarlanabilir.
Kaynak olay sayısı/kimlikleri üretim şemasını sınırlar; kaynak log girdisi bu
optimizasyon için kesilmez. Çok olaylı büyük paketler toplam çıktı sınırını aşarsa
başarılı rapor taklidi yerine açık hata verir.

10 Kasım 2026 yerel ölçümü: RTX 4070 Laptop 8 GB, CUDA Torch 2.7.1,
float16 Qwen3-1.7B, dört sentetik log satırı, 3 şablon, 1 olay. Model hazırlığı
28,36 saniye; modeller hazırken iki gerçek pipeline çağrısı 20,27 ve 19,66 saniye.
Her iki çağrı 387 çıktı tokenıyla ilk denemede Türkçe doğrulamasını geçti.
Aynı örneğin Linux Docker CI CPU koşusunda LLM üretimi 206,15 saniye sürdü.
Bu süreler belirli örnek içindir; genel bir süre garantisi değildir.

Parsing, Drain3, embedding normalizasyonu, HDBSCAN ve olay paketleme algoritmaları
değiştirilmedi. Kalıcı sonuçtaki `performance` alanı toplam, model bekleme ve LLM
sürelerini içerir; arayüzün işleme özetinde gösterilir. Alıntı eşleşmesi veya dil
kontrolü, modelin kök neden çıkarımının doğru olduğunu kanıtlamaz.

Yerel testler: 76 Python, 17 Java birim, 15 frontend birim testi ve üretim frontend
paketi derlemesi geçti. Gerçek PostgreSQL/Flyway + Spring + GPU FastAPI + tarayıcı
akışında 7 test; SQL hash/olay/kanıt kontrolleri ve backend yeniden başlatıldıktan
sonra kalıcılık/üretim arayüzü kontrol edildi. Windows tarayıcı indirmesi test
ortamında engellendiğinden JSON indirme bu yerel koşuda gerçek Blob baytlarıyla
doğrulandı. Yerel Docker motor erişimi ayrıca doğrulanmalıdır; yerel native GPU
testi, Docker GPU profilinin çalıştığı anlamına gelmez.

