import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { embedDashboard } from '@superset-ui/embedded-sdk';
import { Activity, ArrowUpRight, Bell, Building2, ChartNoAxesCombined, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Database, ExternalLink, FileChartColumn, FolderOpen, LayoutDashboard, LoaderCircle, Menu, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import './styles.css';

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Unable to complete the request. Try again.');
  return body;
}
const savedKey = 'folio-saved-dashboards';
function Dashboard({ client, csrf, revision, onReady }) {
  const mount = useRef(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let embedded;
    setError(''); setLoading(true);
    const run = async () => {
      try {
        const config = await api('/api/dashboard');
        if (cancelled) return;
        embedded = await embedDashboard({
          id: config.id, supersetDomain: config.domain, mountPoint: mount.current,
          fetchGuestToken: async () => {
            if (cancelled) throw new Error('Dashboard was closed.');
            const body = await api('/api/guest-token', { method: 'POST', headers: { 'x-csrf-token': csrf }, body: '{}' });
            return body.token;
          },
          dashboardUiConfig: { hideTitle: true, hideChartControls: false, filters: { visible: true, expanded: false } },
          iframeTitle: `${client.name} business overview`,
          referrerPolicy: 'strict-origin-when-cross-origin',
        });
        if (cancelled) { embedded.unmount(); return; }
        setLoading(false); onReady(new Date());
      } catch (e) { if (!cancelled) { setError(e.message); setLoading(false); } }
    };
    run();
    return () => { cancelled = true; embedded?.unmount(); };
  }, [client.id, csrf, revision, attempt]);
  return <div className="dashboard-shell">
    {loading && <div className="dashboard-state"><LoaderCircle className="spin" size={28}/><h3>Opening your dashboard</h3><p>Connecting securely to {client.name}’s analytics.</p><div className="skeleton-grid">{[1,2,3,4].map(i => <div key={i}/>)}</div></div>}
    {error && <div className="dashboard-state error-state"><Database size={32}/><h3>Your analytics engine needs attention</h3><p>{error}</p><button className="button primary" onClick={() => setAttempt(x => x + 1)}><RefreshCw size={15}/>Try again</button></div>}
    <div ref={mount} className={`embed ${loading || error ? 'embed-pending' : ''}`} />
  </div>;
}

