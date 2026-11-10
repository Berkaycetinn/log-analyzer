import { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { Activity, ArrowUpRight, Layers3, ListChecks, Plus, Server } from 'lucide-react';
import { useHealth } from '../queries';
import { Button } from './ui';
import { UploadModal } from './UploadModal';
import { AiReadiness } from './AiReadiness';

export function Shell() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const health = useHealth();
  const online = health.data?.status === 'UP' && !health.isError;
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">İçeriğe geç</a>
    <aside className="sidebar">
      <Link className="brand" to="/analyses" aria-label="Log Analyzer ana sayfa"><span className="brand-mark"><Layers3 size={23} /></span><span>Log Analyzer<small>ANALİZ ÇALIŞMA ALANI</small></span></Link>
      <div className="nav-label">ÇALIŞMA ALANI</div>
      <nav aria-label="Ana menü">
        <NavLink to="/analyses"><ListChecks size={18} /><span>Analizler</span></NavLink>
        <NavLink to="/system"><Server size={18} /><span>Servis durumu</span></NavLink>
      </nav>
      <div className="sidebar-bottom"><div className="workspace-note"><Activity size={18} /><p>Logdan bulguya<small>Her olayın kanıtını inceleyin.</small></p></div>
        <Link to="/system" className="connection"><span className={'connection-dot ' + (online ? 'online' : health.isPending ? 'waiting' : 'offline')} />
          <span>{health.isPending ? 'Bağlantı kontrol ediliyor' : online ? 'Backend çevrimiçi' : 'Backend bağlantısını kontrol edin'}</span><ArrowUpRight size={13} /></Link>
      </div>
    </aside>
    <div className="app-content">
      <header className="topbar"><div><span className="topbar-eyebrow">LOG ANALYZER</span><span className="topbar-title">Analiz çalışma alanı</span></div>
        <Button onClick={() => setUploadOpen(true)}><Plus size={17} aria-hidden="true" />Yeni analiz</Button></header>
      <main id="main-content" tabIndex={-1}><AiReadiness /><Outlet context={{ openUpload: () => setUploadOpen(true) }} /></main>
      <footer className="app-footer"><span>Log Analyzer</span><span>Olası nedenleri, kaynak kanıtlarla birlikte değerlendirin.</span></footer>
    </div>
    {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
  </div>;
}

