import { render, screen } from '@testing-library/react';
import { RemediationPlan } from '../components/RemediationPlan';

it('shows the actual intervention and the success check, without claiming execution', () => {
  render(<RemediationPlan fix="Servis hesabına gerekli okuma iznini verin." verification="İşi yeniden çalıştırın; erişim hatası olmadan tamamlanmalıdır." />);
  expect(screen.getByText('Servis hesabına gerekli okuma iznini verin.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Çözümü doğrulama' })).toBeVisible();
  expect(screen.getByText(/başarılı sonuç görülmeden hata giderilmiş sayılmaz/)).toBeVisible();
});
it('keeps older reports readable and asks for a fresh analysis', () => {
  render(<RemediationPlan fix={null} />);
  expect(screen.getByText(/Bu eski raporda çözüm planı yok/)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Çözümü doğrulama' })).not.toBeInTheDocument();
});
