# Auto-compact ngữ cảnh Session

> Quyết định kiến trúc: [ADR 0047](../decisions/0047-auto-compact-context.md). Liên quan: [ADR 0023](../decisions/0023-sdk-session-resume-and-compact.md) (`/compact` gốc), [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) (Pi runtime).

## Mục tiêu

Khi một Session dài tới mức **sắp đầy context window**, tự động **tóm tắt các lượt cũ** để giải phóng token — tương tự Claude Code — mà **vẫn giữ nguyên lịch sử hội thoại hiển thị**. Đồng thời sửa `/compact` thủ công để nó **thực sự cắt context** (trước đây chỉ ghi 1 dòng thông báo, context không đổi).

## Hành vi

### Tự động (auto-compact)
- Mặc định **BẬT**. Tắt ở **Settings → Sessions → "Tự động tóm tắt ngữ cảnh"**.
- Trước mỗi tin nhắn mới, nếu `used > limit − 16384` (đệm 16k, mirror `DEFAULT_COMPACTION_SETTINGS.reserveTokens` của Pi) → tự compact rồi mới chạy lượt. `used` là context occupancy thật của lượt gần nhất (input + cache-read + cache-write + output); `limit` lấy theo **`session.settings.modelId`** (model người dùng chọn) — KHÔNG theo `modelUsed` do provider trả về, vì biến thể 1M `claude-opus-4-8-1m` được map về id base `claude-opus-4-8` khi gọi API, sẽ làm `limit` tụt 1M → 200k sau lượt đầu.
- Ngưỡng = "ngay khi sắp đầy". Không chờ literal 100% vì lượt đẩy lên 100% có thể tràn trước khi kịp tóm tắt.

### Thủ công (`/compact`)
- Gõ `/compact` trong composer (hoặc qua `/` picker).
- Hiện **running spinner + nút Stop như một lượt bình thường** trong lúc tóm tắt; bấm Stop hủy được.
- **Aggressive**: gửi `keepRecentTokens: 0` → chỉ giữ **lượt cuối**, tóm tắt phần còn lại — nên nó **hoạt động kể cả trên cuộc trò chuyện ngắn** (khác auto giữ 20k). Cuộc chỉ có 1 lượt → không có gì để tóm tắt → hiện notice.
- Xong → một **marker tóm tắt** xuất hiện; có **notice** dưới composer (compacted / nothing / unavailable / error).

### Sau khi compact
- Tin nhắn cũ **vẫn hiển thị bình thường** (không ẩn, không làm mờ).
- Một **marker** (`SessionCompactionMarker`) chèn ngay trước message đầu tiên còn được giữ: "Đã tóm tắt N tin nhắn trước đó…", bấm để xem/ẩn nội dung tóm tắt.
- **Model** chỉ nhận: `summary (trong system prompt)` + các message **từ mốc cắt trở đi** + tin mới.

## Cơ chế (data flow)

1. **Cut point** — `runtime/compaction.ts#computeCutPoint`: duyệt từ cuối giữ ~`keepRecentTokens` lượt gần nhất (auto 20k; manual 0 = chỉ giữ lượt cuối), snap mốc về biên user-message (ưu tiên user ở/au sau mốc, fallback lùi về user trước mốc), trả `null` nếu không có gì để tóm tắt (chống loop).
2. **Summary** — `runtime/run-stream.ts#runCompact`: tóm tắt prefix thô `messages[0..cut)` bằng Pi `generateSummary` (reserve 16k); trả checkpoint `{ summary, firstKeptMessageId, tokensBefore }`. Skip khi mốc trùng checkpoint cũ.
3. **Persist** — `sessions.compact` RPC → `store.compactSession` ghi event `session.compacted`; `fold` set `Session.compaction` (KHÔNG đụng `messages`).
4. **Cắt context** — `runtime/context-builder.ts#buildContext`: khi có `compaction`, chỉ replay từ `firstKeptMessageId`, inject `summary` vào system prompt (`## Summary of earlier conversation`).
5. **Forward** — `sessions.sendMessage` nhận `compaction` (UI gửi kèm `history`, cùng trust model) → lượt thường chạy trên context đã cắt.

## File chính

| Lớp | File | Vai trò |
|---|---|---|
| Sidecar | `runtime/compaction.ts` | `computeCutPoint` (mốc cắt + prefix tóm tắt) |
| Sidecar | `runtime/run-stream.ts` | `runCompact` trả checkpoint; truyền `compaction` vào `buildContext` |
| Sidecar | `runtime/context-builder.ts` | `historyToAgentMessages` (export dùng chung) + cắt context theo checkpoint |
| Sidecar | `sessions/store.ts` | event `session.compacted` + `fold` + `compactSession()` |
| Sidecar | `methods/sessions.compact.ts` | RPC abortable (`messageId` + `registerAborter`), persist, trả `compaction` |
| Sidecar | `methods/sessions.send-message.ts` | nhận + forward `compaction` |
| Sidecar/UI | `types/shared.ts` · `types/index.ts` | `SessionCompaction` + `Session.compaction` |
| UI | `utils/context-window.ts` | `contextUsage` + `shouldAutoCompact` (ngưỡng dùng chung) |
| UI | `stores/sessions.ts` | auto-trigger trong `sendMessage`; `compactSession` running-state |
| UI | `components/session/SessionCompactionMarker.vue` | marker tóm tắt |
| UI | `components/session/SessionMessageList.vue` | chèn marker trước mốc cắt |
| UI | `stores/settings.ts` · `composables/useSettingsSync.ts` | toggle `autoCompact` (persist) |
| UI | `components/settings/SettingsSessionsSection.vue` | UI toggle |

## Giới hạn

- Chỉ áp cho **Sessions** (interactive). Tasks/headless không auto-compact.
- Một lượt đơn lẻ quá lớn (paste khổng lồ) vẫn có thể tràn → error path cũ + retry.
- Chỉ giữ **checkpoint mới nhất**; compact lần sau tóm tắt lại toàn bộ prefix (token nhiều hơn nhưng chính xác hơn).
