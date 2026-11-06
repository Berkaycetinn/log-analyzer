import { api, ApiError } from '../api';
import { job } from './fixtures';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function response(body: unknown, status = 200, headers?: HeadersInit) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
it('encodes list filters and validates actual paginated responses', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ content: [job], page: 2, size: 10, totalElements: 21 })); vi.stubGlobal('fetch', fetcher);
  expect((await api.list(2, 10, 'QUEUED')).content[0].id).toBe(job.id);
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/analyses?page=2&size=10&status=QUEUED');
});
it('submits multipart without overriding its boundary and preserves the idempotency key', async () => {
  const fetcher = vi.fn().mockImplementation(async () => response(job, 202)); vi.stubGlobal('fetch', fetcher);
  const file = new File(['synthetic log'], 'synthetic.log', { type: 'text/plain' });
  await api.upload(file, 'same-key'); await api.upload(file, 'same-key');
  for (const [, options] of fetcher.mock.calls) {
    expect(options.method).toBe('POST'); expect(options.headers.get('Idempotency-Key')).toBe('same-key');
    expect(options.headers.has('Content-Type')).toBe(false); expect(options.body.get('file').name).toBe('synthetic.log');
  }
});
it('keeps conflict and queue-full details without retrying mutations', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ code: 'QUEUE_FULL', detail: 'Queue full' }, 429, { 'Retry-After': '5' })); vi.stubGlobal('fetch', fetcher);
  await expect(api.retry(job.id)).rejects.toMatchObject({ status: 429, code: 'QUEUE_FULL', retryAfter: 5 }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not accept a malformed job as success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...job, status: 'FAKE' })));
  await expect(api.job(job.id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it('handles a non-JSON gateway error as a service failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
  await expect(api.job(job.id)).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
});
it('supports DELETE 204 and treats actuator DOWN as a real health response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(response({ status: 'DOWN' }, 503)));
  await expect(api.delete(job.id)).resolves.toBeUndefined(); await expect(api.health()).resolves.toEqual({ status: 'DOWN' });
});
it('distinguishes unreachable service from caller cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await expect(api.job(job.id)).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  const controller = new AbortController(); controller.abort();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
  await expect(api.job(job.id, controller.signal)).rejects.not.toBeInstanceOf(ApiError);
});
