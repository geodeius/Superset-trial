export const clients = {
  atelier: { id: 'atelier', name: 'Atelier Living', initials: 'AL', industry: 'Home & lifestyle', color: '#7056d8', currency: 'USD', tenant: 'atelier', description: 'Thoughtful spaces. Measurable growth.' },
  coast: { id: 'coast', name: 'Coast Supply', initials: 'CS', industry: 'Outdoor & everyday', color: '#187c75', currency: 'USD', tenant: 'coast', description: 'A clearer view of your next adventure.' },
};
export function guestPayload(client, dashboardId) {
  if (!Object.values(clients).includes(client)) throw new Error('Unknown client');
  return { user: { username: `demo-${client.id}`, first_name: client.name, last_name: 'Viewer' }, resources: [{ type: 'dashboard', id: dashboardId }], rls: [{ clause: `client_id = '${client.tenant}'` }] };
}
