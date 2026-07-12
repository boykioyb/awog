# Feature — Session chat parity 1-1 với craft-agents-oss

- **Trạng thái:** In progress (Pha 0 ✔)
- **ADR:** [0061](../decisions/0061-session-craft-parity-render-model.md)
- **Chuẩn tham chiếu:** craft-agents-oss `v0.11.0` — `/Users/kyro/KyroTech/Projects/craft-agents-oss`

## Mục tiêu

Đưa trải nghiệm Session chat của AWOG (`ui-next`) khớp **1-1** với craft về hành vi + cấu trúc, nhưng màu sắc đi qua `useTheme()` token của AWOG (giữ dark/light + font-size scale). Không đụng runtime/persistence (xem ADR 0061 D-1).

## Bảng hành vi đích (map 1-1)

| # | Hành vi craft | Nguồn craft | AWOG hiện tại | Đích |
|---|---|---|---|---|
| B1 | ProcessingIndicator: ≈40 từ xoay vòng random mỗi 10s (crossfade) + đồng hồ elapsed | `ChatDisplay.tsx:266-405` | byline tĩnh "Streaming…/Waiting…" + elapsed | Từ xoay vòng + elapsed, ẩn khi park gate |
| B2 | "Thinking…/Preparing response…" lấp khoảng `awaiting` giữa tool xong và hành động kế | `turn-utils.ts:183` `shouldShowThinkingIndicator` | không có | Có, theo phase |
| B3 | Turn dẫn xuất lúc render (bỏ qua turnId, dùng isIntermediate) | `turn-utils.ts:360` `groupMessagesByTurn` | group theo message | Lớp `Turn`/`ActivityItem` dẫn xuất |
| B4 | Turn card header: step-count badge + preview text cross-fade (intent→tool đang chạy→thinking→"Steps completed"+errorCount) | `TurnCard.tsx:710,2955` | `SessionCluster` "{n} steps · read N…" tĩnh | Header preview động |
| B5 | Activity list: status icon + tree-view depth connector + stagger fade-in; nest subagent (Task) | `TurnCard.tsx:898,1228` | `SessionStepItem` phẳng + `sub` | Activity row + group row nest |
| B6 | Streaming: real delta + throttle markdown 300ms + buffering gate (ẩn text ngắn 500ms–2.5s) | `TurnCard.tsx:2405,451` | typewriter 16ms/char | Throttle + buffering (typewriter = fallback) |
| B7 | `isIntermediate` phân biệt text-trước-tool vs câu trả lời cuối | claude/pi adapter | không mang | Sidecar mang + persist |
| B8 | `task_progress` elapsed live per running tool | claude adapter `:415` | không có | Có (Anthropic path trước) |
| B9 | Composer toolbar: permission-mode pill + model + @-mention + working-dir + Send(ArrowUp)/Stop(Square) | `FreeFormInput.tsx` | đã có phần lớn | Align layout |

## Ràng buộc AWOG

- Màu **bắt buộc** qua `useTheme()` — không hardcode hex. Badge/elapsed = `text-[12px]` fixed; body text `text-[1em]`.
- Vue SFC, `<script setup lang="ts">`, không Options API. Component >250 dòng → tách + đẩy logic vào composable.
- Chuỗi UI qua i18n en/vi (`tr`), không hardcode.
- Giữ nguyên các flow đã cắm: permission / plan / question / steer / todo-banner / fork / cost / workspace panel.

## Phân pha (tất cả ✔ — UI-only, không đụng sidecar/persistence)

- **Pha 0 ✔** — Spec (file này) + ADR 0061.
- **Pha 1 ✔** — `SessionProcessingIndicator.vue` (B1): ~29 từ xoay vòng mỗi 10s (crossfade) + đồng hồ elapsed; wire vào `SessionTranscript` (gate `working = message cuối streaming && !parked`); gỡ "Streaming…/elapsed" khỏi byline `SessionMessageItem`.
- **Pha 2 ✔** — `utils/session-turns.ts` (B3, B7): `deriveTurnPhase`/`shouldShowThinkingIndicator`/`blockRole`/`deriveTurnView`/`getPreviewText`. **QĐ:** phân biệt intermediate-vs-final text **client-side theo block order** (`finalResponseIndex`) → KHÔNG đụng sidecar cho `isIntermediate`. i18n `sessions.turn.*`.
- **Pha 3 ✔** — `SessionTurnActivities.vue` (B4, B5): gộp tool step + thinking + intermediate text vào một section collapse (badge count + preview live); rewire `grouped` của `SessionMessageItem` qua `blockRole`; câu trả lời cuối nổi bật. `SessionCluster` giờ không dùng.
- **Pha 4 ✔** — Streaming parity (B6): `SessionTextBlock` throttle 300ms + buffering gate khi craft-mode; **default `settings.sessions.typewriter` → false** (typewriter thành opt-in). Session cũ có localStorage cũ giữ typewriter=true → tắt thủ công để thấy craft streaming.
- **Pha 5 ✔** — Elapsed per-tool (B8): `SessionStepItem` hiện "Xs" trên running step ≥2s — **client-side**, không đụng sidecar. `usage_update` live: **bỏ** (giá trị thấp; usage panel đã có).
- **Pha 6 ✔** — Session shell (B9): đánh giá — composer (send/stop, mode pill, mentions, attachments) + welcome (hero + starter cards) **đã khớp craft**; chỉ khác cosmetic icon (arrow-up/square) → không rewrite.
- **Pha 7 ✔** — `pnpm typecheck` EXIT=0; 8 file parity lint sạch. Verify runtime trực quan: người dùng chạy app (hot-reload, không cần rebuild sidecar).

## Ghi chú triển khai

- **Toàn bộ UI-only** — không sửa file nào trong `apps/desktop/sidecar/`, không đổi JSONL persistence. Hot-reload, không cần rebuild+restart.
- Lỗi lint pre-existing ở `stores/connections.ts` (WIP ADR 0060) không thuộc phạm vi này.

## Acceptance (rút gọn)

- Turn đang chạy: hiện ProcessingIndicator xoay từ + elapsed đếm giây; khi park (question/perm) → "Waiting…" không đếm.
- Turn card: header hiện số step + preview động; mở ra thấy activity list nest subagent, icon trạng thái đúng (running/done/error/edit).
- Streaming: text hiện theo block throttle (không giật từng ký tự nếu tắt typewriter); text ngắn không nhấp nháy.
- Regression 0: permission/plan/question/steer/todo/fork vẫn hoạt động; session cũ mở được (không migration).
- `pnpm typecheck` (vue-tsc EXIT 0) + `pnpm lint` 0 error, cả 2 runtime path chạy thật.

## Open decisions

- **Model picker ở composer (craft) vs footer status bar (AWOG hiện tại)** — mặc định GIỮ status bar, chỉ đổi nếu user chốt (Pha 6).
- **Persistence** — GIỮ JSONL AWOG (ADR 0061 D-1). Thay luôn → ADR riêng + migration.
