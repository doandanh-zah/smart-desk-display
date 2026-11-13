#include <Arduino.h>

#include "desk/App.h"
#include "desk/HttpServer.h"

namespace {
desk::App app;
desk::HttpServer http(app);
}

void setup() {
    Serial.begin(115200);
    app.begin();
    if (!http.begin()) Serial.println("Could not start the local HTTP server.");
}

void loop() {
    http.tick();
    vTaskDelay(1);
}
