# CAFP Developer Guide

This guide describes the code in this repository at version 2.2.0. The [README](../README.md) covers product features and user steps.

## Stack and layout

CAFP is a single Node.js 20+ process serving an Express 4 API and static browser assets. MySQL 8 stores application data. The browser UI uses plain JavaScript and CSS; there is no frontend build step or native mobile package.

| Path | Responsibility |
| --- | --- |
| `server/index.js` | Express setup, authentication, role checks, tenant-scoped CRUD, device ingestion, static serving. |
| `server/alerts.js` | Alert table initialization, reading evaluation, alert API, dashboard alert query. |
| `server/onboarding.js` | Invitation enrollment, member registration, and profile routes. |
| `db/schema.sql` | Initial schema for a new MySQL volume. |
| `dist/index.html`, `dist/app.js`, `dist/alerts.js`, `dist/onboarding.js`, `dist/downloads.js`, `dist/style.css` | Browser shell, screens and actions, alert screen, styles. |
| `dist/sw.js`, `dist/manifest.webmanifest` | PWA cache and install metadata. |
| `Dockerfile`, `docker-compose.yml`, `.env.example` | Container and local configuration. |
| `.github/workflows/check.yml` | Syntax check on pushes and pull requests. |

The browser calls `/api/*` with same-origin cookies. The server serves `dist/` after API routes; an unknown API path returns JSON 404 rather than the HTML fallback.

## Local development

### Docker Compose

1. Copy `.env.example` to `.env` and replace both MySQL passwords. Keep `.env` out of Git.
2. Run `docker compose up -d --build`.
3. Open `http://127.0.0.1:8080` locally and register a farm. The Compose port binds to localhost unless `APP_BIND` is changed.
4. Inspect logs with `docker compose logs -f app mysql`; stop with `docker compose down`. Do not add `-v` unless deleting the database volume is intended.

The database service runs `db/schema.sql` only when its data volume is first initialized. On later starts, the app calls `ensureAlertSchema()` and `ensureOnboardingSchema()` so alert and invitation tables can be added to an existing installation. This is not a general migration system. For any future schema change, add a versioned, idempotent migration and document the rollout; editing `schema.sql` alone does not upgrade existing volumes. The database account must have permission to create these tables on an older volume or an administrator must apply that schema change before starting the updated app.

### Without Compose

Create and initialize a MySQL database with `db/schema.sql`. Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, and optionally `PORT` in the process environment. Then run `npm install` and `npm run dev`. Node does not automatically read `.env`; Compose uses it for variable substitution. `npm run check` performs JavaScript syntax checks and needs no running database.

There is no checked-in lockfile. The Dockerfile and workflow currently use `npm install`; add a lockfile and switch to `npm ci` when repeatable dependency installs are required.

## Data and request flow

1. A farm registration creates a `tenants` row, an owner `users` row, and `tenant_settings` in one database transaction.
2. Passwords are salted with Node's `scryptSync`. Login creates a random token; only its SHA-256 hash is stored in `sessions`. The browser gets an HttpOnly, SameSite=Lax cookie with a seven-day lifetime.
3. The `auth` middleware joins session, user, and tenant, rejects expired or inactive users, then attaches `req.user`. `requireRole(...)` guards mutations.
4. Every tenant-owned query must include `req.user.tenant_id`. For a new cross-table operation, verify ownership of referenced plot/device/user IDs before writing. Do not trust a tenant ID in a request body.
5. Devices use a separate `x-device-key: <device-id>.<secret>` header. The device row stores a hash of the secret. The device's tenant and assigned plot come from the database, never the request body.

The primary tables are `tenants`, `users`, `sessions`, `invitations`, `plots`, `devices`, `records`, `tenant_settings`, `alerts`, and `audit_events`. UUIDs identify most rows. Records store UTC observation time in a MySQL `DATETIME`; browser-facing record data adds a `Z` suffix. Photos are stored as compressed data URLs in MySQL.

## API conventions

The UI helper `api(url, method, body)` in `dist/app.js` calls `/api${url}`, sends JSON, includes same-origin cookies, and throws the server's `error` value on non-2xx responses. API writes check the Origin host when the browser sends an Origin header. Server errors return generic JSON; internal details go to server logs.

