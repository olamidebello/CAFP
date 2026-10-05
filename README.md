# CAFP Farm Monitoring

Multi-tenant mobile and desktop farm monitoring app with a MySQL backend. Farms have isolated plots, devices, records, alert settings, users and audit events.

## Features

| Area | Functions |
| --- | --- |
| Accounts | Register a farm and owner, sign in with farm name and email, manage users in owner/admin/operator/viewer roles, sign out. |
| Overview | Latest moisture and temperature, plot/device counts, soil moisture trend, recent activity, latest photo, persistent threshold alerts, manual refresh. |
| Alert center | Tenant-scoped warning/critical alerts from new readings; acknowledge, resolve with a note, reopen, bulk actions, status/severity/plot/search filters, CSV export, and periodic refresh. |
| Field records | Save readings or compressed plot photos with time and notes; filter, view, delete, and export records. |
| Plots | Add, edit, and delete plots with crop and area details. |
| Devices | Add sensor/camera/gateway devices, assign plots, edit status, rotate or revoke one-time ingest keys, view last-seen time. |
| Settings | Set alert thresholds, import readings CSV, export JSON snapshot, review audit events. |
| Mobile | Responsive browser interface and installable PWA; camera capture on supported devices. |

This is one web/PWA codebase, not separate native Android and iOS apps. Alerts are in-app; email, SMS, and push notifications are not implemented.

## Roles

| Action | Owner | Admin | Operator | Viewer |
| --- | :---: | :---: | :---: | :---: |
| View dashboard, plots, devices, records | Yes | Yes | Yes | Yes |
| Add records, edit plots, delete records | Yes | Yes | Yes | No |
| Acknowledge, resolve, or reopen alerts | Yes | Yes | Yes | No |
| Delete plots, manage devices and thresholds | Yes | Yes | No | No |
| Manage team and view audit | Yes | Yes* | No | No |
| Add or edit admins | Yes | No | No | No |

\* Admins cannot edit an owner or another admin. The Settings & data screen is visible to owners and admins; the API also allows operators to import readings.

## Run with MySQL and Docker

1. Copy `.env.example` to `.env` and set strong `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`. Set `COOKIE_SECURE=true` behind HTTPS. The Compose file binds only to localhost by default.
2. Run `docker compose up -d --build` from this repository. The schema initializes on the first creation of the MySQL volume.
3. Reverse proxy HTTPS to `127.0.0.1:8080`, then open that address and register a farm owner account. Do not expose the HTTP port to the internet without HTTPS.

For local development, run `mysql < db/schema.sql` with an authorized MySQL account, set the environment variables, then run `npm install && npm start`.

## User manual

### Create a farm and sign in

1. Open the app and choose **New farm? Create an account**. Enter farm name, your name, email, and a password of at least 12 characters. This creates the owner account.
2. For later sign-ins, enter the exact farm name, email, and password. The same email can belong to different farms, so the farm name is required.
3. Owners/admins add other users in **Team management**. Give each member the farm name, their email, and the assigned password. Use **Sign out** on shared devices.

### Add plots and observations

1. In **Plots**, enter a name and optional crop and area, then select **Add plot**. **Edit** changes details. Owners/admins can **Delete** a plot only after its records are deleted.
2. Select **+ Add record** or **Capture record**. Choose a plot, record type, and observation time.
3. For **Sensor / field reading**, enter at least one measurement: moisture 0–100%, temperature -50 to 70°C, or humidity 0–100%. Notes are optional. Select **Save record**.
4. For **Plot photo**, choose or capture an image and select **Save record**. The browser compresses the image; the API accepts an image payload of roughly 2 MB.
5. **Farm overview** shows the latest readings, moisture trend, recent activity, photo, and alerts. The default alert thresholds are 20% low moisture and 35°C high temperature.

### Work with alerts

Every new manual, imported, or device reading is checked against the farm's moisture and temperature thresholds. The first violating reading opens an alert for its plot and metric. Further violating readings update its value, severity, and occurrence count. A normal reading for that metric automatically resolves the active alert. Critical severity means moisture is below half the low threshold or temperature is more than 10°C over the high threshold.

