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

