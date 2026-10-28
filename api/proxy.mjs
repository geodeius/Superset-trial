import { clients } from '../server/clients.mjs';
import { demoPage } from '../shared/demo-data.mjs';

const readRoutes = new Set(['session', 'sync/status', 'dashboard', 'demo/orders']);
const writeRoutes = new Set(['client', 'sync', 'source/simulate', 'guest-token']);
export function backendUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('FOLIO_BACKEND_URL must be an HTTPS origin.');
  return url;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const route = String(req.query?.route || '');
  const method = req.method || 'GET';
  if (!(method === 'GET' && readRoutes.has(route)) && !(method === 'POST' && writeRoutes.has(route))) return res.status(404).json({ error: 'Unknown endpoint.' });
  // Block cross-origin writes before forwarding any cookies or service secrets.
  if (method === 'POST') {
    const origin = req.headers.origin;
    let requestHost;
    try { requestHost = new URL(origin).host; } catch { return res.status(403).json({ error: 'Request origin is not allowed.' }); }
    if (requestHost !== req.headers.host) return res.status(403).json({ error: 'Request origin is not allowed.' });
  }
  if (route === 'demo/orders') {
    try { return res.json(demoPage(String(req.query?.client_id || 'atelier'), Number(req.query?.page || 1), Number(req.query?.page_size || 250))); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  }
  let backend;
  try { backend = backendUrl(process.env.FOLIO_BACKEND_URL); }
  catch { return res.status(503).json({ error: 'The backend connection needs an HTTPS origin in the deployment settings.' }); }
  if (!backend) {
    // Public, fictional workspace navigation only. Never invent sync results or tokens.
    const id = req.headers.cookie?.match(/(?:^|;\s*)folio_preview_client=([a-z]+)/)?.[1];
    const client = Object.hasOwn(clients, id || '') ? clients[id] : clients.atelier;
    if (route === 'session') return res.json({ client, clients: Object.values(clients), demo: true, hosted: true, backendConnected: false });
    if (route === 'client') {
      if (!Object.hasOwn(clients, req.body?.clientId || '')) return res.status(400).json({ error: 'Choose a sample client from the list.' });
      res.setHeader('Set-Cookie', `folio_preview_client=${req.body.clientId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);
      return res.json({ client: clients[req.body.clientId] });
    }
    return res.status(503).json({ error: 'Connect a public analytics backend in the Vercel project settings to enable dashboards and data sync.' });
  }
  if (!process.env.FOLIO_PROXY_SECRET) return res.status(503).json({ error: 'Set the shared backend connection secret before enabling analytics.' });
  try {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Folio-Proxy-Secret': process.env.FOLIO_PROXY_SECRET };
    // Forward only this application's session cookie.
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)(folio_session=[a-f0-9]+)/)?.[1];
    if (cookie) headers.Cookie = cookie;
    if (req.headers['x-csrf-token']) headers['X-CSRF-Token'] = String(req.headers['x-csrf-token']);
    if (req.headers.origin) headers.Origin = req.headers.origin;
    const upstream = await fetch(new URL(`/api/${route}`, backend), { method, headers, redirect: 'error', signal: AbortSignal.timeout(55000), ...(method === 'POST' ? { body: JSON.stringify(req.body || {}) } : {}) });
    const body = await upstream.json();
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    if (route === 'session' && upstream.ok) Object.assign(body, { hosted: true, backendConnected: true });
    return res.status(upstream.status).json(body);
  } catch { return res.status(502).json({ error: 'Unable to reach the analytics backend. Check its URL and service status, then try again.' }); }
}
