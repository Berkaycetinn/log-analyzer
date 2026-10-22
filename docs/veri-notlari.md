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
