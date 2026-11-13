#include "desk/Integrations.h"

namespace desk {
namespace {
using display::SourceState;
constexpr char calendarSource[] = "google_calendar";
constexpr uint64_t maxEpoch = 4102444799;

const char* stateName(SourceState state) {
    switch (state) {
        case SourceState::Live: return "live";
        case SourceState::Stale: return "stale";
        case SourceState::Unsupported: return "unsupported";
        default: return "unavailable";
    }
}

bool readState(JsonObjectConst object, SourceState& state, uint64_t& epoch, uint64_t now) {
    const auto name = object["state"].as<JsonString>();
    if (name == "unavailable") state = SourceState::NotConnected;
    else if (name == "unsupported") state = SourceState::Unsupported;
    else if (name == "live") state = SourceState::Live;
    else if (name == "stale") state = SourceState::Stale;
    else return false;
    const auto observed = object["observedAt"];
    if (!observed.is<JsonVariantConst>()) return false;
    if (!observed.isNull() && !observed.is<uint64_t>()) return false;
    epoch = observed.as<uint64_t>();
    if (epoch > maxEpoch || (epoch > now && epoch - now > 90)) return false;
    return (state != SourceState::Live && state != SourceState::Stale) || epoch > 0;
}

bool usable(SourceState state) {
    return state == SourceState::Live || state == SourceState::Stale;
}

char tftLetter(uint32_t codePoint) {
    if (codePoint >= 32 && codePoint <= 126) return static_cast<char>(codePoint);
    // Vietnamese letters in Latin Extended Additional are uppercase/lowercase pairs.
    if (codePoint >= 0x1EA0 && codePoint <= 0x1EF9) {
        char base = 'Y';
        if (codePoint < 0x1EB8) base = 'A';
        else if (codePoint < 0x1EC8) base = 'E';
        else if (codePoint < 0x1ECC) base = 'I';
        else if (codePoint < 0x1EE4) base = 'O';
        else if (codePoint < 0x1EF2) base = 'U';
        return codePoint % 2 ? base + ('a' - 'A') : base;
    }
    switch (codePoint) {
        case 0x00C0: case 0x00C1: case 0x00C2: case 0x00C3: case 0x0102: return 'A';
        case 0x00E0: case 0x00E1: case 0x00E2: case 0x00E3: case 0x0103: return 'a';
        case 0x0110: return 'D';
        case 0x0111: return 'd';
        case 0x00C8: case 0x00C9: case 0x00CA: return 'E';
        case 0x00E8: case 0x00E9: case 0x00EA: return 'e';
        case 0x00CC: case 0x00CD: case 0x0128: return 'I';
        case 0x00EC: case 0x00ED: case 0x0129: return 'i';
        case 0x00D2: case 0x00D3: case 0x00D4: case 0x00D5: case 0x01A0: return 'O';
        case 0x00F2: case 0x00F3: case 0x00F4: case 0x00F5: case 0x01A1: return 'o';
        case 0x00D9: case 0x00DA: case 0x0168: case 0x01AF: return 'U';
        case 0x00F9: case 0x00FA: case 0x0169: case 0x01B0: return 'u';
        case 0x00DD: return 'Y';
        case 0x00FD: return 'y';
        case 0x2013: case 0x2014: return '-';
        case 0x2018: case 0x2019: return '\'';
        case 0x201C: case 0x201D: return '"';
        default: return 0;
    }
}

void tftTitle(const char* title, char (&out)[41]) {
    const auto* next = reinterpret_cast<const unsigned char*>(title);
    size_t length = 0;
    bool space = false;
    while (*next && length < sizeof(out) - 1) {
        uint32_t codePoint = *next++;
        if (codePoint >= 0xC2 && codePoint <= 0xEF) {
            const unsigned continuation = codePoint < 0xE0 ? 1 : 2;
            codePoint &= continuation == 1 ? 0x1F : 0x0F;
            unsigned i = 0;
            for (; i < continuation && (*next & 0xC0) == 0x80; ++i) {
                codePoint = (codePoint << 6) | (*next++ & 0x3F);
            }
            if (i != continuation) continue;
        } else if (codePoint > 126) {
            continue;
        }
        const char letter = tftLetter(codePoint);
        if (letter == ' ') space = length > 0;
        if (!letter || letter == ' ') continue;
        if (space && length + 1 < sizeof(out) - 1) out[length++] = ' ';
        space = false;
        out[length++] = letter;
    }
    out[length] = '\0';
    if (!length) strcpy(out, "Calendar event");
}

template<size_t Capacity>
bool copyText(JsonVariantConst input, char (&buffer)[Capacity]) {
    const auto text = input.as<JsonString>();
    if (text.isNull() || !text.size() || text.size() >= Capacity || strlen(text.c_str()) != text.size()) return false;
    for (size_t i = 0; i < text.size(); ++i) {
        const auto ch = static_cast<unsigned char>(text.c_str()[i]);
        if (ch < 32 || ch == 127) return false;
    }
    memcpy(buffer, text.c_str(), text.size() + 1);
    return true;
}

void writeEpoch(JsonObject out, const char* key, uint64_t value) {
    if (value) out[key] = value;
    else out[key] = nullptr;
}
}

bool Integrations::update(JsonVariantConst input, uint64_t now) {
    if (!input["v"].is<uint8_t>() || input["v"].as<uint8_t>() != 1) return false;

    Integrations next;
    const auto calendar = input["calendar"].as<JsonObjectConst>();
    const auto events = calendar["events"].as<JsonArrayConst>();
    if (measureJson(calendar) > 2048 || calendar["source"].as<JsonString>() != calendarSource || events.isNull() || events.size() > 3 ||
        !copyText(calendar["timeZone"], next.timeZone_) ||
        !readState(calendar, next.calendar_.state, next.calendar_.updatedAt, now)) return false;
    if (usable(next.calendar_.state)) {
        for (const auto item : events) {
            if (!item["start"].is<uint64_t>() || !item["end"].is<uint64_t>() || !item["allDay"].is<bool>()) return false;
            const auto start = item["start"].as<uint64_t>();
            const auto end = item["end"].as<uint64_t>();
            if (!start || end <= start || end > maxEpoch) return false;
            const auto index = next.calendar_.count++;
            auto& event = next.calendar_.events[index];
            if (!copyText(item["title"], next.titles_[index])) {
                // Backend allows longer Unicode titles. Keep a generic local title instead of truncating UTF-8.
                if (!item["title"].is<const char*>()) return false;
                strcpy(next.titles_[index], "Calendar event");
            }
            tftTitle(next.titles_[index], event.title);
            event.startEpochSeconds = start;
            event.endEpochSeconds = end;
            event.allDay = item["allDay"].as<bool>();
        }
    }

    next.tick(now);
    *this = next;
    return true;
}

void Integrations::tick(uint64_t now) {
    if (!now) return;
    if (usable(calendar_.state)) {
        const uint64_t age = now > calendar_.updatedAt ? now - calendar_.updatedAt : 0;
        if (age >= 3600) calendar_ = display::CalendarData{};
        else {
            if (age >= 300) calendar_.state = SourceState::Stale;
            uint8_t count = 0;
            for (uint8_t i = 0; i < calendar_.count; ++i) {
                if (calendar_.events[i].endEpochSeconds <= now) continue;
                if (count != i) {
                    calendar_.events[count] = calendar_.events[i];
                    memcpy(titles_[count], titles_[i], sizeof(titles_[count]));
                }
                ++count;
            }
            calendar_.count = count;
        }
    }
}

void Integrations::writeCalendar(JsonObject out) const {
    out["source"] = calendarSource;
    out["state"] = stateName(calendar_.state);
    writeEpoch(out, "observedAt", calendar_.updatedAt);
    out["timeZone"] = timeZone_;
    auto events = out["events"].to<JsonArray>();
    for (uint8_t i = 0; i < calendar_.count; ++i) {
        auto item = events.add<JsonObject>();
        item["title"] = titles_[i];
        item["start"] = calendar_.events[i].startEpochSeconds;
        item["end"] = calendar_.events[i].endEpochSeconds;
        item["allDay"] = calendar_.events[i].allDay;
    }
}

}
