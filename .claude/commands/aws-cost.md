---
description: Chi phí AWS tháng này — đã tiêu, dự báo cuối tháng, dịch vụ tăng nhiều nhất
argument-hint: "(để trống) | mới (bỏ cache, trả tiền cho 3 request nữa)"
---

# /aws-cost — tháng này tốn bao nhiêu

Gọi `infra_cost_summary` rồi trả lời bằng **tiếng Việt**.

⚠ **Lượt này tốn tiền**: mỗi lần nạp là **3 request Cost Explorer × $0.01**. Kết quả được cache
hết ngày, nên gọi lần hai trong cùng ngày là **miễn phí**.

`$ARGUMENTS` chứa `mới` / `fresh` / `force` ⇒ truyền `force: true` (bỏ cache, trả tiền lần nữa).
Để trống ⇒ **không** truyền `force`.

Sau khi có số:

1. Nói **đã tiêu bao nhiêu** và **dự báo cuối tháng** (dự báo do AWS tính, không phải AWOG suy ra —
   nói rõ điều đó nếu người dùng hỏi nó ở đâu ra).
2. So với tháng trước: tăng hay giảm, bao nhiêu.
3. Chỉ ra **dịch vụ tăng nhiều nhất** và đoán nguyên nhân **chỉ khi** có căn cứ; không có thì nói
   là chưa biết và gợi ý `/aws-waste` hoặc xem Logs.
4. Nói lượt vừa rồi tốn bao nhiêu (`estimatedUsd`), hoặc rằng nó lấy từ cache.

KHÔNG tự gọi thêm `infra_waste_scan` — đó là một lượt tốn tiền khác, hỏi người dùng trước.
