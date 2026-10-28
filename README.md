# Folio — embedded client analytics

A working local prototype of a branded client portal with **real Apache Superset dashboards**, embedded with the official SDK. React + Vite serve the portal; Express obtains guest tokens server-side. No Power BI or paid BI service is used.

## Hosted portal

The Vercel deployment serves the portal and a server-side backend proxy. Without a public backend, it displays an interactive fictional-data dashboard rendered by the portal, with period/channel filters, CSV export, and an API connection panel. The public `/api/demo/orders` endpoint serves the same paginated fixture. Sample-order additions are browser-local overlays, not changes to that public fixture; refresh combines the API fixture with those overlays. Demo hourly refresh runs only while the page is open. Real Superset embedding and server-side hourly ingestion require a connected backend. See [deployment instructions](docs/deployment.md) for configuration. No local credentials or databases are included in the deployment.

## Try it

- Portal: http://localhost:3017
- Superset dashboard builder: http://localhost:8088
- Two fictional clients: **Atelier Living** and **Coast Supply**. Switch them in the sidebar to see different, row-restricted results.
- Seven charts: revenue, order count, average order value, unique customers, daily revenue, revenue by channel, and product performance.
- Open the embedded **Filters** panel to change dates or channel; choose **Apply filters**.
- Saved views are browser-local dashboard shortcuts, not snapshots of filter selections.

## First-time setup

Requires Node.js 22.13+, npm, and [uv](https://docs.astral.sh/uv/). Superset runs in an isolated Python 3.11 environment; Docker is not required.

```sh
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements-lock.txt
npm install
npm run setup
```

Then use two terminals:

```sh
npm run superset
```

```sh
npm run dev
```

`npm run setup` creates local random secrets, migrates the Superset metadata database, generates fictional retail orders, and registers charts, filters, roles, and the embedded dashboard. Running setup again resets sample orders and dashboard definitions; it preserves secrets and other dashboards. Restart the portal if setup is run after it starts.

For the builder, log in as `admin`. The generated password is the `adminPassword` field in `.local/secrets.json`. The restricted token-service account is separate from the administrator. Credentials stay in ignored files and never enter the frontend bundle. Do not commit `.local/`.

## How embedding works

1. The local demo creates an HTTP-only session cookie.
2. The sample workspace selector changes the server-side session's allowlisted client.
3. The portal backend obtains a guest token scoped to the embedded dashboard and a `client_id` row restriction.
4. The SDK loads the dashboard inside the portal and refreshes short-lived tokens automatically.
5. The client never receives Superset service-account credentials.

Both clients use the same dashboard definition. The server selects the row restriction; the browser cannot submit arbitrary SQL or a different dashboard ID. The client switcher intentionally allows both fictional clients in this demo.

## Scope and production requirements

This is a **localhost-only prototype**, not a deployed client service. All server processes bind to loopback. The demo session is not real user authentication. Before serving client data:

- Replace the demo identity and switch endpoint with your existing platform login and tenant memberships. Derive access from the verified user on the server.
- Use PostgreSQL for Superset metadata, configure appropriate caching, backups, monitoring, HTTPS, and durable sessions.
- Replace the sample database with read-only client data connections and verify client isolation, including exports and filters. Consider separate databases or instances where stronger isolation is required.
- Restrict embedded domains and CSP to your actual platform origin. Review and reduce the guest role for the features you expose.
- The local configuration allows SQLite file connections for the generated demo; remove that exception for deployment.
- Rebuild Power BI measures and transformations deliberately. PBIX/DAX import is not implemented.

## Checks

```sh
npm run build
npm test
# With both servers running:
node scripts/check-access.mjs
# End-to-end sync check (adds one fictional $250 order):
node scripts/check-sync.mjs
```

## Project files

- `src/`: responsive branded portal, search, library, saved shortcuts, client branding, and embedding lifecycle.
- `server/`: local session and CSRF protection, allowlisted client selection, guest-token integration.
- `superset/superset_config.py`: local Superset configuration with embedding enabled.
- `scripts/seed.py`: reproducible sample database and dashboard definitions.
- `.local/`: ignored metadata, sample data, secrets, and generated portal configuration.

Superset is licensed under Apache 2.0. The prototype uses Superset as a dependency rather than copying its source.

## Dummy API and hourly ingestion

The portal now runs a persistent fictional orders API at:

- `http://localhost:3017/demo-api/orders?client_id=atelier&page_size=3`
- `http://localhost:3017/demo-api/orders?client_id=coast&page_size=3`

Responses include nested product information, order IDs, client IDs, amounts, dates, and pagination metadata. They are backed by `.local/dummy-orders.json`, initially copied from the generated sample data. This file is the source; `.local/retail.db` is the separate reporting copy that Superset queries.

The server fetches every API page, validates all records and the source revision, then replaces only that client's rows in one transaction. Repeating a sync does not duplicate orders. A failed fetch, incomplete response, mixed-client data, or failed transaction preserves the previous snapshot. The last successful sync and its row count are stored in the reporting database.

While the portal server is running, each client syncs hourly from its last successful sync. On startup, overdue clients sync immediately; failed jobs retry within a minute. This is an in-process local scheduler, not an independently deployed worker. A production service should use a durable job scheduler. The browser polls sync status every 15 seconds and reloads the embedded dashboard after a successful scheduled sync.

To demonstrate the complete process:

1. Open **Data sources** in the portal.
2. Select **View API response** to inspect the fictional JSON.
3. Select **Add sample order (+$250)**. This changes the source API only.
4. Select **Sync now**. It fetches the source and updates the reporting database.
5. Return to **Overview**. October revenue increases by $250 and order count by one.

The top-level **Sync now** button performs the same ingestion and reloads the embedded dashboard. The display shows actual data-sync time rather than the time the dashboard was opened. Simulation dates are fixed in October 2026 to match the sample dashboard filters.

The dummy API is intentionally public only within this localhost prototype and contains fictional data. Source mutations and sync requests use the existing local session and CSRF checks; the server derives the client from the session. Replacing the adapter with a real API should retain server-only credentials, explicit client mapping, pagination and validation, and add the real source's deletion/update semantics and rate limits. Do not run `npm run setup` to refresh API data: setup resets reporting data; use **Sync now** instead.

## Hosted sample dashboard

Open the live portal to explore sample revenue, orders, customers, daily sales, channel mix, and product performance. The API connection panel sits beside the dashboard on desktop and below it on mobile. Use **Add sample order**, then **Refresh data**, to simulate importing an extra $250 October order in this browser. The **Your API** tab saves a non-secret endpoint draft locally; it does not claim to connect to or call that endpoint.

To preview hosted mode locally: run `npm run build`, then `npm run preview:hosted` and open http://localhost:3019. This mode uses demo charts, not the Superset iframe. The existing local server at port 3017 still embeds real Superset.
