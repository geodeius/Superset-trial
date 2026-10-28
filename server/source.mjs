import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { clients } from './clients.mjs';

// A deliberately fictional API. Replace this adapter with your real source later.
export function createDummySource(file, database) {
  let source;
  if (existsSync(file)) source = JSON.parse(readFileSync(file, 'utf8'));
  else {
    source = { revision: 1, orders: database.prepare('SELECT * FROM orders ORDER BY id').all().map(row => ({
      orderId: row.id, clientId: row.client_id, orderedAt: row.order_date,
      product: { name: row.product, category: row.category }, channel: row.channel,
      region: row.region, amount: row.revenue, cost: row.cost, quantity: row.quantity,
      customerId: row.customer_id,
    })) };
    save();
  }
  function save() {
    writeFileSync(file + '.tmp', JSON.stringify(source, null, 2), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  }
  return {
    page(clientId, page = 1, pageSize = 250) {
      if (!Object.hasOwn(clients, clientId)) throw new Error('Unknown sample client.');
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('Use a positive page number and page_size between 1 and 500.');
      const orders = source.orders.filter(order => order.clientId === clientId);
      return { data: orders.slice((page - 1) * pageSize, page * pageSize), meta: { clientId, page, pageSize, total: orders.length, nextPage: page * pageSize < orders.length ? page + 1 : null, revision: source.revision, fictional: true } };
    },
    addOrder(clientId) {
      if (!Object.hasOwn(clients, clientId)) throw new Error('Unknown sample client.');
      const example = source.orders.find(order => order.clientId === clientId);
      const order = { ...example, product: { ...example.product }, orderId: Math.max(...source.orders.map(o => o.orderId)) + 1, orderedAt: '2026-10-28 15:00:00', amount: 250, cost: 125, quantity: 1, customerId: `${clientId}-simulation-${source.revision}` };
      source = { revision: source.revision + 1, orders: [...source.orders, order] };
      save();
      return { order, revision: source.revision, message: 'Added one fictional $250 order to the source API. Sync now to bring it into your dashboard.' };
    },
    revision() { return source.revision; },
  };
}
