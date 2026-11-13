#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>

#include "display/DisplayManager.h"
#include "desk/Countdown.h"

namespace desk {

struct Settings {
    String deviceName = "ESP32 Display";
    String githubUsername;
    String githubProxyUrl;
    display::Theme theme = display::Theme::Dark;
    display::Mode startupMode = display::Mode::GitHub;
    bool clockShowSeconds = true;
    bool rotationEnabled = false;
    uint16_t rotationSeconds = 60;
    uint8_t rotationCount = 3;
    display::Mode rotationModes[5] = {display::Mode::GitHub, display::Mode::Clock,
        display::Mode::Countdown};
    String text = "Hello, developer!";
    display::Alignment alignment = display::Alignment::Center;
    uint32_t color = 0x39D353;
    uint8_t size = 2;
    CountdownConfig countdown;

    String hostname() const;
};

struct Credentials {
    char ssid[33] = {};
    char password[64] = {};
};

class SettingsStore {
public:
    void begin(Settings& settings, Credentials& credentials);
    bool save(const Settings& settings);
    bool saveCredentials(const Credentials& credentials);

private:
    Preferences preferences_;
    bool ready_ = false;
};

const char* modeName(display::Mode mode);
bool parseMode(JsonVariantConst input, display::Mode& mode);
bool readString(JsonVariantConst input, String& value);
bool validCredentials(const String& ssid, const String& password);
const char* applySettings(JsonObjectConst input, Settings& settings);
const char* applyMessage(JsonObjectConst input, Settings& settings);
void writeSettings(JsonObject output, const Settings& settings);
void writeMessage(JsonObject output, const Settings& settings);

}
