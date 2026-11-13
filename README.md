# Smart Desk Display

Smart Desk Display dùng ESP32 DevKit V1 và màn hình TFT ILI9341 2,8 inch để hiển thị đóng góp GitHub, đồng hồ Việt Nam, thống kê lập trình, bộ đếm Pomodoro hoặc tin nhắn. Dashboard chạy trên ESP32 và điều khiển màn hình qua mạng Wi-Fi nội bộ.

- [Nối dây và xác nhận J1 trước khi cấp điện](docs/hardware.md)
- [Build, nạp firmware và LittleFS, thiết lập Wi-Fi trên macOS](docs/setup-macos.md)
- [Kết nối dữ liệu GitHub qua proxy HTTPS](docs/github.md)
- [Checklist nghiệm thu và lệnh kiểm tra](docs/acceptance.md)
- [Xử lý sự cố](docs/troubleshooting.md)

`firmware/` chứa ứng dụng ESP32, `web/` chứa dashboard tĩnh, `github-proxy/` chứa proxy GitHub GraphQL tùy chọn và `verification/` chứa bộ kiểm thử tích hợp từ máy Mac. [Handoff tích hợp](docs/coordination/integration.md) ghi kết quả theo thiết bị thật, dịch vụ thật và fixture.
