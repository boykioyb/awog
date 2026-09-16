---
description: Dựng kế hoạch dọn dẹp từ các phát hiện lãng phí — LƯU thành playbook, không chạy
argument-hint: "tên kế hoạch (để trống = tự đặt theo vùng)"
---

# /aws-cleanup — biến phát hiện lãng phí thành kế hoạch

Trình tự bắt buộc:

1. Nếu **chưa** có kết quả `infra_waste_scan` trong lượt này thì chạy nó trước (mặc định 5 phép
   miễn phí).
2. **Hỏi người dùng chọn khoản nào.** Không tự chọn hộ — đây là thứ sẽ sinh ra lệnh ghi.
3. Gọi `infra_cleanup_plan` với đúng các phát hiện họ đồng ý, tên lấy từ `$ARGUMENTS`
   (để trống thì tự đặt theo vùng).

Sau khi lưu, nói rõ với người dùng:

- Kế hoạch **chỉ là một file**, chưa có gì chạy và chưa có gì trên AWS đổi.
- Chỉ **ba loại** phát hiện sinh ra lệnh kèm đường lùi: dừng máy · đặt hạn lưu log · trả EIP rỗi.
- Bốn loại còn lại (xoá volume · snapshot · load balancer · NAT) chỉ được **ghi nhận** để họ tự
  quyết, vì thao tác xoá của chúng không hoàn tác được.
- Muốn chạy thì mở **AWS → Thay đổi → Kế hoạch**; nó còn phải qua preflight → gửi duyệt → bấm chạy.

Bạn **không** chạy được kế hoạch, và đừng hứa là chạy được.
