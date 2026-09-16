---
description: Ai vừa đổi gì trên tài khoản AWS — ghép CloudTrail với sổ của chính AWOG
argument-hint: "(để trống = 24 giờ) | 7d | <id tài nguyên>"
---

# /aws-changes — tài khoản vừa bị đổi gì

Hai sổ, hai câu hỏi khác nhau — đọc cả hai rồi đối chiếu:

- `infra_audit_query` — **AWOG đã chạy gì** (file cục bộ, miễn phí).
- `infra_trail_lookup` — **tài khoản bị đổi bởi cái gì**, kể cả Console, pipeline hay người khác
  (một lời gọi AWS; CloudTrail chỉ giữ 90 ngày).

`$ARGUMENTS` có dạng `7d` / `48h` ⇒ đổi khoảng thời gian. Có dạng một id tài nguyên
(`i-…`, `vol-…`, tên bucket…) ⇒ truyền `resourceName` để chỉ xem lịch sử của đúng nó.

Khi trình bày bằng **tiếng Việt**:

1. Tách rõ **từ AWOG** và **từ nơi khác**. Phần "nơi khác" là phần đáng chú ý.
2. Nói thẳng rằng nhãn đó là **suy đoán** — ghép theo tên thao tác + thời gian, hai sổ không có id
   chung. Nó là dấu hiệu mạnh, không phải bằng chứng.
3. Nêu các sự kiện **hỏng** (`errorCode`) nếu có — chúng thường là dấu hiệu thiếu quyền.
4. Không thấy gì thì nói rõ là **trong khoảng đó**, kèm nhắc trần 90 ngày của CloudTrail.
