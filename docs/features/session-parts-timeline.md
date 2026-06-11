# Session timeline — ordered `parts[]`

Spec ngắn cho cách render dòng thời gian một lượt trả lời của agent. Quyết định kiến trúc: [ADR 0032](../decisions/0032-session-message-parts-model.md). Bối cảnh rộng hơn: [sessions.md](./sessions.md).

## Mục tiêu

Render đúng thứ tự thời gian phần đan xen **text ↔ tool ↔ reasoning** của một assistant message, sống sót qua reload, không cắt giữa chữ, reasoning luôn ở trên câu trả lời.

## Mô hình dữ liệu

```ts
type SessionMessagePart = { kind: 'text'; text: string } | SessionStep
// SessionMessage thêm: parts?: SessionMessagePart[]
```

- `parts` = thứ tự thời gian thật của lượt trả lời (text segment + step), nest subagent qua `SessionStep.children`.
- `text` (phẳng, full) + `steps` (phẳng) **giữ nguyên** cho copy/branch/search + summary "ran N commands…" + message cũ.
- `parts` là **authoritative khi có**; thiếu `parts` (message cũ / đang stream) → UI derive từ `text + steps`.

## Luồng

1. **Sidecar** (`sessions.send-message`) build `parts` theo thứ tự `onChunk`/`onStep`:
   - text delta → nối text part cuối / mở mới;
   - step top-level → push (đóng text part hiện tại);
   - step `parentId` → nest vào `children` của part cha;
   - step lặp (running→done) → merge theo `id`.
2. Persist `parts` ở mọi snapshot (partial + final) → reload đúng thứ tự. Trả `parts` trong RPC result.
3. **UI store**: build `slot.parts` **live** bằng reducer arrival-order (Option B) — `appendDelta` nối/mở text part, typewriter chạy trên text part trailing, `upsertStep` đóng text run + push/merge/nest step, `slot.steps` derive từ parts (`syncSteps`). `finalize` success adopt `result.parts` (swap vô hình); `hydrate` re-nest (`normalizeParts`).
4. **Render** (`SessionMessageItem.timelineBlocks`): có `parts` → dựng block từ `parts`; không có (message legacy) → derive từ `text + steps + textOffset`. Cả hai: **hoist `kind:'thinking'` lên đầu**, coalesce step liên tiếp thành 1 cluster.

## Acceptance

- **AC1** Lượt nhiều vòng (text→tools→text) hiển thị text liền mạch, không cắt giữa chữ quanh task card.
- **AC2** Reasoning luôn render **trên** text, kể cả provider stream reasoning summary cuối turn.
- **AC3** Reload session: thứ tự interleave + subagent nesting giữ nguyên như live.
- **AC4** Message cũ (không `parts`) vẫn render đúng qua đường derive (không cần migrate dữ liệu).
- **AC5** Copy/branch/summary "ran N commands…" hoạt động như cũ (dùng `text`/`steps`).

## Ngoài phạm vi (follow-up)

- Đường derive + `textOffset` GIỮ cho message legacy (persist trước ADR 0032). Gỡ khi không còn session cũ đáng kể.
- QA runtime Electron: stream/typewriter (reply ngắn 1 burst), cancel giữa stream, crash-resume, reload, subagent nesting, plan card, reasoning-first.
