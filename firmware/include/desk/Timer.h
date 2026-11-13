#pragma once

#include "display/DisplayManager.h"

namespace desk {

class Timer {
public:
    void tick(uint32_t now) {
        if (data_.state != display::TimerState::Running) return;
        const uint32_t elapsed = now - tickAt_;
        tickAt_ = now;
        if (elapsed >= remainingMs_) {
            remainingMs_ = 0;
            data_.state = display::TimerState::Completed;
        } else {
            remainingMs_ -= elapsed;
        }
        data_.remainingSeconds = (remainingMs_ + 999) / 1000;
    }

    void start(uint32_t now) {
        tick(now);
        if (data_.state == display::TimerState::Running) return;
        if (data_.state == display::TimerState::Completed) {
            data_.phase = data_.phase == display::TimerPhase::Focus ?
                display::TimerPhase::Break : display::TimerPhase::Focus;
            data_.remainingSeconds = data_.phase == display::TimerPhase::Focus ?
                data_.focusMinutes * 60u : data_.breakMinutes * 60u;
            remainingMs_ = data_.remainingSeconds * 1000u;
        }
        tickAt_ = now;
        data_.state = display::TimerState::Running;
    }

    void pause(uint32_t now) {
        tick(now);
        if (data_.state == display::TimerState::Running) data_.state = display::TimerState::Paused;
    }

    void reset() {
        data_ = {};
        remainingMs_ = data_.remainingSeconds * 1000u;
    }

    const display::PomodoroData& data() const { return data_; }

private:
    display::PomodoroData data_;
    uint32_t tickAt_ = 0;
    uint32_t remainingMs_ = data_.remainingSeconds * 1000u;
};

}
