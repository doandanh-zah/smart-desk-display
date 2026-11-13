# Handoff firmware Smart Desk Display

## Tích hợp

- `firmware/platformio.ini` chọn DOIT ESP32 DevKit V1, Espressif32 6.12.0, Arduino-ESP32 2.0.17, ArduinoJson 7.4.2 và LittleFS. Phân vùng `no_ota.csv` dành 2 MiB cho ứng dụng, 1.875 MiB cho LittleFS. Nạp bằng USB.
- `firmware/src/main.cpp` nối các module trong `firmware/src/desk/` với `display/DisplayManager.h` và `github/GitHubProvider.h` của hai session tương ứng. Firmware đã dùng renderer và provider thật. API theo [device-api.md](device-api.md), dữ liệu TFT theo [display-contract.md](display-contract.md). Lần khởi động tiếp theo dùng `startupMode`. Chọn mode thủ công cũng lưu làm startup mode và tính lại thời hạn rotation. Rotation tự động chỉ đổi mode hiện tại.
- AP WPA2 `SmartDesk-Setup-XXXXXX` mở khi chưa có Wi-Fi hoặc sau 20 giây thử kết nối mạng đã lưu. Mật khẩu ngẫu nhiên 12 ký tự hiển thị trên TFT. Trang `http://192.168.4.1/` có sẵn trong firmware. Trang và API setup kiểm tra IP đích, Host/Origin và IP do AP cấp cho một client đang kết nối. Credentials lưu vào Preferences sau khi nhận được IP. Nếu thử mạng mới thất bại, giữ mạng cũ; Wi-Fi đã lưu tự thử lại mỗi 60 giây khi offline. Sau khi vào mạng, AP đóng sau khoảng 15 giây. Ở chế độ station, dùng IP trong serial/TFT hoặc `http://esp32-display.local/`. Đổi tên thiết bị sẽ đổi địa chỉ mDNS. Có thể dùng IP để tiếp tục sau khi đổi tên.
- HTTP chạy trong task ESP-IDF riêng, dùng cùng origin cho LittleFS và REST. Loop không đợi HTTP I/O. Poll NTP qua SNTP, múi giờ UTC+7, trạng thái giờ không hợp lệ trước lần sync đầu. Pomodoro dùng hiệu `millis()` không dấu, chạy độc lập với trình duyệt; reset hoặc reboot đưa timer về focus 25 phút. Phase nghỉ 5 phút bắt đầu khi bấm Start sau khi focus hoàn tất.
- Provider lấy URL HTTPS đầy đủ và username qua config, xác thực TLS sau khi NTP hợp lệ. Điền cả hai để nhận dữ liệu thật. Mặc định là Demo có nhãn. Provider refresh mỗi 20 phút, giữ kết quả thành công gần nhất trong RAM cho cùng cấu hình. Xem [GitHub contract](github-contract.md) và [hướng dẫn proxy](../../github-proxy/README.md).

## Build trên SSD

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/firmware-build" pio run -d firmware -j 3
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/littlefs-build" \
  PLATFORMIO_DATA_DIR="$SMART_DESK_ROOT/web/public" pio run -d firmware -t buildfs
