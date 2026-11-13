#pragma once

#include <ArduinoJson.h>
#include <stdint.h>
#include <string.h>

namespace desk::remote {

constexpr size_t idLength = 32;
constexpr size_t tokenLength = 64;
constexpr uint64_t commandTtl = 90;
constexpr uint64_t ackRetention = 86400;
constexpr size_t historyCapacity = 12;

inline bool hex(const char* value, size_t length) {
    if (!value || strlen(value) != length) return false;
    for (size_t i = 0; i < length; ++i) {
        const char ch = value[i];
        if (!(ch >= '0' && ch <= '9') && !(ch >= 'a' && ch <= 'f')) return false;
    }
    return true;
}

inline bool hex(JsonVariantConst value, size_t length) {
    const auto text = value.as<JsonString>();
    return text.size() == length && hex(text.c_str(), length);
}

enum class Result : uint8_t { Applied, Rejected };
struct Seen {
    char id[idLength + 1] = {};
    uint64_t expiresAt = 0;
};
struct Journal {
    uint32_t version = 1;
    Seen latest;
    char code[49] = {};
    Result result = Result::Rejected;
    bool pending = false;
    Seen history[historyCapacity] = {};

    bool seen(const char* id) const {
        for (const Seen& entry : history) if (strcmp(entry.id, id) == 0) return true;
        return false;
    }

    bool reserve(const char* id, uint64_t expiresAt, uint64_t now) {
        for (Seen& entry : history) {
            // Retain the maximum future validity window as protection against modest clock corrections.
            if (entry.id[0] && (now <= entry.expiresAt || now - entry.expiresAt <= commandTtl)) continue;
            memcpy(entry.id, id, sizeof(entry.id));
            entry.expiresAt = expiresAt;
            latest = entry;
            finish("outcome_unknown");
            pending = true;
            return true;
        }
        return false;
    }

    void finish(const char* error) {
        result = error ? Result::Rejected : Result::Applied;
        if (error) {
            strncpy(code, error, sizeof(code) - 1);
            code[sizeof(code) - 1] = 0;
        } else {
            code[0] = 0;
        }
    }
};

inline const char* route(JsonVariantConst type, JsonObjectConst payload) {
    const auto name = type.as<JsonString>();
    if (name == "display") return "/api/display";
    if (name == "countdown") return "/api/countdown";
    if (name == "pomodoro") return "/api/pomodoro";
    if (name == "message") {
        if (payload.size() != 4 || !payload["text"].is<const char*>() ||
            !payload["alignment"].is<const char*>() || !payload["color"].is<const char*>() ||
            !payload["size"].is<uint8_t>()) return nullptr;
        return "/api/message";
    }
    if (name == "config") {
        if (payload.size() == 0) return nullptr;
        for (auto member : payload) {
            if (member.key() == "theme" || member.key() == "clockShowSeconds") continue;
            if (member.key() != "rotation") return nullptr;
            const auto rotation = member.value().as<JsonObjectConst>();
            if (rotation.size() != 3 || !rotation["enabled"].is<bool>() ||
                !rotation["intervalSeconds"].is<uint16_t>() || !rotation["modes"].is<JsonArrayConst>()) return nullptr;
        }
        return "/api/config";
    }
    return nullptr;
}

}
