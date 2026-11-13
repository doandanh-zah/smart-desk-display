#pragma once

#include <ArduinoJson.h>
#include <stdint.h>

namespace desk::remote {

class PollSchedule {
public:
    static constexpr uint32_t legacyMs = 20000;
    static constexpr uint32_t idleMs = 60000;
    static constexpr uint32_t interactiveMs = 3000;

    uint32_t afterSuccess(uint32_t now, bool newAck, uint32_t hintMs) {
        if (newAck) return 1000;
        if (hintMs != interactiveMs) return hintMs == idleMs ? idleMs : legacyMs;
        if (fastPolls_ == 0 || now - windowStart_ >= 86400000u) {
            windowStart_ = now;
            fastPolls_ = 0;
        }
        if (fastPolls_ >= 600) return idleMs;
        ++fastPolls_;
        return hintMs;
    }

    static uint32_t hint(JsonVariantConst value) {
        if (!value.is<uint32_t>()) return legacyMs;
        const auto ms = value.as<uint32_t>();
        return ms == idleMs || ms == interactiveMs ? ms : legacyMs;
    }

private:
    uint32_t windowStart_ = 0;
    uint16_t fastPolls_ = 0;
};

}
