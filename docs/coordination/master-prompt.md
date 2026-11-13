# MASTER PROMPT — ESP32 Smart Desk Display

## 1. Your role

You are a senior Embedded Systems Engineer, ESP32 Firmware Developer, Full-stack Engineer, and UI/UX Designer.

Build a complete, functional project called **Smart Desk Display**.

The product is a small physical desktop display powered by an ESP32 and a 2.8-inch TFT LCD. Users can open a beautiful web dashboard on their phone or computer to select what appears on the physical display.

This is a real hardware project, not just a UI prototype. Implement actual working firmware, a functional web interface, API communication, and setup documentation.

Do not stop at architecture or pseudocode. Create the project files and implement the system.

## 2. Existing hardware — IMPORTANT

The hardware has already been selected. Do not change the microcontroller, display type, or existing pin connections without a clear technical reason.

**Microcontroller:**
- ESP32 DevKit V1
- ESP-WROOM-32
- 30-pin development board
- USB-C power input
- Integrated Wi-Fi
- No battery

**Display:**
- TFT LCD 2.8 inch
- Model: LCDWiki MSP2806 or pin-compatible equivalent
- Controller: ILI9341
- Resolution: 240×320 pixels
- Landscape orientation: 320×240
- Interface: 4-wire SPI
- 14-pin display header
- No touchscreen
- No SD card required

**Power:**
- ESP32 powered using 5V USB-C.
- The display is powered from the ESP32 board.
- No Li-ion battery, TP4056, charging circuit, boost converter, or physical power switch.
- Device automatically boots when USB power is connected.

## 3. Exact wiring diagram — DO NOT IGNORE

The existing physical wiring is:

| TFT LCD pin | ESP32 pin | Function |
|---|---|---|
| VCC | 5V / VIN | Display power |
| GND | GND | Common ground |
| CS | GPIO27 | LCD chip select |
| RESET / RST | GPIO25 | LCD reset |
| DC / RS | GPIO26 | Data / command |
| SDI / MOSI | GPIO23 | SPI data |
| SCK / CLK | GPIO18 | SPI clock |
| LED | 3V3 | Backlight enable |

**Unused pins:**
- SDO / MISO — not connected
- T_CLK — not connected
- T_CS — not connected
- T_DIN — not connected
- T_DO — not connected
- T_IRQ — not connected

Use this configuration in the firmware:

- TFT_CS = 27
- TFT_DC = 26
- TFT_RST = 25
- TFT_MOSI = 23
- TFT_SCLK = 18
- TFT_MISO = -1 (unused)
- Landscape rotation = 1

Use the ESP32 hardware SPI peripheral.

### Electrical safety requirements

The 5V VCC configuration is valid only for the verified MSP2806 module with its onboard regulator enabled and J1 open. If J1 is bridged for 3.3V operation, do not apply 5V.

The LCD logic operates at 3.3V. ESP32 GPIO uses 3.3V logic.

The LED pin is connected permanently to 3V3, so software brightness PWM is NOT available with this wiring. Do not falsely implement brightness control on a nonexistent GPIO. Either omit brightness adjustment or clearly label it as a future hardware modification.

Do not use GPIO27 for any secondary purpose because it is assigned to LCD_CS.

Provide a hardware verification and power-safety checklist in the documentation.

## 4. Product concept

Project name: **Smart Desk Display**

A compact desk gadget showing real-time personal information and developer activity.

The device connects to Wi-Fi and hosts a local configuration website.

Example access:

http://esp32-display.local

If mDNS is unavailable, users can access the ESP32's local IP address.

The user should be able to change display modes without connecting a USB cable to their computer or reflashing the firmware.

When a new mode is selected from the website, update the physical TFT immediately.

All important settings must persist after power is disconnected.

## 5. Display modes

Implement the following five modes.

### Mode A — GitHub Contributions

This is the primary display mode.

Create a polished GitHub contribution heatmap inspired by GitHub's dark theme.

Required features:
- GitHub username configurable from the website.
- Display the last 52 weeks of contributions.
- Seven rows for the weekdays.
- Five contribution intensity colors.
- Display total contributions.
- Display current contribution streak.
- Show the username.
- Show last successful synchronization.
- Refresh automatically every 15–30 minutes.
- Cache the most recently fetched data.
- Show a meaningful connection/error state when data cannot be fetched.

Use actual GitHub contribution data when configured, not random generated production data.

GitHub GraphQL data should include contributionCalendar, weeks, contributionDays, dates, counts, colors, and totalContributions.

Implement a secure backend proxy for GitHub API access, with the GitHub token stored in server-side environment variables only.

Never expose the GitHub token in:
- Browser JavaScript
- ESP32 firmware
- Local web responses
- Git commits

When the proxy is not configured, provide an explicitly labeled demo state and instructions for connecting real GitHub data.

Render the contribution grid efficiently using RGB565 colors and rectangles.

### Mode B — Digital Clock

Create a modern digital clock.

