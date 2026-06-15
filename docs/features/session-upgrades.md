# Session Upgrades — Auto-title, Edit/Regenerate, Search, Rewind

Bốn nâng cấp cho Session, làm cùng đợt. Hạ tầng dùng chung: **truncate primitive**.

| # | Tính năng | Trạng thái |
|---|---|---|
| 2 | AI auto-title sau turn đầu | Done |
| 3 | Rewind (hội thoại + file snapshot) — [ADR 0038](../decisions/0038-session-rewind-fs-snapshots.md) | Done |
| 4 | Cross-session full-text search (Cmd+K) | Done |
| 5 | Edit & resend / Regenerate / Retry-with-model | Done |
| 6 | Unread badge khi reply xong lúc không xem | Done |

## Hạ tầng dùng chung: truncate

Event-sourced JSONL có thêm event `session.truncated { keepThroughId }`:

- Fold: giữ message tới **và gồm** `keepThroughId`, bỏ phần sau; `null` ⇒ rỗng; id không tìm thấy ⇒ no-op (không bao giờ xóa nhầm cả transcript).
- Sidecar: `truncateSession(sessionId, keepThroughId)` ([store.ts](../../apps/desktop/sidecar/src/sessions/store.ts)) + RPC `sessions.truncate`.
- UI store: `truncateAfter(messageId)` + helper `resendUserTurn(userMessageId, overrideText?)`.

Dùng bởi **#5** (edit/regenerate) và **#3** (phần hội thoại của rewind).

## #2 — AI auto-title

- Giữ title "thô" (60 ký tự đầu của message đầu) để có phản hồi tức thì khi đang stream.
- Sau **turn đầu tiên** hoàn tất (`isFirstUserTurn`), store gọi `sessions.generateTitle` (fire-and-forget) → `renameSession`.
- Sidecar `sessions.generateTitle`: `completePi` (one-shot, no tools). Model rẻ theo provider (`anthropic → claude-haiku-4-5`), fallback model của session nếu lỗi (custom endpoint / id không hợp lệ). Best-effort: lỗi ⇒ giữ title thô.
- Prompt = first user + first agent (cắt 4000 ký tự), output chuẩn hoá: 1 dòng, bỏ quote bao + dấu câu cuối, cap 60.

## #4 — Cross-session search (Cmd+K)

- Sidecar `sessions.search { query, limit? }`: fold mọi JSONL (qua `listSessions`, đã sort theo recency), tìm substring case-insensitive trong `message.text`, trả 1 kết quả / message khớp + snippet (window 40 trước / 80 sau). Cap 50.
- UI: [SessionSearchPalette.vue](../../apps/desktop/ui/components/session/SessionSearchPalette.vue) overlay, mở bằng **Cmd/Ctrl+K** (đăng ký ở [layouts/default.vue](../../apps/desktop/ui/layouts/default.vue)). Debounce 220ms + stale-token guard. Phím ↑↓ chọn, ↵ mở, esc đóng.
- Chọn kết quả → `openSearchResult(sessionId, messageId)` (select session + set `pendingScrollMessageId`) + `navigateTo('/sessions')`. [SessionMessageList](../../apps/desktop/ui/components/session/SessionMessageList.vue) watch `pendingScrollMessageId` → scroll tới `[data-message-id]` + nháy outline accent.
- **Lưu ý hiệu năng:** chưa có index, fold mọi JSONL mỗi lần search — chấp nhận với số session local; tối ưu sau bằng cache snapshot.

## #5 — Edit / Regenerate / Retry-with-model

Tất cả qua `resendUserTurn` (truncate về trước user message rồi `sendMessage` lại, mang theo attachments):

