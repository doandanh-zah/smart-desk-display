# Smart Desk Display — session handoffs

The shared repository lives at `/Volumes/SmartDeskDev/smart-desk-display`.
The APFS disk image lives on the external SSD at
`/Volumes/Extreme SSD/06_Working/Smart Desk Display/SmartDeskDev.sparseimage`.
After reconnecting the SSD, if the workspace is missing, mount the image with
`hdiutil attach -nobrowse "/Volumes/Extreme SSD/06_Working/Smart Desk Display/SmartDeskDev.sparseimage"`.
Use the existing disk image. Source `.dev/env.sh` before installing dependencies or running builds.
Keep project source, dependencies, caches, virtual environments, toolchains, build products, logs and scratch files on this volume.
Keep ordinary system and Codex app data in their existing locations. Use explicit working directories on the mounted volume.

The master prompt is in this directory. The user confirmed the wiring in the prompt matches their device and has connected the ESP32. macOS exposed `/dev/cu.usbserial-0001`. Treat that as a candidate until the hardware session verifies it. The TFT VCC wiring is 5V/VIN with MSP2806 onboard regulator enabled and J1 open. Only hardware inspection can confirm the module and J1. LED is permanently tied to 3V3.

| Session | Owns | Handoff in this directory |
| --- | --- | --- |
| Hardware and flashing | hardware-check/, SSD PlatformIO bootstrap, USB serial | hardware.md |
| Device firmware | firmware/ except display files and GitHub provider files below | device-api.md, display-contract.md, firmware.md |
| TFT rendering | firmware/include/display/, firmware/src/display/ | display.md |
| Web dashboard | web/ | web.md |
| GitHub data | github-proxy/, firmware/include/github/, firmware/src/github/ | github-contract.md, github.md |
| Integration and docs | README.md, docs/ outside coordination/, verification/ | integration.md |

Device firmware owns PlatformIO configuration and composition, including linking the other C++ modules and serving web assets. Dashboard consumes device-api.md and display-contract.md. GitHub data publishes github-contract.md and consumes the device integration interface from the firmware session. Each session writes its own short handoff with files, verification, and open issues. Coordinate interface changes through the owner. Keep serial access exclusive to hardware, including full firmware flashing after integration asks for it. Use local fixtures to test in parallel while another session supplies its interface. Report physical observations and software test results with their actual evidence.
