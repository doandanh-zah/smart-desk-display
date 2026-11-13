# Smart Desk Display · Remote Admin

Dashboard dùng browser → Vercel và ESP32 → Vercel. ESP32 chỉ kết nối ra ngoài và tiếp tục cung cấp bảng điều khiển LAN khi cloud gián đoạn. Xem [hợp đồng API](../docs/coordination/remote-admin-contract.md).

## Thiết lập production

1. Chấp nhận điều khoản Upstash Marketplace trong workspace Vercel. Liên kết một Redis riêng gói Free với **Production**, tắt auto-upgrade và Prod Pack. Backend nhận `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` hoặc `KV_REST_API_URL` / `KV_REST_API_TOKEN` do Marketplace gắn. [Upstash Redis pricing](https://upstash.com/pricing/redis)
2. Từ gốc repo, nạp `.dev/env.sh` rồi chạy `node remote-admin/scripts/password-hash.mjs --copy` trong Terminal macOS. Nhập hai lần PIN đúng 6 chữ số ASCII (kể cả số 0 đầu) hoặc mật khẩu dài ít nhất 14 ký tự, tối đa 256 byte, khi Terminal ẩn nhập liệu. Dán hash vừa sao chép vào `ADMIN_PASSWORD_HASH` kiểu **Sensitive** cho **Production** trong [Vercel Environment Variables](https://vercel.com/lilzahs-projects/smart-desk-remote-admin/settings/environment-variables). Xóa clipboard sau khi dán. Giữ mật khẩu trong trình quản lý mật khẩu cá nhân.
3. Đặt `DEVICE_TOKEN_SHA256` cho Production. Origin canonical cố định là `https://desk.thezah.space`. Hash token là SHA-256 của token 32 byte biểu diễn bằng 64 ký tự hex ASCII thường, băm nguyên chuỗi ASCII không có newline. Token thiết bị đi qua USB theo quy trình session phần cứng.
4. Deploy từ staging đã link với project riêng. Thiếu cấu hình thì origin canonical khóa ứng dụng và trả 503. Alias GET/HEAD chuyển sang origin canonical. POST trên alias trả 403.

```sh
source .dev/env.sh
node remote-admin/scripts/stage.mjs .dev/remote-rollout/smart-desk-remote-admin
npx --yes vercel@65.15.0 deploy --cwd .dev/remote-rollout/smart-desk-remote-admin --scope lilzahs-projects --prod --yes --non-interactive
```

## Kiểm thử

```sh
source .dev/env.sh
npm --prefix remote-admin run build
REDIS_SERVER=/path/on/ssd/redis-server REDIS_CLI=/path/on/ssd/redis-cli npm --prefix remote-admin test
```

Bộ test chạy Redis thật qua Unix socket local và kiểm tra giao thức HTTP của backend. Fixture dùng credential ngẫu nhiên mỗi lần chạy.
