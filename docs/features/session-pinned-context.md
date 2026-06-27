# Feature — Pinned context (working-set theo session)

## Mục tiêu

Cho phép **ghim file/ghi chú ở cấp session** để sidecar tự nạp lại vào **mỗi turn** như một khối
`<pinned_context>`. Lấp khoảng giữa:

- **Attachment** — chỉ sống 1 lần (turn gửi kèm).
- **Rules** — toàn cục / theo project.

Pinned context = "luôn nhớ những file/ghi chú này trong suốt session".

## Mô hình dữ liệu

- `Session.pinnedContext?: { files?: string[]; notes?: string }` (cả UI `useSessionsMock` + sidecar
  `types/shared.ts`). `files` = path workspace-relative; round-trip qua `sessions.upsert` (metadata).

## UI (composer)

`SessionComposer`:

- **Chip row** (trên toolbar) hiển thị file đã ghim (icon pin + tên file + ×) và 1 chip "Notes" khi có.
- **Nút pin** trên toolbar mở popover:
  - Danh sách file đã ghim (remove ×).
  - Ô search thêm file — tái dùng workspace file index (cùng nguồn `@`-mention, `data.files`).
  - Textarea notes (persist on blur).
- Store actions: `addPinnedFile` / `removePinnedFile` / `setPinnedNotes` → `pushUpsert(update-metadata)`.

## Injection (sidecar)

`methods/sessions.send-message.ts`:

- UI forward `pinnedContext` trong payload `sessions.sendMessage` (cùng trust model như
  `disabledTools`/`mcpServerIds`).
- `buildPinnedContextBlock(pinned, cwd)`:
  - Đọc từng file **fresh mỗi turn**, path-sanitize qua `assertInsideWorkspace(cwd, rel)` (invariant #2);
    file ngoài workspace / thiếu / binary → bỏ qua.
  - **Bound**: per-file 24k ký tự, tổng 80k; cắt thì đánh dấu `…[truncated]` (không để model tưởng đầy đủ).
  - Build `<pinned_context>` gồm `<file path>` + `<notes>`.
- **Prepend** vào `systemPromptAppend` (đứng trước rules — rules thêm ở `run-stream` vẫn override được).

## File chạm

- Sidecar: `types/shared.ts` (PinnedContext), `sessions/store.ts` (SessionMetadataPatch),
  `methods/sessions.upsert.ts` (schema + patch), `methods/sessions.send-message.ts` (Params + inject).
- UI: `composables/useSessionsMock.ts` (type), `stores/sessions.ts` (actions + forward payload),
  `components/session/SessionComposer.vue` (chip row + popover).
- i18n: `i18n/locales/{en,vi}/sessions-composer.json` (`sessions.pinned.*`).

## Giới hạn / ghi chú

- File lớn → cắt theo cap (cảnh báo bằng `…[truncated]`); ghim nhiều file lớn sẽ tốn context/tiền.
- Pinned files đọc theo `cwd` của project session → session không project chỉ dùng được notes.