```

Ảnh nằm trong hai thư mục build trên SSD ở trên. Dùng cùng `PLATFORMIO_BUILD_DIR` của ảnh LittleFS và `PLATFORMIO_DATA_DIR` cho `uploadfs` để ảnh chứa đúng tài nguyên dashboard. Tài liệu và thao tác cổng USB theo [hardware.md](hardware.md). Session hardware nạp firmware trước rồi LittleFS cùng bảng phân vùng, sau đó mở serial 115200. Khi thiếu ảnh LittleFS, trang setup vẫn chạy và station phục vụ trang hướng dẫn tải dashboard.

## Bằng chứng build demo 1.0.0

Bản bàn giao để nạp tiếp nằm ở mục 1.0.1 bên dưới.

| Ảnh đã kiểm | SHA-256 |
| --- | --- |
| `.dev/firmware-build/esp32doit-devkit-v1/firmware.bin` | `a99bbf5f069abcf699e32ff1a1a3aa319ac80070f5961ed8723946c35961bc37` |
| `.dev/littlefs-build/esp32doit-devkit-v1/littlefs.bin` | `2cb41fe42f4a7339909a5b8d5c89a6b9071fa4dfc31805cfb463d04c249f7595` |

- Build ESP32 tích hợp đạt với 51.972/327.680 byte RAM tĩnh (15,9%) và 1.067.065/2.097.152 byte flash ứng dụng (50,9%). LittleFS đạt, đủ bốn tài nguyên khớp byte với `web/public/`. Xem `.dev/logs/firmware-build.log` và `.dev/logs/firmware-littlefs.log` trên SSD. Kích thước RAM là số tĩnh từ linker. Cần đo heap lúc có Wi-Fi, HTTP và TLS đồng thời.
- Kiểm tra host chạy trực tiếp `Timer.h`, bao gồm start lặp lại, pause/resume với phần giây lẻ, focus → break → focus, reset và tràn `millis()`. Kiểm tra ArduinoJson 7.4.2 cùng bộ đọc body hiện dùng, bao gồm trailing bytes, nesting, NUL và kiểu dữ liệu. Harness cục bộ trong `.dev/firmware-qa/`, log `.dev/logs/firmware-{timer,json}.log`.
- Chưa flash hoặc mở serial trong session firmware. Cần kiểm tra TFT và provisioning trên ESP32 thật, thử sai mật khẩu rồi nhập lại, mở dashboard từ điện thoại/Mac, gọi API đổi cả năm mode, xác nhận NTP UTC+7, Pomodoro khi đóng tab, rotation, mất Wi-Fi rồi tự nối lại và lưu config sau khi ngắt USB. Cần endpoint GitHub đã cấu hình để xác nhận trạng thái live và stale khi ngắt mạng.

## Bàn giao 1.0.1 sau demo

- Trên bản 1.0.0 đang chạy tại `192.168.88.192`, GET `/api/status` trả HTTP 200 nhưng thiếu `wifi.ip`, `wifi.hostname`, `github.lastSync` và `github.error`. Ép địa chỉ bằng `curl --resolve esp32-display.local:80:192.168.88.192` cũng trả status HTTP 200. Tra tên trên Mac không trả kết quả tại thời điểm kiểm tra. HTTP với Host đúng chỉ xác nhận máy chủ chấp nhận tên đó.
- `App.cpp` ghi trực tiếp vào member proxy của `JsonObject`, giúp giữ key ngay cả khi giá trị là `null`. Sửa chung cho `/api/status`, `/api/github` và `/api/provision/status`. Kiểm thử host biên dịch các serializer GET hiện hành cùng ArduinoJson 7.4.2, serialize và đọc lại JSON. Các trường có key và đúng kiểu với IP, hostname, sync và lỗi có hoặc chưa có. Đối chứng dùng helper `JsonVariant` cũ thất bại đúng tại kiểm tra sự tồn tại của key. Chạy lại với `source .dev/env.sh && python "$SMART_DESK_DEV/firmware-qa/status-regression.py"`. Log `.dev/logs/firmware-1.0.1-status-regression.log`.
- `WifiService` đợi AP setup đóng mới đăng ký hostname và dịch vụ `_http._tcp` trên station. Responder khởi động lại khi IP hoặc hostname đổi, dừng khi mất Wi-Fi, thử lại sau 5 giây nếu đăng ký lỗi. Trong thời gian AP còn mở sau provisioning, LAN dùng IP và `wifi.hostname` là `null`. Hành vi multicast của mạng nhà cần xác nhận trên ESP32/Mac thật.

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/firmware-release-1.0.1" pio run -d firmware -j 3
```

