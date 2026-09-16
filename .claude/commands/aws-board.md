---
description: Dựng một bảng điều khiển CloudWatch trong AWOG từ mô tả bằng lời
argument-hint: "mô tả bảng, ví dụ: độ trễ và lỗi 5XX của ALB web-prod"
---

# /aws-board — dựng một bảng điều khiển

Từ mô tả trong `$ARGUMENTS`, dựng một bảng bằng `infra_dashboard_create`.

Trước khi tạo:

1. Gọi `infra_dashboard_list` — có bảng gần giống rồi thì **nói ra** và hỏi người dùng muốn sửa bảng
   đó hay thêm bảng mới. Đừng đẻ thêm một bản gần trùng.
2. Mô tả quá mơ hồ để chọn metric ⇒ **hỏi lại**, đừng đoán namespace.

Khi dựng:

- **Khoá chuỗi phải duy nhất trên toàn bảng**, không chỉ trong một biểu đồ.
- Cùng một nhóm phân vị (p50/p95/p99) thì dùng **cùng hue, khác `shade`** — bậc đậm nhạt là thứ
  người đọc dùng để xếp chúng.
- `unit` chỉ là **nhãn hiển thị**, không phải bộ lọc.

Sau khi lưu, nhắc rằng bảng **chưa nạp số liệu**: mở **AWS → Sức khoẻ → Bảng điều khiển** rồi bấm
**Nạp**, và mỗi lượt nạp là một lô metric **tính tiền** — nên đó là quyết định của họ.
