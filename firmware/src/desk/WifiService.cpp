#include "desk/WifiService.h"

#include <ESPmDNS.h>
#include <esp_system.h>

namespace desk {
namespace {
constexpr uint32_t connectTimeoutMs = 20000;
constexpr uint32_t retryIntervalMs = 60000;
constexpr uint32_t setupGraceMs = 15000;
constexpr uint32_t mdnsRetryMs = 5000;
constexpr char setupNetworkName[] = "Zah Desk";
constexpr char setupAlphabet[] = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const IPAddress setupIp(192, 168, 4, 1);
}

void WifiService::begin(const Credentials& saved, const String& hostname, uint32_t now) {
    saved_ = saved;
    strcpy(setupSsid_, setupNetworkName);
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(false);
    WiFi.setHostname(hostname.c_str());
    if (saved_.ssid[0]) connect(saved_, now);
    else openSetup(now);
}

void WifiService::connect(const Credentials& credentials, uint32_t now) {
    WiFi.disconnect();
    WiFi.begin(credentials.ssid, credentials.password[0] ? credentials.password : nullptr);
    attemptAt_ = now;
    lastRetry_ = now;
    attempting_ = true;
}

void WifiService::openSetup(uint32_t now) {
    if (setupActive_) return;
    apTriedAt_ = now;
    for (size_t i = 0; i < sizeof(setupPassword_) - 1; ++i) {
        setupPassword_[i] = setupAlphabet[esp_random() % (sizeof(setupAlphabet) - 1)];
    }
    setupActive_ = WiFi.softAP(setupSsid_, setupPassword_, 1, false, 4) &&
        WiFi.softAPConfig(setupIp, setupIp, IPAddress(255, 255, 255, 0));
    if (setupActive_) {
        Serial.printf("Setup AP %s, open http://%s/ (password on TFT)\n",
                      setupSsid_, setupIp.toString().c_str());
    } else {
        WiFi.mode(WIFI_STA);
        memset(setupPassword_, 0, sizeof(setupPassword_));
    }
}

void WifiService::closeSetup() {
    if (!WiFi.mode(WIFI_STA)) return;
    setupActive_ = false;
    memset(setupPassword_, 0, sizeof(setupPassword_));
    provisionState_ = ProvisionState::Idle;
    provisionError_ = nullptr;
}

bool WifiService::provision(const Credentials& candidate, uint32_t now) {
    if (provisionState_ == ProvisionState::Connecting || provisionState_ == ProvisionState::Connected) return false;
    candidate_ = candidate;
    startingCandidate_ = true;
    provisionState_ = ProvisionState::Connecting;
    provisionError_ = nullptr;
    lastRetry_ = now;
    return true;
}

void WifiService::updateStation(const String& hostname, uint32_t now) {
    const String address = connected_ ? WiFi.localIP().toString() : String();
    const bool addressChanged = address != ip_;
    if (addressChanged) {
        ip_ = address;
        if (connected_) Serial.printf("Station dashboard: http://%s/\n", ip_.c_str());
    }
    const String expected = hostname + ".local";
    const bool advertise = connected_ && !setupActive_;
    if (!mdns_.isEmpty() && (!advertise || addressChanged || mdns_ != expected)) {
        MDNS.end();
        mdns_.clear();
        mdnsTriedAt_ = now - mdnsRetryMs;
    }
    if (advertise && mdns_.isEmpty() && now - mdnsTriedAt_ >= mdnsRetryMs) {
        mdnsTriedAt_ = now;
        if (MDNS.begin(hostname.c_str()) && MDNS.addService("http", "tcp", 80)) {
            mdns_ = expected;
            Serial.printf("mDNS dashboard: http://%s/\n", mdns_.c_str());
        } else {
            MDNS.end();
        }
    }
}

void WifiService::tick(const String& hostname, SettingsStore& store, uint32_t now) {
    if (startingCandidate_) {
        startingCandidate_ = false;
        connected_ = false;
        connect(candidate_, now);
        updateStation(hostname, now);
        return;
    }

    const bool wasConnected = connected_;
    connected_ = WiFi.status() == WL_CONNECTED && WiFi.localIP() != IPAddress();
    if (connected_ && provisionState_ == ProvisionState::Connecting) {
        if (!store.saveCredentials(candidate_)) {
            provisionState_ = ProvisionState::Failed;
            provisionError_ = "Could not save Wi-Fi settings.";
            connected_ = false;
            WiFi.disconnect();
        } else {
            saved_ = candidate_;
            provisionState_ = ProvisionState::Connected;
        }
        memset(&candidate_, 0, sizeof(candidate_));
    }

    if (connected_) {
        attempting_ = false;
        if (!wasConnected) {
            onlineAt_ = now;
            mdnsTriedAt_ = now - mdnsRetryMs;
        }
        if (setupActive_ && now - onlineAt_ >= setupGraceMs) closeSetup();
    } else if (attempting_ && now - attemptAt_ >= connectTimeoutMs) {
        attempting_ = false;
        WiFi.disconnect();
        if (provisionState_ == ProvisionState::Connecting) {
            provisionState_ = ProvisionState::Failed;
            provisionError_ = "Could not connect. Check the network name and password.";
            memset(&candidate_, 0, sizeof(candidate_));
        }
        openSetup(now);
    } else if (!attempting_) {
        if (wasConnected && saved_.ssid[0]) {
            if (provisionState_ == ProvisionState::Connected) {
                provisionState_ = ProvisionState::Failed;
                provisionError_ = "The connection was interrupted. Retrying the saved network.";
            }
            connect(saved_, now);
        } else {
            if (!setupActive_ && now - apTriedAt_ >= 5000) openSetup(now);
            if (saved_.ssid[0] && now - lastRetry_ >= retryIntervalMs) connect(saved_, now);
        }
    }
    updateStation(hostname, now);
}

}
