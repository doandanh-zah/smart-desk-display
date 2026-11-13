#pragma once

#include "desk/GitHub.h"
#include "desk/Integrations.h"
#include "desk/RemoteAdmin.h"
#include "desk/Timer.h"
#include "desk/WifiService.h"

namespace desk {

struct ApiResult {
    const char* status = "200 OK";
    const char* code = nullptr;
    const char* message = nullptr;
    const char* field = nullptr;
};

class App {
public:
    void begin();
    void tick();
    bool allowsRequest(const IPAddress& local, const String& host, const String& origin, bool setup) const;
    ApiResult get(const String& path, JsonDocument& response) const;
    bool remoteSnapshot(JsonDocument& response) const;
    bool updateIntegrations(JsonVariantConst input, uint64_t now) { return integrations_.update(input, now); }
    ApiResult post(const String& path, JsonObjectConst input, JsonDocument& response);

private:
    void updateTime();
    void rotate(uint32_t now);
    bool save(const Settings& candidate);
    void status(JsonObject out) const;
    void githubStatus(JsonObject out) const;
    void timerStatus(JsonObject out) const;
    void countdownStatus(JsonObject out) const;
    ApiResult countdownCommand(JsonObjectConst input, JsonObject out, uint32_t now);
    void render();

    Settings settings_;
    SettingsStore store_;
    WifiService wifi_;
    GitHub github_;
    RemoteAdmin remote_;
    Timer timer_;
    Countdown countdown_;
    Integrations integrations_;
    display::DisplayManager display_;
    display::Mode mode_ = display::Mode::GitHub;
    String hostname_;
    uint32_t bootAt_ = 0;
    uint32_t rotationAt_ = 0;
    uint32_t lastRender_ = 0;
    uint32_t restartAt_ = 0;
    bool restarting_ = false;
    bool ntpRequested_ = false;
    bool ntpStarted_ = false;
    time_t epoch_ = 0;
};

}
