# Remote Admin v1

Canonical origin: `https://desk.thezah.space`. Browser dùng cùng origin, ESP32 chủ động kết nối HTTPS. Production alias chỉ phục vụ chuyển hướng GET/HEAD tới canonical origin. ESP32 tiếp tục dùng LAN khi cloud mất mạng. Không có route chuyển tiếp tới LAN.

## Browser

Mọi API trả JSON, `Cache-Control: no-store`, không CORS. Lỗi `{"ok":false,"error":{"code":"...","message":"..."}}`. Mutation dùng JSON và `Origin` đúng canonical origin. Các mutation sau login cần header `X-CSRF-Token`.

| API | Request | Response |
| --- | --- | --- |
| GET /api/auth/session | — | `{"authenticated":false}` hoặc `{"authenticated":true,"csrfToken":"...","expiresAt":1794556800}` |
| POST /api/auth/login | `{"password":"..."}` | 200 với session như trên, Set-Cookie; 401 `invalid_credentials`, 429 `rate_limited` với Retry-After |
| POST /api/auth/logout | `{}` | `{"ok":true}`, hủy session ở Redis và cookie |
| GET /api/admin/state | — | `{"connection":"online","lastSeenAt":1794556800,"status":{...},"config":{...},"github":{...},"command":null}` |
| POST /api/admin/commands | `{"id":"<32 chữ số hex thường ngẫu nhiên>","type":"display","payload":{"mode":"clock"}}` | 202 `{"ok":true,"command":{...}}`, 409 `device_offline`, `command_pending` hoặc `id_conflict` |
| GET /api/admin/commands/<id> | — | `{"ok":true,"command":{...}}` hoặc 404 sau khi hết thời gian giữ kết quả |

Login gửi `password` dạng chuỗi. Chủ tài khoản có thể dùng PIN đúng 6 chữ số ASCII hoặc mật khẩu dài. Giữ nguyên số 0 đầu, không ép kiểu số. Trường password với autocomplete hiện tại hỗ trợ cả hai. Có thể ghi nhãn “PIN hoặc mật khẩu” khi cập nhật giao diện.

Session được lưu server-side và có hạn 8 giờ. Unauthenticated admin API trả 401. `connection` là `offline` khi chưa có snapshot hoặc lần thấy gần nhất quá 300 giây, `stale` khi quá 75 giây tới 300 giây, còn lại `online`. `lastSeenAt` là Unix giây hoặc null. `status`, `config`, `github` là các đối tượng theo device-api.md đã bỏ thông tin mạng LAN, `githubProxyUrl` và dữ liệu bí mật. `status.wifi.ip` và `status.wifi.hostname` có thể null. Các đối tượng có thể null trước lần sync đầu. `command` là lệnh mới nhất. Command browser gồm `id,type,payload,createdAt,expiresAt,state,ack`. `state` là `queued`, `applied`, `rejected`, hoặc `expired`, `ack` là null hoặc `{"id":"...","result":"applied|rejected","code":"..."|null}`. Chỉ có một lệnh chưa kết thúc tại một thời điểm. Dùng lại ID và payload giống hệt để retry cùng hành động. Backend giữ idempotency 24 giờ, TTL thực thi 90 giây. Timestamps dùng Unix giây UTC.

Allowlist v1

- `display` với `{mode}` theo LAN.
- `message` với đầy đủ `{text,alignment,color,size}` theo LAN.
- `countdown` với payload theo [modes-contract.md](modes-contract.md). Các mode mới `countdown`, `codex`, `claude` hợp lệ cho display và rotation.
- `pomodoro` với `{action:"start"|"pause"|"reset"}`.
- `config` với partial `{theme,clockShowSeconds,rotation}`. Nếu gửi `rotation`, gửi đủ `{enabled,intervalSeconds,modes}` theo LAN.
- Settings mạng, GitHub proxy URL, provisioning và restart tiếp tục điều khiển qua LAN.

## Device

`POST /api/device/sync` với `Authorization: Bearer <device token ngẫu nhiên 32 byte dạng 64 hex thường>`, `Content-Type: application/json`. Có đúng một thiết bị v1. Token độc lập mật khẩu, chỉ cho phép route sync, lưu trong Preferences/secret provisioning, server lưu SHA-256 token. Không gửi Origin từ ESP32. ESP32 chỉ truy vấn canonical host qua TLS xác thực hostname và CA, cần giờ NTP hợp lệ.

