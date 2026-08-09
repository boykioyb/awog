# Preview Popout Window — mở file ra cửa sổ OS riêng

> Trạng thái: Implemented v1 (ui-next + electron). Cho phép "bật" file đang xem trong
> [PreviewModal](preview-modal-actions.md) ra **một cửa sổ Electron riêng**, mở được
> **nhiều cửa sổ cùng lúc** (mỗi file một cửa sổ). Liên quan:
> [minimize-dock](minimize-dock.md), [workspace-panel](workspace-panel.md).

## Bối cảnh / vấn đề

PreviewModal là overlay **toàn cửa sổ, chặn tương tác** của cửa sổ chính. Đọc một spec
`.md` trong khi vẫn muốn thấy transcript session, hay so hai file cạnh nhau, hay đẩy tài
liệu sang màn hình thứ hai — cả ba đều không làm được: Minimize Dock giải quyết "tạm cất
đi rồi quay lại", nhưng không giải quyết "**xem song song**".

**Ý tưởng:** thêm action "Mở ở cửa sổ riêng". File tách ra thành một cửa sổ OS thực thụ —
kéo sang màn hình khác, đặt cạnh cửa sổ chính, alt-tab như mọi cửa sổ khác — trong khi
cửa sổ chính tiếp tục làm việc bình thường.

## Nguyên tắc thiết kế

- **Một implementation preview duy nhất.** Popout **không** là viewer thứ hai: nó load
  route `/preview` và mount đúng `PreviewModal` với prop `window-mode`. Mọi thứ (markdown
  render + mermaid + outline + find, Monaco code/raw, ảnh zoom/pan, PDF, media, office,
  edit/save, rename/move/delete, copy path, reveal) dùng chung code với preview trong app.
- **Chỉ file workspace thật mới pop out được.** Cửa sổ mới là **renderer mới**: nó đọc
  lại nội dung qua sidecar (`fs.readFile`), nên preview in-memory (reply chat mở toàn
  màn hình, blob kéo-thả) không có gì để đọc → nút bị ẩn (`canOpenInWindow`).
- **Nhiều cửa sổ, một cửa sổ cho mỗi file.** Main giữ `Map` keyed theo `root + path`: mở
  lại cùng file thì **focus cửa sổ đang có** thay vì xếp thêm bản trùng. Cửa sổ mới được
  cascade lệch 28px để không phủ kín cửa sổ trước.
- **State đi qua URL, không qua bộ nhớ.** Popout nhận `?root=&path=&name=` — renderer mới
  có store riêng, không thấy được `usePreview()` của cửa sổ chính.
- **Trong popout, store là nguồn sự thật.** Page đẩy item vào `usePreview()` (chứ không
  truyền prop `item`), vì đó chính là chỗ các action file repoint khi rename/move và là
  chỗ điều hướng link trong tài liệu push vào — nhờ vậy chúng hoạt động y như trong app.

## Kiến trúc

| File | Vai trò |
|---|---|
| [electron/src/preview-window.ts](../../apps/desktop/electron/src/preview-window.ts) | Tạo/focus BrowserWindow popout; validate `root`/`path`; map theo file; cascade vị trí |
| [electron/src/window.ts](../../apps/desktop/electron/src/window.ts) | `applyNavigationGuards()` (tách ra dùng chung) + `loadAppRoute()` cho cửa sổ phụ |
| [electron/src/ipc.ts](../../apps/desktop/electron/src/ipc.ts) | `preview:openWindow`, `window:closeSelf` |
| [electron/src/preload.ts](../../apps/desktop/electron/src/preload.ts) | `window.awog.openPreviewWindow()`, `window.awog.closeSelf()` |
| [ui-next/pages/preview.vue](../../apps/desktop/ui-next/pages/preview.vue) | Route popout (`layout: false`) — parse query → `usePreview().open()` → `<PreviewModal window-mode>` |
| [ui-next/composables/usePreviewModal.ts](../../apps/desktop/ui-next/composables/usePreviewModal.ts) | `canOpenInWindow` + `openInWindow()`; `canMinimize` tắt ở popout |
| [ui-next/components/common/PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue) | Prop `windowMode`: nút popout, ẩn minimize, bỏ dim backdrop, click nền không đóng |

## Luồng

1. Người dùng bấm nút **Mở ở cửa sổ riêng** (icon `external`) trên header PreviewModal —
   chỉ hiện khi item là file workspace thật và không phải đang ở trong popout.
2. Renderer gọi `sc.openPreviewWindow(root, path, name)` → IPC `preview:openWindow`.
3. Main validate cặp `root`/`path` bằng `resolveInsideWorkspace` (invariant #2). Sai →
   reject, không cửa sổ nào được tạo, UI flash lỗi `common.preview.windowError`.
4. Trùng file → focus cửa sổ cũ. Ngược lại: tạo BrowserWindow (preload + contextIsolation
   + sandbox, `applyNavigationGuards`), load `/preview?root=…&path=…&name=…`.
5. Page popout mở item trong store của chính nó; PreviewModal đọc file qua sidecar và
   render như bình thường. Tiêu đề cửa sổ = tên file (theo cả rename / link đã đi vào).
6. Đóng: nút ✕ / Esc trong page → `window:closeSelf` (main lấy cửa sổ **từ sender**, nên
   renderer không thể đóng cửa sổ khác), hoặc dùng nút đóng native của OS.

## Khác biệt so với preview trong app

| | Trong app | Popout |
|---|---|---|
| Nút "Mở ở cửa sổ riêng" | có (file workspace) | ẩn (không tự nhân bản) |
| Minimize ra dock | có | ẩn — OS đã minimize được cửa sổ |
| Click nền để đóng | có | không (nền chính là cửa sổ) |
| Add to chat | có khi đang mở session view | ẩn (renderer không có session nào) |
| Dim backdrop | có | không |

## Bảo mật

- **Invariant #2** — `root`/`path` từ renderer là L1: validate bằng
  `resolveInsideWorkspace` **trước khi** tạo cửa sổ; nội dung vẫn đọc qua sidecar
  (`assertInsideWorkspace`), main không đọc file.
- **Invariant #4** — cửa sổ popout dùng preload chuẩn, `contextIsolation` + `sandbox`,
  không `nodeIntegration`; không có API mới nào ngoài 2 kênh nêu trên.
- `window:closeSelf` suy ra cửa sổ từ `event.sender` → không nhận id từ renderer, nên
  không thể đóng cửa sổ của người khác.
- Popout chịu cùng `applyNavigationGuards`: link ngoài mở bằng browser OS, điều hướng
  nội bộ đổi path bị chặn (không thể biến cửa sổ preview thành trang 404 của SPA).

## Giới hạn đã biết

- Engine event (`engine:event`) chỉ gửi cho cửa sổ chính và các popout **session**
  ([session-popout-window](session-popout-window.md)), nên popout preview **không**
  auto-refresh khi file đổi trên đĩa — dùng nút Reload trong toolbar. (Giống tray
  popover.)
- Preview in-memory không pop out được (xem "Nguyên tắc thiết kế").
- Vị trí/kích thước cửa sổ chưa được persist giữa các lần mở.
