#pragma once

#include "display/DisplayManager.h"

namespace desk {

constexpr uint32_t maxCountdownDuration = 359999;
constexpr uint64_t firstCountdownEpoch = 1704067200;  // 2024-01-01 UTC
constexpr uint64_t lastCountdownEpoch = 4102444799;   // 2099-12-31 UTC

struct CountdownConfig {
    uint32_t durationSeconds = 1500;
    uint64_t targetEpochSeconds = 0; // Zero selects duration.
    bool armed = false;
};

using display::CountdownState;

class Countdown {
public:
    void load(const CountdownConfig& config, uint32_t now, uint64_t epoch) {
        config_ = config;
        state_ = CountdownState::Idle;
        remainingMs_ = config.durationSeconds * 1000u;
        lastTick_ = now;
        tick(now, epoch);
    }

    void tick(uint32_t now, uint64_t epoch) {
        if (config_.targetEpochSeconds) {
            if (!config_.armed || state_ == CountdownState::Completed) return;
            if (!epoch) state_ = CountdownState::WaitingForTime;
            else state_ = epoch < config_.targetEpochSeconds ? CountdownState::Running : CountdownState::Completed;
        } else if (state_ == CountdownState::Running) {
            const uint32_t elapsed = now - lastTick_;
            lastTick_ = now;
            if (elapsed >= remainingMs_) {
                remainingMs_ = 0;
                state_ = CountdownState::Completed;
            } else {
                remainingMs_ -= elapsed;
            }
        }
    }

    void start(uint32_t now) {
        if (config_.targetEpochSeconds) return;
        tick(now, 0);
        if (state_ == CountdownState::Running) return;
        if (state_ != CountdownState::Paused) remainingMs_ = config_.durationSeconds * 1000u;
        state_ = CountdownState::Running;
        lastTick_ = now;
    }

    void pause(uint32_t now) {
        if (config_.targetEpochSeconds) return;
        tick(now, 0);
        if (state_ == CountdownState::Running) state_ = CountdownState::Paused;
    }

    CountdownState state() const { return state_; }
    const CountdownConfig& config() const { return config_; }

    int64_t remaining(uint64_t epoch) const {
        if (!config_.targetEpochSeconds) return (remainingMs_ + 999u) / 1000u;
        if (state_ == CountdownState::Completed) return 0;
        if (!config_.armed || !epoch) return -1;
        return epoch < config_.targetEpochSeconds ? config_.targetEpochSeconds - epoch : 0;
    }

private:
    CountdownConfig config_;
    CountdownState state_ = CountdownState::Idle;
    uint32_t remainingMs_ = 1500000;
    uint32_t lastTick_ = 0;
};

}
