#include "desk/App.h"

#include <esp_timer.h>
#include <time.h>

namespace desk {
namespace {
constexpr char version[] = "1.2.2";
constexpr char setupAddress[] = "192.168.4.1";
constexpr time_t validEpoch = 1704067200;

ApiResult invalid(const char* field) {
    return {"400 Bad Request", "invalid_field", "A request field is invalid or unsupported.", field};
}

ApiResult unavailable() {
    return {"503 Service Unavailable", "storage_unavailable", "Settings could not be saved."};
}

void writeNullableString(JsonObject object, const char* key, const char* value) {
    // Assignment through the member proxy creates the key, even for a null value.
    if (value && value[0]) object[key] = value;
    else object[key] = nullptr;
}

bool rotationChanged(const Settings& a, const Settings& b) {
    if (a.rotationEnabled != b.rotationEnabled || a.rotationSeconds != b.rotationSeconds ||
        a.rotationCount != b.rotationCount) return true;
    for (uint8_t i = 0; i < a.rotationCount; ++i) {
        if (a.rotationModes[i] != b.rotationModes[i]) return true;
    }
    return false;
}
}

void App::begin() {
    bootAt_ = millis();
    Credentials saved;
    store_.begin(settings_, saved);
    countdown_.load(settings_.countdown, bootAt_, 0);
    mode_ = settings_.startupMode;
    hostname_ = settings_.hostname();
    rotationAt_ = bootAt_;
    display_.begin();
    render();
    wifi_.begin(saved, hostname_, millis());
    remote_.begin();
}

void App::updateTime() {
    if (wifi_.connected() && (!ntpStarted_ || ntpRequested_)) {
        configTzTime("ICT-7", "pool.ntp.org", "time.cloudflare.com", "time.google.com");
        ntpStarted_ = true;
        ntpRequested_ = false;
    }
    const time_t now = time(nullptr);
    epoch_ = now >= validEpoch ? now : 0;
}

void App::rotate(uint32_t now) {
    if (!settings_.rotationEnabled || now - rotationAt_ < settings_.rotationSeconds * 1000u) return;
    rotationAt_ = now;
    uint8_t next = 0;
    for (uint8_t i = 0; i < settings_.rotationCount; ++i) {
        if (settings_.rotationModes[i] == mode_) {
            next = (i + 1) % settings_.rotationCount;
            break;
        }
    }
    mode_ = settings_.rotationModes[next];
}

void App::tick() {
    const uint32_t now = millis();
    if (restarting_ && now - restartAt_ >= 750) ESP.restart();
    wifi_.tick(hostname_, store_, now);
    updateTime();
    timer_.tick(now);
    countdown_.tick(now, epoch_);
    integrations_.tick(epoch_);
    if (!wifi_.setupActive()) rotate(now);
    else rotationAt_ = now;
    // GitHub schedules first. Hold its scheduling while the remote TLS worker owns the heap.
    if (!remote_.busy()) github_.tick(settings_, wifi_.connected(), epoch_ > 0);
    remote_.tick(*this, wifi_.connected() && !wifi_.setupActive(), epoch_, now);
    if (now - lastRender_ >= 50) {
        lastRender_ = now;
        render();
    }
}

void App::render() {
    display::Frame frame;
    if (millis() - bootAt_ >= 1500) {
        frame.view = wifi_.setupActive() ? display::View::Setup : display::View::Content;
    }
    frame.mode = mode_;
    frame.theme = settings_.theme;
    frame.deviceName = settings_.deviceName.c_str();
    frame.wifiConnected = wifi_.connected();
    frame.ipAddress = wifi_.ip().c_str();
    frame.setupSsid = wifi_.setupSsid();
    frame.setupPassword = wifi_.setupPassword();
    frame.setupIp = setupAddress;
    frame.configuredGitHubUsername = settings_.githubUsername.c_str();
    frame.github = github_.data();
    frame.github.error = githubErrorMessage(frame.github.error);
    frame.pomodoro = timer_.data();
    const auto& countdown = countdown_.config();
    frame.countdown = {
        countdown.targetEpochSeconds ? display::CountdownKind::Target : display::CountdownKind::Duration,
        countdown_.state(), countdown.durationSeconds, countdown.targetEpochSeconds, countdown_.remaining(epoch_),
    };
    frame.calendar = &integrations_.calendar();
    frame.codex = &integrations_.codex();
    frame.claude = &integrations_.claude();
    frame.message = {settings_.text.c_str(), settings_.alignment, settings_.color, settings_.size};
    frame.clock.showSeconds = settings_.clockShowSeconds;
    struct tm local;
    if (epoch_ > 0 && localtime_r(&epoch_, &local)) {
        frame.clock.synced = true;
        frame.clock.year = local.tm_year + 1900;
        frame.clock.month = local.tm_mon + 1;
        frame.clock.day = local.tm_mday;
        frame.clock.weekday = local.tm_wday;
        frame.clock.hours = local.tm_hour;
        frame.clock.minutes = local.tm_min;
        frame.clock.seconds = local.tm_sec;
    }
    display_.render(frame);
}

bool App::allowsRequest(const IPAddress& local, const String& host, const String& origin, bool setup) const {
    const String address = local.toString();
    String bareHost = host;
    bareHost.toLowerCase();
    if (bareHost.endsWith(":80")) bareHost.remove(bareHost.length() - 3);

    if (!origin.isEmpty() && origin != "http://" + bareHost && origin != "http://" + bareHost + ":80") return false;
    if (setup) return wifi_.setupActive() && address == setupAddress && bareHost == setupAddress;
    return wifi_.connected() && address == wifi_.ip() &&
        (bareHost == address || (!wifi_.hostname().isEmpty() && bareHost == wifi_.hostname()));
}

void App::githubStatus(JsonObject out) const {
    const auto& data = github_.data();
    out["state"] = githubStateName(data.state);
    writeNullableString(out, "lastSync", data.lastSync);
    writeNullableString(out, "error", data.error);
}

void App::timerStatus(JsonObject out) const {
    static constexpr const char* states[] = {"idle", "running", "paused", "completed"};
    const auto& timer = timer_.data();
    out["phase"] = timer.phase == display::TimerPhase::Focus ? "focus" : "break";
    out["state"] = states[static_cast<uint8_t>(timer.state)];
    out["remainingSeconds"] = timer.remainingSeconds;
    out["focusMinutes"] = timer.focusMinutes;
    out["breakMinutes"] = timer.breakMinutes;
}

void App::countdownStatus(JsonObject out) const {
    static constexpr const char* states[] = {"idle", "running", "paused", "completed", "waiting_for_time"};
    const auto& config = countdown_.config();
    out["kind"] = config.targetEpochSeconds ? "target" : "duration";
    out["state"] = states[static_cast<uint8_t>(countdown_.state())];
    out["durationSeconds"] = config.durationSeconds;
    if (config.targetEpochSeconds) out["targetEpochSeconds"] = config.targetEpochSeconds;
    else out["targetEpochSeconds"] = nullptr;
    const auto seconds = countdown_.remaining(epoch_);
    if (seconds < 0) out["remainingSeconds"] = nullptr;
    else out["remainingSeconds"] = seconds;
}

ApiResult App::countdownCommand(JsonObjectConst input, JsonObject out, uint32_t now) {
    String action;
    if (!readString(input["action"], action)) return invalid("action");
    Settings candidate = settings_;
    auto& config = candidate.countdown;
    if (action == "configure") {
        String kind;
        if (input.size() != 3 || !readString(input["kind"], kind)) return invalid("kind");
        if (kind == "duration") {
            const auto duration = input["durationSeconds"];
            if (!duration.is<uint32_t>() || !duration.as<uint32_t>() ||
                duration.as<uint32_t>() > maxCountdownDuration) return invalid("durationSeconds");
            config = {duration.as<uint32_t>(), 0, false};
        } else if (kind == "target") {
            const auto target = input["targetEpochSeconds"];
            if (!target.is<uint64_t>() || target.as<uint64_t>() < firstCountdownEpoch ||
                target.as<uint64_t>() > lastCountdownEpoch) return invalid("targetEpochSeconds");
            config.targetEpochSeconds = target.as<uint64_t>();
            config.armed = true;
        } else {
            return invalid("kind");
        }
        if (!save(candidate)) return unavailable();
        countdown_.load(config, now, epoch_);
    } else {
        if (input.size() != 1 || (action != "start" && action != "pause" && action != "reset")) {
            return invalid("action");
        }
        if (config.targetEpochSeconds) {
            if (action == "pause") return {"409 Conflict", "action_not_supported", "A target countdown cannot pause."};
            const bool armed = action == "start";
            if (config.armed != armed) {
                config.armed = armed;
                if (!save(candidate)) return unavailable();
                countdown_.load(config, now, epoch_);
            }
        } else if (action == "start") {
            countdown_.start(now);
        } else if (action == "pause") {
            countdown_.pause(now);
        } else {
            countdown_.load(config, now, epoch_);
        }
    }
    countdownStatus(out);
    return {};
}

void App::status(JsonObject out) const {
    out["deviceName"] = settings_.deviceName;
    out["mode"] = modeName(mode_);
    JsonObject wifi = out["wifi"].to<JsonObject>();
    wifi["connected"] = wifi_.connected();
    writeNullableString(wifi, "ip", wifi_.ip().c_str());
    writeNullableString(wifi, "hostname", wifi_.hostname().c_str());
    wifi["provisioning"] = wifi_.setupActive();
    out["uptimeSeconds"] = static_cast<uint64_t>(esp_timer_get_time() / 1000000);
    out["firmwareVersion"] = version;
    JsonObject time = out["time"].to<JsonObject>();
    time["synced"] = epoch_ > 0;
    if (epoch_ > 0) time["epochSeconds"] = epoch_;
    else time["epochSeconds"] = nullptr;
    time["timezone"] = "Asia/Ho_Chi_Minh";
    time["utcOffsetMinutes"] = 420;
    githubStatus(out["github"].to<JsonObject>());
    timerStatus(out["pomodoro"].to<JsonObject>());
    countdownStatus(out["countdown"].to<JsonObject>());
}

ApiResult App::get(const String& path, JsonDocument& response) const {
    JsonObject out = response.to<JsonObject>();
    if (path == "/api/status") {
        status(out);
    } else if (path == "/api/config") {
        writeSettings(out, settings_);
    } else if (path == "/api/countdown") {
        countdownStatus(out);
    } else if (path == "/api/integrations" || path == "/api/calendar" ||
               path == "/api/quota/codex" || path == "/api/quota/claude") {
        integrations_.write(out, path);
    } else if (path == "/api/github") {
        githubStatus(out);
        const auto& data = github_.data();
        out["username"] = data.username;
        if (data.levels) {
            char levels[365] = {};
            for (size_t i = 0; i < 364; ++i) levels[i] = '0' + data.levels[i];
            out["levels"] = String(levels);
            out["totalContributions"] = data.totalContributions;
            out["currentStreak"] = data.currentStreak;
        } else {
            out["levels"] = "";
            out["totalContributions"] = nullptr;
            out["currentStreak"] = nullptr;
        }
        if (data.repositoryCount >= 0) out["repositoryCount"] = data.repositoryCount;
        else out["repositoryCount"] = nullptr;
    } else if (path == "/api/provision/status") {
        static constexpr const char* states[] = {"idle", "connecting", "connected", "failed"};
        const auto state = wifi_.provisionState();
        out["state"] = states[static_cast<uint8_t>(state)];
        writeNullableString(out, "ip", state == ProvisionState::Connected ? wifi_.ip().c_str() : nullptr);
        writeNullableString(out, "error", wifi_.provisionError());
    } else {
        return {"404 Not Found", "not_found", "API route not found."};
    }
    return {};
}

bool App::remoteSnapshot(JsonDocument& response) const {
    JsonDocument snapshot;
    get("/api/status", snapshot);
    if (snapshot.overflowed()) return false;
    snapshot["wifi"]["ip"] = nullptr;
    snapshot["wifi"]["hostname"] = nullptr;
    response["status"].set(snapshot.as<JsonObjectConst>());

    get("/api/config", snapshot);
    if (snapshot.overflowed()) return false;
    snapshot.remove("githubProxyUrl");
    response["config"].set(snapshot.as<JsonObjectConst>());

    get("/api/github", snapshot);
    if (snapshot.overflowed()) return false;
    response["github"].set(snapshot.as<JsonObjectConst>());
    return !response.overflowed();
}

bool App::save(const Settings& candidate) {
    if (!store_.save(candidate)) return false;
    if (rotationChanged(settings_, candidate)) rotationAt_ = millis();
    if (settings_.deviceName != candidate.deviceName) hostname_ = candidate.hostname();
    if (settings_.githubUsername != candidate.githubUsername || settings_.githubProxyUrl != candidate.githubProxyUrl) {
        github_.invalidate();
    }
    settings_ = candidate;
    return true;
}

ApiResult App::post(const String& path, JsonObjectConst input, JsonDocument& response) {
    JsonObject out = response.to<JsonObject>();
    out["ok"] = true;
    const uint32_t now = millis();

    if (restarting_) return {"409 Conflict", "busy", "The device is restarting."};
    if (path == "/api/config") {
        Settings candidate = settings_;
        if (const char* error = applySettings(input, candidate)) return invalid(error);
        if (!save(candidate)) return unavailable();
        writeSettings(out["config"].to<JsonObject>(), settings_);
    } else if (path == "/api/display") {
        Settings candidate = settings_;
        if (input.size() != 1 || !parseMode(input["mode"], candidate.startupMode)) return invalid("mode");
        if (!save(candidate)) return unavailable();
        mode_ = candidate.startupMode;
        rotationAt_ = now;
        out["mode"] = modeName(mode_);
    } else if (path == "/api/message") {
        Settings candidate = settings_;
        if (const char* error = applyMessage(input, candidate)) return invalid(error);
        if (!save(candidate)) return unavailable();
        writeMessage(out["message"].to<JsonObject>(), settings_);
    } else if (path == "/api/countdown") {
        return countdownCommand(input, out["countdown"].to<JsonObject>(), now);
    } else if (path == "/api/pomodoro") {
        String action;
        if (input.size() != 1 || !readString(input["action"], action)) return invalid("action");
        if (action == "start") timer_.start(now);
        else if (action == "pause") timer_.pause(now);
        else if (action == "reset") timer_.reset();
        else return invalid("action");
        timerStatus(out["pomodoro"].to<JsonObject>());
    } else if (path == "/api/time/sync") {
        if (input.size() != 0) return invalid("time");
        if (!wifi_.connected()) return {"409 Conflict", "busy", "Wi-Fi is disconnected."};
        ntpRequested_ = true;
    } else if (path == "/api/restart") {
        if (input.size() != 1 || !input["confirm"].is<bool>() || !input["confirm"].as<bool>()) {
            return invalid("confirm");
        }
        restarting_ = true;
        restartAt_ = now;
    } else if (path == "/api/provision") {
        String ssid;
        String password;
        if (input.size() != 2 || !readString(input["ssid"], ssid) || !validCredentials(ssid, "")) {
            return invalid("ssid");
        }
        if (!readString(input["password"], password) || !validCredentials(ssid, password)) return invalid("password");
        Credentials candidate;
        ssid.toCharArray(candidate.ssid, sizeof(candidate.ssid));
        password.toCharArray(candidate.password, sizeof(candidate.password));
        if (!wifi_.provision(candidate, now)) return {"409 Conflict", "busy", "Setup is already in progress."};
        return {"202 Accepted"};
    } else {
        return {"404 Not Found", "not_found", "API route not found."};
    }

    return {};
}

}
