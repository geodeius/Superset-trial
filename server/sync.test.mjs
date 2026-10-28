import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSyncManager, fetchOrders, HOUR_MS } from './sync.mjs';

const order = (id, client = 'atelier', amount = 250) => ({ orderId: id, clientId: client, orderedAt: '2026-10-28 15:00:00', product: { name: 'Chair', category: 'Furniture' }, channel: 'Online store', region: 'Greater Accra', amount, cost: 125, quantity: 1, customerId: `${client}-1` });
const paginated = (records, size = 1) => async input => {
  const url = new URL(input);
  const page = Number(url.searchParams.get('page'));
  const clientId = url.searchParams.get('client_id');
  return Response.json({ data: records.slice((page - 1) * size, page * size), meta: { clientId, page, total: records.length, revision: 1, nextPage: page * size < records.length ? page + 1 : null } });
};
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, client_id TEXT, order_date TEXT, product TEXT, category TEXT, channel TEXT, region TEXT, revenue REAL, cost REAL, quantity INTEGER, customer_id TEXT)');
  db.exec("INSERT INTO orders(id,client_id,revenue) VALUES (10,'coast',999)");
  return db;
}
test('fetches all pages and rejects incomplete, duplicate, or wrong-client data', async () => {
  assert.equal((await fetchOrders('http://example.test/orders', 'atelier', paginated([order(1), order(2)]))).rows.length, 2);
  await assert.rejects(fetchOrders('http://example.test/orders', 'atelier', paginated([order(1), order(1)])), /duplicate/);
  await assert.rejects(fetchOrders('http://example.test/orders', 'atelier', paginated([order(1, 'coast')])), /different client/);
  const incomplete = async () => Response.json({ data: [order(1)], meta: { clientId: 'atelier', page: 1, total: 2, revision: 1, nextPage: null } });
  await assert.rejects(fetchOrders('http://example.test/orders', 'atelier', incomplete), /incomplete/);
});
test('repeated syncs do not duplicate rows or touch another client; hourly deadline is persisted', async () => {
  const db = database();
  const clock = Date.parse('2026-10-28T12:00:00Z');
  const manager = createSyncManager(db, 'http://example.test/orders', ['atelier', 'coast'], { now: () => clock, fetcher: paginated([order(1), order(2)]) });
  await manager.sync('atelier');
  await manager.sync('atelier');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE client_id='atelier'").get().n, 2);
  assert.equal(db.prepare("SELECT revenue FROM orders WHERE client_id='coast'").get().revenue, 999);
  assert.equal(Date.parse(manager.status('atelier').nextSyncAt), clock + HOUR_MS);
  assert.equal(manager.status('atelier').running, false);
  db.close();
});
test('API failure or database collision retains the last successful snapshot and timestamp', async () => {
  const db = database();
  let fetcher = paginated([order(1)]);
  const manager = createSyncManager(db, 'http://example.test/orders', ['atelier'], { fetcher: (...args) => fetcher(...args) });
  const before = await manager.sync('atelier');
  fetcher = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(manager.sync('atelier'), /503/);
  assert.equal(manager.status('atelier').lastSuccessAt, before.lastSuccessAt);
  assert.equal(db.prepare("SELECT revenue FROM orders WHERE client_id='atelier'").get().revenue, 250);
  fetcher = paginated([order(10)]); // Collides with Coast's row, after the DELETE statement.
  await assert.rejects(manager.sync('atelier'), /UNIQUE/);
  assert.equal(db.prepare("SELECT revenue FROM orders WHERE client_id='atelier'").get().revenue, 250);
  assert.equal(db.prepare("SELECT revenue FROM orders WHERE client_id='coast'").get().revenue, 999);
  db.close();
});
test('concurrent manual requests share a single sync operation', async () => {
  const db = database(); let calls = 0;
  const manager = createSyncManager(db, 'http://example.test/orders', ['atelier'], { fetcher: async (...args) => { calls++; return paginated([order(1)])(...args); } });
  const first = manager.sync('atelier'), second = manager.sync('atelier');
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  db.close();
});
test('scheduler starts overdue jobs and waits a full hour after success', async () => {
  const db = database(); let clock = Date.parse('2026-10-28T12:00:00Z'), calls = 0;
  const manager = createSyncManager(db, 'http://example.test/orders', ['atelier'], { now: () => clock, fetcher: async (...args) => { calls++; return paginated([order(1)])(...args); } });
  manager.start(); await manager.sync('atelier'); manager.stop();
  assert.equal(calls, 1);
  clock += HOUR_MS - 1;
  manager.start(); await new Promise(resolve => setImmediate(resolve)); manager.stop();
  assert.equal(calls, 1, 'A recent successful sync must not run early');
  clock += 1;
  manager.start(); await manager.sync('atelier'); manager.stop();
  assert.equal(calls, 2, 'A sync must run when the one-hour deadline is reached');
  db.close();
});
