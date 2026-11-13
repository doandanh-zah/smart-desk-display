#pragma once

#include <esp_http_server.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "desk/App.h"

namespace desk {

class HttpServer {
public:
    explicit HttpServer(App& app) : app_(app) {}
    bool begin();
    void tick();

private:
    static esp_err_t handle(httpd_req_t* request);
    esp_err_t respond(httpd_req_t* request);
    esp_err_t serveAsset(httpd_req_t* request, const String& path) const;

    App& app_;
    SemaphoreHandle_t stateLock_ = nullptr;
    StaticSemaphore_t lockStorage_;
    httpd_handle_t server_ = nullptr;
    bool fsMounted_ = false;
};

}
