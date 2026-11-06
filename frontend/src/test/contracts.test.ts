import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resultSchema, eventSchema, isActive, hasResult, validJobId } from '../domain';
it('accepts the shared Spring/FastAPI contract fixture including retained noise and null hypotheses', () => {
  const raw = JSON.parse(readFileSync(join(process.cwd(), '../backend/src/test/resources/ai-success.json'), 'utf8'));
  const result = resultSchema.parse(raw);
  expect(result.package.events[0].templates[0].embedding_cluster).toBe(-1);
  const analysis = result.report.events[0], source = result.package.events[0];
  const event = eventSchema.parse({ eventId: 0, start: source.start, end: source.end, rowCount: source.n_rows, severity: analysis.severity, confidence: analysis.confidence, source, analysis });
  expect(event.analysis.likely_root_cause).toBeNull(); expect(event.source.templates[0].levels).toEqual({});
});
it('only polls active jobs and only requests results for completed jobs', () => {
  expect(isActive('QUEUED')).toBe(true); expect(isActive('PROCESSING')).toBe(true); expect(isActive('FAILED')).toBe(false);
  expect(hasResult('COMPLETED_WITH_WARNINGS')).toBe(true); expect(hasResult('FAILED')).toBe(false);
  expect(validJobId('../invalid')).toBe(false);
});
