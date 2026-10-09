# CAFP User Guide

This guide covers the CAFP 2.4 interface. [README](../README.md) has the architecture and quick start; the [Developer Guide](DEVELOPER_GUIDE.md) covers deployment and API details. CAFP is a web app that can be installed from a supported browser. It does not include an Android APK or iOS IPA.

## First sign-in

1. Open your farm's HTTPS CAFP address. Select **New farm? Create an account** and enter the farm name, your name, email, and a password of 12–128 characters. This creates an owner account and an isolated farm workspace.
2. Later, sign in with the exact farm name, email, and password. The same email may be used in another farm; each farm has its own data.
3. To add people, an owner or admin opens **Team**, selects an email and permitted role, and clicks **Create invitation**. Copy the one-time link immediately. The invitee follows it, checks the farm and role, and chooses their own name and password. The link expires after seven days. Pending links can be revoked.
4. Open **My profile** to change your name or password. Password changes require the current password and end other sessions. Use **Sign out** on a shared device.

## Navigation and roles

On desktop, use the left menu. On a phone, swipe the bottom menu sideways for more pages. **Getting started** provides direct shortcuts. **Get the app** opens the browser installation prompt where supported, shows platform steps elsewhere, and has **Copy app link**.

| Area | Viewer | Operator | Owner or admin |
| --- | --- | --- | --- |
| Overview, records, plots, devices, alerts, camera gallery, farm events | View | View | View |
| Readings, photos, media uploads | — | Add | Add |
| Alert acknowledgment and resolution | — | Manage | Manage |
| Manual farm event request | — | Request | Request |
| Rules, event approval/cancellation, devices, thresholds, team | — | — | Manage |

Only an owner can add or edit another admin. A manual drone launch request needs approval from a different owner or admin.

## Set up a plot and capture readings

1. In **Plots**, enter a name and optional crop and area, then select **Add plot**. Operators can edit plot details. Owners/admins can delete an empty plot; linked records, media, and rules must be cleared first.
2. Select **Capture record**, choose a plot and observation time, then enter moisture (0–100%), temperature (−50 to 70 °C), or humidity (0–100%). At least one value is required. **Save record** updates the overview and evaluates alert and event rules.
3. For a plot photo, change the record type to **Plot photo**, select an image, and save it. This browser image is stored as a record. Camera media has its own gallery and upload path.
4. In **Field records**, filter readings or photos, use **Export CSV**, view a photo, or delete a record if your role permits it. A delete has no undo.

## Alerts and thresholds

The default low moisture threshold is 20%; high temperature is 35 °C. An owner/admin changes these in **Settings & data**. A later violating reading opens or updates the relevant plot alert. A later normal reading resolves an active alert for that measurement. Acknowledgment leaves an alert active. Owners, admins, and operators can acknowledge, resolve, reopen, or perform bulk actions in **Alerts**. Use filters and **Refresh** for current events. Changes to thresholds apply to future readings; they do not recalculate old records.

## Devices and Wyze camera media

1. An owner/admin creates a sensor, camera, or gateway under **Devices** and assigns it to a plot. Save the one-time ingest key when shown. **Rotate key** invalidates the old key. **Delete** revokes the device after linked automation rules and events are handled.
2. A device can send JSON readings to `POST /api/ingest` with its key in `x-device-key`. The assigned plot determines the farm and field. The [Developer Guide](DEVELOPER_GUIDE.md) has an example.
3. To upload a Wyze Cam v3 event clip from a stock camera, download it in the Wyze app, open **Camera media**, select a plot and a JPEG, PNG, or MP4 up to 8 MB, and click **Upload media**. Use playback, **Download**, **Refresh**, or **Delete** as allowed by your role.
4. If your Wyze Cam v3 already offers a local RTSP URL, a gateway can run the optional snapshot/clip feeder described in the [Developer Guide](DEVELOPER_GUIDE.md). This is separate from the stock camera workflow. Camera motion from snapshot differences can trigger a rule; it is not person or intrusion detection. An external analyzer may submit a separate intrusion signal through a provisioned gateway.

Media uploads are stored in MySQL. There is no live Wyze browser stream, cloud account synchronization, or bundled computer vision model.

## Create farm event rules

An owner/admin opens **Farm events** and creates a rule for a plot and a gateway assigned to that same plot. Select one input and one action:

| Input | When it triggers | Example action |
| --- | --- | --- |
| Low soil moisture | A new reading is **below** the rule threshold | Irrigate for a bounded duration |
| High temperature | A new reading is **above** the rule threshold | Propose irrigation or opening the drone house |
| Camera motion | An authenticated gateway reports a motion score | Propose opening the drone house |
| Camera intrusion | An authenticated external analyzer reports intrusion | Propose a drone action |

Set the cooldown from 1 to 1,440 minutes to suppress repeat requests from one rule. **Pause** stops new requests; **Enable** resumes; **Delete** removes the rule but keeps existing event history. A rule usually creates an approval request. Owners/admins may select **Automatically queue irrigation** for an irrigation rule; irrigation duration is limited to 1–300 seconds. Drone house and drone actions always await approval. The gateway must have a separate physical adapter to carry out any action.

## Request and monitor a farm action

1. In **Farm events**, select the plot, its assigned gateway, the action, and a reason. Enter 1–300 seconds for irrigation, then click **Request action**.
2. An owner/admin reviews the event and selects **Approve** or **Cancel**. A manual drone launch needs a *different* owner/admin to approve it. Approval places the command in the gateway queue; it does not confirm execution.
3. The status moves through **pending approval → queued → claimed → succeeded/failed** as the gateway polls and reports the outcome. Use **Refresh** to see the latest status. A queued event may be cancelled. A claimed command cannot be cancelled from CAFP because the gateway may already be acting; use the equipment's local emergency stop if needed.
4. A claimed command with no result is not retried automatically. An operator should inspect the gateway and equipment before creating another request.

CAFP does not include a relay controller or drone autopilot. A site operator must configure and test physical interlocks, emergency stops, equipment mapping, and the gateway adapters before enabling physical commands. The gateway requires a separate local arming setting before it will hand a drone launch command to its adapter.

## Import, export, and installation

**Settings & data** accepts a readings CSV with `time` and `plot` columns, plus at least one measurement per row. Create the plots first. The import handles up to 500 rows per request and reports skipped rows. **Export JSON backup** contains a recent dashboard snapshot, not the full MySQL database. Arrange separate database backups.

For mobile installation, use **Get the app** on the sign-in page or in Account. Android Chrome can offer **Install app**; iPhone/iPad Safari uses Share → **Add to Home Screen**. CAFP needs a network connection for fresh data and API actions.

## If something does not work

| Symptom | Check |
| --- | --- |
| Invitation unavailable | Confirm the seven-day window, exact link, and whether it was used or revoked. Ask an owner/admin to create a new one. |
| Reading rejected | Assign the device to a plot; check the key, ISO timestamp, and measurement range. |
| Wyze clip rejected | Export an MP4 under 8 MB or choose JPEG/PNG for a photo. |
| Camera motion never appears | Confirm the RTSP stream and gateway key, install Pillow for motion comparison, and set a motion threshold. Stock Wyze firmware may not provide RTSP. |
| Rule does not trigger | Check its enabled state, selected plot, threshold direction, available reading, and cooldown. |
| Event stays queued | Confirm the assigned gateway is polling and has an adapter. |
| Event stays claimed | Inspect gateway logs and physical state. CAFP will not resend it automatically. |
| Event failed | Read its result note; verify local adapter, interlocks, arming, and equipment. |
