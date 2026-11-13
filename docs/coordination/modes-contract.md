# Display modes and device data v2

The main selector, startup selector, and rotation UI offer `github`, `clock` (Clock + Calendar), and `countdown`. Existing `stats`, `pomodoro`, and `message` IDs and endpoints remain accepted for older clients.

## Migration

Firmware loads `smartdesk/config-v2` first and imports `config-v1` when needed. While loading stored v2 only, a `codex` or `claude` startup becomes `github`. Both quota IDs are removed from rotation in place, retaining the order of other modes. An empty list becomes `["github"]`; rotation is disabled if fewer than two entries remain. The normalized config is saved back to `config-v2`. Live LAN/cloud commands that select or add a removed mode are rejected.

On v1 import, startup `stats` and `message` become `github`, and `pomodoro` becomes `countdown`. Rotation maps stats and pomodoro in the same way, drops message, deduplicates in first-seen order, and uses the same minimum-size rule. The v1 key, Wi-Fi blob, remote pairing, GitHub settings, theme, clock settings, countdown configuration, and legacy message settings are preserved. New installs default to the three current IDs in rotation, disabled. The legacy API supports up to five unique rotation entries.

## Countdown

Add `GET /api/countdown` and `POST /api/countdown`. The GET object also appears at `GET /api/status.countdown`. POST returns `{"ok":true,"countdown":{...}}`. Persisted configuration is edited only through the countdown route.

```json
{"kind":"duration","state":"idle","durationSeconds":1500,"targetEpochSeconds":null,"remainingSeconds":1500}
```

- `{"action":"configure","kind":"duration","durationSeconds":1500}` accepts an integer 1–359999 (99:59:59). Configuration resets runtime to idle. `start`, `pause` and `reset` require only the action field. Start on idle/completed starts a full duration, start on paused resumes, repeated start while running does nothing. Countdown uses unsigned monotonic milliseconds and continues while browser/Wi-Fi are gone. After reboot it is idle with the configured duration.
- `{"action":"configure","kind":"target","targetEpochSeconds":1794560000}` accepts Unix UTC seconds in 2024–2099 inclusive. Configure saves and arms immediately, even before NTP. With no valid clock, state is `waiting_for_time` and remainingSeconds is null. With time, remaining is max(target−now,0); states `running` / `completed`. Pause returns 409 `action_not_supported`. Reset disarms the target and persists that choice. Start rearms if disarmed. Target config and armed state survive reboot, then resume against NTP. A disarmed target has state `idle`, remainingSeconds null. A completed target stays complete for the current boot until explicitly reconfigured or reset. UTC epoch is authoritative, with the target displayed in ICT.
- For either kind, `durationSeconds` retains the configured duration and `targetEpochSeconds` is null for duration. `countdown` is an optional addition to cloud status for old devices. Cloud command type `countdown` mirrors the LAN route and inherits remote ACK rules.

## Calendar

LAN `GET /api/calendar` returns the Calendar object. LAN `GET /api/integrations` returns `{"v":1,"calendar":{...}}`. Former quota routes return 404. The Calendar projection retains its existing state, timestamp, timezone, and event fields. Local routes return the cached filtered Calendar and expire stale events as before.

Authenticated device sync requests `wantIntegrations:true` about once per minute. The ESP32 accepts the v1 Calendar projection with or without the former quota fields and retains only Calendar. The HTTPS body limit remains 4 KiB for transition compatibility. The Calendar object has a 2 KiB limit, keeps up to three events with titles capped at 64 UTF-8 bytes, and displays supported Latin characters without accents on TFT. The device projects the clock in ICT and uses UTC epoch for arithmetic.

During rollout the cloud accepts old device snapshots containing `codex`/`claude` so pairing and sync continue. The updated admin UI tolerates legacy IDs in snapshots and excludes them from its controls. The cloud rejects newly submitted quota-mode commands. Roll out the new firmware and matching LittleFS/web client together.

## TFT C++ interface

`display::Mode` retains the numeric values of all remaining members. The following fields support Countdown and Calendar:

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
// In Frame:
CountdownData countdown;
const CalendarData* calendar = nullptr;
```

Core owns stable data for the duration of render, including pointed-to arrays. Null source pointer has the same semantics as NotConnected. ClockData stays in ICT, uses the ESP32 clock after sync even while offline, and exposes current local date for the calendar view.
