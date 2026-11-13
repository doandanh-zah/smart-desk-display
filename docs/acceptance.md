# Checklist nghiệm thu

Đánh dấu từng mục sau khi có log, quan sát hoặc ảnh tương ứng. Ghi ngày, phiên bản nguồn, mạng kiểm thử và kết quả vào [handoff tích hợp](coordination/integration.md).

| Phạm vi | Kiểm tra | Bằng chứng đạt |
| --- | --- | --- |
| Build Mac | Build firmware và LittleFS trên volume SSD | Hai lệnh thoát 0, ghi mức sử dụng Flash/RAM, kích thước phân vùng FS và danh sách asset trong ảnh. |
| Fixture dashboard | Mở dashboard từ server fixture dùng schema thiết bị | Hiện preview 320×240, đủ năm mode, lưu cấu hình và cập nhật timer qua REST; giao diện vẫn thao tác được ở chiều rộng điện thoại. |
| Fixture proxy | Chạy bộ test proxy với GraphQL giả lập | Qua các ca lịch 52×7, tổng, streak, 400/404/429, timeout và upstream lỗi. |
| Thiết bị thật | Xác nhận dây và J1, nạp smoke test | TFT có chữ, màu, góc hiển thị và landscape 320×240 trên USB 5 V. |
| Thiết bị thật | Nạp firmware và LittleFS cùng phiên bản | Splash, TFT có hướng dẫn Wi-Fi hoặc màn hình ứng dụng, dashboard và asset tải từ IP thật. |
| Thiết bị thật | Thiết lập Wi-Fi mới rồi khởi động lại | AP phát thông tin hiển thị trên TFT; lưu thành công, trở về LAN, có IP và mở được dashboard trên Mac hoặc điện thoại. |
| Thiết bị thật | Chọn lần lượt 5 mode từ dashboard | REST báo mode đúng và TFT đổi nội dung tương ứng. Ghi riêng GitHub Demo hay dữ liệu thật. |
| Thiết bị thật | Chọn Clock | TFT báo chờ khi chưa đồng bộ và hiển thị ngày, thứ, giờ UTC+7 đúng sau NTP. |
| Thiết bị thật | Start, Pause, Resume, Reset Pomodoro | Dashboard và TFT nhất quán. Đóng dashboard ít nhất 10 giây khi đang chạy rồi mở lại để so thời gian còn lại. |
| Thiết bị thật | Gửi tin nhắn ASCII, đổi căn lề, màu và cỡ | TFT cập nhật; tin nhắn dài xuống dòng và không tràn vùng hiển thị. |
| Thiết bị thật | Bật rotation và chọn tập mode, đổi mode thủ công | Đổi đúng tập/chu kỳ, quy tắc sau thao tác thủ công đúng tài liệu. |
| Thiết bị thật | Rút USB, cấp nguồn lại | Wi-Fi, cấu hình, nội dung tin nhắn và quy tắc mode khởi động đã lưu được khôi phục. |
| Proxy thật và thiết bị thật | Kiểm thử endpoint HTTPS với username thật rồi lưu trên ESP32 | Proxy trả lưới hợp lệ; trạng thái trên thiết bị chuyển sang dữ liệu thật và có giờ đồng bộ. |
| Thiết bị thật | Làm mất kết nối đến proxy sau lần fetch thành công | GitHub báo lỗi hoặc dữ liệu cũ có nhãn; Clock, Pomodoro và Custom Message vẫn dùng được. |
| Thiết bị thật | Làm mất rồi khôi phục Wi-Fi | TFT tiếp tục các chức năng cục bộ, ESP32 tự kết nối lại và dashboard dùng lại được. |

## Kiểm tra HTTP từ Mac

```sh
cd /Volumes/SmartDeskDev/smart-desk-display
source .dev/env.sh
bash verification/check_littlefs.sh "$SMART_DESK_DEV/littlefs-build/esp32doit-devkit-v1/littlefs.bin"
python3 verification/check_http.py device http://192.168.1.50
python3 verification/check_http.py proxy https://example.vercel.app/api/contributions --username octocat
```