| Area | Routes | Access |
| --- | --- | --- |
| Authentication | `POST /api/auth/register`, `/login`, `/logout`; `GET /api/me` | Register/login public; logout/me authenticated. |
| Invitations | `GET /api/auth/invitations/:token`; `POST /api/auth/register-member`; `GET/POST /api/invitations`; `DELETE /api/invitations/:id` | Token lookup and registration public; management owner/admin. |
| Profile | `PUT /api/profile` | Any signed-in role; current password required for password changes. |
| Dashboard | `GET /api/dashboard` | Any signed-in role; up to 500 records and 100 active alerts. |
| Plots | `GET/POST /api/plots`; `PUT/DELETE /api/plots/:id` | Read all roles; add/edit owner/admin/operator; delete owner/admin. |
| Devices | `GET/POST /api/devices`; `PUT/DELETE /api/devices/:id`; `POST /api/devices/:id/rotate-key` | Read all roles; mutations owner/admin. |
| Records | `GET/POST /api/records`; `DELETE /api/records/:id`; `POST /api/records/import` | Read all roles; mutations owner/admin/operator. |
| Alerts | `GET /api/alerts`; `POST /api/alerts/:id/:action`; `POST /api/alerts/bulk` | Read all roles; actions owner/admin/operator. |
| Settings/team/audit | `GET/PUT /api/settings`, `GET/POST /api/users`, `PUT /api/users/:id`, `GET /api/audit` | Settings read all roles, write owner/admin; team/audit owner/admin. |
| Device input | `POST /api/ingest` | Valid device key and an assigned plot. |

The alert actions are `acknowledge`, `resolve`, and `reopen`. Bulk supports acknowledge/resolve for at most 100 IDs. `GET /api/alerts` accepts `status`, `severity`, `plot`, and `limit` (maximum 500). The record import accepts at most 500 items. The API is not versioned.

An invitation stores a SHA-256 token hash and is locked during redemption so it can register one member. The link is shown once and expires in seven days; there is no email delivery. Invitation management is tenant-scoped, and an admin cannot invite another admin. A profile password change revokes other sessions.

## Alert lifecycle

`insertRecord()` writes a reading, then calls `syncReadingAlerts()`. That function locks the plot row in a transaction to serialize concurrent alert evaluation for a plot. It compares supplied moisture and temperature values to the tenant thresholds:

- Moisture below `low_moisture` or temperature above `high_temperature` opens an alert, or updates an existing active alert's value, severity, occurrence count, and last-seen time.
- A reading on the normal side automatically resolves an active alert for that metric. A missing metric does not change that metric's alert.
- An acknowledgment stays active. A manual resolution closes it; a later violating reading can open a new alert. Reopen returns a resolved alert to open.
- Critical severity means moisture is below half the low threshold, or temperature is more than 10°C above the high threshold.

Threshold edits affect future readings only. There is no background scheduler, email/SMS/push delivery, or offline-device alert. The alert write currently follows the record insert in a separate transaction: if alert evaluation fails, the record may already exist even though the request returns an error. Before adding retries or external notifications, make record insertion and alert evaluation atomic or use a durable outbox with idempotency keys.

## Adding a feature

1. Add or update the schema with a migration path for both fresh and existing databases.
2. Add a tenant-scoped API route in `server/index.js` or a focused module, with input validation, a role check, and an audit entry for meaningful changes.
3. Add UI controls in `dist/app.js`, `dist/alerts.js`, or `dist/onboarding.js`; use the `api()` helper, escape untrusted text with `esc()`, and refresh the affected view after a successful mutation. Every visible action should have a real route or a clearly identified browser-only action such as CSV download.
4. If an asset is required offline, update the asset list and cache version in `dist/sw.js`.
5. Update the README/user manual and this guide, then run the checks below.

Avoid global tenant queries for new features. Test that a user in farm A cannot read or mutate farm B's IDs, including bulk endpoints. Validate negative values, missing fields, duplicate submissions, and role changes. Review new downloadable data for formula injection if it will be opened in spreadsheet software.

The Get the app screen uses the browser `beforeinstallprompt` event when available and otherwise displays Android, iOS, and desktop instructions. The service worker caches `dist/downloads.js`; bump its cache version when changing offline assets. This repository does not build native binaries.

## Checks and release

```sh
npm run check
docker compose config
docker compose up -d --build
docker compose logs --tail=100 app mysql
```

The first command is the current CI gate. The others require Docker. There is no automated database integration suite yet. Before a production release, exercise registration, cross-tenant access, each role, manual and device readings, alert transitions, CSV import, and mobile navigation against a disposable MySQL database. Confirm `COOKIE_SECURE=true` behind HTTPS, run a database backup, and apply migrations before replacing the app container. GitHub Actions does not deploy the service.

For production, add rate limiting, routine database backups and restore drills, monitoring, and a reverse proxy with HTTPS. Open registration is enabled in the current code; restrict it if private enrollment is required. Never commit `.env` or device keys.
