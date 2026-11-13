#pragma once

#include <Arduino.h>
#include <WiFi.h>

#include "desk/Settings.h"

namespace desk {

enum class ProvisionState { Idle, Connecting, Connected, Failed };

class WifiService {
public:
    void begin(const Credentials& saved, const String& hostname, uint32_t now);
    void tick(const String& hostname, SettingsStore& store, uint32_t now);
    bool provision(const Credentials& candidate, uint32_t now);

    bool connected() const { return connected_; }
    bool setupActive() const { return setupActive_; }
    const String& ip() const { return ip_; }
    const String& hostname() const { return mdns_; }
    const char* setupSsid() const { return setupSsid_; }
    const char* setupPassword() const { return setupPassword_; }
    ProvisionState provisionState() const { return provisionState_; }
    const char* provisionError() const { return provisionError_; }

private:
    void connect(const Credentials& credentials, uint32_t now);
    void openSetup(uint32_t now);
    void closeSetup();
    void updateStation(const String& hostname, uint32_t now);

    Credentials saved_;
    Credentials candidate_;
    String ip_;
    String mdns_;
    char setupSsid_[24] = {};
    char setupPassword_[13] = {};
    bool connected_ = false;
    bool setupActive_ = false;
    bool attempting_ = false;
    bool startingCandidate_ = false;
    uint32_t attemptAt_ = 0;
    uint32_t lastRetry_ = 0;
    uint32_t apTriedAt_ = 0;
    uint32_t onlineAt_ = 0;
    uint32_t mdnsTriedAt_ = 0;
    ProvisionState provisionState_ = ProvisionState::Idle;
    const char* provisionError_ = nullptr;
};

}
