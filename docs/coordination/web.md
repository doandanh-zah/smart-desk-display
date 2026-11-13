# Handoff dashboard web

Dashboard HTML/CSS/JS tĩnh nằm trong `web/public/`. Giao diện web dùng tiếng Việt theo lựa chọn đã xác nhận của người dùng. Dùng bảng màu GitHub Dark và font hệ thống. Preview 320×240 dùng bố cục từ [display.md](display.md) và dữ liệu theo [display-contract.md](display-contract.md). Canvas dùng font monospace trình duyệt nên hình dạng glyph khác font pixel trên TFT. Chuyển chế độ đã xác nhận làm preview chuyển nhẹ trong 210 ms, có thể ngắt và tắt theo `prefers-reduced-motion`. Bốn asset tĩnh chạy cùng origin, không cần CDN hoặc bundler.

## Interface

- Dashboard đọc `GET /api/status` và `GET /api/config`. Dữ liệu GitHub tải riêng qua `GET /api/github`, làm mới khi trạng thái, lần đồng bộ hoặc cấu hình GitHub thay đổi. Preview phân biệt dữ liệu mẫu, dữ liệu đã lưu, đang đồng bộ và lỗi. Dashboard không gọi proxy trực tiếp.
- Năm mode gửi `POST /api/display` với `{mode}`. Firmware quyết định chế độ đang chiếu, lưu mode khởi động khi chọn tay và tính lại thời gian chờ nếu đang luân phiên. Cài đặt gửi `POST /api/config` với cấu hình TFT, đồng hồ, GitHub, mode khởi động và rotation theo [Device REST API v1](device-api.md).
- Tin nhắn gửi `POST /api/message` với nội dung ASCII/LF tối đa 160 ký tự, căn lề, RGB hex và cỡ 1–4. Có thể lưu trước rồi chọn mode Tin nhắn. Preview dùng nội dung thiết bị xác nhận lưu.
- Pomodoro gửi `POST /api/pomodoro` với `{action: "start"|"pause"|"reset"}`. Web nội suy từ mẫu thời gian thiết bị giữa hai lần đọc. Firmware sở hữu trạng thái timer. Đồng bộ giờ và khởi động lại dùng `POST /api/time/sync` và `POST /api/restart`; xác nhận trước khi gửi restart.
- Trang provisioning do firmware phục vụ ở setup AP. Fixture cục bộ dùng cùng schema nhưng lưu trong RAM của tiến trình Node, không gọi proxy hoặc thiết bị, và có nhãn ngay cả khi status lỗi.

## Chạy và kiểm tra

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
node web/fixture.mjs
```

Mở `http://127.0.0.1:4173/`. Dùng `FIXTURE_SCENARIO=live`, `stale`, `error`, `loading`, `unsynced`, `reject` hoặc `offline` khi khởi chạy để kiểm tra trạng thái tương ứng. Biến `PORT` cho phép chạy nhiều fixture độc lập.

```sh
source .dev/env.sh
npm install --prefix "$SMART_DESK_DEV/web-qa" playwright@1.58.2
"$SMART_DESK_DEV/web-qa/node_modules/.bin/playwright" install chromium --only-shell
SMART_DESK_PLAYWRIGHT="$SMART_DESK_DEV/web-qa/node_modules/playwright" node web/verify.mjs
```

- Chromium đạt 7/7 kịch bản fixture. Kiểm tra không tràn ngang ở 320, 375, 768, 1024 và 1440 px; nút mode cao từ 44 px; Tab/Enter, Escape và khôi phục focus sau dialog; hiệu ứng 210 ms và chế độ giảm chuyển động; cả năm mode, NTP, luân phiên 30 giây, khởi động lại, cài đặt, validation, giữ bản nháp khi API từ chối, và timer tiếp tục qua tải lại trang. Log tại `.dev/web-qa/verify.log`.
- Đã đọc ảnh Chromium ở 375 px và 1440 px. Kiểm tra HTTP trên fixture qua `python3 verification/check_http.py device http://127.0.0.1:4173` đạt ba GET JSON, HTML và ba asset cùng origin.
- Build và đối chiếu LittleFS từ `web/public/` theo lệnh dưới. Xem SHA-256 của bản mới nhất ở phần rà soát ESP32.

