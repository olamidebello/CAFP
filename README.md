# CAFP Farm Monitoring

Multi-tenant mobile and desktop farm monitoring app with a MySQL backend. Farms have isolated plots, devices, records, alert settings, users and audit events.

## Features

- Farm registration and sign-in with server-side sessions; owner, admin, operator and viewer roles.
- Dashboard with latest readings, soil moisture trend, plot photo, alerts and activity.
- Plot and device management, one-time device ingest keys and key rotation.
- Manual readings and compressed camera photos; CSV import and export, JSON data export.
- Alert threshold controls, team creation/access management, audit log.
- Responsive installable PWA; service worker caches app assets, not API responses.

## Run with MySQL and Docker

1. Copy `.env.example` to `.env` and set strong `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`. Set `COOKIE_SECURE=true` behind HTTPS. The Compose file binds only to localhost by default.
2. Run `docker compose up -d --build` from this repository. The schema initializes on the first creation of the MySQL volume.
3. Reverse proxy HTTPS to `127.0.0.1:8080`, then open that address and register a farm owner account. Do not expose the HTTP port to the internet without HTTPS.

For local development, run `mysql < db/schema.sql` with an authorized MySQL account, set the environment variables, then run `npm install && npm start`.

## API

Authenticated browser routes use an HttpOnly session cookie. `GET /api/dashboard` returns tenant scoped dashboard data. `GET/POST/PUT/DELETE /api/plots`, `/api/devices`, `/api/records`, `/api/users`, and `/api/settings` serve the GUI according to role. `GET /api/audit` lists recent events. `POST /api/records/import` accepts up to 500 reading objects per request. Records are limited to the newest 500 in the dashboard and 1,000 in the log.

A device sends `POST /api/ingest` with `x-device-key: <device-id>.<secret>` and JSON `{ "time": "2026-10-05T08:00:00Z", "moisture": 28.5, "temperature": 31, "humidity": 62 }`. The device must be assigned to a plot. The API key is shown once when created or rotated; only its hash is stored.

## Production notes

Back up the MySQL volume and place the app behind HTTPS. Set account and request rate limiting at the reverse proxy; use monitoring, centralized logs and database backups. Registration is open by default. Photos are stored in MySQL and capped to about 2 MB per upload; move them to object storage for larger deployments. The sample GitHub Actions workflow validates syntax; deployment requires your MySQL host, HTTPS endpoint and credentials. The provided reference concept image is at `dist/assets/concept.jpg`.