Thay IP và URL bằng địa chỉ thật cần kiểm tra. Lệnh kiểm tra đọc status, config, dashboard và tài nguyên cùng origin. Lệnh proxy kiểm tra hình dạng dữ liệu, ngày, streak và lỗi username. Ghi lại nguồn URL trước khi phân loại kết quả. Khi chạy với fixture, pass chỉ xác nhận luồng HTTP và schema mà fixture cung cấp.

## Chạy với fixture

Mở hai terminal tại thư mục gốc. Terminal thứ nhất chạy fixture loopback, terminal thứ hai gửi các lệnh kiểm tra.

```sh
source .dev/env.sh
node web/fixture.mjs
```

```sh
source .dev/env.sh
python3 verification/check_http.py device http://127.0.0.1:4173 --exercise-fixture
npm --prefix github-proxy test
```

`--exercise-fixture` thay đổi mode, cấu hình, tin nhắn và timer trên fixture. Mở `http://127.0.0.1:4173/` để kiểm tra dashboard và dùng DevTools thử kích thước điện thoại. Xem [hướng dẫn proxy](../github-proxy/README.md) cho cách cấu hình GitHub thật.

## Kết quả nghiệm thu trên LAN

| Hạng mục | Bản demo tại `http://192.168.88.192/` |
| --- | --- |
| TFT smoke test | Đạt theo quan sát trực tiếp của người dùng: chữ nằm ngang và bốn ô màu đúng thứ tự. |
| Provisioning và dashboard | Thiết bị vào Wi-Fi, Mac tải dashboard, asset và ba API GET qua IP. |
| NTP | API báo UTC+7, sai lệch khoảng 1 giây so với đồng hồ Mac tại lúc đo. Clock trên TFT cần quan sát riêng. |
| API strict | Bản demo thiếu trường IP/hostname và hai trường nullable GitHub. Kiểm tra lại sau khi nạp bản sửa. |
| mDNS | Mac chưa phân giải được `esp32-display.local`; truy cập qua IP hoạt động. |
| Pomodoro và lưu cấu hình | Đã lưu baseline trước lần nạp kế tiếp. Bài thử timer khi đóng trình duyệt dùng một phiên QA mới khi timer ở trạng thái idle. |
| GitHub live | Bản demo trả trạng thái Demo. Cần endpoint HTTPS live và username đã xác nhận để nghiệm thu TLS và dữ liệu trên ESP32. |

Log, phiên bản ảnh đã nạp và kết quả cập nhật nằm trong [handoff tích hợp](coordination/integration.md) và [handoff phần cứng](coordination/hardware.md).

### Bản sửa 1.0.1

| Hạng mục | Kết quả thực tế |
| --- | --- |
| REST và dashboard theo IP | Đạt strict API. Bốn tệp web từ ESP32 khớp nguồn. |
| NTP | Thấy trạng thái chờ ngay sau boot, sau đó đồng bộ UTC+7, lệch khoảng 1 giây so với Mac. |
| mDNS trên Mac | Tên `esp32-display.local` chưa phân giải. HTTP qua IP hoạt động, kể cả khi ép hostname bằng `curl --resolve`. |
| Pomodoro khi đóng browser | Đạt. ESP32 giảm 11 giây trong 11,1 giây khi Chromium đóng và dashboard đọc lại được timer đang chạy. |
| Wi-Fi và cấu hình qua reboot | Đạt qua đợt nạp và restart bằng API. ESP32 nối lại Wi-Fi, giữ giá trị cấu hình đã ghi và mode khởi động. Cài đặt tạm và timer QA đã được khôi phục. |
| TFT cho từng mode và ngắt nguồn | Cần quan sát trực tiếp khi đổi mode, kiểm tra tin nhắn, Clock và Pomodoro trên TFT, rồi thử rút/cấp lại USB. |
| GitHub thật trên ESP32 | Chờ proxy production có token và username. Endpoint hiện trả 503 `proxy_unconfigured`. |

## GitHub Contributions và mascot động

Dùng `.dev/references/github-display-reference.png` để đối chiếu cách phân vùng trên canvas và TFT 320×240. So màu, chữ và hình mascot với handoff thiết kế cuối. Lưu ảnh hoặc video từ đúng phiên bản firmware và LittleFS đã nạp.

