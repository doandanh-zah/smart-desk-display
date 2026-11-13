#include "desk/RemoteAdmin.h"

#include <esp_heap_caps.h>
#include <esp_http_client.h>
#include <esp_system.h>

#include "desk/App.h"

// Arduino's WiFiClientSecure shadows ESP-IDF's header. Use the IDF SDK bundle
// linked into libmbedtls, which esp_http_client accepts as a verifier callback.
extern "C" esp_err_t esp_crt_bundle_attach(void* config);

namespace desk {
namespace {
constexpr char endpoint[] = "https://desk.thezah.space/api/device/sync";
constexpr char tokenKey[] = "token-v1";
constexpr char journalKey[] = "journal-v1";
constexpr char provisionPrefix[] = "desk-remote-set ";
constexpr char clearCommand[] = "desk-remote-clear";
constexpr char statusCommand[] = "desk-remote-status";
constexpr uint32_t heapCaps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
constexpr size_t requestLimit = 6144;
constexpr size_t responseLimit = 4096;
constexpr uint32_t pollMs = remote::PollSchedule::idleMs;
constexpr uint32_t maxRetryMs = 300000;
constexpr uint32_t workerStack = 10240;
constexpr int networkTimeoutMs = 5000;

String nonce() {
    uint8_t bytes[16];
    char text[33] = {};
    esp_fill_random(bytes, sizeof(bytes));
    for (size_t i = 0; i < sizeof(bytes); ++i) {
        constexpr char digits[] = "0123456789abcdef";
        text[i * 2] = digits[bytes[i] >> 4];
        text[i * 2 + 1] = digits[bytes[i] & 15];
    }
    return String(text);
}

bool fitsHeap() {
    return heap_caps_get_free_size(heapCaps) >= 80 * 1024 &&
        heap_caps_get_largest_free_block(heapCaps) >= 28 * 1024;
}

bool writeRequest(App& app, uint64_t epoch, const remote::Journal& journal, bool integrations, String& buffer) {
    JsonDocument doc;
    if (!app.remoteSnapshot(doc)) return false;
    doc["v"] = 1;
    doc["ts"] = epoch;
    doc["nonce"] = nonce();
    if (integrations) doc["wantIntegrations"] = true;
    if (journal.pending) {
        JsonObject ack = doc["ack"].to<JsonObject>();
        ack["id"] = journal.latest.id;
        ack["result"] = journal.result == remote::Result::Applied ? "applied" : "rejected";
        if (journal.code[0]) ack["code"] = journal.code;
        else ack["code"] = nullptr;
    } else {
        doc["ack"] = nullptr;
    }
    if (doc.overflowed()) return false;
    const size_t size = measureJson(doc);
    return size <= requestLimit && buffer.reserve(size) && serializeJson(doc, buffer) == size;
}
}

void RemoteAdmin::begin() {
    nextAttempt_ = millis();
    integrationsAt_ = nextAttempt_;
    storageReady_ = store_.begin("deskremote", false);
    if (!storageReady_) return;
    if (store_.isKey(journalKey)) {
        if (store_.getBytes(journalKey, &journal_, sizeof(journal_)) != sizeof(journal_) ||
            journal_.version != 1) {
            storageReady_ = false;
            Serial.println("Remote admin journal unavailable.");
            return;
        }
    }
    if (store_.getString(tokenKey, token_, sizeof(token_)) == 0 || !remote::hex(token_, remote::tokenLength)) {
        memset(token_, 0, sizeof(token_));
    }
}

void RemoteAdmin::provision(uint32_t now) {
    if (active_ || !storageReady_) return;
    if ((provisionLength_ || discardLine_) && now - provisionAt_ >= 3000) {
        memset(provisionLine_, 0, sizeof(provisionLine_));
        provisionLength_ = 0;
        discardLine_ = false;
    }
    for (unsigned remaining = 96; remaining && Serial.available(); --remaining) {
        const int ch = Serial.read();
        provisionAt_ = now;
        if (ch == '\r') continue;
        if (ch == '\n') {
            if (!discardLine_) {
                if (strcmp(provisionLine_, statusCommand) == 0) {
                    Serial.printf("Remote enabled=%u transport_ok=%u http=%d heap_before=%lu largest_before=%lu heap_with_tls=%lu worker_stack_free=%lu\n",
                                  token_[0] != 0, diagnostics_.transportOk, diagnostics_.httpStatus,
                                  static_cast<unsigned long>(diagnostics_.freeBefore),
                                  static_cast<unsigned long>(diagnostics_.largestBefore),
                                  static_cast<unsigned long>(diagnostics_.freeWithTls),
                                  static_cast<unsigned long>(diagnostics_.stackFree));
                } else if (strcmp(provisionLine_, clearCommand) == 0) {
                    if (!store_.isKey(tokenKey) || store_.remove(tokenKey)) {
                        memset(token_, 0, sizeof(token_));
                        Serial.println("Remote admin disabled.");
                    } else {
                        Serial.println("Remote admin provisioning failed.");
                    }
                } else if (strncmp(provisionLine_, provisionPrefix, sizeof(provisionPrefix) - 1) == 0) {
                    const char* token = provisionLine_ + sizeof(provisionPrefix) - 1;
                    if (remote::hex(token, remote::tokenLength) &&
                        store_.putString(tokenKey, token) == remote::tokenLength) {
                        memcpy(token_, token, sizeof(token_));
                        nextAttempt_ = now;
                        retryMs_ = pollMs;
                        Serial.println("Remote admin credential saved.");
                    } else {
                        Serial.println("Remote admin provisioning failed.");
                    }
                }
            }
            memset(provisionLine_, 0, sizeof(provisionLine_));
            provisionLength_ = 0;
            discardLine_ = false;
        } else if (ch < 32 || ch > 126 || provisionLength_ == sizeof(provisionLine_) - 1) {
            discardLine_ = true;
        } else if (!discardLine_) {
            provisionLine_[provisionLength_++] = static_cast<char>(ch);
        }
    }
}

bool RemoteAdmin::commit(const remote::Journal& journal) {
    if (store_.putBytes(journalKey, &journal, sizeof(journal)) != sizeof(journal)) {
        storageReady_ = false;
        Serial.println("Remote admin paused: command journal write failed.");
        return false;
    }
    journal_ = journal;
    return true;
}

void RemoteAdmin::tick(App& app, bool online, time_t epoch, uint32_t now) {
    bool transportOk = false;
    if (active_) {
        if (xQueueReceive(results_, &transportOk, 0) != pdTRUE) return;
        active_ = false;
        request_ = String();
        const auto before = journal_.latest;
        const bool wasPending = journal_.pending;
        pollHintMs_ = pollMs;
        const bool ok = transportOk && online && epoch > 0 && receive(app, static_cast<uint64_t>(epoch));
        if (askedIntegrations_) {
            if (!ok && diagnostics_.httpStatus == 400) {
                // Older cloud rejects the optional request field. Probe again after a rollout window.
                integrationsAt_ = now + 300000;
            } else if (ok) {
                integrationsAt_ = now + 60000;
            }
        }
        response_ = String();
        const bool newAck = journal_.pending && (!wasPending || strcmp(before.id, journal_.latest.id) != 0);
        nextAttempt_ = now + (ok ? pollSchedule_.afterSuccess(now, newAck, pollHintMs_) : retryMs_);
        retryMs_ = ok ? pollMs : std::min(retryMs_ * 2, maxRetryMs);
    }

    provision(now);
    if (!storageReady_ || !token_[0] || !online || epoch <= 0 ||
        static_cast<int32_t>(now - nextAttempt_) < 0 || xTaskGetHandle("github_fetch")) return;
    if (!fitsHeap()) {
        nextAttempt_ = now + pollMs;
        return;
    }

    if (journal_.pending && static_cast<uint64_t>(epoch) > journal_.latest.expiresAt + remote::ackRetention) {
        auto updated = journal_;
        updated.pending = false;
        if (!commit(updated)) return;
    }
    if (!results_) results_ = xQueueCreateStatic(1, sizeof(bool), queueStorage_, &queueState_);
    askedIntegrations_ = static_cast<int32_t>(now - integrationsAt_) >= 0;
    active_ = results_ && writeRequest(app, epoch, journal_, askedIntegrations_, request_) &&
        xTaskCreate(run, "desk_remote", workerStack, this, 1, nullptr) == pdPASS;
    if (!active_) {
        request_ = String();
        nextAttempt_ = now + retryMs_;
        retryMs_ = std::min(retryMs_ * 2, maxRetryMs);
    }
}

bool RemoteAdmin::receive(App& app, uint64_t now) {
    JsonDocument response;
    if (deserializeJson(response, response_, DeserializationOption::NestingLimit(8)) ||
        !response["ok"].is<bool>() || !response["ok"].as<bool>() ||
        !response["serverTime"].is<uint64_t>() ||
        !response["ackId"].is<JsonVariantConst>() ||
        !response["command"].is<JsonVariantConst>()) return false;
    const uint64_t serverTime = response["serverTime"].as<uint64_t>();
    if ((serverTime >= now ? serverTime - now : now - serverTime) > remote::commandTtl) return false;

    const auto ack = response["ackId"].as<JsonVariantConst>();
    if (!ack.isNull() && !remote::hex(ack, remote::idLength)) return false;
    pollHintMs_ = remote::PollSchedule::hint(response["pollAfterMs"]);
    const auto integrations = response["integrations"].as<JsonVariantConst>();
    if (!integrations.isNull()) app.updateIntegrations(integrations, std::max(now, serverTime));
    if (journal_.pending) {
        if (ack == journal_.latest.id) {
            auto updated = journal_;
            updated.pending = false;
            if (!commit(updated)) return false;
        } else {
            return true;
        }
    }

    if (response["command"].isNull()) return true;
    const auto cmd = response["command"].as<JsonObjectConst>();
    if (cmd.size() != 5 || !remote::hex(cmd["id"], remote::idLength) ||
        !cmd["createdAt"].is<uint64_t>() || !cmd["expiresAt"].is<uint64_t>()) return false;
    const auto* id = cmd["id"].as<const char*>();
    const auto created = cmd["createdAt"].as<uint64_t>();
    const auto expires = cmd["expiresAt"].as<uint64_t>();
    if (created == 0 || created > serverTime || expires <= created || expires - created > remote::commandTtl) {
        return false;
    }
    if (strcmp(id, journal_.latest.id) == 0) {
        if (ack == id) return true;
        auto updated = journal_;
        updated.pending = true;
        return commit(updated);
    }
    if (journal_.seen(id)) return true;

    const uint64_t checkedTime = std::max(now, serverTime);
    if (checkedTime >= expires && checkedTime - expires > remote::commandTtl) return false;
    auto updated = journal_;
    if (!updated.reserve(id, expires, now) || !commit(updated)) return false;
    const auto payload = cmd["payload"].as<JsonObjectConst>();
    const char* route = payload.isNull() ? nullptr : remote::route(cmd["type"], payload);
    const char* error = "unsupported_action";
    if (checkedTime >= expires) {
        error = "expired";
    } else if (route) {
        JsonDocument ignored;
        error = app.post(route, payload, ignored).code;
    }
    updated.finish(error);
    return commit(updated);
}

void RemoteAdmin::run(void* context) {
    auto& remote = *static_cast<RemoteAdmin*>(context);
    const bool ok = remote.exchange();
    remote.diagnostics_.transportOk = ok;
    remote.diagnostics_.stackFree = uxTaskGetStackHighWaterMark(nullptr);
    xQueueSend(remote.results_, &ok, 0);
    vTaskDelete(nullptr);
}

bool RemoteAdmin::exchange() {
    diagnostics_ = {};
    diagnostics_.freeBefore = heap_caps_get_free_size(heapCaps);
    diagnostics_.largestBefore = heap_caps_get_largest_free_block(heapCaps);
    char auth[sizeof("Bearer ") + remote::tokenLength];
    snprintf(auth, sizeof(auth), "Bearer %s", token_);
    esp_http_client_config_t config{};
    config.url = endpoint;
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.transport_type = HTTP_TRANSPORT_OVER_SSL;
    config.timeout_ms = networkTimeoutMs;
    config.disable_auto_redirect = true;
    config.max_authorization_retries = -1;
    config.method = HTTP_METHOD_POST;
    config.buffer_size = 1024;
    config.buffer_size_tx = 1024;

    const auto client = esp_http_client_init(&config);
    if (!client) {
        explicit_bzero(auth, sizeof(auth));
        return false;
    }
    bool ok = false;
    if (esp_http_client_set_header(client, "Authorization", auth) == ESP_OK &&
        esp_http_client_set_header(client, "Content-Type", "application/json") == ESP_OK &&
        esp_http_client_set_header(client, "Accept-Encoding", "identity") == ESP_OK &&
        esp_http_client_open(client, request_.length()) == ESP_OK &&
        esp_http_client_write(client, request_.c_str(), request_.length()) == static_cast<int>(request_.length())) {
        diagnostics_.freeWithTls = heap_caps_get_free_size(heapCaps);
        const auto length = esp_http_client_fetch_headers(client);
        diagnostics_.httpStatus = esp_http_client_get_status_code(client);
        if ((length >= 0 || esp_http_client_is_chunked_response(client)) &&
            length <= static_cast<int>(responseLimit) &&
            diagnostics_.httpStatus == 200 && response_.reserve(responseLimit)) {
            char chunk[256];
            const uint32_t started = millis();
            while (millis() - started < networkTimeoutMs) {
                const int bytes = esp_http_client_read(client, chunk, sizeof(chunk));
                if (bytes < 0 || response_.length() + static_cast<size_t>(bytes) > responseLimit) break;
                if (bytes && !response_.concat(chunk, bytes)) break;
                if (esp_http_client_is_complete_data_received(client)) {
                    ok = !response_.isEmpty();
                    break;
                }
                if (bytes == 0) break;
            }
        }
    }
    esp_http_client_cleanup(client);
    explicit_bzero(auth, sizeof(auth));
    return ok;
}

}
