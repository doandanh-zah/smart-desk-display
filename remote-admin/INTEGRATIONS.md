# Google Calendar

Google Calendar hiển thị sau khi cấp quyền đọc. Dashboard yêu cầu phiên admin và ESP32 phải được ghép với gateway. [Hợp đồng projection](../docs/coordination/remote-admin-contract.md#dữ-liệu-calendar-v1)

## Google Calendar

1. Trong [Google Cloud Console](https://console.cloud.google.com/), tạo hoặc chọn project, bật Google Calendar API và cấu hình màn hình consent cho tài khoản của bạn.
2. Tạo OAuth client loại **Web application** với redirect URI `https://desk.thezah.space/api/auth/google/callback`. Lưu `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` và `GOOGLE_CALENDAR_TOKEN_KEY` (32 byte dạng 64 hex) trong Environment Variables **Sensitive / Production**. Redeploy để áp dụng. Đặt thêm `GOOGLE_CALENDAR_DEVICE_EXPORT=1` nếu chủ tài khoản muốn hiển thị tiêu đề và thời gian trên ESP32 đã ghép.
3. Đăng nhập admin, mở Lịch, bấm **Kết nối Google Calendar** và đồng ý quyền đọc sự kiện trên các lịch do tài khoản sở hữu. Backend dùng state một lần, PKCE, phiên admin đang hiệu lực và khóa mã hóa refresh token. Nút ngắt kết nối xóa token và cache local rồi thử thu hồi grant tại Google. [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
4. OAuth project External/Testing cấp refresh token hết hạn sau 7 ngày với Calendar scope. Để dùng lâu dài, cấu hình publishing và verification phù hợp với loại tài khoản trong Google Auth Platform. [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

Backend gọi `events.list` cho lịch chính trong cửa sổ 48 giờ. ESP32 nhận tối đa ba sự kiện đã lọc khi bật xuất lịch. Redis cache tối đa một giờ. Event private/confidential dùng nhãn chung. [Events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)

Cấu hình cũ với `GOOGLE_CALENDAR_REFRESH_TOKEN` vẫn hoạt động khi luồng OAuth trực tiếp chưa được cấu hình.
