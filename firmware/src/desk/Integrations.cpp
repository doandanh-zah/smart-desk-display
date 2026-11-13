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
            const char* title = next.titles_[index];
            bool ascii = true;
            for (const char* ch = title; *ch; ++ch) if (static_cast<unsigned char>(*ch) > 126) ascii = false;
            snprintf(event.title, sizeof(event.title), "%.40s", ascii ? title : "Calendar event");
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
            next.percentages_[provider][index] = used;
            next.minutes_[provider][index] = minutes.as<uint32_t>();
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
    auto windows = out["windows"].to<JsonArray>();
    for (uint8_t i = 0; i < quota.count; ++i) {
        auto item = windows.add<JsonObject>();
        const auto& window = quota.windows[i];
        item["id"] = window.label;
        writeEpoch(item, "windowMinutes", minutes_[provider][i]);
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
