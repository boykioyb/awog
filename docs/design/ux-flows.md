# UX Flows

Các hành trình người dùng chính qua AWOG. Mỗi flow mô tả mục tiêu, các bước, và màn hình liên quan.

## Flow 1: Tạo một Agent

**Mục tiêu:** Thiết lập một agent chuyên biệt mới.

1. Click **Agents → New**.
2. Điền name, role, description.
3. Chọn model (Claude Opus, Sonnet, GPT-5, …).
4. Viết hoặc dán system prompt.
5. Chọn skill để cấp quyền.
6. Chọn context provider để whitelist.
7. Save → agent xuất hiện trong danh sách.

## Flow 2: Dựng một Workflow

**Mục tiêu:** Lắp ráp pipeline đa agent.

1. Click **Workflows → New**.
2. Kéo các agent node lên canvas.
3. Gán skill cho từng node.
4. Nối output với input.
5. Chèn approval gate ở chỗ cần review.
6. Validate (engine highlight input chưa nối / type mismatch).
7. Save → workflow được version.

## Flow 3: Chạy một Task

**Mục tiêu:** Thực thi workflow với input cụ thể.

1. Click **Tasks → New**.
2. Chọn workflow.
3. Cung cấp input ban đầu (ví dụ requirement text, link GitHub issue).
4. Click **Run**.
5. Theo dõi tiến độ task ở trace view.
6. Task dừng ở approval gate — người dùng review artifact và approve/reject.
7. Task hoàn tất; artifact sinh ra có trong artifact explorer.

## Flow 4: Review và Approve Artifact

**Mục tiêu:** Cung cấp giám sát của con người tại một checkpoint.

1. Notification: *"Task #12 đang chờ approval"*.
2. Mở task → thấy artifact đã render (ví dụ `architecture.md`).
3. Xem diff so với phiên bản trước (nếu có).
4. Chọn:
   - **Approve** → workflow tiếp tục
   - **Request Changes** → comment + gửi lại agent trước đó
   - **Reject** → dừng nhánh
   - **Rerun** → chạy lại với cùng input

## Flow 5: Inspect hành vi của Agent

**Mục tiêu:** Debug vì sao agent tạo ra output đó.

1. Mở tab **Trace** của task.
2. Mở rộng event của agent liên quan.
3. Khoan sâu vào một tool call để xem input/output.
4. Khoan sâu vào context retrieval để xem đã lấy tri thức gì.
5. Xem raw prompt và response (view dành cho power-user).
