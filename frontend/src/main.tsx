import { StrictMode, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from './api';
import { Shell } from './components/Shell';
import { ToastProvider } from './components/ui';
import AnalysesPage from './pages/AnalysesPage';
import AnalysisPage from './pages/AnalysisPage';
import EventPage from './pages/EventPage';
import SystemPage from './pages/SystemPage';
import './styles.css';

const client = new QueryClient({ defaultOptions: { queries: {
  staleTime: 1000, retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
}, mutations: { retry: false } } });
class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Do not log potentially sensitive result data. */ }
  render() { return this.state.failed ? <div className="fatal-error"><h1>Görünüm yüklenemedi</h1><p>Sayfayı yenileyerek tekrar deneyin.</p><button className="button button-primary" onClick={() => window.location.reload()}>Sayfayı yenile</button></div> : this.props.children; }
}
function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => { document.title = (pathname === '/system' ? 'Servis durumu' : pathname.includes('/events/') ? 'Olay değerlendirmesi' : pathname === '/analyses' ? 'Analizler' : 'Analiz detayı') + ' · Log Analyzer'; window.scrollTo(0, 0); document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true }); }, [pathname]);
  return null;
}
createRoot(document.getElementById('root')!).render(<StrictMode><RenderBoundary><QueryClientProvider client={client}><BrowserRouter><ToastProvider><RouteEffects /><Routes><Route element={<Shell />}><Route index element={<Navigate to="/analyses" replace />} /><Route path="analyses" element={<AnalysesPage />} /><Route path="analyses/:id" element={<AnalysisPage />} /><Route path="analyses/:id/events/:eventId" element={<EventPage />} /><Route path="system" element={<SystemPage />} /><Route path="*" element={<div className="empty-state"><h1>Sayfa bulunamadı</h1><p>Bu adres mevcut bir sayfaya ait değil.</p><Link className="button button-secondary" to="/analyses">Analizlere dön</Link></div>} /></Route></Routes></ToastProvider></BrowserRouter></QueryClientProvider></RenderBoundary></StrictMode>);
