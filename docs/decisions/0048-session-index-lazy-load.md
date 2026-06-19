# ADR 0048 — Session index + lazy-load messages

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-19
- **Liên quan:** [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md) (JSONL là source of truth), [ADR 0047](0047-auto-compact-context.md)

## Bối cảnh

Session lưu event-sourced trong `~/.awog/sessions/<id>.jsonl`, fold-on-load. Trước thay đổi này:

- `sessions.list` (RPC) trả **toàn bộ `Session[]` kèm mọi `messages[]`**.
- UI [`hydrateFromSidecar`](../../apps/desktop/ui/stores/sessions.ts) nạp **tất cả session + tất cả message** vào RAM **một lần lúc khởi động**, normalize từng step/part.

Đo thực tế: **62 file, ~930 MB** bị fold + bê qua IPC + giữ trong RAM mỗi lần mở app — dù người dùng chỉ xem 1 session. Chi phí nằm ở 3 tầng: sidecar fold mọi file → IPC payload → UI memory + normalize. Một file đơn lẻ từng phình tới 1.2 GB (đã xử lý ở fix O(n²) persist) còn làm `readFile` vỡ và session biến mất khỏi list.

## Quyết định

Tách **list metadata** khỏi **transcript**:

1. **`SessionSummary`** (mới, trong `types/shared.ts`) — bản nhẹ KHÔNG có `messages`: `id, title, projectId, createdAt, updatedAt, pinned, invitedAgentIds, pendingAgentIds, settings, disabledTools, mcpServerIds, hasCompaction, messageCount, lastPreview`.

2. **`~/.awog/sessions/index.json`** — **derived cache** chứa `SessionSummary[]`.
   - Ghi **atomic** (temp + rename) dưới một hàng đợi flush toàn cục.
   - Mất/hỏng/parse-fail → **rebuild** bằng cách fold toàn bộ file một lần rồi ghi lại (migration-free, crash-safe). KHÔNG rebuild mỗi lần khởi động — chỉ khi thiếu.
   - Cập nhật **incremental** tại chokepoint `appendEvent`:
     - `session.created` → summary đầy đủ (count = messages.length).
     - `session.metadata.updated` → patch title/projectId/settings/pinned + updatedAt.
     - `message.appended` → updatedAt + lastPreview + `messageCount += 1` (post-fix mỗi message append là id mới duy nhất — partial dùng `message.progress`, không phải `message.appended`).
     - `session.truncated` / `session.compacted` → re-fold đúng 1 file để refresh count (event hiếm).
     - `session.deleted` → bỏ entry.
     - `message.progress` → **bỏ qua** (chỉ là delta crash-recovery; final `message.appended` mới chạm index → tránh ghi index mỗi 1.2s khi streaming).

3. **RPC**:
   - `sessions.list` → trả `SessionSummary[]` (đọc index, KB thay vì ~930 MB).
   - `sessions.get(id)` → **mới**, fold đúng 1 file, trả full `Session`.
   - `sessions.search` → giữ nguyên: fold tất cả qua `listFullSessions()` (on-demand khi user search, không phải đường startup).

4. **UI**:
   - `hydrate` map summary → object dạng `Session` với `messages: []` + `messageCount`; cờ `messagesLoaded[id]`.
   - `selectSession` → `ensureSessionMessages(id)`: nếu chưa load và không đang stream → `sessions.get`, **merge messages vào chính object cũ** (không thay `this.sessions[i]`), set loaded. **Guard**: không đè session đang có turn in-flight (giữ invariant hydrate-once ở `hydrateFromSidecar`).
   - Badge count: `ses.messages.length || ses.messageCount` (mở → live; chưa mở → từ summary).
   - Filter tức thời ở sidebar: title-first (+ full-text cho session đã load); full-text toàn bộ vẫn qua `sessions.search` palette.

## Hệ quả

**Tích cực**
- Startup: từ ~930 MB → vài chục KB (đọc 1 file index). Mở 1 session = fold 1 file.
- Cross-session scan theo message id (branch/regenerate/rewind/resend) **vẫn đúng**: message thao tác luôn ở session đang mở (đã load); session chưa load có `messages: []` nên `.some()` chỉ trả false — không cần RPC `getSessionByMessageId`.

**Đánh đổi**
- Index là cache → có thể lệch nhẹ sau crash giữa append và flush (chỉ metadata list; mở session luôn đọc file thật nên transcript luôn đúng). Tự lành ở lần mutate kế. `create`/`delete` flush đồng bộ để bền.
- Filter tức thời ở sidebar chỉ full-text với session đã load; phần còn lại title-only → dùng search palette cho full-text.
- Legacy log (partial→final cùng id message.appended) đếm sai nếu incremental; nhưng đường **rebuild** (fold) đếm `messages.length` chính xác nên session cũ vào index đúng ngay lần đầu.

## Phương án loại bỏ
- **`index.jsonl` append-only**: đúng pattern event-sourced nhưng tự phình + cần compaction — ngược với mục tiêu vừa fix bloat.
- **Giữ contract cũ, chỉ cache fold ở sidecar**: vô nghĩa — payload IPC vẫn toàn bộ messages.
