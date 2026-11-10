import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiReadiness } from '../components/AiReadiness';
import { api } from '../api';
afterEach(() => vi.restoreAllMocks());
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AiReadiness /></QueryClientProvider>); }
it('does not mistake live AI process for loaded models', async () => {
  vi.spyOn(api, 'aiStatus').mockResolvedValue({ available: true, modelsLoaded: false, modelState: 'loading', device: 'cpu' });
  mount(); expect(await screen.findByText('AI modelleri hazırlanıyor')).toBeVisible();
  expect(screen.queryByText(/AI modeli hazır ·/)).not.toBeInTheDocument();
});
it('shows real readiness once models have loaded', async () => {
  vi.spyOn(api, 'aiStatus').mockResolvedValue({ available: true, modelsLoaded: true, modelState: 'ready', device: 'cpu' });
  mount(); expect(await screen.findByText(/AI modeli hazır · CPU/)).toBeVisible();
});
