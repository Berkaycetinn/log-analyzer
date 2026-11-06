import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UploadModal } from '../components/UploadModal';
import { ToastProvider } from '../components/ui';
import { api, ApiError } from '../api';
import { job } from './fixtures';

afterEach(() => vi.restoreAllMocks());
function setup() {
  const close = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ToastProvider><Routes><Route path="/" element={<UploadModal onClose={close} />} /><Route path="/analyses/:id" element={<p>Gerçek iş sayfası</p>} /></Routes></ToastProvider></MemoryRouter></QueryClientProvider>);
  return { close, user: userEvent.setup(), file: screen.getByLabelText('Log dosyası') };
}
it('rejects empty uploads before invoking the backend', async () => {
  const upload = vi.spyOn(api, 'upload'); const { user, file } = setup();
  await user.upload(file, new File([], 'empty.log'));
  expect(screen.getByRole('alert')).toHaveTextContent('Dosya boş'); expect(screen.getByRole('button', { name: 'Analizi başlat' })).toBeDisabled(); expect(upload).not.toHaveBeenCalled();
});
it('reuses the same key after a failed upload and navigates only after server acceptance', async () => {
  const upload = vi.spyOn(api, 'upload').mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Bağlantı kesildi')).mockResolvedValueOnce(job);
  const { user, file, close } = setup();
  await user.upload(file, new File(['synthetic'], 'synthetic.log', { type: 'text/plain' }));
  await user.click(screen.getByRole('button', { name: 'Analizi başlat' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Bağlantı kesildi'); expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Analizi başlat' }));
  await screen.findByText('Gerçek iş sayfası');
  expect(upload.mock.calls[0][1]).toBe(upload.mock.calls[1][1]); expect(close).toHaveBeenCalledOnce();
});
it('closes the accessible dialog on Escape and restores focus', async () => {
  const { user, close } = setup();
  expect(screen.getByRole('dialog', { name: 'Yeni analiz' })).toHaveAttribute('aria-modal', 'true');
  await user.keyboard('{Escape}'); await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