```sh
source .dev/env.sh
export PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/web-qa/build"
export PLATFORMIO_LIBDEPS_DIR="$SMART_DESK_DEV/web-qa/libdeps"
export PLATFORMIO_DATA_DIR="$SMART_DESK_ROOT/web/public"
pio run -d firmware -t buildfs
bash verification/check_littlefs.sh "$PLATFORMIO_BUILD_DIR/esp32doit-devkit-v1/littlefs.bin"
```

## Rà soát bản ESP32 trước khi đổi bố cục GitHub

- Mở `http://192.168.88.192/` bằng Chromium ở 1440 px desktop và 390 px với mô phỏng iPhone 13. HTML, ba asset và `GET /api/status`, `/api/config`, `/api/github` đều HTTP 200. Không lỗi JavaScript hoặc tràn ngang. Canvas 320×240 hiển thị dữ liệu mẫu `@demo`, 537 đóng góp, streak 0. NTP đã đồng bộ và Pomodoro đang tạm dừng ở 24:48 theo API. Chỉ dùng GET/HEAD, có chặn các method khác trong browser QA. Ảnh kiểm tra ở `.dev/web-qa/board/`.
- Bản đang chạy trả `wifi.connected=true` nhưng thiếu `wifi.ip` và `wifi.hostname`; bản web đang chạy hiện dấu gạch ở ô IP. Truy cập trực tiếp `esp32-display.local` hết thời gian phân giải trên máy kiểm thử. Ép hostname đó tới IP LAN trả 200, xác nhận HTTP chấp nhận Host header. Cần kiểm tra lại cả JSON lẫn phân giải mDNS sau khi phần cứng nạp bản firmware sửa.
- Nguồn web mới hiển thị IP và hostname theo API trong ô Địa chỉ thiết bị, hiện trường có dữ liệu hoặc dấu gạch khi cả hai vắng. Dịch các mã lỗi GitHub đã xác nhận trong contract, gồm lỗi chứng chỉ HTTPS. Tất cả kiểm thử có ghi trạng thái đều chạy trên fixture.
- Chromium đạt 9/9 lượt chạy fixture, gồm demo, loading, error, stale/cache và live giả lập, kèm kiểm tra IP/hostname vắng, null, chỉ có một trường và có đủ hai trường. Log tại `.dev/web-qa/verify-board-followup.log`.
- Tại thời điểm rà soát, `index.html` và `app.js` trên board khác nguồn có sửa hiển thị IP và hostname. Bản LittleFS ở phần bên dưới đã gồm thay đổi này. Việc kiểm thử mobile trên iPhone vật lý và GitHub thật qua proxy vẫn còn.

## Preview GitHub và pet động · mốc trước ZAH NFT

