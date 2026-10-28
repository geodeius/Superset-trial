import test from 'node:test';
import assert from 'node:assert/strict';
import { clients, guestPayload } from './clients.mjs';
test('guest access is scoped to one dashboard and one server-selected tenant', () => {
  for (const client of Object.values(clients)) {
    const result = guestPayload(client, 'dashboard-uuid');
    assert.deepEqual(result.resources, [{ type: 'dashboard', id: 'dashboard-uuid' }]);
    assert.deepEqual(result.rls, [{ clause: `client_id = '${client.id}'` }]);
    assert.equal(result.user.username, `demo-${client.id}`);
  }
});
test('arbitrary client definitions cannot be used to issue tokens', () => {
  assert.throws(() => guestPayload({ id: 'attacker', tenant: "x' OR 1=1 --" }, 'uuid'));
});
