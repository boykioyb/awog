# 0047 — Auto-compact ngữ cảnh Session (checkpoint summary, reuse Pi primitives)

- **Trạng thái:** Accepted (đính chính cách đo occupancy 2026-06-29 — xem note cuối)
- **Ngày:** 2026-06-18
- **Người quyết định:** User (chốt 2 lựa chọn UX) + Tech Lead
- **Liên quan:** sửa lỗi `/compact` của [ADR 0023](./0023-sdk-session-resume-and-compact.md); giải quyết TODO "ADR 0029 C1" trong [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md)

> **Đính chính (2026-06-29) — cách đo `used`/occupancy:** ADR này (mục Quyết định, dưới) tính `used` từ API usage (input + cacheRead + cacheWrite + output). **Sai.** Theo Anthropic: prompt size = input + cacheRead + cacheWrite (cacheRead/Write chỉ là phần cached của CHÍNH nội dung prompt, không phải occupancy thêm); `output` là response, không thuộc input window. Cách đó làm gauge phồng > 100% và sinh bucket ảo "Other (cache + overhead)". **Occupancy ĐÚNG = tổng nội dung đã assemble** (`contextChars` ÷4) — như Claude Code `/context`. ui-next nay dùng `contextTokensFromChars` (`utils/context-window.ts`) cho cả widget % lẫn trigger (`usagePct` latch 85%/re-arm 70%, post-turn). Chi tiết hành vi: [docs/features/auto-compact.md](../features/auto-compact.md).

## Bối cảnh

`/compact` trong AWOG **không thực sự giảm context** và **không có auto-compact**:

1. `sessions.compact` gọi `runStream(slashCommand:'compact')` rồi **vứt bỏ summary trả về**, chỉ ghi 1 breadcrumb `system`. JSONL giữ nguyên → `fold` rebuild đủ → `buildContext` tạo lại full context. Người dùng chỉ thấy dòng "── Context compacted… ──" còn context y nguyên.
2. `buildContext` **bỏ qua role `system`** → summary lưu dạng `system` vô hình với model.
3. Không có ngưỡng nào tự trigger khi context sắp đầy.

Tham chiếu **craft-agents-oss** (cùng chạy Pi SDK): họ dựa vào auto-compaction **native** của Pi (session tree) + persist checkpoint `{ summary, firstKeptEntryId, tokensBefore }`, giữ recent messages theo `keepRecentTokens`.

AWOG **không dùng được** `compact()`/`prepareCompaction()`/`findCutPoint()` của Pi vì chúng thao tác trên `SessionTreeEntry[]` (Pi session tree) — AWOG cố ý **rebuild context từ JSONL mỗi lượt** (ADR 0029), không giữ session tree. Nhưng Pi 0.79.1 export sẵn các **primitive** dùng được trên `AgentMessage[]`: `shouldCompact`, `estimateContextTokens`, `calculateContextTokens`, `generateSummary`, `DEFAULT_COMPACTION_SETTINGS = { enabled, reserveTokens: 16384, keepRecentTokens: 20000 }`.

## Quyết định

### Mô hình checkpoint (mirror Pi `CompactionResult`)
Thêm `Session.compaction = { summary, firstKeptMessageId, tokensBefore, at }` (chỉ giữ checkpoint **mới nhất** — lần sau bao trùm lần trước) + SessionEvent `session.compacted` (event-sourced, append-only). `fold` set field, **KHÔNG đụng `messages`**: transcript đầy đủ vẫn còn để UI hiển thị; chỉ context gửi model bị cắt.

### Cắt context ở `buildContext`, KHÔNG fold ẩn tin (user chốt)
Khi có checkpoint, `buildContext` chỉ replay messages **từ `firstKeptMessageId` trở đi**; summary được inject vào **system prompt** (section `## Summary of earlier conversation`) thay vì là một message replay — giữ message list **user-first + so le đúng**, tránh synthetic assistant đầu chuỗi. Tin cũ phía trên **vẫn hiển thị bình thường (không làm mờ)** + 1 marker `SessionCompactionMarker` chèn ngay trước message đầu được giữ.

### Re-summarise từ raw transcript (KISS)
JSONL là nguồn sự thật (ADR 0029) → mỗi lần compact **tóm tắt lại prefix thô** `messages[0..cut)` bằng `generateSummary`, không chuỗi summary-of-summary. `computeCutPoint` (mới, `runtime/compaction.ts`) giữ ~`keepRecentTokens` lượt gần nhất, snap mốc về biên **user-message**; trả `null` khi không có gì để tóm tắt (chống loop re-compact). `runCompact` skip khi `firstKeptMessageId` không đổi so với checkpoint cũ.

### Auto-compact "khi sắp đầy" (user nói "đạt 100%")
Trigger ở UI store `sendMessage` trước khi gửi lượt mới: `shouldAutoCompact(session) = used > limit − 16384` (reserve 16k = `DEFAULT_COMPACTION_SETTINGS.reserveTokens`, mirror Pi). **Literal 100% sẽ tràn trước khi kịp tóm tắt** → dùng reserve 16k là hiện thực an toàn của ý "đạt 100%" (giống Claude Code, ~92% trên cửa sổ 200k). Có toggle Settings → Sessions `autoCompact` (default **ON**), persist qua `useSettingsSync`. `used`/`limit` lấy từ util chung `contextUsage` (tách từ `SessionContextStatus.vue`) nên widget % và trigger không lệch nhau.

### `/compact` chạy với running-state như turn thường (user yêu cầu)
`compactSession` dùng đúng máy móc của `sendMessage`: placeholder agent bubble + `pendingAgentIds` + `activeMessageBySession` → spinner + nút **Stop**; `sessions.compact` nhận `messageId`, `registerAborter` + truyền `abortController` nên Stop hủy được giữa chừng. Xong → gỡ placeholder, set `session.compaction` (marker hiện), KHÔNG tạo reply bubble. Bỏ hẳn breadcrumb `system` cũ.

## Hệ quả

- **Tích cực:** `/compact` cắt context thật; summary hiện rõ (marker) + có running/Stop; auto-compact giống Claude Code; restart-safe (checkpoint trong JSONL); tái dùng primitive Pi (không tự chế ngưỡng).
- **Đánh đổi:** re-summarise prefix thô tốn token hơn chuỗi summary (chấp nhận, chính xác hơn, KISS). Một lượt đơn lẻ quá lớn (paste khổng lồ) vẫn có thể tràn → rơi về error path cũ. Trigger ở UI (sessions là interactive-only) — headless/Tasks không auto-compact (out-of-scope).
- **Bảo toàn invariant:** không phá `step.textOffset ↔ message.text` (không đụng steps/parts của message hiện hữu); summary không chứa secret (qua generateSummary, không leak key).

## Phương án đã cân nhắc

- **Dùng Pi native auto-compaction (như craft):** loại — đòi giữ Pi session tree, mâu thuẫn rebuild-from-JSONL của ADR 0029.
- **Fold ẩn tin cũ (Claude Code style):** loại — user muốn giữ transcript đầy đủ, chỉ cắt context model.
- **Inject summary thành message replay:** loại — gây lệch so le user/assistant; system-prompt section an toàn hơn.
- **Trigger ở sidecar `send-message`:** cân nhắc — nhưng phải resolve lại contextWindow + nhân đôi logic estimate; UI đã có sẵn `contextUsage`, sessions là interactive nên trigger UI đủ và gọn.