- Bản thiết kế hiện tại dùng layout 320×240, hai bảng màu theo theme TFT và thẻ heatmap xanh lục với đúng 364 ô. Đĩa pet nằm bên trái phần nhận diện, username giữ nguyên kiểu chữ và mặc định là `GitHub` khi chưa cấu hình. TIME/ICT lấy mẫu NTP thiết bị, STREAK/DAYS lấy dữ liệu GitHub. Các nhãn demo, loading, live, cache và lỗi ở chân màn hình. Tọa độ và bảng màu theo [handoff TFT](display.md). Canvas dùng font monospace trình duyệt, TFT dùng Adafruit GFX. Các mode còn lại tiếp tục dùng palette và bố cục hiện có.
- Sprite 20×16 phóng 2×, màu và nhịp từ `firmware/src/display/GitHubPet.h`. Một vòng 4.800 ms, chớp mắt ở 1.400–1.560 ms, vẫy đuôi ở 2.600–2.820 và 3.040–3.260 ms. Browser cập nhật các pixel đổi trong vùng pet. Nút tạm dừng/phát chỉ điều khiển preview. Browser giữ pose khi cuộn ngoài vùng nhìn hoặc tab ẩn, đưa về pose nghỉ khi bật giảm chuyển động. Nhịp web và TFT cùng mốc tương đối, mỗi bên bắt đầu chu kỳ theo phiên hiển thị của mình.
- Chromium kiểm tra ảnh ở 1.440 và 390 px (mô phỏng iPhone 13), theme sáng/tối, tỉ lệ 4:3 và không tràn ngang. Hình ở `.dev/web-qa/github-pet/{desktop,mobile}-{dark,light}.png`. Clip 4,8 giây từ Canvas fixture ở `.dev/web-qa/github-pet/pet-preview.mp4`. Chromium đạt 10/10 lượt fixture, gồm chớp mắt, vẫy đuôi, dừng bằng nút, giảm chuyển động và kiểm tra ô heatmap giữ nguyên khi pet đổi khung. Log `.dev/web-qa/verify-github-pet.log`. Lấy mẫu Canvas trong một chu kỳ xác nhận một khung duy nhất khi giảm chuyển động và nhiều khung khi chạy animation.
- **Session 01 cần build/nạp LittleFS mới cùng firmware renderer pet.** Ảnh kiểm tra 1.966.080 byte đã giải nén và đối chiếu đủ bốn tài nguyên. Nguồn `web/public/`, ảnh `.dev/web-qa/build/esp32doit-devkit-v1/littlefs.bin`, SHA-256 `b05337bbf6c167adab0becbaa60e25f2fedf2b4259662976f98f0af70978433b`. Sau nạp, kiểm tra trực quan hai theme và pose chớp/vẫy trên TFT thật.

## Bàn giao admin LAN và cloud · ZAH NFT

Session 05 có thể phục vụ trực tiếp nội dung `web/public/` tại gốc canonical `https://desk.thezah.space/`, với `index.html` tại `/` và tài nguyên cạnh HTML. Web nhận diện cloud theo origin canonical. Để preview/test cùng bộ asset trên origin khác, server được phép đặt `data-transport="remote"` trên thẻ `<html>`. Các route `/api/*` do session 05 phục vụ trước static fallback. LAN và cloud dùng chung asset, transport phân nhánh trong `transport.js`.

