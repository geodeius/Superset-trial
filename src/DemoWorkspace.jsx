import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, CheckCheck, ChevronDown, Code2, Database, ExternalLink, Globe, Plug, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { demoOrders, summarizeOrders } from '../shared/demo-data.mjs';
import './demo.css';
const money = (value, decimals = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: decimals }).format(value);
async function fetchSampleOrders(clientId, signal) {
  const orders = []; let page = 1;
  while (page !== null) {
    const response = await fetch(`/api/demo/orders?client_id=${clientId}&page=${page}&page_size=500`, { signal });
    if (!response.ok) throw new Error('The sample API is unavailable. Try refreshing again.');
    const result = await response.json();
    if (!Array.isArray(result.data) || result.meta?.clientId !== clientId || result.data.some(order => order.clientId !== clientId)) throw new Error('The sample API returned unexpected data.');
    orders.push(...result.data);
    if (result.meta.nextPage !== null && result.meta.nextPage !== page + 1) throw new Error('The sample API returned invalid pagination.');
    page = result.meta.nextPage;
    if (orders.length > 100000) throw new Error('The sample API exceeded the preview limit.');
  }
  return orders;
}
const number = value => new Intl.NumberFormat('en-US').format(value);
const colors = ['#7056d8', '#37a49b', '#e7af5c'];
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The preview still works when browser storage is unavailable. */ } }