Build tích hợp đạt. RAM tĩnh 51.972/327.680 byte (15,9%), flash ứng dụng 1.066.817/2.097.152 byte (50,9%). Log `.dev/logs/firmware-1.0.1-build.log`. Các ảnh dưới đây nằm trong `.dev/firmware-release-1.0.1/esp32doit-devkit-v1/` trên SSD.

| Ảnh | SHA-256 |
| --- | --- |
| `firmware.bin` | `badbbfab2073ca4894efbab9c9a154cbabf461bbccbf4f2572e012612a3395e2` |
| `partitions.bin` | `6a88d59601a83a16a19a08114b59d338324b8dec267d8b43e5d61ad56ec92102` |
| `bootloader.bin` | `3d234a7471f67b013686dabd4dee7c1fa915c9928463616a94bc9297acf1abf8` |

Session phần cứng phụ trách nạp và serial. Cho lần xác nhận bản 1.0.1, giữ cấu hình NVS đã provision và ảnh LittleFS đang dùng. Sau khi boot, đối chiếu IP qua TFT hoặc serial rồi kiểm tra:

```sh
DEVICE_IP=192.168.88.192  # Đổi theo IP quan sát sau khi boot.
curl -fsS "http://$DEVICE_IP/api/status"
curl -fsS "http://$DEVICE_IP/api/github"
python3 verification/check_http.py device "http://$DEVICE_IP"
dscacheutil -q host -a name esp32-display.local
curl --noproxy '*' --max-time 5 -fsS http://esp32-display.local/api/status
```

Kỳ vọng status báo `firmwareVersion: "1.0.1"`, `wifi.ip` là IP hiện tại, hostname có giá trị khi đăng ký mDNS thành công. Ở chế độ demo, cả hai API phải có `lastSync` và `error` cùng giá trị `null`. Hai key nằm dưới `github` trong `/api/status` và ở cấp gốc trong `/api/github`. Kiểm tra .local trực tiếp sau khi khởi động và sau khi Wi-Fi nối lại. Nếu vẫn thiếu DNS, ghi kết quả của lần curl trực tiếp và đối chiếu với lần dùng `--resolve`. Đợt test provisioning mới cần xác nhận hostname từ `null` chuyển sang chuỗi sau khi AP đóng. Phiên firmware chưa nạp bản 1.0.1.

## Bàn giao firmware có bố cục GitHub mới · 13/11/2026