- **Session 05:** `remote-admin/scripts/build.mjs` đã lấy đúng sáu file `index.html`, `styles.css`, `app.js`, `preview.js`, `transport.js` và `zah-avatar.webp` từ `web/public/`. Gateway có trang login riêng, dùng chung style và avatar, và chọn dashboard sau khi xác thực cookie. Dashboard canonical kiểm tra phiên, giữ CSRF token trong bộ nhớ và gọi API theo [remote-admin-contract.md](remote-admin-contract.md). Lệnh chạy theo queued → applied/rejected/expired. Cập nhật mode dựa trên snapshot sau ACK. Các cài đặt mạng, GitHub, startup mode, NTP và restart tiếp tục trên LAN. Bản LAN gọi API thiết bị cùng origin và hoạt động độc lập với cloud.
- Avatar gốc tối ưu thành WebP 144×144, 2.902 byte. `webpinfo` xác nhận container chỉ có chunk ảnh VP8, không EXIF/XMP/ICC. Mascot canvas dùng đúng sprite ZAH NFT 25×31, phóng 2×, chu kỳ 4,8 giây gồm chớp mắt và cười, theo `firmware/src/display/GitHubPet.h`. Canvas vẽ 24 tuần gần nhất, lịch HTML vẽ đủ 52 tuần với 364 ô, có cuộn ngang riêng cho mobile và bàn phím. Nhãn tổng contributions vẫn dùng phạm vi 52 tuần.
- **Kiểm thử web:** Chromium đạt 12/12 lượt fixture, gồm toàn bộ LAN, pixel của 168 ô TFT và 364 ô lịch web, reduced motion, avatar, và fixture remote đăng nhập sai/đúng, offline, stale, pending, applied, rejected, logout, hết phiên, setup_required. Các thao tác mutation chạy trên fixture, không ghi settings trên ESP32. Ảnh desktop 1.440 px và mobile mô phỏng iPhone 13 390 px, gồm admin, preview TFT và form login của gateway, ở `.dev/web-qa/remote-admin/`. Log `.dev/web-qa/verify-remote-admin.log`.
- **Session 01:** Build/nạp LittleFS từ `web/public/` cùng firmware mascot và remote sync mới. Đã build riêng và giải nén, khớp byte cả sáu file (79.845 byte tài nguyên). Ảnh 1.966.080 byte tại `.dev/web-qa/build/esp32doit-devkit-v1/littlefs.bin`. SHA-256 `105bed0d288785329784f9efceceaebde62e643f848241e09953a4160004bbc9`.
- **Production:** Đã kiểm tra HTTPS canonical bằng GET tại thời điểm bàn giao. `/` trả 404, `/api/auth/session` và `/api/admin/state` trả 503, mã `setup_required` trên auth. Cần session 05 hoàn tất gateway, Redis và thiết lập xác thực server-side, session firmware/hardware nối ESP32, sau đó xác nhận login và lệnh có ACK qua domain thật. Web không cần mật khẩu/credential trong bundle.

## Bàn giao redesign admin LAN và cloud

- Đọc bản LAN thật qua Chromium, chặn các method ghi. Ở 390 px, mode và preview bắt đầu tại y=658 và y=1.130. Ở 1.440 px, mode và preview bắt đầu tại y=484 và y=499. Bản mới trên fixture lần lượt là y=328/y=501 và y=272/y=282. So sánh hai nguồn có nhãn giả lập và chế độ đang chiếu khác nhau. Trên canonical, GET theo redirect trả 503 lúc rà soát.
- Hệ phân cấp mới: tên/ảnh thiết bị và kết nối, một vùng điều khiển gồm bộ chọn mode và preview, công cụ Pomodoro/Tin nhắn, lịch 52 tuần, cài đặt và chẩn đoán. Bộ chọn xếp ba cột trên mobile, một danh sách bên trái trên desktop. Pomodoro/Tin nhắn mở khi mode tương ứng thực sự đang chiếu và vẫn mở bằng tay khi dùng mode khác. Chuyển mode không đóng công cụ đang mở hoặc xóa bản nháp. Cài đặt mở qua điều hướng hoặc trực tiếp từ `#settings`. Giao diện dùng nền than ánh lục, accent xanh bạc hà, bo nhỏ và font hệ thống. Preview TFT 24 tuần, mascot và transport dùng bản hiện có.
- Chromium đạt 12/12 lượt fixture sau redesign, gồm điều hướng và vùng chạm, Tab/Enter, đóng/mở chẩn đoán, mở đúng công cụ theo mode, giữ bản nháp, giảm chuyển động, 24/52 tuần, và trạng thái cloud login/logout/expiry, offline/stale, pending/applied/rejected. Ảnh trước/sau desktop và mobile, ảnh login, log đo bố cục và test ở `.dev/web-qa/redesign/`. Ảnh `before-*.png` lấy từ ESP32, `after-*.png` và `after-*-full.png` lấy từ fixture. `after-*-login.png` dùng HTML/JS login hiện có của gateway và CSS mới.
- **Session 05:** Stage sáu file `web/public/` vào `dashboard/` trong thư mục deploy của remote admin. `remote-admin/scripts/build.mjs` sẽ chép sang `assets/` và ghép trang đăng nhập của gateway. Bundle chỉ chứa sáu file tĩnh (80.406 byte trước nén), ở `.dev/web-qa/redesign/cloud/dashboard.tar.gz`, SHA-256 `767967a0435acdbf3b246e18eea3e6855356a760199e3ad0b26288839d5f6027`. Hash từng file ở `.dev/web-qa/redesign/assets.sha256`. Chạy build trong staging, đối chiếu hash rồi deploy theo [handoff 05](remote-admin.md). Xác nhận GET login/session và route admin theo hợp đồng.
- **Session 01:** Dùng `PLATFORMIO_DATA_DIR="$SMART_DESK_ROOT/web/public"` cùng workflow của phần cứng để buildfs/uploadfs. Ảnh kiểm tra đã giải nén khớp byte đủ sáu file, kích thước 1.966.080 byte, tại `.dev/web-qa/redesign/build/esp32doit-devkit-v1/littlefs.bin`. SHA-256 `9563cc37eb87aa0d0a08e6161d0121d49b3cb10340d319cb07ac6d4ec8957a68`. Web không đổi firmware. Session web không deploy và không ghi thiết bị.

