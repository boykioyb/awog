# Auto-compact ngữ cảnh Session

> Quyết định kiến trúc: [ADR 0047](../decisions/0047-auto-compact-context.md). Liên quan: [ADR 0023](../decisions/0023-sdk-session-resume-and-compact.md) (`/compact` gốc), [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) (Pi runtime).

## Mục tiêu

Khi một Session dài tới mức **sắp đầy context window**, tự động **tóm tắt các lượt cũ** để giải phóng token — tương tự Claude Code — mà **vẫn giữ nguyên lịch sử hội thoại hiển thị**. Đồng thời sửa `/compact` thủ công để nó **thực sự cắt context** (trước đây chỉ ghi 1 dòng thông báo, context không đổi).

## Hành vi

### Tự động (auto-compact)
- Mặc định **BẬT**. Tắt ở **Settings → Sessions → "Tự động tóm tắt ngữ cảnh"**.
- Chạy ở **cả 2 mép của một lượt** (SỬA 2026-08-19): **await trước khi gửi** (`sendMessage`, nên checkpoint kịp cắt context của CHÍNH lượt đó) + fire-and-forget **sau khi lượt settle** (để lần gửi sau thường đã sạch). Trước đây chỉ có mép sau ⇒ chỉ phản ứng được sau khi đã tràn.
- Nếu `usagePct(session) ≥ 85%` → tự compact (latch per-session, **re-arm khi tụt < 70%** để lần đầy sau lại compact được). Latch **nhả khi RPC lỗi** (SỬA 2026-08-19): trước đây latch set vô điều kiện, nên một lần fail là dính vĩnh viễn — usage không tự tụt xuống < 70% ⇒ auto-compact tắt hẳn cho session đó tới khi restart app. Kết quả `nothing` (đã compact tới mốc đó / một lượt đơn quá lớn không cắt được) thì **giữ latch** để không đốt round-trip mỗi lần gửi.
- Một lượt đang compact thì lượt mới **đợi** nó xong (`compactInFlight` per engineId) thay vì vượt lên: `sessions.sendMessage` đọc checkpoint từ session đã persist, gửi trước ⇒ chạy trên context chưa cắt. Ca hay gặp: queue drain nổ ngay khi lượt trước settle, đúng lúc mép sau bắt đầu compact.
- Auto gửi **KHÔNG kèm `keepRecentTokens`** ⇒ sidecar dùng default của Pi (giữ 20k gần nhất). Trước 2026-08-19 client hardcode `0` cho cả 2 đường ⇒ auto cũng cắt trụi chỉ còn lượt cuối, lệch với thiết kế. `limit` (mẫu số) lấy theo **`session.settings.modelId`** (model người dùng chọn) — KHÔNG theo `modelUsed` do provider trả về, vì biến thể 1M `claude-opus-4-8-1m` được map về id base `claude-opus-4-8` khi gọi API, sẽ làm `limit` tụt 1M → 200k sau lượt đầu.
- **Đo occupancy (SỬA 2026-09-06 — ĐO THẬT, không ước lượng nữa):** `used` = **`usage.contextTokens`** — kích thước prompt của **request CUỐI** trong lượt (`input + cacheRead + cacheWrite` của **đúng một** request; 3 bucket rời nhau nên tổng của chúng CHÍNH LÀ prompt, `output` vẫn không tính). Engine đo tại nguồn: nhánh Claude SDK đọc `message.usage` trên từng SDK message `assistant` (bỏ qua message có `parent_tool_use_id` — subagent có context riêng), nhánh Pi đọc `usage` của assistant message cuối ở `agent_end`. **KHÔNG** dùng `usage` tổng của lượt: trên nhánh Claude SDK, `result.usage` là TỔNG của mọi request mà vòng lặp agentic đã gọi (một lượt 20 request → tổng gấp ~20 lần cửa sổ), nên nó không trả lời được câu hỏi "cửa sổ đầy bao nhiêu".
  **Vì sao đổi:** cách cũ (tổng `contextChars` ÷ 4) chỉ đếm phần TEXT do AWOG tự assemble. Nó không thấy **schema tool** (built-in của SDK + mọi MCP server đang gắn) và không thấy **kết quả tool** mà vòng lặp tích luỹ trong lượt — trên nhánh Claude SDK còn báo `systemTools`/`mcpTools` = 0 vì chúng nằm trong SDK. Đo trên session thật: breakdown đọc **~28k token** trong khi request thật mang **~138k** ⇒ gauge dừng ở ~14%, **ngưỡng 85% không bao giờ chạm**, auto-compact coi như không tồn tại và phiên chạy ở đúng chỗ đắt nhất của cửa sổ. Helper chung: [`utils/context-window.ts#contextTokensFromUsage`](../../apps/desktop/ui-next/utils/context-window.ts) (đo thật → fallback `contextTokensFromChars` → fallback ước lượng text) — dùng bởi cả widget % ([`useSessionContextUsage`](../../apps/desktop/ui-next/composables/useSessionContextUsage.ts)) và trigger ([`stores/sessions.ts#usagePct`](../../apps/desktop/ui-next/stores/sessions.ts)) nên không lệch nhau.
  **Sau `/compact`:** số đo mô tả context TRƯỚC khi cắt và không tính lại được ở client ⇒ `compactSession` **xoá** `usage.contextTokens`; gauge tạm rơi về ước lượng char cho tới lượt sau (lượt sau đo lại trên context đã cắt).
  **Lưu ý nhánh Pi:** Pi dựng lại context từ JSONL **text-only** mỗi lượt nên kết quả tool KHÔNG bắc qua lượt sau; ở đó `contextTokens` là **đỉnh trong lượt**, không phải điểm xuất phát của lượt kế. Chấp nhận: một lượt chạm đỉnh 85% gần như chắc chắn sẽ chạm lại, và compact vẫn hạ phần nền.
