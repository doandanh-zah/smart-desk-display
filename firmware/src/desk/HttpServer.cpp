#include "desk/HttpServer.h"

#include <LittleFS.h>
#include <esp_netif_sta_list.h>
#include <esp_wifi.h>
#include <lwip/sockets.h>

#include "desk/ProvisionPage.h"

namespace desk {
namespace {
constexpr size_t maxBody = 2048;
constexpr char htmlType[] = "text/html; charset=utf-8";

class StateLock {
public:
    explicit StateLock(SemaphoreHandle_t lock, TickType_t wait = portMAX_DELAY)
        : lock_(xSemaphoreTake(lock, wait) == pdTRUE ? lock : nullptr) {}
    ~StateLock() { if (lock_) xSemaphoreGive(lock_); }
    explicit operator bool() const { return lock_ != nullptr; }

private:
    SemaphoreHandle_t lock_;
};

class JsonBody {
public:
    JsonBody(const char* data, size_t length) : data_(data), length_(length) {}
    int read() {
        return offset_ < length_ ? static_cast<unsigned char>(data_[offset_++]) : -1;
    }
    size_t readBytes(char* destination, size_t length) {
        const size_t count = std::min(length, length_ - offset_);
        memcpy(destination, data_ + offset_, count);
        offset_ += count;
        return count;
    }
    bool atEnd() {
        while (offset_ < length_) {
            const char c = data_[offset_++];
            if (c != ' ' && c != '\t' && c != '\r' && c != '\n') return false;
        }
        return true;
    }

private:
    const char* data_;
    size_t length_;
    size_t offset_ = 0;
};

String header(httpd_req_t* request, const char* name) {
    char buffer[128];
    const size_t length = httpd_req_get_hdr_value_len(request, name);
    if (length == 0) return "";
    if (length >= sizeof(buffer) ||
        httpd_req_get_hdr_value_str(request, name, buffer, sizeof(buffer)) != ESP_OK) return "!";
    return String(buffer);
}

esp_err_t sendError(httpd_req_t* request, const ApiResult& result) {
    JsonDocument doc;
    doc["ok"] = false;
    JsonObject error = doc["error"].to<JsonObject>();
    error["code"] = result.code;
    error["message"] = result.message;
    if (result.field) error["field"] = result.field;
    String body;
    serializeJson(doc, body);
    httpd_resp_set_status(request, result.status);
    httpd_resp_set_type(request, "application/json");
    return httpd_resp_send(request, body.c_str(), request->method == HTTP_HEAD ? 0 : body.length());
}

const char* contentType(const String& path) {
    if (path.endsWith(".html")) return htmlType;
    if (path.endsWith(".css")) return "text/css; charset=utf-8";
    if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".ico")) return "image/x-icon";
    if (path.endsWith(".woff2")) return "font/woff2";
    if (path.endsWith(".webp")) return "image/webp";
    return nullptr;
}

bool validAssetPath(const String& path) {
    if (path.length() > 96 || path.endsWith("/") || path.indexOf("..") >= 0 || path.indexOf("/.") >= 0) return false;
    for (size_t i = 0; i < path.length(); ++i) {
        const char c = path[i];
        if (!isalnum(static_cast<unsigned char>(c)) && c != '.' && c != '/' && c != '-' && c != '_') return false;
    }
    return true;
}

ApiResult readPost(httpd_req_t* request, JsonDocument& input) {
    if (request->content_len > maxBody) return {"413 Payload Too Large", "body_too_large", "Use at most 2048 bytes."};
    String type = header(request, "Content-Type");
    const int semicolon = type.indexOf(';');
    if (semicolon >= 0) type.remove(semicolon);
    type.trim();
    if (!type.equalsIgnoreCase("application/json")) {
        return {"415 Unsupported Media Type", "unsupported_media_type", "Send application/json."};
    }
    char body[maxBody];
    size_t received = 0;
    const uint32_t started = millis();
    while (received < request->content_len) {
        if (millis() - started >= 2000) return {"400 Bad Request", "invalid_json", "Request body timed out."};
        const int count = httpd_req_recv(request, body + received, request->content_len - received);
        if (count <= 0) return {"400 Bad Request", "invalid_json", "Could not read the request body."};
        received += count;
    }
    JsonBody source(body, received);
    if (deserializeJson(input, source, DeserializationOption::NestingLimit(5)) ||
        !input.is<JsonObject>() || !source.atEnd()) {
        return {"400 Bad Request", "invalid_json", "Send a valid JSON object."};
    }
    return {};
}

IPAddress socketAddress(httpd_req_t* request, bool local) {
    sockaddr_storage address{};
    socklen_t length = sizeof(address);
    const int fd = httpd_req_to_sockfd(request);
    const int result = local
        ? getsockname(fd, reinterpret_cast<sockaddr*>(&address), &length)
        : getpeername(fd, reinterpret_cast<sockaddr*>(&address), &length);
    if (result == 0 && address.ss_family == AF_INET) {
        return IPAddress(reinterpret_cast<const sockaddr_in*>(&address)->sin_addr.s_addr);
    }
    if (result == 0 && address.ss_family == AF_INET6) {
        const auto& ip = reinterpret_cast<const sockaddr_in6*>(&address)->sin6_addr;
        constexpr uint8_t ipv4Prefix[] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255};
        if (memcmp(ip.s6_addr, ipv4Prefix, sizeof(ipv4Prefix)) == 0) return IPAddress(ip.s6_addr + 12);
    }
    return IPAddress();
}