```json
{
  "v": 1,
  "ts": 1794556800,
  "nonce": "<32 chữ số hex thường từ 16 byte ngẫu nhiên>",
  "status": {},
  "config": {},
  "github": {},
  "ack": null
}
```

Gửi snapshot status/config/github theo LAN, bỏ credential, địa chỉ nội bộ và proxy URL. Server chỉ lưu các trường được chọn. Giới hạn request 6144 byte. `ack` là `null` hoặc `{"id":"<id đã nhận>","result":"applied"|"rejected","code":null|"<mã ASCII a-z/0-9/underscore, tối đa 48>"}`. Trả `{"ok":true,"serverTime":1794556800,"ackId":null,"command":null}` hoặc `command:{"id":"...","type":"display","payload":{"mode":"clock"},"createdAt":1794556800,"expiresAt":1794556890}`. Backend chỉ xác nhận `ackId` khi lệnh đã từng được gửi cho thiết bị và kết quả đã lưu hoặc đã hết hạn. Giữ ACK cho tới khi thấy đúng `ackId`. Có thể gửi ACK lại với nonce mới khi mất response. Backend từ chối timestamp ngoài ±90 giây và nonce đã dùng trong 181 giây, trả 409 `invalid_device_time` hoặc `replay`. Retry mỗi lần với nonce mới.

Poll mỗi 20 giây khi có Wi-Fi, tăng backoff khi lỗi. Dùng `expiresAt` và đồng hồ đồng bộ để loại lệnh cũ. Lưu dấu lệnh đã nhận vào NVS **trước khi áp dụng** để cùng một lệnh không chạy lại sau reboot. Lưu ACK cuối, gửi lại kết quả cũ nếu server gửi lại cùng lệnh. Nếu mất điện giữa ghi dấu và kết quả, trả `rejected` với `outcome_unknown` và giữ local state hiện có. Không áp dụng lệnh mới trước khi xử lý ACK đang chờ. Không block Arduino loop vì HTTP. Server không biết trước trạng thái LAN, nên giao diện cập nhật dựa trên snapshot mới sau ACK.

## Điều kiện kích hoạt

Production yêu cầu Redis bền vững, hash mật khẩu, hash device token và origin canonical. Thiếu cấu hình, web chỉ hiện thông báo chưa thiết lập và API trả 503 `setup_required`. Không có mật khẩu mặc định.

## Dữ liệu Calendar và quota v1

Dùng `GET /api/admin/integrations` với cookie admin, JSON no-store. ESP32 đọc cùng projection qua trường tùy chọn `integrations` trong response `POST /api/device/sync` sau xác thực bearer, nếu request có `wantIntegrations:true`. Hai payload dùng chung schema. Browser và thiết bị phải chấp nhận response cũ chưa có trường này. Cấu hình OAuth và gửi dữ liệu bridge chỉ qua server hoặc CLI local của chủ tài khoản.

```json
{
  "v": 1,
  "calendar": {
    "source": "google_calendar",
    "state": "unavailable",
    "observedAt": null,
    "timeZone": "Asia/Ho_Chi_Minh",
    "events": []
  },
  "quotas": {
    "codex": {"source":"codex_app_server","kind":"subscription","state":"unavailable","observedAt":null,"windows":[]},
    "claude": {"source":"claude_code_statusline","kind":"subscription","state":"unavailable","observedAt":null,"windows":[]}
  }
}
```

