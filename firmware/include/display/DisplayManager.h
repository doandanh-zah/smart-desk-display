#pragma once

#include <Adafruit_ILI9341.h>
#include <stdint.h>

namespace desk::display {

enum class Mode : uint8_t { GitHub, Clock, Stats, Pomodoro, Message, Countdown, Codex, Claude };
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
  const uint8_t* levels = nullptr;  // 364 intensities (0–4) in week-major order
  uint32_t totalContributions = 0;
  uint16_t currentStreak = 0;
  int32_t repositoryCount = -1;  // -1 when unavailable
};

struct ClockData {
  bool synced = false;
  bool showSeconds = true;
  uint16_t year = 0;
  uint8_t month = 0, day = 0, weekday = 0;  // Sunday = 0
  uint8_t hours = 0, minutes = 0, seconds = 0;  // ICT (24h)
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
  uint32_t color = 0x39D353;  // 0xRRGGBB
  uint8_t size = 2;  // 1–4, 160 ASCII bytes max, LF allowed
};

enum class CountdownKind : uint8_t { Duration, Target };
enum class CountdownState : uint8_t { Idle, Running, Paused, Completed, WaitingForTime };
enum class SourceState : uint8_t { NotConnected, Live, Stale, Error, Unsupported };

struct CountdownData {
  CountdownKind kind = CountdownKind::Duration;
  CountdownState state = CountdownState::Idle;
  uint32_t durationSeconds = 1500;
  uint64_t targetEpochSeconds = 0;
  int64_t remainingSeconds = 1500;  // -1 when unavailable
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

struct Frame {
  View view = View::Splash;
  Mode mode = Mode::GitHub;
  Theme theme = Theme::Dark;
  const char* deviceName = "ESP32 Display";
  const char* setupSsid = "";
  const char* setupPassword = "";
  const char* setupIp = "192.168.4.1";
  bool wifiConnected = false;
  const char* ipAddress = "";
  GitHubData github;
  ClockData clock;
  PomodoroData pomodoro;
  MessageData message;
  const char* configuredGitHubUsername = nullptr;
  CountdownData countdown;
  const CalendarData* calendar = nullptr;
  const QuotaData* codex = nullptr;
  const QuotaData* claude = nullptr;
};

class DisplayManager {
 public:
  void begin();
  void render(const Frame& frame);

 private:
  struct Palette {
    uint16_t background, surface, border, text, muted, accent, warning, error;
    uint16_t heat[5];
  };

  void drawText(const char* text, uint8_t length, int16_t x, int16_t y,
                int16_t width, uint8_t size, uint16_t color, Alignment align);
  void field(char* previous, const char* value, int16_t x, int16_t y,
             int16_t width, uint8_t size, uint16_t color, Alignment align = Alignment::Left,
             bool force = false);
  void digits(const char* value, int16_t y = 98);
  void statValue(char* previous, const char* value, int16_t x, int16_t y, int16_t width);
  void splash(const Frame& frame);
  void setup(const Frame& frame);
  void content(const Frame& frame);
  void github(const Frame& frame);
  void githubPet(uint32_t now);
  void writeHeatCell(int16_t x, int16_t y, int16_t width, uint16_t color);
  void stats(const GitHubData& data);
  void syncStatus(const GitHubData& data, int16_t statusY, int16_t detailY);
  void clock(const Frame& frame);
  void countdown(const CountdownData& data);
  void quota(const QuotaData* data, bool claude);
  void quotaPet(bool claude, uint32_t now);
  void pomodoro(const Frame& frame);
  void message(const Frame& frame);
  void networkStatus(const Frame& frame);

  Adafruit_ILI9341 tft_{&SPI, 26, 27, 25};
  const Palette* palette_ = nullptr;
  View view_ = View::Splash;
  Mode mode_ = Mode::GitHub;
  Theme theme_ = Theme::Dark;
  bool drawn_ = false;
  bool fresh_ = true;

  // Fixed-size visual state. No frame pointers are retained between renders.
  char heading_[49]{}, subtitle_[49]{}, footer_[49]{}, detail_[49]{};
  char first_[49]{}, second_[49]{}, third_[49]{};
  char digits_[12]{};
  static constexpr int VisibleWeeks = 24;
  static constexpr int DaysPerWeek = 7;
  uint8_t levels_[VisibleWeeks * DaysPerWeek]{};
  bool hasLevels_ = false;
  uint32_t petCycleAt_ = 0;
  uint8_t petPose_ = 0;
  char calendarDay_[11]{};
  char quotaLabels_[2][49]{}, quotaPercents_[2][49]{}, quotaResets_[2][49]{};
  int16_t quotaWidths_[2]{};
  GitHubState githubState_ = GitHubState::Loading;
  int16_t progressWidth_ = -1;
  char message_[161]{};
  Alignment messageAlignment_ = Alignment::Center;
  uint32_t messageColor_ = 0;
  uint8_t messageSize_ = 0;
  char setupSsid_[33]{}, setupPassword_[64]{}, setupIp_[16]{};
};

}  // namespace desk::display