| Hạng mục | Điều kiện đạt |
| --- | --- |
| Nhận diện | Mascot nằm bên trái, tên và hai dòng phụ nằm bên phải. Hiển thị GitHub username đã cấu hình hoặc tên dự phòng đã chốt, cùng `DUT SUPERTEAM UNIVERSITY CLUB` và `SUPERTEAM VIETNAM`. Cỡ chữ và độ tương phản tạo được thứ bậc rõ trên 320×240. Tên 39 ký tự vẫn vừa vùng nhận diện. |
| Phong cách | Bảng màu, kiểu chữ, bề mặt và chi tiết mascot nhất quán theo thiết kế cuối. Đối chiếu với ảnh phác để xác nhận các vùng tương ứng và phong cách đã được thiết kế lại. |
| Mascot động | Trên preview và TFT, quan sát ít nhất hai frame của mascot tự chuyển khi giữ nguyên mode. So hình dáng, thứ tự frame, màu và nhịp với handoff. Mascot gọn trong vùng bên trái. Đo hoặc quan sát vài vòng để kiểm tra nhấp nháy, vệt lưu hình và redraw lan sang chữ hay lưới. |
| Heatmap | Vùng giữa có 52 cột × 7 hàng khi có dữ liệu, 5 mức phân biệt được, tuần cũ nhất bên trái và Chủ nhật ở trên cùng. Đối chiếu cùng dữ liệu API trên preview và TFT. |
| TIME và STREAK | Giờ ở dưới trái lấy từ ESP32 theo UTC+7. Khi NTP chưa đồng bộ, có trạng thái chờ. Streak ở dưới phải khớp API, gồm trường hợp streak 0. |
| Nguồn và trạng thái | `live` có 364 ô, số liệu khớp proxy HTTPS và thời điểm đồng bộ. Demo có nhãn riêng. Cache giữ lưới và thời điểm đồng bộ gần nhất, có nhãn dữ liệu cũ. Đang tải và lỗi có phản hồi đọc được khi chưa có dữ liệu. |
| Hồi quy | Clock, Developer Stats, Pomodoro và Custom Message vẫn hoạt động với bố cục hiện có. So ảnh preview cố định đầu vào và chạy smoke cả năm mode. |
| Firmware và web thật | Ghi hash hai ảnh đã nạp, chạy strict HTTP theo IP, đối chiếu asset với nguồn. Sau khi boot, kiểm tra `GET /api/config` vẫn giữ `doandanh-zah` và URL proxy, `GET /api/github` trở lại `live` với 364 ô. |

Ghi riêng kết quả fixture, preview chạy trên LAN, trạng thái GitHub live và quan sát TFT. Để nghiệm thu chuyển động trên TFT, cần nhìn tại bàn hoặc xem video trong vài chu kỳ. API chỉ xác nhận dữ liệu và mode của thiết bị.

**Baseline trước mascot:** bản bố cục trắng/xanh đã qua strict HTTP và nhận dữ liệu thật của `doandanh-zah`. Tại lúc đo, 364 ô, 1.090 đóng góp, streak 0 và 18 repo công khai khớp proxy. Handoff lưu kết quả bản này để đối chiếu sau khi nạp bản mới.

**Fixture mascot:** Chromium thấy đủ ba pose ở 390 và 1.280 px và đứng ở một pose khi bật giảm chuyển động. Sprite C++ và Canvas khớp RGB ở 11 mốc kiểm tra trong cả hai theme. Năm mức màu heatmap khớp handoff. Bốn mode khác khớp baseline với dữ liệu cố định. Đang chờ xác nhận trên bản nạp và quan sát TFT.

**Bản mascot trên LAN:** API strict đạt, asset khớp nguồn và toàn bộ cấu hình còn nguyên sau nạp. ESP32 trở lại `live` qua HTTPS với 364 ô của `doandanh-zah`, tổng 1.090, streak 0 và 18 repo công khai. Preview từ board có ba pose tại 390 và 1.280 px, một pose khi bật giảm chuyển động. Palette và sprite từ asset đang nạp khớp contract ở cả hai theme.

