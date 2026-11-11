import type { AnalysisResult } from '../domain';

export function ReportLanguageNotice({ result }: { result?: AnalysisResult }) {
  if (!result || result.validation.language === 'tr') return null;
  return <div className="notice notice-warning" role="note"><strong>Bu eski rapor Türkçe doğrulamasından geçmedi</strong><p>Model ayarları kaydedilmiş raporları değiştirmez. Sorun açıklaması ve önerileri Türkçe almak için üstteki Yeni analiz düğmesinden aynı log dosyasını yeniden yükleyin. Kaynak log alıntıları özgün dilinde korunur.</p></div>;
}