## Bàn giao web · bộ mode v2

- Bộ chọn chính gồm GitHub, Đồng hồ + Lịch, Đếm ngược và Quota. Quota là màn riêng qua `#quota`, dùng chung bundle LAN/LittleFS và gateway. Hai nút tại đây chọn mode TFT `codex` hoặc `claude`, với sprite riêng lấy theo `QuotaPets.h`, nhịp 3.600 ms và pose tĩnh khi bật giảm chuyển động. Trang quota đọc dữ liệu qua `GET /api/integrations` trên LAN hoặc `GET /api/admin/integrations` qua cloud. Chỉ hiện phần trăm hợp lệ từ snapshot live/cache, giữ nhãn đã cũ và không điền 0 cho giá trị null. Đã xử lý tình huống nguồn chưa kết nối, không hỗ trợ và lỗi.
- Đồng hồ + Lịch dùng ngày ICT của ESP32, điều hướng tháng và hiển thị tối đa ba sự kiện nguồn đã lọc. Đếm ngược dùng `status.countdown`, `POST /api/countdown` trên LAN và command type `countdown` chờ ACK trên cloud. Lưu thời lượng và bắt đầu là hai thao tác; lưu mốc giờ ICT sẽ kích hoạt mốc trên thiết bị. Lịch, countdown và quota bám tọa độ của [renderer 03](display.md) và [contract 02](modes-contract.md), [contract 05](remote-admin-contract.md).
- Cài đặt mới ưu tiên năm ID v2. Trình duyệt nhận diện khả năng v2 từ `status.countdown`; firmware cũ vẫn mở GitHub và Đồng hồ, các công cụ cũ nằm trong mục riêng. Startup/rotation cũ đã lưu còn hiển thị khi thiết bị báo đang dùng. GitHub giữ bố cục hiện hành, 24 tuần TFT và đủ 52 tuần ở lịch web. Dark dùng bảng màu 03 lấy từ ảnh: `#161B22 #16391A #346A35 #529E4E #79D071`. Preview Light theo bảng 03 riêng cho màn TFT sáng.
- Chromium đạt 13/13 lượt fixture. Bao gồm lưới tháng và nguồn sự kiện, thời lượng/mốc ICT, ACK countdown cloud, quota thiếu nguồn/unsupported/stale, không gán số khi null, hai sprite khác nhau và chế độ giảm chuyển động. Log `.dev/web-qa/verify-modes-v2.log`. Ảnh fixture desktop 1.440 px và mobile 390 px cho GitHub, Lịch, Đếm ngược và Quota ở `.dev/web-qa/modes-v2/{desktop,mobile}-{github,calendar,countdown,quota}.png`. Chạy `FIXTURE_SCENARIO=modes-v2 node web/fixture.mjs` sau khi nạp env để xem bằng trình duyệt. Các ảnh và số kiểm thử chỉ là fixture có nhãn, không phải dữ liệu quota tài khoản.
- **05** dùng sáu tài nguyên từ `web/public/` hoặc `.dev/web-qa/modes-v2/dashboard.tar.gz` (SHA-256 `6184196b94a169938c567c11d5a95484d25b00b09f842dc9c5ef1e52703947cc`) theo workflow staging hiện có. **01** build/nạp LittleFS từ cùng thư mục cùng firmware mode v2. Ảnh đã giải nén và đối chiếu đủ sáu file tại `.dev/web-qa/modes-v2/build/esp32doit-devkit-v1/littlefs.bin` (1.966.080 byte, SHA-256 `1559d019b1cfe6648b7d0901dcb7f7832f29f60001ce9d0d2103f42436b5cd8f`). Web không deploy và không ghi thiết bị.

