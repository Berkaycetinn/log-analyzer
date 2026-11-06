import type { Job } from '../domain';
export const job: Job = {
  id: '123e4567-e89b-42d3-a456-426614174000', filename: 'synthetic.log', contentType: 'text/plain',
  sizeBytes: 123, sha256: 'a'.repeat(64), status: 'QUEUED', attemptCount: 0, cycleAttempts: 0,
  createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z',
};
