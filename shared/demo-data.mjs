const catalogs = {
  atelier: [['Arc lounge chair','Furniture',340],['Forma side table','Furniture',180],['Linen cushion','Textiles',48],['Studio ceramic vase','Decor',65],['Oak desk lamp','Lighting',120],['Woven throw','Textiles',85]],
  coast: [['Trail daypack','Bags',110],['Coastal shell jacket','Clothing',165],['Insulated flask','Accessories',38],['Summit hiking boots','Footwear',190],['Canvas weekend bag','Bags',145],['Merino trail socks','Clothing',24]],
};
export function demoOrders(clientId) {
  if (!Object.hasOwn(catalogs, clientId)) throw new Error('Choose a known sample client.');
  let seed = clientId === 'atelier' ? 44 : 91;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const result = [];
  for (let day = 0; day < 120; day++) {
    const date = new Date(Date.UTC(2026, 6, 1 + day)).toISOString().slice(0,10);
    const count = Math.floor(random() * 12) + (clientId === 'atelier' ? 14 : 9);
    for (let i = 0; i < count; i++) {
      const [name, category, price] = catalogs[clientId][Math.floor(random()*6)];
      const quantity = random() > .76 ? 2 : 1;
      const amount = Math.round(price * quantity * (.92 + random() * .2) * 100) / 100;
      const r = random();
      result.push({ orderId: `${clientId}-${day}-${i}`, clientId, orderedAt: `${date}T12:00:00Z`, product: { name, category }, channel: r < .62 ? 'Online store' : r < .89 ? 'Retail' : 'Wholesale', region: ['Greater Accra','Ashanti','Western','Central'][Math.floor(random()*4)], amount, quantity, customerId: `${clientId}-customer-${Math.floor(random()*500)}` });
    }
  }
  return result;
}
export function summarizeOrders(orders, { month = '2026-10', channel = 'All channels' } = {}) {
  const filtered = orders.filter(order => order.orderedAt.startsWith(month) && (channel === 'All channels' || order.channel === channel));
  const daily = new Map(), channels = new Map(), products = new Map();
  let revenue = 0;
  for (const order of filtered) {
    revenue += order.amount;
    const date = order.orderedAt.slice(0,10);
    daily.set(date, (daily.get(date) || 0) + order.amount);
    channels.set(order.channel, (channels.get(order.channel) || 0) + order.amount);
    const product = products.get(order.product.name) || { name: order.product.name, category: order.product.category, revenue: 0, orders: 0, units: 0 };
    product.revenue += order.amount; product.orders++; product.units += order.quantity;
    products.set(product.name, product);
  }
  return { revenue, orders: filtered.length, customers: new Set(filtered.map(o => o.customerId)).size, average: filtered.length ? revenue / filtered.length : 0, daily: [...daily].sort(([a],[b]) => a.localeCompare(b)), channels: [...channels].sort((a,b) => b[1]-a[1]), products: [...products.values()].sort((a,b) => b.revenue-a.revenue) };
}
export function demoPage(clientId, page = 1, pageSize = 250) {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error('Use a positive page and a page_size from 1 to 500.');
  const orders = demoOrders(clientId);
  return { data: orders.slice((page-1)*pageSize, page*pageSize), meta: { clientId, page, pageSize, total: orders.length, nextPage: page*pageSize < orders.length ? page+1 : null, fictional: true, mode: 'public-demo', revision: 1 } };
}
