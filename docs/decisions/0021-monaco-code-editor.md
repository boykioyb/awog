# 0021 — Monaco làm code editor cho in-app workspace

- **Trạng thái:** Proposed
- **Ngày:** 2026-06-02
- **Người quyết định:** Tech Lead (AWOG)

## Bối cảnh

[Project Code Workspace](../features/project-workspace.md) cần một editor đủ mạnh để **thay VSCode cho luồng làm việc cơ bản**: sửa code nhiều ngôn ngữ với syntax highlight, autocomplete, multi-cursor, find/replace trong file.

Hiện trạng: component `EditorMonacoPane.vue` (dùng cho task artifact editor) thực ra chỉ là `<textarea>` + gutter số dòng — **không** phải Monaco thật. Repo có `highlight.js` ([ADR 0020](./0020-highlightjs-code-rendering.md)) nhưng đó là **render read-only** cho code block trong chat, không edit được. CLAUDE.md đã ghi "Code editor | Monaco" như định hướng nhưng chưa cài.

Ràng buộc AWOG:
- Không thêm dependency lớn khi chưa có ADR ([CLAUDE.md](../../CLAUDE.md)).
- Nuxt SPA `ssr: false` → editor chạy client-only, OK.
- Invariant #5 (no telemetry / no external host): editor không được tải asset/worker từ CDN.

## Quyết định

1. **Thêm `monaco-editor`** (UI, `apps/desktop/ui`). Đây là engine VSCode dùng — khớp định hướng CLAUDE.md và mục tiêu "feels like VSCode".
2. **Component bao bọc tái dùng** `components/editor/MonacoEditor.vue`:
   - `defineProps` type-only: `modelValue`, `language?`, `readOnly?`, `path?`.
   - `defineEmits`: `update:modelValue`, `save`, `cursor-change`.
   - Instance Monaco giữ trong **`shallowRef`** (perf rule nuxt-vue), **dispose** ở `onBeforeUnmount`.
   - Lazy `import('monaco-editor')` trong `onMounted` (client-only) → không phình initial bundle.
3. **Theme** map từ `useTheme()` tokens → `monaco.editor.defineTheme(...)`; đổi theme app → `monaco.editor.setTheme(...)`. Không hardcode hex.
4. **Worker bundle local** qua Vite: cấu hình `monaco-editor` workers (editor + ngôn ngữ phổ biến: ts/js, json, css, html) load từ asset **bundle local**, **không CDN** — dùng `?worker` import của Vite hoặc `vite-plugin-monaco-editor`. Quyết định cụ thể plugin vs manual để thì implement chốt, nhưng **bắt buộc local**.
5. **Ngôn ngữ** suy ra từ phần mở rộng — tái dùng `FsFileContent.language` đã có từ sidecar [fs.read-file.ts](../../apps/desktop/sidecar/src/methods/fs.read-file.ts), không nhân đôi map ext→lang ở UI.
6. **`EditorMonacoPane.vue`** (textarea hiện tại) **giữ nguyên** cho task artifact markdown editor (KISS — không bắt nó gánh Monaco). Workspace IDE dùng `MonacoEditor.vue` mới.

## Phương án đã cân nhắc

- **CodeMirror 6** — nhẹ hơn nhiều, web-native, đủ syntax + edit + search. Từ chối: kém "giống VSCode", autocomplete/multi-cursor/command-palette yếu hơn; user (PO) đã chọn Monaco cho mục tiêu thay hẳn VSCode.
- **Nâng cấp `<textarea>` + highlight.js** — 0 dependency mới nhưng không autocomplete/multi-cursor; highlight chỉ là lớp hiển thị → không đạt "đầy đủ tính năng". Từ chối.
- **Monaco qua CDN loader (`@monaco-editor/loader`)** — tiện setup nhưng tải asset từ CDN → **vi phạm invariant #5**. Từ chối; phải self-host/bundle worker.

## Hệ quả

- **Tích cực:** trải nghiệm sửa code gần VSCode; khớp định hướng CLAUDE.md; tái dùng `FsFileContent.language` + theme tokens sẵn có.
- **Tiêu cực / Trade-off:**
  - `monaco-editor` là dep lớn (~vài MB) + workers → tăng bundle; cần cấu hình Vite worker đúng cho Tauri (asset local).
  - Init editor tốn hơn textarea → bắt buộc lazy-load + `shallowRef`.
  - Theme tích hợp cần map token thủ công sang Monaco theme.
- **Việc cần làm tiếp:**
  - `pnpm add monaco-editor` (trong `apps/desktop/ui`); chạy checklist dependency ([.claude/rules/security.md](../../.claude/rules/security.md): `npm view`, `pnpm audit`).
  - Cấu hình Vite worker local + verify chạy trong Tauri shell (không chỉ `pnpm dev`).
  - Cập nhật bảng stack trong [CLAUDE.md](../../CLAUDE.md) (Monaco: từ "prompt + artifact" → "+ code workspace").

## Tham chiếu

- [docs/features/project-workspace.md](../features/project-workspace.md) — feature spec
- [ADR 0020](./0020-highlightjs-code-rendering.md) — highlight.js cho read-only code block (phạm vi khác)
- [ADR 0022](./0022-fs-read-write-search-ipc.md) — fs read-write + search (nguồn nội dung cho editor)
- [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md) — `shallowRef` cho object lớn (Monaco)
