#include "display/DisplayManager.h"

#include <cstdio>
#include <cstring>
#include <ctime>

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
  const CalendarEvent* next = calendar && hasSnapshot(state) && calendar->count ? &calendar->events[0] : nullptr;
  char start[16];
  std::snprintf(start, sizeof(start), "%s", data.synced ? "ICT" : "NTP PENDING");
  const char* title = hasSnapshot(state) ? "No upcoming events" : sourceLabel(state);
  if (next) {
    if (next->allDay) std::snprintf(start, sizeof(start), "ALL DAY");
    else formatIct(start, sizeof(start), next->startEpochSeconds, "%m-%d %H:%M");
    title = next->title[0] ? next->title : "Calendar event";
  }
  constexpr int16_t footerY = 220;
  constexpr int16_t titleOffset = 84;
  field(footer_, start, Left, footerY, 72, 1, palette_->muted);
  field(detail_, title, Left + titleOffset, footerY, BodyWidth - titleOffset, 1,
        palette_->text, Alignment::Right);
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

}  // namespace desk::display
