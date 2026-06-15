# Đính kèm file & dán văn bản lớn trong Composer

> Mở rộng cơ chế đính kèm của Session Composer: **mọi file** (không chỉ ảnh) đến
> được model, file risk (exe…) bị từ chối, và **dán văn bản lớn** tự chuyển thành
> tệp `.txt` đính kèm thay vì chèn inline vào ô nhập.

- **Trạng thái:** Implemented.
- **Liên quan:** [sessions.md](sessions.md), [workspace-panel.md](workspace-panel.md), [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) (resume = rebuild context mỗi lượt).

## Bối cảnh

Trước đây composer đính kèm được nhiều loại file, nhưng **chỉ ảnh** thực sự được
gửi cho model — `buildContext` chỉ dựng image content block, file non-image bị
persist để hiển thị nhưng model bỏ qua. Đồng thời, dán một đoạn văn bản lớn (log,
JSON, transcript…) sẽ làm phình ô nhập và lẫn vào nội dung tin nhắn.

Hai vấn đề này được giải quyết bằng **một đường dữ liệu chung**: nội dung text của
file (hoặc đoạn dán lớn) nằm ở `SessionAttachment.preview`, và runtime gửi nó cho
model dưới dạng text block có delimiter.

## Phân loại file khi intake

[utils/attachment-intake.ts](../../apps/desktop/ui/utils/attachment-intake.ts) —
`intakeFile(file)` quyết định mỗi file:

| Loại | Điều kiện | Kết quả |
|---|---|---|
| **Risky** | đuôi ∈ denylist (exe, msi, dll, dmg, app, apk, jar, iso, bin…) | **Từ chối** (báo notice) |
| **Ảnh** | `mime` bắt đầu `image/` | data URL base64 → `url` → image block (như cũ) |
| **Text** | không có NUL byte trong 8KB đầu (sniff nhị phân kiểu Git) | decode UTF-8 → `preview` → text block |
| **Nhị phân khác** | có NUL byte (pdf, zip…) | đính kèm **display-only** (không gửi model) |

- Nội dung text bị cắt ở `MAX_TEXT_ATTACHMENT_CHARS` (256k ký tự) kèm marker, để
  giới hạn kích thước JSONL và token mỗi lượt (resume re-feed mỗi lượt).
- Dùng chung cho paperclip picker, kéo-thả, và dán clipboard.

## Dán văn bản lớn → tệp `.txt`

[SessionComposer.vue](../../apps/desktop/ui/components/session/SessionComposer.vue)
`onPaste`:

1. Clipboard có **file** (ảnh chụp màn hình, file copy) → `addFiles` (cùng đường intake).
2. Văn bản thuần dài **≥ ngưỡng** và bật setting → `buildPastedTextAttachment` tạo
   `pasted-text-N.txt` (`type: 'file'`, `mime: text/plain`, nội dung ở `preview`),
   `preventDefault` để không chèn inline.
3. Đoạn ngắn hơn ngưỡng → để textarea chèn inline như bình thường.

## Setting

- Store: `ComposerSettings { pasteAsFile, pasteThreshold }` trong
  [stores/settings.ts](../../apps/desktop/ui/stores/settings.ts), default
  `{ pasteAsFile: true, pasteThreshold: 2000 }`.
- Persist client-only qua [useComposerSettings.ts](../../apps/desktop/ui/composables/useComposerSettings.ts)
  (localStorage `awog.composer.v1`, mirror `useGitSettings`). Ngưỡng clamp `[200, 100000]`.
- UI: 2 field trong Settings → Workspace ([SettingsWorkspaceSection.vue](../../apps/desktop/ui/components/settings/SettingsWorkspaceSection.vue))
  — toggle + ô số ngưỡng (ẩn khi tắt). I18n `settings.pasteAsFile*`, `settings.pasteThreshold*`.

## Delivery cho model (sidecar)

- `SessionAttachment.preview` thêm vào type chung
  ([types/shared.ts](../../apps/desktop/sidecar/src/types/shared.ts)) + zod schema
  (`.max(2_000_000)`) trong [sessions.send-message.ts](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts).
- `.refine`: một lượt hợp lệ khi có text **hoặc** ảnh **hoặc** file có `preview`.
- [context-builder.ts](../../apps/desktop/sidecar/src/runtime/context-builder.ts)
  `toFileTextContent` bọc nội dung trong `<attached-file name="...">…</attached-file>`;
  `historyUser` chuyển sang block array khi có attachment (text user → file-text → ảnh).
- Persist trong JSONL nên reload + resume re-feed lại đúng nội dung (giống ảnh).

## Hiển thị

- Chip composer + bong bóng tin nhắn ([SessionMessageAttachments.vue](../../apps/desktop/ui/components/session/SessionMessageAttachments.vue))
  đã render file chip; chip có `preview` thì click mở [AttachmentLightbox.vue](../../apps/desktop/ui/components/AttachmentLightbox.vue)
  (xem raw/markdown + copy). File nhị phân display-only không click được.

## Bất biến bảo mật

- File **không bao giờ được thực thi** — chỉ đọc nội dung; denylist chặn các đuôi
  thực thi/installer.
- Tên file được khử `"`/newline trước khi nhúng vào attribute delimiter (L1 input).
- Payload `preview` bị bound ở schema để IPC độc hại không làm phình bộ nhớ.
