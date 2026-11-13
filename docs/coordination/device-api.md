# Device REST API v1

The dashboard and API share the device origin (HTTP, port 80). In station mode use `http://esp32-display.local/` by default, or the IP shown on the TFT. The device name also determines the mDNS hostname (lowercase, spaces become hyphens). Use relative URLs in the dashboard.

API responses are JSON with `Cache-Control: no-store`. GET responses below are bare objects. Successful POSTs return HTTP 200 and `{"ok":true}` plus the listed fields, unless specified otherwise. Use `Content-Type: application/json` for every POST. Unknown request fields, wrong JSON types and invalid values are rejected without a partial update. Errors use `{"ok":false,"error":{"code":"invalid_field","message":"Human-readable explanation","field":"startupMode"}}`. `field` is optional. Codes include `invalid_json`, `invalid_field`, `unsupported_media_type` (415), `body_too_large` (413), `forbidden` (403), `not_found` (404), `storage_unavailable` (503) and `busy` (409). Allow up to 2048 bytes in each POST.

For new modes, countdown and integrations, see [modes-contract.md](modes-contract.md). Existing routes and mode IDs remain available.

## GET /api/status

```json
{
  "deviceName": "ESP32 Display",
  "mode": "github",
  "wifi": {"connected": true, "ip": "192.168.1.20", "hostname": "esp32-display.local", "provisioning": false},
  "uptimeSeconds": 14,
  "firmwareVersion": "1.0.0",
  "time": {"synced": false, "epochSeconds": null, "timezone": "Asia/Ho_Chi_Minh", "utcOffsetMinutes": 420},
  "github": {"state": "demo", "lastSync": null, "error": null},
  "pomodoro": {"phase": "focus", "state": "idle", "remainingSeconds": 1500, "focusMinutes": 25, "breakMinutes": 5}
}
```

Mode IDs are `github`, `clock`, `stats`, `pomodoro`, `message`. `wifi.ip` and `wifi.hostname` are nullable. GitHub state is `demo`, `loading`, `live`, `stale`, or `error`. `lastSync` is an ISO 8601 UTC string or null. Timer phase is `focus` or `break`, and state is `idle`, `running`, `paused`, or `completed`. On completion the timer stays at 0 until the user starts the next phase or resets. Reset always selects focus. Timer runtime starts idle after a reboot.

## GET /api/config and POST /api/config

GET returns this object (defaults shown). POST is a partial update and returns `{ "ok": true, "config": {...} }`. The nested `rotation` object also supports partial updates.

```json
{
  "deviceName": "ESP32 Display",
  "githubUsername": "",
  "githubProxyUrl": "",
  "theme": "dark",
  "startupMode": "github",
  "clockShowSeconds": true,
  "rotation": {
    "enabled": false,
    "intervalSeconds": 60,
    "modes": ["github", "clock", "stats", "pomodoro", "message"]
  },
  "message": {"text": "Hello, developer!", "alignment": "center", "color": "#39D353", "size": 2}
}
```

- `deviceName` is 1–32 ASCII letters, digits, spaces, or hyphens, starting and ending with a letter or digit. The default maps to `esp32-display.local`.
- `githubUsername` is empty or a GitHub handle up to 39 characters. `githubProxyUrl` is empty or the full HTTPS endpoint without credentials, query, fragment or trailing slash, maximum 200 characters. The provider appends the username query. GitHub is in demo mode while either setting is empty.
- `theme` is `dark` or `light`. `clockShowSeconds` controls TFT and preview.
- `startupMode` selects the next boot mode. Manual mode selection also persists the selected mode as the startup mode. Automatic rotation only changes the current runtime mode.
- `rotation.intervalSeconds` is an integer in 30–600 inclusive. `rotation.modes` contains 1–5 unique valid modes in order, with at least two when enabled. A manual selection or rotation settings change resets the rotation deadline. If the current mode is outside the rotation list, the next rotation starts with the first listed mode.
- `message` is read-only via this route. Wi-Fi credentials are never included. Brightness is fixed by the wiring.

## Other dashboard routes

| Route | Request | Successful response in addition to `ok` |
| --- | --- | --- |
| POST /api/display | `{"mode":"clock"}` | `mode` |
| POST /api/message | `{"text":"Hello!","alignment":"center","color":"#39D353","size":2}` | `message` (complete saved object) |
| POST /api/pomodoro | `{"action":"start"}` | `pomodoro` (same shape as status) |
| POST /api/time/sync | `{}` | Schedules an NTP resync. Returns 409 while disconnected. |
| POST /api/restart | `{"confirm":true}` | Schedules a restart after sending the response. |
| GET /api/github | — | Bare GitHub data object below. |

Message POST is partial. Text accepts up to 160 printable ASCII characters plus LF, including empty text. Alignment is `left`, `center`, or `right`. Color is a six-digit RGB hex string prefixed with `#`. Size is an integer from 1 to 4. A message update changes its data immediately. Use the display route to select message mode.

Pomodoro actions are `start`, `pause`, and `reset`. Start resumes a paused timer, starts idle focus, or starts the opposite phase after completion. Repeated start/pause requests leave an already running/non-running timer in its current state.

GitHub preview data:

```json
{
  "state": "demo",
  "username": "demo",
  "lastSync": null,
  "error": null,
  "totalContributions": 0,
  "currentStreak": 0,
  "repositoryCount": null,
  "levels": "0000000"
}
```

The example `levels` is shortened for readability. Demo, live and stale data use 364 ASCII digits (52×7, each `0`–`4`). Index = week × 7 + day, oldest week first, Sunday at day 0. While loading or on error with no data, `levels` is empty and totals are null. A cached failed refresh uses `stale` with the last usable data and a stable error code. GitHub error codes include `wifi_offline`, `waiting_for_time`, `invalid_proxy_url`, `user_not_found`, `rate_limited`, and `tls_verification_failed`. Keep the demo label visible in previews. Poll status independently of the larger GitHub response. Fetch the GitHub object on dashboard load, account/proxy edits, or when GitHub state or lastSync changes.

## Provisioning (embedded firmware page)

The ESP32 creates a unique WPA2 setup AP after a failed station connection or when credentials are missing. The TFT shows its SSID, per-session random password, and `http://192.168.4.1/`. On the setup AP, that origin serves the embedded provisioning form even without LittleFS. Dashboard routes are unavailable on the setup interface. Wi-Fi credentials are written only after the candidate network connects and obtains an IP.

- `GET /api/provision/status` returns `{"state":"idle","ip":null,"error":null}`. State can also be `connecting`, `connected` or `failed`. `ip` is the station IP on success.
- `POST /api/provision` accepts `{"ssid":"Network","password":"Wi-Fi passphrase"}` and returns 202 with `{"ok":true}`. SSID is 1–32 bytes, with no ASCII control characters. Password is empty for an open network, or 8–63 printable ASCII bytes. The AP closes automatically shortly after successful setup.
- Provisioning routes require an address leased to a client associated with the setup AP. The station dashboard is intended for a trusted LAN. It uses same-origin JSON commands without CORS and accepts the device IP or mDNS hostname as the request host. Use the IP address when mDNS is unavailable.

## Firmware/web packaging

Copy the contents of the web build output directory into `firmware/data/` (with `index.html` at its root), then build/upload the PlatformIO LittleFS image using the hardware owner's workflow. Alternatively set `PLATFORMIO_DATA_DIR="$SMART_DESK_ROOT/web/public"` for both `buildfs` and `uploadfs`. The firmware serves only GET/HEAD static files, with an embedded fallback when the index is missing. Keep asset references relative.
