# TFT and dashboard preview contract

For the v2 frame additions and new modes, see [modes-contract.md](modes-contract.md). For current pixel layout and palette, see [display.md](display.md).

TFT owns `firmware/include/display/DisplayManager.h` and `firmware/src/display/`. Core firmware owns the data and invokes the renderer from the Arduino loop. Renderer and core share this header contract. Use hardware SPI (CS 27, DC 26, RST 25, MOSI 23, SCLK 18, MISO -1), Adafruit ILI9341 + GFX, landscape rotation 1 and a 320×240 logical canvas. Do not configure backlight GPIO.

```cpp
#pragma once
#include <stdint.h>

namespace desk::display {
enum class Mode : uint8_t { GitHub, Clock, Stats, Pomodoro, Message };
enum class Theme : uint8_t { Dark, Light };
enum class Alignment : uint8_t { Left, Center, Right };
enum class GitHubState : uint8_t { Demo, Loading, Live, Stale, Error };
enum class TimerPhase : uint8_t { Focus, Break };
enum class TimerState : uint8_t { Idle, Running, Paused, Completed };
enum class View : uint8_t { Splash, Setup, Content };

struct GitHubData {
    GitHubState state = GitHubState::Loading;
    const char* username = "";
    const char* lastSync = "";  // UTC ISO 8601, empty when absent
    const char* error = "";     // Safe user-facing message, empty when absent
    const uint8_t* levels = nullptr; // 364 intensity values (0–4), null without data
    uint32_t totalContributions = 0;
    uint16_t currentStreak = 0;
    int32_t repositoryCount = -1; // -1 when unavailable
};

struct ClockData {
    bool synced = false;
    bool showSeconds = true;
    uint16_t year = 0;
    uint8_t month = 0, day = 0, weekday = 0; // month 1–12, Sunday 0
    uint8_t hours = 0, minutes = 0, seconds = 0; // Local ICT, 24h
};

struct PomodoroData {
    TimerPhase phase = TimerPhase::Focus;
    TimerState state = TimerState::Idle;
    uint32_t remainingSeconds = 1500;
    uint16_t focusMinutes = 25, breakMinutes = 5;
};

struct MessageData {
    const char* text = "";
    Alignment alignment = Alignment::Center;
    uint32_t color = 0x39D353; // 0xRRGGBB
    uint8_t size = 2;          // 1–4, 160 ASCII bytes max, LF allowed
};

struct Frame {
    View view = View::Splash;
    Mode mode = Mode::GitHub;
    Theme theme = Theme::Dark;
    const char* deviceName = "ESP32 Display";
    const char* setupSsid = "";
    const char* setupPassword = "";
    const char* setupIp = "192.168.4.1";
    bool wifiConnected = false;
    const char* ipAddress = ""; // Station address, empty when disconnected
    GitHubData github;
    ClockData clock;
    PomodoroData pomodoro;
    MessageData message;
    const char* configuredGitHubUsername = nullptr; // Saved username for the GitHub heading
};

class DisplayManager {
public:
    void begin();
    void render(const Frame& frame);
};
}
```

The display owner may add private fields or helper declarations. The caller owns frame data and pointers. Read during `render()` and copy anything retained. Calls are synchronous and can be frequent. Avoid allocating a full-screen buffer. Render splash and setup on view change, and diff displayed values/regions in Content. There is no periodic redraw requirement if inputs are unchanged. A 364-cell heatmap is week-major (52 columns, 7 rows, Sunday row 0) with five RGB565 levels. Modes with unavailable data must render safely with a null level pointer. Show demo, stale, loading and error states explicitly, and show setup credentials only in Setup view.

The GitHub heading uses `configuredGitHubUsername` from settings. An empty string selects the sample heading. A null pointer lets other callers fall back to the provider username. The provider state still controls demo, live and error labels.

Dashboard preview shares the semantic data from [device-api.md](device-api.md). Its 320×240 surface should fit narrow viewports with a 4:3 aspect ratio. Web and TFT owners can agree on more precise palette/coordinates without changing the REST API. Use fixed dark palette background #0D1117, surface #161B22, foreground #E6EDF3, accent #39D353, and heatmap #161B22, #0E4429, #006D32, #26A641, #39D353 as the starting point. Clock uses Vietnam local time, timer is device-owned, and message uses the same size, alignment and color inputs. The dashboard never derives preview data from TFT pixels.

## GitHub provider seam

The proxy schema and C++ provider are defined in [github-contract.md](github-contract.md). Core calls `github::GitHubProvider::configure(username, proxyUrl)` when settings change and `tick(wifiConnected, clockSynchronized)` from the Arduino loop. Provider owns HTTPS with TLS verification, worker scheduling, response parsing, and the cache. `snapshot()` exposes the state and cached data on the same loop. Core maps that state to both the renderer and GET /api/github. REST serialization is synchronized with the loop so pointers into the provider snapshot stay valid during response construction.

Provider state Demo/Pending/Ready/Stale/Error maps to Demo/Loading/Live/Stale/Error. The snapshot supplies a username, 364 week-major levels, contribution total, streak, optional repository count, and last successful sync as Unix UTC seconds. Core formats the timestamp as ISO 8601 UTC, uses safe error text on the TFT and sends the stable error code in JSON. Loading and Error without usable data expose a null level pointer to the renderer and an empty level string to REST. A GitHub configuration change invalidates the prior snapshot. An incomplete configuration yields labeled demo data.