Open **Alerts** or use **Manage alerts** on the dashboard. Filter by status, severity, or plot; search the fetched list; then use **Refresh** or **Export shown CSV**. Operators, admins, and owners can **Acknowledge**, **Resolve** (with an optional note), or **Reopen** an alert. Select active alerts and choose **Acknowledge selected** or **Resolve selected** for bulk action. Acknowledgment keeps the alert active. A newly violating reading can create another alert after one has been resolved. The **Edit thresholds** button takes an owner or admin to Settings & data.

The alert screen refreshes every 60 seconds while visible. It fetches up to 500 alerts for a filter; search and CSV export use that fetched set. Threshold changes affect new readings and do not retroactively recalculate historical records. Existing database volumes receive the alerts table when the server starts. No external notification channel or background device-offline detector is included.

### Review and export records

Open **Field records** and filter by all records, readings, or photos. **View photo** opens an image. Users with edit rights can **Delete** a record; the interface has no undo. **Export CSV** downloads the dashboard's loaded records, up to 500, regardless of the visible filter. The `/api/records` endpoint can return up to 1,000 recent tenant records.

### Connect devices

An owner/admin opens **Devices**, enters a label, selects sensor/camera/gateway and a plot, and clicks **Add device**. Copy the displayed key immediately: the secret appears only on creation or rotation. A device without an assigned plot cannot ingest readings. **Edit** changes its label/status; **Rotate key** invalidates the old key; **Delete** revokes the device key.

Send `POST /api/ingest` with the header `x-device-key: <device-id>.<secret>` and JSON:

```json
{"time":"2026-10-05T08:00:00Z","moisture":28.5,"temperature":31,"humidity":62}
```

At least one measurement is required. The assigned plot determines where the reading is stored. Successful ingestion updates the device's last-seen time and online status. Store keys securely; the server stores their hashes.

### Manage the team and thresholds

In **Team management**, add a member with name, email, a password of at least 12 characters, and a role. **Edit access** changes name, role, active state, or password. Disabling a user or changing their password invalidates existing sessions. In **Settings & data**, set low moisture and high temperature and select **Save thresholds**. This screen also shows the 100 most recent audit events.

### Import and back up data

In **Settings & data**, select **Import readings CSV**. Create the named plots first. The CSV requires `time` and `plot` columns; `moisture`, `temperature`, `humidity`, and `note` are optional. Plot may be a name or ID. Each row needs a parseable date/time and at least one measurement. Imports accept at most 500 rows per request and report imported/skipped counts.

```csv
time,plot,moisture,temperature,humidity,note
2026-10-05T08:00:00Z,North Field,28.5,31,62,Early reading
```

**Export JSON backup** downloads the current dashboard snapshot, including up to 500 recent records and up to 100 active alerts. It is not a complete database backup, and there is no JSON restore button. Back up the MySQL volume separately.

### Install on a phone

Open the app's HTTPS address in a browser that supports PWA installation, then choose **Install app** or **Add to Home Screen**. API actions and fresh data require a network connection. Camera capture depends on the phone and browser.

## API

Authenticated browser routes use an HttpOnly session cookie. `GET /api/dashboard` returns tenant scoped dashboard data. `GET/POST/PUT/DELETE /api/plots`, `/api/devices`, `/api/records`, `/api/users`, and `/api/settings` serve the GUI according to role. `GET /api/audit` lists recent events. `POST /api/records/import` accepts up to 500 reading objects per request. Records are limited to the newest 500 in the dashboard and 1,000 in the log.

`GET /api/alerts` supports `status` (active/open/acknowledged/resolved/all), `severity`, `plot`, and `limit` (up to 500). `POST /api/alerts/:id/acknowledge`, `/resolve`, and `/reopen` change one alert. `POST /api/alerts/bulk` accepts an `action` of `acknowledge` or `resolve` and up to 100 alert IDs. These actions require an owner, admin, or operator role and are scoped to the signed-in farm.

A device sends `POST /api/ingest` with `x-device-key: <device-id>.<secret>` and JSON `{ "time": "2026-10-05T08:00:00Z", "moisture": 28.5, "temperature": 31, "humidity": 62 }`. The device must be assigned to a plot. The API key is shown once when created or rotated; only its hash is stored.

## Production notes

Back up the MySQL volume and place the app behind HTTPS. Set account and request rate limiting at the reverse proxy; use monitoring and centralized logs. Registration is open by default. Photos are stored in MySQL; move them to object storage for larger deployments. The GitHub Actions workflow validates syntax but does not deploy the app. The provided concept image is at `dist/assets/concept.jpg`.
