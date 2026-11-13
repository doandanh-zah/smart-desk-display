#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_ILI9341.h>

namespace {
constexpr int kTftCs = 27;
constexpr int kTftReset = 25;
constexpr int kTftDc = 26;
constexpr int kTftMosi = 23;
constexpr int kTftSck = 18;
constexpr int kTftMiso = -1;
constexpr uint8_t kRotation = 1;
constexpr uint32_t kSpiClockHz = 10000000;
constexpr uint32_t kSerialIntervalMs = 3000;

Adafruit_ILI9341 tft(&SPI, kTftDc, kTftCs, kTftReset);
uint32_t lastReportMs;

void drawPattern() {
  struct Swatch {
    uint16_t color;
    const char* label;
  };
  constexpr Swatch swatches[] = {
      {ILI9341_RED, "RED"},
      {ILI9341_GREEN, "GREEN"},
      {ILI9341_BLUE, "BLUE"},
      {ILI9341_WHITE, "WHITE"},
  };

  tft.fillScreen(ILI9341_BLACK);
  tft.drawRect(0, 0, tft.width(), tft.height(), ILI9341_WHITE);
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextWrap(false);
  tft.setTextSize(3);
  tft.setCursor(16, 24);
  tft.print(F("SMART DESK"));
  tft.setTextSize(2);
  tft.setCursor(16, 60);
  tft.print(F("ILI9341 320 x 240"));

  int16_t x = 16;
  for (const Swatch& swatch : swatches) {
    tft.fillRect(x, 104, 66, 72, swatch.color);
    tft.setCursor(x + 3, 196);
    tft.print(swatch.label);
    x += 74;
  }
}

void reportDrawn() {
  Serial.printf("TFT_SMOKE drawing sent, canvas=%dx%d, rotation=%u, SPI=%lu Hz\n",
                tft.width(), tft.height(), static_cast<unsigned>(kRotation),
                static_cast<unsigned long>(kSpiClockHz));
}
}  // namespace

void setup() {
  Serial.begin(115200);
  SPI.begin(kTftSck, kTftMiso, kTftMosi, kTftCs);
  tft.begin(kSpiClockHz);
  tft.setRotation(kRotation);

  if (tft.width() != 320 || tft.height() != 240) {
    Serial.printf("TFT_SMOKE unexpected canvas=%dx%d\n", tft.width(), tft.height());
    return;
  }

  drawPattern();
  reportDrawn();
  lastReportMs = millis();
}

void loop() {
  if (tft.width() == 320 && tft.height() == 240 &&
      millis() - lastReportMs >= kSerialIntervalMs) {
    lastReportMs = millis();
    reportDrawn();
  }
  delay(10);
}
