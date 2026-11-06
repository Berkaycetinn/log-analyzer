import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const sample = [
  '2020-01-01 00:00:00,000 ERROR [main] example.Network: Connection failed: java.net.NoRouteToHostException: No route to host 127.0.0.1:9000',
  '2020-01-01 00:00:01,000 WARN [main] example.Lease: Failed to renew lease for 30 seconds. Will retry shortly',
  '2020-01-01 00:00:02,000 ERROR [main] example.RM: ERROR IN CONTACTING RM.',
  '2020-01-01 00:00:03,000 ERROR [main] example.Network: Connection failed: java.net.NoRouteToHostException: No route to host 127.0.0.1:9000',
].join('\n') + '\n';
async function upload(page: Page, name: string, text: string) {
  await page.getByRole('button', { name: 'Yeni analiz', exact: true }).click();
  await page.getByLabel('Log dosyası', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Analizi başlat' }).click();
  await expect(page).toHaveURL(/\/analyses\/[\da-f-]{36}$/);
  return page.url().split('/').at(-1)!;
}
test('real upload → durable job → inference → events, evidence, JSON, history and deletion', async ({ page, request }) => {
  test.setTimeout(1_200_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/analyses');
  await expect(page.getByRole('heading', { name: 'Analizler', exact: true })).toBeVisible();
  const id = await upload(page, 'synthetic-browser.log', sample);
  await expect.poll(async () => (await (await request.get('/api/v1/analyses/' + id)).json()).status, { timeout: 900_000, intervals: [1000, 2000] }).toMatch(/^(COMPLETED|COMPLETED_WITH_WARNINGS|FAILED|CANCELLED)$/);
  expect((await (await request.get('/api/v1/analyses/' + id)).json()).status).toMatch(/^COMPLETED/);
  await expect(page.getByRole('heading', { name: /Tespit edilen olaylar/ })).toBeVisible();
  await page.reload();
  const result = await (await request.get('/api/v1/analyses/' + id + '/result')).json();
  expect(result.stats.matched_lines).toBe(4);
  const event = result.report.events[0]; expect(event).toBeTruthy();
  await page.locator('.event-card').first().click();
  await expect(page.getByRole('heading', { name: 'Kaynak kanıtlar' })).toBeVisible();
  await expect(page.locator('.evidence pre').first()).toHaveText(event.evidence[0].quote);
  await page.locator('.template-item summary').first().click();
  await expect(page.getByText('Kaynak örnek', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: process.env.VISUAL_OUTPUT ? process.env.VISUAL_OUTPUT + '/event-desktop.png' : 'test-results/event-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: process.env.VISUAL_OUTPUT ? process.env.VISUAL_OUTPUT + '/event-mobile.png' : 'test-results/event-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/analyses/' + id + '?tab=overview');
  await expect(page.getByRole('heading', { name: 'İşleme özeti' })).toBeVisible();
  await page.getByRole('button', { name: 'Denemeler', exact: true }).click();
  await expect(page.getByText(/^SUCCEEDED(?:_WITH_WARNINGS)?$/)).toBeVisible();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'JSON indir' }).click();
  expect((await downloaded).suggestedFilename()).toBe('analysis-' + id + '.json');
  await page.goto('/analyses'); await page.screenshot({ path: process.env.VISUAL_OUTPUT ? process.env.VISUAL_OUTPUT + '/analyses-desktop.png' : 'test-results/analyses-desktop.png', fullPage: true });
  await page.getByLabel('Duruma göre filtrele').selectOption('COMPLETED');
  await expect(page).toHaveURL(/status=COMPLETED/);
  await page.goto('/analyses/' + id);
  await page.getByRole('button', { name: 'Sil', exact: true }).click();
  await page.getByRole('button', { name: 'Analizi sil', exact: true }).click();
  await expect(page).toHaveURL(/\/analyses$/);
  expect((await request.get('/api/v1/analyses/' + id)).status()).toBe(404);
  expect(errors).toEqual([]);
});
test('failed input exposes real attempt errors and supports retry', async ({ page, request }) => {
  await page.goto('/analyses');
  const id = await upload(page, 'synthetic-unmatched.log', 'synthetic unparseable input\n');
  await expect.poll(async () => (await (await request.get('/api/v1/analyses/' + id)).json()).status).toBe('FAILED');
  await expect(page.getByRole('button', { name: 'Yeniden dene', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Yeniden dene', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/v1/analyses/' + id)).json()).attemptCount).toBe(2);
  await expect.poll(async () => (await (await request.get('/api/v1/analyses/' + id)).json()).status).toBe('FAILED');
  await page.getByRole('button', { name: 'Denemeler', exact: true }).click();
  await expect(page.locator('.attempt-list > li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Sil', exact: true }).click(); await page.getByRole('button', { name: 'Analizi sil', exact: true }).click();
  await expect(page).toHaveURL(/\/analyses$/);
});
test('cancel, retry and delete through real Spring endpoints', async ({ page, request }) => {
  await page.goto('/analyses');
  // A unique synthetic queued upload can be cancelled before or after the worker claims it.
  const id = await upload(page, 'synthetic-cancel.log', sample);
  await page.getByRole('button', { name: 'İptal et', exact: true }).click();
  await page.getByRole('button', { name: 'Analizi iptal et', exact: true }).click();
  await expect(page.getByText('Bu analiz iptal edildi', { exact: true })).toBeVisible();
  expect((await (await request.get('/api/v1/analyses/' + id)).json()).status).toBe('CANCELLED');
  await page.getByRole('button', { name: 'Yeniden dene', exact: true }).click();
  await expect(page.getByRole('button', { name: 'İptal et', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'İptal et', exact: true }).click(); await page.getByRole('button', { name: 'Analizi iptal et', exact: true }).click();
  await page.getByRole('button', { name: 'Sil', exact: true }).click(); await page.getByRole('button', { name: 'Analizi sil', exact: true }).click();
  await expect(page).toHaveURL(/\/analyses$/);
  expect((await request.get('/api/v1/analyses/' + id)).status()).toBe(404);
});
test('health page and invalid routes are accessible', async ({ page }) => {
  await page.goto('/system'); await expect(page.getByText('Çevrimiçi', { exact: true })).toBeVisible();
  await page.goto('/analyses/invalid'); await expect(page.getByRole('heading', { name: 'Geçersiz analiz adresi' })).toBeVisible();
  await page.goto('/unknown'); await expect(page.getByRole('heading', { name: 'Sayfa bulunamadı' })).toBeVisible();
});
test('real filtered pagination and responsive list', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    for (let i = 0; i < 12; i++) {
      const uploaded = await request.post('/api/v1/analyses', { multipart: { file: { name: 'synthetic-page-' + i + '.log', mimeType: 'text/plain', buffer: Buffer.from(sample) } } });
      expect(uploaded.status()).toBe(202); const { id } = await uploaded.json(); ids.push(id);
      expect((await request.post('/api/v1/analyses/' + id + '/cancel')).status()).toBe(200);
    }
    await page.goto('/analyses?status=CANCELLED&size=10');
    await expect(page.locator('.data-table tbody tr')).toHaveCount(10);
    await page.getByRole('button', { name: 'Sonraki sayfa' }).click();
    await expect(page).toHaveURL(/page=1/); await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1 && !element.closest('.table-scroll')).slice(0, 8).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })) }));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: JSON.stringify(overflow) }).toBe(true);
    await page.getByRole('button', { name: 'Yeni analiz', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  } finally { for (const id of ids) await request.delete('/api/v1/analyses/' + id); }
});
test('network failure remains an error rather than an empty success', async ({ page }) => {
  await page.route('**/api/v1/analyses?**', route => route.abort('connectionfailed'));
  await page.goto('/analyses');
  await expect(page.getByRole('alert').first()).toContainText('Sunucuya ulaşılamadı');
  await expect(page.getByText('İlk analizinize başlayın', { exact: true })).not.toBeVisible();
});
