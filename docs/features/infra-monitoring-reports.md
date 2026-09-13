# Feature — Giám sát (biểu đồ · cảnh báo) và Báo cáo

- **Trạng thái:** Planned — chưa code
- **ADR:** [0088](../decisions/0088-session-infra-context.md) · **Route:** `/infra` → **Giám sát**, **Báo cáo**
- **Anh em:** [cloudwatch-logs.md](cloudwatch-logs.md) (log — chuyện gì xảy ra) · [infra-audit-log.md](infra-audit-log.md) (ai làm gì) · [infra-topology-graph.md](infra-topology-graph.md) (sơ đồ)

## Vì sao tách khỏi Logs

Nhật ký nói *chuyện gì đã xảy ra*; số liệu nói *bao nhiêu và từ lúc nào*. Hai câu hỏi khác nhau, hai cách đọc khác nhau — nhưng **cùng một trục thời gian**: kéo chọn khoảng trên biểu đồ rồi mở Logs thì đã lọc sẵn đúng khoảng đó, và ngược lại.

## Màn Giám sát

| Vùng | Nội dung |
|---|---|
| **Dải cảnh báo** | Mọi alarm của ngữ cảnh: `▲ ĐANG BÁO` · `✓ bình thường` · `– thiếu dữ liệu`. Luôn có **biểu tượng + chữ**, không bao giờ chỉ màu. "Thiếu dữ liệu" là trạng thái riêng, **không phải** "ổn" |
| **Ô số** | Sẵn sàng 30 ngày · p95 hiện tại · lỗi 1 giờ · chi phí tháng. Mỗi ô kèm mốc so sánh ("bình thường 0,38 s") — số trần trụi không nói lên điều gì |
| **Lưới biểu đồ** | Lượt gọi · tỉ lệ lỗi · độ trễ p50/p95/p99 · CPU-RAM. Dải sự cố tô cùng một màu trên **cả bốn** khung |
| **Câu hỏi gợi ý** | *"Vì sao p99 vọt lúc 10:32?"* · *"So với tuần trước?"* · *"Tạo báo cáo sự cố"* |

Nguồn: `cloudwatch get-metric-data` (gọi theo lô, rẻ hơn gọi lẻ), `describe-alarms`, `describe-alarm-history`.

### Luật vẽ biểu đồ — áp cho mọi biểu đồ trong app

1. **Không bao giờ hai trục y.** Lượt gọi và tỉ lệ lỗi là hai thang đo khác nhau; ghép vào một khung là cách dễ nhất để đọc sai tương quan. Tách thành hai khung, dùng chung trục thời gian, và **tô cùng một dải cho khoảng sự cố** — mắt tự nối được.
2. **Dữ liệu có thứ tự dùng một màu đậm dần.** p50/p95/p99 là thang bậc, không phải ba hạng mục rời ⇒ một hue ba bậc, không phải ba màu.
3. **Hạng mục rời dùng màu đã kiểm tra tách bạch với người mù màu**, và **ghi nhãn thẳng ở cuối đường** để danh tính không phụ thuộc màu (CPU/RAM: ΔE 18–21, đã chạy qua bộ kiểm).
4. **Màu trạng thái là của riêng trạng thái** — đỏ/vàng/xanh không bao giờ bị mượn làm "series thứ tư".
5. Nét mảnh (2px), lưới mờ, nhãn trục nêu đúng giá trị mà biểu đồ chạm tới, và **có lớp hover** (đường dóng + tooltip) vì biểu đồ trong app là thứ tương tác được.
6. **Không thêm thư viện biểu đồ** — vẽ SVG, như histogram của màn Logs. Thêm dep lớn cần ADR riêng.

### Tạo cảnh báo từ chính biểu đồ

Kéo một ngưỡng trên khung đang xem → `put-metric-alarm` (lệnh **ghi**, qua ma trận quyền). Không bắt người dùng mở màn khác rồi gõ lại tên metric.

