"""Technical context for recognizable errors in event templates.

Hints guide the model; they never replace its output or claim remediation.
"""
import re

RULES = (
    (r'AccessDeniedException|Permission denied|EACCES', {
        'signal': 'Dosya erişimi reddedildi',
        'likely_cause': 'İşlemi çalıştıran hesabın dosyayı okuma veya üst dizinleri geçme izni olmayabilir; ACL ya da bağlama politikası da erişimi engelleyebilir.',
        'intervention': 'Servis hesabını ve gerçek dosya yolunu belirleyin. Bu hesaba yalnız gereken dosya okuma ve üst dizin erişim izinlerini verin; ACL veya container bağlamasını aynı hesaba göre düzeltin. İşi yeniden çalıştırın.',
        'success_check': 'Aynı hesap dosyayı okuyabilmeli; yeniden çalıştırmada erişim reddi kaydı oluşmamalı ve içe aktarma başarılı tamamlanmalıdır. Bu görülmeden sorun çözülmüş sayılmaz.'}),
    (r'NoRouteToHostException|No route to host', {
        'signal': 'Hedefe ağ yolu yok',
        'likely_cause': 'Hedef adresi, ağ yönlendirmesi veya erişim politikası bağlantıyı engelliyor olabilir; container içindeki localhost o containerı gösterir.',
        'intervention': 'Hedefin doğru servis adresi olduğunu doğrulayın; yanlış adresi düzeltin. Kaynak ile hedef arasındaki gerekli yönlendirmeyi veya yalnız gereken port erişimini düzeltin, sonra aynı bağlantıyı yeniden deneyin.',
        'success_check': 'Kaynak servis hedef porta bağlanabilmeli ve işlem tekrarlanırken ağ yolu hatası oluşmamalıdır.'}),
    (r'Connection refused|ECONNREFUSED', {
        'signal': 'Bağlantı reddedildi',
        'likely_cause': 'Hedef servis ilgili adreste/portta dinlemiyor, yanlış adrese bağlanılıyor veya bağlantı açıkça reddediliyor olabilir.',
        'intervention': 'Doğru hedef ve portu belirleyin. Hedef servis kapalıysa başlatın; yanlış dinleme adresini veya istemci adresini düzeltin. Yalnız gerekli port erişimini sağlayıp isteği yeniden gönderin.',
        'success_check': 'Bağlantı kurulmalı ve önceki reddedilme kaydı aynı işlemde tekrar oluşmamalıdır.'}),
    (r'No space left on device|ENOSPC', {
        'signal': 'Yazma alanı tükendi',
        'likely_cause': 'İlgili dosya sisteminin boş alanı, inode sayısı veya kotası tükenmiş olabilir.',
        'intervention': 'Yazılan dosya sistemini ve dolan kaynağı belirleyin. Kalıcı verileri silmeden kotayı veya kapasiteyi artırın; yalnız gereksiz olduğu doğrulanan geçici verileri temizleyip yazmayı yeniden deneyin.',
        'success_check': 'Boş kapasite ve inode/kota yeterli olmalı; yazma işlemi alan hatası olmadan tamamlanmalıdır.'}),
    (r'FileNotFoundException|NoSuchFileException|No such file or directory|ENOENT', {
        'signal': 'Dosya yolu bulunamadı',
        'likely_cause': 'Dosya mevcut olmayabilir, yol yanlış olabilir veya çalışma ortamına bağlanmamış olabilir.',
        'intervention': 'İşlemin kullandığı gerçek yolu belirleyin. Yapılandırmadaki yanlış yolu düzeltin veya beklenen girdi dosyasını doğru konuma/bağlamaya sağlayın; ardından işi yeniden çalıştırın.',
        'success_check': 'Dosya çalışma ortamında görünmeli ve aynı girdiyle iş dosya bulunamadı hatası olmadan tamamlanmalıdır.'}),
)


def diagnostic_hints(package):
    hints = []
    for event in package['events']:
        # Context can belong to another incident: use current template examples only.
        examples = [template.get('example', '') for template in event.get('templates', [])]
        matches = [dict(hint) for pattern, hint in RULES
                   if any(re.search(pattern, text, re.IGNORECASE) for text in examples)]
        if matches:
            hints.append({'event_id': event['event_id'], 'technical_context': matches})
    return hints
