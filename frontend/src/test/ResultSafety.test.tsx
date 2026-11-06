import { render, screen } from '@testing-library/react';
import { ValidationNotice } from '../pages/AnalysisPage';
it('prominently identifies unverified evidence even before the result payload loads', () => {
  render(<ValidationNotice warning />);
  expect(screen.getByRole('note')).toHaveTextContent('Alıntı kontrolünde uyarı var');
  expect(screen.getByRole('note')).toHaveTextContent('doğrulanmış sonuç olarak değerlendirilmemeli');
});
