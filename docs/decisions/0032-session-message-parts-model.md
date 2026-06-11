# 0032 — Session message timeline = ordered `parts[]`

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-11
- **Người quyết định:** hoatq (PO) + tech-lead

## Bối cảnh

Một lượt trả lời của agent đan xen **text tường thuật + tool call + reasoning**. UI cần render đúng thứ tự thời gian (text → tool cluster → text → …, với reasoning ở trên).

Mô hình cũ lưu message dạng **phẳng**: `message.text: string` + `message.steps: SessionStep[]`, mỗi step gắn `textOffset` (vị trí ký tự trong `text` nơi tool fire). Render (`SessionMessageItem.timelineBlocks`) **dựng lại** interleaving bằng cách *cắt `text` tại các offset*. Cách này gây 2 lớp bug:

1. **Cắt giữa chữ** quanh task card — khi hệ toạ độ của offset (text stream đầy đủ) lệch khỏi `message.text` được cắt (xem [ADR-context: event-adapter overwrite] và memory `project_step_text_offset_invariant`). Đã vá triệu chứng nhưng cơ chế slicing vẫn mong manh.
2. **Reasoning bị ngược** — provider stream reasoning summary *sau* text → step thinking nhận offset = cuối text → render dưới câu trả lời.
3. **Reload mất interleaving** — `textOffset` chỉ stamp live ở UI; reload từ JSONL dồn step xuống cuối.

Tham khảo `thehope2k/minimalist-agent` (cùng stack Electron + Pi): họ model message là **mảng `parts[]` có thứ tự** (`text | thinking | tool`), build bằng reducer `applyEvent` theo **thứ tự sự kiện đến**, persist nguyên thứ tự vào `messages.jsonl`. Không offset, không slicing.

## Quyết định

Áp dụng mô hình **`parts[]` có thứ tự** làm cấu trúc **authoritative + persisted** của một assistant message:

```ts
type SessionMessagePart = { kind: 'text'; text: string } | SessionStep
// SessionMessage thêm: parts?: SessionMessagePart[]
```

- **Sidecar là single source of truth.** `sessions.send-message` build `parts` bằng reducer `applyEvent` theo thứ tự `onChunk`/`onStep`:
  - text delta → nối vào text part cuối, hoặc mở text part mới;
  - step (tool/plan/note/thinking) top-level → push step part (đóng text part hiện tại → text kế tiếp tự mở part mới = ranh giới interleave);
  - step có `parentId` (subagent) → nest vào `children` của step part cha;
  - step lặp (running→done) → merge theo `id`, **không** tạo ranh giới mới.
- `parts` được **persist** (partial + final) và **trả về** trong RPC result.
- **Render hợp nhất** qua `parts`: UI dùng `message.parts` khi có. Reasoning (`kind:'thinking'`) luôn hoist lên đầu (chính sách "reasoning trước câu trả lời", bất kể provider stream sớm/muộn).
- **Giữ `message.text` + `message.steps`** (phẳng) cho copy/branch/search + nút summary "ran N commands…" + tương thích message cũ. `parts` là lớp thứ tự bổ sung, không thay thế.
- **Live streaming giữ nguyên** typewriter + `text`/`steps` hiện tại; `parts` chỉ set ở **finalize**. Trong lúc stream, UI render qua đường **derive** (text+steps) như cũ; finalize swap sang `parts` authoritative (cùng segmentation → liền mạch). Message cũ (không có `parts`) cũng dùng đường derive này → **không cần migration dữ liệu**.

## Phương án đã cân nhắc

- **A. Giữ offset + persist `textOffset`** — ít việc hơn nhưng vẫn slicing ở render (mong manh, còn rủi ro lệch hệ toạ độ). Bị từ chối: không trị tận gốc.
- **B. Rewrite store streaming sang reducer parts live (typewriter trên trailing text part)** — đúng mô hình nhất; đụng code stream/typewriter/cancel tinh vi. **Đã làm ngay sau C** (xem "Đã triển khai Option B").
- **C. Sidecar build parts + persist, UI live vẫn derive** — bước đầu (low-risk): `parts` thành cấu trúc bền vững/authoritative cho message đã finalize/reload; live tạm derive. Đã làm trước, rồi nâng lên Option B.

## Đã triển khai Option B (2026-06-11)

Store (`stores/sessions.ts`) build `slot.parts` **live** bằng reducer arrival-order:
- `appendDelta` nối vào text part cuối / mở part mới nếu part cuối là step.
- **Typewriter chạy trên text part trailing** (`trailingTarget` = full text part đang sống; tick reveal dần vào `.text`). `slot.text` mirror text revealed (copy/search/collapsed branch).
- `upsertStep` đóng text run hiện tại (snap `.text = trailingTarget`) rồi push step part / merge running→done theo id / nest subagent vào `children`.
- `slot.steps` **derive** từ parts (`syncSteps`) → một nguồn sự thật cho summary "ran N…" + step-detail owner-lookup.
- finalize success: để typewriter chạy hết trailing run rồi adopt `result.parts` (sidecar authoritative) — swap vô hình vì nội dung trùng. Cancel: snap trailing + giữ partial parts.

**Đường derive (text+steps+textOffset) GIỮ LẠI** chỉ cho message **legacy** (persist trước ADR này, không có `parts`). Live + message mới hoàn toàn offset-free. `textOffset` vì thế còn tồn tại cho legacy (sidecar vẫn stamp; chưa gỡ khỏi type).

## Hệ quả

- **Tích cực:** hết cắt giữa chữ (segment tường minh); reasoning đúng vị trí; reload giữ interleaving; render hợp nhất 1 đường (parts) cho mọi message mới; live offset-free; khớp convention Pi/minimalist-agent.
- **Trade-off:** logic interleave có ở 2 nơi (sidecar build authoritative + store build live) — cùng reducer arrival-order, chấp nhận theo KISS > DRY; `parts` + `steps` + `text` cùng tồn tại (`steps`/`text` derive từ parts ở live, persist song song); đường derive + `textOffset` còn lại cho legacy.
- **Việc cần làm tiếp:**
  - **QA runtime (Electron) — quan trọng nhất:** stream/typewriter (cả reply ngắn 1 burst), cancel giữa stream, crash-resume, reload, subagent nesting, plan card, reasoning-first.
  - Khi không còn session legacy đáng kể: gỡ đường derive + `textOffset` khỏi UI/sidecar/type.

## Tham chiếu

- [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md) — Pi runtime (event-adapter)
- [ADR 0030](0030-subagent-task-tool.md) — subagent step nesting (`parentId`)
- [spec sessions](../features/sessions.md), memory `project_step_text_offset_invariant`, `project_session_steps_persisted`
- `thehope2k/minimalist-agent` — `src/renderer/src/hooks/useChat.ts` (`applyEvent`), `storage/sessions.ts` (`StoredMessagePart`)
