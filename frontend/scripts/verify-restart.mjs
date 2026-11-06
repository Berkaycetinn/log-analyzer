// Run after restarting Spring Boot against the same isolated test database.
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
if (!process.env.E2E_RECEIPT) throw new Error('Set E2E_RECEIPT to the synthetic browser receipt before checking a restart.');
const receipt = JSON.parse(await readFile(process.env.E2E_RECEIPT, 'utf8'));
const base = new URL(process.env.FRONTEND_URL ?? 'http://127.0.0.1:5173');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/analyses/' + receipt.job_id, base).href);
  await expect(page.getByRole('heading', { name: 'synthetic-browser.log', exact: true })).toBeVisible();
  await expect(page.locator('.event-card')).toHaveCount(receipt.event_count);
  await page.locator('.event-card').first().click();
  await expect(page.getByRole('heading', { name: 'Kaynak kanıtlar' })).toBeVisible();
  await expect(page.locator('.evidence')).toHaveCount(receipt.evidence_count);
  expect(errors).toEqual([]);
  // This check deliberately serves the built assets, not Vite's development runtime.
  const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));
  expect(scripts.some(src => src?.startsWith('/assets/'))).toBe(true);
  expect(scripts.some(src => src?.includes('/src/main.tsx'))).toBe(false);
  console.log(JSON.stringify({ frontend_after_restart: 'passed', production_bundle: 'passed' }));
} finally {
  await browser.close();
}
