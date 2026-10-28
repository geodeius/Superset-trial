# Deployment

## What runs on Vercel

Vercel serves the React portal and the allowlisted `/api/*` proxy. Without a backend URL, it provides an interactive sample dashboard rendered by React and SVG, plus a real public paginated fixture endpoint at `/api/demo/orders`. These charts are explicitly labeled as a sample dashboard rather than embedded Superset. Browser-local sample orders can be added and imported on refresh; the shared public fixture stays unchanged. Hourly refresh in this mode requires the page to remain open. The side panel supports inspecting the JSON and saving an endpoint draft, but does not connect to arbitrary authenticated APIs. Real Superset dashboards and server-side sync still require the separate backend.

Superset, its metadata/reporting databases, and the ingestion worker run on a separate persistent server. The local SQLite demo and in-memory sessions are not intended for real client data or multiple backend replicas.

## Connect a persistent demo backend

1. Run the repository's setup and both server processes on a persistent machine with storage, using the README instructions.
2. Place the portal backend behind HTTPS. Set `PORTAL_ORIGIN` to the exact public Vercel origin and `BACKEND_PUBLIC_URL` to the backend's HTTPS origin.
3. Generate a shared random secret and set `FOLIO_PROXY_SECRET` on the backend and the Vercel project. Do not put it in a `VITE_` variable or commit it.
4. Set `FOLIO_BACKEND_URL` in Vercel to the HTTPS backend origin, then redeploy. The proxy forwards only allowlisted requests and the portal session cookie.
5. Make Superset itself reachable over HTTPS and set `SUPERSET_URL` on the backend to that public origin. The browser loads embedded charts directly from this origin.
6. Update the dashboard's embedding allowed domains and Superset CSP `frame-ancestors` to include the exact portal origin. The included local Superset configuration allows only localhost; update it for the deployed environment. Restart services after configuration changes.
7. Verify both clients, filters, manual sync, scheduled sync, and failed-sync behavior using fictional data before connecting real sources.

The shared secret protects the server-to-server proxy connection; it is **not** end-user authentication. This prototype allows choosing either fictional client. Before connecting any real client data, replace demo sessions/client switching with real login and verified tenant membership; use PostgreSQL, durable sessions, a durable scheduler, and operational safeguards as described in the README. Do not expose the current demo admin credentials or local databases.

## Scheduling

The existing worker syncs hourly while the persistent backend is running. It catches up overdue jobs on restart. Vercel does not execute the backend's in-process timer. No Vercel cron job is claimed or provisioned here.

## Verification

- `npm test` covers tenant scoping, pagination, transaction rollback, hourly deadlines, and the deployment proxy.
- `npm run build` validates the production frontend build.
- With the local services running, `node scripts/check-access.mjs` checks real Superset query totals.
- `node scripts/check-sync.mjs` mutates fictional data to exercise API → reporting database → dashboard ingestion.
