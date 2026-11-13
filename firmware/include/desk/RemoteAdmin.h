#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <freertos/queue.h>

#include "desk/RemoteProtocol.h"

namespace desk {

class App;

class RemoteAdmin {
public:
    void begin();
    void tick(App& app, bool online, time_t epoch, uint32_t now);
    bool busy() const { return active_; }

private:
    static void run(void* context);
    bool exchange();
    bool receive(App& app, uint64_t now);
    bool commit(const remote::Journal& journal);
    void provision(uint32_t now);

    Preferences store_;
    remote::Journal journal_;
    QueueHandle_t results_ = nullptr;
    StaticQueue_t queueState_;
    uint8_t queueStorage_[sizeof(bool)] = {};
    bool storageReady_ = false;
    bool active_ = false;
    bool askedIntegrations_ = false;
    uint32_t integrationsAt_ = 0;
    uint32_t nextAttempt_ = 0;
    uint32_t retryMs_ = 20000;
    char token_[remote::tokenLength + 1] = {};
    struct Diagnostics {
        uint32_t freeBefore = 0;
        uint32_t largestBefore = 0;
        uint32_t freeWithTls = 0;
        uint32_t stackFree = 0;
        int httpStatus = 0;
        bool transportOk = false;
    } diagnostics_;
    String request_;
    String response_;
    char provisionLine_[sizeof("desk-remote-set ") - 1 + remote::tokenLength + 1] = {};
    size_t provisionLength_ = 0;
    bool discardLine_ = false;
    uint32_t provisionAt_ = 0;
};

}
