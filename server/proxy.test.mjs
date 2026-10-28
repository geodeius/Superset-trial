import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { backendUrl } from '../api/proxy.mjs';
function response() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
const request = (route, extra = {}) => ({ method: 'GET', query: { route }, headers: { host: 'portal.example.test' }, ...extra });
test('backend configuration requires an HTTPS origin without credentials', () => {
  assert.equal(backendUrl(''), null);
  assert.equal(backendUrl('https://backend.example.test').origin, 'https://backend.example.test');
  for (const value of ['http://localhost:3017', 'https://user:password@example.test', 'https://example.test/private', 'https://example.test?secret=1']) assert.throws(() => backendUrl(value));
});
test('unconnected deployment exposes an honest preview and never issues guest tokens', async () => {
  const original = process.env.FOLIO_BACKEND_URL;
  delete process.env.FOLIO_BACKEND_URL;
  try {
    const session = response(); await handler(request('session'), session);
    assert.equal(session.body.backendConnected, false);
    assert.equal(session.body.client.id, 'atelier');
    const sync = response(); await handler(request('sync', { method: 'POST', headers: { host: 'portal.example.test', origin: 'https://portal.example.test' } }), sync);
    assert.equal(sync.statusCode, 503);
    const unknown = response(); await handler(request('anything/private'), unknown);
    assert.equal(unknown.statusCode, 404);
  } finally { if (original === undefined) delete process.env.FOLIO_BACKEND_URL; else process.env.FOLIO_BACKEND_URL = original; }
});
test('cross-origin writes are rejected before preview mutations', async () => {
  const result = response();
  await handler(request('client', { method: 'POST', headers: { host: 'portal.example.test', origin: 'https://other.example.test' }, body: { clientId: 'coast' } }), result);
  assert.equal(result.statusCode, 403);
});
