# 0061 — Session UI áp dụng model turn/activity + render pipeline của Craft (parity 1-1)

- **Trạng thái:** Accepted
- **Ngày:** 2026-07-10
- **Người quyết định:** User (chủ dự án) + Tech Lead
- **Liên quan:** Bổ sung/đảo hướng normalize của [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md) + [ADR 0058] (dual runtime) **ở tầng render UI**; dùng [ADR 0032 (parts model)](./0032-session-message-parts-model.md); tham chiếu [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss) `v0.11.0` (clone tại `/Users/kyro/KyroTech/Projects/craft-agents-oss`). Cùng đợt "bám craft làm chuẩn" với [ADR 0060](./0060-connections-adopt-craft-sources-model.md).

## Bối cảnh

User thấy craft-agents-oss render tương tác với Claude "thật / khớp CLI hơn" AWOG, dù cả hai cùng dùng `@anthropic-ai/claude-agent-sdk`. Sau khi map kiến trúc cả hai:

- **Cả hai đều dual-runtime + provider-agnostic** — không phải khác biệt do runtime. Craft `factory` chọn `ClaudeAgent | PiAgent`, cả hai emit **cùng** core `AgentEvent`. AWOG `runner.ts` chọn `runStreamClaude | runStreamPi`, cả hai đổ về `StreamCallbacks{onChunk,onStep}` + `step-mapper`.
- **Khác biệt thật nằm ở 2 điểm:**
  1. **Từ vựng event của Craft giàu & hình-CLI** — `AgentEvent` 21 biến thể gồm `isIntermediate` (text-trước-tool vs câu trả lời cuối), `task_progress{elapsedSeconds}` (đếm giây live/tool), `task_backgrounded`, `usage_update` per-message. Backend map **LÊN** vocabulary này. AWOG normalize **XUỐNG** `SessionStep` generic → mất các sắc thái đó.
  2. **Pipeline render thuần-TS tinh vi** — Craft có reducer `event-processor` → `Message[]` → `groupMessagesByTurn` (turn dẫn xuất lúc render) → **phase state machine** `deriveTurnPhase` + **buffering gate** `shouldShowContent` + **`ProcessingIndicator`** (≈40 từ trạng thái xoay vòng mỗi 10s + đồng hồ elapsed) + **`TurnCard`** (header preview cross-fade + activity list). AWOG chỉ có byline tĩnh "Streaming…/Waiting…" + `SessionCluster` "{n} steps · read N…".

ADR 0029/0058 cố ý normalize mọi runtime về một model step tối thiểu để "UI render giống nhau bất kể runtime". Quyết định đó vẫn đúng ở **tầng runtime/persistence**, nhưng ở **tầng render UI** nó khiến AWOG đánh mất độ trung thực CLI. ADR này bổ sung một tầng render giàu hơn **lên trên** model tối thiểu đó — không thay runtime, không thay persistence.

## Quyết định

Áp dụng **model turn/activity + render pipeline của Craft** vào `ui-next`, làm giàu event ở sidecar ở mức tối thiểu cần thiết, và **GIỮ nguyên** JSONL persistence + dual runtime + `step-mapper`.

### D-1 — Giữ persistence + runtime; port ở tầng render (khác biệt có chủ đích so với "replace tất cả")

**KHÔNG** thay `SessionMessage`/`SessionStep`/`session.jsonl` sang shape `StoredMessage`/`Message[]` của Craft. Lý do: AWOG đã cắm nhiều feature vào model hiện tại (permission gate, AskUserQuestion park, plan mode, steering, todo banner, session↔task link, workspace panel, cost tab, fork/branch, quota guard, confabulation guard, resume-fold JSONL byte-minimal). Thay shape lưu trữ sẽ regress hàng loạt + phá session cũ.

Thay vào đó, `ui-next` **dẫn xuất** một lớp `Turn`/`ActivityItem` (kiểu Craft) từ `AssistantBlock[]`/`SessionMessage` hiện có, lúc render — mirror `groupMessagesByTurn`.

### D-2 — Port pure-TS render logic của Craft near-verbatim

