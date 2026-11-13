#include "github/GitHubProvider.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_http_client.h>
#include <esp_tls.h>
#include <freertos/task.h>
#include <strings.h>

#include "ProxyRootCa.h"

namespace github {
namespace {

constexpr uint32_t kRefreshMs = 20 * 60 * 1000;
constexpr uint32_t kRetryMs = 60 * 1000;
constexpr uint32_t kTaskRetryMs = 5 * 1000;
constexpr int kNetworkTimeoutMs = 8000;
constexpr uint32_t kBodyDeadlineMs = 10000;
constexpr int kMaxBodyBytes = 1024;
constexpr unsigned kStackBytes = 8192;

bool isDigit(char value) { return value >= '0' && value <= '9'; }

bool isAlphanumeric(char value) {
    return isDigit(value) || (value >= 'A' && value <= 'Z') ||
           (value >= 'a' && value <= 'z');
}

bool validUsername(const char* username) {
    const size_t length = strlen(username);
    if (!length || length > 39 || !isAlphanumeric(username[length - 1])) return false;
    bool previousWasAlphanumeric = false;
    for (const char* c = username; *c; ++c) {
        if (!isAlphanumeric(*c) && (*c != '-' || !previousWasAlphanumeric)) return false;
        previousWasAlphanumeric = isAlphanumeric(*c);
    }
    return true;
}

bool validUrl(const char* url) {
    constexpr size_t prefixLength = sizeof("https://") - 1;
    if (strncmp(url, "https://", prefixLength) != 0) return false;
    const char* host = url + prefixLength;
    const size_t hostLength = strcspn(host, "/");
    const char* path = host + hostLength;
    if (!hostLength || !isAlphanumeric(*host) || !isAlphanumeric(path[-1]) ||
        url[strlen(url) - 1] == '/') return false;
    for (const char* c = host; c < path; ++c) {
        if (!isAlphanumeric(*c) && *c != '.' && *c != '-') return false;
    }
    for (const char* c = path; *c; ++c) {
        if (*c < '!' || *c > '~' || strchr("?#@\\", *c)) return false;
    }
    return true;
}

int dayNumber(const char* date) {
    for (unsigned i = 0; i < 10; ++i) {
        if ((i == 4 || i == 7) ? date[i] != '-' : !isDigit(date[i])) return -1;
    }

    const int year = atoi(date);
    const int month = atoi(date + 5);
    const int day = atoi(date + 8);
    if (year < 1970 || month < 1 || month > 12 || day < 1) return -1;
    const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    const int monthLengths[] = {31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (day > monthLengths[month - 1]) return -1;
    const int previousYear = year - 1;
    int days = (year - 1970) * 365 + previousYear / 4 - previousYear / 100 +
               previousYear / 400 - (1969 / 4 - 1969 / 100 + 1969 / 400);
    for (int m = 1; m < month; ++m) days += monthLengths[m - 1];
    return days + day - 1;
}

bool parseData(const char* bytes, size_t size, const char* username, Data& data) {
    JsonDocument doc;
    if (deserializeJson(doc, bytes, size, DeserializationOption::NestingLimit(3))) return false;

    const auto user = doc["username"].as<JsonString>();
    const auto levels = doc["levels"].as<JsonString>();
    const auto start = doc["start"].as<JsonString>();
    const auto asOf = doc["asOf"].as<JsonString>();
    const auto repos = doc["repos"].as<JsonVariantConst>();
    if (!doc["v"].is<unsigned>() || doc["v"].as<unsigned>() != 1 ||
        user.size() != strlen(username) || strcasecmp(user.c_str(), username) != 0 ||
        levels.size() != kCalendarCells || start.size() != 10 || asOf.size() != 10 ||
        !doc["total"].is<uint32_t>() || !doc["streak"].is<uint16_t>() ||
        repos.isUnbound() ||
        (!repos.isNull() && (!repos.is<int32_t>() || repos.as<int32_t>() < 0))) {
        return false;
    }

    const int firstDay = dayNumber(start.c_str());
    const int finalDay = dayNumber(asOf.c_str()) - firstDay;
    if (firstDay < 0 || (firstDay + 4) % 7 != 0 || finalDay < 51 * 7 ||
        finalDay >= static_cast<int>(kCalendarCells)) {
        return false;
    }
    uint32_t occupied = 0;
    for (unsigned i = 0; i < kCalendarCells; ++i) {
        const char value = levels.c_str()[i];
        if (value < '0' || value > '4' || (static_cast<int>(i) > finalDay && value != '0')) {
            return false;
        }
        data.levels[i] = value - '0';
        occupied += value != '0';
    }

    int streakDay = data.levels[finalDay] ? finalDay : finalDay - 1;
    uint16_t streak = 0;
    while (streakDay >= 0 && data.levels[streakDay] != 0) {
        ++streak;
        --streakDay;
    }

    const auto total = doc["total"].as<uint32_t>();
    if (doc["streak"].as<uint16_t>() != streak || total < occupied || (!occupied && total)) {
        return false;
    }
    strlcpy(data.username, user.c_str(), sizeof(data.username));
    strlcpy(data.start, start.c_str(), sizeof(data.start));
    strlcpy(data.asOf, asOf.c_str(), sizeof(data.asOf));
    data.total = total;
    data.streak = streak;
    data.repos = repos.isNull() ? -1 : repos.as<int32_t>();
    data.syncedAt = time(nullptr);
    return true;
}

struct HttpContext {
    uint32_t retryMs = kRetryMs;
    const char* transportError = "proxy_unreachable";
};

esp_err_t httpEvent(esp_http_client_event_t* event) {
    auto& context = *static_cast<HttpContext*>(event->user_data);
    if (event->event_id == HTTP_EVENT_ON_HEADER &&
        strcasecmp(event->header_key, "Retry-After") == 0) {
        const char* value = event->header_value;
        uint32_t seconds = 0;
        for (; isDigit(*value) && seconds < 86400; ++value) {
            seconds = seconds * 10 + (*value - '0');
        }
        if (seconds >= 86400) context.retryMs = 86400 * 1000;
        else if (!*value && seconds) context.retryMs = seconds * 1000;
    } else if (event->event_id == HTTP_EVENT_ERROR && event->data) {
        int tlsFlags = 0;
        const auto error = esp_tls_get_and_clear_last_error(
            static_cast<esp_tls_error_handle_t>(event->data), nullptr, &tlsFlags);
        if (tlsFlags) context.transportError = "tls_verification_failed";
        else if (error == ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT) context.transportError = "proxy_timeout";
    }
    return ESP_OK;
}

const char* statusError(int status) {
    switch (status) {
        case 400: return "invalid_username";
        case 404: return "user_not_found";
        case 429: return "rate_limited";
        case 502: return "upstream_error";
        case 503: return "proxy_unconfigured";
        case 504: return "upstream_timeout";
        default: return "proxy_http_error";
    }
}

}  // namespace

void GitHubProvider::configure(const char* username, const char* proxyUrl) {
    if (!username) username = "";
    if (!proxyUrl) proxyUrl = "";
    if (configured_ && strcmp(username, config_.username) == 0 &&
        strcmp(proxyUrl, config_.url) == 0) return;

    configured_ = true;
    enabled_ = false;
    ++generation_;
    snapshot_ = Snapshot{};
    config_ = Settings{};
    if (strlen(username) < sizeof(config_.username)) {
        strlcpy(config_.username, username, sizeof(config_.username));
        strlcpy(snapshot_.data.username, username, sizeof(snapshot_.data.username));
    }
    if (strlen(proxyUrl) <= kMaxUrl) strlcpy(config_.url, proxyUrl, sizeof(config_.url));

    if (!*username || !*proxyUrl) {
        snapshot_.status = Status::Demo;
        snapshot_.hasData = true;
        strlcpy(snapshot_.data.username, "demo", sizeof(snapshot_.data.username));
        for (unsigned i = 0; i < kCalendarCells; ++i) {
            const unsigned sample = (i * 17 + (i / 7) * 13) % 23;
            const uint8_t level = sample < 10 ? 0 : 1 + sample % 4;
            snapshot_.data.levels[i] = level;
            snapshot_.data.total += level;
        }
        for (int i = kCalendarCells - 1; i >= 0 && snapshot_.data.levels[i]; --i) {
            ++snapshot_.data.streak;
        }
    } else if (!validUsername(username)) {
        fail("invalid_username");
    } else if (strlen(proxyUrl) > kMaxUrl || !validUrl(proxyUrl)) {
        fail("invalid_proxy_url");
    } else {
        enabled_ = true;
        nextAttempt_ = millis();
    }
}

void GitHubProvider::fail(const char* code) {
    snapshot_.status = snapshot_.hasData ? Status::Stale : Status::Error;
    snapshot_.error = code;
}

void GitHubProvider::tick(bool wifiConnected, bool clockSynchronized) {
    const uint32_t now = millis();
    if (active_) {
        Result result;
        if (xQueueReceive(results_, &result, 0) == pdPASS) {
            active_ = false;
            if (jobGeneration_ == generation_) {
                if (result.error) {
                    fail(result.error);
                    nextAttempt_ = now + result.retryMs;
                } else {
                    snapshot_.status = Status::Ready;
                    snapshot_.hasData = true;
                    snapshot_.data = result.data;
                    snapshot_.error = "";
                    nextAttempt_ = now + kRefreshMs;
                }
            }
        }
    }

    if (!enabled_) return;
    if (!wifiConnected || !clockSynchronized) {
        if (snapshot_.status == Status::Ready) nextAttempt_ = now;
        fail(wifiConnected ? "waiting_for_time" : "wifi_offline");
        return;
    }
    if (active_ || static_cast<int32_t>(now - nextAttempt_) < 0) return;

    if (!results_) results_ = xQueueCreateStatic(1, sizeof(Result), queueStorage_, &queueState_);
    job_ = config_;
    jobGeneration_ = generation_;
    active_ = results_ && xTaskCreate(runJob, "github_fetch", kStackBytes, this, 1, nullptr) == pdPASS;
    if (!active_) {
        fail("worker_unavailable");
        nextAttempt_ = now + kTaskRetryMs;
    } else if (!snapshot_.hasData) {
        snapshot_.status = Status::Pending;
        snapshot_.error = "";
    }
}

void GitHubProvider::runJob(void* argument) {
    auto& provider = *static_cast<GitHubProvider*>(argument);
    const auto result = fetch(provider.job_);
    xQueueSend(provider.results_, &result, 0);
    vTaskDelete(nullptr);
}

GitHubProvider::Result GitHubProvider::fetch(const Settings& settings) {
    Result result;
    result.retryMs = kRetryMs;

    char url[kMaxUrl + sizeof("?username=") + sizeof(settings.username)];
    snprintf(url, sizeof(url), "%s?username=%s", settings.url, settings.username);

    HttpContext context;
    esp_http_client_config_t config = {};
    config.url = url;
    config.cert_pem = kProxyRootCa;
    config.timeout_ms = kNetworkTimeoutMs;
    config.disable_auto_redirect = true;
    config.max_authorization_retries = -1;
    config.event_handler = httpEvent;
    config.user_data = &context;
    config.transport_type = HTTP_TRANSPORT_OVER_SSL;
    config.user_agent = "smart-desk-display";

    auto client = esp_http_client_init(&config);
    if (!client) {
        result.error = "worker_unavailable";
        return result;
    }

    esp_http_client_set_header(client, "Accept", "application/json");
    esp_http_client_set_header(client, "Accept-Encoding", "identity");
    if (esp_http_client_open(client, 0) != ESP_OK) {
        result.error = context.transportError;
    } else {
        const int length = esp_http_client_fetch_headers(client);
        const int status = esp_http_client_get_status_code(client);
        if (length < 0 || status <= 0) {
            result.error = "proxy_response_failed";
        } else if (status != 200) {
            result.error = statusError(status);
            if (status == 429) result.retryMs = context.retryMs;
        } else if (length > kMaxBodyBytes) {
            result.error = "invalid_proxy_response";
        } else {
            char body[kMaxBodyBytes + 1];
            int used = 0;
            const uint32_t began = millis();
            while (used < static_cast<int>(sizeof(body))) {
                if (millis() - began >= kBodyDeadlineMs) {
                    result.error = "proxy_timeout";
                    break;
                }
                const int left = sizeof(body) - used;
                const int count = esp_http_client_read(client, body + used, min(left, 128));
                if (count <= 0) break;
                used += count;
                if (length > 0 && used == length) break;
            }
            if (!result.error && (used > kMaxBodyBytes ||
                !esp_http_client_is_complete_data_received(client) ||
                !parseData(body, used, settings.username, result.data))) {
                result.error = "invalid_proxy_response";
            }
        }
    }

    esp_http_client_cleanup(client);
    return result;
}

}  // namespace github