## Đăng nhập bằng PIN sáu chữ số

- Cả trang login của gateway (`remote-admin/lib/login.html`) và form đăng nhập lại trong dashboard (`web/public/index.html`) ghi rõ nhận PIN 6 chữ số hoặc mật khẩu quản trị. Ô nhập giữ `type=password`, `autocomplete=current-password` và bàn phím mặc định để hỗ trợ chữ, ký tự đặc biệt và trình quản lý mật khẩu. Payload `{password}` truyền chuỗi nguyên vẹn, gồm số 0 đầu. Việc chọn PIN và lưu hash phía server theo handoff 05.
- Chromium mô phỏng iPhone 13 kiểm tra cả hai form với PIN giả lập có số 0 đầu và mật khẩu dài có khoảng trắng/ký tự đặc biệt. Cả hai gửi đúng chuỗi, giữ trường nhập che nội dung và gợi ý autofill. Dùng route fixture, không gửi credential tới production.
- **Session 05 — rollout mở khóa:** chỉ mang thay đổi nhãn/hint và thuộc tính ô nhập từ `remote-admin/lib/login.html` và form `#auth-form` sang hai file HTML tương ứng trong staging đã duyệt. Giữ bundle dashboard và backend trước v2 cho rollout này. Không lấy toàn bộ `web/public/index.html` hoặc backend hiện hành vì có WIP mode v2. Xác minh lại manifest cho hai HTML sau khi stage. Session web chưa deploy hoặc thay cấu hình production.

## Bàn giao phản hồi nhanh, heatmap và tích hợp thật

