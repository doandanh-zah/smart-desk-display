# GitHub proxy cho Smart Desk Display

Vercel Function tại `GET /api/contributions?username=octocat` gọi GitHub GraphQL và trả lịch UTC gồm 52 tuần, streak, tổng đóng góp và số repo public do tài khoản sở hữu nếu có. Xem [hợp đồng v1](../docs/coordination/github-contract.md) để biết định dạng JSON và mã lỗi. [Schema GitHub GraphQL](https://docs.github.com/en/graphql/reference/users)

## Kiểm thử local

Từ thư mục gốc repo, dùng Node.js 22 và chạy:

```sh
source .dev/env.sh
npm --prefix github-proxy test
```

Test dùng fixture GraphQL và gọi handler với đối tượng `Request` thật. Token trong test là giá trị giả. Có thể kiểm tra thêm URL của một proxy đang chạy bằng `python3 verification/check_http.py proxy "https://example.vercel.app/api/contributions" --username octocat` từ thư mục gốc.

## Cấu hình triển khai tùy chọn

1. Import repo vào Vercel, đặt **Root Directory** thành `github-proxy`, chọn **Framework Preset** là **Other** và dùng Node.js 22. Vercel nhận route trong `api/`. [Vercel Node.js Runtime](https://vercel.com/docs/functions/runtimes/node-js)
2. Thêm `GITHUB_TOKEN` trong Environment Variables cho môi trường sẽ triển khai. Dùng token của một tài khoản chuyên dụng chỉ có quyền đọc dữ liệu công khai. Kết quả được chia sẻ qua endpoint, vì vậy tài khoản cấp token cần không có quyền xem nội dung riêng tư. Mẫu biến nằm ở [`.env.example`](.env.example).
3. Sau khi deploy, kiểm tra endpoint qua HTTPS với tên tài khoản thực. Điền tên GitHub và URL đầy đủ vào dashboard ESP32, ví dụ `https://example.vercel.app/api/contributions`. ESP32 cần Wi-Fi, thời gian đã đồng bộ và chứng chỉ hợp lệ có chuỗi tin cậy tới GTS Root R1 hoặc ISRG Root X1. Tại lần rollout ngày 13/11/2026, alias mặc định `*.vercel.app` dùng GTS Root R1. [TLS trên Vercel](https://vercel.com/docs/domains/working-with-ssl) · [GTS Root R1](https://pki.goog/repo/certs/gtsr1.pem) · [Chuỗi chứng chỉ Let's Encrypt](https://letsencrypt.org/certificates/)

Proxy gộp truy vấn đồng thời cho cùng tên đăng nhập và dùng cache theo instance tối đa 5 phút, giới hạn 128 mục. Vercel CDN có TTL tương ứng trên phản hồi thành công. Hai lớp cache hết hạn chậm nhất lúc 00:00 UTC. Khi GitHub giới hạn truy vấn, proxy trả HTTP 429 và `Retry-After`, rồi tạm dừng truy vấn mới trên instance đó. Endpoint public chấp nhận tên GitHub tùy ý, nên hạn mức GitHub được dùng chung. [Vercel CDN cache headers](https://vercel.com/docs/caching/cache-control-headers) · [GitHub GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)
