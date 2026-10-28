import test from 'node:test';
import assert from 'node:assert/strict';
import { demoOrders, summarizeOrders, demoPage } from '../shared/demo-data.mjs';
import handler from '../api/proxy.mjs';
test('sample API pagination covers every order once and keeps clients separate', () => {
  for (const client of ['atelier','coast']) {
    const rows=[]; let page=1;
    while(page!==null) { const body=demoPage(client,page,100); rows.push(...body.data);page=body.meta.nextPage; }
    assert.deepEqual(rows,demoOrders(client));
    assert.equal(new Set(rows.map(o=>o.orderId)).size,rows.length);
    assert.ok(rows.every(o=>o.clientId===client));
  }
  assert.throws(()=>demoPage('unknown'));
  assert.throws(()=>demoPage('atelier',1,1000));
});
test('dashboard totals, channels, products, and date filters reconcile to source orders', () => {
  const rows=demoOrders('atelier');
  const october=summarizeOrders(rows);
  const raw=rows.filter(o=>o.orderedAt.startsWith('2026-10'));
  assert.equal(october.orders,raw.length);
  assert.equal(october.revenue,raw.reduce((sum,o)=>sum+o.amount,0));
  assert.ok(Math.abs(october.channels.reduce((sum,[,value])=>sum+value,0)-october.revenue)<.001);
  assert.ok(Math.abs(october.products.reduce((sum,p)=>sum+p.revenue,0)-october.revenue)<.001);
  assert.equal(summarizeOrders(rows,{channel:'Retail'}).orders,raw.filter(o=>o.channel==='Retail').length);
  assert.notEqual(summarizeOrders(rows,{month:'2026-09'}).revenue,october.revenue);
  const imported=summarizeOrders([...rows,{...raw[0],orderId:'extra',amount:250}]);
  assert.equal(imported.orders,october.orders+1);
  assert.ok(Math.abs(imported.revenue-october.revenue-250)<.001);
});
test('hosted sample endpoint works without a Superset connection', async () => {
  const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'GET',query:{route:'demo/orders',client_id:'coast',page_size:'3'},headers:{}},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.data.length,3);
  assert.equal(res.body.meta.fictional,true);
  assert.equal(res.body.meta.clientId,'coast');
});