- Đo đọc trên 1.2.0 từ Mac, ba mẫu mỗi route. LAN `/api/status` HTTP 200 mất 38–58 ms. Cloud `/api/auth/session` HTTP 200 chưa đăng nhập mất 368–405 ms, `/api/admin/state` HTTP 401 mất 374–448 ms. Đây là thời gian GET, chưa đo lệnh có phiên trên production.
- Web hiện pending ngay, hủy GET trạng thái/cấu hình đang chạy khi gửi mutation, và hỏi endpoint kết quả ngay khi server trả 202. Các lượt hỏi sau tăng từ 650 ms lên tối đa 2 giây khi tab hiển thị, 3,2 giây khi ẩn. Chỉ báo áp dụng khi ACK có đúng ID và kết quả `applied`, rồi đọc snapshot ngay trước khi mở lại điều khiển. GET trạng thái cloud đặt `X-Desk-Interactive: 1` khi tab hiện, theo lease và hạn mức của 05. Thời gian ESP32 nhận và gửi ACK còn phụ thuộc firmware và gateway.
- Heatmap 24 tuần trên TFT/preview và 52 tuần web giữ ô bo, cùng palette Dark của 03 `#303A46 #125638 #21845A #42B978 #8CF2AC` trên thẻ `#161B22`. Preview Light dùng bộ 03 cho TFT sáng.
- Quota web đặt hai hàng 5 giờ và 7 ngày, hiện phần trăm còn lại từ tỷ lệ nguồn, giờ reset ICT và thời gian còn lại, nhãn cũ hoặc không hỗ trợ. Credit subscription, số lượt reset được cấp và thời điểm đồng bộ lấy từ projection của 05. TFT preview dùng tỷ lệ đã dùng để khớp renderer. Ô thiếu dữ liệu không hiện số. Cloud Calendar hiện nút kết nối/ngắt kết nối theo khả năng server, dùng session + CSRF. Callback mở bảng lịch và hiện kết quả. Việc cấp quyền Google và xuất sự kiện sang TFT phụ thuộc cấu hình 05. Quota cần bridge Codex App Server và Claude Code status line, theo [handoff 05](remote-admin.md).
- Ảnh Chromium fixture 390 và 1.440 px tại `.dev/web-qa/fast-quota/{390,1440}-{heatmap,quota}.png`. Số trong ảnh là dữ liệu fixture có nhãn. **05** stage `web/public/` hoặc `.dev/web-qa/fast-quota/dashboard.tar.gz` (SHA-256 `ece1e873bcc3797563b150a0a3b582cc9490a9aa788071a5a3308e7ee9549f3c`). **01** nạp LittleFS từ cùng sáu file với firmware mới. Ảnh 1.966.080 byte giải nén khớp sáu file, tại `.dev/web-qa/fast-quota/build/esp32doit-devkit-v1/littlefs.bin` (SHA-256 `f9a745bdb9df63978ce8aafdd6142e28f3b191f5a3d88904876e0626fb939454`). Session web chưa deploy hoặc ghi board. Cần nghiệm thu ACK thật và mẫu nguồn sau rollout.
- Chromium cuối đạt 13/13 lượt fixture. Lượt GET kết quả đầu tiên được phát cùng mili giây với HTTP 202 theo phép đo sự kiện trình duyệt trên loopback, trước khi fixture cho phép ACK. Đã kiểm tra giữ mode cũ khi pending, đọc snapshot sau ACK, Calendar connect/callback/disconnect qua route mô phỏng và quota có/thiếu credit. Log `.dev/web-qa/fast-quota/final.log`. Commit asset và test `0f881f7537cc6195de6988604c42c565b01768f9`; dùng SHA này để đối chiếu nguồn web trước khi nạp.

## Điều chỉnh riêng hai lớp nền GitHub

