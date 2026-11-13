#include "desk/Settings.h"

namespace desk {
namespace {
constexpr const char* modes[] = {"github", "clock", "stats", "pomodoro", "message", "countdown", "solana"};
constexpr const char* alignments[] = {"left", "center", "right"};
constexpr const char* settingsKey = "config-v2";
constexpr const char* legacySettingsKey = "config-v1";
constexpr const char* wifiKey = "wifi-v1";

bool alnumAscii(char c) {
    return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

bool printable(const String& value, bool allowLf = false) {
    for (size_t i = 0; i < value.length(); ++i) {
        const unsigned char c = value[i];
        if ((c < 32 || c > 126) && !(allowLf && c == '\n')) return false;
    }
    return true;
}

bool nameValid(const String& value, bool github) {
    const size_t length = value.length();
    if (length == 0 || length > (github ? 39 : 32) ||
        !alnumAscii(value[0]) || !alnumAscii(value[length - 1])) return false;
    for (size_t i = 1; i + 1 < length; ++i) {
        const char c = value[i];
        if (alnumAscii(c)) continue;
        if (!github && c == ' ') continue;
        if (c != '-' || (github && value[i - 1] == '-')) return false;
    }
    return true;
}

bool proxyValid(const String& url) {
    if (url.isEmpty()) return true;
    if (url.length() > 200 || !url.startsWith("https://") || url.endsWith("/")) return false;
    const int slash = url.indexOf('/', 8);
    const int hostEnd = slash < 0 ? url.length() : slash;
    if (hostEnd <= 8 || !alnumAscii(url[8]) || !alnumAscii(url[hostEnd - 1])) return false;
    for (int i = 8; i < hostEnd; ++i) {
        const char c = url[i];
        if (!alnumAscii(c) && c != '.' && c != '-') return false;
    }
    for (size_t i = hostEnd; i < url.length(); ++i) {
        const unsigned char c = url[i];
        if (c <= 32 || c > 126 || c == '?' || c == '#' || c == '@' || c == '\\') return false;
    }
    return true;
}

bool hexColor(const String& value, uint32_t& color) {
    if (value.length() != 7 || value[0] != '#') return false;
    uint32_t parsed = 0;
    for (size_t i = 1; i < 7; ++i) {
        const char c = value[i];
        parsed <<= 4;
        if (c >= '0' && c <= '9') parsed |= c - '0';
        else if (c >= 'a' && c <= 'f') parsed |= c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') parsed |= c - 'A' + 10;
        else return false;
    }
    color = parsed;
    return true;
}

void migrateV1Modes(Settings& settings) {
    const auto current = [](display::Mode mode) {
        if (mode == display::Mode::Pomodoro) return display::Mode::Countdown;
        if (mode == display::Mode::Stats || mode == display::Mode::Message) return display::Mode::GitHub;
        return mode;
    };
    settings.startupMode = current(settings.startupMode);
    uint8_t seen = 0;
    uint8_t count = 0;
    for (uint8_t i = 0; i < settings.rotationCount; ++i) {
        if (settings.rotationModes[i] == display::Mode::Message) continue;
        const auto mode = current(settings.rotationModes[i]);
        const uint8_t bit = 1u << static_cast<uint8_t>(mode);
        if (seen & bit) continue;
        seen |= bit;
        settings.rotationModes[count++] = mode;
    }
    if (!count) settings.rotationModes[count++] = display::Mode::GitHub;
    settings.rotationCount = count;
    if (count < 2) settings.rotationEnabled = false;
}

bool removedQuotaMode(JsonVariantConst value) {
    const auto name = value.as<JsonString>();
    return name == "codex" || name == "claude";
}

bool removeStoredQuotaModes(JsonObject saved) {
    bool changed = removedQuotaMode(saved["startupMode"]);
    if (changed) saved["startupMode"] = "github";

    const auto rotation = saved["rotation"].as<JsonObject>();
    auto list = rotation["modes"].as<JsonArray>();
    bool removed = false;
    for (size_t i = list.size(); i > 0; --i) {
        if (!removedQuotaMode(list[i - 1])) continue;
        list.remove(i - 1);
        removed = true;
    }
    if (!removed) return changed;

    if (list.size() == 0) list.add("github");
    if (list.size() < 2) rotation["enabled"] = false;
    return true;
}

const char* applyRotation(JsonObjectConst input, Settings& settings) {
    for (JsonPairConst pair : input) {
        const JsonVariantConst value = pair.value();
        if (pair.key() == "enabled") {
            if (!value.is<bool>()) return "rotation.enabled";
            settings.rotationEnabled = value.as<bool>();
        } else if (pair.key() == "intervalSeconds") {
            if (!value.is<uint16_t>() || value.as<uint16_t>() < 30 || value.as<uint16_t>() > 600) {
                return "rotation.intervalSeconds";
            }
            settings.rotationSeconds = value.as<uint16_t>();
        } else if (pair.key() == "modes") {
            const JsonArrayConst list = value.as<JsonArrayConst>();
            if (list.isNull() || list.size() < 1 || list.size() > 5) return "rotation.modes";
            uint8_t seen = 0;
            settings.rotationCount = 0;
            for (JsonVariantConst entry : list) {
                display::Mode mode;
                if (!parseMode(entry, mode)) return "rotation.modes";
                const uint8_t bit = 1u << static_cast<uint8_t>(mode);
                if (seen & bit) return "rotation.modes";
                seen |= bit;
                settings.rotationModes[settings.rotationCount++] = mode;
            }
        } else {
            return "rotation";
        }
    }
    return settings.rotationEnabled && settings.rotationCount < 2 ? "rotation.modes" : nullptr;
}
}

const char* modeName(display::Mode mode) { return modes[static_cast<uint8_t>(mode)]; }

bool readString(JsonVariantConst input, String& value) {
    if (!input.is<const char*>()) return false;
    const JsonString string = input.as<JsonString>();
    if (memchr(string.c_str(), '\0', string.size()) != nullptr) return false;
    value = string.c_str();
    return value.length() == string.size();
}

bool parseMode(JsonVariantConst input, display::Mode& mode) {
    String value;
    if (!readString(input, value)) return false;
    for (uint8_t i = 0; i < sizeof(modes) / sizeof(modes[0]); ++i) {
        if (value == modes[i]) {
            mode = static_cast<display::Mode>(i);
            return true;
        }
    }
    return false;
}

bool validCredentials(const String& ssid, const String& password) {
    if (ssid.isEmpty() || ssid.length() > 32) return false;
    for (size_t i = 0; i < ssid.length(); ++i) {
        const unsigned char c = ssid[i];
        if (c < 32 || c == 127) return false;
    }
    return password.isEmpty() || (password.length() >= 8 && password.length() <= 63 && printable(password));
}

const char* applySettings(JsonObjectConst input, Settings& settings) {
    for (JsonPairConst pair : input) {
        const JsonString key = pair.key();
        const JsonVariantConst value = pair.value();
        if (key == "deviceName") {
            if (!readString(value, settings.deviceName) || !nameValid(settings.deviceName, false)) return "deviceName";
        } else if (key == "githubUsername") {
            if (!readString(value, settings.githubUsername) ||
                (!settings.githubUsername.isEmpty() && !nameValid(settings.githubUsername, true))) return "githubUsername";
        } else if (key == "githubProxyUrl") {
            if (!readString(value, settings.githubProxyUrl) || !proxyValid(settings.githubProxyUrl)) return "githubProxyUrl";
        } else if (key == "theme") {
            String theme;
            if (!readString(value, theme) || (theme != "dark" && theme != "light")) return "theme";
            settings.theme = theme == "dark" ? display::Theme::Dark : display::Theme::Light;
        } else if (key == "startupMode") {
            if (!parseMode(value, settings.startupMode)) return "startupMode";
        } else if (key == "clockShowSeconds") {
            if (!value.is<bool>()) return "clockShowSeconds";
            settings.clockShowSeconds = value.as<bool>();
        } else if (key == "rotation") {
            const JsonObjectConst rotation = value.as<JsonObjectConst>();
            if (rotation.isNull()) return "rotation";
            if (const char* error = applyRotation(rotation, settings)) return error;
        } else {
            return "config";
        }
    }
    return nullptr;
}

const char* applyMessage(JsonObjectConst input, Settings& settings) {
    for (JsonPairConst pair : input) {
        const JsonString key = pair.key();
        const JsonVariantConst value = pair.value();
        if (key == "text") {
            if (!readString(value, settings.text) || settings.text.length() > 160 || !printable(settings.text, true)) {
                return "text";
            }
        } else if (key == "alignment") {
            String alignment;
            if (!readString(value, alignment)) return "alignment";
            uint8_t i = 0;
            while (i < 3 && alignment != alignments[i]) ++i;
            if (i == 3) return "alignment";
            settings.alignment = static_cast<display::Alignment>(i);
        } else if (key == "color") {
            String color;
            if (!readString(value, color) || !hexColor(color, settings.color)) return "color";
        } else if (key == "size") {
            if (!value.is<uint8_t>() || value.as<uint8_t>() < 1 || value.as<uint8_t>() > 4) return "size";
            settings.size = value.as<uint8_t>();
        } else {
            return "message";
        }
    }
    return nullptr;
}

String Settings::hostname() const {
    String name = deviceName;
    name.toLowerCase();
    name.replace(' ', '-');
    return name;
}

void writeMessage(JsonObject output, const Settings& settings) {
    output["text"] = settings.text;
    output["alignment"] = alignments[static_cast<uint8_t>(settings.alignment)];
    char color[8];
    snprintf(color, sizeof(color), "#%06lX", static_cast<unsigned long>(settings.color));
    output["color"] = String(color);
    output["size"] = settings.size;
}

void writeSettings(JsonObject output, const Settings& settings) {
    output["deviceName"] = settings.deviceName;
    output["githubUsername"] = settings.githubUsername;
    output["githubProxyUrl"] = settings.githubProxyUrl;
    output["theme"] = settings.theme == display::Theme::Dark ? "dark" : "light";
    output["startupMode"] = modeName(settings.startupMode);
    output["clockShowSeconds"] = settings.clockShowSeconds;
    JsonObject rotation = output["rotation"].to<JsonObject>();
    rotation["enabled"] = settings.rotationEnabled;
    rotation["intervalSeconds"] = settings.rotationSeconds;
    JsonArray list = rotation["modes"].to<JsonArray>();
    for (uint8_t i = 0; i < settings.rotationCount; ++i) list.add(modeName(settings.rotationModes[i]));
    writeMessage(output["message"].to<JsonObject>(), settings);
}

void SettingsStore::begin(Settings& settings, Credentials& credentials) {
    ready_ = preferences_.begin("smartdesk", false);
    if (!ready_) return;

    for (const char* key : {settingsKey, legacySettingsKey}) {
        const bool legacy = key == legacySettingsKey;
        const String saved = preferences_.getString(key, "");
        JsonDocument doc;
        if (saved.isEmpty() || deserializeJson(doc, saved) || !doc.is<JsonObject>()) continue;
        JsonDocument message;
        message.set(doc["message"]);
        doc.remove("message");
        Settings candidate;
        const bool removedQuota = !legacy && removeStoredQuotaModes(doc.as<JsonObject>());
        if (legacy) {
            candidate.rotationCount = 5;
            candidate.rotationModes[2] = display::Mode::Stats;
            candidate.rotationModes[3] = display::Mode::Pomodoro;
            candidate.rotationModes[4] = display::Mode::Message;
        } else {
            const auto countdown = doc["countdown"].as<JsonObjectConst>();
            if (!countdown.isNull() && countdown["durationSeconds"].is<uint32_t>() &&
                countdown["targetEpochSeconds"].is<uint64_t>() && countdown["armed"].is<bool>()) {
                const auto duration = countdown["durationSeconds"].as<uint32_t>();
                const auto target = countdown["targetEpochSeconds"].as<uint64_t>();
                if (duration && duration <= maxCountdownDuration &&
                    (!target || (target >= firstCountdownEpoch && target <= lastCountdownEpoch))) {
                    candidate.countdown = {duration, target, target && countdown["armed"].as<bool>()};
                }
            }
            doc.remove("countdown");
        }
        if (applySettings(doc.as<JsonObjectConst>(), candidate) || !message.is<JsonObject>() ||
            applyMessage(message.as<JsonObjectConst>(), candidate)) continue;
        if (legacy) migrateV1Modes(candidate);
        settings = candidate;
        if ((legacy || removedQuota) && !save(settings)) Serial.println("Could not persist settings migration.");
        break;
    }

    Credentials stored;
    if (preferences_.getBytesLength(wifiKey) == sizeof(stored) &&
        preferences_.getBytes(wifiKey, &stored, sizeof(stored)) == sizeof(stored) &&
        stored.ssid[32] == '\0' && stored.password[63] == '\0' &&
        validCredentials(stored.ssid, stored.password)) {
        credentials = stored;
    }
}

bool SettingsStore::save(const Settings& settings) {
    if (!ready_) return false;
    JsonDocument doc;
    writeSettings(doc.to<JsonObject>(), settings);
    auto countdown = doc["countdown"].to<JsonObject>();
    countdown["durationSeconds"] = settings.countdown.durationSeconds;
    countdown["targetEpochSeconds"] = settings.countdown.targetEpochSeconds;
    countdown["armed"] = settings.countdown.armed;
    String serialized;
    if (doc.overflowed() || serializeJson(doc, serialized) == 0) return false;
    if (preferences_.getString(settingsKey, "") == serialized) return true;
    return preferences_.putString(settingsKey, serialized) == serialized.length();
}

bool SettingsStore::saveCredentials(const Credentials& credentials) {
    return ready_ && preferences_.putBytes(wifiKey, &credentials, sizeof(credentials)) == sizeof(credentials);
}

}
