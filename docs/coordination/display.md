# Handoff hiển thị TFT

## Interface và phần cứng

Core gọi `desk::display::DisplayManager::begin()` một lần rồi truyền `render(const Frame&)` trên cùng luồng Arduino. Header và kiểu dữ liệu trong `firmware/include/display/DisplayManager.h` khớp [display-contract.md](display-contract.md). Renderer đọc các con trỏ trong lần gọi hiện tại và sao chép phần cần giữ. GitHub nhận 364 mức dạng số 0–4 hoặc `nullptr`; core cung cấp thời gian ICT, trạng thái timer, dữ liệu GitHub và thông tin AP. `MessageLayout.h` cung cấp hàm thuần `wrapMessage`.

Driver Adafruit ILI9341 dùng SPI phần cứng 10 MHz, SCK 18, MOSI 23, MISO −1, CS 27, DC 26, RST 25, rotation 1. LED nối cố định 3V3. Driver và font pixel dùng thư viện Adafruit. [ILI9341](https://github.com/adafruit/Adafruit_ILI9341/blob/master/Adafruit_ILI9341.h), [GFX](https://learn.adafruit.com/adafruit-gfx-graphics-library/graphics-primitives).

Splash hiện tên thiết bị và trạng thái khởi động. Setup hiện tên AP, mật khẩu phiên và URL cấu hình. Mật khẩu hiển thị trong màn hình Setup và bộ nhớ đệm của renderer được xóa khi rời màn hình này.

Toàn màn hình được xóa khi render lần đầu hoặc khi đổi view, mode đang hiển thị hoặc theme của mode có hỗ trợ. Các frame tiếp theo chỉ vẽ lại vùng có dữ liệu hiển thị thay đổi. Heatmap giữ 364 mức cũ để vẽ từng ô thay đổi trong một giao dịch SPI. Clock và Pomodoro thay từng ký tự trong dãy số khi chiều dài giữ nguyên, đồng hồ có vùng giây riêng. Thanh timer cập nhật theo số pixel chênh lệch. Renderer không cấp phát framebuffer.

## GitHub · ZAH NFT và heatmap 24 tuần

Ảnh phác chỉ định cấu trúc. GitHub dùng theme thiết bị, thẻ heatmap màu nền phụ và chữ dễ đọc trên canvas 320×240. Các tọa độ là góc trên trái, trừ tâm vòng tròn và mép phải được ghi riêng.

| Token | Dark | Light |
| --- | --- | --- |
| Nền | `#0E1716` | `#F3F7F2` |
| Thẻ heatmap | `#172421` | `#E5EEE4` |
| Đường phân cách | `#354D46` | `#BCCFC2` |
| Chữ chính | `#EFF8F2` | `#142820` |
| Chữ phụ | `#A5BEB4` | `#4B645A` |
| Nhấn, streak và live | `#8DE1B5` | `#216441` |
| Demo/cache | `#EAC47D` | `#784D14` |
| Lỗi | `#FFACA5` | `#A42F2A` |
| Heatmap 0 → 4 | `#161B22` `#16391A` `#346A35` `#529E4E` `#79D071` | `#D4E0D4` `#A2C7AA` `#77AE88` `#427D59` `#205237` |
| Nền avatar (cả hai theme) | `#F8DB6A` | `#F8DB6A` |

| Thành phần | Tọa độ và nội dung |
| --- | --- |
| Mascot | Avatar vàng bo nhẹ tại (14, 14), 64×72 px, bán kính 6 px. Sprite chân dung từ ảnh gốc tại (21, 24), 25×31 pixel nguồn phóng 2×. |
| Tên | x=89, rộng 219 px, giữ kiểu chữ của username cấu hình. Tên trống dùng `GitHub`. Bước font GFX 6×8 px. Tên ≤12 ký tự dùng cỡ 3 tại y=28, ≤18 dùng cỡ 2 tại y=32, ≤36 dùng cỡ 1 tại y=36. Tên 37–39 ký tự chia sau ký tự 36, tại y=30 và y=40, cỡ 1. |
| Dòng phụ | x=89, y=57/69, cỡ 1. `DUT SUPERTEAM UNIVERSITY CLUB` và `SUPERTEAM VIETNAM`. |
| Heatmap | Thẻ bo bán kính 4 tại (12, 92), 296×91 px. Hàng y=100 có tổng `{total} contrib. / 52w` tại x=24 (hoặc `-- contrib. / 52w`) và `24 WEEKS` canh phải tới x=296. Ô đầu (29, 113), ô 9×6 px bo 1 px, bước 11 px ngang và 8 px dọc, 24 cột × 7 hàng. Đọc chỉ số `(28 + cột) * 7 + hàng` trong dữ liệu 364 mức. Cột cuối luôn là tuần mới nhất. Chủ nhật trên cùng. Lưới trống hiện `No contribution data` tại y=139, căn giữa vùng lưới. |
| Legend | `Less` tại (108, 173), 5 ô 8×6 px tại (138 + 10×mức, 174), `More` tại (190, 173). Dùng cùng màu và bo như lưới. |
| Giờ và streak | Nhãn `TIME / ICT` (16, 188) và `STREAK / DAYS` canh phải đến x=304, cỡ 1. HH:MM hoặc `--:--` tại (16, 199), streak hoặc `--` canh phải tại (304, 199), cỡ 2. Đường phân cách (16, 218, 288, 1). |
| Đồng bộ | x=16, y=222 và chi tiết y=232, cỡ 1. Giữ `DEMO  /  Sample data`, `SYNCING  /  Waiting for GitHub`, `SYNCED  /  <ISO UTC>`, `CACHED  /  <ISO UTC>`, `GITHUB ERROR` và dòng chi tiết theo contract hiện có. |

Nguồn preview lấy `config.githubUsername`, `localEpoch` và trạng thái GitHub như trước. TFT nhận username cấu hình qua `Frame::configuredGitHubUsername`. Trình duyệt có thể dùng monospace sao cho bước cỡ 1 xấp xỉ 6 px và các dòng vừa hộp tên.


### Palette từ ảnh legend · thông số cho 04

Ảnh `.dev/references/github-dark-heatmap.png` 1432×292. Lấy màu giữa năm ô tại y=258, x=1170/1198/1226/1254/1282. Vùng 9×9 quanh mỗi tâm có cùng một màu với alpha FF. Dark dùng trực tiếp `#161B22 #16391A #346A35 #529E4E #79D071`, quy đổi RGB565 `10C4 11C3 3346 54E9 7E8E`. Light tiếp tục dùng palette nền sáng ở bảng trên để giữ thang tương phản. Legend và lưới dùng cùng token, bố cục 24 tuần và sprite ZAH NFT giữ theo các hàng trên.

### Sprite cho session 04

Nguồn phiên bản nằm trong `firmware/src/display/GitHubPet.h`, giữ lưới gốc và palette tối ưu. Đọc `Pixels` 31 hàng × 25 ký tự, dùng palette và hàm `pixel` trong header. Timeline lặp 4.800 ms: chớp mắt [1.400, 1.600), cười nhẹ [3.000, 3.460), idle các mốc còn lại. 04 dùng JPG gốc đã tối ưu làm avatar admin và dùng sprite này trong canvas. Giữ reduced motion ở idle.

### Kiểm thử và bàn giao

- Chốt 24 tuần để tăng chiều ngang ô từ 4 lên 9 px, chừa khe 2 px và vẫn có một legend. Mỗi ô bo 1 px bằng ba hình chữ nhật RGB565 trong cùng giao dịch SPI. Tổng vẫn lấy từ dữ liệu 52 tuần và ghi `/ 52w`. Cache giảm từ 364 còn 168 byte.
- Nguồn sprite lấy mẫu tại tâm ô pixel gốc của `.dev/references/zahnft.jpg` rồi giới hạn palette còn 10 màu, gồm nền vàng. Mũ, mặt, áo và khóa áo được giữ. Mảng mẫu là 806 byte hằng, khung chớp/cười là vá theo tọa độ. TFT dùng chung bộ đếm/pose hiện có và không cấp phát framebuffer.
- Fixture C++/UBSan đạt. Kiểm tra 168 ô, tọa độ đầu/cuối, cắt từ chỉ số 196, đổi dữ liệu tuần cũ không phát lệnh vẽ, ô mới nhất đổi chỉ ghi trong một ô, đồng hồ độc lập, và chớp/cười chỉ vẽ trong vùng avatar. Bốn mode khác, Setup và Splash tiếp tục đạt. Log `.dev/logs/display-zah-host.log`.
- Palette đã lấy mẫu cho Dark có L* RGB565 8,0 / 20,3 / 39,6 / 58,7 / 77,2. Light có L* 88,9 / 77,0 / 66,4 / 47,9 / 30,5. Cả hai đơn điệu và các mức kề nhau chênh hơn 10 L*. Log `.dev/logs/display-modes-rgb565.log`.
- Build riêng renderer trên ESP32 qua `source .dev/env.sh && pio run -d .dev/display-check -j 3`, RAM tĩnh 22.624 byte, flash 264.425 byte cho sketch fixture. Log `.dev/logs/display-zah-renderer-build.log`. Build toàn firmware trước lần đổi màu cuối đã qua. Rebuild toàn firmware đồng thời với thay đổi remote đang vướng lỗi `esp_crt_bundle_attach` ở `src/desk/RemoteAdmin.cpp`. Xem `.dev/logs/display-zah-build.log`.
- GIF mô phỏng sinh từ đúng dữ liệu C++ tại `.dev/display-check/zah-simulation/zah-nft.gif`, ảnh idle tại `.dev/display-check/zah-simulation/zah-idle.png`.
- Session 01 giữ quyền serial và nạp bản tích hợp cuối sau khi session thiết bị/remote hoàn tất. Quan sát TFT thật ở cả hai theme, 24 cột × 7 hàng, legend, mũ/áo, chớp và cười trong một chu kỳ khoảng 5 giây. Kiểm tra trạng thái live và xác nhận heatmap/giờ không nháy khi avatar chuyển động.

## Bố cục 320×240 cho các màn mới · phối hợp 02, 04 và 05

Các màu nền, thẻ, chữ chính, chữ phụ, viền theo theme mặc định. Dữ liệu, định danh mode và thời điểm do contract 02/05 quy định. Canvas dùng origin góc trái trên và bước monospace gần 6 px cho nhãn cỡ 1.

| Màn | Bố cục và trạng thái |
| --- | --- |
| Đồng hồ + Lịch | Header `CLOCK + CALENDAR` và tên thiết bị x=16, y=14/34, đường phân cách y=54. HH:MM lớn ở cột trái tại x=16, y=91 (GFX cỡ 4), giây tùy chọn x=16, y=128 (cỡ 2). Thứ/ngày ở y=154/171. Thẻ lịch x=151, y=68, w=153, h=126. Tháng `MON YYYY` tại (161, 78), nhãn thứ tại y=95. Lưới 7×6 nếu có ngày cục bộ, Chủ nhật trước, ô đầu (160, 109), ô 17 px, cột cách 19 px, hàng cách 12 px, ngày hôm nay có nền nhấn. Footer có sự kiện kế tiếp khi nguồn cung cấp, hiện tối đa một sự kiện, với `ALL DAY` hoặc `MM-DD HH:MM` ICT. Dòng footer y=219 và y=230 dành cho NTP và trạng thái nguồn lịch. `--:--` khi chưa có giờ; nguồn lịch chưa kết nối/đã cũ phải ghi rõ khi contract có nguồn ngoài. |
| Đếm ngược | Header x=16, y=14/34. Nhãn `DURATION` hoặc `TARGET DATE` ở y=72. Số ở y=99 dùng `HH:MM:SS` dưới 100 giờ, `Nd HHh` với mốc xa hơn và `--:--:--` khi chưa có số. Mục tiêu ICT hoặc thời lượng ở y=168. Trạng thái ở y=219. Có nhãn rõ khi chưa đặt mốc, chờ NTP hoặc hoàn tất. Đổi giây chỉ vẽ vùng số. |
| Codex quota | Header nhận diện x=85, y=19/46. Mascot robot tím với visor cyan ở x=16, y=16. Hai hàng số liệu x=16, y=77 và y=137, mỗi hàng w=288. Nhãn cửa sổ, số phần trăm và thanh mức tách vùng. Thanh mức ở y+20 (cao 6 px), reset ở y+34. Footer y=213/226 cho trạng thái và thời điểm cập nhật ICT. |
| Claude quota | Cùng khung thông tin quota, mascot khác hình với màu cam ấm, thân tròn và tia quanh đầu. Trạng thái `NOT CONNECTED`, `STALE` hoặc lỗi có chữ. Số liệu cache chỉ hiện khi contract cung cấp giá trị, thiếu dùng `--`. |

Mascot mỗi dịch vụ có vùng (16, 16, 48, 48) từ lưới 16×16 phóng 3×. 04 dùng trực tiếp hàng, bảng màu và quy tắc pose trong `firmware/src/display/QuotaPets.h`. Dấu `.` dùng nền theme. Timeline 3.600 ms, pose chuyển động tại [1.600, 1.900). Codex chớp visor và nháy anten. Claude chớp mắt và lóe tia. Dùng idle khi giảm chuyển động. Accent Codex dark/light `#B6A7FF/#5940A2`, Claude `#F9A977/#9C411D`.

Renderer dùng interface C++ trong [modes-contract.md](modes-contract.md). Pointer null hiện `NOT CONNECTED`. Cache nguồn stale hiện dữ liệu còn dùng được với nhãn `STALE`. Unsupported hiện riêng. Trường phần trăm thiếu dùng `--`. Lịch tháng dùng ngày ICT của thiết bị và vẫn hiện khi nguồn sự kiện chưa kết nối. Các mode cũ `stats/pomodoro/message` vẫn render theo giao diện cũ cho caller tương thích.

### Xác minh renderer mới

- Fixture host C++ với UBSan đạt. Kiểm tra ngày 29/02, chuyển giây không vẽ lại lịch, sự kiện all-day stale, đếm ngược duration/target chờ NTP, định dạng ICT của mốc sau 2038, quota chưa kết nối/stale/unsupported, mascot riêng và mọi lệnh chuyển dáng nằm trong 48×48 px. Giữ các phép thử GitHub 24 tuần và mode cũ. Log `.dev/logs/display-modes-host.log`.
- Lệnh build từ repo là `source .dev/env.sh` rồi `PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/display-modes-build" PLATFORMIO_LIBDEPS_DIR="$SMART_DESK_DEV/display-check/.pio/libdeps" pio run -d firmware -j 3`. Build tích hợp thành công với 54.276 byte RAM tĩnh và 1.170.061 byte flash. Log `.dev/logs/display-modes-build.log`.
- Bàn giao session 01 sau khi integration chốt ảnh firmware/LittleFS. Kiểm tra hai mascot thật qua một vòng ≥4 giây, giờ/lịch và đếm ngược độc lập, cùng palette GitHub với legend. Thiết bị cần dữ liệu nguồn do 05 cấp để kiểm tra trạng thái live thực tế. Session renderer không mở serial.

## Bố cục cũ và các mode tương thích

Các tọa độ tính từ góc trên trái. Font mặc định của Adafruit GFX có bước 6×8 px nhân với hệ số cỡ chữ. Chữ vẽ theo tọa độ góc trên trái của ô ký tự.

| Thành phần | Tọa độ và nội dung |
| --- | --- |
| Header chung | Tiêu đề (16, 14) cỡ 2, tên thiết bị hoặc `@username` tại (16, 34) cỡ 1. Đường phân cách từ (16, 54), rộng 288 px. |
| Footer chung | Đường phân cách y=206, nội dung tại (16, 219) và dòng phụ nếu có tại (16, 230), cỡ 1. |
| Clock trước v2 | HH:MM giữa tại y=98 cỡ 7, giây tùy chọn tại (272, 126) cỡ 2. Ngày và thứ ở giữa y=164 cỡ 2, dạng `FRI  /  2026-11-13`. Footer có ICT / UTC+7 và trạng thái NTP. Chưa đồng bộ hiện `--:--` và `Waiting for NTP`. |
| Developer Stats | Hai thẻ 140×62 px tại (16, 66) và (164, 66) cho contributions và streak. Thẻ 288×62 px tại (16, 136) cho public repositories. Giá trị tối đa cỡ 3, tự giảm cỡ theo chiều rộng thẻ. Thiếu dữ liệu hiện `--`. |
| Pomodoro | Tên pha ở giữa y=72, MM:SS ở giữa y=98 (cỡ 7 với chuỗi 5 ký tự), thanh đã trôi qua 288×6 px tại (16, 172). READY / RUNNING / PAUSED / COMPLETE ở giữa y=188. Footer có trạng thái Wi-Fi và IP khi đã kết nối. |
| Message | Vùng (16, 64), rộng 288 px, cao 134 px. Font cỡ 1–4, 48/24/16/12 ký tự trên dòng và 16/8/5/4 dòng. Ưu tiên ngắt ở khoảng trắng, tách từ dài, giữ các dòng trống do LF, bỏ khoảng trắng ở đầu/cuối dòng. Căn ngang từng dòng, căn dọc theo khối chữ. Khi vượt vùng, chừa chỗ cho `...` ở dòng cuối. Tin nhắn rỗng hiện `Set a message in the dashboard`. |

GitHub và Developer Stats cùng hiển thị các nhãn `DEMO`, `SYNCING`, `SYNCED`, `CACHED`, `GITHUB ERROR` trong footer. Live và stale hiển thị thời điểm đồng bộ thành công theo ISO 8601 UTC. Demo nhắc nhập username và proxy trong dashboard. Stale hiển thị số liệu cache cùng lỗi refresh, còn error dùng thông báo lỗi thay thế khi core không cung cấp nội dung.

| Token | Dark | Light |
| --- | --- | --- |
| Nền | `#0D1117` | `#FFFFFF` |
| Thẻ | `#161B22` | `#F6F8FA` |
| Viền | `#30363D` | `#D0D7DE` |
| Chữ | `#F0F6FC` | `#1F2328` |
| Chữ phụ | `#9DA7B3` | `#57606A` |
| Nhấn | `#39D353` | `#116329` |
| Cảnh báo | `#E3B341` | `#764500` |
| Lỗi | `#FF7B72` | `#A40E26` |
| Heatmap 0 → 4 | `#21262D` `#0E4429` `#006D32` `#26A641` `#39D353` | `#EBEDF0` `#9BE9A8` `#40C463` `#30A14E` `#216E39` |

Màu thực tế trên TFT được lượng tử hóa RGB565. Message dùng màu RGB do người dùng cấu hình và lượng tử hóa theo cùng quy tắc.

## Lệnh kiểm thử và kết quả trước đợt đổi layout GitHub

Từ thư mục repo trên SSD, dùng:

```sh
source .dev/env.sh
pio run -d .dev/display-check -j 3
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined \
  -I.dev/display-check/host -Ifirmware/include \
  .dev/display-check/host/check.cpp firmware/src/display/*.cpp \
  -o .dev/display-check/host/check
.dev/display-check/host/check
```

- Project build riêng trong `.dev/display-check/` liên kết cả hai file .cpp của renderer với Arduino-ESP32 2.0.17, Adafruit ILI9341 1.6.2 và GFX 1.12.4 trên board `esp32doit-devkit-v1`. Build qua, dùng 22.800 byte RAM tĩnh và 261.641 byte flash cho cả sketch kiểm thử. Ký hiệu `renderer` trong ELF chiếm 1.084 byte, gồm đối tượng driver và cache. Log `.dev/logs/display-build.log`.
- Fixture host qua với UndefinedBehaviorSanitizer. Kiểm tra chân và rotation truyền vào driver giả, vùng vẽ trong 320×240, splash và Setup (SSID 32 byte, mật khẩu 63 byte), dữ liệu GitHub trống/demo/cache/lỗi, 364 ô khi có dữ liệu và đúng một ô khi đổi một mức, stats thiếu/có dữ liệu, Clock đổi giây và phút độc lập, Pomodoro thay số và thanh tiến độ, và Message xuống dòng/cắt 160 ký tự theo vùng. Frame giống hệt gửi 0 lệnh vẽ. Log `.dev/logs/display-host.log`. AddressSanitizer trên host không khởi tạo được. Fixture đã chạy với UBSan.
- Log `.dev/logs/firmware-build.log` của session thiết bị xác nhận cả hai file .cpp của renderer đã được compile và firmware tích hợp đã link thành công. Build ghi nhận 52.332 byte RAM tĩnh và 1.066.241 byte flash cho toàn bộ firmware.
## Nghiệm thu TFT thật trước đợt đổi layout GitHub · 13/11/2026

- **Quan sát của người dùng.** Smoke test đạt với nền đen, viền trắng, chữ `SMART DESK` nằm ngang và bốn ô đỏ, lục, lam, trắng đúng thứ tự. Khi provision firmware chính, người dùng dùng mật khẩu trên TFT để vào AP và thấy trang setup báo connected. Còn chờ người dùng đối chiếu trực tiếp nội dung của năm chế độ trên TFT. [Handoff phần cứng](hardware.md).
- **Qua LAN, chỉ đọc.** `GET /api/status` và `GET /api/github` trả HTTP 200. Tại thời điểm kiểm tra, ESP32 báo đang ở GitHub Demo với 364 mức, Wi-Fi đã kết nối và NTP đã đồng bộ UTC+7. `GET /preview.js` trả nội dung trùng byte với `web/public/preview.js`. Bản đang nạp thiếu các khóa `wifi.ip`, `wifi.hostname`, `github.error` và `github.lastSync` trong các phản hồi kiểm tra tương ứng. Thiếu `wifi.ip` có thể làm dòng IP trên preview trống dù TFT nhận địa chỉ trực tiếp từ firmware. Các trường REST thuộc session thiết bị. [Handoff phần cứng](hardware.md).
- **Trên máy.** Đã chạy lại fixture TFT với UBSan và đạt. Chromium đã kiểm tra preview cả năm chế độ trên fixture ở 390 và 1.280 px. Hai kết quả xác nhận luồng phần mềm và bố cục theo fixture. Hướng, màu, độ rõ chữ và nháy khi cập nhật trên firmware chính cần quan sát trực tiếp.

### Đối chiếu preview với renderer

- **GitHub.** Mục nghiệm thu này ghi nhận phiên bản cũ. Bố cục và trạng thái phiên bản có mascot nằm ở phần GitHub đầu tài liệu.
- **Clock.** Mục nghiệm thu này ghi nhận phiên bản trước Clock + Calendar.
- **Developer Stats.** Cùng ba thẻ tại cùng tọa độ và ký hiệu `--` cho giá trị thiếu. Preview thêm dấu phân cách hàng nghìn. TFT giảm cỡ số khi cần để vừa thẻ.
- **Pomodoro.** Cùng pha, trạng thái, thời gian còn lại và thanh đã trôi qua ở (16, 172). Font và vị trí số khác nhẹ như Clock. So trạng thái và thời gian với độ trễ poll của dashboard.
- **Message.** Cùng vùng nội dung, cỡ 1–4, căn từng dòng, ngắt ASCII/LF và dấu `...` khi tràn. Preview dùng font monospace trình duyệt, còn TFT dùng ô ký tự 6×8 px nhân với cỡ chữ. Màu Canvas là RGB, TFT là RGB565.

### Checklist cho người đang ở cạnh TFT

Mở dashboard tại [192.168.88.192](http://192.168.88.192/) trên cùng Wi-Fi. Trong lúc session tích hợp đang chạy các thao tác đổi mode, chỉ quan sát các màn hình họ chọn. Sau khi session tích hợp bàn giao, có thể chọn lần lượt từ dashboard và đánh dấu từng hàng đã quan sát:

| Mode | Quan sát trực tiếp |
| --- | --- |
| ☐ GitHub | Tên tài khoản hoặc demo, tổng và streak, lưới đủ 7 hàng từ trái qua phải. Với dữ liệu mẫu, footer hiện `DEMO`. Với GitHub thật, ghi nhãn và giờ đồng bộ đang thấy. |
| ☐ Clock | So HH:MM, ngày/thứ với điện thoại ở UTC+7. Nếu bật giây, giây chạy đều và phần còn lại giữ ổn định qua vài nhịp. |
| ☐ Developer Stats | Thấy ba thẻ contributions, streak và public repositories. Giá trị thiếu hiện `--`, nhãn và số nằm trong thẻ. |
| ☐ Pomodoro | Quan sát Start, Pause, Resume và Reset. Số đếm giảm khi chạy, dừng khi tạm dừng, về 25:00 khi reset. Nếu kiểm tra đóng tab, nhìn TFT tiếp tục đếm trong khoảng 10 giây. |
| ☐ Message | Gửi hai dòng ASCII `Desk ready` và `Line two`. Thử căn phải hoặc đổi cỡ/màu. Với chuỗi ASCII dài ở cỡ 4, xem dòng cuối có `...` và chữ nằm trong vùng hiển thị. |

Khi có hiện tượng lệch, ghi mode, thao tác ngay trước đó, phần preview đang hiện và chữ/màu hoặc vùng bị nháy trên TFT. Ảnh hoặc video ngắn giúp phân biệt tràn chữ, lỗi màu và nháy do cập nhật. Phiên hiển thị giữ nguyên renderer trong đợt đối chiếu này. Các thao tác đổi mode do session tích hợp điều phối và serial do session phần cứng quản lý.
