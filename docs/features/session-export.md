# Feature — Export & Share session

## Mục tiêu

Cho phép xuất transcript một session ra **Markdown** hoặc **HTML self-contained** để lưu trữ,
gửi review, hay nhúng vào PR/issue. Trước đây transcript chỉ nằm trong JSONL nội bộ, không có
đường ra. Local-first: render hoàn toàn client-side, ghi đĩa qua sidecar (không network).

## Luồng

1. Người dùng mở dialog Export từ:
   - **Context menu** một session trong sidebar (`SessionList` → "Export…").
   - **Icon-button** Export ở header `SessionDetail`.
2. Dialog (`SessionExportModal`) preview nội dung theo định dạng đã chọn (MD / HTML), với:
   - **Copy** → clipboard.
   - **Save to disk** → ghi file qua RPC `sessions.save-export`.

## Render (client-side)

`composables/useSessionExport.ts`:

- `buildMarkdown(session)` — ghép transcript: heading theo role (User/Assistant/System), text block
  giữ nguyên markdown; các block khác render gọn (thinking → blockquote, step → bullet `tool target`,
  plan → list, question → list + answer, perm/steer/error → annotation).
- `buildHtml(session)` — dùng `useMarkdown().renderMarkdown()` (marked + Shiki, đã sanitize) cho body,
  wrap trong HTML standalone (inline CSS light theme, không asset ngoài → mở/in/share ở đâu cũng được).
- `copyToClipboard`, `saveToDisk` (gọi sidecar).

## Lưu đĩa (sidecar)

RPC `sessions.save-export` (`methods/sessions.save-export.ts`):

- Params: `{ sessionId, format: 'md'|'html', content }`. **Path do sidecar quyết định hoàn toàn** —
  không nhận path từ UI ⇒ không có bề mặt path-traversal (security invariant #2).
- Resolve base: project root (nếu `session.projectId` map được) → `{project}/.awog/exports/`,
  else `~/.awog/exports/`. Filename = slug(title) + 8 ký tự đầu của id + ext.
- Cap content 16 MB. Trả `{ path }` (đường dẫn tuyệt đối đã lưu).

## File chạm

- Sidecar: `methods/sessions.save-export.ts` (+ đăng ký ở `index.ts`).
- UI: `composables/useSessionExport.ts`, `composables/useSessionExportModal.ts` (singleton state),
  `components/session/SessionExportModal.vue` (mount 1 lần ở `layouts/default.vue`).
- Trigger: `components/session/SessionList.vue` (ctx menu), `SessionDetail.vue` (header).
- i18n: `i18n/locales/{en,vi}/sessions.json` (`sessions.ctx.export`, `sessions.export.*`).

## Giới hạn / ghi chú

- Save-to-disk chỉ hoạt động trong app desktop (cần sidecar); browser-dev disable nút Save.
- Export là snapshot tại thời điểm bấm; không tự cập nhật.
