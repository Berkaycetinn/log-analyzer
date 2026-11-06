import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileCode2 } from 'lucide-react';
import { useEvent, useJob, useResult } from '../queries';
import { hasResult, number, validJobId } from '../domain';
import type { SourceEvent } from '../domain';
import { Confidence, CopyButton, Empty, ErrorPanel, Loading, Severity } from '../components/ui';
import { ValidationNotice } from './AnalysisPage';

function TextList({ title, items }: { title: string; items: string[] }) {
  return <section className="panel prose-panel"><h2>{title}</h2>{items.length ? <ul className="text-list">{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="muted">Raporda belirtilmedi.</p>}</section>;
}
function LogLines({ title, lines }: { title: string; lines: SourceEvent['context_before'] }) {
  return <details className="panel log-details"><summary>{title}<span className="count-tag">{number(lines.length)}</span></summary>{lines.length ? <div className="table-scroll"><table className="data-table log-table"><thead><tr><th>Log zamanı</th><th>Seviye</th><th>Mesaj</th></tr></thead><tbody>{lines.map((line, i) => <tr key={i}><td className="mono nowrap">{line.time}</td><td><code>{line.level}</code></td><td><pre>{line.message}</pre></td></tr>)}</tbody></table></div> : <p className="panel-note">Bu grupta kaynak satır bulunmuyor.</p>}</details>;
}
export default function EventPage() {
  const { id, eventId } = useParams();
  const validId = validJobId(id);
  const eventNumber = eventId !== undefined && /^\d+$/.test(eventId) && Number.isSafeInteger(Number(eventId)) ? Number(eventId) : undefined;
  const job = useJob(validId ? id : undefined);
  const event = useEvent(job.data, eventNumber);
  const result = useResult(job.data);
  if (!validId || eventNumber === undefined) return <Empty title="Geçersiz olay adresi" action={<Link className="button button-secondary" to="/analyses">Analizlere dön</Link>}>Analiz veya olay kimliği geçersiz.</Empty>;
  if (job.isPending) return <Loading />;
  if (job.isError) return <ErrorPanel error={job.error} retry={() => { void job.refetch(); }} />;
  if (!hasResult(job.data.status)) return <Empty title="Bu analiz için olaylar hazır değil" action={<Link className="button button-secondary" to={'/analyses/' + id}>Analize dön</Link>}>Güncel iş durumunu analiz detayında inceleyebilirsiniz.</Empty>;
  if (event.isPending) return <Loading label="Olay kanıtları alınıyor…" />;
  if (event.isError) return <ErrorPanel error={event.error} retry={() => { void event.refetch(); }} />;
  const { analysis, source } = event.data;
  return <><Link className="back-link" to={'/analyses/' + id}><ArrowLeft size={15} />{job.data.filename}</Link><div className="page-heading"><div><div className="eyebrow">OLAY {eventNumber} · KAYNAK İNCELEMESİ</div><h1>Olay değerlendirmesi</h1><div className="heading-meta"><Severity value={analysis.severity} /><Confidence value={analysis.confidence} /><span>{number(event.data.rowCount)} kaynak satır</span></div></div></div>
    <ValidationNotice result={result.data} warning={job.data.status === 'COMPLETED_WITH_WARNINGS'} />
    <section className="panel event-summary"><div className="eyebrow">LLM DEĞERLENDİRMESİ</div><h2>{analysis.summary || 'Özet üretilmedi'}</h2><div className="summary-columns"><div><h3>Olası kök neden</h3><p className="preserve">{analysis.likely_root_cause ?? 'Raporda olası kök neden belirtilmedi.'}</p></div><div><h3>Güven değerlendirmesi</h3><p className="preserve">{analysis.confidence_reason || 'Gerekçe belirtilmedi.'}</p></div></div><p className="small muted">Bu değerlendirme bir hipotezdir. Alıntı doğrulaması kök nedenin doğruluğunu kanıtlamaz.</p></section>
    <section className="panel"><div className="panel-heading"><div><h2>Kaynak kanıtlar <span className="count-tag">{analysis.evidence.length}</span></h2><p>Raporda alıntılanan log satırları · zamanlar kaynaktaki biçimiyle gösterilir</p></div></div>{analysis.evidence.length ? <div className="evidence-list">{analysis.evidence.map((evidence, i) => <figure className="evidence" key={i}><figcaption><span className="evidence-index">{String(i + 1).padStart(2, '0')}</span><time className="mono">{evidence.time}</time><CopyButton value={evidence.quote} label={'Kanıt ' + (i + 1) + ' kopyala'} /></figcaption><pre>{evidence.quote}</pre></figure>)}</div> : <p className="panel-note">Raporda kanıt alıntısı bulunmuyor.</p>}</section>
    <div className="two-columns section-stack"><TextList title="Önerilen kontroller" items={analysis.recommended_checks} /><section className="panel prose-panel"><h2>Önerilen çözüm</h2><p className="preserve">{analysis.recommended_fix ?? 'Bir çözüm önerisi üretilmedi.'}</p><p className="muted small">Öneriyi uygulamadan önce ortamınızda doğrulayın.</p></section><TextList title="Varsayımlar" items={analysis.assumptions} /><TextList title="Alternatif açıklamalar" items={analysis.alternative_explanations} /><TextList title="Bilinmeyenler" items={analysis.unknowns} /></div>
    <section className="panel"><div className="panel-heading"><div><h2>Log şablonları <span className="count-tag">{source.templates.length}</span></h2><p><span className="mono">{source.start} → {source.end}</span></p></div><FileCode2 size={22} className="muted" /></div><div className="templates-list">{source.templates.map((template, i) => <details key={i} className="template-item"><summary><span className="template-index">{i + 1}</span><code>{template.template}</code><span className="count-tag">{number(template.count)}×</span></summary><div className="template-body"><div className="inline-tags">{Object.entries(template.levels).map(([level, count]) => <code key={level}>{level}: {number(count)}</code>)}{template.embedding_cluster !== undefined && <span className="muted small">{template.embedding_cluster === -1 ? 'Gürültü · korundu' : 'Embedding kümesi ' + template.embedding_cluster}</span>}</div><h3>Kaynak örnek</h3><pre className="log-code">{template.example}</pre>{(template.first || template.last) && <p className="mono small muted">{template.first ?? '—'} → {template.last ?? '—'}</p>}{Object.entries(template.varying_fields).map(([key, field]) => <div className="varying-field" key={key}><strong>{key}</strong><span>{number(field.unique)} farklı değer{field.min !== undefined ? ' · min ' + field.min : ''}{field.max !== undefined ? ' · max ' + field.max : ''}</span><pre>{field.example.join('\n')}</pre></div>)}</div></details>)}{!source.templates.length && <p className="panel-note">Kaynak şablon bulunmuyor.</p>}</div></section>
    <div className="section-stack context-section"><LogLines title="Olay öncesi bağlam" lines={source.context_before} /><LogLines title="Önceki satırlar" lines={source.preceding_lines} /><LogLines title="İlgili satırlar" lines={source.related_lines} /></div>
  </>;
}
