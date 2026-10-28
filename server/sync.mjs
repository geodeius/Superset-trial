export const HOUR_MS = 60 * 60 * 1000;
export function normalizeOrder(order, clientId) {
  if (order.clientId !== clientId) throw new Error('Source returned data for a different client. No rows were imported.');
  const strings = [order.product?.name, order.product?.category, order.channel, order.region, order.customerId];
  if (strings.some(value => typeof value !== 'string' || !value.trim())) throw new Error('An order is missing required text fields.');
  if (!Number.isSafeInteger(order.orderId) || order.orderId < 1 || !Number.isSafeInteger(order.quantity) || order.quantity < 1) throw new Error('Order IDs and quantities must be positive integers.');
  if (![order.amount, order.cost].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('Order amounts must be non-negative numbers.');
  if (typeof order.orderedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(order.orderedAt) || Number.isNaN(Date.parse(order.orderedAt.replace(' ', 'T') + 'Z'))) throw new Error('An order has an invalid date.');
  return [order.orderId, clientId, order.orderedAt.replace('T', ' '), order.product.name, order.product.category, order.channel, order.region, order.amount, order.cost, order.quantity, order.customerId];
}

export async function fetchOrders(sourceUrl, clientId, fetcher = fetch) {
  const rows = [];
  const seen = new Set();
  let page = 1, revision, total;
  while (page !== null) {
    if (page > 1000) throw new Error('The source exceeded the page limit.');
    const url = new URL(sourceUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('page', page);
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Source API returned HTTP ${response.status}. Previous reporting data was retained.`);
    const body = await response.json();
    if (!Array.isArray(body.data) || body.meta?.clientId !== clientId || body.meta?.page !== page || !Number.isSafeInteger(body.meta?.total) || body.meta.total < 0 || !Number.isSafeInteger(body.meta?.revision)) throw new Error('Unexpected API response. Previous reporting data was retained.');
    if (revision === undefined) { revision = body.meta.revision; total = body.meta.total; }
    if (revision !== body.meta.revision || total !== body.meta.total) throw new Error('The source changed during pagination. Try syncing again.');
    for (const order of body.data) {
      const row = normalizeOrder(order, clientId);
      if (seen.has(row[0])) throw new Error('The source returned duplicate order IDs.');
      seen.add(row[0]); rows.push(row);
    }
    const next = body.meta.nextPage;
    if (next !== null && next !== page + 1) throw new Error('The API returned invalid pagination.');
    page = next;
  }
  if (rows.length !== total) throw new Error('The source response was incomplete. Previous reporting data was retained.');
  return { rows, revision };
}

export function createSyncManager(database, sourceUrl, clientIds, { now = () => Date.now(), fetcher = fetch } = {}) {
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec(`CREATE TABLE IF NOT EXISTS portal_sync_state (client_id TEXT PRIMARY KEY, last_success_at TEXT, last_attempt_at TEXT, last_error TEXT, rows_synced INTEGER NOT NULL DEFAULT 0, source_revision INTEGER)`);
  const pending = new Map();
  const status = clientId => {
    const row = database.prepare('SELECT * FROM portal_sync_state WHERE client_id = ?').get(clientId);
    return { clientId, running: pending.has(clientId), lastSuccessAt: row?.last_success_at || null, lastAttemptAt: row?.last_attempt_at || null, lastError: row?.last_error || null, rowsSynced: row?.rows_synced || 0, sourceRevision: row?.source_revision || null, intervalMinutes: 60, nextSyncAt: row?.last_success_at ? new Date(Date.parse(row.last_success_at) + HOUR_MS).toISOString() : null };
  };
  const sync = clientId => {
    if (!clientIds.includes(clientId)) return Promise.reject(new Error('Unknown sample client.'));
    if (pending.has(clientId)) return pending.get(clientId);
    const promise = (async () => {
      // Yield once so the pending guard is installed before network work starts.
      await Promise.resolve();
      const attempted = new Date(now()).toISOString();
      database.prepare('INSERT INTO portal_sync_state(client_id,last_attempt_at) VALUES (?,?) ON CONFLICT(client_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at').run(clientId, attempted);
      try {
        const { rows, revision } = await fetchOrders(sourceUrl, clientId, fetcher);
        database.exec('BEGIN IMMEDIATE');
        try {
          database.prepare('DELETE FROM orders WHERE client_id = ?').run(clientId);
          const insert = database.prepare('INSERT INTO orders(id,client_id,order_date,product,category,channel,region,revenue,cost,quantity,customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
          for (const row of rows) insert.run(...row);
          database.prepare('UPDATE portal_sync_state SET last_success_at=?,last_error=NULL,rows_synced=?,source_revision=? WHERE client_id=?').run(new Date(now()).toISOString(), rows.length, revision, clientId);
          database.exec('COMMIT');
        } catch (error) { database.exec('ROLLBACK'); throw error; }
        return { ...status(clientId), running: false };
      } catch (error) {
        database.prepare('UPDATE portal_sync_state SET last_error=? WHERE client_id=?').run(error.message, clientId);
        throw error;
      } finally { pending.delete(clientId); }
    })();
    pending.set(clientId, promise);
    return promise;
  };
  let timer;
  let stopped = false;
  async function tick() {
    for (const clientId of clientIds) {
      const state = status(clientId);
      if (!state.lastSuccessAt || now() >= Date.parse(state.nextSyncAt)) {
        try { await sync(clientId); } catch (error) { console.error(`Hourly sync failed for ${clientId}:`, error.message); }
      }
    }
    if (!stopped) {
      // Check at least once a minute; use the nearest hourly deadline when sooner.
      const deadlines = clientIds.map(id => { const s = status(id); return s.nextSyncAt ? Date.parse(s.nextSyncAt) - now() : 60000; });
      timer = setTimeout(tick, Math.max(1000, Math.min(60000, ...deadlines.map(ms => ms > 0 ? ms : 60000))));
      timer.unref();
    }
  }
  return { status, sync, start() { stopped = false; void tick(); }, stop() { stopped = true; clearTimeout(timer); } };
}
