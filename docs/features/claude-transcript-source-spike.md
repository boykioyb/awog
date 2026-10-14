# Spike: đọc transcript Claude persist làm session store — kết quả replay

- **Ngày:** 2026-10-11
- **ADR liên quan:** [0097 — Claude transcript as session source](../decisions/0097-claude-transcript-source-spike.md)
- **Input:** `/Users/kyro/.claude/projects/-Users-kyro-KyroTech-Projects-awog/acfc1ae5-d692-4d08-aee9-286f5ab3eeb2.jsonl` (6,713 dòng — session AWOG thật)
- **SDK:** `@anthropic-ai/claude-agent-sdk@0.3.296` (đã bump từ 0.3.280 — tsc sidecar pass, không breaking type)

## Method

Đọc từng dòng JSONL → phân loại theo `type` → gọi `createClaudeEventAdapter().handle(msg)` cho các type adapter hiểu (`assistant`, `user`, `result`, `stream_event`, `system`, `prompt_suggestion`); đếm bỏ qua phần còn lại.

## Kết quả đo

| Metric | Giá trị |
|---|---|
| Tổng dòng | 6,713 |
| Adapter xử lý được (`handled`) | **3,942 (59%)** |
| Bỏ qua (`skipped`) | **2,771 (41%)** |
| Steps emit được | 2,460 (toàn `tool`) |
| `chunkLen` (text assistant) | **0** ❌ |
| `contextTokens` cuối | 308,157 ✓ |
| `compact_boundary` | 2 |

## Phân rã phần bị skip

| `type` | Số lượng | Nội dung | Có cần cho replay không |
|---|---|---|---|
| `attachment` | 1,336 | File/tool result đính kèm của message | ⚠️ một phần — step `detail` UI cần |
| `last-prompt` | 321 | Snapshot prompt mỗi turn | Không — metadata |
| `custom-title` | 313 | Session title CLI tự ghi | Có — title AWOG có thể đọc đây |
| `atis-latch` | 311 | Auto-title latch state | Không |
| `mode` | 292 | Permission mode / plan mode switches | ⚠️ nếu AWOG lưu mode per turn |
| `queue-operation` | 198 | Hàng đợi nội bộ CLI | Không |

## Phân rã content bên trong assistant messages

| Block type | Số |
|---|---|
| `tool_use` | 1,222 |
| `thinking` | 602 |
| `text` | 556 |

## Phát hiện chính — 4 gap replay phải vá

### Gap 1 — KHÔNG có `stream_event` trong transcript persist

Transcript CLI ghi **assistant message đầy đủ** (content blocks hoàn chỉnh), không có delta stream. Adapter hiện bỏ qua text block trong nhánh `assistant` với comment "text is streamed via stream_event… ignored here to avoid double-counting" → **`chunkLen = 0`**.

**Fix:** replay-mode flag trong adapter — khi replay, emit `onChunk` từ `assistant.message.content[].text` (dedupe qua `uuid` hoặc chỉ cho phép một nguồn text: stream hoặc persisted, không cả hai). Ước lượng: ~15 dòng.

### Gap 2 — KHÔNG có `result` message ⇒ usage/stopReason trống

`result` chỉ tồn tại trên stream, transcript persist không ghi. Vì vậy `inputTokens`/`stopReason`/`modelUsed` rỗng — nhưng **`contextTokens`/`baseTokens` vẫn derive được** từ `assistant.message.usage` (đã đo: 308k/91k — đúng thứ gauge cần).

**Fix:** usage/session stats lấy từ dòng `assistant` cuối (`usage` + `modelUsage` nếu có) — không cần `result`. `stopReason` suy từ turn cuối (có `tool_result` chưa resolve ⇒ đang chạy / `stop_hook` ⇒ done).

### Gap 3 — `thinking` blocks bị bỏ qua

Transcript có 602 `thinking` blocks nhưng nhánh `assistant` chỉ emit `tool_use` — thinking render từ `thinking_delta` stream. Replay thiếu reasoning.

**Fix:** replay-mode emit `stepFromThinking` từ `thinking` block (đã có `text` đầy đủ — không cần delta).

### Gap 4 — `attachment` content cho step `detail`

1336 `attachment` frames mang nội dung file/tool result — adapter hiện lấy `content` từ `tool_result` block trong `user` message. Cần map `attachment` → step tương ứng nếu `tool_result.content` thiếu chi tiết.

## Kết luận

| Câu hỏi spike | Trả lời |
|---|---|
| Replay có ra transcript render được không? | **Có — sau khi vá Gap 1+3.** Steps tool đã đủ (2,460), chỉ thiếu text + thinking |
| Cost replay ~1000 entries | 0.3s cho 6,713 dòng ⇒ **~50ms/1000 lines** — chấp nhận được, có thể cache |
| Phần KHÔNG derive được | `bookmarks`, `todos` hiện tại (state AWOG), `aboutTaskId`, `budget`, `pinnedContext` — giữ trong index file |
| Format drift | Transcript schema đã ổn (type/subtype/message/uuid rõ ràng); rủi ro thấp nhưng vẫn cần fixture test |

**Khuyến nghị:** ADR 0097 khả thi. **Đã thực hiện** (2026-10-11): thay vì vá adapter replay-mode, replay đi qua `parseClaudeTranscript` trong leaf mới `sessions/claude-transcript.ts` (Gap 1+3 vá trực tiếp — text/thinking blocks fold nguyên vẹn, usage gồm `contextTokens`/`baseTokens` từ usage của từng request); pointer-mode cắt ở `send-message` sau coverage gate `sdkTranscriptCoversSession`.
