# Hợp đồng dữ liệu GitHub v1

## Proxy HTTPS

`GET /api/contributions?username=octocat`. Cấu hình trên ESP32 là URL đầy đủ tới endpoint, ví dụ `https://example.vercel.app/api/contributions`, tối đa 200 ký tự, dùng hostname và cổng HTTPS mặc định, không có query, fragment, thông tin đăng nhập hoặc dấu / cuối. Tên GitHub dài 1–39 ký tự ASCII, gồm chữ, số và dấu gạch nối đơn ở giữa.

```json
{
  "v": 1,
  "username": "octocat",
  "start": "2025-11-16",
  "asOf": "2026-11-13",
  "levels": "<364 ký tự 0–4>",
  "total": 120,
  "streak": 3,
  "repos": 8
}
```

- Lịch dùng UTC, 52 cột × 7 hàng. Cột 0 cũ nhất, hàng 0 Chủ nhật, hàng 6 Thứ bảy. `start` là Chủ nhật đầu tiên, `asOf` là ngày UTC của lần truy vấn. Phần tử `levels[week * 7 + day]` là ký tự ASCII `'0'`–`'4'`, từ trống tới đậm. Các ngày sau `asOf` trong cột cuối có mức 0. Proxy ánh xạ `contributionLevel` của GitHub thành 0–4. Ngày không có trong lịch upstream được điền mức 0.
- `total` là tổng `contributionCount` của các ngày trong lưới đến hết `asOf`. `streak` là số ngày liên tiếp có đóng góp trong lưới, bắt đầu từ hôm nay nếu có đóng góp, nếu hôm nay chưa có thì bắt đầu từ hôm qua. `repos` là số repo public do tài khoản sở hữu, hoặc `null`.
- Lỗi có dạng `{"error":"rate_limited"}`. HTTP 400 `invalid_username`, 404 `user_not_found`, 405 `method_not_allowed`, 429 `rate_limited`, 502 `upstream_error`, 503 `proxy_unconfigured`, 504 `upstream_timeout`. 429 có thể kèm `Retry-After` (giây).

## Firmware

Header `github/GitHubProvider.h`, namespace `github`. Gọi `provider.configure(username, proxyUrl)` khi cấu hình đổi. Gọi `provider.tick(wifiConnected, clockSynchronized)` từ vòng lặp và đọc `provider.snapshot()` trên cùng luồng. Yêu cầu đồng hồ UTC đã đồng bộ để xác thực chứng chỉ HTTPS. Provider chạy truy vấn trên task riêng và giữ snapshot thành công gần nhất trong RAM cho cấu hình hiện tại. Thiếu tên GitHub hoặc URL tạo snapshot demo. `snapshot()` trả tham chiếu const đến bộ nhớ của provider. Firmware có thể dùng con trỏ tới `data` khi render hoặc xử lý API trên vòng lặp; sao chép snapshot nếu cần giữ nguyên giá trị qua lần gọi `tick()` hay `configure()` tiếp theo.

`Snapshot` chứa `status` (`Demo`, `Pending`, `Ready`, `Stale`, `Error`), `hasData`, `data` và `error` (chuỗi mã lỗi). `data` có `username[40]`, `start[11]`, `asOf[11]`, `levels[364]` dạng **số** 0–4 theo cột, `total`, `streak`, `repos` (-1 nếu thiếu), `syncedAt` (Unix giây UTC, 0 khi chưa có lần nhận dữ liệu thật). Demo đặt `hasData=true`, `syncedAt=0`; renderer/dashboard phải hiện nhãn Demo. `Stale` giữ dữ liệu thật và thời gian đồng bộ trước khi xảy ra lỗi. `Pending` và `Error` có `hasData=false`.

Mã lỗi nội bộ có thể gồm `wifi_offline`, `waiting_for_time`, `invalid_proxy_url`, `worker_unavailable`, `proxy_unreachable`, `tls_verification_failed`, `proxy_timeout`, `proxy_response_failed`, `proxy_http_error` và `invalid_proxy_response`, cùng mã HTTP đã liệt kê ở trên.
