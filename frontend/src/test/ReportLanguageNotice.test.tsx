import { render, screen } from '@testing-library/react';
import type { AnalysisResult } from '../domain';
import { ReportLanguageNotice } from '../components/ReportLanguageNotice';

it('distinguishes a historical English report from current Turkish model settings', () => {
  render(<ReportLanguageNotice result={{ validation: { valid: true, errors: [] } } as unknown as AnalysisResult} />);
  expect(screen.getByRole('note')).toHaveTextContent('Bu eski rapor Türkçe doğrulamasından geçmedi');
  expect(screen.getByRole('note')).toHaveTextContent('aynı log dosyasını yeniden yükleyin');
});
it('does not warn for a report that passed Turkish validation', () => {
  render(<ReportLanguageNotice result={{ validation: { valid: true, errors: [], language: 'tr' } } as unknown as AnalysisResult} />);
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
});