Required features:
- Hours and minutes, optional seconds.
- Current date.
- Day of week.
- Time zone: Asia/Ho_Chi_Minh (UTC+7).
- Time synchronization over NTP.
- Elegant large typography.
- Correct time updates without unnecessary full-screen redraws.
- Show an unsynchronized state before a valid time has been obtained.

### Mode C — Developer Statistics

Display relevant developer statistics:
- Total contributions
- Current streak
- Repository count (when available)
- Last synchronization
- Additional real metrics if the available API supports them reliably

Do not misrepresent contribution counts as commit counts.

Handle unavailable metrics gracefully.

### Mode D — Pomodoro Timer

Implement a working focus timer.

Features:
- Default focus: 25 minutes
- Default short break: 5 minutes
- Start
- Pause
- Reset
- Remaining time on TFT
- Timer state synchronized with web dashboard
- Non-blocking timer logic using millis() or an equivalent reliable timer

The countdown must continue correctly while the browser is closed, as long as the ESP32 remains powered.

### Mode E — Custom Message

Allow users to type a custom message from the website.

Features:
- Editable text
- Text alignment
- Color selection
- Adjustable text size within hardware limits
- Immediate physical-display update
- Persist last message after restart
- Text wrapping and overflow protection

Start with robust ASCII/English support. If Vietnamese text is supported, include an appropriate font and explain its flash/memory impact. Do not assume the default Adafruit GFX font supports Vietnamese Unicode.

## 6. Web dashboard requirements

Create a responsive, modern, professional control panel.

Visual direction:
- Dark GitHub-inspired theme
- Background: #0D1117
- Secondary surface: #161B22
- Green accent: #39D353
- Clean typography
- Rounded cards
- Subtle animation
- Mobile-first layout
- Professional dashboard aesthetics

Main dashboard sections:

**Device status**
- Device name
- Wi-Fi connection status
- IP address
- Current display mode
- Firmware version
- Uptime
- Last synchronization

**Screen controller**
- Mode selection cards
- GitHub Contributions
- Clock
- Developer Stats
- Pomodoro
- Custom Message

**Live preview**
- A virtual 320×240 TFT display.
- Show a visual preview of the selected mode.
- Match the physical display layout as closely as practical.
- Clearly distinguish preview/mock data from real device data.
- No assumption that the ESP32 runs HTML or CSS on the TFT.

**Settings**
- GitHub username
- GitHub proxy URL
- Display theme
- Default startup mode
- Automatic mode rotation
- Rotation interval
- Time synchronization
- Device name
- Restart device action

**Pomodoro control**
- Start, pause, and reset controls.
- Real timer state from ESP32.

Save settings to ESP32 non-volatile storage.

Do not include nonfunctional decorative controls.

## 7. Firmware architecture

Preferred stack:
- PlatformIO
- Arduino framework for ESP32
- C++
- Adafruit GFX
- Adafruit ILI9341
- WiFi
- WebServer or ESPAsyncWebServer if compatible
- ArduinoJson
- Preferences
- LittleFS
- NTP

Use well-structured, maintainable code.

Suggested modules:
- main.cpp
- DisplayManager
- GitHubScreen
- ClockScreen
- StatsScreen
- PomodoroScreen
- MessageScreen
- WiFiManager / WiFiService
- ApiServer
- SettingsManager
- GitHubClient
- TimeService

You may adjust filenames and classes to make the implementation more efficient.

Technical requirements:
- Use hardware SPI.
- Avoid blocking delays in the main application loop.
- Avoid excessive full-screen redraws.
- Keep memory usage suitable for a normal ESP32 without PSRAM.
- Handle Wi-Fi disconnections.
- Automatically reconnect when possible.
- Do not crash or reboot continuously when the GitHub API is unavailable.
- Use robust HTTP timeouts.
- Display a startup splash screen.
- Provide meaningful error messages.
- Restore the selected mode after reboot.
- Use 320×240 landscape layout consistently.

## 8. Wi-Fi provisioning

The device must be usable without editing source code to change Wi-Fi credentials.

Implement:
1. Connect using saved Wi-Fi credentials.
2. If credentials are missing or connection fails, start a setup access point.
3. Example access point name: SmartDesk-Setup.
4. Display setup instructions and the access point address on the TFT.
5. Provide a web interface for entering Wi-Fi credentials.
6. Save credentials safely using ESP32-supported non-volatile storage.
7. Restart or reconnect after successful configuration.
8. Print the assigned IP address to Serial Monitor.

Prefer a proven Wi-Fi provisioning library if appropriate.

Do not use a universal hardcoded setup password in production; provide a secure, documented provisioning mechanism.

## 9. Local REST API

Create working API endpoints:

GET /api/status

Returns:
- device name
- current mode
- connection status
- IP address
- uptime
- firmware version
- synchronization status
- timer state

GET /api/config

Returns the device's non-secret settings.

POST /api/config

Updates and persists allowed settings.

POST /api/display

Example body:
{"mode":"github"}

Valid modes:
- github
- clock
- stats
- pomodoro
- message

POST /api/message

Updates the custom message.

POST /api/pomodoro

Supports:
- start
- pause
- reset

POST /api/restart

Restarts the device after appropriate confirmation.

