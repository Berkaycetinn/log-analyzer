import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, Copy, Loader2, Minus, X, XCircle } from 'lucide-react';
import type { JobStatus } from '../domain';
import { statusLabels, number } from '../domain';
import { errorText } from '../api';

export function Button({ variant = 'primary', busy = false, children, className = '', disabled, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }) {
  return <button className={'button button-' + variant + ' ' + className} disabled={disabled || busy} {...props}>
    {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}{children}
  </button>;
}
export function StatusBadge({ status }: { status: JobStatus }) {
  const Icon = status === 'QUEUED' ? Clock3 : status === 'PROCESSING' ? Loader2 :
    status === 'COMPLETED' ? CheckCircle2 : status === 'COMPLETED_WITH_WARNINGS' ? AlertCircle :
    status === 'FAILED' ? XCircle : Minus;
  return <span className={'status status-' + status.toLowerCase()}><Icon size={13} aria-hidden="true" className={status === 'PROCESSING' ? 'spin' : ''} />{statusLabels[status]}</span>;
}
const severityLabels = { none: 'Etki yok', low: 'Düşük etki', medium: 'Orta etki', high: 'Yüksek etki' };
export function Severity({ value }: { value: keyof typeof severityLabels }) {
  return <span className={'severity severity-' + value}><Circle size={8} fill="currentColor" aria-hidden="true" />{severityLabels[value]}</span>;
}
export function Confidence({ value }: { value: 'low' | 'medium' | 'high' }) {
  return <span className={'confidence confidence-' + value}>{({ low: 'Düşük', medium: 'Orta', high: 'Yüksek' })[value]} güven</span>;
}
export function ErrorPanel({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="error-panel" role="alert"><AlertCircle size={20} aria-hidden="true" /><div><strong>Bilgi alınamadı</strong><p>{errorText(error)}</p>{retry && <Button variant="secondary" onClick={retry}>Tekrar dene</Button>}</div></div>;
}
export function Loading({ label = 'Yükleniyor…' }: { label?: string }) {
  return <div className="loading-state" role="status"><Loader2 size={22} className="spin" aria-hidden="true" /><span>{label}</span></div>;
}
export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{children}</p>{action}</div>;
}
export function Pagination({ page, size, total, onPage, busy = false }: { page: number; size: number; total: number; onPage: (page: number) => void; busy?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <nav className="pagination" aria-label="Sayfalama">
    <span>{total === 0 ? 'Kayıt yok' : number(Math.min(page * size + 1, total)) + '–' + number(Math.min((page + 1) * size, total)) + ' / ' + number(total) + ' kayıt'}</span>
    <div><Button variant="ghost" aria-label="Önceki sayfa" disabled={page === 0 || busy} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></Button>
      <span>{page + 1} / {pages}</span>
      <Button variant="ghost" aria-label="Sonraki sayfa" disabled={page + 1 >= pages || busy} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></Button></div>
  </nav>;
}
export function Modal({ title, children, onClose, busy = false, wide = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const blocked = useRef(busy); blocked.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current)?.focus());
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !blocked.current) { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]'))
        .filter(item => item.getClientRects().length > 0 && !item.hasAttribute('hidden'));
      if (!items.length) { event.preventDefault(); ref.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === ref.current)) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={'modal ' + (wide ? 'modal-wide' : '')}>
      <header><h2 id={titleId}>{title}</h2><Button variant="ghost" aria-label="Pencereyi kapat" disabled={busy} onClick={onClose}><X size={18} /></Button></header>{children}
    </div>
  </div>;
}
type Toast = { id: number; message: string; kind: 'success' | 'error' };
const ToastContext = createContext<((message: string, kind?: Toast['kind']) => void) | undefined>(undefined);
function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: () => void }) {
  useEffect(() => { if (toast.kind === 'error') return; const timer = setTimeout(dismiss, 7000); return () => clearTimeout(timer); }, [toast.kind, dismiss]);
  return <div className={'toast toast-' + toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}>
    {toast.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
    <span>{toast.message}</span><button onClick={dismiss} aria-label="Bildirimi kapat"><X size={16} /></button>
  </div>;
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const add = (message: string, kind: Toast['kind'] = 'success') => setToasts(old => [...old.slice(-3), { id: ++nextId.current, message, kind }]);
  return <ToastContext.Provider value={add}>{children}<div className="toast-stack">{toasts.map(toast =>
    <ToastItem key={toast.id} toast={toast} dismiss={() => setToasts(old => old.filter(item => item.id !== toast.id))} />)}</div></ToastContext.Provider>;
}
export function useToast() { const value = useContext(ToastContext); if (!value) throw new Error('ToastProvider required'); return value; }
export function CopyButton({ value, label = 'Kopyala' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(timer); }, [copied]);
  return <button className="icon-button" aria-label={label} title={label} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); }
    catch { toast('Panoya kopyalanamadı. Metni seçerek kopyalayabilirsiniz.', 'error'); }
  }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>;
}

