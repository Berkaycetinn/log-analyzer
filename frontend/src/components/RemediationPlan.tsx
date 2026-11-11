export function RemediationPlan({ fix, verification }: { fix: string | null; verification?: string | null }) {
  return <section className="panel prose-panel"><h2>Önerilen çözüm</h2>
    <p className="preserve">{fix || 'Bu eski raporda çözüm planı yok. Güncel bir öneri için dosyayı yeniden analiz edin.'}</p>
    {verification && <><h3>Çözümü doğrulama</h3><p className="preserve">{verification}</p></>}
    <p className="muted small">Bu bir müdahale önerisidir. İşlem yeniden çalıştırılıp başarılı sonuç görülmeden hata giderilmiş sayılmaz.</p>
  </section>;
}