Validate all API inputs and return clear success/error responses.

Never return Wi-Fi passwords, API secrets, or credentials in status/config endpoints.

Make the dashboard refresh device status periodically and update immediately after successful commands.

## 10. GitHub backend integration

Create a small optional serverless API, compatible with Vercel.

Use GitHub's official GraphQL API.

Required behavior:
- Accept a GitHub username.
- Validate the username.
- Fetch contribution calendar data.
- Convert GitHub's response into compact JSON suitable for ESP32.
- Return a 52-week calendar and associated summary data.
- Compute current streak using actual calendar dates and an explicitly documented definition.
- Handle rate limiting, invalid users, and upstream failures.
- Cache responses to reduce API usage.
- Never send GitHub credentials to ESP32.
- Store credentials in server-side environment variables.

ESP32 accesses the backend using HTTPS.

Handle TLS certificate verification appropriately. Do not silently disable certificate verification in the production implementation.

Provide:
- A sample environment variable file.
- Setup instructions.
- Local test instructions.
- Deployment instructions.

The main ESP32 device must still support Clock, Pomodoro, and Custom Message when the GitHub backend is offline.

## 11. Web interface delivery

For version 1, the ESP32 itself should host the dashboard.

Use lightweight HTML/CSS/JavaScript stored in LittleFS or another suitable embedded asset system.

Do not require Node.js to run on the ESP32.

If you use a frontend build process on the developer's computer, document how to build and upload the resulting static files to ESP32.

A local React development preview is optional, but the delivered interface must actually run from the ESP32.

## 12. Automatic display rotation

Implement optional automatic screen rotation.

The user can select which display modes participate and configure a rotation interval.

Suggested intervals:
- 30 seconds
- 1 minute
- 5 minutes
- 10 minutes

Allow rotation to be disabled.

Persist the selected modes and interval.

When a user manually selects a mode, apply a documented rule for whether auto-rotation continues or pauses.

## 13. Project structure and deliverables

Create a complete repository resembling:

smart-desk-display/
- firmware/
- web/
- github-proxy/
- docs/
- README.md

Inside the repository include:

1. Complete PlatformIO firmware.
2. Functional web dashboard.
3. Display rendering modules.
4. Working local REST API.
5. GitHub proxy implementation.
6. Pin mapping documentation.
7. Wiring table.
8. Power safety notes.
9. Setup instructions.
10. Compilation instructions.
11. Flash/upload instructions.
12. Troubleshooting guide.
13. Relevant test or verification scripts.

Provide a clear explanation of which parts can be tested without hardware and which need a real ESP32.

## 14. Development workflow

Work in milestones.

**Milestone 1 — Hardware verification**

- Configure PlatformIO.
- Initialize ILI9341 using the exact specified pins.
- Set landscape orientation.
- Display a test message and colored rectangles.
- Confirm display size and initialization logic.

**Milestone 2 — Wi-Fi and web server**

- Implement Wi-Fi provisioning.
- Host a basic dashboard.
- Implement device status API.
- Allow screen mode switching from the browser.

**Milestone 3 — Screen rendering**

- Implement all five modes.
- Implement Preferences persistence.
- Optimize TFT redraw performance.

**Milestone 4 — GitHub integration**

- Implement proxy server.
- Retrieve real contributions.
- Implement caching and error handling.
- Draw the GitHub heatmap.

**Milestone 5 — UI polish**

- Complete dashboard styling.
- Implement live preview.
- Add responsive mobile layout.
- Implement auto-rotation.

**Milestone 6 — Testing and documentation**

- Build the firmware.
- Run available tests.
- Check memory constraints.
- Test API logic.
- Document flashing and Wi-Fi configuration.
- Clearly identify features not validated on physical hardware.

## 15. Quality and acceptance criteria

The project is complete when:

- ESP32 firmware builds successfully for ESP32 DevKit V1.
- TFT displays test graphics using the specified wiring.
- ESP32 can connect to Wi-Fi.
- A phone or MacBook on the same Wi-Fi can open the web dashboard.
- The website can change the active physical display mode.
- Clock works with NTP.
- Pomodoro timer works independently of the browser.
- Custom messages can be pushed to the physical display.
- GitHub contributions use real data when the secure proxy is configured.
- Configuration persists after power cycling.
- No unnecessary battery, touchscreen, SD card, or extra hardware is required.
- The system remains functional when GitHub is unavailable.

## 16. Final instructions

Do not give me only a plan.

Start implementing the project in the current workspace. Create all necessary files, write actual code, install dependencies when available, and run compilation/testing commands.

Use realistic code compatible with an actual ESP32 DevKit V1 and ILI9341 display.

Do not fabricate successful tests or pretend to have validated physical hardware.

If any specific feature requires additional hardware, implement a sensible software fallback or document it as an optional future upgrade.

When finished, explain in Vietnamese:
- What was implemented
- How to connect and test the hardware
- How to flash the firmware from macOS
- How to access the dashboard
- How to configure GitHub
- Which remaining steps require physical testing

Prioritize a reliable, working MVP over unnecessary complexity.