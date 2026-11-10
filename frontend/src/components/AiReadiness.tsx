import { Cpu, Loader2 } from 'lucide-react';
import { useAiStatus } from '../queries';

export function AiReadiness() {
  const query = useAiStatus();
  if (query.isPending) return null;
  const state = query.data;
  if (query.isError || !state?.available) return <div className="notice notice-warning"><strong>AI servisine ulaşılamıyor</strong><p>Bağlantı tekrar kontrol ediliyor. İşler backend’de saklanmaya devam eder.</p></div>;
  if (state.modelState === 'error') return <div className="notice notice-error"><strong>Model hazırlığı tamamlanamadı</strong><p>Docker Desktop’ta AI servisinin loglarını kontrol edin.</p></div>;
  if (!state.modelsLoaded) return <div className="notice notice-processing" role="status"><Loader2 className="spin" size={20} /><div><strong>{state.modelState === 'loading' ? 'AI modelleri hazırlanıyor' : 'AI modelleri henüz yüklenmedi'}</strong><p>İlk açılışta indirme ve model yükleme birkaç dakika sürebilir. Hazır olduğunda bu bilgi otomatik güncellenir.</p></div></div>;
  return <div className="data-note"><Cpu size={14} aria-hidden="true" /> AI modeli hazır{state.device === 'cpu' ? ' · CPU' : state.device === 'cuda' ? ' · NVIDIA GPU' : ''} · Yeni rapor açıklamaları Türkçe doğrulanır.</div>;
}
