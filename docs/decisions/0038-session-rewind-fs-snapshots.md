# 0038 — Rewind cho Session bằng filesystem snapshot

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-15
- **Người quyết định:** tech-lead (đề xuất của user)

## Bối cảnh

Session đã có **fork** ([branchFromMessage](../../apps/desktop/ui/stores/sessions.ts)) nhưng chỉ copy hội thoại sang session mới — **không** đụng tới file workspace. Người dùng muốn "Rewind to here": quay về một message trước đó và khôi phục **cả hội thoại lẫn trạng thái file** ở thời điểm đó (giống `/rewind` của Claude Code), tại chỗ trong session hiện tại.

Ràng buộc đặc thù AWOG:

- **Session KHÔNG auto-commit git** — git auto-commit là hành vi của **Tasks**, không phải Sessions (xem memory dự án). Vì vậy không thể dựa vào lịch sử git để khôi phục file.
- `session.projectId` có thể **null** → session không gắn project ⇒ không có workspace ⇒ không có file để khôi phục (rewind khi đó chỉ là cắt hội thoại).
- Invariant bảo mật #2: mọi I/O filesystem phải `assertInsideWorkspace`.

## Quyết định

Thêm **per-turn filesystem snapshot** dạng **content-addressed** cho Session:

1. **Capture:** cuối mỗi assistant turn (`sessions.sendMessage`, khi có `cwd`), chụp trạng thái workspace, key theo **assistant message id**. Lưu ở `~/.awog/sessions/<sessionId>/snapshots/`:
   - `blobs/<sha256>` — nội dung file, **dedup** giữa các turn (như git).
   - `<messageId>.json` — manifest `{ at, files: [{ path, sha, size }], partial }`.
   - Capture **fire-and-forget**, `void` (không chặn finalize), và **không bao giờ throw**.
2. **Selection file:** capture và restore dùng **cùng** logic chọn file — `git ls-files` (tôn trọng `.gitignore`) khi là repo, ngược lại BFS walk bỏ `SKIP_DIRS` + symlink. Nhờ vậy restore chỉ đụng đúng tập file mà snapshot có thể đã chụp; `node_modules`/build output/gitignored **không bao giờ** bị xóa.
3. **Restore (Rewind):** RPC `sessions.rewind` làm 2 việc:
   - **Hội thoại:** `truncateSession(sessionId, keepThroughId=messageId)` — event `session.truncated` (xem dưới).
   - **File:** `restoreSnapshot` — ghi lại các file trong manifest từ blobs + **xóa** các in-scope file tạo ra sau snapshot.
4. **Truncate primitive dùng chung:** thêm event `session.truncated { keepThroughId }` vào JSONL fold (event-sourced, giữ append-only). Dùng chung cho Rewind **và** edit/resend/regenerate (ADR-feature #5).
5. **Caps + pruning:** bỏ qua snapshot nếu > 5000 file hoặc > 64MB (KHÔNG snapshot một phần — sẽ làm restore xóa nhầm file chưa chụp); bỏ qua file > 4MB (đánh dấu `partial`). Giữ **20 snapshot gần nhất** mỗi session + GC blob không còn tham chiếu.

UI: nút **Rewind** trên mỗi assistant message → confirm inline. Text confirm khác nhau tùy có snapshot hay không (`sessions.listSnapshots` nạp tập message-id có snapshot để UI biết). Restore xong, file watcher (chokidar) tự refresh các tab Diff/Files.

## Phương án đã cân nhắc

- **Git-based (commit-per-turn + `git reset --hard`)** — tái dùng hạ tầng git nhưng **yêu cầu project có `.git`**, làm bẩn lịch sử commit, và vô dụng với session `projectId=null`. Từ chối.
- **Chỉ hội thoại (truncate, không restore file)** — đơn giản nhất nhưng mất giá trị "flagship" mà user muốn. Giữ lại làm **fallback tự nhiên** khi không có workspace/snapshot.
- **Snapshot full-copy mỗi turn (không content-addressed)** — đơn giản nhưng tốn đĩa tuyến tính theo số turn. Content-addressed dedup giải quyết bloat mà vẫn O(1) phần lớn turn.

## Hệ quả

- **Tích cực:** Rewind khôi phục cả hội thoại + file, chạy được **không cần git**; dedup blob tiết kiệm đĩa; primitive `truncate` tái dùng cho edit/resend/regenerate; capture không bao giờ làm hỏng turn.
- **Tiêu cực / Trade-off:** capture quét toàn workspace mỗi turn (đọc + hash) — chấp nhận với repo local cỡ vừa, có caps chặn worst-case; snapshot bị bỏ qua khi vượt cap ⇒ rewind turn đó chỉ cắt hội thoại; dir rỗng sau khi xóa file không được dọn (v1).
- **Việc cần làm tiếp:** (a) infosec review cho `restoreSnapshot` (xóa/ghi file theo manifest); (b) ~~cân nhắc capture incremental (chỉ file đổi) nếu repo lớn chậm~~ — **Đã làm:** cache `(size, mtime) → sha` kiểu git-index + short-circuit khi workspace không đổi (turn chat-only không đọc/hash lại file nào); in-memory per-session, racy-clean caveat như git; (c) hiển thị badge "snapshot" / số file trên message; (d) dọn empty dirs sau restore.

## Tham chiếu

- [ADR 0032 — session message parts](0032-session-message-parts-model.md) (truncate giữ nguyên parts/steps theo message)
- [Feature spec: session-upgrades](../features/session-upgrades.md)
- Memory dự án: "Git auto-commit thuộc Tasks, không phải Sessions"
- Claude Code `/rewind` (tham chiếu UX)