**TFT vật lý:** chờ người dùng quan sát ít nhất 5 giây để xác nhận mèo chớp mắt và vẫy đuôi, tên và dòng phụ đọc được, heatmap đứng ổn định, giờ ICT và streak khớp API.

## Admin từ xa và mascot từ ảnh nguồn

Lấy kết quả trên đúng firmware, LittleFS và phiên bản triển khai. Ghi riêng fixture, HTTPS công khai, thao tác từ mạng ngoài LAN, trạng thái API của ESP32 và quan sát TFT. Trong lúc kiểm thử mode, lưu lựa chọn hiện tại và khôi phục khi xong. Giữ nguyên Pomodoro đang chạy.

| Hạng mục | Điều kiện đạt |
| --- | --- |
| DNS và HTTPS | `desk.thezah.space` phân giải đến hạ tầng cloud, chứng chỉ đúng hostname và trình duyệt tải được admin qua HTTPS. Firmware chủ động kết nối ra cloud. Đối chiếu cấu hình triển khai và xác nhận luồng không cần mở cổng mạng nhà hay định tuyến trực tiếp đến ESP32. |
| Login và logout | Trình duyệt mới mở trang đăng nhập. Mật khẩu sai bị từ chối với lỗi chung và có giới hạn tần suất theo contract. Mật khẩu đúng mở dashboard. Logout hủy phiên; tải lại hoặc dùng phiên cũ để gọi API đều bị từ chối. Kiểm thử giới hạn theo số lượt công bố, ưu tiên fixture để tránh ảnh hưởng phiên người dùng. |
| API admin | Yêu cầu đọc dữ liệu thiết bị và ghi lệnh cần phiên admin hợp lệ. Xác nhận mã lỗi theo contract khi thiếu phiên. Cookie phiên chỉ dùng HTTPS, HttpOnly, và có cơ chế ngăn yêu cầu ghi từ origin ngoài. |
| Danh tính thiết bị | Dùng credential riêng của board, kiểm tra fixture thiếu/sai credential bị từ chối và credential của thiết bị A chỉ đọc/ACK lệnh của A. Credential thiết bị không đăng nhập được admin. Không ghi giá trị credential vào log. |
| Lệnh từ mạng ngoài LAN | Từ máy khách trên mạng độc lập, gửi một lệnh đổi mode; ghi mã lệnh, trạng thái chờ, ACK và mode quan sát được trên ESP32. Gửi lệnh khôi phục và chờ ACK. Kiểm tra lệnh đã ACK hoặc đã hết hạn không chạy lại sau reconnect theo contract; dùng fixture cho tình huống lặp gây gián đoạn. |
| LAN khi cloud không dùng được | Sau khi gây lỗi riêng cho đường cloud bằng cách được owner hỗ trợ, dashboard LAN vẫn đọc và đổi mode, Wi-Fi và GitHub phục hồi theo trạng thái của chúng. Khôi phục mode QA. Ghi rõ nếu chỉ kiểm tra hành vi firmware bằng fixture. |
| Avatar và mascot | Đối chiếu avatar với `.dev/references/zahnft.jpg` sau crop/resize nếu có. Preview và TFT dùng nhân vật pixel từ ảnh nguồn, so hình, bảng màu và thứ tự pose theo handoff 03/04. Quan sát chuyển động thực tế trong ít nhất một chu kỳ trên TFT. |
| Heatmap | Web giữ đúng 52×7, tuần cũ bên trái và Chủ nhật ở trên. Ô lớn hơn, có khoảng cách, bo nhẹ và không chạm nhau. Kiểm tra 5 mức phân biệt được trong palette RGB565 của TFT và preview ở theme hỗ trợ. Nếu firmware chia cửa sổ vì độ phân giải, kiểm tra đủ tuần theo contract và ghi giới hạn số cột mỗi màn. |
| GitHub thật | Sau nạp, cấu hình còn `doandanh-zah`, API trở lại `live` và 364 ô khớp proxy HTTPS. Kiểm tra Demo/Cache/Lỗi bằng fixture riêng. |

