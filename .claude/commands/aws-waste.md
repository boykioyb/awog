---
description: Dò tài nguyên AWS đang đốt tiền mà không ai dùng, kèm ước tính tiền mỗi tháng
argument-hint: "(để trống = 5 phép miễn phí) | đủ (thêm 2 phép đọc metric, TỐN TIỀN)"
---

# /aws-waste — thứ gì đang đốt tiền mà không ai dùng

Gọi `infra_waste_scan` cho **vùng đang ghim**, rồi trả lời bằng **tiếng Việt**.

Mặc định chạy **5 phép miễn phí** (EIP rỗi · EBS không gắn · snapshot cũ · log group không hạn lưu ·
load balancer không đích). `$ARGUMENTS` chứa `đủ` / `all` / `idle` ⇒ thêm `ec2-idle` và `nat-idle`,
**và phải nói trước rằng hai phép đó đọc CloudWatch metric nên TỐN TIỀN**.

Khi trình bày:

1. Tổng số phát hiện và **tổng tiền ước tính mỗi tháng**.
2. Sắp theo tiền giảm dần. Khoản `chưa định giá` để riêng, **không** coi là 0 — bảng giá tĩnh của
   AWOG không có mọi loại máy.
3. Nói rõ con số là **ước lượng theo giá niêm yết us-east-1**, không phải hoá đơn: hợp đồng riêng,
   vùng khác và Savings Plans không thấy được.
4. Phép dò nào **hỏng** thì nêu ra — một phép dò câm làm danh sách trông như đã sạch.

Muốn dọn thì dùng `/aws-cleanup`, đừng tự xoá gì.
