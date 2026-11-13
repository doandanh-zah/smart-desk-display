# Thiết lập trên macOS

## Mở workspace SSD

Khi đã cắm ổ `Extreme SSD` nhưng chưa thấy `SmartDeskDev`, gắn ảnh APFS hiện có:

```sh
hdiutil attach -nobrowse "/Volumes/Extreme SSD/06_Working/Smart Desk Display/SmartDeskDev.sparseimage"
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
pio --version
```

Nếu môi trường PlatformIO chưa có, dùng Python 3.11 trên Mac để dựng venv trên SSD. Thay `python3.11` bằng đường dẫn tới bản Python 3.11 đã cài nếu cần.

```sh
source .dev/env.sh
python3.11 -m venv "$SMART_DESK_DEV/pio-venv"
"$SMART_DESK_DEV/pio-venv/bin/python" -m pip install 'platformio==6.1.19'
pio --version
```

`.dev/env.sh` trỏ cache, gói và thư mục tạm vào volume dự án. Nạp lại tệp khi mở terminal mới.

## Build firmware và LittleFS

Từ repo sau khi nạp môi trường:

```sh
pio run -d firmware
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/littlefs-build" \
  PLATFORMIO_DATA_DIR="$SMART_DESK_ROOT/web/public" pio run -d firmware -t buildfs
bash verification/check_littlefs.sh "$SMART_DESK_DEV/littlefs-build/esp32doit-devkit-v1/littlefs.bin"
```

PlatformIO lấy asset trực tiếp từ `web/public/` để đóng gói dashboard. Firmware và LittleFS dùng hai thư mục build để cả hai ảnh còn sẵn sau khi build. Dùng cùng một phiên bản nguồn khi build cả hai. Ghi lại số liệu Flash/RAM trong output của firmware và kiểm tra ảnh LittleFS trước khi nạp. [PlatformIO ESP32 và LittleFS](https://docs.platformio.org/en/latest/platforms/espressif32.html#uploading-files-to-file-system-spiffs-littlefs-fatfs)

## Nạp qua USB-C

Chỉ nạp sau khi hoàn tất [checklist nối dây](hardware.md). Cắm cáp USB-C có dữ liệu, so sánh danh sách cổng trước và sau khi cắm bằng `pio device list`. Đóng Serial Monitor hoặc chương trình đang giữ cổng trước khi upload. Trong workspace dùng chung, session hardware giữ cổng và thực hiện toàn bộ bước này.

```sh
PORT=/dev/cu.usbserial-0001   # Thay bằng cổng vừa xác nhận.
pio run -d firmware -t upload --upload-port "$PORT"
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/littlefs-build" \
  PLATFORMIO_DATA_DIR="$SMART_DESK_ROOT/web/public" pio run -d firmware -t uploadfs --upload-port "$PORT"
pio device monitor -d firmware --port "$PORT" --baud 115200
```

`uploadfs` ghi lại phân vùng LittleFS. Bấm EN sau khi nạp nếu cần khởi động lại, rồi quan sát splash hoặc hướng dẫn Wi-Fi trên TFT. Dùng Ctrl+C để nhả serial. Nếu quá trình kết nối bootloader bị kẹt ở `Connecting...`, giữ BOOT, bấm rồi thả EN, thả BOOT khi công cụ nhận thiết bị. [Espressif — Boot Mode Selection](https://docs.espressif.com/projects/esptool/en/latest/esp32/advanced-topics/boot-mode-selection.html)

## Kết nối Wi-Fi và mở dashboard

1. Nếu chưa có cấu hình hoặc kết nối đã lưu thất bại, TFT hiển thị SSID setup và mật khẩu WPA2 được tạo cho phiên đó. Dùng thông tin trên TFT để kết nối từ điện thoại hoặc Mac.
2. Mở `http://192.168.4.1/`, nhập SSID và mật khẩu Wi-Fi 2,4 GHz, rồi lưu. ESP32 chỉ lưu thông tin sau khi kết nối thành công và nhận IP.
3. Chờ ESP32 kết nối. Đưa điện thoại hoặc Mac về cùng mạng nội bộ với ESP32. Mở địa chỉ IP mới hiển thị trên TFT hoặc Serial Monitor bằng HTTP. Khi mDNS hoạt động, tên mặc định là `http://esp32-display.local/`. Đổi tên thiết bị có thể đổi tên `.local`.
4. Chọn Clock để kiểm tra đồng bộ NTP hoặc Pomodoro để kiểm tra dashboard ngay cả khi Internet gián đoạn. Dùng dashboard để đổi mode sau đó. Giữ dashboard trong mạng LAN tin cậy.

## Mode khởi động và xoay tự động

Chọn mode thủ công sẽ lưu mode đó để khởi động lần sau và tính lại thời gian chờ xoay. Có thể đặt Startup Mode trực tiếp trong Settings. Xoay tự động chuyển mode hiển thị theo danh sách đã chọn trong lần chạy hiện tại. Pomodoro trở về trạng thái idle sau khi ESP32 khởi động lại. Tin nhắn và kiểu hiển thị được lưu, với tối đa 160 ký tự ASCII in được và xuống dòng, căn trái/giữa/phải, màu RGB và cỡ 1–4.