bool setupClient(const IPAddress& ip) {
    wifi_sta_list_t stations{};
    esp_netif_sta_list_t leases{};
    if (esp_wifi_ap_get_sta_list(&stations) != ESP_OK ||
        esp_netif_get_sta_list(&stations, &leases) != ESP_OK) return false;
    for (int i = 0; i < leases.num; ++i) {
        if (ip == IPAddress(leases.sta[i].ip.addr)) return true;
    }
    return false;
}
}

bool HttpServer::begin() {
    stateLock_ = xSemaphoreCreateMutexStatic(&lockStorage_);
    fsMounted_ = LittleFS.begin(false);
    if (!fsMounted_) Serial.println("LittleFS unavailable; using embedded pages.");
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 8192;
    config.max_open_sockets = 5;
    config.recv_wait_timeout = 2;
    config.send_wait_timeout = 2;
    config.lru_purge_enable = true;
    config.uri_match_fn = httpd_uri_match_wildcard;
    if (httpd_start(&server_, &config) != ESP_OK) return false;

    for (const auto method : {HTTP_GET, HTTP_HEAD, HTTP_POST}) {
        httpd_uri_t route{};
        route.uri = "/*";
        route.method = method;
        route.handler = &HttpServer::handle;
        route.user_ctx = this;
        if (httpd_register_uri_handler(server_, &route) != ESP_OK) {
            httpd_stop(server_);
            server_ = nullptr;
            return false;
        }
    }
    return true;
}

void HttpServer::tick() {
    // Never wait behind a request. The request releases the lock before writing to the socket.
    StateLock lock(stateLock_, 0);
    if (lock) app_.tick();
}

esp_err_t HttpServer::handle(httpd_req_t* request) {
    return static_cast<HttpServer*>(request->user_ctx)->respond(request);
}

esp_err_t HttpServer::respond(httpd_req_t* request) {
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
    httpd_resp_set_hdr(request, "X-Frame-Options", "DENY");
    httpd_resp_set_hdr(request, "Referrer-Policy", "no-referrer");

    String path = request->uri;
    const int query = path.indexOf('?');
    if (query >= 0) path.remove(query);
    const bool post = request->method == HTTP_POST;
    const bool api = path.startsWith("/api/");
    const bool provision = path == "/api/provision" || path == "/api/provision/status";
    const IPAddress local = socketAddress(request, true);
    const bool apPage = !api && local == IPAddress(192, 168, 4, 1);
    const bool setup = provision || apPage;
    const String host = header(request, "Host");
    const String origin = header(request, "Origin");
    const bool fromSetupSubnet = !setup || setupClient(socketAddress(request, false));

    bool allowed;
    {
        StateLock lock(stateLock_);
        allowed = fromSetupSubnet && app_.allowsRequest(local, host, origin, setup);
    }
    if (!allowed) return sendError(request, {"403 Forbidden", "forbidden", "Use the device address on the correct network."});

    if (!api && !post) {
        if (!apPage) return serveAsset(request, path);
        if (path != "/") return sendError(request, {"404 Not Found", "not_found", "Page not found."});
        httpd_resp_set_type(request, htmlType);
        return httpd_resp_send(request, provisionPage, request->method == HTTP_HEAD ? 0 : sizeof(provisionPage) - 1);
    }
    if (!api || request->method == HTTP_HEAD) {
        return sendError(request, {"404 Not Found", "not_found", "API route not found."});
    }

    JsonDocument input;
    if (post) {
        const ApiResult result = readPost(request, input);
        if (result.code) {
            httpd_resp_set_hdr(request, "Connection", "close");
            sendError(request, result);
            return ESP_FAIL;
        }
    }

    ApiResult result;
    String body;
    {
        StateLock lock(stateLock_);
        if (!app_.allowsRequest(local, host, origin, setup)) {
            result = {"403 Forbidden", "forbidden", "The network changed. Reconnect to the device."};
        } else {
            JsonDocument doc;
            result = post ? app_.post(path, input.as<JsonObjectConst>(), doc) : app_.get(path, doc);
            if (!result.code && (doc.overflowed() || serializeJson(doc, body) == 0)) {
                result = {"503 Service Unavailable", "busy", "Response unavailable. Retry shortly."};
            }
        }
    }
    if (result.code) return sendError(request, result);
    httpd_resp_set_status(request, result.status);
    httpd_resp_set_type(request, "application/json");
    return httpd_resp_send(request, body.c_str(), body.length());
}

esp_err_t HttpServer::serveAsset(httpd_req_t* request, const String& path) const {
    const String filename = path == "/" ? "/index.html" : path;
    const char* type = contentType(filename);
    if (!type || !validAssetPath(filename)) {
        return sendError(request, {"404 Not Found", "not_found", "File not found."});
    }

    File file;
    if (fsMounted_) file = LittleFS.open(filename, FILE_READ);
    if (!file || file.isDirectory()) {
        if (filename == "/index.html") {
            httpd_resp_set_type(request, htmlType);
            return httpd_resp_send(request, fallbackPage, request->method == HTTP_HEAD ? 0 : sizeof(fallbackPage) - 1);
        }
        return sendError(request, {"404 Not Found", "not_found", "File not found."});
    }

    httpd_resp_set_type(request, type);
    if (request->method == HTTP_HEAD) return httpd_resp_send(request, nullptr, 0);
    uint8_t buffer[1024];
    size_t remaining = file.size();
    while (remaining > 0) {
        const size_t bytes = file.read(buffer, std::min(remaining, sizeof(buffer)));
        if (bytes == 0 || httpd_resp_send_chunk(request, reinterpret_cast<const char*>(buffer), bytes) != ESP_OK) {
            return ESP_FAIL;
        }
        remaining -= bytes;
    }
    return httpd_resp_send_chunk(request, nullptr, 0);
}

}