- `state` là `live`, `stale`, `unavailable`, hoặc `unsupported`. `observedAt` là Unix giây UTC của mẫu cuối, hoặc null. Khi chưa cấu hình/không đọc được nguồn và chưa có mẫu, trả unavailable với mảng rỗng. Unsupported chỉ dùng khi nguồn xác nhận chế độ xác thực không thuộc subscription hoặc không cung cấp loại quota. Với mẫu cũ, UI hiện stale và tuổi dữ liệu. Không suy ra số 0 khi thiếu dữ liệu.
- Calendar lấy lịch chính trong 48 giờ tới, tối đa 3 sự kiện đang diễn ra hoặc sắp bắt đầu. Mỗi event có `title` (tối đa 64 byte UTF-8, generic nếu sự kiện private/confidential), `start`, `end` (Unix giây UTC, end exclusive) và `allDay` (boolean). Giờ all-day là nửa đêm theo timezone lịch gốc. Không lấy mô tả, khách mời, địa chỉ, link hoặc ID. Chỉ gửi tiêu đề/thời điểm đến thiết bị đã ghép nếu chủ tài khoản chủ động bật xuất Calendar tới ESP32. TFT có thể dùng nhãn ASCII generic nếu chưa có font tương ứng.
- Mỗi phần tử `windows` có `id`, `windowMinutes` (số nguyên dương hoặc null), `resetsAt` (Unix giây hoặc null), `usedPercent` (0–100 hoặc null), `used`, `limit` (số hoặc null), `unit` (chuỗi hoặc null). Codex giữ tối đa 2 cửa sổ `primary` và `secondary` của bucket `codex`. Claude giữ tối đa 2 cửa sổ `five_hour`, `seven_day` từ trường rate_limits chính thức. Không trộn API/organization usage, credits mua thêm, spend limit, context usage hoặc số tin nhắn ước tính. Với hai nguồn v1, các trường số tuyệt đối và đơn vị là null.
- Calendar làm mới khoảng 5 phút, giữ mẫu lỗi tối đa 1 giờ, luôn lọc sự kiện đã kết thúc. Quota quá 15 phút hoặc có cửa sổ đã đến hạn reset hiển thị stale, hết lưu sau 24 giờ. Không đặt lại phần trăm từ đồng hồ local.

Bridge local dùng `POST /api/bridge/quota/codex` hoặc `/claude`, bearer riêng 64 hex, server nhận hash riêng từng nguồn. Không dùng cookie admin, device credential, hay credential nhà cung cấp. Chỉ gửi mẫu quota đã lọc.

## Quota bổ sung và phản hồi lệnh nhanh

- Quota có thêm `credit` và `resetCredits` tùy chọn, consumer cũ bỏ qua. `credit` là `null` hoặc `{"balance":"12.5","unit":"credits","hasCredits":true,"unlimited":false,"resetsAt":null}` do Codex App Server `credits` cung cấp. `balance` là chuỗi thập phân gốc hoặc null. `resetCredits` là null hoặc `{"availableCount":2,"expiresAt":null}`; chỉ lấy số lần reset được cấp từ `rateLimitResetCredits` và ngày hết hạn sớm nhất trong danh sách còn hiệu lực nếu có. Thời điểm reset quota vẫn nằm riêng trong từng cửa sổ. Claude Code status line chỉ cung cấp cửa sổ subscription, credit và reset credit giữ null.
- Admin state GET có thể gửi `X-Desk-Interactive: 1` khi tab đang hiển thị. Gateway gia hạn lease tối đa 120 giây khi có thiết bị được thấy trong 75 giây qua, tối đa 30 phút poll nhanh tích lũy trong mỗi ngày UTC. Firmware hỗ trợ nhịp idle 60 giây gửi `pollHints:true` trong mọi sync. Phản hồi device sync có trường tùy chọn `pollAfterMs` (3000 trong lease hoặc 60000 ở idle nếu client đã gửi `pollHints:true`; bỏ field ở idle cho client cũ để giữ mặc định 20000). Firmware dùng giá trị server đã clamp, tiếp tục ACK nhanh và backoff khi lỗi. Gateway ghi `deliveredAtMs` và `acknowledgedAtMs` trong view admin, cùng `queuedAtMs`; thiết bị vẫn nhận command cũ đúng năm field.
- OAuth Calendar: `POST /api/admin/calendar/connect` dùng cookie admin + CSRF và trả `{ok:true,authorizationUrl}`. Browser điều hướng top-level đến URL Google. Callback canonical `GET /api/auth/google/callback` dùng state một lần liên kết phiên admin và cookie callback riêng Lax; cookie admin vẫn Strict. `POST /api/admin/calendar/disconnect` yêu cầu CSRF để xóa liên kết. Trường `calendar.canConnect` và `calendar.connected` trong view admin cho phép hiện nút phù hợp.
