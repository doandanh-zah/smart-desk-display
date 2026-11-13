#include <Arduino.h>
#include "desk/Integrations.h"

#include <math.h>

namespace desk {
namespace {
using display::SourceState;
constexpr char calendarSource[] = "google_calendar";
constexpr const char* quotaSources[] = {"codex_app_server", "claude_code_statusline"};
constexpr const char* windowIds[][2] = {{"primary", "secondary"}, {"five_hour", "seven_day"}};
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

bool decimalBalance(JsonVariantConst input, char (&out)[65]) {
    if (input.isNull()) return true;
    if (!copyText(input, out)) return false;
    bool dot = false;
    unsigned digits = 0;
    for (const char* ch = out; *ch; ++ch) {
        if (*ch >= '0' && *ch <= '9') ++digits;
        else if (*ch == '.' && !dot && digits && ch[1]) dot = true;
        else return false;
    }
    return digits != 0;
}

bool optionalEpoch(JsonVariantConst input, uint64_t& out) {
    if (!input.isNull() && (!input.is<uint64_t>() || !input.as<uint64_t>() || input.as<uint64_t>() > maxEpoch)) {
        return false;
    }
    out = input.as<uint64_t>();
    return true;
}

void writeEpoch(JsonObject out, const char* key, uint64_t value) {
    if (value) out[key] = value;
    else out[key] = nullptr;
}
}

bool Integrations::update(JsonVariantConst input, uint64_t now) {
    if (!input["v"].is<uint8_t>() || input["v"].as<uint8_t>() != 1 || measureJson(input) > 2048) return false;

    Integrations next;
    const auto calendar = input["calendar"].as<JsonObjectConst>();
    const auto events = calendar["events"].as<JsonArrayConst>();
    if (calendar["source"].as<JsonString>() != calendarSource || events.isNull() || events.size() > 3 ||
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

    for (unsigned provider = 0; provider < 2; ++provider) {
        auto& target = next.quotas_[provider];
        const auto quota = input["quotas"][provider == 0 ? "codex" : "claude"].as<JsonObjectConst>();
        const auto windows = quota["windows"].as<JsonArrayConst>();
        if (quota["source"].as<JsonString>() != quotaSources[provider] ||
            quota["kind"].as<JsonString>() != "subscription" || windows.isNull() || windows.size() > 2 ||
            !readState(quota, target.state, target.updatedAt, now)) return false;
        if (!usable(target.state)) continue;
        unsigned seen = 0;
        for (const auto item : windows) {
            const auto id = item["id"].as<JsonString>();
            const int slot = id == windowIds[provider][0] ? 0 : id == windowIds[provider][1] ? 1 : -1;
            if (slot < 0 || (seen & (1u << slot))) return false;
            seen |= 1u << slot;
            const auto percent = item["usedPercent"];
            const auto reset = item["resetsAt"];
            const auto minutes = item["windowMinutes"];
            if (!percent.is<JsonVariantConst>() || !reset.is<JsonVariantConst>() ||
                !minutes.is<JsonVariantConst>() || (!percent.isNull() && !percent.is<double>()) ||
                (!reset.isNull() && !reset.is<uint64_t>()) ||
                (!minutes.isNull() && (!minutes.is<uint32_t>() || !minutes.as<uint32_t>()))) return false;
            const double used = percent.isNull() ? -1 : percent.as<double>();
            if ((!percent.isNull() && (!isfinite(used) || used < 0 || used > 100)) ||
                reset.as<uint64_t>() > maxEpoch) return false;
            const auto index = target.count++;
            auto& window = target.windows[index];
            strcpy(window.label, windowIds[provider][slot]);
            window.usedPercent = used < 0 ? -1 : static_cast<int16_t>(used + 0.5);
            window.resetEpochSeconds = reset.as<uint64_t>();
            window.windowMinutes = minutes.as<uint32_t>();
            next.percentages_[provider][index] = used;
        }

        if (provider != 0) continue;
        const auto credit = quota["credit"];
        if (!credit.isNull()) {
            CreditDetails candidate;
            if (credit["unit"].as<JsonString>() == "credits" && credit["hasCredits"].is<bool>() &&
                credit["unlimited"].is<bool>() && decimalBalance(credit["balance"], candidate.balance) &&
                optionalEpoch(credit["resetsAt"], candidate.resetAt)) {
                next.codexCredit_ = candidate;
                target.creditAvailable = true;
                target.hasCredits = credit["hasCredits"].as<bool>();
                target.creditUnlimited = credit["unlimited"].as<bool>();
                if (strlen(candidate.balance) < sizeof(target.creditBalance)) {
                    strcpy(target.creditBalance, candidate.balance);
                }
            }
        }
        const auto resets = quota["resetCredits"];
        if (!resets.isNull() && resets["availableCount"].is<int32_t>() && resets["availableCount"].as<int32_t>() >= 0 &&
            optionalEpoch(resets["expiresAt"], next.codexCredit_.resetCreditsExpireAt)) {
            target.resetCredits = resets["availableCount"].as<int32_t>();
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
    if (usable(quotas_[0].state)) {
        if (codexCredit_.resetAt && now >= codexCredit_.resetAt) quotas_[0].state = SourceState::Stale;
        if (codexCredit_.resetCreditsExpireAt && now >= codexCredit_.resetCreditsExpireAt) {
            // Only the earliest expiry is known. Keep the last observed count with a stale label.
            quotas_[0].state = SourceState::Stale;
        }
    }
    for (auto& quota : quotas_) {
        if (!usable(quota.state)) continue;
        const uint64_t age = now > quota.updatedAt ? now - quota.updatedAt : 0;
        if (age >= 86400) {
            quota = display::QuotaData{};
            continue;
        }
        if (age >= 900) quota.state = SourceState::Stale;
        for (uint8_t i = 0; i < quota.count; ++i) {
            const auto reset = quota.windows[i].resetEpochSeconds;
            if (reset && now >= reset) quota.state = SourceState::Stale;
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

void Integrations::writeQuota(JsonObject out, unsigned provider) const {
    const auto& quota = quotas_[provider];
    out["source"] = quotaSources[provider];
    out["kind"] = "subscription";
    out["state"] = stateName(quota.state);
    writeEpoch(out, "observedAt", quota.updatedAt);
    out["credit"] = nullptr;
    out["resetCredits"] = nullptr;
    if (provider == 0 && quota.creditAvailable) {
        auto credit = out["credit"].to<JsonObject>();
        if (codexCredit_.balance[0]) credit["balance"] = codexCredit_.balance;
        else credit["balance"] = nullptr;
        credit["unit"] = "credits";
        credit["hasCredits"] = quota.hasCredits;
        credit["unlimited"] = quota.creditUnlimited;
        writeEpoch(credit, "resetsAt", codexCredit_.resetAt);
    }
    if (provider == 0 && quota.resetCredits >= 0) {
        auto resets = out["resetCredits"].to<JsonObject>();
        resets["availableCount"] = quota.resetCredits;
        writeEpoch(resets, "expiresAt", codexCredit_.resetCreditsExpireAt);
    }
    auto windows = out["windows"].to<JsonArray>();
    for (uint8_t i = 0; i < quota.count; ++i) {
        auto item = windows.add<JsonObject>();
        const auto& window = quota.windows[i];
        item["id"] = window.label;
        writeEpoch(item, "windowMinutes", window.windowMinutes);
        writeEpoch(item, "resetsAt", window.resetEpochSeconds);
        if (percentages_[provider][i] < 0) item["usedPercent"] = nullptr;
        else item["usedPercent"] = percentages_[provider][i];
        item["used"] = nullptr;
        item["limit"] = nullptr;
        item["unit"] = nullptr;
    }
}

void Integrations::write(JsonObject out, const String& route) const {
    if (route == "/api/calendar") writeCalendar(out);
    else if (route == "/api/quota/codex") writeQuota(out, 0);
    else if (route == "/api/quota/claude") writeQuota(out, 1);
    else {
        out["v"] = 1;
        writeCalendar(out["calendar"].to<JsonObject>());
        auto quotas = out["quotas"].to<JsonObject>();
        writeQuota(quotas["codex"].to<JsonObject>(), 0);
        writeQuota(quotas["claude"].to<JsonObject>(), 1);
    }
}

}
