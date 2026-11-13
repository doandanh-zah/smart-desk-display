#include "desk/GitHub.h"

#include <time.h>

namespace desk {

const char* githubStateName(display::GitHubState state) {
    switch (state) {
        case display::GitHubState::Demo: return "demo";
        case display::GitHubState::Loading: return "loading";
        case display::GitHubState::Live: return "live";
        case display::GitHubState::Stale: return "stale";
        case display::GitHubState::Error: return "error";
    }
    return "error";
}

const char* githubErrorMessage(const char* code) {
    if (!code || !code[0]) return "";
    if (strcmp(code, "wifi_offline") == 0) return "Wi-Fi is offline.";
    if (strcmp(code, "waiting_for_time") == 0) return "Waiting for NTP before connecting to GitHub.";
    if (strcmp(code, "invalid_proxy_url") == 0) return "Check the GitHub proxy URL.";
    if (strcmp(code, "invalid_username") == 0 || strcmp(code, "user_not_found") == 0) return "Check the GitHub username.";
    if (strcmp(code, "rate_limited") == 0) return "GitHub request limit reached. Retrying later.";
    if (strcmp(code, "proxy_unconfigured") == 0) return "The GitHub proxy is not configured.";
    if (strcmp(code, "tls_verification_failed") == 0) return "Could not verify the GitHub proxy certificate.";
    return "GitHub data is temporarily unavailable.";
}

void GitHub::tick(const Settings& settings, bool online, bool timeValid) {
    const bool changed = username_ != settings.githubUsername || proxy_ != settings.githubProxyUrl;
    if (changed || !initialized_) {
        initialized_ = true;
        username_ = settings.githubUsername;
        proxy_ = settings.githubProxyUrl;
        provider_.configure(username_.c_str(), username_.isEmpty() ? "" : proxy_.c_str());
    }

    data_ = {};
    data_.username = username_.c_str();
    provider_.tick(online, timeValid);
    const auto& snapshot = provider_.snapshot();
    using github::Status;
    switch (snapshot.status) {
        case Status::Demo: data_.state = display::GitHubState::Demo; break;
        case Status::Pending: data_.state = display::GitHubState::Loading; break;
        case Status::Ready: data_.state = display::GitHubState::Live; break;
        case Status::Stale: data_.state = display::GitHubState::Stale; break;
        case Status::Error: data_.state = display::GitHubState::Error; break;
    }
    if (snapshot.hasData) {
        data_.username = snapshot.data.username;
        data_.levels = snapshot.data.levels;
        data_.totalContributions = snapshot.data.total;
        data_.currentStreak = snapshot.data.streak;
        data_.repositoryCount = snapshot.data.repos;
        const time_t epoch = snapshot.data.syncedAt;
        struct tm utc;
        if (epoch > 0 && gmtime_r(&epoch, &utc) &&
            strftime(timestamp_, sizeof(timestamp_), "%Y-%m-%dT%H:%M:%SZ", &utc)) {
            data_.lastSync = timestamp_;
        }
    }
    data_.error = snapshot.error;
}

}
