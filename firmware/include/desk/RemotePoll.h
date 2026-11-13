#pragma once

#include <ArduinoJson.h>
#include <stdint.h>

namespace desk::remote {

class PollSchedule {
public:
    static constexpr uint32_t idleMs = 20000;

    uint32_t afterSuccess(uint32_t now, bool newAck, uint32_t hintMs) {
        if (newAck) return 1000;
        if (hintMs != 3000) return idleMs;
        if (fastPolls_ == 0 || now - windowStart_ >= 86400000u) {
            windowStart_ = now;
            fastPolls_ = 0;
        }
        if (fastPolls_ >= 600) return idleMs;
        ++fastPolls_;
        return hintMs;
    }

    static uint32_t hint(JsonVariantConst value) {
        return value.is<uint32_t>() && value.as<uint32_t>() == 3000 ? 3000 : idleMs;
    }

private:
    uint32_t windowStart_ = 0;
    uint16_t fastPolls_ = 0;
};

}
