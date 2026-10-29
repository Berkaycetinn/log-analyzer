# Veri Notları

## Seçilen veri seti

**Loghub / Hadoop** (`Hadoop_2k.log`, 2.000 satırlık örnek)

Neden Hadoop:
- Gerçek arıza içeriyor (ağ bağlantısı kesintisi)
- Template etiketleri hazır (değerlendirme için)
- Mesajlar çeşitli (Apache'de sadece birkaç template vardı)

Yedek: Apache (pipeline'ı hızlı denemek için)

## Log formatı

```
2015-10-18 18:01:47,978 INFO [main] org.apache.hadoop...MRAppMaster: mesaj
 zaman                   seviye thread  sınıf (component)         mesaj
```

Regex ile 2.000 satırın 2.000'i parse edildi, eşleşmeyen satır yok.

## Sayılar

| Ölçü | Değer |
|---|---|
| Toplam satır | 2.000 |
| ERROR/WARN/FATAL satırı | 960 (%48) |
| Benzersiz mesaj | 734 |
| Kaba maskeyle template | 148 |
| **Gerçek template (ground truth)** | **114** |

## Gözlemler

1. **Log fırtınası.** 960 ERROR/WARN satırının 949'u sadece 3 template'te:
   - `Address change detected...` (476)
   - `Failed to renew lease...` (326)
   - `ERROR IN CONTACTING RM.` (147)

   Üçü de belirti, neden değil.

2. **Açık hata ipucu çok nadir.** `NoRouteToHostException` (ağ bağlantısı yok) sadece 2 satırda geçiyor.

3. **Zaman sırası.** Fırtına 18:05:27'de başlıyor, `NoRouteToHost` yaklaşık 1 dakika sonra (18:06:26) görünüyor. Yani ilk görülen mesaj kesin kök neden olmayabilir.

4. **Maskeleme eksikleri (kaba maskede).** `blk_...` blok ID'leri, `65020ms` gibi süreler ve eksi işaretli sayılar maskelenmedi.

5. **Ground truth çok ince ayrım yapıyor.** `E3`/`E4` (sadece `context mapreduce` / `context static` farkı) ve `E15-E20` (her durum geçişi ayrı template). Drain3 bunları birleştirebilir.

## Tasarım kararları

- En büyük küme en önemli küme olmayabilir. LLM'e büyük kümeler ve **nadir ama ciddi** template'ler ayrı ayrı verilecek.
- "İlk görülen = kök neden" varsayımı yapılmayacak. Zaman bilgisi bağlam olarak verilecek.
- Sonuç her zaman **güven seviyesiyle** sunulacak.
- HDBSCAN'in gürültü saydığı satırlar atılmayacak, ayrı "nadir olaylar" bölümünde gösterilecek.

## Açık sorular

- Drain3 kaç template çıkaracak, 114'e ne kadar yaklaşacak?
- Hangi gerçek template'ler bölünecek, hangileri birleşecek?
- ERROR/WARN template'leri (özellikle nadir olanlar) iyi çıkacak mı?
- 
## Parsing sonuçları

Drain3 (`sim_th=0.4`, depth=4, özel maskeler: ID, blok ID, IP, süre, sayı):

| Ölçü | Değer |
|---|---|
| Drain3 template | 99 (gerçek: 114) |
| Grouping Accuracy | 0.963 |
| Bölünen gerçek template | 0 |
| Birleşen küme | 5 |

Eksik 15 template'in hepsi birleşmeden kaynaklanıyor (ör. `TaskAttempt Transitioned from X to Y`, `context mapreduce/static`). Ground truth bizim ihtiyacımızdan daha ince ayrım yapıyor, bu yüzden 114'ü yakalamak hedef değil.

`sim_th` 0.3-0.5 arası sonuç değişmedi. 0.7'de template sayısı 111'e çıkıyor ama GA 0.960'a düşüyor. `0.4` seçildi.

### Seviye (INFO/ERROR) tek başına güvenilir değil

Hadoop bazı başarısızlıkları INFO seviyesinde yazıyor. `Transitioned from RUNNING to FAIL_CONTAINER_CLEANUP` gibi geçişler normal geçişlerle aynı kümeye düşüyor (küme 47: 64 satırın 6'sı başarısızlık). `NoRouteToHostException` 6 satır, ama seviye filtresiyle sadece 2'sini (ERROR) görüyorduk, 4'ü INFO.

**Karar:** Önemli olay = ERROR/WARN/FATAL seviyesi **veya** hata anahtar kelimesi (`fail`, `exception`, `timeout`, `no route`...). 2.000 satırda 975 önemli satır, 16 INFO satırı anahtar kelimeyle yakalandı (1 yanlış alarm: `maxTaskFailuresPerNode`).

### Olay zinciri (2.000 satırlık örnekte)

| Zaman | Olay |
|---|---|
| 18:05:27 | `Address change detected` ve `Failed to renew lease` fırtınası başlıyor (`msra-sa-41:9000`) |
| 18:06:01 | `ERROR IN CONTACTING RM.` başlıyor |
| 18:06:26 | `m_000002_0`: `NoRouteToHostException` (msra-sa-41:9000'e ulaşılamıyor), attempt FAILED |
| 18:06:28 | `m_000001_0`: aynı zincir |

Hem fırtına hem istisna aynı host:port'u (`msra-sa-41:9000`) anıyor. Hipotez: bu adrese bağlantı kurulamıyor. Sebep (ağ, çöken servis, güvenlik duvarı) logdan ayırt edilemiyor, beklenen LLM güveni "orta".

### Tasarım kararı

LLM'e iki bölüm verilecek: (1) boyuta göre büyük kümeler, (2) "önemli" bayrağıyla seçilmiş nadir olaylar. Zaman sırası bağlam olarak verilecek, "ilk görülen = kök neden" varsayımı yapılmayacak.

### Doğrulama

Önemli satır: 1.121 / 2.000 (%56). Önemli template: 17 / 99. Vektör: (99, 768).

**Örnek 18:10:55,202'de kesiliyor.** Fırtına mesajları hâlâ sürerken veri bitiyor. Sorunun ne zaman bittiği bilinmiyor, "sorun çözüldü" yorumu yapılmayacak.

**Lease sayacı:** `Failed to renew lease ... for N seconds` mesajı 18:05:27'de 30, 18:10:54'te 356 gösteriyor (zaman farkı 327 sn, sayaç farkı 326). Bağlantı sorunu muhtemelen ~18:04:57'de başlamış. Bu bilgi `<NUM>` maskesinin içinde kayboluyor.

### 04 kararları

1. Olay grubu = embedding kümesi + zaman penceresi örtüşmesi.
2. Maskelenen değerler (min, maks, örnek) template'le birlikte saklanacak ve LLM'e verilecek.
3. LLM'e "veri örneği şu saatte bitiyor, sonrası bilinmiyor" bilgisi açıkça verilecek.

## Kümeleme, olay grupları ve fırtına analizi

### HDBSCAN

99 template vektörü (`all-mpnet-base-v2`, 768 boyut) üzerinde, her template tek nokta.

| min_cluster_size | Küme | Gürültü (template) | Önemli ve gürültü | Karışık küme |
|---|---|---|---|---|
| 2 | 25 | 30 | 3/17 | 5 |
| 3 | 12 | 44 | 4/17 | 4 |
| 4 | 6 | 34 | 1/17 | 3 |
| 5 | 4 | 42 | 1/17 | 3 |
| 8 | 2 | 42 | 6/17 | 2 |

Sonuç parametreye kararsız (gürültü 30/44/34/42/42), 99 nokta yoğunluk tahmini için az. `min_cluster_size=2` seçildi (30 gürültü template, 348 satır), tek değere güvenilmiyor.

### Olay grupları

Önemli satırlar zamana göre gruplandı (`GAP=30 sn`). GAP 5-30 sn aynı sonucu veriyor (3 pencere), 60 sn'de tek pencere.

| Olay | Zaman | Satır | Ne var |
|---|---|---|---|
| 0 | 18:04:11 | 1 | ERROR `Container complete event for unknown container id` |
| 1 | 18:04:52 | 1 | INFO `Container killed by the ApplicationMaster` |
| 2 | 18:05:27.570 → 18:10:55.202 (327,6 sn) | 1.119 | 16 template, fırtınanın tamamı (önemli satırların %99,8'i) |

- **Olay 0:** Aynı container ID (`..._01_000012`) için 18:04:10'da `Cannot assign container ... no pending map tasks - maps.isEmpty=true`, 18:04:11'de `Received completed container`, ardından ERROR. Büyük ihtimalle zararsız (çıkarım), fırtınayla bağlantısı görünmüyor.
- **Olay 1:** `m_000003_0` attempt'i başarıyla bitmiş (SUCCEEDED 18:04:50.755), ardından normal temizlik (`KILLING`, `Container killed`). `killed` anahtar kelimesinin yanlış alarmı.
- Olay 0 ve 1, LLM için iki "yem" olay: LLM bunlara düşük önem vermeli.

### Bulgular

1. Aynı olay (olay 2) embedding'de 7 kümeye + gürültüye dağıldı: embedding tek başına olay çıkarmıyor.
2. `ERROR IN CONTACTING RM.` (147 satır) gürültü sayıldı. Gürültü atılsaydı olayın üçüncü büyük mesajı kaybolurdu.
3. Küme 6'daki 6 başarısızlık satırı template olarak önemsiz ama satır bayrağı + pencere sayesinde olaya girdi. Önemi küme değil satır bayrağı belirliyor.
4. En büyük kümeler normal olabiliyor (`Progress of TaskAttempt` 289, `Reduce slow start threshold not met` 130).
5. Maskelenen değerler geri kazanıldı: `Failed to renew lease ... for N seconds` için min 30, maks 356 (326 benzersiz değer).

### Fırtına: iki tekrar zinciri

| Zincir | Port | Mesajlar | Satır | Başlangıç |
|---|---|---|---|---|
| A | 9000 | `Address change detected` (330) + `Failed to renew lease` (326) | 656 | 18:05:27 |
| B | 8030 | `ERROR IN CONTACTING RM` (147) + `Address change detected` (146) + `Retrying connect` (146) | 439 | 18:06:01 |

- İkisi de aynı host'a (`msra-sa-41`). Port 9000 logda `Default file system [hdfs://msra-sa-41:9000]` olarak geçiyor.
- Zincir B zincir A'dan ~34 sn sonra başlıyor: "8030 daha geç koptu" mu "8030'a daha geç çağrı yapıldı" mı, logdan ayırt edilemiyor.
- Zincir B'nin üç mesajı sayıca (147/146/146) ve zamanca (18:06:01,8 → 02,8 → 03,9) bağlı.
- `Retrying connect` sayacı 146 satırın hepsinde 0 (`maxRetries=10, sleepTime=1000 ms`). "Denemeler tükendi" iddiası logdan çıkarılamaz.
- Lease sayacı: 18:05:27.570'te 30, 18:10:54.202'de 356 (zaman farkı 327 sn, sayaç farkı 326). Geri sayılırsa 18:04:57,57. Sayacın "ilk başarısızlıktan itibaren" saydığı varsayımı doğrulanmadı.
- Fırtına sabit tempolu: 3,5 satır/sn (zincir A 2/sn + zincir B 1,5/sn).

### Aktivite (dakika bazında)

| Dakika | Normal | Bayraklı |
|---|---|---|
| 18:01 | 157 | 0 |
| 18:02 | 188 | 0 |
| 18:03 | 232 | 0 |
| 18:04 | 266 | 2 |
| 18:05 | 2 | 71 |
| 18:06 | 34 | 226 |
| 18:07 | 0 | 210 |
| 18:08 | 0 | 210 |
| 18:09 | 0 | 210 |
| 18:10 (55 sn) | 0 | 192 |

- 18:07'den örnek sonuna kadar log'da fırtına dışında satır yok. "İş durmuş" değil, "log'da iş ilerlemesi görünmüyor" olarak yorumlanacak.
- 18:06'daki 34 normal satırın 18'i `m_000001_0` ve `m_000002_0` raporları, 16'sı 18:06:26-29 arası başarısızlık işleme satırları.
- `getResources()` satırları seyrek (12 satır, 18:01:54-18:04:52), sinyal olarak kullanılamaz.

### Fırtına öncesi

- 18:05:02.818 → 18:05:27.570 arası **24,8 sn** log'da hiç satır yok (tüm örneğin en uzun sessizliği, normal rapor aralığı 3-4 sn).
- Fırtına başladıktan sonraki ilk normal satır 18:06:03.028 (35,5 sn boyunca fırtına dışında satır yok).
- İş logu fırtınanın görünen ilk mesajından önce sessizleşiyor: fırtınanın ilk mesajı ilk belirti olmayabilir.

### Attempt analizi

Progress raporu veren 10 map attempt:

| Sonuç | Attempt | Son rapor |
|---|---|---|
| SUCCEEDED | `m_000003_0` | 18:04:49.9 (1,0) |
| Örnek içinde sonuç yok (7) | `m_000000_0`, `m_000004_0` ... `m_000009_0` | 18:04:54.7 - 18:04:57.4 |
| FAILED, NoRouteToHost (2) | `m_000001_0` (18:06:28.2), `m_000002_0` (18:06:26.0) | |

- 7 attempt'in son raporları 2,75 sn içinde (18:04:54.7 → 18:04:57.4), ilerleme %35-76. Sonrası örnekte yok (~6 dk, ne başarı ne başarısızlık).
- `m_000001_0` ve `m_000002_0` 18:05:02.8'e kadar raporladı, ~60 sn rapor boşluğu (→ 18:06:03/06), sonra ~3,1 sn aralıkla devam, 18:06:26-28'de FAILED.
- İki attempt'in fırtına sırasındaki son değeri 11 rapor boyunca aynı (~86-88 sn). Aynı attempt'ler fırtınadan önce de ~25 sn aynı değerde kaldı (basamaklı ilerleme), yani sabit değer tek başına işaret değil.
- "Hepsi aynı anda sustu" denemez: 7 attempt ile 2 attempt farklı davranıyor, nedeni logdan söylenemez.
- Log ApplicationMaster tarafından yazılmış, görev tarafı logları yok.

### Anahtar kelime listesi

`KILLING` listede yok (listede `killed` var). 18:04:50'deki `KILLING` (`m_000003_0`) başarıyla biten attempt'in normal temizliği, liste değiştirilmedi.

### Sınırlar

- Örnek tek gerçek olay içeriyor, olay gruplama bu veriyle değerlendirilemez (tam Hadoop ya da başka veri setinde sınanacak).
- Örnek 18:10:55,202'de kesiliyor, olayın bitip bitmediği bilinmiyor.
- HDBSCAN sonucu parametreye kararsız.

### Kararlar

- Gürültü atılmıyor, önemli olanlar olaya dahil.
- Önemi küme değil satır bayrağı (seviye veya anahtar kelime) belirliyor.
- Olay öncesi 120 sn içindeki önemli satırlar `context_before`, olay öncesi 5 ham satır `preceding_lines`, küçük olaylar için aynı container/attempt ID'li satırlar `related_lines` olarak ekleniyor. İlişki iddia edilmiyor.
- LLM'e template yanında ham örnek satır, maskelenen alanların aralıkları, dakika bazında aktivite ve "örnek `sample_end` anında kesiliyor" notu verilecek.

### LLM paketi (`events.json`, ~4.070 token)

3 olay + `activity_per_minute` + `pre_storm_facts` (attempt tablosu, en uzun sessizlik, ilk normal satır). `pre_storm_facts` yorumsuz olgular içerir, sebep iddiası içermez.
