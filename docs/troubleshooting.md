# Xử lý sự cố

| Hiện tượng | Kiểm tra |
| --- | --- |
| Mac không có cổng USB serial mới | Thử cáp truyền dữ liệu và cổng USB khác. Xem USB trong System Information để nhận dạng chip USB–UART của board trước khi chọn driver. |
| Cổng bận hoặc upload đứng ở `Connecting...` | Đóng monitor, xác nhận đúng cổng `/dev/cu.*`, rồi thử BOOT/EN theo [hướng dẫn macOS](setup-macos.md). |
| TFT không lên hoặc chỉ trắng | Ngắt USB. Kiểm tra module, J1, VCC/GND, LED và dây CS/DC/RST/MOSI/SCK theo [bảng chân](hardware.md). Dùng smoke test để kiểm tra landscape, chữ và màu. |
| Mở được `/api/status` nhưng dashboard lỗi hoặc trống | Build và nạp LittleFS cùng phiên bản firmware. Dùng IP mở lại trang và kiểm tra Network trong trình duyệt để xác định asset lỗi. |
| Setup AP không xuất hiện hoặc ESP32 không vào Wi-Fi | Đọc hướng dẫn trên TFT. Kiểm tra tên mạng 2,4 GHz, mật khẩu và vùng phủ sóng. Chờ cửa sổ kết nối lại kết thúc trước khi tìm AP. |
| `.local` không mở | Thử HTTP với IP in trên TFT hoặc serial. Kiểm tra cùng LAN và chế độ cô lập client trên guest Wi-Fi. |
| Clock chờ đồng bộ hoặc GitHub báo lỗi TLS | Kiểm tra ESP32 ra được Internet và NTP hoạt động. Kiểm tra thời gian đúng và chuỗi chứng chỉ hợp lệ cho hostname proxy. |
| GitHub báo Demo | Lưu username và URL HTTPS đầy đủ tới endpoint proxy. |
| GitHub báo lỗi dù proxy trả lời trên Mac | Kiểm tra URL dashboard, trạng thái NTP, chứng chỉ, khả năng truy cập từ mạng thiết bị và HTTP status. Với 429, đợi hết `Retry-After` nếu có. |
| Ký tự có dấu hiển thị sai | Thử tin nhắn ASCII. Dùng kiểm tra tiếng Việt trên TFT riêng nếu firmware bổ sung font phù hợp. |