- **Khi CHƯA có breakdown (SỬA 2026-08-19):** trước đây `Session.usage` không được hồi phục lúc mở lại session, nên sau mỗi lần reload/restart panel rơi vào nhánh ước lượng client-side — nhánh này đếm cả `detail` của step (diff / nội dung file / output terminal, thứ **không bao giờ** gửi cho model) ở mức `chars/3 + 60/block` ⇒ đọc một prompt thật ~35k thành **222k / 111%**, còn `usagePct` lại trả **0%** nên auto-compact mù đúng ở trạng thái gauge trông như đầy. Sửa 3 điểm:
  1. `ensureLoaded` hồi phục `Session.usage` từ transcript đã persist (`usageFromMessages`: token + `contextChars` lấy lượt cuối có báo, `cost` cộng dồn) — dữ liệu đã có sẵn trong `sessions.get`, không thêm RPC.
  2. Ước lượng fallback thành **TEXT-ONLY** + `chars/4`, gom về helper dùng chung [`estimateContextTokens`](../../apps/desktop/ui-next/utils/context-window.ts) — khớp đúng thứ 2 runtime replay (`renderHistoryPrefix` / `historyToAgentMessages`).
  3. `usagePct` fallback về **cùng** ước lượng đó thay vì `0` khi thiếu breakdown (transcript cũ persist trước khi có field `usage`).
- **Breakdown panel:** itemize theo CONTENT (System prompt / Instructions / System tools / MCP / Custom agents / Skills / Memory files / Messages) + **Tool + kết quả tool** + **Còn trống** = `max − tổng(buckets)`. Bucket **"Tool + kết quả tool"** (2026-09-06) = `contextTokens đo được − tổng các bucket itemize được`: chính là schema tool + kết quả tool mà breakdown char không nhìn thấy. Nó tồn tại để **row luôn cộng đúng bằng gauge** — không phải bucket ảo "cache + overhead" ngày xưa (thứ đó sinh ra do cộng nhầm cache/output vào occupancy).
- Ngưỡng 85% = "sắp đầy" — không chờ literal 100% vì một lượt đẩy lên 100% có thể tràn trước khi kịp tóm tắt.

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
| UI | `utils/context-window.ts` | `contextTokensFromChars` (occupancy = SUM content, dùng chung widget % + trigger) + `estimateContextTokens` (fallback TEXT-ONLY) + `contextLimitFor` |
| Engine | `runtime/claude-sdk/event-adapter.ts`, `runtime/event-adapter.ts` | đo `contextTokens` = prompt size của request CUỐI (bỏ qua subagent) |
| Engine | `methods/sessions.send-message.ts` | persist `usage.contextTokens` + forward qua RPC |
| UI | `composables/useSessionContextUsage.ts` | breakdown per-category + gauge + bucket "Tool + kết quả tool" |
| UI | `stores/sessions.ts` | `usagePct` (content-based, fallback ước lượng) + `usageFromMessages` (hồi phục usage khi mở session) + `maybeAutoCompact` (latch 85%/re-arm 70%, chạy pre-send + post-turn, latch chỉ giữ khi thành công); `compactSession(id, keepRecentTokens)` RPC |
| UI | `components/settings/SettingsSessions.vue` | toggle `autoCompact` (persist) |

> Bảng trên đã trỏ sang `apps/desktop/ui-next/` (UI hiện hành). `SessionCompactionMarker.vue` chèn marker tóm tắt vẫn theo mô hình cũ.

## Giới hạn

- Chỉ áp cho **Sessions** (interactive). Tasks/headless không auto-compact.
- Một lượt đơn lẻ quá lớn (paste khổng lồ) vẫn có thể tràn → error path cũ + retry.
- Chỉ giữ **checkpoint mới nhất**; compact lần sau tóm tắt lại toàn bộ prefix (token nhiều hơn nhưng chính xác hơn).