Session 01 có thể dùng ảnh firmware dưới đây. `App::render()` truyền username từ Preferences qua `Frame::configuredGitHubUsername` ở mọi frame. Renderer có thể hiện tên cấu hình trong lúc provider đang tải hoặc báo lỗi. Trạng thái và heatmap tiếp tục lấy từ snapshot của provider. Build tích hợp dùng renderer hiện tại và bundle TLS chứa ISRG Root X1 cùng GTS Root R1. Trường `firmwareVersion` vẫn là `1.0.1`; dùng SHA-256 của ảnh để định danh lần build.

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/firmware-github-reference" pio run -d firmware -j 3
shasum -a 256 "$SMART_DESK_DEV"/firmware-github-reference/esp32doit-devkit-v1/{firmware,bootloader,partitions}.bin
```

| Tệp trong `.dev/firmware-github-reference/esp32doit-devkit-v1/` | SHA-256 |
| --- | --- |
| `firmware.bin` | `419f725010542b32c8879afbaef2011b781250cd1a769f7a20211ab9edeab2bf` |
| `bootloader.bin` | `3d234a7471f67b013686dabd4dee7c1fa915c9928463616a94bc9297acf1abf8` |
| `partitions.bin` | `6a88d59601a83a16a19a08114b59d338324b8dec267d8b43e5d61ad56ec92102` |

- Build qua trên SSD, RAM tĩnh 51.972/327.680 byte (15,9%), flash ứng dụng 1.069.793/2.097.152 byte (51,0%). Log `.dev/logs/firmware-github-reference-build.log`.
- Kiểm thử host chạy thân hàm `App::render()` hiện hành với header `Frame` thật và renderer giả. Đạt với cấu hình rỗng, tên đã cấu hình trong khi provider đang tải, và đổi tên ở frame tiếp theo. Harness trên SSD ở `.dev/firmware-qa/github-reference-frame.cpp`. Kiểm thử renderer hiện tại qua UBSan và kiểm thử hồi quy nullable cũng đạt. Log renderer `.dev/logs/firmware-github-reference-display.log`.
- HTTPS từ Mac dùng TLS 1.2, kiểm tra hostname và chỉ tin hai CA trích trực tiếp từ header firmware. Production trả 200 cho `doandanh-zah`, đủ 364 ô, 1.090 đóng góp và streak 0 tại lúc đo. Log `.dev/logs/firmware-github-reference-proxy.log`. [Endpoint production](https://smart-desk-github-proxy.vercel.app/api/contributions?username=doandanh-zah)
- Session 01 giữ quyền nạp và serial. Dùng ảnh LittleFS đã kiểm của phiên web/tích hợp cho preview tương ứng. Sau khi nạp, xác nhận trên ESP32 rằng `GET /api/github` chuyển `live`, username và lưới khớp proxy, TFT hiện `DOANDANH-ZAH` và bố cục trắng/xanh theo [display.md](display.md). Phiên firmware chưa nạp và chưa kiểm chứng TLS từ ESP32 hay hình ảnh trên TFT.

## Bàn giao remote admin · firmware 1.1.0

Firmware chủ động POST HTTPS đến `https://desk.thezah.space/api/device/sync` theo [remote-admin-contract.md](remote-admin-contract.md). TLS xác thực hostname và CA bundle của ESP-IDF, đã kiểm tra linker kéo bundle vào ảnh. Kết nối yêu cầu Wi-Fi station và giờ NTP hợp lệ. Snapshot dùng schema LAN, bỏ proxy URL và thay IP/hostname bằng null. Wi-Fi, GitHub, NTP, Pomodoro, TFT và HTTP LAN dùng đường cũ. Không cần mở cổng từ Internet.

