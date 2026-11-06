import { z } from 'zod';

export const STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED'] as const;
export const statusSchema = z.enum(STATUSES);
export type JobStatus = z.infer<typeof statusSchema>;
export const statusLabels: Record<JobStatus, string> = {
  QUEUED: 'Kuyrukta', PROCESSING: 'İşleniyor', COMPLETED: 'Tamamlandı',
  COMPLETED_WITH_WARNINGS: 'Uyarıyla tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi',
};
export const isActive = (status?: JobStatus) => status === 'QUEUED' || status === 'PROCESSING';
export const hasResult = (status?: JobStatus) => status === 'COMPLETED' || status === 'COMPLETED_WITH_WARNINGS';

export const jobSchema = z.object({
  id: z.string().uuid(), filename: z.string(), contentType: z.string(), sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(), status: statusSchema, attemptCount: z.number().int().nonnegative(),
  cycleAttempts: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string(),
  startedAt: z.string().nullish(), finishedAt: z.string().nullish(), nextAttemptAt: z.string().nullish(),
  errorCode: z.string().nullish(), errorMessage: z.string().nullish(), upstreamStatus: z.number().nullish(),
});
export type Job = z.infer<typeof jobSchema>;
export const pageSchema = <T extends z.ZodType>(item: T) => z.object({
  content: z.array(item), page: z.number().int(), size: z.number().int().positive(), totalElements: z.number().int().nonnegative(),
});
export const jobsPageSchema = pageSchema(jobSchema);
export type JobsPage = z.infer<typeof jobsPageSchema>;

const evidenceSchema = z.object({ time: z.string(), quote: z.string() });
export const analysisSchema = z.object({
  event_id: z.number().int().nonnegative(), summary: z.string(),
  severity: z.enum(['none', 'low', 'medium', 'high']),
  likely_root_cause: z.string().nullable(), confidence: z.enum(['low', 'medium', 'high']),
  confidence_reason: z.string(), evidence: z.array(evidenceSchema), assumptions: z.array(z.string()),
  alternative_explanations: z.array(z.string()), unknowns: z.array(z.string()),
  recommended_checks: z.array(z.string()), recommended_fix: z.string().nullable(),
}).passthrough();
export type EventAnalysis = z.infer<typeof analysisSchema>;
const fieldSchema = z.object({ unique: z.number(), example: z.array(z.string()), min: z.number().optional(), max: z.number().optional() });
export const templateSchema = z.object({
  template: z.string(), example: z.string(), count: z.number(),
  first: z.string().optional(), last: z.string().optional(),
  levels: z.record(z.string(), z.number()).default({}),
  varying_fields: z.record(z.string(), fieldSchema).default({}), embedding_cluster: z.number().optional(),
}).passthrough();
const logLineSchema = z.object({ time: z.string(), level: z.string(), message: z.string() });
export const sourceEventSchema = z.object({
  event_id: z.number().int(), start: z.string(), end: z.string(), n_rows: z.number().int(),
  templates: z.array(templateSchema), context_before: z.array(logLineSchema).default([]),
  preceding_lines: z.array(logLineSchema).default([]), related_lines: z.array(logLineSchema).default([]),
}).passthrough();
export type SourceEvent = z.infer<typeof sourceEventSchema>;
export const eventSchema = z.object({
  eventId: z.number().int(), start: z.string(), end: z.string(), rowCount: z.number().int(),
  severity: z.enum(['none', 'low', 'medium', 'high']), confidence: z.enum(['low', 'medium', 'high']),
  source: sourceEventSchema, analysis: analysisSchema,
});
export type AnalysisEvent = z.infer<typeof eventSchema>;
export const eventsPageSchema = pageSchema(eventSchema);

export const resultSchema = z.object({
  run_id: z.string(),
  stats: z.object({
    matched_lines: z.number(), unmatched_lines: z.number(), templates: z.number(),
    important_lines: z.number(), noise_templates: z.number(), clusters: z.number(),
  }).passthrough(),
  package: z.object({
    sample_start: z.string(), sample_end: z.string(), n_rows_total: z.number(), note: z.string(),
    events: z.array(sourceEventSchema),
    activity_per_minute: z.record(z.string(), z.object({ normal: z.number(), flagged: z.number() })).optional(),
  }).passthrough(),
  report: z.object({ events: z.array(analysisSchema), cross_event_notes: z.string() }).passthrough(),
  validation: z.object({ valid: z.boolean(), errors: z.array(z.string()), note: z.string().optional() }).passthrough(),
}).passthrough();
export type AnalysisResult = z.infer<typeof resultSchema>;
export const attemptsSchema = z.array(z.object({
  attemptNo: z.number(), startedAt: z.string(), finishedAt: z.string().nullish(),
  outcome: z.string().nullish(), errorCode: z.string().nullish(),
  errorMessage: z.string().nullish(), upstreamStatus: z.number().nullish(),
}));
export type Attempt = z.infer<typeof attemptsSchema>[number];
export const healthSchema = z.object({ status: z.string() }).passthrough();

export const number = (value: number) => new Intl.NumberFormat('tr-TR').format(value);
export function bytes(value: number) {
  if (value < 1000) return value + ' B';
  if (value < 1_000_000) return (value / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' KB';
  return (value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' MB';
}
export function date(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(parsed);
}
export function elapsed(start?: string | null, end?: string | null) {
  if (!start) return 'Henüz başlamadı';
  const seconds = Math.max(0, Math.floor(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return seconds + ' sn';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' dk ' + seconds % 60 + ' sn';
  return Math.floor(seconds / 3600) + ' sa ' + Math.floor((seconds % 3600) / 60) + ' dk';
}
export const validJobId = (id?: string) => !!id && z.string().uuid().safeParse(id).success;

