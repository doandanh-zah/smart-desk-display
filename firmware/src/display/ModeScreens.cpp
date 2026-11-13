#include "display/DisplayManager.h"

#include <cstdio>
#include <cstring>
#include <ctime>

#include "QuotaPets.h"

namespace desk::display {
namespace {

constexpr int16_t Left = 16;
constexpr int16_t BodyWidth = 288;
constexpr const char* Weekdays[] = {"S", "M", "T", "W", "T", "F", "S"};
constexpr const char* Days[] = {"SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY",
                                "FRIDAY", "SATURDAY"};
constexpr const char* Months[] = {"JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                                  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"};

constexpr uint16_t rgb565(uint32_t rgb) {
  return ((rgb >> 8) & 0xF800) | ((rgb >> 5) & 0x07E0) | ((rgb >> 3) & 0x001F);
}

const char* sourceLabel(SourceState state) {
  switch (state) {
    case SourceState::NotConnected: return "NOT CONNECTED";
    case SourceState::Live: return "LIVE";
    case SourceState::Stale: return "STALE";
    case SourceState::Error: return "ERROR";
    case SourceState::Unsupported: return "UNSUPPORTED";
  }
  return "UNAVAILABLE";
}

bool hasSnapshot(SourceState state) {
  return state == SourceState::Live || state == SourceState::Stale;
}

const char* countdownLabel(CountdownState state) {
  switch (state) {
    case CountdownState::Idle: return "READY";
    case CountdownState::Running: return "RUNNING";
    case CountdownState::Paused: return "PAUSED";
    case CountdownState::Completed: return "COMPLETE";
    case CountdownState::WaitingForTime: return "WAITING FOR NTP";
  }
  return "";
}

unsigned daysInMonth(unsigned year, unsigned month) {
  static constexpr unsigned lengths[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
  return lengths[month - 1] + (month == 2 && leap);
}

void formatIct(char* out, size_t size, uint64_t epoch, const char* format) {
  if (!epoch || epoch > 4102444799ULL) {
    std::snprintf(out, size, "--");
    return;
  }
  // The ESP32 toolchain can use 32-bit time_t. Within the supported range,
  // 28 Gregorian years preserve leap days and weekdays.
  constexpr uint64_t CycleSeconds = 10227ULL * 86400;
  uint64_t localEpoch = epoch + 7 * 3600;
  int yearOffset = 0;
  while (localEpoch > 2147483647ULL) {
    localEpoch -= CycleSeconds;
    yearOffset += 28;
  }
  const time_t local = localEpoch;
  struct tm parts {};
  if (gmtime_r(&local, &parts)) {
    parts.tm_year += yearOffset;
    if (std::strftime(out, size, format, &parts)) return;
  }
  std::snprintf(out, size, "--");
}

const QuotaWindow* findQuotaWindow(const QuotaData* data, uint32_t minutes, const char* id) {
  if (!data || !hasSnapshot(data->state)) return nullptr;
  for (unsigned index = 0; index < data->count && index < 2; ++index) {
    const QuotaWindow& window = data->windows[index];
    if (window.windowMinutes == minutes ||
        (!window.windowMinutes && std::strcmp(window.label, id) == 0)) return &window;
  }
  return nullptr;
}

}  // namespace

void DisplayManager::clock(const Frame& frame) {
  const ClockData& data = frame.clock;
  const bool validDate = data.synced && data.month >= 1 && data.month <= 12 &&
                         data.day >= 1 && data.day <= daysInMonth(data.year, data.month);
  char time[6] = "--:--";
  char seconds[3] = "";
  char date[11] = "";
  if (data.synced) {
    std::snprintf(time, sizeof(time), "%02u:%02u", unsigned(data.hours % 24), unsigned(data.minutes % 60));
    if (data.showSeconds) {
      std::snprintf(seconds, sizeof(seconds), "%02u", unsigned(data.seconds % 60));
    }
  }
  if (validDate) {
    std::snprintf(date, sizeof(date), "%04u-%02u-%02u", unsigned(data.year % 10000),
                  unsigned(data.month), unsigned(data.day));
  }
  const uint16_t calendarAccent = rgb565(theme_ == Theme::Light ? 0x368050 : 0x42B978);
  const bool redrawMonth = fresh_ || std::strcmp(calendarDay_, date) != 0;
  if (redrawMonth) {
    std::strcpy(calendarDay_, date);
    tft_.fillRoundRect(151, 68, 153, 126, 4, palette_->surface);
    if (validDate) {
      char month[16];
      std::snprintf(month, sizeof(month), "%s %04u", Months[data.month - 1], unsigned(data.year));
      drawText(month, std::strlen(month), 161, 78, 132, 1, palette_->text, Alignment::Left);
      for (int i = 0; i < 7; ++i) {
        drawText(Weekdays[i], 1, 160 + i * 19, 95, 17, 1, palette_->muted, Alignment::Center);
      }
      const unsigned first = (data.weekday % 7 + 35 - (data.day - 1)) % 7;
      for (unsigned day = 1; day <= daysInMonth(data.year, data.month); ++day) {
        const unsigned cell = first + day - 1;
        const int16_t x = 160 + cell % 7 * 19;
        const int16_t y = 109 + cell / 7 * 12;
        const bool today = day == data.day;
        if (today) tft_.fillRoundRect(x, y - 1, 17, 10, 2, calendarAccent);
        char number[4];
        std::snprintf(number, sizeof(number), "%u", day);
        drawText(number, std::strlen(number), x, y, 17, 1,
                 today ? palette_->background : palette_->text, Alignment::Center);
      }
    } else {
      drawText("Waiting for date", 16, 151, 126, 153, 1, palette_->muted, Alignment::Center);
    }
  }

  field(first_, time, Left, 91, 120, 4, palette_->text);
  field(second_, seconds, Left, 128, 24, 2, palette_->muted);
  field(third_, validDate ? Days[data.weekday % 7] : "--", Left, 154, 126, 1, palette_->muted);
  field(digits_, date, Left, 171, 126, 1, palette_->text);

  const CalendarData* calendar = frame.calendar;
  const SourceState state = calendar ? calendar->state : SourceState::NotConnected;
  char status[49];
  std::snprintf(status, sizeof(status), "%s  /  CALENDAR %s",
                data.synced ? "ICT" : "NTP PENDING", sourceLabel(state));
  field(footer_, status, Left, 219, BodyWidth, 1, palette_->muted);
  char event[49] = "";
  if (calendar && hasSnapshot(state)) {
    if (calendar->count) {
      const CalendarEvent& next = calendar->events[0];
      char start[16] = "ALL DAY";
      if (!next.allDay) formatIct(start, sizeof(start), next.startEpochSeconds, "%m-%d %H:%M");
      std::snprintf(event, sizeof(event), "%s  %.32s", start, next.title[0] ? next.title : "Calendar event");
    } else {
      std::snprintf(event, sizeof(event), "No upcoming events");
    }
  }
  field(detail_, event, Left, 230, BodyWidth, 1, palette_->muted);
}

void DisplayManager::countdown(const CountdownData& data) {
  const bool target = data.kind == CountdownKind::Target;
  field(first_, target ? "TARGET DATE" : "DURATION", Left, 72, BodyWidth, 1,
        palette_->accent, Alignment::Center);

  char value[12] = "--:--:--";
  if (data.remainingSeconds >= 0) {
    const uint64_t seconds = static_cast<uint64_t>(data.remainingSeconds);
    const auto days = static_cast<unsigned long>(seconds / 86400);
    if (seconds < 360000) {
      std::snprintf(value, sizeof(value), "%02u:%02u:%02u", unsigned(seconds / 3600),
                    unsigned(seconds / 60 % 60), unsigned(seconds % 60));
    } else {
      // Contract targets through 2099 fit 5 digits in days.
      std::snprintf(value, sizeof(value), "%lud %02uh", days > 99999 ? 99999 : days,
                    unsigned(seconds / 3600 % 24));
    }
  }
  digits(value, 99);

  char when[49] = "Set a duration in the dashboard";
  if (target) {
    formatIct(when, sizeof(when), data.targetEpochSeconds, "%Y-%m-%d %H:%M ICT");
  } else if (data.durationSeconds > 0) {
    std::snprintf(when, sizeof(when), "%02u:%02u:%02u duration",
                  unsigned(data.durationSeconds / 3600), unsigned(data.durationSeconds / 60 % 60),
                  unsigned(data.durationSeconds % 60));
  }
  field(second_, when, Left, 168, BodyWidth, 1, palette_->muted, Alignment::Center);
  field(footer_, countdownLabel(data.state), Left, 219, BodyWidth, 1, palette_->muted);
}

void DisplayManager::quota(const QuotaData* data, bool claude) {
  const uint16_t accent = claude ? rgb565(theme_ == Theme::Light ? 0x9C411D : 0xF9A977)
                                : rgb565(theme_ == Theme::Light ? 0x5940A2 : 0xB6A7FF);
  if (fresh_) {
    drawText(claude ? "CLAUDE" : "CODEX", claude ? 6 : 5, 85, 19, 219, 3, palette_->text,
             Alignment::Left);
    drawText("SUBSCRIPTION USAGE", 18, 85, 46, 219, 1, accent, Alignment::Left);
    tft_.drawFastHLine(Left, 68, BodyWidth, palette_->border);
    tft_.drawFastHLine(Left, 202, BodyWidth, palette_->border);
    drawText("5H USAGE", 8, Left, 77, 198, 1, palette_->muted, Alignment::Left);
    drawText("7D USAGE", 8, Left, 137, 198, 1, palette_->muted, Alignment::Left);
  }
  quotaPet(claude, millis());

  const SourceState state = data ? data->state : SourceState::NotConnected;
  const bool hasData = hasSnapshot(state);
  const QuotaWindow* windows[] = {findQuotaWindow(data, 300, "five_hour"),
                                  findQuotaWindow(data, 10080, "seven_day")};
  for (int i = 0; i < 2; ++i) {
    const QuotaWindow* window = windows[i];
    const int16_t y = 77 + i * 60;
    const int16_t used = window ? window->usedPercent : -1;
    const bool known = used >= 0 && used <= 100;
    char percent[8] = "--";
    if (known) {
      std::snprintf(percent, sizeof(percent), "%d%%", int(used));
    }
    field(quotaPercents_[i], percent, 220, y, 84, 2, accent, Alignment::Right);
    const int16_t filled = known ? used * BodyWidth / 100 : 0;
    if (fresh_ || filled != quotaWidths_[i]) {
      tft_.fillRect(Left, y + 20, BodyWidth, 6, palette_->surface);
      if (filled) tft_.fillRect(Left, y + 20, filled, 6, accent);
      quotaWidths_[i] = filled;
    }
    char reset[32] = "Reset --";
    if (window && window->resetEpochSeconds) {
      formatIct(reset, sizeof(reset), window->resetEpochSeconds, "Reset %m-%d %H:%M ICT");
    }
    field(quotaResets_[i], reset, Left, y + 34, BodyWidth, 1, palette_->muted);
  }

  const uint16_t statusColor = state == SourceState::Stale ? palette_->warning :
                               state == SourceState::Error ? palette_->error : palette_->muted;
  field(footer_, sourceLabel(state), Left, 213, 120, 1, statusColor);
  char credit[30] = "CREDIT N/A";
  if (hasData && data->creditAvailable) {
    const char* balance = data->creditBalance;
    if (data->creditUnlimited) balance = "UNLIMITED";
    else if (!balance[0] || std::strlen(balance) > 20) balance = data->hasCredits ? "AVAILABLE" : "NONE";
    std::snprintf(credit, sizeof(credit), "CREDIT %.20s", balance);
  }
  field(quotaCredit_, credit, 136, 213, 168, 1, palette_->muted, Alignment::Right);
  char updated[49] = "";
  if (hasData && data->updatedAt) {
    formatIct(updated, sizeof(updated), data->updatedAt, "Updated %m-%d %H:%M ICT");
  }
  if (hasData && data->resetCredits >= 0) {
    const size_t length = std::strlen(updated);
    std::snprintf(updated + length, sizeof(updated) - length, "%sR: %ld",
                  length ? " / " : "", static_cast<long>(data->resetCredits));
  }
  field(detail_, updated, Left, 226, BodyWidth, 1, palette_->muted);
}

void DisplayManager::quotaPet(bool claude, uint32_t now) {
  using namespace desk::display::quotaPet;
  const uint32_t elapsed = now - petCycleAt_;
  const uint32_t phase = elapsed % CycleMs;
  petCycleAt_ += elapsed - phase;
  const bool movingNow = moving(phase);
  if (!fresh_ && movingNow == (petPose_ != 0)) return;

  const Sprite& sprite = claude ? Claude : Codex;
  tft_.startWrite();
  for (int y = 0; y < Size; ++y) {
    for (int x = 0; x < Size; ++x) {
      const char current = pixel(claude, movingNow, x, y);
      const char previous = fresh_ ? '.' : pixel(claude, petPose_ != 0, x, y);
      if (current == previous) continue;
      uint16_t color = palette_->background;
      if (current == 's') color = rgb565(sprite.shell);
      if (current == 'g') color = rgb565(sprite.glow);
      if (current == 'd') color = rgb565(sprite.detail);
      tft_.writeFillRect(X + x * Scale, Y + y * Scale, Scale, Scale, color);
    }
  }
  tft_.endWrite();
  petPose_ = movingNow;
}

}  // namespace desk::display