### Bảng điều khiển tự lắp

Ghim biểu đồ vào một bảng riêng, lưu 2 tier như workflow (`~/.awog/dashboards/<id>.json` + per-project). Ba bảng mẫu dựng sẵn: **Website**, **API**, **Chi phí**.

## Màn Báo cáo

Bốn loại, cùng một khuôn: agent đọc số liệu thật → viết văn bản **có kết luận** → kèm biểu đồ.

| Báo cáo | Nội dung | Nhịp |
|---|---|---|
| **Chi phí tháng** | Theo dịch vụ, so tháng trước, ba khoản tăng mạnh nhất **và vì sao** | ngày 1 hằng tháng |
| **Sức khoẻ tuần** | Sẵn sàng, lỗi, cảnh báo đã kích hoạt, số lần triển khai, việc còn treo | 9:00 thứ hai |
| **Hoạt động** | Từ nhật ký: ai chạy gì, bao nhiêu lệnh tự động, bao nhiêu lệnh bị chặn | khi bấm |
| **Sự cố** | Dòng thời gian ghép nhật ký hành động + log + biểu đồ, kèm nguyên nhân và việc cần làm | khi bấm |

**Không cơ chế mới:** báo cáo định kỳ = **lịch chạy đã có** ([ADR 0082](../decisions/0082-scheduled-runs.md)) + một câu lệnh cho agent + lưu kết quả thành trang **[Wiki](wiki.md)** (có lịch sử, tìm lại được, và LLM đọc lại được). Xuất thêm PDF/HTML, gửi vào chat.

### Vì sao báo cáo của AWOG khác

Báo cáo là chỗ **ba nguồn gặp nhau**: số liệu (biểu đồ) · nhật ký hành động (ai làm gì) · log ứng dụng (chuyện gì xảy ra). Chỉ AWOG giữ đủ cả ba, nên viết được câu *"phần tăng 18 USD đến từ lần scale checkout lúc 10:32 ngày 12/9"* — công cụ chỉ có một nguồn thì không.

Hai luật giữ cho báo cáo không thành ảnh chụp chết:

- **Mỗi con số bấm được**, nhảy về đúng nguồn: một điểm trên biểu đồ, một dòng nhật ký, hay một query log đã lọc sẵn.
- **Sơ đồ đi kèm**: báo cáo sự cố nhúng graph kiến trúc có tô đường request + sơ đồ chuỗi các hop, xuất Mermaid nên trang Wiki hiển thị được luôn.

## Lộ trình

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **M1** | `MetricChart` (SVG: đường · vùng · cột · lưới · nhãn trục · hover) + `get-metric-data` theo lô + cache | L |
| **M2** | Màn Giám sát: dải cảnh báo · ô số · lưới 4 biểu đồ · đồng bộ khoảng thời gian với Logs | M |
| **M3** | Tạo/sửa cảnh báo từ biểu đồ · lịch sử alarm | M |
| **M4** | Bảng điều khiển tự lắp + 3 mẫu dựng sẵn | M |
| **M5** | Báo cáo: 4 loại · lưu Wiki · gửi chat · xuất PDF | M |
| **M6** | Đặt lịch báo cáo qua lịch chạy có sẵn · báo cáo sự cố ghép ba nguồn | M |

Phụ thuộc: P0 ([ngữ cảnh](session-infra-context.md)) và N1 ([nhật ký](infra-audit-log.md)) cho báo cáo Hoạt động/Sự cố.

## Bảo mật & chi phí

- `get-metric-data` tính theo **số metric × số điểm**; nạp theo lô, cache, **không tự làm mới**.
- Báo cáo lưu vào Wiki là **dữ liệu sẽ vào context của LLM** ⇒ đi qua [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) trước khi ghi.
- `put-metric-alarm` là lệnh **ghi** ⇒ qua ma trận quyền + vào nhật ký.