- Đồng bộ token của [03](display.md#github--nền-và-thẻ-trung-tính). Dark dùng nền `#101419`, thẻ `#1B212A` và viền `#39434F`; Light dùng nền `#F5F6F8`, thẻ `#FFFFFF` và viền `#D3D9E1`. Lịch 52 tuần theo theme TFT. Vùng bao preview dùng surface Dark trung tính để nối với chrome admin. Giữ hai dải màu contribution, bo ô, bố cục và mascot.
- A/B dùng cùng fixture, giờ, dữ liệu và kích thước 390/1.440 px ở Dark/Light. Tám ảnh tại `.dev/web-qa/github-neutral/{390,1440}-{dark,light}-{before,after}.png`. Bản trước là asset từ `0f881f7`. Chromium kiểm tra trực quan, pixel Canvas và nền/thẻ/legend HTML theo theme, không tràn ngang; bộ hồi quy 13/13 lượt đạt, log `.dev/web-qa/github-neutral/verify.log`. 06 dùng `compare.log` để kiểm chéo cùng renderer.
- LittleFS kiểm tra giải nén khớp sáu asset, tại `.dev/web-qa/github-neutral/build/esp32doit-devkit-v1/littlefs.bin`, SHA-256 `bb66591a480b72d978865e65d2406a02b8f238b6706b4471271b86530e3ada77`. Thay thế ảnh QA web ở mục trước. 01/05 dùng `web/public/` từ SHA tích hợp đã chốt cùng commit renderer; session web chưa flash hoặc deploy.

## Đối chiếu Quota trên ESP32 1.2.3

- Board `192.168.34.38`, chỉ GET. Chromium 390/1.440 px: Codex stale, API báo 100% đã dùng trong 5h và 16% trong 7d, trang Quota hiện còn 0% và 84%, reset ICT. `unit:null` trong hai cửa sổ vẫn hiện tỷ lệ %, không suy ra số tuyệt đối. `hasCredits:true` với `balance:null` hiện “Có credit · chưa có số dư”. Một lượt reset có ngày hết hạn. Claude unavailable, hai cửa sổ thiếu tỷ lệ, không có meter hay số credit. JS/CSS phục vụ trước bản sửa khớp source lúc đo. Refresh dữ liệu thật do 05 xử lý.
- Sửa lệch duy nhất tìm được: Canvas Quota Codex thêm `R: n` cùng hàng thời điểm mẫu, khớp renderer TFT. Trang Quota đã hiện số lượt reset. Bản sửa cần cập nhật asset `preview.js` ở cloud và LittleFS nếu muốn preview LAN hiển thị dòng này. Có thể dùng cùng firmware hiện hành.
- 06: ảnh LittleFS QA mới tại `.dev/web-qa/quota-parity/build/esp32doit-devkit-v1/littlefs.bin`, đã giải nén khớp cả sáu asset. SHA-256 `ee22520fa656129f5cba194e5aef32e14b1593ead4324c21158ed591b2d61e33`. Session web không ghi board, không dùng serial.
- Chromium đạt 13/13 lượt fixture, gồm Codex 100%/16% đã dùng, credit số dư null, một reset credit, `R: 1` trong Canvas, và Claude 0% đã dùng/giá trị null phân biệt đúng. Log `.dev/web-qa/verify-quota-parity.log`.

## Gỡ Quota Codex và Claude khỏi web

- Dashboard LAN và cloud dùng chung `web/public/`. Ba mode chính là GitHub, Đồng hồ + Lịch và Đếm ngược. Đã gỡ trang Quota, hai mascot quota, lựa chọn khởi động/luân phiên và luồng đọc dữ liệu quota. Liên kết `#quota` cũ mở dashboard và giữ query string. Với thiết bị trước migration, web vẫn mở khi nhận mode đã gỡ, hiện “Chế độ cũ” và cho chọn mode hợp lệ. Nếu cấu hình chứa mode đã gỡ, form hiển thị GitHub làm startup mặc định và lọc danh sách luân phiên ngay trên trình duyệt. Chỉ thao tác lưu mới gửi cấu hình.
- **02:** Web LAN đọc đối tượng lịch từ `GET /api/calendar` theo [contract mode](modes-contract.md). Firmware xử lý migration cấu hình đã lưu. **05:** Web cloud lấy trường `calendar` qua `GET /api/admin/integrations` với phiên quản trị. Hai thao tác kết nối và ngắt Google Calendar giữ các route hiện hành theo [contract remote admin](remote-admin-contract.md).
- Chromium đạt 14/14 lượt fixture. Bao gồm chuyển hướng `#quota` khi tải mới và khi đổi hash, bỏ các lựa chọn cũ, mở cấu hình trước migration mà không ghi thiết bị, Calendar LAN/cloud, GitHub và mascot ZAH, Đếm ngược và ACK cloud. Log ở `.dev/web-qa/verify-retire-quota.log`.
- **01/05:** Stage sáu asset từ `web/public/` của cùng SHA tích hợp chứa thay đổi 02, 03, 05 và web. Ảnh LittleFS QA tại `.dev/web-qa/no-quota/build/esp32doit-devkit-v1/littlefs.bin`, kích thước 1.966.080 byte. Đã giải nén đối chiếu khớp đủ sáu asset. SHA-256 `74994de1d4e3c276fe7b0e65da5d331fb3956334de7cb83c8c9988ca10c1b68b`. Nguồn và ảnh staging ở các mục Quota cũ phía trên đã được thay thế bởi mục này. Session web chưa flash hoặc deploy.
