# Độ trễ ESP32 · bàn giao 02 → 03/05/06

## Baseline 1.2.0 đang chạy

| Phép đo | n | p50 | p95 |
| --- | ---: | ---: | ---: |
| LAN POST lại mode hiện tại | 20 | 45,6 ms | 53,5 ms |
| LAN POST và GET status khớp | 20 | 85,8 ms | 94,8 ms |
| Khoảng cách heartbeat cloud từ log có giai đoạn chuyển deploy | 9 | 22,2 s | 84,3 s |

LAN gửi POST trực tiếp tới ESP32, áp dụng và trả kết quả trong cùng request. 20 lần đo giữ nguyên mode/startup và chỉ đo HTTP, không đo browser paint hay pixel TFT. Phiên 06 đo độc lập 12 POST đổi mode, p50/p95 37/101 ms và khôi phục mode gốc. Log `.dev/logs/firmware-latency-baseline.log` và `.dev/logs/integration-latency-lan-baseline.log`.

Ở cloud, browser POST → 202 queued → ESP32 nhận khi sync → áp dụng và ghi ACK → gửi ACK ở sync kế → browser nhận trạng thái terminal và cập nhật UI. Bản 1.2.0 đợi 20 s sau khi hoàn tất mỗi sync thường, thêm khoảng 1 s trước sync ACK và browser cũ đọc kết quả mỗi 1,8 s. Khoảng cách heartbeat xác nhận có phần chờ lớn trong đường cloud. Chưa có phiên admin để đo từng chặng cloud production.

## Policy theo contract 05 và nghiệm thu

- Firmware gửi `pollHints:true` khi sync. Server trả 60 s khi idle, 3 s khi dashboard có lease; hint thiếu, sai kiểu hoặc ngoài danh sách quay về 20 s. Nếu backend cũ trả HTTP 400 cho field mới, firmware bỏ flag 5 phút rồi thử lại. Lease server tối đa 120 s, tổng tối đa 30 phút mỗi ngày UTC. Chặn cục bộ 600 khoảng 3 s trong cửa sổ 24 giờ theo uptime, sau đó dùng 60 s. ACK mới vẫn gửi sau 1 s. Lỗi vẫn backoff 20–300 s. Remote vẫn nhường GitHub và dùng ngưỡng heap hiện có.
- Trong 31 ngày, tối đa danh nghĩa 44.640 sync ở 60 s và khoảng 17.670 lượt tăng thêm nếu dùng đủ 30 phút nhanh mỗi ngày. Chưa tính thời gian HTTPS, ACK, integrations và thao tác browser. Số lượt sync không phải tổng command Redis vì Lua chạy lệnh nội bộ. 05/06 đối chiếu Usage ở Upstash. [Upstash Free](https://upstash.com/pricing/redis) · [Upstash Insights](https://upstash.com/docs/redis/howto/insights)
- Khi dashboard vừa mở, lệnh đầu vẫn có thể chờ kỳ idle 60 s đã lên lịch (20 s với backend cũ). Đo cold riêng. Sau khi dashboard ở foreground và heartbeat 3 s đã quan sát được, mục tiêu đo LAN POST+GET p95 <250 ms và cloud POST→UI warm p50 ≤5 s / p95 ≤9 s. Thu ít nhất 20 mẫu mỗi nhóm theo tải thực, kiểm không mất ACK. Ghi client send/202, `queuedAtMs`, `deliveredAtMs`, `acknowledgedAtMs`, lúc UI hiện kết quả và mode đọc lại ở LAN. `deliveredAtMs` đo lúc server phát lệnh; ACK và LAN readback xác nhận ESP32 áp dụng. Kiểm tra khi ẩn tab, khi GitHub refresh, khi cloud offline, và không đổi countdown trong lần đo mode.
- Hạ tải bằng cách cho backend ngừng phát hint 3000. Server tiếp tục gửi 60000 để giữ idle 60 s, hoặc bỏ hint để về nhịp tương thích 20 s. Có thể giữ firmware 1.2.1 khi quay về gateway 1.2.0, vì hint và trường quota mới đều tùy chọn. Nếu cần khôi phục firmware, dùng ảnh 1.2.0 đã kiểm trong handoff hardware và giữ NVS/LittleFS tương ứng theo session 01.

## Build bàn giao 06

- Build `PLATFORMIO_BUILD_DIR="$SMART_DESK_DEV/firmware-poll-hints" pio run -d firmware -j 3` trên SSD sau khi nạp `.dev/env.sh`. RAM tĩnh 54.412 byte (16,6%), flash 1.172.693 byte (55,9%). SHA-256 của `.dev/firmware-poll-hints/esp32doit-devkit-v1/firmware.bin` là `51daa0002615f994ec06231fe2dd90e4da439fe3110048979e2bbf45db423cca`.
- UBSan pass cho hint 3 s / 60 s / fallback 20 s, ACK 1 s, budget, rollover và hồi quy quota/countdown. Fixture chạy serializer và `tick()` thật, mô phỏng HTTP 400 từ schema cũ, xác nhận backoff và request kế không gửi flag. Payload thật qua backend validator đạt. Log `.dev/logs/firmware-poll-hints-{build,host,wire}.log`.
- Firmware giữ version 1.2.1. 06 chốt SHA tích hợp rồi build và hash lại firmware/LittleFS trước khi 01 nạp. Chưa có kết quả flash hoặc latency cloud mới.
