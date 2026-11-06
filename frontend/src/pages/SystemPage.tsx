import { Activity, ArrowUpRight, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { useHealth } from '../queries';
import { Button, ErrorPanel, Loading } from '../components/ui';
import { date } from '../domain';

export default function SystemPage() {
  const health = useHealth();
  return <>
    <div className="page-heading"><div><div className="eyebrow">ÇALIŞMA ALANI</div><h1>Servis durumu</h1><p>Spring Boot servisinin gerçek sağlık yanıtını kontrol edin.</p></div><Button variant="secondary" busy={health.isFetching} onClick={() => { void health.refetch(); }}><RefreshCw size={16} />Yeniden kontrol et</Button></div>
    {health.isPending && <Loading label="Servis kontrol ediliyor…" />}
    {health.isError && <ErrorPanel error={health.error} retry={() => { void health.refetch(); }} />}
    {health.data && !health.isError && <section className="panel system-panel"><div className="system-status"><span className={'system-icon ' + (health.data.status === 'UP' ? 'system-up' : 'system-down')}><Server size={28} /></span><div><h2>Uygulama ve veritabanı</h2><p>Backend genel sağlık durumu</p></div><span className={'health-value ' + (health.data.status === 'UP' ? 'health-up' : '')}>{health.data.status === 'UP' ? 'Çevrimiçi' : health.data.status}</span></div>
      <dl className="metadata-grid"><div><dt>Son başarılı yanıt</dt><dd>{date(new Date(health.dataUpdatedAt).toISOString())}</dd></div><div><dt>Kontrol uç noktası</dt><dd><a className="text-link mono" href="/actuator/health" target="_blank" rel="noreferrer">/actuator/health <ArrowUpRight size={13} /></a></dd></div></dl>
      <div className="info-note"><Activity size={18} /><p>Bu yanıt backend ve bağlı veritabanının toplu sağlık durumudur. AI servisinin veya modelin hazır olduğunu göstermez. Analiz hatalarının ayrıntıları ilgili analiz sayfasında bulunur.</p></div>
    </section>}
    <section className="panel system-scope"><ShieldCheck size={22} /><div><h2>Kaydedilmiş işler, kalıcı sonuçlar</h2><p>Analiz durumları, sonuçlar ve deneme geçmişi backend’de saklanır. İşlenmekte olan bir analiz için bu sayfayı açık tutmanız gerekmez.</p></div></section>
  </>;
}

