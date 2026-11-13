#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "display/DisplayManager.h"

namespace desk {

class Integrations {
public:
    bool update(JsonVariantConst input, uint64_t now);
    void tick(uint64_t now);
    void writeCalendar(JsonObject out) const;

    const display::CalendarData& calendar() const { return calendar_; }

private:
    display::CalendarData calendar_;
    char titles_[3][65] = {};
    char timeZone_[65] = "Asia/Ho_Chi_Minh";
};

}