- **Edit (user message):** [SessionMessageItem](../../apps/desktop/ui/components/session/SessionMessageItem.vue) — nút Pencil mở textarea inline (seed từ `bodyText` = body đã strip phần quote). Lưu → `editAndResend(messageId, newText)`. Quote follow-up được **giữ lại**: `resendUserTurn` re-serialize quote gốc lên body mới (`composeOutgoingMessage`) cho model + truyền lại `followUps` để render card. ⌘/Ctrl+Enter lưu, Esc huỷ.
- **Regenerate (agent message):** nút RefreshCw → `regenerate(agentMessageId)` (đi ngược tìm user message gần nhất, resend cùng text + model).
- **Retry-with-model:** [MessageRetryMenu.vue](../../apps/desktop/ui/components/session/MessageRetryMenu.vue) — dropdown model (composable dùng chung [useSessionModels.ts](../../apps/desktop/ui/composables/useSessionModels.ts), mirror SessionChipsPopover) → `retryWithModel(agentMessageId, modelId)` = đổi model + regenerate. Chỉ liệt kê model hợp lệ cho provider/account hiện tại.
- Mọi nút **ẩn khi `sessionStreaming`**; `resendUserTurn` cũng guard `pendingAgentIds`.

## #6 — Unread badge

Khi một reply **chạy xong** mà người dùng **không đang xem** session đó → đánh dấu unread.

- Store: `unread: Record<id, true>`, getter `unreadCount` / `isUnread`, cờ `sessionsViewActive`.
- **Mark unread** ở cuối turn thành công (sendMessage), trừ khi đang xem: `sessionsViewActive && selectedSessionId === sessionId && !document.hidden`.
- **Clear** khi: `selectSession(id)` (mở session), `setSessionsViewActive(true)` (vào /sessions → clear session đang chọn), regain visibility lúc đang ở /sessions, hoặc `deleteSession`.
- **Hiển thị:** dot accent đặc trên row list + bôi đậm title ([pages/sessions/index.vue](../../apps/desktop/ui/pages/sessions/index.vue)); badge số trên tab **Sessions** ([HeaderTabBar](../../apps/desktop/ui/components/HeaderTabBar.vue)) — ưu tiên số unread, nếu không thì chấm pulse streaming.
- Lifecycle: trang /sessions báo active/inactive qua `onActivated`/`onDeactivated` (keep-alive) → reply landing lúc ở tab khác vẫn tính unread. State in-memory (reset sau reload — chủ ý).

## #3 — Rewind (xem [ADR 0038](../decisions/0038-session-rewind-fs-snapshots.md))

- **Capture:** cuối mỗi turn (`sessions.sendMessage`, có `cwd`) → `captureSnapshot(sessionId, messageId, cwd)` content-addressed vào `~/.awog/sessions/<id>/snapshots/`. Fire-and-forget, không throw, caps (5000 file / 64MB / 4MB-per-file), giữ 20 snapshot + GC blob.
- **Rewind:** UI `rewindTo(messageId)` (optimistic truncate local) → RPC `sessions.rewind { sessionId, messageId, projectId? }` = `truncateSession` + `restoreSnapshot` (ghi lại file trong manifest + xóa in-scope file tạo sau).
- **UI:** nút RotateCcw trên assistant message → confirm inline. `sessions.listSnapshots` nạp tập message-id có snapshot (`store.hasSnapshot`) để chọn text confirm (có/không khôi phục file). Session không project ⇒ rewind chỉ cắt hội thoại.
- **Dọn:** `sessions.delete` gọi `deleteSnapshots`.

## RPC mới

| Method | Params | Trả về |
|---|---|---|
| `sessions.truncate` | `{ sessionId, keepThroughId: string\|null }` | `{ ok }` |
| `sessions.generateTitle` | `{ sessionId, provider, modelId, accountId? }` | `{ ok, title? }` |
| `sessions.search` | `{ query, limit? }` | `{ results: SessionSearchResult[], truncated }` |
| `sessions.rewind` | `{ sessionId, messageId, projectId? }` | `{ ok, filesRestored, restored, deleted }` |
| `sessions.listSnapshots` | `{ sessionId }` | `{ messageIds: string[] }` |

## Edge cases / đã xử lý

- Truncate id không tồn tại → no-op (an toàn dữ liệu).
- Snapshot vượt cap → bỏ qua hẳn (không partial) ⇒ rewind turn đó chỉ cắt hội thoại.
- Restore chỉ đụng file in-scope (cùng selection với capture) ⇒ không xóa `node_modules`/gitignored.
- Browser dev (no sidecar): search trả rỗng, rewind/edit chỉ thao tác local.
- AI title lỗi/empty → giữ title thô; không chặn finalize.
