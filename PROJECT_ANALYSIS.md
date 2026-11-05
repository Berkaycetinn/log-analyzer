# Proje Analizi

İncelenen repo: [Berkaycetinn/log-analyzer](https://github.com/Berkaycetinn/log-analyzer).
Temel commit: `98956406ddaf7fd0f45837d17b3026b52d38ac64`.
İnceleme tarihi: 5 Kasım 2026. Kapsam: bu commit'teki tüm 9 dosya, beş notebook'un tüm kaynak hücreleri ve kayıtlı deney çıktıları. Hücre referansları notebook JSON içindeki sıfır tabanlı `cells` indeksidir; execution_count değildir.

Bu çalışma statik incelemedir. Veri indirme, model yükleme ve notebook çalıştırma yapılmadı; aşağıdaki ölçümler kayıtlı deney sonuçlarıdır. Bu değişiklik yalnızca PROJECT_ANALYSIS.md ve ARCHITECTURE.md ekler.

## Mevcut ürün ve dosya envanteri

Amaç, tek log dosyasından hata olayları ve kanıta dayalı olası kök neden raporu üretmektir. Mevcut uygulama, Hadoop örneğine göre geliştirilmiş Colab/Jupyter prototipidir.

| Dosya | İncelenen içerik ve rol |
|---|---|
| README.md | Ürün amacı, kapsam, başarı hedefleri, planlanan Python modülleri |
| LICENSE | MIT lisansı, 2026 Berkaycetinn |
| .gitignore | Genel Python/araç şablonu; *.log ve .env dışlanır; üretilen JSON/NPY/CSV için özel kural yok |
| veri_kesfi.ipynb | 8 hücre; Loghub indirme, format inceleme, eşleşmeyen satırlar, kaba maskeler ve zaman çizelgesi |
| 0_2_parsing.ipynb | 12 hücre; Drain3, maskeler, grouping_accuracy, parametre taraması, önem bayrakları |
| 03_embedding.ipynb | 14 hücre; parsing tekrarı, template tablosu, normalize embedding, model/metin karşılaştırması |
| 04_kumeleme.ipynb | 13 hücre; parsing/embedding tekrarı, HDBSCAN, zaman pencereleri, bağlam ve events.json |
| 05_llm_analiz.ipynb | 14 hücre; Qwen, prompt, JSON çıkarımı, kanıt kontrolü, v1/v2 deneyleri, QwenLocalAnalyzer |
| docs/veri-notlari.md | Veri gözlemleri, deney sonuçları, kararlar ve bazı aşırı güçlü doğruluk iddiaları |

Repoda AGENTS.md, çalıştırılabilir Python paketleri, requirements/lock dosyası, test dizini, CI, API, arayüz, Docker veya dağıtım tanımı yok. README'deki parser.py, embedder.py, clusterer.py, analyzer.py, api.py ve app.py yalnızca plan. Ham veri, embeddings.npy, templates.csv, events.json ve rapor JSON'ları commit'te bulunmuyor.

## Gerçekte çalışan veri akışı

1. Notebook'lar Loghub reposunu klonlar ve Hadoop/Hadoop_2k.log dosyasını okur.
2. Hadoop regex'i date, time, level, thread, component ve message alanlarını çıkarır.
3. Drain3 mesajları template'lere eşler; satır düzeyinde önem bayrağı ayrıca hesaplanır.
4. Her benzersiz Drain3 template'i için tek normalize embedding üretilir.
5. sklearn.cluster.HDBSCAN template vektörlerini gruplar.
6. Önemli satırlar zaman farkına göre olaylara ayrılır. HDBSCAN etiketi olay sınırını belirlemez.
7. Template istatistikleri, maskelenen değerler, önceki/ilişkili satırlar ve Hadoop ilerleme bilgileri events.json'a eklenir.
8. LLM notebook'u events.json'u okur, embedding_cluster alanlarını çıkarır ve bütün olayları tek Qwen çağrısında analiz eder.

03 notebook'u embeddings.npy ve templates.csv yazar; 04 bunları okumaz, baştan hesaplar. 0_2 de başka notebook'lara aktarılacak bir parsing dosyası üretmez. Notebook'lar arasında fiilen kullanılan dosya sınırı 04 → events.json → 05'tir. 04 aynı dosyayı hücre 7, 9, 10 ve 12'de giderek zenginleştirerek yeniden yazar; ara sürümün kullanılması bağlam kaybıdır.

## Parsing ve embedding bulguları

- 0_2 hücre 3: build_miner(sim_th=0.4, depth=4) ve run_drain(messages, **kw). Maskeler sırayla ID, BLK, IP, DUR, NUM. Nihai template'ler bütün mesajlar işlendiğinde miner'dan alınır.
- 0_2 hücre 11: önem kuralında retry/retrying yoktur. 03 hücre 4 ve 04 hücre 1 bunları ekler; entegrasyon için son kullanılan 04 davranışı esas alınmalıdır.
- Önem: ERROR/WARN/FATAL veya şüpheli mesaj; maxTaskFailuresPerNode istisnası uygulanır. Template önem oranı >= 0.5 yalnızca template özeti içindir; satır filtresinin yerine geçmez.
- 03 hücre 6–7: all-mpnet-base-v2, ham template metni, normalize_embeddings=True. text_clean ve diğer modeller sonraki deneylerdir, kaydedilmiş emb_final'in yerine geçmez.
- 04 hücre 1, tarih+saatten ts üretir. 03 template tablosundaki first/last yalnızca saat metnidir; doğrudan aynı şema varsayılmamalıdır.
- Parsing regex'i yalnız Hadoop biçimini kapsar. 0_2/03/04 eşleşmeyen satırları sessizce atar; veri_kesfi hücre 2 bunları ayrıca toplar. Çok satırlı stack trace, boş dosya ve başka formatlar için ürün davranışı tanımlı değildir.

Kayıtlı temel sonuçlar: 2.000 eşleşen satır, 99 Drain3 template'i, 114 referans template, GA 0.963, 5 birleşen grup ve 0 bölünen referans grup. Ham mesaj karşılaştırması 0.9265, boşluk normalizasyonuyla 1.0'dır. Son önem kuralında 1.121 satır ve 17 önemli template, embedding şekli (99, 768). Bunlar bütün veri setleri için garanti değildir.

## Kümeleme ve olay üretimi

04 hücre 3–4: sklearn HDBSCAN; min_cluster_size=2, min_samples=1, metric=euclidean. Bağımsız hdbscan paketinin kullanımı aynı uygulama olarak varsayılmamalıdır. Her template bir noktadır; satır sayısıyla ağırlıklandırma yoktur.

04 hücre 5 ve 7: önemli satırlar ts ile sıralanır; ardışık fark **30 saniyeden büyükse** yeni olay başlar. Tam 30 saniye aynı olayda kalır. Bu sabit uzunluklu pencere değildir; sürekli yakın mesajlar uzun bir olay oluşturabilir.

Kayıtlı sonuç: 25 embedding kümesi, 30 noise template'i (348 satır). Üç olayın önemli satır sayıları 1, 1, 1.119'dur. ERROR IN CONTACTING RM. noise olarak sınıflandırılsa da olayda kalır. Gürültü (-1) atılmamalıdır. Aynı olay birden fazla embedding kümesi içerebilir.

04 hücre 2'de extract_params ve field_stats değişen maske alanlarını çıkarır. Alanlar NUM#1 gibi konumsaldır; semantik alan adı değildir. Sabit değerler istatistikten çıkarılır. DUR sayısal dönüşümü birim dönüşümü yapmaz; ms ve s genel veride doğrudan karşılaştırılamaz. Ham örnekler bu nedenle gereklidir.

Bağlam üretimi: önceki 120 saniyedeki önemli satırlar, olay öncesi 5 satır, küçük olaylarda (<=5 satır) kimlik üzerinden ±120 saniye içinde en fazla 15 ilişkili satır. Progress of TaskAttempt ilişkili satır listesinden çıkarılır. Tam ham log yerine message parçaları taşınır; 200/220/250 karakter kırpmaları uygulanır.

## LLM entegrasyonunun durumu

05 hücre 13, QwenLocalAnalyzer(model, tok, system_prompt) ve analyze_package(payload_str, thinking=True, max_new_tokens=12000) sunar. Model 05 hücre 2'de Qwen/Qwen3-14B olarak yüklenir. Claude API implementasyonu yoktur.

Metot chat template uygular, örneklemeli üretim yapar, düşünme bölümü sonrası JSON'u ayırıp json.loads döndürür. Bu yalnızca JSON sözdizimi kontrolüdür; şema veya kanıt doğrulaması değildir. Sınıf torch global import'una ihtiyaç duyar.

Son hücre analyzer_engine oluşturur fakat analyze_package çağırmaz; final_report = r2 ile önceki deney sonucunu kaydeder. Dolayısıyla sınıf üzerinden uçtan uca entegrasyon henüz gösterilmemiştir.

05 hücre 5'te check_evidence, global data'dan oluşturulan haystack içinde küçük harf/boşluk normalizasyonuyla alıntı arar. Olay veya zaman eşleşmesini, 200 karakter sınırını ve birebir harf eşitliğini denetlemez. Bütün string'leri birleştirdiği için alan sınırları da korunmaz. Son raporda yazdırılan “Doğrulanmış Kanıt Sayısı” yalnızca evidence listesinin uzunluğudur.

Kayıtlı v2 örneklerinde bulunamayan alıntı sayısı sıfırdır; bundan “hallüsinasyon %100 engellendi” sonucu çıkmaz. docs/veri-notlari.md içindeki bu iddia desteklenmiyor. Aynı dosyadaki v1/v2 tablo değerleri mevcut notebook çıktılarıyla birebir uyuşmuyor. Olaylar arası nedensellik de alıntı eşleşmesiyle doğrulanamaz.

Kayıtlı Qwen yüklemesi yaklaşık 29.5 GB CUDA belleği bildirir; bu toplam tepe bellek gereksinimi değildir. Bir v2 çağrısında 8.694 girdi token'ı ve 67 saniye kaydedilmiş. len(text)//4 hesabı gerçek tokenizer bütçesi olarak kullanılamaz.

## Entegrasyon öncesi açık işler

| Öncelik | Konu | Entegrasyona etkisi |
|---|---|---|
| P1 | Notebook global state ve tekrar eden parsing | Tek kaynak, açık parametreler ve tek orchestrator gerekir |
| P1 | Boş/bozuk/uyumsuz giriş | max(events), iloc[0] ve first_normal.time() gibi işlemler hata verebilir |
| P1 | Zayıf LLM doğrulaması | JSON parse başarısı rapor doğruluğu anlamına gelmez |
| P1 | Bağımlılık ve model sürümleri sabit değil | Yeniden üretim için doğrulanmış lock ve model/data revision gerekir |
| P2 | Hadoop'a özel analiz | pre_storm_facts, attempt regex'leri ve prompt'taki ApplicationMaster varsayımı genel loglara uygulanamaz |
| P2 | Zaman ve sıralama | Saat bazlı activity_per_minute farklı günleri birleştirir; saat dilimi belirtilmemiş |
| P2 | Ölçek | Tüm veri bellekte; token bütçesi/bölme, timeout ve kapasite sınırı yok |
| P2 | Belge/kod farkları | Claude, olay tanımı ve doğruluk iddiaları ileride güncellenmeli |

Bağımlılıklar kaynakta pandas, numpy, drain3, sentence-transformers, torch, scikit-learn, transformers ve accelerate olarak görülür. re/json/time/difflib standart kütüphanedendir. Notebook kurulumları tüm bağımlılıkları açıkça kurmaz; kayıtlı çıktılarda cachetools bağımlılık çakışması ve tekrar clone hataları vardır. README Python 3.11+ hedefler; doğrulanmış temiz kurulum matrisi yoktur.

## Sonraki uygulama için kabul ölçütleri

[ARCHITECTURE.md](ARCHITECTURE.md) kaynak hücre → modül eşlemesini ve sözleşmeleri tanımlar. İlk uygulamada algoritma parametreleri korunmalı; sabit veri/model sürümleriyle aynı template grupları, önem bayrakları, embedding satır eşleşmesi, noise korunması ve olay paketleri karşılaştırılmalıdır. LLM örneklemeli olduğu için metin eşitliği yerine şema, olay kapsamı ve kanıt denetlenmelidir.

50.000 satırda birkaç dakika hedefi mevcut incelemeyle doğrulanmış değildir. Çoklu olay veri seti, boş/uyumsuz giriş, gün değişimi ve gerçek inference kapasitesi değerlendirilmeden ürün hazır kabul edilmemelidir.
