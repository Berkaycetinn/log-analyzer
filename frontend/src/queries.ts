import { useQuery, useQueries, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from './api';
import { STATUSES, hasResult, isActive } from './domain';
import type { Job, JobStatus } from './domain';

export const keys = { jobs: ['jobs'] as const, job: (id?: string) => ['job', id] as const };
export function useJobs(page: number, size: number, status?: JobStatus) {
  return useQuery({
    queryKey: ['jobs', 'list', page, size, status],
    queryFn: ({ signal }) => api.list(page, size, status, signal),
    placeholderData: keepPreviousData, refetchInterval: 5000,
  });
}
export function useCounts() {
  return useQueries({ queries: [undefined, ...STATUSES].map(status => ({
    queryKey: ['jobs', 'count', status ?? 'ALL'],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.list(0, 1, status, signal),
    refetchInterval: 5000,
  })) });
}
export function useJob(id?: string) {
  return useQuery({
    queryKey: keys.job(id), enabled: !!id,
    queryFn: ({ signal }) => api.job(id!, signal),
    refetchInterval: query => isActive(query.state.data?.status) ? 2000 : false,
  });
}
export function useResult(job?: Job) {
  return useQuery({
    queryKey: ['result', job?.id], enabled: !!job && hasResult(job.status),
    queryFn: ({ signal }) => api.result(job!.id, signal), staleTime: Infinity,
  });
}
export function useEvents(job: Job | undefined, page: number) {
  return useQuery({
    queryKey: ['events', job?.id, page], enabled: !!job && hasResult(job.status),
    queryFn: ({ signal }) => api.events(job!.id, page, 10, signal),
    placeholderData: keepPreviousData, staleTime: Infinity,
  });
}
export function useEvent(job: Job | undefined, eventId: number | undefined) {
  return useQuery({
    queryKey: ['event', job?.id, eventId],
    enabled: !!job && hasResult(job.status) && eventId !== undefined,
    queryFn: ({ signal }) => api.event(job!.id, eventId!, signal), staleTime: Infinity,
  });
}
export function useAttempts(job?: Job) {
  return useQuery({
    queryKey: ['attempts', job?.id, job?.status, job?.attemptCount],
    enabled: !!job, queryFn: ({ signal }) => api.attempts(job!.id, signal),
    refetchInterval: job && isActive(job.status) ? 2000 : false,
  });
}
export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal), refetchInterval: 30_000, retry: false });
}
export function useJobAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (action: 'cancel' | 'retry' | 'delete'): Promise<Job | void> => await api[action](id),
    onSuccess: (job, action) => {
      if (action === 'delete') {
        client.removeQueries({ queryKey: keys.job(id) });
        for (const name of ['result', 'events', 'event', 'attempts']) client.removeQueries({ queryKey: [name, id] });
      } else if (job) client.setQueryData(keys.job(id), job);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.jobs });
      void client.invalidateQueries({ queryKey: keys.job(id) });
      void client.invalidateQueries({ queryKey: ['attempts', id] });
    },
    retry: false,
  });
}

