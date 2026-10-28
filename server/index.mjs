import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createDummySource } from './source.mjs';
import { createSyncManager } from './sync.mjs';
import { createServer as createViteServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { clients, guestPayload } from './clients.mjs';
import { demoPage } from '../shared/demo-data.mjs';

const app = express();
const port = Number(process.env.PORT || 3017);
const origin = process.env.PORTAL_ORIGIN || `http://localhost:${port}`;
const localOrigin = `http://localhost:${port}`;
const backendHost = process.env.BACKEND_PUBLIC_URL ? new URL(process.env.BACKEND_PUBLIC_URL).hostname : null;
const supersetUrl = process.env.SUPERSET_URL || 'http://localhost:8088';
let config;
try { config = JSON.parse(await readFile(new URL('../.local/portal.json', import.meta.url), 'utf8')); } catch { config = {}; }
const sessions = new Map();
const reportingDb = new DatabaseSync(new URL('../.local/retail.db', import.meta.url));
const dummySource = createDummySource(new URL('../.local/dummy-orders.json', import.meta.url).pathname, reportingDb);
const syncManager = createSyncManager(reportingDb, `${localOrigin}/demo-api/orders`, Object.keys(clients));
app.get('/demo-api/orders', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(dummySource.page(String(req.query.client_id || 'atelier'), Number(req.query.page || 1), Number(req.query.page_size || 250))); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.use(express.json({ limit: '4kb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['localhost', '127.0.0.1', '[::1]', backendHost].filter(Boolean).includes(req.hostname)) return res.status(403).json({ error: 'This sample runs on localhost only.' });
  if (backendHost && req.hostname === backendHost) {
    const actual = Buffer.from(req.headers['x-folio-proxy-secret'] || '');
    const expected = Buffer.from(process.env.FOLIO_PROXY_SECRET || '');
    if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(403).json({ error: 'Backend proxy authentication is required.' });
  }
  if (req.method !== 'GET' && req.headers.origin !== origin) return res.status(403).json({ error: 'Request origin is not allowed.' });
  next();
});
app.get('/api/demo/orders', (req, res) => {
  try { res.json(demoPage(String(req.query.client_id || 'atelier'), Number(req.query.page || 1), Number(req.query.page_size || 250))); }
  catch(error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/session', (req, res) => {
  const cookie = req.headers.cookie?.match(/(?:^|; )folio_session=([a-f0-9]+)/)?.[1];
  let session = cookie && sessions.get(cookie);
  if (!session) {
    const id = randomBytes(24).toString('hex');
    session = { clientId: 'atelier', csrf: randomBytes(24).toString('hex') };
    sessions.set(id, session);
    res.cookie('folio_session', id, { httpOnly: true, sameSite: 'strict', secure: origin.startsWith('https:'), maxAge: 8 * 60 * 60 * 1000 });
  }
  res.json({ client: clients[session.clientId], clients: Object.values(clients), csrf: session.csrf, demo: true });
});
app.use('/api', (req, res, next) => {
  const id = req.headers.cookie?.match(/(?:^|; )folio_session=([a-f0-9]+)/)?.[1];
  req.session = id && sessions.get(id);
  if (!req.session) return res.status(401).json({ error: 'Refresh the page to start a local demo session.' });
  if (req.method !== 'GET') {
    const actual = Buffer.from(req.headers['x-csrf-token'] || '');
    const expected = Buffer.from(req.session.csrf);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(403).json({ error: 'Refresh the page and try again.' });
  }
  next();
});
app.post('/api/client', (req, res) => {
  if (!Object.hasOwn(clients, req.body.clientId)) return res.status(400).json({ error: 'Choose a sample client from the list.' });
  req.session.clientId = req.body.clientId;
  res.json({ client: clients[req.session.clientId] });
});
app.get('/api/sync/status', (req, res) => res.json({ ...syncManager.status(req.session.clientId), sourceRevision: dummySource.revision() }));
app.post('/api/sync', async (req, res) => {
  try { res.json(await syncManager.sync(req.session.clientId)); }
  catch (error) { res.status(502).json({ error: error.message }); }
});
app.post('/api/source/simulate', (req, res) => res.json(dummySource.addOrder(req.session.clientId)));
app.get('/api/dashboard', async (req, res) => {
  if (!config.dashboardId) return res.status(503).json({ error: 'The analytics engine is not initialized. Run npm run setup to prepare the local dashboard.' });
  try {
    const health = await fetch(`${supersetUrl}/health`, { signal: AbortSignal.timeout(15000) });
    if (!health.ok) throw new Error('unavailable');
    res.json({ id: config.dashboardId, domain: supersetUrl, client: clients[req.session.clientId] });
  } catch { res.status(503).json({ error: 'The analytics engine is offline. Run npm run superset, then select Try again.' }); }
});
app.post('/api/guest-token', async (req, res) => {
  const client = clients[req.session.clientId];
  if (!config.dashboardId) return res.status(503).json({ error: 'Dashboard setup is incomplete.' });
  try {
    const login = await fetch(`${supersetUrl}/api/v1/security/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: config.serviceUsername, password: config.servicePassword, provider: 'db', refresh: false }), signal: AbortSignal.timeout(10000) });
    if (!login.ok) throw new Error('service login');
    const { access_token } = await login.json();
    const csrfResponse = await fetch(`${supersetUrl}/api/v1/security/csrf_token/`, { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10000) });
    if (!csrfResponse.ok) throw new Error('Superset CSRF handshake');
    const supersetCsrf = (await csrfResponse.json()).result;
    const cookies = csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const response = await fetch(`${supersetUrl}/api/v1/security/guest_token/`, { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json', 'X-CSRFToken': supersetCsrf, Cookie: cookies }, body: JSON.stringify(guestPayload(client, config.dashboardId)), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('token grant');
    res.json({ token: (await response.json()).token });
  } catch (error) { console.error('Embedding request failed:', error.message); res.status(502).json({ error: 'Unable to open the dashboard. Check the analytics engine and try again.' }); }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));
if (process.env.NODE_ENV === 'production') app.use(express.static('dist'));
else { const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
const server = app.listen(port, '127.0.0.1', () => { console.log(`Folio local demo: ${origin}`); syncManager.start(); });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { syncManager.stop(); server.close(() => { reportingDb.close(); process.exit(0); }); });