Chỉ bắt đầu ghi lệnh lên board sau khi nhận handoff nạp và pairing từ session phần cứng. Ghi rõ nguồn mạng của máy khách; truy cập HTTPS từ Mac cùng LAN vẫn là kiểm tra đường cloud, còn tiêu chí ngoài LAN cần một máy khách hoặc đường mạng độc lập.

Từ Mac hoặc máy khách đã xác nhận đang dùng mạng ngoài LAN:

```sh
source .dev/env.sh
python3 verification/check_remote.py https://desk.thezah.space
python3 verification/check_remote.py https://desk.thezah.space --login --wrong-password
python3 verification/check_remote.py https://desk.thezah.space --login --round-trip
```

Mật khẩu được nhập ẩn ở terminal. Chỉ dùng `--round-trip` sau khi đã bàn giao pairing và xác nhận thời điểm kiểm thử. Harness yêu cầu trạng thái online, rotation tắt, mode hiện tại khớp startup mode và Pomodoro không chạy, rồi gửi lệnh khôi phục sau ACK.

### Kết quả đợt admin từ xa

- **Cloud công khai:** DNS và chứng chỉ của `desk.thezah.space` đạt. Trang và API đang khóa với 503 `setup_required` trước khi kích hoạt Redis và mật khẩu.
- **Fixture và Redis local:** login/logout, 401 khi thiếu phiên, Origin/CSRF, 6 lần sai rồi 429, credential riêng, nonce replay, vòng đời lệnh và ACK không cấp lại đã được kiểm tra. Thiết bị trong thử nghiệm Redis là fixture. Firmware host cũng đạt các ca ACK mất và replay sau reboot với NVS giả lập.
- **Giao diện:** avatar WebP khớp hình JPG. Sprite ZAH khớp pixel giữa Canvas và C++ ở 11 mốc, hai theme. TFT và preview mô phỏng dùng 24 tuần gần nhất. Dashboard fixture có đủ 52×7 ô bo 3 px và không tràn toàn trang trên 390 hoặc 1.280 px. Màu lượng tử hóa RGB565 phân biệt đủ 5 mức.
- **ESP32 1.1.0 trên LAN:** nạp và xác minh xong sau lần lỗi USB, cả sáu asset khớp nguồn. Strict HTTP đạt, toàn bộ cấu hình giữ nguyên, 364 ô live của `doandanh-zah` và số liệu khớp proxy. Chromium 390/1.280 px tải avatar và lịch 52×7 hoàn toàn từ LAN trong lúc cloud khóa. Test parity chạy lại trên asset phục vụ từ ESP32, đạt.
- **Còn chờ:** tạo Redis và lưu hash mật khẩu Production, pairing USB, login/logout trên domain, lệnh có ACK và khôi phục từ mạng ngoài LAN, LAN mutation khi board đã ghép bị mất cloud, và quan sát TFT vật lý. Chi tiết bàn giao trong [remote-admin.md](coordination/remote-admin.md).

### Đợt kích hoạt và bố cục admin mới

- Canonical HTTPS đã được sửa chuyển hướng và trả `503 setup_required` trong lúc chờ Vercel nhận `ADMIN_PASSWORD_HASH` Sensitive Production. Redis Free đã được liên kết theo handoff cloud. Login, pairing, snapshot và ACK production vẫn chờ.
- Trên Chromium fixture 390 px, bộ chọn mode và preview nằm tại y=328 và y=501. Baseline LAN cũ là y=658 và y=1.128. Desktop 1.440 px và mobile đều giữ lịch 52×7, không tràn ngang. Chờ đối chiếu bundle phục vụ từ ESP32 và domain.
- Khi gateway đã mở và ESP32 đã ghép, người dùng tự nhập mật khẩu tại `https://desk.thezah.space/`. Từ mạng ngoài LAN, mở trang, xác nhận thấy thiết bị online và dữ liệu GitHub live, gửi một lệnh đổi mode khi Pomodoro không chạy, đợi báo đã áp dụng rồi trả về mode ban đầu. Đăng xuất và mở lại URL để xác nhận màn hình login. Ghi mode trước/sau và thời điểm thao tác để đối chiếu với ESP32, giữ mật khẩu trong trang login.
- **Redesign đã nạp LAN:** sáu asset khớp nguồn, strict HTTP đạt. Ở 390 px mode đầu/preview tại y=219/y=392. Ở 1.440 px tại y=219/y=229. GitHub live, đủ 52×7 trên web và cấu hình khớp snapshot trước nạp.