function App() {
  const [session, setSession] = useState(null);
  const [fatal, setFatal] = useState('');
  const [page, setPage] = useState('Overview');
  const [clientMenu, setClientMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [revision, setRevision] = useState(0);
  const [readyAt, setReadyAt] = useState(null);
  const [syncState, setSyncState] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [syncError, setSyncError] = useState('');
  const lastDataSync = useRef(null);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState('');
  const [switching, setSwitching] = useState(false);
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem(savedKey) || '[]'); } catch { return []; } });
  const [saveName, setSaveName] = useState('Business overview');
  const [notificationsRead, setNotificationsRead] = useState(false);
  const [banner, setBanner] = useState(true);
  useEffect(() => { api('/api/session').then(setSession).catch(e => setFatal(e.message)); }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { const handler = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setModal('search'); } if (e.key === 'Escape') { setModal(null); setClientMenu(false); setMobileNav(false); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  useEffect(() => {
    if (!session?.client.id || session.backendConnected === false) return;
    let cancelled = false;
    setSyncState(null); setSyncError(''); lastDataSync.current = null;
    const poll = async () => {
      try {
        const state = await api('/api/sync/status');
        if (cancelled) return;
        if (lastDataSync.current && state.lastSuccessAt !== lastDataSync.current) setRevision(value => value + 1);
        lastDataSync.current = state.lastSuccessAt;
        setSyncState(state);
      } catch (error) { if (!cancelled) setSyncError(error.message); }
    };
    void poll();
    const timer = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [session?.client.id, session?.backendConnected]);
  const syncNow = async () => {
    setSyncing(true); setSyncError('');
    try {
      const result = await api('/api/sync', { method: 'POST', headers: { 'x-csrf-token': session.csrf }, body: '{}' });
      lastDataSync.current = result.lastSuccessAt;
      setSyncState(result); setReadyAt(null); setRevision(value => value + 1);
      setNotice(`Synced ${result.rowsSynced.toLocaleString()} orders from the API. Dashboard updated.`);
    } catch (error) { setSyncError(error.message); }
    finally { setSyncing(false); }
  };
  const simulateOrder = async () => {
    setSimulating(true);
    try {
      const result = await api('/api/source/simulate', { method: 'POST', headers: { 'x-csrf-token': session.csrf }, body: '{}' });
      setNotice(result.message);
    } catch (error) { setNotice(error.message); }
    finally { setSimulating(false); }
  };
  const openPage = name => { setPage(name); setMobileNav(false); setModal(null); };
  const switchClient = async id => {
    setClientMenu(false); if (syncing || simulating || id === session.client.id) return;
    setSwitching(true); setReadyAt(null); setSyncState(null);
    try { const result = await api('/api/client', { method: 'POST', headers: { 'x-csrf-token': session.csrf }, body: JSON.stringify({ clientId: id }) }); setSession(s => ({ ...s, client: result.client })); setPage('Overview'); }
    catch(e) { setNotice(e.message); }
    finally { setSwitching(false); }
  };
  const saveDashboard = e => { e.preventDefault(); const title = saveName.trim(); if (!title) return; const next = [...saved, { id: crypto.randomUUID(), title, clientId: session.client.id, created: new Date().toISOString() }]; setSaved(next); localStorage.setItem(savedKey, JSON.stringify(next)); setModal(null); setNotice('Dashboard shortcut saved to your library.'); };
  if (!session) return <div className="initial-state"><div className="brand-icon">f</div>{fatal ? <><h2>Unable to open the workspace</h2><p>{fatal}</p><button className="button" onClick={() => location.reload()}>Try again</button></> : <><LoaderCircle className="spin"/><p>Opening your workspace…</p></>}</div>;
  const client = session.client;
  const navigation = [{ title: 'Workspace', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Dashboards', icon: ChartNoAxesCombined }, { name: 'Saved views', icon: FolderOpen }] }, { title: 'Manage', items: [{ name: 'Data sources', icon: Database }, { name: 'Brand settings', icon: Settings2 }] }];
  const mySaved = saved.filter(s => s.clientId === client.id);
  const searchItems = ['Overview', 'Dashboards', 'Saved views', 'Data sources', 'Brand settings'].filter(s => s.toLowerCase().includes(query.toLowerCase()));
  return <div className="app" style={{ '--accent': client.color }}>
    <a className="skip-link" href="#main">Skip to main content</a>
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <a className="brand" href="/" aria-label="Folio home"><span className="brand-icon">f<span/></span><span>folio<span className="brand-dot">.</span></span><span className="brand-tag">Analytics</span></a>
      <div className="workspace-picker"><button onClick={() => setClientMenu(!clientMenu)} aria-expanded={clientMenu} className="workspace-button" disabled={syncing || simulating}><span className="client-avatar">{client.initials}</span><span className="workspace-name"><strong>{client.name}</strong><small>Client workspace</small></span><ChevronDown size={15}/></button>
        {clientMenu && <div className="client-menu"><p>Switch sample client</p>{session.clients.map(c => <button key={c.id} onClick={() => switchClient(c.id)}><span className="mini-avatar" style={{ color: c.color }}>{c.initials}</span><span>{c.name}</span>{c.id === client.id && <Check size={15}/>}</button>)}<small>Local demo · fictional data</small></div>}
      </div>
      <button className="search-button" onClick={() => { setQuery(''); setModal('search'); }}><Search size={16}/><span>Quick search</span><kbd>⌘ K</kbd></button>
      <nav aria-label="Main navigation">{navigation.map(group => <div className="nav-group" key={group.title}><p>{group.title}</p>{group.items.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${page === name ? 'active' : ''}`} onClick={() => openPage(name)} aria-current={page === name ? 'page' : undefined}><Icon size={18}/><span>{name}</span>{name === 'Dashboards' && <span className="nav-count">1</span>}{name === 'Saved views' && mySaved.length > 0 && <span className="nav-count">{mySaved.length}</span>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><Sparkles size={17}/></span><strong>Your data, your way.</strong><p>A workspace that feels like<br/>part of your business.</p><button onClick={() => setModal('help')}>Explore your workspace <ArrowUpRight size={14}/></button></div><button className="help-link" onClick={() => setModal('help')}><CircleHelp size={17}/>Help & resources<ArrowUpRight size={14}/></button><div className="profile"><div className="profile-avatar">JD</div><div><strong>Jamie Davis</strong><small>Demo administrator</small></div><span className="demo-pill">Demo</span></div></div>
    </aside>
    <div className="main-column"><header className="topbar"><div className="breadcrumbs"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20}/></button><Building2 size={15}/><span>{client.name}</span><ChevronRight size={14}/><strong>{page}</strong></div><div className="topbar-right"><span className="private-label"><ShieldCheck size={14}/>{session.backendConnected === false ? 'Hosted preview' : 'Private workspace'}</span><span className="topbar-divider"/><button className="notification-button icon-button" aria-label="View notifications" onClick={() => { setModal('notifications'); setNotificationsRead(true); }}><Bell size={19}/>{!notificationsRead && <i/>}</button><button className="top-avatar" onClick={() => setModal('profile')} aria-label="View demo profile">JD</button></div></header>
    <main id="main">{(syncError || syncState?.lastError) && <div role="alert" className="sync-error">Sync failed: {syncError || syncState.lastError} Your previous reporting data is still available. Select Sync now to retry.</div>}
      {page === 'Overview' && <>
        <div className="heading-row"><div><div className="heading-eyebrow"><span className="workspace-dot"/>Your business at a glance</div><h1>Business overview<span>.</span></h1><p className="page-description">A little clarity for your next big decision.</p></div><div className="heading-actions"><button className="button" onClick={syncNow} disabled={session.backendConnected === false || syncing || switching || syncState?.running} aria-label="Sync latest source data"><RefreshCw size={15} className={syncing || syncState?.running ? 'spin' : ''}/><span>{syncing || syncState?.running ? 'Syncing…' : 'Sync now'}</span></button><button className="button primary" onClick={() => { setSaveName('Business overview'); setModal('save'); }}><FolderOpen size={16}/>Save view</button></div></div>
        <div className="dashboard-toolbar"><div className="dashboard-tabs"><span className="selected-tab"><Activity size={16}/>Performance</span><span className="period-label">October 2026</span></div><div className="data-status"><span className={syncState?.lastSuccessAt && !syncState.lastError ? 'status-dot' : 'status-dot pending'}/>{session.backendConnected === false ? 'Backend not connected' : syncState?.lastSuccessAt ? `Data synced ${new Date(syncState.lastSuccessAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Awaiting first sync'}{session.backendConnected !== false && <span className="hourly-label">· Every hour</span>}<span className="sample-tag">Sample data</span></div></div>
        
        {banner && <div className="welcome-banner"><div className="banner-mark"><ChartNoAxesCombined size={21}/></div><div><strong>A complete picture. In your own space.</strong><p>Explore your sales, customers, and products without leaving your platform.</p></div><button className="banner-link" onClick={() => setModal('guide')}>How to explore <ArrowUpRight size={15}/></button><button className="icon-button dismiss" aria-label="Dismiss introduction" onClick={() => setBanner(false)}><X size={15}/></button></div>}
        {session.backendConnected === false ? <BackendSetup onSources={() => openPage('Data sources')}/> : switching ? <div className="dashboard-state"><LoaderCircle className="spin"/><p>Switching client workspace…</p></div> : <Dashboard key={client.id} client={client} csrf={session.csrf} revision={revision} onReady={setReadyAt}/>}
        <footer className="dashboard-footer"><span><ShieldCheck size={14}/>You’re viewing {client.name}’s workspace</span><span>Built on Apache Superset <span className="footer-dot">•</span> {session.backendConnected === false ? 'Portal preview' : 'Hosted by you'}</span></footer>
      </>}
      {page === 'Dashboards' && <><PageHeading title="Your dashboards" description="The answers you need, all in one place."/><div className="library-tools"><span>1 dashboard</span><span className="sample-tag">{client.name}</span></div><button className="dashboard-card" onClick={() => openPage('Overview')}><div className="dashboard-thumbnail"><div className="thumb-kpis"><i/><i/><i/></div><div className="thumb-chart">{[32,48,38,63,50,71,58,84,65,78,90,75].map((h,i) => <i key={i} style={{ height: `${h}%` }}/>)}</div></div><div className="dashboard-card-body"><span className="category-label">Sales & commerce</span><h2>Business overview <ArrowUpRight size={18}/></h2><p>Revenue, customer activity, and product performance.</p><div><span className="small-client">{client.initials}</span><span>{client.name}</span><span className="card-status">{session.backendConnected === false ? 'Connection required' : 'Ready to explore'}</span></div></div></button></>}
      {page === 'Saved views' && <><PageHeading title="Saved views" description="Shortcuts to the dashboards you come back to."/>{mySaved.length ? <div className="saved-list">{mySaved.map(s => <div className="saved-row" key={s.id}><span className="saved-icon"><FileChartColumn size={22}/></span><button onClick={() => openPage('Overview')}><strong>{s.title}</strong><small>Dashboard shortcut · saved {new Date(s.created).toLocaleDateString()}</small></button><button className="icon-button" aria-label={`Remove ${s.title}`} onClick={() => { const next = saved.filter(v => v.id !== s.id); setSaved(next); localStorage.setItem(savedKey, JSON.stringify(next)); setNotice('Shortcut removed. The dashboard is still available.'); }}><X size={18}/></button></div>)}</div> : <div className="empty-state"><FolderOpen size={36}/><h2>Your next visit, a little easier.</h2><p>Save a shortcut from the overview to find it here.<br/>Filter selections are managed inside the dashboard.</p><button className="button primary" onClick={() => openPage('Overview')}>Explore your dashboard <ArrowUpRight size={16}/></button></div>}</>}
      {page === 'Data sources' && session.backendConnected === false && <><PageHeading title="Data sources" description="Connect your analytics service to bring this workspace to life."/><BackendSetup/></>}
      {page === 'Data sources' && session.backendConnected !== false && <><PageHeading title="Data sources" description="Understand where the numbers come from."/><div className="source-card"><div className="source-heading"><span className="source-icon"><Database size={25}/></span><div><h2>Retail orders API</h2><p>Dummy API → reporting database → Superset</p></div><span className="sample-tag">Fictional data</span></div><dl><div><dt>Data available</dt><dd>Orders, products, customers, channels, and regions</dd></div><div><dt>Sample period</dt><dd>1 July – 28 October 2026</dd></div><div><dt>Client access</dt><dd>Server-issued tokens restrict rows to {client.name}</dd></div><div><dt>Refresh schedule</dt><dd>Every hour while the server is running, or on demand</dd></div><div><dt>Last successful sync</dt><dd>{syncState?.lastSuccessAt ? new Date(syncState.lastSuccessAt).toLocaleString() : 'Not synced yet'}</dd></div><div><dt>Next scheduled sync</dt><dd>{syncState?.nextSyncAt ? new Date(syncState.nextSyncAt).toLocaleString() : 'Starting…'}</dd></div><div><dt>Orders imported</dt><dd>{syncState?.rowsSynced?.toLocaleString() || '—'}</dd></div></dl><div className="source-note"><ShieldCheck size={17}/><p>This local endpoint returns fictional orders as paginated JSON. Add a sample order to the API, then sync to see an extra $250 and one order in the October dashboard. Simulation dates stay in October to match the demo.</p></div><div className="source-actions"><a className="button" href={`/demo-api/orders?client_id=${client.id}&page_size=3`} target="_blank" rel="noreferrer">View API response <ExternalLink size={14}/></a><button className="button" disabled={simulating || syncing || switching} onClick={simulateOrder}>{simulating ? 'Adding…' : 'Add sample order (+$250)'}</button><button className="button primary" disabled={session.backendConnected === false || syncing || switching || syncState?.running} onClick={syncNow}><RefreshCw size={14} className={syncing ? 'spin' : ''}/>{syncing ? 'Syncing…' : 'Sync now'}</button></div><a className="button" href="http://localhost:8088" target="_blank" rel="noreferrer">Open analytics administration <ExternalLink size={14}/></a></div></>}
      {page === 'Brand settings' && <><PageHeading title="Brand settings" description="A familiar home for every client’s analytics."/><div className="brand-settings"><div><h2>Workspace identity</h2><p>This local demo includes two example client brands.<br/>Switch the client in the sidebar to preview each one.</p><dl><div><dt>Workspace name</dt><dd>{client.name}</dd></div><div><dt>Industry</dt><dd>{client.industry}</dd></div><div><dt>Accent color</dt><dd><span className="color-chip"/>{client.color}</dd></div><div><dt>Currency</dt><dd>US dollars (USD)</dd></div></dl></div><div className="brand-preview"><div className="brand-preview-logo">{client.initials}</div><h3>{client.name}</h3><p>{client.description}</p><span className="button primary">Your analytics workspace</span></div></div></>}
    </main></div>
    {notice && <div className="toast" role="status"><CheckCheck size={18}/>{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15}/></button></div>}
    {modal && <Modal title={({ search: 'Find your way', save: 'Save dashboard shortcut', help: 'A workspace built around you', guide: 'Make the dashboard yours', notifications: 'Workspace updates', profile: 'Your demo profile' })[modal]} onClose={() => setModal(null)}>
      {modal === 'search' && <><div className="search-input"><Search size={18}/><input autoFocus placeholder="Search pages…" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="search-results">{searchItems.length ? searchItems.map(name => <button key={name} onClick={() => openPage(name)}><LayoutDashboard size={17}/>{name}<ChevronRight size={16}/></button>) : <p>No pages match “{query}”. Try “dashboards” or “data”.</p>}</div></>}
      {modal === 'save' && <form onSubmit={saveDashboard}><p className="modal-copy">Add this dashboard to {client.name}’s saved views on this browser. This saves a shortcut; it does not save the dashboard’s filter selections.</p><label className="field-label" htmlFor="view-name">Shortcut name</label><input id="view-name" className="text-input" autoFocus maxLength={80} required value={saveName} onChange={e => setSaveName(e.target.value)}/><div className="modal-actions"><button type="button" className="button" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={!saveName.trim()}>Save shortcut</button></div></form>}
      {(modal === 'help' || modal === 'guide') && <><p className="modal-copy">With a connected Superset backend, dashboards run inside this platform without a second login or a separate site.</p><div className="guide-items"><div><span><Settings2 size={20}/></span><div><h3>Start with your filters</h3><p>Open Filters inside the dashboard to change the date range or focus on a sales channel. Choose Apply filters to update the charts.</p></div></div><div><span><ChartNoAxesCombined size={20}/></span><div><h3>Get closer to the numbers</h3><p>Hover over charts for details. Open a chart’s menu to explore its available download options.</p></div></div><div><span><Building2 size={20}/></span><div><h3>Try another client</h3><p>Use the workspace selector to switch between Atelier Living and Coast Supply. Each receives a different, server-restricted view of the sample data.</p></div></div></div><button className="button primary" onClick={() => { setModal(null); openPage('Overview'); }}>Explore the dashboard</button></>}
      {modal === 'notifications' && <div className="notification-item"><span className="saved-icon"><CheckCheck size={21}/></span><div><h3>Your sample workspace is ready</h3><p>This prototype includes two fictional client workspaces. Live charts and data sync require a connected Superset backend.</p><small>Demo workspace</small></div></div>}
      {modal === 'profile' && <><div className="profile-summary"><div className="profile-avatar">JD</div><div><h3>Jamie Davis</h3><p>Demo administrator</p></div></div><p className="modal-copy">This is a demonstration identity, not a production login. Before launching, connect your platform’s real authentication and derive client access from each user’s account.</p><div className="source-note"><ShieldCheck size={18}/><p>Client switching is enabled only to preview the two fictional sample workspaces.</p></div></>}
    </Modal>}
  </div>;
}
function BackendSetup({ onSources }) {
  return <section className="backend-setup"><span className="source-icon"><Database size={27}/></span><span className="sample-tag">Hosted portal preview</span><h2>Your portal is ready.<br/>Connect the analytics behind it.</h2><p>The branded workspace is live on Vercel. Connect a persistent Superset backend to enable embedded dashboards, API imports, and hourly data updates.</p><div className="connection-steps"><div><strong>Superset</strong><span>Charts and dashboards</span></div><ChevronRight size={17}/><div><strong>Portal backend</strong><span>Client access and data sync</span></div><ChevronRight size={17}/><div><strong>This workspace</strong><span>Your client’s experience</span></div></div><div className="source-note"><ShieldCheck size={17}/><p>No live analytics backend is connected. Sample client navigation and saved shortcuts are available; data sync is disabled until connected.</p></div><div className="source-actions"><a className="button primary" href="https://github.com/geodeius/Superset-trial/blob/feat/embedded-client-analytics/docs/deployment.md" target="_blank" rel="noreferrer">Backend setup guide <ExternalLink size={14}/></a>{onSources && <button className="button" onClick={onSources}>View connection details</button>}</div></section>;
}
function PageHeading({ title, description }) { return <div className="heading-row"><div><h1>{title}<span>.</span></h1><p className="page-description">{description}</p></div></div>; }
function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; ref.current.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="modal-title"><div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}

createRoot(document.getElementById('root')).render(<App/>);
