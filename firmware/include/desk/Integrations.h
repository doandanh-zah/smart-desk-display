#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "display/DisplayManager.h"

namespace desk {

class Integrations {
public:
    bool update(JsonVariantConst input, uint64_t now);
    void tick(uint64_t now);
    void write(JsonObject out, const String& route) const;

    const display::CalendarData& calendar() const { return calendar_; }
    const display::QuotaData& codex() const { return quotas_[0]; }
    const display::QuotaData& claude() const { return quotas_[1]; }

private:
    void writeCalendar(JsonObject out) const;
    void writeQuota(JsonObject out, unsigned provider) const;

    display::CalendarData calendar_;
    display::QuotaData quotas_[2];
    char titles_[3][65] = {};
    char timeZone_[65] = "Asia/Ho_Chi_Minh";
    uint32_t minutes_[2][2] = {};
    double percentages_[2][2] = {{-1, -1}, {-1, -1}};
};

}
