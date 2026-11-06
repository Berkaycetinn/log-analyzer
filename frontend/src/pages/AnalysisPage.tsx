import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Clock3, Download, FileText, RefreshCw, Trash2, X } from 'lucide-react';
import { useAttempts, useEvents, useJob, useJobAction, useResult } from '../queries';
import { bytes, date, elapsed, hasResult, isActive, number, validJobId } from '../domain';
import type { AnalysisResult, Job } from '../domain';
import { errorText } from '../api';
import { Button, Confidence, CopyButton, Empty, ErrorPanel, Loading, Modal, Pagination, Severity, StatusBadge, useToast } from '../components/ui';

export function ValidationNotice({ result, warning = false }: { result?: AnalysisResult; warning?: boolean }) {
  if (!warning && result?.validation.valid !== false) return null;
  return <div className="notice notice-warning" role="note"><strong>Alıntı kontrolünde uyarı var</strong><p>Bu rapordaki kanıtları kaynak loglarla karşılaştırın. Bulgular doğrulanmış sonuç olarak değerlendirilmemeli.</p>
    {!!result?.validation.errors.length && <details><summary>Kontrol ayrıntıları ({result.validation.errors.length})</summary><ul>{result.validation.errors.map((error, i) => <li key={i}>{error}</li>)}</ul></details>}</div>;
}
function ResultOverview({ result }: { result: AnalysisResult }) {
  const stats = [ ['Eşleşen satır', result.stats.matched_lines], ['Eşleşmeyen satır', result.stats.unmatched_lines], ['Şablon', result.stats.templates], ['Önemli satır', result.stats.important_lines], ['Küme', result.stats.clusters], ['Gürültü şablonu', result.stats.noise_templates] ] as const;
  const activity = Object.entries(result.package.activity_per_minute ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...activity.map(([, row]) => row.normal + row.flagged));
  return <div className="section-stack"><section className="panel"><div className="panel-heading"><div><h2>İşleme özeti</h2><p>Parser ve kümeleme aşamalarından alınan gerçek sayımlar</p></div></div><div className="stats-grid">{stats.map(([label, value]) => <div key={label}><strong>{number(value)}</strong><span>{label}</span></div>)}</div>
    <dl className="metadata metadata-inline"><div><dt>Örnek başlangıcı</dt><dd className="mono">{result.package.sample_start || '—'}</dd></div><div><dt>Örnek sonu</dt><dd className="mono">{result.package.sample_end || '—'}</dd></div><div><dt>Toplam satır</dt><dd>{number(result.package.n_rows_total)}</dd></div></dl>
    {result.package.note && <p className="panel-note">{result.package.note}</p>}</section>
    <section className="panel prose-panel"><h2>Olaylar arası değerlendirme</h2><p className="preserve">{result.report.cross_event_notes || 'Olaylar arası not üretilmedi.'}</p><p className="muted small">LLM değerlendirmesi olası nedenleri sunar. Alıntı kontrolü, neden-sonuç ilişkisinin doğruluğunu kanıtlamaz.</p></section>
    {activity.length > 0 && <section className="panel"><div className="panel-heading"><div><h2>Dakikalık log aktivitesi</h2><p>Kaynak log zamanları · saat dilimi dönüştürülmez</p></div><div className="chart-legend"><span>Normal</span><span>İşaretli</span></div></div><div className="activity-chart">{activity.map(([time, row]) => <div className="activity-row" key={time}><span className="mono">{time}</span><div className="activity-track" aria-label={time + ': ' + row.normal + ' normal, ' + row.flagged + ' işaretli'}><i style={{ width: row.normal / max * 100 + '%' }} /><b style={{ width: row.flagged / max * 100 + '%' }} /></div><span>{number(row.normal)} / {number(row.flagged)}</span></div>)}</div></section>}
  </div>;
}
function Events({ job }: { job: Job }) {
  const [page, setPage] = useState(0);
  const events = useEvents(job, page);
  if (events.isPending) return <Loading label="Olaylar alınıyor…" />;
  if (events.isError) return <ErrorPanel error={events.error} retry={() => { void events.refetch(); }} />;
  return <section className="panel"><div className="panel-heading"><div><h2>Tespit edilen olaylar <span className="count-tag">{number(events.data.totalElements)}</span></h2><p>Özet, etki düzeyi ve kaynak kanıtları</p></div></div>{!events.data.content.length ? <Empty icon={<FileText size={28} />} title="Olay tespit edilmedi">İşleme tamamlandı; bu örnekte raporlanacak bir olay bulunamadı.</Empty> : <><div className="event-list">{events.data.content.map(event => <Link className="event-card" key={event.eventId} to={'/analyses/' + job.id + '/events/' + event.eventId}>
    <div className="event-card-top"><span className="event-number">OLAY {event.eventId}</span><div><Severity value={event.severity} /><Confidence value={event.confidence} /></div><ArrowUpRight size={18} /></div><h3>{event.analysis.summary || 'Özet üretilmedi'}</h3><div className="event-card-bottom"><span className="mono">{event.start} → {event.end}</span><span>{number(event.rowCount)} satır · {event.analysis.evidence.length} kanıt</span></div>
  </Link>)}</div><Pagination page={page} size={10} total={events.data.totalElements} onPage={setPage} busy={events.isPlaceholderData} /></>}</section>;
}
function Attempts({ job }: { job: Job }) {
  const attempts = useAttempts(job);
  if (attempts.isPending) return <Loading label="Denemeler alınıyor…" />;
  if (attempts.isError) return <ErrorPanel error={attempts.error} retry={() => { void attempts.refetch(); }} />;
  return <section className="panel"><div className="panel-heading"><div><h2>İşleme geçmişi</h2><p>Backend tarafından kaydedilen tüm denemeler</p></div></div>{!attempts.data.length ? <Empty icon={<Clock3 size={28} />} title="Henüz deneme yok">İş kuyruğundan alındığında ilk deneme burada görünecek.</Empty> : <ol className="attempt-list">{attempts.data.map(attempt => <li key={attempt.attemptNo}><span className="attempt-index">{attempt.attemptNo}</span><div><div className="attempt-heading"><strong>Deneme {attempt.attemptNo}</strong><code>{attempt.outcome ?? 'Devam ediyor'}</code></div><p>{date(attempt.startedAt)} → {attempt.finishedAt ? date(attempt.finishedAt) : 'Devam ediyor'} <span className="muted"> · {elapsed(attempt.startedAt, attempt.finishedAt)}</span></p>{attempt.errorCode && <div className="notice notice-error"><strong>{attempt.errorCode}</strong><p>{attempt.errorMessage}</p>{attempt.upstreamStatus != null && <small>AI servisi HTTP {attempt.upstreamStatus}</small>}</div>}</div></li>)}</ol>}</section>;
}
function RawResult({ result, id }: { result: AnalysisResult; id: string }) {
  const text = JSON.stringify(result, null, 2);
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'analysis-' + id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel"><div className="panel-heading"><div><h2>JSON raporu</h2><p>API’den alınan rapor · yerel indirilen dosya hassas veri içerebilir</p></div><Button variant="secondary" onClick={download}><Download size={16} />JSON indir</Button></div><pre className="raw-json">{text}</pre></section>;
}
export default function AnalysisPage() {
  const { id } = useParams();
  const valid = validJobId(id);
  const job = useJob(valid ? id : undefined);
  const result = useResult(job.data);
  const action = useJobAction(id ?? '');
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | undefined>();
  const [params, setParams] = useSearchParams();
  const tab = ['events', 'overview', 'attempts', 'json'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'events';
  const navigate = useNavigate(); const toast = useToast();
  async function execute(kind: 'cancel' | 'retry' | 'delete') {
    try { await action.mutateAsync(kind); setConfirm(undefined); toast(kind === 'delete' ? 'Analiz silindi.' : kind === 'retry' ? 'Analiz yeniden kuyruğa alındı.' : 'Analiz iptal edildi.'); if (kind === 'delete') navigate('/analyses'); }
    catch (error) { toast(errorText(error), 'error'); }
  }
  if (!valid) return <Empty title="Geçersiz analiz adresi" action={<Link className="button button-secondary" to="/analyses">Analizlere dön</Link>}>Analiz kimliği geçerli bir UUID olmalı.</Empty>;
  if (job.isPending) return <Loading label="Analiz alınıyor…" />;
  if (job.isError) return <ErrorPanel error={job.error} retry={() => { void job.refetch(); }} />;
  const data = job.data;
  const active = isActive(data.status), ready = hasResult(data.status);
  return <><Link to="/analyses" className="back-link"><ArrowLeft size={15} />Analizlere dön</Link><div className="page-heading detail-heading"><div><div className="eyebrow">ANALİZ DETAYI</div><h1 className="filename-title">{data.filename}</h1><div className="heading-meta"><StatusBadge status={data.status} /><span>{bytes(data.sizeBytes)}</span><span>{date(data.createdAt)}</span></div></div><div className="action-group">
    <Button variant="ghost" aria-label="Analizi yenile" onClick={() => { void job.refetch(); if (ready) void result.refetch(); }} busy={job.isFetching}><RefreshCw size={16} /></Button>
    {active && <Button variant="secondary" onClick={() => setConfirm('cancel')}><X size={16} />İptal et</Button>}
    {['FAILED', 'CANCELLED'].includes(data.status) && <Button onClick={() => { void execute('retry'); }} busy={action.isPending}><RefreshCw size={16} />Yeniden dene</Button>}
    {!active && <Button variant="ghost" className="danger-text" onClick={() => setConfirm('delete')}><Trash2 size={16} />Sil</Button>}
  </div></div>
  {active && <div className="notice notice-processing" role="status"><Clock3 size={22} /><div><strong>{data.status === 'QUEUED' ? 'Analiz sırada bekliyor' : 'Loglar analiz ediliyor'}</strong><p>{data.status === 'QUEUED' ? 'Worker hazır olduğunda işlem başlayacak.' : 'Ayrıştırma, kümeleme ve LLM değerlendirmesi tamamlandığında sonuçlar burada görünecek.'} Durum otomatik güncellenir.</p>{data.nextAttemptAt && <small>Sonraki deneme: {date(data.nextAttemptAt)}</small>}</div></div>}
  {data.errorCode && <div className="notice notice-error"><strong>{data.errorCode}</strong><p>{data.errorMessage}</p>{data.upstreamStatus != null && <small>AI servisi HTTP {data.upstreamStatus}</small>}</div>}
  {data.status === 'CANCELLED' && <div className="notice"><strong>Bu analiz iptal edildi</strong><p>Varsa devam eden AI isteğinin sonucu kaydedilmez. Yeni bir deneme başlatabilirsiniz.</p></div>}
  <ValidationNotice result={result.data} warning={data.status === 'COMPLETED_WITH_WARNINGS'} />
  <div className="detail-layout"><div className="detail-main"><nav className="tabs" aria-label="Analiz bölümleri">{([['events', 'Olaylar'], ['overview', 'Genel bakış'], ['attempts', 'Denemeler'], ['json', 'JSON']] as const).map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => { const next = new URLSearchParams(params); next.set('tab', key); setParams(next); }}>{label}</button>)}</nav>
    {tab === 'attempts' ? <Attempts job={data} /> : !ready ? <section className="panel"><Empty icon={<FileText size={30} />} title={active ? 'Sonuç bekleniyor' : 'Kayıtlı sonuç yok'}>{active ? 'İşleme tamamlandığında olaylar ve kanıtlar otomatik olarak yüklenecek.' : 'Bu durumdaki analiz için rapor bulunmuyor. Denemeler bölümünde işleme geçmişini inceleyebilirsiniz.'}</Empty></section> : tab === 'events' ? <Events job={data} /> : result.isPending ? <Loading label="Rapor alınıyor…" /> : result.isError ? <ErrorPanel error={result.error} retry={() => { void result.refetch(); }} /> : result.data && (tab === 'overview' ? <ResultOverview result={result.data} /> : <RawResult result={result.data} id={data.id} />)}
  </div><aside className="panel metadata-panel"><h2>Dosya bilgileri</h2><dl className="metadata"><div><dt>Analiz kimliği <CopyButton value={data.id} label="Analiz kimliğini kopyala" /></dt><dd className="mono break-all">{data.id}</dd></div><div><dt>Oluşturuldu</dt><dd>{date(data.createdAt)}</dd></div><div><dt>Başladı</dt><dd>{date(data.startedAt)}</dd></div><div><dt>Tamamlandı</dt><dd>{date(data.finishedAt)}</dd></div><div><dt>İşleme süresi</dt><dd>{elapsed(data.startedAt, data.finishedAt)}</dd></div><div><dt>Toplam deneme</dt><dd>{data.attemptCount}</dd></div><div><dt>Bu çevrimdeki deneme</dt><dd>{data.cycleAttempts}</dd></div><div><dt>İçerik türü</dt><dd className="mono">{data.contentType}</dd></div><div><dt>SHA-256 <CopyButton value={data.sha256} label="SHA-256 kopyala" /></dt><dd className="mono break-all small">{data.sha256}</dd></div></dl></aside></div>
  {confirm && <Modal title={confirm === 'delete' ? 'Analiz silinsin mi?' : 'Analiz iptal edilsin mi?'} onClose={() => setConfirm(undefined)} busy={action.isPending}><div className="modal-body"><p><strong>{data.filename}</strong></p><p>{confirm === 'delete' ? 'Yüklenen dosya, sonuçlar ve deneme geçmişi kalıcı olarak silinecek. Bu işlem geri alınamaz.' : 'İş iptal edilecek. Başlamış bir Python isteği durdurulmaz; geç gelen sonuç kaydedilmez.'}</p>{action.isError && <p className="field-error" role="alert">{errorText(action.error)}</p>}</div><footer className="modal-footer"><Button variant="secondary" disabled={action.isPending} onClick={() => setConfirm(undefined)}>Vazgeç</Button><Button variant="danger" busy={action.isPending} onClick={() => { void execute(confirm); }}>{confirm === 'delete' ? 'Analizi sil' : 'Analizi iptal et'}</Button></footer></Modal>}
  </>;
}
