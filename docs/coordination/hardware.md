# Handoff phần cứng

## Toolchain dùng chung

Repo ở `/Volumes/SmartDeskDev/smart-desk-display`. Nạp môi trường trước khi chạy
PlatformIO. `.dev/env.sh` đưa venv `.dev/pio-venv` vào PATH và giữ cache,
toolchain PlatformIO cùng tệp tạm trên volume SSD. Bootstrap dùng Python 3.11
và PlatformIO Core 6.1.19. Nếu cần dựng lại venv từ đầu:

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
/opt/homebrew/bin/python3.11 -m venv "$SMART_DESK_DEV/pio-venv"
python -m pip install 'platformio==6.1.19'
```

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
pio --version
pio run -d hardware-check
```

`hardware-check/` là project Arduino riêng cho `esp32dev`. Các session khác
có thể build project mình sở hữu. Session phần cứng giữ độc quyền thao tác với
cổng serial, kể cả khi tích hợp yêu cầu nạp firmware chính.

## Kiểm tra trước khi cấp nguồn TFT

Rút USB trước khi kiểm tra hoặc thay đổi dây. Với TFT VCC nối 5V/VIN, xác nhận
đúng MSP2806, có bộ ổn áp tích hợp đang được dùng và J1 hở. Nếu không xác định
được hoặc J1 đã nối, giữ TFT cách ly khỏi 5V. Đối chiếu GND → GND, CS → GPIO27,
RESET → GPIO25, DC → GPIO26, MOSI → GPIO23, SCK → GPIO18, LED → 3V3. Logic
SPI dùng 3,3 V. Để hở SDO/MISO và các chân touch. LED nối cố định vào 3V3.
[Thông số chân MSP2806](https://www.lcdwiki.com/res/MSP2807/MSP2806_Size_QD.pdf)
và [sơ đồ nguồn của dòng MSP2806/MSP2807](https://www.lcdwiki.com/res/MSP2807/MSP2807-2.8-SPI.pdf).

## Smoke test

Sketch dùng SPI phần cứng ở 10 MHz, rotation 1, canvas 320×240. Khi hoạt động,
TFT dự kiến hiện nền đen, viền trắng, dòng `SMART DESK`, dòng
`ILI9341 320 x 240` và bốn ô đỏ, lục, lam, trắng theo thứ tự từ trái qua phải.
Log `TFT_SMOKE` xác nhận sketch đã gọi lệnh vẽ. Dây MISO để hở nên cần quan sát
trực tiếp để xác nhận hình ảnh, màu và hướng hiển thị.

## Bằng chứng hiện tại

Esptool 4.9.0 đọc thành công qua `/dev/cu.usbserial-0001`. Kết quả là
ESP32-D0WD-V3 revision 3.1, xung tinh thể 40 MHz, flash 4 MB và MAC kết thúc
`94:60`. Lệnh đưa chip vào ROM bootloader rồi reset qua RTS. Lệnh đọc ID
flash, không nạp firmware. Log nằm trong `.dev/logs/esp32-identify.log`.

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
esp_tool_dir="$PLATFORMIO_CORE_DIR/packages/tool-esptoolpy"
PYTHONPATH="$esp_tool_dir/_contrib" python "$esp_tool_dir/esptool.py" \
  --chip esp32 --port /dev/cu.usbserial-0001 --baud 115200 --no-stub flash_id
```

`pio run -d hardware-check` thành công. Build dùng Espressif32 6.12.0,
Arduino-ESP32 2.0.17, Adafruit ILI9341 1.6.2 và GFX 1.12.4. PlatformIO
báo RAM tĩnh 21.680/327.680 byte (6,6%) và flash chương trình
283.657/1.310.720 byte (21,6%). Log nằm trong
`.dev/logs/hardware-smoke-build.log`.

## Nạp và xác nhận

Sau khi điều kiện nguồn được xác nhận, session phần cứng nạp vào cổng đã
định danh rồi kiểm tra serial ở 115200 baud. Nếu có thiết bị USB serial mới
hoặc cổng đổi tên, đọc lại ID trước khi nạp.

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
pio run -d hardware-check -t upload --upload-port /dev/cu.usbserial-0001
pio device monitor -d hardware-check --port /dev/cu.usbserial-0001 --baud 115200
```

Người dùng xác nhận đúng MSP2806, còn bộ ổn áp trên mạch, J1 hở và đã
cắm lại USB. Đọc lại ID trước khi nạp cho thấy cùng ESP32-D0WD-V3 revision
3.1, flash 4 MB và MAC kết thúc `94:60`. Log kiểm tra lại nằm trong
`.dev/logs/esp32-identify-before-upload.log`.

Smoke test đã nạp thành công qua đúng cổng. Esptool xác minh hash các vùng
đã ghi và reset qua RTS. Log nạp ở `.dev/logs/hardware-smoke-upload.log`.
Serial 115200 baud nhận hai dòng đầy đủ
`TFT_SMOKE drawing sent, canvas=320x240, rotation=1, SPI=10000000 Hz`
trong `.dev/logs/hardware-smoke-serial-confirmed.log`.
Người dùng xác nhận trực tiếp nền đen, viền trắng, chữ `SMART DESK`
nằm ngang và bốn ô đỏ, lục, lam, trắng từ trái sang phải. Smoke test TFT đạt.

## Firmware chính

Đọc lại ESP32 trước khi nạp bản chính. Chip, flash và MAC trùng với lần
kiểm tra smoke test. Log ở `.dev/logs/esp32-identify-before-release.log`.

Build lại firmware từ source hiện tại trong
`.dev/hardware-release/firmware-build/`. Build đạt với RAM tĩnh 51.972 byte
(15,9%) và flash chương trình 1.067.065 byte (50,9%).
Dùng thư mục LittleFS đã bàn giao trong `.dev/integration/fs-build/`.
Target `uploadfs` tạo lại ảnh từ `web/public/`. SHA-256 ảnh LittleFS thay
đổi khi tạo lại. Sau khi nạp, `verification/check_littlefs.sh` xác nhận
`index.html`, `styles.css`, `preview.js`, `app.js` khớp byte với nguồn.

| Ảnh đã nạp | SHA-256 |
| --- | --- |
| Firmware | `912f9748d1e28daa5b29522ab4bb63c4c60c9d5bb528f63aa1d2e00af58379e0` |
| LittleFS | `320eba3aca671677f105c69d71788e5376011ae29b20e85f02bf29e5dee6f512` |

Nạp qua `/dev/cu.usbserial-0001` thành công. Esptool xác minh dữ liệu ghi
ứng dụng tại `0x10000` và LittleFS tại `0x210000` (1.966.080 byte).
Log nằm trong `.dev/logs/hardware-release-{build,upload,uploadfs}.log`.

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
export PLATFORMIO_LIBDEPS_DIR="$SMART_DESK_DEV/integration/libdeps"
export PLATFORMIO_DATA_DIR="$SMART_DESK_ROOT/web/public"
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/hardware-release/firmware-build" \
  pio run -d firmware -j 3 -t upload --upload-port /dev/cu.usbserial-0001
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/integration/fs-build" \
  pio run -d firmware -t uploadfs --upload-port /dev/cu.usbserial-0001
```

Sau khi nạp, serial 115200 baud báo `SPI_FAST_FLASH_BOOT` và AP
`SmartDesk-Setup-60949B` tại `http://192.168.4.1/`. Lần quan sát này
không có cảnh báo lỗi mount LittleFS, lỗi HTTP hoặc lặp boot. Log
`.dev/logs/hardware-release-boot.log`. Đã đóng cổng serial.

Người dùng kết nối vào AP setup bằng mật khẩu trên TFT, mở
`http://192.168.4.1/` và nhập Wi-Fi 2,4 GHz. Sau khi ESP32 có IP, chuyển
điện thoại hoặc Mac về cùng Wi-Fi và mở IP hiển thị trên TFT hoặc
`http://esp32-display.local/`. Tiếp theo, session tích hợp có thể dùng
`python3 verification/check_http.py device ORIGIN` qua LAN. Đang chờ xác
nhận màn hình setup của firmware chính và kiểm tra provisioning, dashboard
qua LAN, NTP, đổi mode vật lý, lưu cấu hình và GitHub thật.

## Kết nối Wi-Fi nhà và kiểm tra qua LAN

Người dùng thấy trang setup báo connected. Mac xác định ESP32 ở
`http://192.168.88.192/` qua MAC đã định danh, rồi nhận HTTP 200 cho dashboard
và ba API GET. Bốn asset từ LittleFS khớp byte với `web/public/`. API báo
`wifi.connected=true`, `wifi.provisioning=false` và NTP đã đồng bộ UTC+7.
Tại thời điểm đo, đồng hồ ESP32 và Mac lệch 0 giây.

Tên `esp32-display.local` chưa phân giải trên Mac. Dùng IP ở trên.
`python3 verification/check_http.py device http://192.168.88.192` phát hiện
thiếu `wifi.ip` và `wifi.hostname` trong `/api/status`. Kiểm tra tiếp
cho thấy `/api/config` đạt, `/api/github` thiếu `error` và `lastSync`.
Các trường thiếu đều được ghi qua `nullable(JsonVariant, ...)` trong
`firmware/src/desk/App.cpp`; firmware owner có thể kiểm tra cách helper
tạo key qua ArduinoJson. Log `.dev/logs/hardware-release-lan.log` và
`.dev/logs/hardware-release-lan-checks.log`.

## Chuẩn bị bản sửa sau demo

Kiểm tra chỉ đọc trước khi nhận handoff. Thiết bị đang ở
`http://192.168.88.192/`, firmware `1.0.0`, Wi-Fi đã nối, NTP UTC+7 đã
đồng bộ. Pomodoro đang tạm dừng với 24:48 còn lại tại lúc kiểm tra. Dashboard
đang phục vụ bốn asset trùng byte với nguồn hiện tại. Sau handoff web, đối
chiếu lại các asset để quyết định có cần nạp LittleFS. Bản sửa phải giữ
phân vùng NVS tại `0x9000–0xDFFF` chứa cấu hình và Wi-Fi. Chưa reset hay
nạp bản sửa trong bước chuẩn bị.

### Đã nạp firmware 1.0.1 và dashboard sau demo

- Đã báo trước lần reboot vì Pomodoro đang tạm dừng. Đọc lại chip qua
  esptool, trùng ESP32-D0WD-V3 revision 3.1, flash 4 MB, MAC đuôi `94:60`.
- Dùng đúng ảnh từ handoff firmware và web. SHA-256 firmware
  `badbbfab2073ca4894efbab9c9a154cbabf461bbccbf4f2572e012612a3395e2`.
  SHA-256 LittleFS `cc6b86e0ac9e21be98e7998d5da957d2e4bbc19eea352041d41e03f59be39365`.
  Trước nạp, giải nén LittleFS và đối chiếu bốn asset với `web/public/`.
- Dùng một lệnh esptool `write_flash` ở 115200 baud, ghi firmware
  tại `0x10000` và LittleFS tại `0x210000`. Hai vùng đều qua xác minh
  hash. Giữ bootloader, bảng phân vùng, OTA data và NVS. Log
  `.dev/logs/hardware-1.0.1-{identify,flash}.log`.
- Sau reset, ESP32 tự nối Wi-Fi đã lưu, trở lại `http://192.168.88.192/`,
  trả phiên bản `1.0.1`, báo provisioning đóng. Mode khởi động `github`,
  Pomodoro về `idle`. NTP đồng bộ UTC+7 trong lần đọc ở uptime 29 giây,
  lệch 0 giây so với Mac tại lần đọc đó. Xác nhận boot qua LAN và uptime.
  Cổng serial đã đóng, không reset thêm để lấy log boot.
- `python3 verification/check_http.py device http://192.168.88.192` đạt
  cả ba GET API và dashboard. So sánh từng byte cho thấy bốn asset đang
  phục vụ trùng với nguồn web mới. Log
  `.dev/logs/hardware-1.0.1-{lan,http,ntp}.log`.
- API báo `wifi.hostname=esp32-display.local`. Trên Mac, tra tên không
  trả IP và curl trực tiếp hết thời gian phân giải. Dùng `--resolve`
  ép hostname tới IP thì HTTP 200. Log `.dev/logs/hardware-1.0.1-mdns.log`.
  Dùng IP cho nghiệm thu E2E. Phân giải mDNS trên LAN vẫn chưa đạt.

## Bản GitHub theo ảnh tham chiếu

- Đã dùng bản firmware tích hợp sau khi nối `configuredGitHubUsername`
  từ cấu hình, cùng LittleFS build lại từ bản web đã bàn giao. Xác nhận
  trong firmware có cả CA GTS Root R1 và ISRG Root X1.
- SHA-256 firmware
  `54773d200c460160e097a219356897a0f2f64f56bb781cff36f5a8a111df925a`.
  SHA-256 LittleFS
  `b5f5689ff6eb982da389f31dbd4fdf2bd5aceda65f7347b32d449e8df1b489f4`.
  Tệp tương ứng là
  `.dev/integration/github-reference/firmware-build/esp32doit-devkit-v1/firmware.bin`
  và `.dev/hardware-github-reference/fs-build/esp32doit-devkit-v1/littlefs.bin`.
- Trước nạp, Pomodoro ở `idle`. Esptool nhận đúng chip/MAC và ghi hai ảnh
  trong một lượt tại `0x10000` và `0x210000`. Xác minh hash cả hai đạt.
  Chỉ xóa vùng của hai ảnh. Cổng serial đã nhả. Log
  `.dev/logs/hardware-github-reference-flash.log`.
- Sau reboot, ESP32 tự nối Wi-Fi đã lưu tại `http://192.168.88.192/`.
  API báo phiên bản `1.0.1`, NTP UTC+7 đã đồng bộ. Strict HTTP kiểm tra
  đạt ba GET và dashboard. Bốn asset phục vụ qua LAN khớp byte với nguồn.
  Log `.dev/logs/hardware-github-reference-http.log`.
- Snapshot toàn bộ cấu hình trước/sau khác ở `startupMode` và `theme`.
  Mode khởi động từ `clock` sang `message`. Không xác định nguồn thay
  đổi trong lần kiểm tra này. Handoff phần cứng chỉ đọc API và không ghi
  đè cấu hình quan sát được. Wi-Fi tự kết nối lại, các khóa cấu hình
  còn lại khớp snapshot. Mode hiện tại là `message`, GitHub là `demo`
  tại lần đo. Session tích hợp có thể cấu hình GitHub live đã xác nhận
  và chuyển mode để người dùng đối chiếu TFT với preview.

## Bản GitHub có mascot động

- Nhận handoff TFT, web và kết quả tích hợp. Vì renderer đã thay đổi sau
  ảnh QA tích hợp, build lại firmware và LittleFS từ source cuối trên SSD
  trong `.dev/hardware-github-mascot/{firmware-build,fs-build}/esp32doit-devkit-v1/`.
  Build firmware đạt với 51.980 byte RAM tĩnh (15,9%) và 1.070.801 byte
  flash ứng dụng (51,1%). Giải nén LittleFS 1.966.080 byte và đối chiếu
  cả bốn asset với `web/public/`.
- SHA-256 ảnh firmware đã nạp
  `6cd83cb4cc84392353b05be978e0ec40b40a7ae2660b7fadf57c39a7cecf2ccb`.
  SHA-256 ảnh LittleFS đã nạp
  `d391b0dc39ac40e9631b2f485e392a54ffb97769979ec57b52d86b86d565d4fb`.
- Pomodoro ở `idle` và GitHub ở `live` ngay trước khi nạp. Esptool nhận
  ESP32-D0WD-V3 revision 3.1, MAC đuôi `94:60`, ghi hai ảnh trong một
  lượt tại `0x10000` và `0x210000` rồi xác minh hash cả hai. Không ghi
  NVS. Cổng serial đã đóng sau nạp.
- Sau boot ESP32 tự nối Wi-Fi ở `http://192.168.88.192/`, báo phiên bản
  `1.0.1` và vào thẳng mode GitHub. Toàn bộ `GET /api/config` khớp
  snapshot trước nạp. NTP đồng bộ UTC+7. GitHub trở lại `live` cho
  `doandanh-zah`, đủ 364 ô, lỗi `null`, timestamp mới
  `2026-11-13T06:15:29Z`. Strict HTTP đạt ba GET và dashboard. Bốn asset
  đang được phục vụ khớp byte với source.
- Log `.dev/logs/hardware-github-mascot-{build,fs,flash,lan}.log`.
  Session 06 có thể nghiệm thu ảnh preview trên LAN và phối hợp người
  dùng quan sát mèo chớp mắt/vẫy đuôi trên TFT trong ít nhất 5 giây.
  Session phần cứng chưa trực tiếp thấy hình hay chuyển động trên TFT.

## Firmware 1.1.0 · ZAH NFT và Remote Admin

- Nạp bản đã bàn giao của 02/03/04 khi Pomodoro ở `idle`. Firmware
  SHA-256 `0269fa6ca24e5a4429d3b6f0a05ca7c89ddd6cdb63739a3b4f6e7583990b27a8`.
  LittleFS build lại từ `web/public/`, SHA-256
  `f45905c4f2216be3d351c2f565a620f698ad180af78eb8ef819508bcef077ebd`.
  Giải nén ảnh LittleFS 1.966.080 byte và đối chiếu sáu asset, gồm
  `transport.js` và `zah-avatar.webp`.
- Cùng ESP32-D0WD-V3 revision 3.1, MAC đuôi `94:60`. Lần ghi đầu dừng
  ở 23% vì chip ngừng phản hồi. Lần thử lại ghi đủ app nhưng mất gói
  trước khi xác minh. Dùng `esptool verify_flash 0x10000 firmware.bin`
  riêng ở 460800 baud, digest khớp. Sau đó ghi và xác minh LittleFS
  tại `0x210000` ở 460800 baud. Chỉ thao tác hai vùng app và LittleFS.
  Log `.dev/logs/hardware-remote-{flash,flash-retry,app-verify,flash-fs}.log`.
- Sau reboot, ESP32 báo `1.1.0`, tự nối Wi-Fi tại `http://192.168.88.192/`
  và đồng bộ NTP UTC+7. GitHub `live` cho `doandanh-zah`, đủ 364 ô,
  lần sync `2026-11-13T06:42:17Z`. Toàn bộ config LAN trước/sau khớp.
  Strict HTTP qua LAN đạt và sáu asset đang phục vụ khớp byte với nguồn.
  Log `.dev/logs/hardware-remote-lan.log`. Cổng serial đã nhả.
- TFT mặc định vào mode Message theo cấu hình đã lưu. Người tại bàn có
  thể chọn GitHub Contributions trên LAN để đối chiếu nhân vật ZAH NFT
  chớp/cười và ô bo lớn. TFT/preview mô phỏng 24 tuần, lịch web 52 tuần.
- Gateway production đang khóa chờ Redis Upstash và hash mật khẩu admin.
  Đường dẫn ghép USB đã bàn giao riêng, token chưa nạp vào ESP32. Chờ
  gateway sẵn sàng để ghép và kiểm chứng online cùng session 05/06.

### Chuẩn bị ghép cloud sau khi owner cấu hình

Firmware đang chạy là 1.1.0. LAN, GitHub live và NVS hiện sẵn sàng.
Kiểm tra HTTPS trước ghép thấy trang chủ và endpoint session trả 308,
đích chuyển hướng không phải canonical origin. Cần 05 kiểm tra
`ADMIN_ORIGIN` Production và xác nhận gateway trả session HTTP 200,
admin vô danh 401 trước khi cấp credential qua USB. Chưa mở serial.

### Dashboard LAN thiết kế lại

- Đã dùng handoff web để build LittleFS từ `web/public/`. Giải nén
  và đối chiếu sáu asset. SHA-256 ảnh đã nạp
  `3ae2f37df181503b0a5d53e23a7917f51e07b5fa7d7477a719d4de7d3c235952`.
- Pomodoro `idle` trước nạp. Esptool nhận đúng ESP32/MAC, ghi và xác minh
  riêng phân vùng LittleFS tại `0x210000` ở 460800 baud. Firmware vẫn 1.1.0.
- ESP32 tự nối Wi-Fi tại `http://192.168.88.192/`. Config LAN sau nạp
  khớp hoàn toàn snapshot trước nạp, NTP UTC+7 và GitHub live đủ 364 ô.
  Strict HTTP đạt. Cả sáu asset qua HTTP khớp byte với nguồn mới.
  Log `.dev/logs/hardware-remote-redesign-{fs,flash,lan}.log`.
- Gateway trở về 503 `setup_required` sau khi sửa canonical origin.
  Redis đã liên kết theo handoff 05. Chưa ghép credential qua USB,
  đang chờ gateway xác thực hoạt động.

## Chuẩn bị bộ mode và palette mới

Đã kiểm tra chỉ đọc bản 1.1.0 qua LAN và lưu snapshot riêng trên SSD
để đối chiếu migration. Giữ app, LittleFS và NVS hiện tại trong lúc chờ
handoff 02/03/04/06. Trước khi nạp kiểm lại Pomodoro và Countdown, nếu
API bản cũ chưa có Countdown thì đối chiếu phiên bản. Sau nạp xác nhận
Wi-Fi, GitHub live, migration cấu hình theo `modes-contract.md`, palette
và các route mode mới. Gateway Production vẫn chờ cấu hình xác thực,
chưa ghép USB.

### Ghép cloud · cập nhật sau lần deploy kích hoạt

05 xác nhận đã có biến xác thực Production, nhưng gateway vẫn trả 503
vì định dạng giá trị `ADMIN_PASSWORD_HASH` không đạt. Redis và hash
token thiết bị qua kiểm tra cấu hình của 05. Chờ owner lưu hash đúng
định dạng bằng script của dự án, 05 deploy lại và smoke active đạt.
ESP32 vẫn dùng firmware 1.1.0 qua LAN; chưa nạp bộ mode đang triển khai,
chưa mở serial và chưa cấp token.

### Ghép cloud · lần deploy PIN 15:08 ICT

05 deploy lại bản admin đã nghiệm thu. Probe độc lập
`GET /api/auth/session` và `GET /api/admin/state` vẫn trả 503.
Smoke active của 05 chưa đạt. Metadata cập nhật
`ADMIN_PASSWORD_HASH` vẫn là 14:49:35 ICT, trùng với giá trị đã bị báo
sai định dạng trước lần tạo PIN mới. Chờ xác nhận đã lưu hash mới đúng
project Production, redeploy và smoke active. Firmware 1.1.0 tiếp tục
hoạt động trên LAN, GitHub live. Chưa mở serial, chưa cấp token,
chưa reboot và chưa nạp bộ mode đang triển khai.

### Ghép cloud thành công · Production active

- Bản gateway đã qua smoke active 11/11, đối chiếu [handoff 05](remote-admin.md).
  Kiểm tra USB lần đầu báo remote disabled. Pomodoro idle trên firmware
  1.1.0 trước ghép. Lần gửi đầu không nhận ACK và kiểm lại vẫn disabled.
  Gửi lại sau 2 giây ổn định cổng USB, ESP32 xác nhận lưu credential.
  Dùng luồng trực tiếp từ tệp riêng đã bàn giao. Log chỉ có ACK hoặc lỗi chung.
- Dù đã nhả DTR/RTS trước khi mở USB serial, quan sát được POWERON_RESET
  khi dùng USB diagnostics. Sau boot credential vẫn enabled. Serial báo
  `transport_ok=1 http=200` trên sync Production, heap trước TLS
  160.560 byte, block lớn nhất 110.580 byte, heap trong TLS 106.584 byte,
  stack worker còn tối thiểu 6.648 byte tại mẫu đo. Đã đóng serial.
- Qua LAN, firmware vẫn 1.1.0 và Wi-Fi tự kết nối lại tại
  `http://192.168.88.192/`. Config khớp trước ghép, NTP đồng bộ, GitHub
  live và strict HTTP đạt. Giữ firmware và LittleFS đang nạp.
- Log `.dev/logs/hardware-remote-pairing-{retry,diag,lan}.log`. Session 06
  có thể dùng phiên admin của chủ tài khoản để xác nhận trạng thái
  `online`, heartbeat tiếp diễn và thử lệnh có ACK. Hardware đã xác nhận
  sync ESP32 thật qua TLS và LAN, chưa chạy lệnh thay đổi từ web admin.

## Rollout mode v2 · firmware 1.2.0

- Nạp từ source đã kiểm ở commit `3ab9155`. Firmware theo handoff 02,
  SHA-256 `17e2688da2e7cab5dd8b429765efad4a27d2869d11abe578bfc1d34ba1de0097`.
  LittleFS build lại vì ảnh web bàn giao có nhãn login cũ. Cả sáu asset
  giải nén khớp byte với `web/public/`. SHA-256 ảnh đã nạp
  `c84343eeadb68cb281de91cebe4943906131fbba9e638a1dfee0c3fa1fa187d9`.
- Ngay trước ghi, firmware 1.1.0, Pomodoro idle và chưa có Countdown.
  Esptool nhận đúng MAC đuôi `94:60`. USB mất gói ở bước xác minh tự
  động sau khi ghi đủ app. Đọc digest riêng bằng `verify_flash` xác
  nhận app khớp, rồi ghi/xác minh LittleFS. Chỉ ghi tại `0x10000` và
  `0x210000`, giữ NVS, Wi-Fi và remote token. Đã đóng cổng serial.
- ESP32 boot firmware 1.2.0, tự nối lại LAN `http://192.168.88.192/`
  và vào GitHub. NTP UTC+7 đã sync và GitHub `live` trở lại. Cả sáu
  asset qua HTTP khớp nguồn. Strict HTTP đạt. `verification/check_modes.py`
  đạt status/countdown, Calendar và hai route Codex/Claude. Countdown
  khởi động ở duration idle 1.500 giây. Nguồn Calendar/quota thật chưa
  được kiểm qua bước nạp.
- So cấu hình trước/sau, chỉ `rotation.modes` đổi theo migration:
  `github,clock,stats,pomodoro,message` → `github,clock,countdown`.
  Rotation vẫn tắt, các trường khác khớp. Log
  `.dev/logs/hardware-modes-v2-{fs,flash,app-verify,flash-fs,http}.log`.
- Đối chiếu metadata Vercel sau boot, ESP32 tiếp tục POST sync HTTP 200
  vào deployment v2 `dpl_7YLYkxVge88dV1yabEA9CBfoetRJ` lúc 15:32:29
  và 15:32:32 ICT, không ghép lại. Log
  `.dev/logs/remote-admin-modes-v2-heartbeat.log`. 06 có thể tiếp tục
  nghiệm thu ACK với phiên của chủ tài khoản.
- Cần quan sát TFT thật sau rollout: kiểm tra năm mức màu của heatmap
  GitHub, ô thấp nhất vẫn phân biệt với nền, cùng bố cục 24 tuần và
  mascot. Chọn Clock/Calendar, Countdown, Codex và Claude để kiểm tra
  tên màn, dữ liệu khi có nguồn và nhãn thiếu nguồn khi chưa nối.

## Chuẩn bị bản tốc độ, palette và nguồn dữ liệu thật

Đo LAN chỉ đọc trên firmware 1.2.0 qua IP thiết bị từ Mac. Bảy GET tuần
tự mỗi route, tính cả thời gian tải response. Trung vị status/config/
GitHub/integrations lần lượt 46/46/39/41 ms. HTML 144 ms (20.780 byte),
app.js 253 ms (49.261 byte). Calendar, Codex, Claude đều unavailable
tại lúc đo. Đây là baseline HTTP LAN, chưa đo thời gian giao diện vẽ
hay round trip lệnh cloud. Log `.dev/logs/hardware-lan-speed-baseline.log`.
Chờ ảnh đã kiểm của các session. Kiểm tra lại hai timer ngay trước khi
nạp và đọc lại LAN, GitHub, heartbeat cùng diagnostics heap/TLS sau boot.

Bản 1.2.0 đã nhận một mẫu Codex thật từ cloud; Calendar và Claude chưa có
nguồn tại lần kiểm tra. Chưa flash bản tốc độ. Session 06 đang chờ firmware
hỗ trợ `pollHints:true` và nhịp nền 60 giây trước khi bàn giao SHA tích
hợp. Theo yêu cầu commit trước flash, build firmware/LittleFS từ bản trích
xuất sạch của đúng SHA bàn giao trên SSD và ghi hash của hai ảnh vào mục
nạp. Bộ lệnh chuẩn bị cục bộ ở
`.dev/hardware-latency-release/build-exact.sh`, chạy sau khi nạp `.dev/env.sh`.

## Rollout 1.2.1 · độ trễ, quota và nền heatmap trung tính

- SHA chung đã commit trước khi nạp:
  `d2da7a9984073462e72d42bc196c08e02c91ba7e`.
  Dùng đúng hai ảnh từ bản trích xuất sạch do 06 bàn giao trong
  `.dev/integration/responsiveness/release-d2da7a9984073462e72d42bc196c08e02c91ba7e/.pio-build/esp32doit-devkit-v1/`.
  Đối chiếu SHA-256 và giải nén LittleFS để so sáu asset với tree cùng SHA.
- Firmware SHA-256
  `c38a1890c9d756a1a7b2774eb5f6b1f8c09134e8fafc4b79ebc2f08adc1d47ab`.
  LittleFS SHA-256
  `a37730494f227b3ec3ea494be2923e1ae7546fbf4c481a7134ae289e1cb579a9`.
- Cả Countdown và Pomodoro idle trước flash. Esptool nhận ESP32 có MAC
  đuôi `94:60`, ghi ở 460800 baud tại `0x10000` và `0x210000`,
  xác minh digest cả hai và reset. Giữ NVS, bảng phân vùng và bootloader.
  Log `.dev/logs/hardware-1.2.1-flash.log`.
- Boot 1.2.1, tự kết nối lại Wi-Fi tại `http://192.168.88.192/`, NTP
  UTC+7 và GitHub live. Sáu asset qua LAN khớp byte với tree. Strict HTTP
  và kiểm API mode v2 đều đạt. Lần so cấu hình đầu tiên gặp khác biệt,
  lần đọc xác nhận tiếp theo khớp toàn bộ snapshot trước flash. Không ghi
  API thay đổi cấu hình trong phiên phần cứng. Xem
  `.dev/logs/hardware-1.2.1-lan-confirmed.log`.
- Production đã deploy cùng SHA theo 05. ESP32 nhận mẫu Codex live với
  cửa sổ 300/10.080 phút, cả hai thời điểm reset, `credit` và
  `resetCredits`. Calendar và Claude báo unavailable tại lần đọc.
- Cả hai timer idle trước mở USB diagnostics. Cổng USB gây POWERON_RESET
  dù đã nhả DTR/RTS. Sau boot, remote vẫn enabled và sync HTTPS trả 200.
  Heap trước TLS 159.024 byte, block lớn nhất 110.580 byte, heap khi giữ
  TLS 101.908 byte, stack worker còn 6.644 byte tại mẫu đo. Đây là một
  mẫu sync, chưa phải thử tải nhiều phiên. Log
  `.dev/logs/hardware-1.2.1-remote-diag.log`. Đóng serial rồi kiểm lại
  LAN/NTP/GitHub và API v2, đều đạt.
- TFT mới còn cần xác nhận trực quan: nền và thẻ GitHub trung tính,
  ô 0 tách nền, các mức xanh dễ phân biệt, mascot ổn định khi heatmap
  cập nhật. 06 tiếp tục đo độ trễ lệnh cloud sau rollout.

## Rollout 1.2.2 · tiêu đề lịch và Wi-Fi cài đặt

- Đối chiếu toàn bộ nguồn firmware trong bản trích xuất sạch với commit
  `8a9a9b8f9df156627c7da9abfbb84a5a7f9bfeb5`. Build ESP32 đạt. Firmware
  SHA-256 `766a1a365d7b70bc667aa93b76d116a8d1aca813d175efa3ae285593fc7c746e`.
  Kiểm thử host của phiên firmware xác nhận `Họp` → `Hop` trên dữ liệu
  dành cho TFT và giữ tiêu đề gốc ở API.
- Mac đang ở mạng `192.168.33.x`, không truy cập được IP LAN cũ
  `192.168.88.192` hoặc tên mDNS trước nạp. Không đo được trạng thái timer
  qua LAN trước reboot. Esptool xác nhận ESP32-D0WD-V3 revision 3.1,
  flash 4 MB, MAC đuôi `94:60`. Ghi riêng ứng dụng tại `0x10000`
  ở 460800 baud, xác minh digest đạt. Giữ LittleFS, NVS và remote token.
- Serial xác nhận khởi động flash bình thường và mở AP `Zah Desk`,
  địa chỉ cài đặt `http://192.168.4.1/`. Không quan sát thấy station
  nhận IP hay sync Production trong cửa sổ đo. Đã đóng serial.
- Cần người dùng kết nối AP bằng mật khẩu đã chọn, mở trang cài đặt
  và chọn Wi-Fi 2,4 GHz khả dụng. Sau đó xác minh phiên bản qua API,
  heartbeat Production và quan sát trực tiếp tiêu đề lịch trên TFT.
  Log `.dev/logs/hardware-calendar-wifi-1.2.2-{identify,flash,boot}.log`.

## Rollout 1.2.3 · hàng sự kiện Đồng hồ + Lịch

- Firmware và LittleFS từ bản trích xuất sạch của commit
  `bfc1a6f4d8e3d11313e3a96aea779a1281a21ccb`. Đối chiếu nguồn firmware/web
  với Git, kiểm SHA-256 và giải nén LittleFS đối chiếu sáu asset.
  Firmware `5f3d3d3e6f119618e18c3fb4289166076b64d6141fa2365800f490dc8966796a`.
  LittleFS `294a264298ac9400b4704cbda53327c83a512367d9c371b2f2620c212a881dad`.
- Trước nạp, xác định IP mới `192.168.34.38` qua MAC đã biết. ESP32 1.2.2
  đã vào Wi-Fi và cả Pomodoro/Countdown đều idle. Esptool nhận đúng MAC
  đuôi `94:60`, ghi app và LittleFS tại `0x10000` và `0x210000` ở
  460800 baud. Hai digest đều đạt. NVS được giữ, serial đã nhả.
- Sau boot, LAN `http://192.168.34.38/` báo firmware 1.2.3, tự kết nối
  lại Wi-Fi, đồng bộ UTC+7 và GitHub ở trạng thái live. Config LAN khớp
  toàn bộ trước/sau, provisioning tắt. Cả sáu asset qua LAN khớp byte với
  nguồn, strict HTTP và kiểm API mode v2 đạt. Calendar live với một sự
  kiện tại thời điểm đo, xác nhận dữ liệu cloud đã về thiết bị.
- Kết quả fixture kiểm tra hàng giờ/tiêu đề trải ngang và bỏ nhãn
  `CALENDAR LIVE`. TFT chưa được quan sát trực tiếp trong lần nạp này.
  Mode đang ở GitHub. Người dùng chọn Đồng hồ + Lịch để đối chiếu.
  Log `.dev/logs/hardware-1.2.3-{flash,lan}.log`.
