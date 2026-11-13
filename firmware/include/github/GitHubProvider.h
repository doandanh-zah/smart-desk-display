#pragma once

#include <cstdint>
#include <ctime>

#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

namespace github {

constexpr unsigned kCalendarCells = 52 * 7;

enum class Status : uint8_t { Demo, Pending, Ready, Stale, Error };

struct Data {
    char username[40] = {};
    char start[11] = {};
    char asOf[11] = {};
    uint8_t levels[kCalendarCells] = {};
    uint32_t total = 0;
    uint16_t streak = 0;
    int32_t repos = -1;
    time_t syncedAt = 0;
};

struct Snapshot {
    Status status = Status::Pending;
    bool hasData = false;
    Data data;
    const char* error = "";  // Stable machine-readable code.
};

// Use one firmware-lifetime instance. Call all public methods from the loop.
class GitHubProvider {
public:
    GitHubProvider() = default;
    GitHubProvider(const GitHubProvider&) = delete;
    GitHubProvider& operator=(const GitHubProvider&) = delete;

    void configure(const char* username, const char* proxyUrl);
    void tick(bool wifiConnected, bool clockSynchronized);
    // Stable storage. Its contents can change on the next configure() or tick().
    const Snapshot& snapshot() const { return snapshot_; }

private:
    static constexpr unsigned kMaxUrl = 200;
    struct Settings {
        char username[40] = {};
        char url[kMaxUrl + 1] = {};
    };

    struct Result {
        Data data;
        const char* error = nullptr;
        uint32_t retryMs = 0;
    };

    static void runJob(void* argument);
    static Result fetch(const Settings& settings);
    void fail(const char* code);

    Settings config_;
    Settings job_;
    Snapshot snapshot_;
    bool configured_ = false;
    bool enabled_ = false;
    bool active_ = false;
    uint32_t generation_ = 0;
    uint32_t jobGeneration_ = 0;
    uint32_t nextAttempt_ = 0;

    StaticQueue_t queueState_;
    uint8_t queueStorage_[sizeof(Result)];
    QueueHandle_t results_ = nullptr;
};

}  // namespace github
