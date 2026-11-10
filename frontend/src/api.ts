import { z } from 'zod';
import { jobSchema, jobsPageSchema, resultSchema, eventsPageSchema, eventSchema, attemptsSchema, healthSchema, aiStatusSchema } from './domain';
import type { JobStatus } from './domain';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) {
    super(message); this.name = 'ApiError';
  }
}
type Options = RequestInit & { timeoutMs?: number; allowStatuses?: number[] };
async function request<T>(path: string, schema: z.ZodType<T> | undefined, options: Options = {}): Promise<T> {
  const { signal, timeoutMs = 20_000, allowStatuses = [], ...init } = options;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const response = await fetch(path, { ...init, headers, signal: controller.signal, credentials: 'same-origin' });
    if (response.status === 204 && response.ok) return undefined as T;
    let body: unknown;
    try { body = await response.json(); }
    catch {
      if (!response.ok) throw new ApiError(response.status, response.status === 413 ? 'UPLOAD_TOO_LARGE' : 'HTTP_ERROR',
        response.status >= 500 ? 'Sunucu şu anda isteği tamamlayamıyor. Lütfen yeniden deneyin.' : 'İstek reddedildi (HTTP ' + response.status + ').');
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'Sunucudan okunamayan bir yanıt geldi.');
    }
    if (!response.ok && !allowStatuses.includes(response.status)) {
      const problem = z.object({ detail: z.string().optional(), code: z.string().optional() }).passthrough().safeParse(body);
      const rawRetry = response.headers.get('Retry-After');
      const parsedRetry = rawRetry ? Number(rawRetry) : undefined;
      throw new ApiError(response.status, problem.success ? problem.data.code ?? 'HTTP_ERROR' : 'HTTP_ERROR',
        problem.success ? problem.data.detail ?? 'İstek tamamlanamadı.' : 'İstek tamamlanamadı.',
        parsedRetry !== undefined && Number.isFinite(parsedRetry) ? Math.max(0, parsedRetry) : undefined);
    }
    if (!schema) return body as T;
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ApiError(502, 'INVALID_RESPONSE', 'Sunucu yanıtı beklenen veri biçimine uymuyor.');
    return parsed.data;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT', 'İstek zaman aşımına uğradı. Lütfen yeniden deneyin.');
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamadı. Bağlantıyı kontrol edip yeniden deneyin.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
const base = '/api/v1/analyses';
const path = (id: string) => base + '/' + encodeURIComponent(id);
export const api = {
  aiStatus: (signal?: AbortSignal) => request('/api/v1/system/ai', aiStatusSchema, { signal, timeoutMs: 5000 }),
  list: (page = 0, size = 20, status?: JobStatus, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (status) params.set('status', status);
    return request(base + '?' + params, jobsPageSchema, { signal });
  },
  job: (id: string, signal?: AbortSignal) => request(path(id), jobSchema, { signal }),
  upload: (file: File, key: string) => {
    const body = new FormData(); body.append('file', file);
    return request(base, jobSchema, { method: 'POST', body, headers: { 'Idempotency-Key': key }, timeoutMs: 60_000 });
  },
  result: (id: string, signal?: AbortSignal) => request(path(id) + '/result', resultSchema, { signal }),
  events: (id: string, page = 0, size = 10, signal?: AbortSignal) =>
    request(path(id) + '/events?' + new URLSearchParams({ page: String(page), size: String(size) }), eventsPageSchema, { signal }),
  event: (id: string, eventId: number, signal?: AbortSignal) =>
    request(path(id) + '/events/' + encodeURIComponent(eventId), eventSchema, { signal }),
  attempts: (id: string, signal?: AbortSignal) => request(path(id) + '/attempts', attemptsSchema, { signal }),
  retry: (id: string) => request(path(id) + '/retry', jobSchema, { method: 'POST' }),
  cancel: (id: string) => request(path(id) + '/cancel', jobSchema, { method: 'POST' }),
  delete: (id: string) => request<void>(path(id), undefined, { method: 'DELETE' }),
  health: (signal?: AbortSignal) => request('/actuator/health', healthSchema, { signal, allowStatuses: [503], timeoutMs: 5000 }),
};
export function errorText(error: unknown) {
  if (!(error instanceof ApiError)) return 'Beklenmeyen bir hata oluştu. Lütfen yeniden deneyin.';
  const messages: Record<string, string> = {
    AI_REPORT_LANGUAGE_INVALID: 'Model Türkçe rapor üretemedi. AI model ayarlarını kontrol edin.',
    EMPTY_UPLOAD: 'Lütfen boş olmayan bir dosya seçin.',
    INVALID_ENCODING: 'Dosya UTF-8 olarak kodlanmış olmalı.',
    UPLOAD_TOO_LARGE: 'Dosya sunucunun yükleme sınırını aşıyor.',
    INVALID_FILENAME: 'Dosya adı geçersiz.',
    QUEUE_FULL: 'İş kuyruğu şu anda dolu. Biraz sonra yeniden deneyin.',
    IDEMPOTENCY_CONFLICT: 'Bu yükleme anahtarı başka bir dosya için kullanılmış. Dosyayı yeniden seçin.',
    ANALYSIS_NOT_FOUND: 'Bu analiz bulunamadı. Silinmiş olabilir.',
    EVENT_NOT_FOUND: 'Bu olay bulunamadı.',
    INVALID_STATE: 'Analizin durumu değişti. Güncel bilgiyi kontrol edip yeniden deneyin.',
    RESULT_NOT_READY: 'Analiz sonucu henüz hazır değil.',
  };
  return messages[error.code] ?? error.message;
}

