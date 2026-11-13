# Phần cứng và nối dây

Dùng ESP32 DevKit V1 30 chân (ESP-WROOM-32) và TFT LCDWiki MSP2806 2,8 inch với ILI9341. Firmware dùng SPI phần cứng, xoay landscape bằng rotation 1, kích thước 320 × 240.

| Chân TFT | Chân ESP32 | Chức năng |
| --- | --- | --- |
| VCC | 5V / VIN | Nguồn TFT, chỉ dùng 5 V sau khi xác nhận J1 hở và regulator hoạt động |
| GND | GND | Mass chung |
| CS | GPIO27 | Chọn LCD |
| RESET / RST | GPIO25 | Reset LCD |
| DC / RS | GPIO26 | Chọn dữ liệu hoặc lệnh |
| SDI / MOSI | GPIO23 | Dữ liệu SPI |
| SCK / CLK | GPIO18 | Xung SPI |
| LED | 3V3 | Bật đèn nền cố định |

Để hở SDO/MISO, T_CLK, T_CS, T_DIN, T_DO và T_IRQ. MISO trong firmware là `-1`. GPIO27 dành riêng cho CS. Chân LED nối thẳng 3V3 nên đèn nền luôn bật khi có nguồn.

## Trước khi cấp nguồn

- Rút USB-C trước khi kiểm tra hay đổi dây. Đối chiếu tên chân in trên cả hai board và xác nhận thứ tự VCC/GND tại đầu cắm.
- Nhận dạng module và đối chiếu J1 trên mặt sau. Chỉ nối VCC với 5V/VIN khi đã xác nhận regulator 3,3 V trên module nằm trong mạch và J1 hở. Nếu J1 đã hàn cầu, ngắt VCC khỏi 5 V. Với module tương thích, đối chiếu sơ đồ đúng revision trước khi áp dụng wiring này. [Tài liệu LCDWiki](https://www.lcdwiki.com/2.8inch_SPI_Module_ILI9341_SKU%3AMSP2807), [Sơ đồ nguồn và J1](https://www.lcdwiki.com/res/MSP2807/MSP2807-2.8-SPI.pdf)
- Dùng GPIO logic 3,3 V cho tín hiệu SPI, reset và chọn LCD. Kiểm tra GND chung, các dây tín hiệu cắm chắc và chân LED vào 3V3.
- Cấp nguồn từ một cáp USB-C 5 V cho ESP32. Kiểm tra màu và chữ bằng firmware smoke test, sau đó xem splash và màn hình thiết lập của firmware tích hợp. Đèn nền sáng chỉ xác nhận phần đèn nền đang có điện.
