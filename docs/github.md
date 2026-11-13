# Kết nối dữ liệu GitHub thật

Để trống GitHub username hoặc Proxy URL trong dashboard để dùng chế độ Demo có nhãn. Clock, Pomodoro và Custom Message hoạt động độc lập với proxy.

1. Tạo token GitHub dành cho proxy với quyền tối thiểu cần thiết để truy vấn dữ liệu công khai. Proxy dùng token để gọi GitHub GraphQL. [GitHub GraphQL — xác thực](https://docs.github.com/en/graphql/guides/forming-calls-with-graphql#authenticating-with-graphql)
2. Đặt project root của Vercel là `github-proxy/`. Thêm `GITHUB_TOKEN` vào Environment Variables của môi trường deploy, rồi deploy hoặc redeploy. Khi chạy cục bộ, dùng tên biến trong `github-proxy/.env.example` và quy trình trong [README của proxy](../github-proxy/README.md). Chỉ lưu giá trị token ở môi trường server. [Vercel — Environment Variables](https://vercel.com/docs/environment-variables), [Vercel — triển khai bằng CLI](https://vercel.com/docs/projects/deploy-from-cli)
3. Kiểm tra endpoint HTTPS trước khi đưa vào dashboard. Ví dụ, thay hostname bằng địa chỉ proxy của bạn và `octocat` bằng username cần kiểm tra:

   ```sh
   python3 verification/check_http.py proxy https://example.vercel.app/api/contributions --username octocat
   ```

4. Trong Settings nhập GitHub username và URL đầy đủ như `https://example.vercel.app/api/contributions`, không thêm query hoặc fragment, rồi lưu. ESP32 cần đồng bộ thời gian để xác thực chứng chỉ TLS. Dùng endpoint HTTPS mà ESP32 có thể gọi trực tiếp và có chuỗi chứng chỉ về ISRG Root X1, root CA có trong firmware. Kiểm tra chuỗi cho chính hostname triển khai. [Vercel — chuỗi tin cậy Let’s Encrypt](https://vercel.com/changelog/upcoming-change-in-lets-encrypt-chain-of-trust)
5. Chọn GitHub Contributions và kiểm tra username, heatmap, tổng đóng góp, streak và thời điểm đồng bộ thật. Mở Developer Stats để đối chiếu. Số repository chỉ hiện khi có dữ liệu.

Lưới gồm 52 cột tuần, mỗi tuần bắt đầu Chủ nhật theo UTC. Tổng là số đóng góp trong khoảng ngày hiển thị đến ngày truy vấn. Streak đếm ngày liên tiếp có đóng góp từ hôm nay, hoặc từ hôm qua nếu hôm nay chưa có đóng góp. ESP32 làm mới dữ liệu mỗi 20 phút. Khi fetch lỗi sau lần đồng bộ thành công, kiểm tra nhãn dữ liệu cũ và dấu thời gian của lần đồng bộ trước. [GitHub GraphQL — ContributionsCollection](https://docs.github.com/en/graphql/reference/users#contributionscollection)
