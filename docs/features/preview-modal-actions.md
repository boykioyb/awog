# Preview Modal — theme picker + file actions

> Trạng thái: Implemented (ui-next). Mở rộng [PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue)
> với **theme picker cho Monaco** + **9 thao tác file**, và refactor SFC theo
> page-controller (nuxt-vue rule). Liên quan: [ADR 0053](../decisions/0053-monaco-themes-dependency.md)
> (dependency `monaco-themes`), [ADR 0045](../decisions/0045-settings-json-file-persistence.md)
> (persist `~/.awog/settings.json`), [workspace-panel](workspace-panel.md) (nguồn preview file).

## Bối cảnh

PreviewModal là viewer toàn cửa sổ dùng chung (mount 1 lần, drive bằng prop `item`
hoặc shared store `usePreview()`). Trước đây chỉ xem (read-only Monaco cho code/text,
marked+highlight.js cho markdown, ảnh/pdf). User muốn:

1. **Theme picker dành riêng cho Monaco** trong giao diện preview, persist xuống
   **global settings** của AWOG.
2. **9 thao tác file** ngay trong preview: edit · save · open in finder · rename ·
   move · delete · copy path · open in browser · add to chat.
3. Refactor file (834 dòng — vượt ngưỡng 250 của coding guide).

## Kiến trúc sau refactor

| File | Vai trò |
|---|---|
| [usePreviewModal.ts](../../apps/desktop/ui-next/composables/usePreviewModal.ts) | **Page-controller**: toàn bộ state + IPC (item resolution, workspace load, image transform, markdown view, edit/save, 9 actions, confirm/rename overlay). SoC: không `import fs`/SDK — đi qua `useSidecar`. |
| [useMonacoTheme.ts](../../apps/desktop/ui-next/composables/useMonacoTheme.ts) | Theme state (module-level shared) + persist `~/.awog/settings.json` key `monacoPreviewTheme` (settings.get/set) + lazy-load curated theme JSON. |
| [useMarkdownOutline.ts](../../apps/desktop/ui-next/composables/useMarkdownOutline.ts) | TOC + scroll-spy + reading-width (tách khỏi modal). |
| [useChatAttach.ts](../../apps/desktop/ui-next/composables/useChatAttach.ts) | Kênh decoupled "add to chat" (modal không biết sessions; SessionDetail là consumer drain queue). |
| [PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue) | Shell mỏng: head + body (image/pdf/markdown/code/empty) + overlay rename/confirm + style. Wire controller. |
| [PreviewToolbar.vue](../../apps/desktop/ui-next/components/common/PreviewToolbar.vue) | Floating bar: view controls + theme picker + edit/save + actions menu + feedback pill. Nhận `:ctrl` (pattern controller-prop như `FileTreeController`). |
| [MonacoViewer.vue](../../apps/desktop/ui-next/components/common/MonacoViewer.vue) | Viewer/editor: theme (follow-app + curated) + chế độ editable (`readOnly` prop, emit `change`/`save`). |

## Theme picker (Monaco)

- **`Follow app`** (mặc định) — derive editor color từ CSS token (dark/light + accent),
  phản ứng theo theme app. Đây là hành vi cũ.
- **Curated** — bộ ~16 theme kiểu VSCode (Dracula, Monokai, Nord, Night Owl, Tomorrow
  Night/Eighties, Cobalt2, Oceanic Next, GitHub Dark/Light, Solarized Dark/Light,
  Tomorrow, Clouds, Xcode, iPlastic) từ `monaco-themes` ([ADR 0053](../decisions/0053-monaco-themes-dependency.md)).
  Theme curated **cố định** (không đổi theo dark/light app).
- Persist: id chọn ghi `~/.awog/settings.json` (`monacoPreviewTheme`) qua `settings.set`;
  hydrate qua `settings.get` 1 lần/phiên. Browser-dev (không sidecar) → in-memory.
- Chỉ hiện khi Monaco đang hiển thị (code/text hoặc markdown ở chế độ raw).

## 9 thao tác file

Gate ở `hasWorkspaceFile` (item có `workspaceRoot`+`path` và có sidecar) — chỉ preview
file workspace thật mới có action. "Add to chat" gate riêng theo `canAddToChat`.

| Thao tác | Cơ chế | Ghi chú |
|---|---|---|
| **Edit file** | toggle `readOnly=false` ở MonacoViewer | markdown chuyển sang raw để sửa nguồn |
| **Save** | `fs.writeFile` (atomic) | baseline update → dirty clear; ⌘/Ctrl+S trong editor |
| **Open in finder** | `revealPath` (main process) | |
| **Rename** | `fs.rename(fromPath, toPath)` | overlay sửa path; repoint shared item → tự reload |
| **Move** | `fs.rename` | cùng overlay rename (sửa cả thư mục) |
| **Delete** | `fs.delete` | confirm overlay trước; thành công → đóng modal |
| **Copy path** | `navigator.clipboard` (absolute path) | |
| **Open in browser** | `openFileExternal` (file:// trong browser) | |
| **Add to chat** | `useChatAttach.request()` → SessionDetail drain | ảnh gửi dataUrl, text cắt 20k ký tự |

**Bảo vệ chỉnh sửa chưa lưu:** đóng modal khi `dirty` → confirm "discard?". Mọi mutation
qua sidecar đã được `assertInsideWorkspace` gate (refuse `.git`, refuse clobber, refuse root).

## Quyết định / trade-off

- **PreviewToolbar nhận controller object** (`:ctrl`) thay vì ~30 props — theo precedent
  `FileTreeController`. Destructure ref/fn ổn định → unwrap trong template.
- **Confirm/feedback inline** (chưa có toast system ở ui-next): confirm overlay generic
  (delete + discard), feedback pill transient. Khi có toast chung → thay sau.
- **Theme JSON lazy** qua Vite alias (`monaco-themes/themes` → thư mục thật) vì package
  `exports` map chặn deep import — xem [ADR 0053](../decisions/0053-monaco-themes-dependency.md).

## Việc cần làm tiếp

- (Tùy chọn) Migrate các app setting khác sang `~/.awog/settings.json` (hiện chỉ
  `monacoPreviewTheme` ghi file; phần còn lại vẫn localStorage) — cần lớp `useSettingsSync`.
- (Tùy chọn) Toast system chung cho ui-next → thay feedback pill + confirm inline.
- infosec review khi đụng `fs.writeFile`/`fs.delete`/`fs.rename` từ surface mới này (đã gate
  sẵn ở sidecar; xác nhận không có path nào lọt).