## Bộ mode mới và palette đóng góp

Dùng `.dev/references/github-dark-heatmap.png` để đối chiếu dải màu đóng góp. Đối chiếu bố cục GitHub với baseline đang chạy, gồm vùng mascot, nhận diện, thẻ heatmap, giờ và streak. Xác nhận cùng firmware và bundle web trong các lần so sánh.

| Hạng mục | Điều kiện đạt |
| --- | --- |
| Palette GitHub | Mức 0 trung tính và bốn mức xanh phân biệt được theo ảnh màu. Kiểm tra RGB nguồn và năm giá trị RGB565 sau lượng tử hóa, đối chiếu cùng thứ tự ở TFT, preview và lưới web. Dùng fixture chứa đủ 5 mức. |
| Dữ liệu 24/52 tuần | TFT và preview dùng 24 tuần cuối theo contract; lịch web giữ 52×7, 364 ô. Kiểm tra tuần cũ bên trái, Chủ nhật hàng trên, level trùng vị trí ở đoạn 24 tuần và tổng dùng 52 tuần. GitHub live giữ `doandanh-zah`. |
| Đồng hồ và lịch | Khi NTP chưa có giờ hợp lệ, có trạng thái chờ. Sau đồng bộ, ngày và giờ ICT đúng, gồm giao ngày/tháng. Thử mất Wi-Fi sau khi đã đồng bộ và phân biệt thời gian vẫn chạy với lần cập nhật NTP mới. Đối chiếu thiết bị và browser, ghi rõ fixture hay mất mạng thật. |
| Countdown | Kiểm start/pause/resume/reset theo contract. Đóng toàn bộ browser ít nhất 10 giây khi đang đếm, sau đó so giây trên API với thời gian đã trôi và xem dashboard đọc lại trạng thái. Giữ phiên Pomodoro/countdown của người dùng. |
| Gỡ quota | Kiểm tra bộ chọn chế độ, cấu hình khởi động và luân phiên, preview và TFT. URL cũ `#quota` về dashboard. API quota cũ trả 404, projection chỉ còn Calendar. Dùng fixture cấu hình cũ có quota trong khởi động và luân phiên, rồi kiểm trên ESP32 sau nạp. |
| Mascot | So pose, nhịp và màu của ZAH NFT theo contract GitHub. Kiểm tra chuyển chế độ giữ vùng ngoài sprite ổn định. Quan sát TFT trực tiếp ít nhất một chu kỳ nếu có chuyển động. |
| Migration | Nạp đè từ bản hiện có hoặc seed fixture cấu hình phiên bản cũ. Kiểm mode startup cũ, danh sách rotation, mode đã đổi tên/xóa, thứ tự và interval theo quy tắc firmware. So Wi-Fi, GitHub, message và config còn giữ. Sau reboot, chọn mode hợp lệ, không kẹt. |
| LAN khi không có cloud/Internet | Dashboard và chức năng local truy cập được qua IP. Kiểm mode, countdown, đồng hồ/lịch và trạng thái Calendar/GitHub khi Internet vắng. Khi ngắt Wi-Fi thì quan sát TFT và truy cập lại LAN sau reconnect. Ghi rõ giới hạn nếu mô phỏng thay vì ngắt đường thật. |

Khi 01 bàn giao bản nạp, chạy kiểm tra chỉ đọc, đối chiếu asset và kết quả NVS. Kiểm tra qua API trước khi thay đổi mode hoặc bộ đếm và chỉ thử khi có thể khôi phục.

```sh
python3 verification/check_http.py device http://192.168.34.38
python3 verification/check_modes.py http://192.168.34.38
```

Ghi kết quả fixture, production và TFT theo môi trường thực tế. Nghiệm thu cloud admin tiếp tục sau khi gateway mở khóa và thiết bị ghép thành công.
