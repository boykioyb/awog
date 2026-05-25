# Nguyên tắc thiết kế

Các nguyên tắc định hướng cho UX và visual design của AWOG.

## 1. Workflow-first, không phải Chat-first

Bề mặt UI chính là workflow canvas và artifact view — không phải chat panel. Chat chỉ tồn tại bên trong agent session khi debug.

## 2. Pipeline phải nhìn thấy được

Người dùng luôn phải biết *công việc đang ở đâu*: node nào đang chạy, node nào đang chờ approval, node nào fail. Không có trạng thái ẩn.

## 3. Artifact là công dân hạng nhất

Mọi artifact đều có viewer riêng kèm diff, history và provenance (agent nào, task nào, bước nào).

## 4. Checkpoint con người phải nổi bật

Approval gate phải ngắt dòng workflow một cách trực quan. Người dùng là *guild master*, không phải người quan sát thụ động.

## 5. Progressive Disclosure

View mặc định gọn. Chi tiết cho power-user (trace event, token usage, raw prompt) cách một cú click, không nằm trên canvas chính.

## 6. Thẩm mỹ local-first

Cảm giác như một desktop tool — nhanh, mượt, không spinner cho thao tác đọc. Ẩn dụ filesystem (folder, file, diff) thay vì ẩn dụ cloud (workspace, project).

## 7. Sửa được ở mọi nơi

Mọi thứ hệ thống sinh ra (agent, skill, workflow, artifact) đều có thể edit tại chỗ. Không có nội dung "system" chỉ-đọc.

## 8. Thân thiện bàn phím

Người dùng nặng tay nên drive được ứng dụng bằng bàn phím: command palette, hotkey cho hành động phổ biến, không bắt buộc dùng chuột.
