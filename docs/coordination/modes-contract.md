# Display modes and device data v2

The main selector, startup selector and new rotation UI offer these IDs in order: `github`, `clock` (Clock + Calendar), `countdown`, `codex`, `claude`. Use `codex` and `claude` as mode and provider IDs. GitHub keeps its current layout. Existing `stats`, `pomodoro`, `message` IDs and endpoints remain accepted for older clients.

## Migration

Firmware reads `smartdesk/config-v2` first and imports `config-v1` once when missing. On import, startup `stats` maps to `github`, `pomodoro` to `countdown`, and `message` to `github`. Rotation maps stats and pomodoro in the same way, drops message, deduplicates in first-seen order and disables rotation when fewer than two entries remain. An empty list becomes `["github"]`. Keep legacy message text, theme, GitHub, device name, clock seconds and interval. Keep the original config-v1 key, Wi-Fi blob and remote credential. Later explicit legacy API selections remain valid. New installs default to the five current IDs in rotation, disabled by default. Up to five unique rotation entries.

## Countdown

Add `GET /api/countdown` and `POST /api/countdown`. The GET object also appears at `GET /api/status.countdown`. POST returns `{"ok":true,"countdown":{...}}`. Persisted configuration is edited only through the countdown route.

```json
{"kind":"duration","state":"idle","durationSeconds":1500,"targetEpochSeconds":null,"remainingSeconds":1500}
```

- `{"action":"configure","kind":"duration","durationSeconds":1500}` accepts an integer 1–359999 (99:59:59). Configuration resets runtime to idle. `start`, `pause` and `reset` require only the action field. Start on idle/completed starts a full duration, start on paused resumes, repeated start while running does nothing. Countdown uses unsigned monotonic milliseconds and continues while browser/Wi-Fi are gone. After reboot it is idle with the configured duration.
- `{"action":"configure","kind":"target","targetEpochSeconds":1794560000}` accepts Unix UTC seconds in 2024–2099 inclusive. Configure saves and arms immediately, even before NTP. With no valid clock, state is `waiting_for_time` and remainingSeconds is null. With time, remaining is max(target−now,0); states `running` / `completed`. Pause returns 409 `action_not_supported`. Reset disarms the target and persists that choice. Start rearms if disarmed. Target config and armed state survive reboot, then resume against NTP. A disarmed target has state `idle`, remainingSeconds null. A completed target stays complete for the current boot until explicitly reconfigured or reset. UTC epoch is authoritative, with the target displayed in ICT.
- For either kind, `durationSeconds` retains the configured duration and `targetEpochSeconds` is null for duration. `countdown` is an optional addition to cloud status for old devices. Cloud command type `countdown` mirrors the LAN route and inherits remote ACK rules.

## Calendar and quota

LAN `GET /api/calendar`, `GET /api/quota/codex`, and `GET /api/quota/claude` return the corresponding individual objects in the [remote integration projection](remote-admin-contract.md#dữ-liệu-calendar-và-quota-v1). A combined LAN `GET /api/integrations` returns the same v1 envelope as `GET /api/admin/integrations`. Use `state: "unavailable"`, `observedAt: null`, and empty arrays before a provider is connected. Distinguish `unsupported` when the provider reports it.

Authenticated device sync requests `wantIntegrations:true` about once per minute and reads optional `integrations` using the same v1 envelope. Use server-filtered titles only, bounded to 64 UTF-8 bytes in the ESP32 cache, with an ASCII fallback for TFT. Keep only three events and two windows per provider, never save OAuth or account credentials on ESP32, and use no additional network task. Local read routes return cached filtered data; snapshots age out while disconnected. Use response max 4 KiB and integration projection max 2 KiB for UTF-8 titles and three snapshots. The device projects the clock in ICT and uses UTC epoch for arithmetic.

## TFT C++ interface

Append `Countdown, Codex, Claude` to `display::Mode`, retaining existing members and numeric values. Extend `Frame` with:

```cpp
enum class CountdownKind : uint8_t { Duration, Target };
enum class CountdownState : uint8_t { Idle, Running, Paused, Completed, WaitingForTime };
enum class SourceState : uint8_t { NotConnected, Live, Stale, Error, Unsupported };
struct CountdownData {
    CountdownKind kind = CountdownKind::Duration;
    CountdownState state = CountdownState::Idle;
    uint32_t durationSeconds = 1500;
    uint64_t targetEpochSeconds = 0;
    int64_t remainingSeconds = 1500; // -1 when unavailable
};
struct CalendarEvent {
    char title[41]{};
    uint64_t startEpochSeconds = 0, endEpochSeconds = 0;
    bool allDay = false;
};
struct CalendarData {
    SourceState state = SourceState::NotConnected;
    uint64_t updatedAt = 0;
    uint8_t count = 0;
    CalendarEvent events[3]{};
};
struct QuotaWindow {
    char label[21]{};
    int16_t usedPercent = -1;
    uint64_t resetEpochSeconds = 0;
};
struct QuotaData {
    SourceState state = SourceState::NotConnected;
    uint64_t updatedAt = 0;
    uint8_t count = 0;
    QuotaWindow windows[2]{};
};
// In Frame:
CountdownData countdown;
const CalendarData* calendar = nullptr;
const QuotaData* codex = nullptr;
const QuotaData* claude = nullptr;
```

Core owns stable data for the duration of render, including pointed-to arrays. Null source pointer has the same semantics as NotConnected. ClockData stays in ICT, uses the ESP32 clock after sync even while offline, and exposes current local date for the calendar view.