- Một worker FreeRTOS ưu tiên thấp, stack 10 KiB, request tối đa 6.144 byte, response tối đa 2.048 byte, timeout I/O 5 giây. Poll 20 giây sau kết quả thành công, ACK mới gửi sớm sau 1 giây, lỗi backoff 20–300 giây. Worker đợi GitHub HTTPS hoàn tất trước khi chạy. GitHub được xét trước mỗi lần poll mới. Tạm hoãn poll nếu heap nội bộ còn dưới 80 KiB hoặc khối liên tục lớn nhất dưới 28 KiB. Số liệu heap thật còn cần đo.
- Cho phép `display`, `message`, `pomodoro` và `config` giới hạn theme/giây/rotation. Dùng lại validation và hàm áp dụng của LAN. NVS ghi dấu nhận trước khi thay đổi trạng thái, sau đó ghi ACK. Mất điện giữa hai lần ghi trả `outcome_unknown` và không thực thi lại. Giữ ACK tới khi nhận đúng `ackId` hoặc qua thời gian giữ 24 giờ của backend. Từ chối lệnh hết hạn và lưu các ID còn trong cửa sổ hiệu lực để chống phát lại.
- Kiểm thử host chạy thân hàm nhận lệnh thật với NVS/App giả, qua UBSan. Đạt: thực thi và ACK, mất ACK, redelivery sau reboot, replay ID cũ, hết hạn, payload vượt allowlist, NVS từ chối ghi và mất điện giữa hai lần ghi. Snapshot sinh từ serializer firmware qua validator và gateway backend thật với storage fixture, xác nhận bearer sai trả 401, lệnh/ACK đúng schema và không có IP LAN/hostname/proxy URL. Kiểm thử hồi quy nullable, Pomodoro rollover và fixture renderer đều đạt. Xem `.dev/logs/firmware-remote-admin-{fixture,gateway,build}.log`.

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/firmware-remote-admin" pio run -d firmware -j 3
shasum -a 256 "$SMART_DESK_DEV"/firmware-remote-admin/esp32doit-devkit-v1/{firmware,bootloader,partitions}.bin
```

Build tích hợp đạt. RAM tĩnh 53.164/327.680 byte (16,2%), flash ứng dụng 1.153.445/2.097.152 byte (55,0%).

| Ảnh trong `.dev/firmware-remote-admin/esp32doit-devkit-v1/` | SHA-256 |
| --- | --- |
| `firmware.bin` | `0269fa6ca24e5a4429d3b6f0a05ca7c89ddd6cdb63739a3b4f6e7583990b27a8` |
| `bootloader.bin` | `3d234a7471f67b013686dabd4dee7c1fa915c9928463616a94bc9297acf1abf8` |
| `partitions.bin` | `6a88d59601a83a16a19a08114b59d338324b8dec267d8b43e5d61ad56ec92102` |

### Provision riêng và nghiệm thu trên ESP32 · session 01

1. Sau khi nạp ảnh, đóng mọi serial monitor. Giữ NVS Wi-Fi/GitHub đã cấu hình. Backend dùng SHA-256 của **chuỗi** 64 chữ số hex thường của token thiết bị, sinh ngẫu nhiên từ 32 byte. Chủ token lấy chuỗi gốc từ kho bí mật riêng và nhập trực tiếp trong terminal local qua prompt ẩn. Token độc lập mật khẩu admin. Thiết bị lưu token trong namespace Preferences `deskremote`, nên người có quyền đọc flash vật lý phải được tin cậy. Không có token sẵn trong firmware và không gửi giá trị qua chat, log, lệnh shell hay UI LAN.
2. Từ repo với `.dev/env.sh` đã nạp, chạy `python firmware/tools/provision_remote.py --port /dev/cu.usbserial-0001` với cổng đã được xác minh. Script chỉ in xác nhận chung. Dùng `--clear` để tắt trên thiết bị và thu hồi/đổi hash backend khi cần. Không nạp token bằng terminal có local echo.
3. Dùng `--status` sau khi đồng bộ để xem `http=200`, `transport_ok=1`, `heap_before`, `largest_before`, `heap_with_tls` và `worker_stack_free`. Đây là số đo theo lần kết nối, gồm một mẫu khi TLS còn sống và mức stack thấp nhất của worker. Chạy khi dashboard LAN mở, GitHub refresh và TFT đổi mode. Cần xác nhận cloud heartbeat, lệnh/ACK qua domain thật và LAN/GitHub/Pomodoro tiếp tục khi cloud mất kết nối. Kiểm tra lại sau reboot với một lệnh đã ACK và một lệnh hết hạn.

Phiên firmware không nạp hay mở serial. HTTPS domain đã có phản hồi Vercel 404 trong lần kiểm tra trước khi backend hoàn tất rollout. Chưa có bằng chứng thiết bị 1.1.0 xác thực TLS với backend production, sử dụng token production, hoặc đạt heap thực tế.

## Bàn giao mode v2 · firmware 1.2.0

[Modes contract](modes-contract.md) là contract chung cho TFT, LAN và cloud. Bộ chọn chính có GitHub, Đồng hồ + Lịch, Đếm ngược, Codex và Claude. Firmware vẫn chấp nhận các mode và endpoint cũ. Phần GitHub tiếp tục dùng renderer, CA và provider hiện tại. Clock hiển thị ICT theo đồng hồ ESP32, giữ giờ sau lần NTP thành công khi mất Wi-Fi.

- `SettingsStore` import `smartdesk/config-v1` sang `config-v2`. Startup `stats/message` về GitHub, `pomodoro` về Countdown. Rotation chuyển các mode tương ứng, bỏ Message, khử trùng và tắt nếu còn dưới hai mode. Giữ bản v1, cấu hình Wi-Fi, tên GitHub và proxy, theme, tin nhắn, thiết lập giây và token thiết bị. Các lựa chọn legacy thực hiện qua API sau migration vẫn lưu được.
- Countdown thời lượng dùng `millis()`, tiếp tục khi đóng browser hoặc mất mạng, về idle sau reboot với thời lượng đã lưu. Countdown theo mốc UTC lưu mốc và trạng thái kích hoạt, báo `waiting_for_time` khi chưa có NTP, tiếp tục theo giờ thiết bị sau sync. Reset của mốc hủy kích hoạt. Pause của mốc trả 409. Các thao tác dùng chung logic LAN và cloud. Firmware nhận mốc đến hết 2099, việc chạy qua giới hạn `time_t` của SDK cũ chưa được xác nhận.
- Calendar và quota lấy projection giới hạn từ phiên HTTPS đã có. Firmware gửi `wantIntegrations:true` khoảng một lần/phút và tương thích response cũ. HTTP 400 trong lúc thăm dò schema cũ hoãn gửi flag trong 5 phút. Bộ nhớ cache giữ tối đa 3 sự kiện và 2 cửa sổ cho mỗi provider. Projection tối đa 2 KiB, body response tối đa 4 KiB. Không có worker/TLS thứ hai, không lưu OAuth hoặc token tài khoản. Dữ liệu đi qua kiểm tra schema, tự báo stale và hết hạn khi cloud offline. Khi nguồn chưa kết nối, API dùng `unavailable` và TFT hiện `NOT CONNECTED`. Calendar chỉ tới ESP32 nếu backend bật export.
- Fixture C++ qua UBSan đạt cho rollover, pause/resume, hết hạn, chờ NTP, mốc arm/disarm, lưu thất bại, schema lệnh và giữ dữ liệu qua migration/reload. Fixture projection đạt cho Unicode, phần trăm có số lẻ, thiếu nguồn, unsupported, dữ liệu sai, stale và hết hạn. Backend validator hiện tại chấp nhận mode/status/command mới cùng flag `wantIntegrations`. Log `.dev/logs/firmware-modes-v2-{host,api,backend,build}.log`.

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/firmware-modes-v2" pio run -d firmware -j 3
shasum -a 256 "$SMART_DESK_DEV"/firmware-modes-v2/esp32doit-devkit-v1/{firmware,bootloader,partitions}.bin
```

Build tích hợp đạt với renderer mode v2. RAM tĩnh 54.276/327.680 byte (16,6%), flash ứng dụng 1.170.061/2.097.152 byte (55,8%).

| Ảnh trong `.dev/firmware-modes-v2/esp32doit-devkit-v1/` | SHA-256 |
| --- | --- |
| `firmware.bin` | `17e2688da2e7cab5dd8b429765efad4a27d2869d11abe578bfc1d34ba1de0097` |
| `bootloader.bin` | `3d234a7471f67b013686dabd4dee7c1fa915c9928463616a94bc9297acf1abf8` |
| `partitions.bin` | `6a88d59601a83a16a19a08114b59d338324b8dec267d8b43e5d61ad56ec92102` |

Phiên firmware chưa flash hay mở serial. Khi nghiệm thu bản tích hợp, giữ NVS, nạp LittleFS phù hợp với web v2, kiểm tra migration từ cấu hình thật, GitHub live, clock ICT khi offline, countdown khi đóng browser và sau reboot, cloud ACK, cùng heap/stack qua script USB `--status` với payload Calendar/quota thật. Nguồn thật cần OAuth Calendar và bridge quota theo phiên backend. Fixture không xác nhận các nguồn đó đã được kết nối.