Port sang `apps/desktop/ui-next/utils/session-turns.ts` (framework-agnostic, không phụ thuộc React/Vue): `groupMessagesByTurn`, `deriveTurnPhase`, `shouldShowThinkingIndicator`, `groupActivitiesByParent`, `getPreviewText`, `computeLastChildSet`, `formatDuration/formatTokens` (nguồn: `packages/ui/src/components/chat/turn-utils.ts`). Đây là phần tinh vi nhất — sao chép chính xác để khớp cảm nhận.

**Quy tắc grouping của Craft:** BỎ QUA `turnId` khi gom turn; dùng `isIntermediate` làm ranh giới "còn việc phía sau".

### D-3 — Làm giàu event ở sidecar (event-model touch tối thiểu)

- **`isIntermediate`**: đánh dấu text-run đứng trước một tool_use là intermediate. Claude adapter: `stop_reason === 'tool_use'`. Pi adapter: `stopReason === 'toolUse'`. Persist cờ lên `SessionMessagePart` (text run) — thêm field optional, không phá shape cũ.
- **`elapsedSeconds` per-tool** (phase sau): Claude SDK `tool_progress`/`elapsed_time_seconds` → gắn vào `SessionStep`; Pi = elapsed tổng hợp.
- **`usage_update` per-message** (phase sau): surface context-window live từ usage đã track.

Các field mới đều **optional** trên `types/shared.ts` — session cũ đọc được, không migration.

### D-4 — Dựng lại renderer bằng Vue SFC, màu qua `useTheme()` token

Craft là React; `ui-next` là Vue → **không copy component verbatim**. Port cấu trúc + hành vi, dựng bằng Vue SFC: `SessionTurnCard.vue` (thay nhánh assistant của `SessionMessageItem` + `SessionCluster`), `SessionActivityRow/GroupRow/StatusIcon.vue`, `SessionResponseCard.vue`, `SessionProcessingIndicator.vue`. **Mọi màu đi qua `useTheme()` token** (không hardcode hex), giữ dark/light + font-size scale + rule badge `text-[12px]` của dự án.

### D-5 — Streaming render đổi sang model Craft, giữ typewriter làm fallback

Text assistant: real deltas + **throttle markdown re-render 300ms** (`CONTENT_THROTTLE_MS`) + **buffering gate** (ẩn text ngắn/chưa cấu trúc 500ms–2.5s, `BUFFER_CONFIG`) — thay cách reveal typewriter 16ms/char hiện tại. Giữ typewriter AWOG như tùy chọn (`settings.sessions.typewriter`) để người quen cảm giác cũ không bị mất.

## Hệ quả

**Tích cực:**
- Session chat của AWOG khớp cảm nhận Claude Code / craft: ProcessingIndicator xoay từ + elapsed, turn card preview động, "Thinking…" lấp khoảng chờ, activity nest subagent, streaming chunky-throttle.
- Không đụng runtime/persistence → không regress feature đã cắm, không migration session cũ.
- Pure-TS port (`session-turns.ts`) test được độc lập, tách khỏi Vue.

**Tiêu cực / đánh đổi:**
- Trùng lặp khái niệm: "block" (persist) vs "activity/turn" (render) song song. Chấp nhận theo KISS (một lớp dẫn xuất mỏng) thay vì hợp nhất sớm.
- Cảm giác streaming đổi (typewriter → throttle-block) là thay đổi rõ với người dùng cũ → có toggle.
- Không đạt "1-1 tuyệt đối" ở tầng lưu trữ (cố ý, D-1). Nếu sau này muốn thay luôn persistence → cần ADR riêng + migration.

## Phương án đã cân nhắc

- **Approach B thuần (replace cả persistence sang shape Craft):** trung thực tối đa nhưng regress hàng loạt feature + phá session cũ. **Bác** (D-1).
- **Chỉ thêm ProcessingIndicator, giữ nguyên phần còn lại:** rẻ nhưng không đạt parity turn card / phase / streaming. Thành **Pha 1** của lộ trình, không phải toàn bộ.

## Lộ trình

Chi tiết phân pha (0→7) ở [docs/features/session-craft-parity.md](../features/session-craft-parity.md). Mỗi pha ship + verify độc lập; thứ tự theo ROI giảm dần / rủi ro tăng dần.
