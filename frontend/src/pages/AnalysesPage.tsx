import { useEffect } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, CheckCheck, FileSearch, FileText, Filter, Layers3, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCounts, useJobs } from '../queries';
import { STATUSES, bytes, date, number, statusLabels } from '../domain';
import type { JobStatus } from '../domain';
import { Button, Empty, ErrorPanel, Loading, Pagination, StatusBadge } from '../components/ui';

export default function AnalysesPage() {
  const { openUpload } = useOutletContext<{ openUpload: () => void }>();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const status = STATUSES.includes(rawStatus as JobStatus) ? rawStatus as JobStatus : undefined;
  const rawPage = Number(params.get('page') ?? '0');
  const page = Number.isSafeInteger(rawPage) && rawPage >= 0 ? rawPage : 0;
  const rawSize = Number(params.get('size') ?? '20');
  const size = [10, 20, 50].includes(rawSize) ? rawSize : 20;
  const jobs = useJobs(page, size, status);
  const counts = useCounts();
  const value = (index: number) => counts[index]?.data?.totalElements;
  const sum = (a: number, b: number) => value(a) === undefined || value(b) === undefined ? undefined : value(a)! + value(b)!;
  const metrics = [
    { label: 'Toplam analiz', value: value(0), note: 'Kaydedilen tüm analizler', icon: Layers3, color: 'slate' },
    { label: 'Devam eden', value: sum(1, 2), note: 'Kuyrukta veya işleniyor', icon: Loader2, color: 'teal' },
    { label: 'Tamamlandı', value: value(3), note: 'Alıntı kontrolü geçen sonuçlar', icon: CheckCheck, color: 'green' },
    { label: 'İnceleme gerekiyor', value: sum(4, 5), note: 'Uyarılı sonuçlar ve başarısız işler', icon: TriangleAlert, color: 'amber' },
  ];
  function update(values: { page?: number; size?: number; status?: string }) {
    const next = new URLSearchParams(params);
    for (const [key, val] of Object.entries(values)) {
      if (val === '' || val === undefined || (key === 'page' && val === 0)) next.delete(key);
      else next.set(key, String(val));
    }
    setParams(next);
  }
  useEffect(() => {
    if (jobs.data && !jobs.isPlaceholderData && page > Math.max(0, Math.ceil(jobs.data.totalElements / size) - 1)) {
      const next = new URLSearchParams(params); next.delete('page'); setParams(next, { replace: true });
    }
  }, [jobs.data, jobs.isPlaceholderData, page, size, params, setParams]);
  return <>
    <div className="page-heading"><div><div className="eyebrow">GENEL BAKIŞ</div><h1>Analizler</h1><p>Log dosyalarınızı inceleyin, işleri takip edin ve olayların kaynağına ulaşın.</p></div></div>
    <section className="metrics-grid" aria-label="Analiz özeti">{metrics.map(metric => <div className="metric-card" key={metric.label}>
      <div className="metric-top"><span>{metric.label}</span><div className={'metric-icon metric-' + metric.color}><metric.icon size={18} aria-hidden="true" /></div></div>
      <strong className={metric.value === undefined ? 'metric-unknown' : ''}>{metric.value === undefined ? '—' : number(metric.value)}</strong><small>{metric.note}</small>
    </div>)}</section>
    {counts.some(query => query.isError) && <div className="subtle-notice">Özet bilgileri güncellenemedi. Son alınan değerler gösteriliyor; alınamayan değerler “—” ile belirtilir.</div>}
    <section className="panel analyses-panel" aria-labelledby="history-title">
      <div className="panel-heading"><div><h2 id="history-title">Analiz geçmişi</h2><p>Yüklediğiniz dosyalar ve güncel işlem durumları</p></div><Button variant="ghost" onClick={() => { void jobs.refetch(); counts.forEach(query => { void query.refetch(); }); }} busy={jobs.isFetching} aria-label="Analizleri yenile"><RefreshCw size={16} />Yenile</Button></div>
      <div className="table-toolbar"><label className="select-field"><Filter size={15} aria-hidden="true" /><span className="sr-only">Duruma göre filtrele</span><select aria-label="Duruma göre filtrele" value={status ?? ''} onChange={event => update({ status: event.target.value, page: 0 })}>
        <option value="">Tüm durumlar</option>{STATUSES.map(item => <option key={item} value={item}>{statusLabels[item]}</option>)}
      </select></label><label className="rows-select">Sayfa başına<select aria-label="Sayfa başına kayıt" value={size} onChange={event => update({ size: Number(event.target.value), page: 0 })}>{[10, 20, 50].map(item => <option key={item}>{item}</option>)}</select></label></div>
      {jobs.isError && <ErrorPanel error={jobs.error} retry={() => { void jobs.refetch(); }} />}
      {jobs.isPending ? <Loading label="Analizler alınıyor…" /> : jobs.data && (jobs.data.content.length === 0
        ? <Empty icon={<FileSearch size={32} />} title={status ? 'Bu durumda analiz yok' : 'İlk analizinize başlayın'} action={<Button onClick={openUpload}><FileText size={16} />{status ? 'Yeni analiz' : 'Log dosyası yükle'}</Button>}>{status ? 'Filtreyi değiştirebilir veya yeni bir log dosyası yükleyebilirsiniz.' : 'Bir log dosyası yükleyin. Oluşturulan olayları, kanıtları ve olası kök nedenleri burada inceleyin.'}</Empty>
        : <><div className="table-scroll"><table className={'data-table ' + (jobs.isPlaceholderData ? 'table-updating' : '')}><caption className="sr-only">Kaydedilmiş analizler</caption><thead><tr><th>Dosya</th><th>Durum</th><th>Boyut</th><th>Deneme</th><th>Oluşturuldu</th><th><span className="sr-only">Aç</span></th></tr></thead><tbody>{jobs.data.content.map(job => <tr key={job.id}>
          <td><div className="file-cell"><span className="table-file-icon"><FileText size={19} /></span><div><Link to={'/analyses/' + job.id} className="file-link">{job.filename}</Link><small className="mono">{job.id.slice(0, 8)}</small></div></div></td>
          <td><StatusBadge status={job.status} /></td><td className="nowrap">{bytes(job.sizeBytes)}</td><td>{job.attemptCount}</td><td className="date-cell" title={job.createdAt}>{date(job.createdAt)}</td>
          <td><Link className="row-link" to={'/analyses/' + job.id} aria-label={job.filename + ' analizini aç'}><ArrowUpRight size={18} /></Link></td>
        </tr>)}</tbody></table></div><Pagination page={page} size={size} total={jobs.data.totalElements} onPage={value => update({ page: value })} busy={jobs.isPlaceholderData} /></>)}
    </section>
    <p className="data-note">Durumlar otomatik güncellenir. Tarihler tarayıcınızın yerel saat diliminde gösterilir.</p>
  </>;
}

