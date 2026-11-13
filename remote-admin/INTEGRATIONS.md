# Calendar và quota subscription

Các nguồn ở trạng thái `unavailable` cho tới khi được thiết lập. UI chỉ đọc qua phiên admin hoặc thông qua thiết bị đã ghép. [Hợp đồng projection](../docs/coordination/remote-admin-contract.md#dữ-liệu-calendar-và-quota-v1)

## Google Calendar

1. Trong [Google Cloud Console](https://console.cloud.google.com/), tạo hoặc chọn project riêng, bật Google Calendar API và cấu hình màn hình consent cho tài khoản của bạn.
2. Tạo OAuth client loại **Web application**. Thêm redirect URI `https://developers.google.com/oauthplayground`. Trong [OAuth 2.0 Playground của Google](https://developers.google.com/oauthplayground/), bật **Use your own OAuth credentials**, chọn **Offline**, nhập ID và secret của client, rồi yêu cầu đúng scope `https://www.googleapis.com/auth/calendar.events.owned.readonly`. Chọn tài khoản muốn kết nối và đồng ý quyền đọc. Đổi code thành token ở Step 2. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
3. Lưu `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` và `GOOGLE_CALENDAR_REFRESH_TOKEN` vào Environment Variables **Sensitive / Production** của project Remote Admin. Redeploy khi các biến đã sẵn sàng. Nếu muốn đưa tiêu đề và thời gian lên ESP32 đã ghép, chủ tài khoản đặt thêm `GOOGLE_CALENDAR_DEVICE_EXPORT=1` trước khi deploy. Nếu bỏ biến này, lịch chỉ có trên dashboard có phiên admin.
4. Kiểm tra lịch bằng tài khoản admin trên domain chính. OAuth project External/Testing cấp refresh token hết hạn sau 7 ngày với Calendar scope. Để dùng lâu dài, cấu hình publishing và verification phù hợp với loại tài khoản trong Google Auth Platform. Có thể ngắt quyền trong Google Account. [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

Backend chỉ gọi Calendar `events.list` cho lịch chính, trong cửa sổ 48 giờ. ESP32 không nhận credential. Redis giữ tối đa ba tiêu đề đã lọc cùng thời gian trong tối đa một giờ. Event private/confidential dùng nhãn chung. [Events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)

## Codex và Claude Code

Codex đọc cửa sổ subscription của bucket `codex` bằng RPC cục bộ `account/rateLimits/read`, sau khi xác nhận `account/read` là ChatGPT. Claude Code lấy các cửa sổ 5 giờ và 7 ngày từ status line JSON chính thức, khi phiên đã nhận phản hồi và tài khoản có trường này. API/organization usage, credit, spend limit và context-window usage không được đưa vào quota subscription. [Codex App Server](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt) · [OpenAI API Usage](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage) · [Claude Code status line](https://code.claude.com/docs/en/statusline) · [Claude Platform Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)

Xem dữ liệu đã lọc tại máy local bằng `node remote-admin/scripts/quota-bridge.mjs codex`. Để đồng bộ, cấp một bridge token ngẫu nhiên riêng cho từng nguồn. Cấu hình biến `SMART_DESK_BRIDGE_TOKEN_DIR` trỏ đến thư mục tuyệt đối trên SSD, ngoài staging deploy. Đặt token 64 hex thường trong `codex.token` hoặc `claude.token`, quyền file 0600. Server chỉ lưu SHA-256 của chuỗi token ASCII, không newline, trong biến Sensitive `CODEX_BRIDGE_TOKEN_SHA256` hoặc `CLAUDE_BRIDGE_TOKEN_SHA256`. Redeploy trước khi chạy bridge.

- Codex: `node remote-admin/scripts/quota-bridge.mjs codex --publish` từ shell đã nạp `.dev/env.sh`. Chạy lại định kỳ khi máy chủ local hoạt động để số liệu luôn mới.
- Claude Code: có thể ghép `node /đường/dẫn/remote-admin/scripts/quota-bridge.mjs claude --publish` vào command status line của người dùng. Dùng Node và đường dẫn tuyệt đối, truyền `SMART_DESK_BRIDGE_TOKEN_DIR` vào môi trường status line. Script chỉ gửi hai cửa sổ đã lọc và in phần trăm để dùng làm status line. Không tự sửa cấu hình Claude Code hiện hữu.
- Hai bridge gửi qua HTTPS tới domain canonical. Token bridge không phải token OpenAI/Anthropic. Máy local không chạy hoặc Claude Code chưa có mẫu thì UI giữ dữ liệu cũ với nhãn stale trong thời gian hợp đồng cho phép.

### Kết nối Google trực tiếp trong admin

OAuth Web application cần đăng ký redirect URI `https://desk.thezah.space/api/auth/google/callback`. Sau khi ID và secret đã lưu ở Vercel Production, deploy rồi đăng nhập admin, mở Lịch và bấm **Kết nối Google Calendar**. Hoàn tất consent trên Google. Backend dùng state một lần, PKCE, phiên admin đang hiệu lực và mã hóa refresh token bằng khóa `GOOGLE_CALENDAR_TOKEN_KEY` (32 byte dạng 64 hex), đặt ở Vercel Sensitive. Nút ngắt kết nối xóa quyền local và cache, rồi thử thu hồi grant tại Google. Biến refresh token dùng cho cách thiết lập cũ vẫn hoạt động khi chưa cấu hình luồng kết nối trực tiếp.

### Claude Code chạy riêng trên Mac này

Trong Terminal tại gốc repo, chạy một phiên với settings dành riêng cho Smart Desk:

```sh
source .dev/env.sh
DISABLE_AUTOUPDATER=1 "$SMART_DESK_DEV/remote-qa/claude/node_modules/.bin/claude" --settings "$SMART_DESK_DEV/remote-qa/claude-session/publish-settings.json"
```

Hoàn tất màn hình chào lần đầu và gửi một tin nhắn ngắn để có mẫu status line. Không cần đổi settings chung. Khi Claude Code gửi cửa sổ 5h hoặc 7d, bridge gửi mẫu đã lọc. Credit subscription Claude giữ chưa có dữ liệu vì status line không cung cấp số dư; gateway spend và context usage là các số liệu khác. [Claude CLI flags](https://code.claude.com/docs/en/cli-reference) · [Status line quota](https://code.claude.com/docs/en/statusline)
