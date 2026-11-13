#include "display/DisplayManager.h"

#include <cstdio>
#include <cstring>

#include "display/MessageLayout.h"
#include "GitHubPet.h"

namespace desk::display {
namespace {

constexpr int16_t Width = 320;
constexpr int16_t Left = 16;
constexpr int16_t BodyWidth = 288;
constexpr int16_t FooterY = 219;
constexpr int16_t DetailY = 230;

constexpr int16_t GridX = 29;
constexpr int16_t GridY = 113;
constexpr int16_t GridWidth = 262;
constexpr int16_t GridHeight = 54;
constexpr int16_t GitHubNameX = 89;
constexpr int16_t GitHubNameWidth = 219;
constexpr int16_t GitHubNameColumns = GitHubNameWidth / 6;
constexpr int16_t CalendarWeeks = 52;

constexpr uint16_t rgb565(uint32_t rgb) {
  return ((rgb >> 8) & 0xF800) | ((rgb >> 5) & 0x07E0) | ((rgb >> 3) & 0x001F);
}

const char* orEmpty(const char* text) {
  return text ? text : "";
}

const char* label(Mode mode) {
  switch (mode) {
    case Mode::Countdown: return "COUNTDOWN";
    case Mode::GitHub:
    case Mode::Codex:
    case Mode::Claude: break;
    case Mode::Clock: return "CLOCK + CALENDAR";
    case Mode::Stats: return "DEVELOPER STATS";
    case Mode::Pomodoro: return "POMODORO";
    case Mode::Message: return "CUSTOM MESSAGE";
  }
  return "";
}

const char* stateLabel(TimerState state) {
  switch (state) {
    case TimerState::Idle: return "READY";
    case TimerState::Running: return "RUNNING";
    case TimerState::Paused: return "PAUSED";
    case TimerState::Completed: return "COMPLETE";
  }
  return "";
}

template <size_t N>
bool remember(char (&cache)[N], const char* value) {
  value = orEmpty(value);
  if (std::strncmp(cache, value, N - 1) == 0) {
    return false;
  }
  std::snprintf(cache, N, "%s", value);
  return true;
}

}  // namespace

void DisplayManager::begin() {
  SPI.begin(18, -1, 23, -1);
  tft_.begin(10000000);
  tft_.setRotation(1);
  drawn_ = false;
}

void DisplayManager::render(const Frame& frame) {
  static constexpr Palette dark{
      rgb565(0x0D1117), rgb565(0x161B22), rgb565(0x30363D), rgb565(0xF0F6FC),
      rgb565(0x9DA7B3), rgb565(0x39D353), rgb565(0xE3B341), rgb565(0xFF7B72),
      {rgb565(0x21262D), rgb565(0x0E4429), rgb565(0x006D32), rgb565(0x26A641), rgb565(0x39D353)}};
  static constexpr Palette light{
      rgb565(0xFFFFFF), rgb565(0xF6F8FA), rgb565(0xD0D7DE), rgb565(0x1F2328),
      rgb565(0x57606A), rgb565(0x116329), rgb565(0x764500), rgb565(0xA40E26),
      {rgb565(0xEBEDF0), rgb565(0x9BE9A8), rgb565(0x40C463), rgb565(0x30A14E), rgb565(0x216E39)}};

  static constexpr Palette githubDark{
      rgb565(0x101419), rgb565(0x1B212A), rgb565(0x39434F), rgb565(0xEFF8F2),
      rgb565(0xA5BEB4), rgb565(0x8DE1B5), rgb565(0xEAC47D), rgb565(0xFFACA5),
      {rgb565(0x303A46), rgb565(0x125638), rgb565(0x21845A), rgb565(0x42B978), rgb565(0x8CF2AC)}};
  static constexpr Palette githubLight{
      rgb565(0xF5F6F8), rgb565(0xFFFFFF), rgb565(0xD3D9E1), rgb565(0x142820),
      rgb565(0x4B645A), rgb565(0x216441), rgb565(0x784D14), rgb565(0xA42F2A),
      {rgb565(0xCAD9CF), rgb565(0xA6CDAE), rgb565(0x6DAE82), rgb565(0x368050), rgb565(0x195C37)}};

  const bool isGitHub = frame.view == View::Content && frame.mode == Mode::GitHub;
  fresh_ = !drawn_ || frame.view != view_ || frame.theme != theme_ ||
           (frame.view == View::Content && frame.mode != mode_);
  const bool hasPet = isGitHub || (frame.view == View::Content &&
                                  (frame.mode == Mode::Codex || frame.mode == Mode::Claude));
  if (hasPet && (!drawn_ || view_ != View::Content || mode_ != frame.mode)) {
    petCycleAt_ = millis();
  }
  if (view_ == View::Setup && frame.view != View::Setup) {
    std::memset(setupPassword_, 0, sizeof(setupPassword_));
  }
  view_ = frame.view;
  theme_ = frame.theme;
  mode_ = frame.mode;
  palette_ = theme_ == Theme::Light ? (isGitHub ? &githubLight : &light)
                                    : (isGitHub ? &githubDark : &dark);

  if (fresh_) {
    tft_.fillScreen(palette_->background);
  }

  switch (view_) {
    case View::Splash: splash(frame); break;
    case View::Setup: setup(frame); break;
    case View::Content: content(frame); break;
  }
  drawn_ = true;
}

void DisplayManager::drawText(const char* text, uint8_t length, int16_t x, int16_t y,
                              int16_t width, uint8_t size, uint16_t color, Alignment align) {
  const int16_t advance = 6 * size;
  const int16_t spare = width - length * advance;
  if (align == Alignment::Center) {
    x += spare / 2;
  } else if (align == Alignment::Right) {
    x += spare;
  }
  for (uint8_t index = 0; index < length; ++index) {
    const char value = text[index];
    const char glyph = value == '\t' ? ' ' : (value >= ' ' && value <= '~' ? value : '?');
    tft_.drawChar(x, y, glyph, color, color, size);
    x += advance;
  }
}

void DisplayManager::field(char* previous, const char* value, int16_t x, int16_t y,
                           int16_t width, uint8_t size, uint16_t color, Alignment align,
                           bool force) {
  const int capacity = width / (6 * size);
  char visible[49];
  std::snprintf(visible, sizeof(visible), "%.*s", capacity, orEmpty(value));
  if (!fresh_ && !force && std::strcmp(previous, visible) == 0) {
    return;
  }
  std::strcpy(previous, visible);
  if (!fresh_) {
    tft_.fillRect(x, y, width, 8 * size, palette_->background);
  }
  drawText(visible, std::strlen(visible), x, y, width, size, color, align);
}

void DisplayManager::digits(const char* value, int16_t y) {
  const size_t length = std::strlen(value);
  const uint8_t maxSize = BodyWidth / (6 * length);
  const uint8_t size = maxSize < 7 ? maxSize : 7;
  const int16_t advance = 6 * size;
  int16_t x = (Width - static_cast<int16_t>(length) * advance) / 2;
  const bool all = fresh_ || length != std::strlen(digits_);
  if (all && !fresh_) {
    tft_.fillRect(Left, y, BodyWidth, 56, palette_->background);
  }
  for (size_t index = 0; index < length; ++index) {
    if (all || value[index] != digits_[index]) {
      tft_.drawChar(x, y, value[index], palette_->text, palette_->background, size);
    }
    x += advance;
  }
  std::strcpy(digits_, value);
}

void DisplayManager::splash(const Frame& frame) {
  if (fresh_) {
    tft_.fillRect(16, 81, 32, 4, palette_->accent);
    drawText("SMART DESK", 10, Left, 100, BodyWidth, 4, palette_->text, Alignment::Left);
    drawText("Starting up", 11, Left, 174, BodyWidth, 1, palette_->muted, Alignment::Left);
  }
  field(subtitle_, frame.deviceName, Left, 142, BodyWidth, 1, palette_->muted);
}

void DisplayManager::setup(const Frame& frame) {
  if (fresh_) {
    tft_.drawFastHLine(Left, 54, BodyWidth, palette_->border);
    drawText("WI-FI SETUP", 11, Left, 18, BodyWidth, 2, palette_->accent, Alignment::Left);
    drawText("1. Join this Wi-Fi network", 26, Left, 69, BodyWidth, 1, palette_->muted, Alignment::Left);
    drawText("Password", 8, Left, 117, BodyWidth, 1, palette_->muted, Alignment::Left);
    drawText("2. Open this address", 20, Left, 171, BodyWidth, 1, palette_->muted, Alignment::Left);
  }

  if (remember(setupSsid_, frame.setupSsid) || fresh_) {
    const uint8_t length = std::strlen(setupSsid_);
    tft_.fillRect(Left, 87, BodyWidth, 16, palette_->background);
    drawText(setupSsid_, length, Left, 87, BodyWidth, length <= 24 ? 2 : 1,
             palette_->text, Alignment::Left);
  }
  if (remember(setupPassword_, frame.setupPassword) || fresh_) {
    const uint8_t length = std::strlen(setupPassword_);
    tft_.fillRect(Left, 135, BodyWidth, 20, palette_->background);
    if (length <= 24) {
      drawText(setupPassword_, length, Left, 135, BodyWidth, 2, palette_->text, Alignment::Left);
    } else {
      const uint8_t firstLength = length < 48 ? length : 48;
      drawText(setupPassword_, firstLength, Left, 135, BodyWidth, 1, palette_->text, Alignment::Left);
      drawText(setupPassword_ + firstLength, length - firstLength, Left, 147, BodyWidth, 1,
               palette_->text, Alignment::Left);
    }
  }
  if (remember(setupIp_, frame.setupIp) || fresh_) {
    char address[24];
    std::snprintf(address, sizeof(address), "http://%s/", setupIp_);
    field(first_, address, Left, 189, BodyWidth, 2, palette_->text);
  }
}

void DisplayManager::content(const Frame& frame) {
  if (frame.mode == Mode::GitHub) {
    github(frame);
    return;
  }
  if (frame.mode == Mode::Codex || frame.mode == Mode::Claude) {
    const bool claude = frame.mode == Mode::Claude;
    quota(claude ? frame.claude : frame.codex, claude);
    return;
  }
  if (fresh_) {
    tft_.drawFastHLine(Left, 54, BodyWidth, palette_->border);
    tft_.drawFastHLine(Left, 206, BodyWidth, palette_->border);
  }
  field(heading_, label(frame.mode), Left, 14, BodyWidth, 2, palette_->text);

  const char* subtitle = frame.deviceName;
  char username[41];
  if (frame.mode == Mode::Stats) {
    if (*orEmpty(frame.github.username)) {
      std::snprintf(username, sizeof(username), "@%.39s", frame.github.username);
      subtitle = username;
    }
  }
  field(subtitle_, subtitle, Left, 34, BodyWidth, 1, palette_->muted);

  switch (frame.mode) {
    case Mode::GitHub:
    case Mode::Codex:
    case Mode::Claude: break;
    case Mode::Countdown: countdown(frame.countdown); break;
    case Mode::Stats: stats(frame.github); break;
    case Mode::Clock: clock(frame); break;
    case Mode::Pomodoro: pomodoro(frame); break;
    case Mode::Message: message(frame); break;
  }
}

void DisplayManager::github(const Frame& frame) {
  const GitHubData& data = frame.github;
  const bool hasData = data.levels != nullptr;
  if (fresh_) {
    tft_.fillRoundRect(14, 14, 64, 72, 6, rgb565(pet::Background));
    tft_.fillRoundRect(12, 92, 296, 91, 4, palette_->surface);
    drawText("DUT SUPERTEAM UNIVERSITY CLUB", 29, GitHubNameX, 57, GitHubNameWidth, 1,
             palette_->muted, Alignment::Left);
    drawText("SUPERTEAM VIETNAM", 17, GitHubNameX, 69, GitHubNameWidth, 1,
             palette_->muted, Alignment::Left);
    drawText("24 WEEKS", 8, 24, 100, 272, 1, palette_->muted, Alignment::Right);
    drawText("Less", 4, 108, 173, 24, 1, palette_->muted, Alignment::Left);
    drawText("More", 4, 190, 173, 24, 1, palette_->muted, Alignment::Left);
    tft_.startWrite();
    for (int level = 0; level < 5; ++level) {
      writeHeatCell(138 + level * 10, 174, 8, palette_->heat[level]);
    }
    tft_.endWrite();
    drawText("TIME / ICT", 10, Left, 188, BodyWidth, 1, palette_->muted, Alignment::Left);
    drawText("STREAK / DAYS", 13, Left, 188, BodyWidth, 1, palette_->muted, Alignment::Right);
    tft_.drawFastHLine(Left, 218, BodyWidth, palette_->border);
  }
  githubPet(millis());

  const char* source = frame.configuredGitHubUsername;
  if (!source) {
    source = orEmpty(data.username);
    if (data.state == GitHubState::Demo && std::strcmp(source, "demo") == 0) {
      source = "";
    }
  }
  char name[40];
  std::snprintf(name, sizeof(name), "%s", *source ? source : "GitHub");
  if (remember(heading_, name) || fresh_) {
    const uint8_t length = std::strlen(name);
    if (!fresh_) {
      tft_.fillRect(GitHubNameX, 28, GitHubNameWidth, 24, palette_->background);
    }
    if (length > GitHubNameColumns) {
      drawText(name, GitHubNameColumns, GitHubNameX, 30, GitHubNameWidth, 1,
               palette_->text, Alignment::Left);
      drawText(name + GitHubNameColumns, length - GitHubNameColumns, GitHubNameX, 40,
               GitHubNameWidth, 1, palette_->text, Alignment::Left);
    } else {
      const uint8_t size = length <= 12 ? 3 : (length <= 18 ? 2 : 1);
      drawText(name, length, GitHubNameX, 40 - 4 * size, GitHubNameWidth, size,
               palette_->text, Alignment::Left);
    }
  }

  char total[26] = "-- contrib. / 52w";
  char streak[6] = "--";
  char time[6] = "--:--";
  if (hasData) {
    std::snprintf(total, sizeof(total), "%lu contrib. / 52w",
                  static_cast<unsigned long>(data.totalContributions));
    std::snprintf(streak, sizeof(streak), "%u", unsigned(data.currentStreak));
  }
  if (frame.clock.synced) {
    std::snprintf(time, sizeof(time), "%02u:%02u", unsigned(frame.clock.hours % 24),
                  unsigned(frame.clock.minutes % 60));
  }
  if (remember(first_, total) || fresh_) {
    if (!fresh_) {
      tft_.fillRect(24, 100, 216, 8, palette_->surface);
    }
    drawText(total, std::strlen(total), 24, 100, 216, 1, palette_->text, Alignment::Left);
  }
  field(subtitle_, time, Left, 199, 60, 2, palette_->text);
  field(third_, streak, 244, 199, 60, 2, palette_->accent, Alignment::Right);

  const bool replaceGrid = fresh_ || hasLevels_ != hasData;
  if (replaceGrid && !fresh_) {
    tft_.fillRect(GridX, GridY, GridWidth, GridHeight, palette_->surface);
  }
  if (replaceGrid && !hasData) {
    drawText("No contribution data", 20, GridX, 139, GridWidth, 1,
             palette_->muted, Alignment::Center);
  }
  if (hasData) {
    bool writing = false;
    const uint8_t* recent = data.levels + (CalendarWeeks - VisibleWeeks) * DaysPerWeek;
    for (int week = 0; week < VisibleWeeks; ++week) {
      for (int day = 0; day < DaysPerWeek; ++day) {
        const int index = week * DaysPerWeek + day;
        const uint8_t level = recent[index] <= 4 ? recent[index] : 0;
        if (replaceGrid || levels_[index] != level) {
          if (!writing) {
            tft_.startWrite();
            writing = true;
          }
          writeHeatCell(GridX + week * 11, GridY + day * 8, 9, palette_->heat[level]);
          levels_[index] = level;
        }
      }
    }
    if (writing) {
      tft_.endWrite();
    }
  }
  hasLevels_ = hasData;
  syncStatus(data, 222, 232);
}

void DisplayManager::writeHeatCell(int16_t x, int16_t y, int16_t width, uint16_t color) {
  // Leave the four corner pixels as the card background.
  tft_.writeFillRect(x, y + 1, width, 4, color);
  tft_.writeFillRect(x + 1, y, width - 2, 1, color);
  tft_.writeFillRect(x + 1, y + 5, width - 2, 1, color);
}

void DisplayManager::githubPet(uint32_t now) {
  const uint32_t elapsed = now - petCycleAt_;
  const uint32_t phase = elapsed % pet::CycleMs;
  petCycleAt_ += elapsed - phase;
  const pet::Pose pose = pet::poseAt(phase);
  const pet::Pose previous = static_cast<pet::Pose>(petPose_);
  if (!fresh_ && pose == previous) {
    return;
  }

  tft_.startWrite();
  for (int y = 0; y < pet::Height; ++y) {
    int x = 0;
    while (x < pet::Width) {
      const char value = pet::pixel(pose, x, y);
      const bool changed = fresh_ ? value != '.' : value != pet::pixel(previous, x, y);
      if (!changed) {
        ++x;
        continue;
      }
      const int start = x++;
      while (x < pet::Width && pet::pixel(pose, x, y) == value &&
             (fresh_ || value != pet::pixel(previous, x, y))) {
        ++x;
      }
      tft_.writeFillRect(pet::X + start * pet::Scale, pet::Y + y * pet::Scale,
                         (x - start) * pet::Scale, pet::Scale, rgb565(pet::color(value)));
    }
  }
  tft_.endWrite();
  petPose_ = static_cast<uint8_t>(pose);
}

void DisplayManager::stats(const GitHubData& data) {
  if (fresh_) {
    tft_.fillRect(16, 66, 140, 62, palette_->surface);
    tft_.fillRect(164, 66, 140, 62, palette_->surface);
    tft_.fillRect(16, 136, 288, 62, palette_->surface);
    drawText("CONTRIBUTIONS", 13, 28, 77, 116, 1, palette_->muted, Alignment::Left);
    drawText("STREAK / DAYS", 13, 176, 77, 116, 1, palette_->muted, Alignment::Left);
    drawText("PUBLIC REPOSITORIES", 19, 28, 147, 264, 1, palette_->muted, Alignment::Left);
  }

  char total[16] = "--";
  char streak[16] = "--";
  char repos[16] = "--";
  if (data.levels) {
    std::snprintf(total, sizeof(total), "%lu", static_cast<unsigned long>(data.totalContributions));
    std::snprintf(streak, sizeof(streak), "%u", unsigned(data.currentStreak));
    if (data.repositoryCount >= 0) {
      std::snprintf(repos, sizeof(repos), "%ld", static_cast<long>(data.repositoryCount));
    }
  }
  statValue(first_, total, 28, 94, 116);
  statValue(second_, streak, 176, 94, 116);
  statValue(third_, repos, 28, 164, 264);
  syncStatus(data, FooterY, DetailY);
}

void DisplayManager::statValue(char* previous, const char* value, int16_t x, int16_t y, int16_t width) {
  if (!fresh_ && std::strcmp(previous, value) == 0) {
    return;
  }
  std::strcpy(previous, value);
  if (!fresh_) {
    tft_.fillRect(x, y, width, 24, palette_->surface);
  }
  const uint8_t length = std::strlen(value);
  const uint8_t maxSize = width / (6 * length);
  drawText(value, length, x, y, width, maxSize < 3 ? maxSize : 3, palette_->text, Alignment::Left);
}

void DisplayManager::syncStatus(const GitHubData& data, int16_t statusY, int16_t detailY) {
  char status[49];
  const char* detail = "";
  uint16_t color = palette_->muted;
  const char* sync = *orEmpty(data.lastSync) ? data.lastSync : "--";
  switch (data.state) {
    case GitHubState::Demo:
      std::snprintf(status, sizeof(status), "DEMO  /  Sample data");
      detail = "Set GitHub username and proxy in dashboard";
      color = palette_->warning;
      break;
    case GitHubState::Loading:
      std::snprintf(status, sizeof(status), "SYNCING  /  Waiting for GitHub");
      detail = orEmpty(data.error);
      break;
    case GitHubState::Live:
      std::snprintf(status, sizeof(status), "SYNCED  /  %.20s", sync);
      color = palette_->accent;
      break;
    case GitHubState::Stale:
      std::snprintf(status, sizeof(status), "CACHED  /  %.20s", sync);
      detail = *orEmpty(data.error) ? data.error : "Refresh failed";
      color = palette_->warning;
      break;
    case GitHubState::Error:
      std::snprintf(status, sizeof(status), "GITHUB ERROR");
      detail = *orEmpty(data.error) ? data.error : "Check account, proxy or Wi-Fi";
      color = palette_->error;
      break;
  }
  field(footer_, status, Left, statusY, BodyWidth, 1, color, Alignment::Left,
        githubState_ != data.state);
  field(detail_, detail, Left, detailY, BodyWidth, 1, palette_->muted);
  githubState_ = data.state;
}

void DisplayManager::pomodoro(const Frame& frame) {
  const PomodoroData& data = frame.pomodoro;
  const bool focus = data.phase == TimerPhase::Focus;
  field(first_, focus ? "FOCUS SESSION" : "SHORT BREAK", Left, 72, BodyWidth, 1,
        palette_->accent, Alignment::Center);

  char time[12];
  const uint32_t seconds = data.remainingSeconds;
  std::snprintf(time, sizeof(time), "%02lu:%02lu",
                static_cast<unsigned long>(seconds / 60), static_cast<unsigned long>(seconds % 60));
  digits(time);

  const uint32_t duration = uint32_t(focus ? data.focusMinutes : data.breakMinutes) * 60;
  int16_t width = 0;
  if (duration > 0 && seconds < duration) {
    width = static_cast<int16_t>((duration - seconds) * BodyWidth / duration);
  }
  if (fresh_) {
    tft_.fillRect(Left, 172, BodyWidth, 6, palette_->surface);
    progressWidth_ = 0;
  }
  if (width > progressWidth_) {
    tft_.fillRect(Left + progressWidth_, 172, width - progressWidth_, 6, palette_->accent);
  } else if (width < progressWidth_) {
    tft_.fillRect(Left + width, 172, progressWidth_ - width, 6, palette_->surface);
  }
  progressWidth_ = width;
  field(second_, stateLabel(data.state), Left, 188, BodyWidth, 1, palette_->muted, Alignment::Center);
  networkStatus(frame);
}

void DisplayManager::message(const Frame& frame) {
  const MessageData& data = frame.message;
  const bool textChanged = remember(message_, data.text);
  if (fresh_ || textChanged || messageSize_ != data.size ||
      messageColor_ != data.color || messageAlignment_ != data.alignment) {
    messageSize_ = data.size;
    messageColor_ = data.color;
    messageAlignment_ = data.alignment;

    constexpr int16_t TextY = 64;
    constexpr int16_t TextHeight = 134;
    if (!fresh_) {
      tft_.fillRect(Left, TextY, BodyWidth, TextHeight, palette_->background);
    }
    const uint8_t size = data.size >= 1 && data.size <= 4 ? data.size : 2;
    const uint8_t lineHeight = 8 * size;
    const uint8_t columns = BodyWidth / (6 * size);
    const MessageLayout layout = wrapMessage(message_, columns, TextHeight / lineHeight);
    int16_t y = TextY + (TextHeight - layout.count * lineHeight) / 2;
    if (layout.count == 0) {
      drawText("Set a message in the dashboard", 30, Left, y - 4, BodyWidth, 1,
               palette_->muted, Alignment::Center);
    }
    for (uint8_t row = 0; row < layout.count; ++row) {
      const MessageLayout::Line& line = layout.lines[row];
      if (layout.truncated && row + 1 == layout.count) {
        const uint8_t length = line.length <= columns - 3 ? line.length : columns - 3;
        char lastLine[49];
        std::memcpy(lastLine, line.text, length);
        std::memcpy(lastLine + length, "...", 3);
        drawText(lastLine, length + 3, Left, y, BodyWidth, size, rgb565(data.color), data.alignment);
      } else {
        drawText(line.text, line.length, Left, y, BodyWidth, size, rgb565(data.color), data.alignment);
      }
      y += lineHeight;
    }
  }
  networkStatus(frame);
}

void DisplayManager::networkStatus(const Frame& frame) {
  char status[49];
  if (frame.wifiConnected) {
    std::snprintf(status, sizeof(status), "WI-FI CONNECTED  /  %.15s", orEmpty(frame.ipAddress));
  } else {
    std::snprintf(status, sizeof(status), "WI-FI DISCONNECTED");
  }
  field(footer_, status, Left, FooterY, BodyWidth, 1, palette_->muted);
}

}  // namespace desk::display