export default function DemoWorkspace({ client, revision, onStatus }) {
  const sourceKey = `folio-demo-source-${client.id}`, reportKey = `folio-demo-report-${client.id}`;
  const [snapshot, setSnapshot] = useState(() => read(reportKey, { extras: [], syncedAt: new Date().toISOString() }));
  const [extras, setExtras] = useState(() => read(sourceKey, []));
  const [month, setMonth] = useState('2026-10');
  const [channel, setChannel] = useState('All channels');
  const [message, setMessage] = useState('');
  const [sort, setSort] = useState('revenue');
  const base = useMemo(() => demoOrders(client.id), [client.id]);
  const [apiRows, setApiRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchSampleOrders(client.id, controller.signal).then(setApiRows).catch(error => { if (!controller.signal.aborted) setMessage('Sample API unavailable. Showing bundled fictional data; refresh to retry.'); });
    return () => controller.abort();
  }, [client.id]);
  const rows = useMemo(() => [...(apiRows || base), ...snapshot.extras], [base, apiRows, snapshot]);
  const summary = useMemo(() => summarizeOrders(rows, { month, channel }), [rows, month, channel]);
  const pending = extras.length - snapshot.extras.length;
  async function refresh() {
    setRefreshing(true);
    try {
    setApiRows(await fetchSampleOrders(client.id));
    const current = read(sourceKey, extras);
    const value = { extras: current, syncedAt: new Date().toISOString() };
    setExtras(current); setSnapshot(value); store(reportKey, value);
    setMessage('Sample API fetched and demo data refreshed. Your filters are unchanged.');
    } catch (error) { setMessage(error.message + ' Previous demo data was kept.'); }
    finally { setRefreshing(false); }
  }
  useEffect(() => { if (revision > 0) refresh(); }, [revision]);
  useEffect(() => { onStatus({ lastSuccessAt: snapshot.syncedAt, rowsSynced: rows.length }); }, [snapshot, rows.length, onStatus]);
  useEffect(() => {
    const tick = () => { if (Date.now() - Date.parse(read(reportKey, snapshot).syncedAt) >= 3600000) refresh(); };
    const timer = setInterval(tick, 30000);
    tick(); return () => clearInterval(timer);
  }, []);
  function addOrder() {
    const next = [...extras, { ...base[0], orderId: `demo-${crypto.randomUUID()}`, orderedAt: '2026-10-28T15:00:00Z', amount: 250, quantity: 1, customerId: `sample-${crypto.randomUUID()}` }];
    setExtras(next); store(sourceKey, next);
    setMessage('One $250 sample order added to the demo source. Refresh data to update the charts.');
  }
  function exportCsv() {
    const lines = ['Product,Category,Revenue,Orders,Units', ...summary.products.map(p => [p.name,p.category,p.revenue.toFixed(2),p.orders,p.units].map(v => `"${String(v).replaceAll('"','""')}"`).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `${client.id}-${month}-products.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const products = [...summary.products].sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : b[sort]-a[sort]);
  return <div className="demo-workspace">
    <section className="demo-canvas" aria-label={`${client.name} sample dashboard`}>
      <div className="demo-filterbar"><div><label>Period<select value={month} onChange={e => setMonth(e.target.value)}><option value="2026-10">October 2026</option><option value="2026-09">September 2026</option><option value="2026-08">August 2026</option><option value="2026-07">July 2026</option></select></label><label>Sales channel<select value={channel} onChange={e => setChannel(e.target.value)}>{['All channels','Online store','Retail','Wholesale'].map(c => <option key={c}>{c}</option>)}</select></label></div><button className="icon-button" aria-label="Export filtered product data as CSV" title="Export product data" onClick={exportCsv}><ArrowDownToLine size={17}/></button></div>
      <div className="demo-kpis">{[{name:'Total revenue',value:money(summary.revenue),note:'Across all selected orders'},{name:'Orders',value:number(summary.orders),note:'Completed purchases'},{name:'Average order',value:money(summary.average,2),note:'Revenue per purchase'},{name:'Customers',value:number(summary.customers),note:'Unique customers'}].map(item => <article className="demo-kpi" key={item.name}><h2>{item.name}</h2><strong>{item.value}</strong><span>{item.note}</span></article>)}</div>
      <div className="demo-chart-row"><article className="demo-chart-card"><div className="demo-card-title"><h2>Revenue over time</h2><span>Daily sales</span></div><RevenueChart daily={summary.daily} clientId={client.id}/></article><article className="demo-chart-card channel-card"><div className="demo-card-title"><h2>Sales channels</h2><span>Revenue share</span></div><ChannelChart channels={summary.channels} total={summary.revenue}/></article></div>
      <article className="demo-table-card"><div className="demo-card-title"><div><h2>Product performance</h2><p>What’s moving your business forward.</p></div><span>{summary.products.length} products</span></div><div className="demo-table-scroll"><table><thead><tr><th><button onClick={() => setSort('name')}>Product {sort === 'name' && '↓'}</button></th><th>Category</th><th><button onClick={() => setSort('revenue')}>Revenue {sort === 'revenue' && '↓'}</button></th><th><button onClick={() => setSort('orders')}>Orders {sort === 'orders' && '↓'}</button></th><th><button onClick={() => setSort('units')}>Units {sort === 'units' && '↓'}</button></th></tr></thead><tbody>{products.map((p,i) => <tr key={p.name}><td><span className="product-rank">{String(i+1).padStart(2,'0')}</span>{p.name}</td><td><span className="product-category">{p.category}</span></td><td className="revenue-cell">{money(p.revenue)}</td><td>{number(p.orders)}</td><td>{number(p.units)}</td></tr>)}</tbody></table></div></article>
      <div className="demo-footnote"><span className="status-dot"/><span>Interactive sample data · demo charts rendered in the portal</span></div>
    </section>
    <ApiConnection client={client} pending={pending} onAdd={addOrder} onRefresh={refresh} syncedAt={snapshot.syncedAt} message={message} refreshing={refreshing}/>
  </div>;
}
function RevenueChart({ daily, clientId }) {
  const [active, setActive] = useState(null);
  const w=560,h=222,left=54,right=14,top=19,bottom=36;
  const max = Math.max(1000, Math.ceil(Math.max(...daily.map(d => d[1]),0)/1000)*1000);
  const x = i => left + i*(w-left-right)/Math.max(daily.length-1,1);
  const y = value => h-bottom-value/max*(h-top-bottom);
  const line = daily.map((d,i) => `${i?'L':'M'} ${x(i)} ${y(d[1])}`).join(' ');
  return <div className="revenue-chart"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Daily revenue chart with ${daily.length} days. Use the product table or export for exact totals.`}>
    <defs><linearGradient id={`area-${clientId}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".18"/><stop offset="100%" stopColor="var(--accent)" stopOpacity=".01"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map(r => <g key={r}><line x1={left} x2={w-right} y1={y(max*r)} y2={y(max*r)} stroke="#eeedf5" strokeDasharray="3 4"/><text x={left-10} y={y(max*r)+4} textAnchor="end">{r===0?'$0':`$${(max*r/1000).toFixed(1).replace('.0','')}k`}</text></g>)}
    {daily.length > 0 && <><path d={`${line} L ${x(daily.length-1)} ${h-bottom} L ${left} ${h-bottom} Z`} fill={`url(#area-${clientId})`}/><path d={line} stroke="var(--accent)" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>{daily.map((d,i) => <g key={d[0]}><circle cx={x(i)} cy={y(d[1])} r={active===i?5:2.7} stroke="var(--accent)" strokeWidth="1.5" fill="white"/>{(i%7===0 || i===daily.length-1) && <text x={x(i)} y={h-10} textAnchor="middle">{d[0].slice(8)} {new Date(d[0]+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',timeZone:'UTC'})}</text>}<rect x={x(i)-8} y={top} width={16} height={h-bottom-top} fill="transparent" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}><title>{d[0]}: {money(d[1],2)}</title></rect></g>)}</>}
  </svg><p className="chart-readout" aria-live="polite">{active!==null && daily[active] ? `${daily[active][0]} · ${money(daily[active][1],2)}` : `${daily.length} days of sales activity`}</p></div>;
}
function ChannelChart({ channels, total }) {
  let offset=0;
  return <div className="channel-chart"><div className="donut-wrap"><svg viewBox="0 0 150 150" role="img" aria-label={channels.map(([name,value])=>`${name}: ${Math.round(value/total*100)}%`).join(', ')}><circle cx="75" cy="75" r="55" fill="none" stroke="#f2eff7" strokeWidth="19"/>{channels.map(([name,value],i) => { const share=total?value/total*100:0; const start=offset; offset+=share; return <circle key={name} cx="75" cy="75" r="55" fill="none" stroke={colors[i]} strokeWidth="19" pathLength="100" strokeDasharray={`${Math.max(share-.7,0)} ${100-Math.max(share-.7,0)}`} strokeDashoffset={-start} transform="rotate(-90 75 75)"><title>{name}: {money(value)}</title></circle>; })}</svg><div className="donut-center"><strong>{total? '100%' : '0%'}</strong><span>of revenue</span></div></div><div className="channel-legend">{channels.map(([name,value],i) => <div key={name}><span style={{background:colors[i]}}/><strong>{name}</strong><span>{total?Math.round(value/total*100):0}%</span></div>)}</div></div>;
}
export function ApiConnection({ client, pending=0, onAdd, onRefresh, syncedAt, message, refreshing=false }) {
  const [tab, setTab] = useState('sample');
  const [endpoint, setEndpoint] = useState(() => read(`folio-api-draft-${client.id}`, ''));
  const [saved, setSaved] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const endpointPath = `/api/demo/orders?client_id=${client.id}&page_size=3`;
  const example = demoOrders(client.id).find(o => o.orderedAt.startsWith('2026-10'));
  function save(event) { event.preventDefault(); store(`folio-api-draft-${client.id}`, endpoint); setSaved(true); }
  return <aside className="api-connection" aria-label="API connection"><div className="api-panel-heading"><span className="api-panel-icon"><Plug size={20}/></span><div><h2>API connection</h2><p>Your data starts here.</p></div><span className="api-panel-dot"/></div>
    <div className="api-tabs" role="group" aria-label="API connection mode"><button aria-pressed={tab==='sample'} className={tab==='sample'?'active':''} onClick={()=>setTab('sample')}>Sample source</button><button aria-pressed={tab==='custom'} className={tab==='custom'?'active':''} onClick={()=>setTab('custom')}>Your API</button></div>
    {tab==='sample' ? <><div className="api-source-label"><span className="api-method">GET</span><strong>Retail orders</strong><span className="sample-tag">Demo</span></div><a className="api-endpoint" href={endpointPath} target="_blank" rel="noreferrer"><code>{endpointPath}</code><ExternalLink size={13}/></a><p className="api-helper">A real JSON endpoint with fictional orders, products, and sales channels.</p>
      <button className="json-toggle" onClick={()=>setJsonOpen(!jsonOpen)} aria-expanded={jsonOpen}><Code2 size={15}/>Response preview<ChevronDown size={14} style={{transform:jsonOpen?'rotate(180deg)':undefined}}/></button>{jsonOpen && <pre className="json-preview">{JSON.stringify({data:[example],meta:{fictional:true}},null,2)}</pre>}
      <div className="api-separator"/><div className="api-schedule"><div><span>Refresh frequency</span><strong>Every hour</strong></div><p>Demo refresh runs while this page is open. You can refresh at any time.</p>{syncedAt && <div><span>Last refreshed</span><strong>{new Date(syncedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</strong></div>}</div>
      {onAdd && <div className="api-simulation"><h3>See the flow in action</h3><p>Add a fictional $250 order dated 28 October, then refresh data to update the charts. Changes stay in this browser; the public API fixture is unchanged.</p><button className="button" onClick={onAdd}><Plus size={14}/>Add sample order</button>{pending>0 && <span className="pending-import">{pending} new {pending===1?'order':'orders'} waiting to import</span>}<button className="button primary" onClick={onRefresh} disabled={refreshing}><RefreshCw size={14} className={refreshing?'spin':''}/>{refreshing?'Refreshing…':'Refresh data'}</button></div>}
      {message && <p className="api-message" role="status"><CheckCheck size={15}/>{message}</p>}
    </> : <form className="api-draft-form" onSubmit={save}><h3>Bring your own source</h3><p>Prepare an endpoint for your client’s data. Authenticated imports will run through your connected backend.</p><label htmlFor="api-endpoint">API endpoint URL</label><input id="api-endpoint" type="url" placeholder="https://api.yourcompany.com/orders" required value={endpoint} onChange={e=>{setEndpoint(e.target.value);setSaved(false);}}/><div className="draft-detail"><span>Method</span><strong>GET</strong></div><div className="draft-detail"><span>Schedule</span><strong>Hourly + manual</strong></div><button className="button primary" type="submit">{saved?<><Check size={14}/>Draft saved</>:'Save connection draft'}</button><p className="api-draft-note">This saves the URL in this browser only. It does not connect or send requests to your API. Configure credentials on the backend.</p></form>}
    <a className="api-setup-link" href="https://github.com/geodeius/Superset-trial/blob/feat/embedded-client-analytics/docs/deployment.md" target="_blank" rel="noreferrer">Connect a live Superset backend<ArrowUpRight size={13}/></a>
  </aside>;
}
