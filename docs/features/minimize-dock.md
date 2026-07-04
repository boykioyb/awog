# Minimize Dock — thu nhỏ ra góc màn hình (PiP)

> Trạng thái: Implemented v1 (ui-next). Một **primitive dùng chung** cho phép "thu nhỏ"
> nhiều loại nội dung ra một stack pill nổi ở góc dưới-phải (ẩn dụ giống thumbnail
> screenshot macOS), giữ nguyên ngữ cảnh để khôi phục 1 chạm. Liên quan:
> [preview-modal-actions](preview-modal-actions.md), [workspace-panel](workspace-panel.md),
> [session-task-link](session-task-link.md).

## Bối cảnh / vấn đề

PreviewModal là overlay **toàn cửa sổ, chặn tương tác**. Khi đang review một file `.md`
mà cần liếc sang session khác, người dùng buộc phải **đóng file** → chuyển session →
quay lại **mở lại file từ đầu**, mất vị trí đọc và mất ngữ cảnh. Cùng nỗi đau đó xuất
hiện với: một session đang chạy, một task đang chạy, terminal, một diff đang xem.

**Ý tưởng:** thêm nút "thu nhỏ". Nội dung co lại thành một pill nhỏ neo ở góc; người
dùng làm việc khác thoải mái; click pill để khôi phục **đúng chỗ đang xem**.

## Nguyên tắc thiết kế

- **Một dock, nhiều loại (stack).** `useMinimizeDock` giữ mảng entry (discriminated
  union theo `kind`), dedupe theo `id`, cap 6, mới nhất lên đầu. Reload mất (in-memory,
  renderer-only — như pinned-note presets).
- **Hai kiểu "thu nhỏ".**
  - *Overlay* (preview): thu nhỏ = **ẩn overlay** + đẩy entry snapshot; khôi phục = mở
    lại + trả về `view` (render/raw) + `scrollTop`.
  - *Live/route* (session, task): thu nhỏ = **ghim PiP** (view gốc là trang, không cần
    ẩn); pill hiển thị trạng thái sống lấy realtime từ store; khôi phục = điều hướng về +
    chọn. Session/task vẫn chạy nền độc lập với view.
  - *Dock* (terminal): thu nhỏ = `close()` (PTY sống dai qua `everOpened`); khôi phục =
    `open()`.
- **SoC.** Store `useMinimizeDock` thuần dữ liệu, không import store feature.
  `MinimizeDock.vue` (mount 1 lần ở shell) là nơi *dispatch khôi phục* + *derive trạng
  thái sống* cho pill session/task từ `useSessionsStore`/`useTasksStore` (mối quan tâm
  trình bày, gom một chỗ luôn mounted).

## Kiến trúc

| File | Vai trò |
|---|---|
| [useMinimizeDock.ts](../../apps/desktop/ui-next/composables/useMinimizeDock.ts) | Store module-level: `entries` (reactive), `minimize()`, `remove()`, `has()`. Entry union theo `kind: 'preview' \| 'session' \| 'task' \| 'terminal'`. |
| [MinimizeDock.vue](../../apps/desktop/ui-next/components/common/MinimizeDock.vue) | Stack pill góc dưới-phải (Teleport body, z 95). Derive tone/sub sống cho session/task; dispatch restore/dismiss theo kind. |
| [usePreview.ts](../../apps/desktop/ui-next/composables/usePreview.ts) | Thêm `restore(ref, hint)` + `takeRestore()` — one-shot chuyển `view`+`scrollTop` cho modal khi mở lại. |
| [usePreviewModal.ts](../../apps/desktop/ui-next/composables/usePreviewModal.ts) | `minimize()` (snapshot view + `mdScroll.scrollTop`, gated `!editMode`), áp `pendingScroll` sau khi render markdown. |
| [PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue) | Nút thu nhỏ ở header (cạnh X); prop `item` thành optional để mount global không cần prop. |
| [useTaskFocus.ts](../../apps/desktop/ui-next/composables/useTaskFocus.ts) | Signal module-level `focusId` để khôi phục lựa chọn task (LibraryView giữ selection nội bộ). |
| [LibraryView.vue](../../apps/desktop/ui-next/components/library/LibraryView.vue) | Thêm prop optional `selectKey` (controllable selection, additive — mặc định giữ hành vi click nội bộ). |

## Điểm gắn nút "thu nhỏ"

| Surface | Vị trí nút | Restore |
|---|---|---|
| **File preview** (core) | header PreviewModal | `usePreview().restore()` + trả `view`+`scrollTop` |
| **Git diff (workspace panel)** | *tự có* — diff workspace đã đi qua PreviewModal | như preview |
| **Terminal** | header GlobalTerminalHost | `useGlobalTerminal().open()` |
| **Session PiP** | header SessionDetail | `setActive(id)` + `navigateTo('/sessions')` |
| **Task PiP** | header TaskDetail | `focusTask(id)` + `navigateTo('/tasks')` |

Dedupe id: `preview:<root>:<path>` (hoặc `preview:<name>`), `session:<id>`, `task:<id>`,
`terminal:global`.

## Trạng thái sống (pill session/task)

`MinimizeDock` map status → tone (chấm màu + pulse cho running/attention):

- Session `SessionStatus`: `streaming`→running · `awaiting`→attention · `error`→error ·
  `done`→done · `idle`→idle.
- Task `TaskStatus`: `running`→running · `waiting_*`/`paused`→attention · `failed`→error ·
  `completed`→done · `queued`→idle.

## z-index

`.mdock` = **95** — trên page (≤61) / detail-panel (80/81) / shell drawer (90-92), dưới
modal (100+). Neo `bottom: 46px; right: 16px` để vượt status bar. Preview khôi phục quay
lại band modal 100 (`.ovl`), pill của nó rời stack.

## Quyết định / trade-off

- **Stack + snapshot** (không keep-alive DOM): mọi pill hành xử đồng nhất, hỗ trợ nhiều
  file cùng lúc. Đánh đổi: khôi phục *đọc lại từ đĩa* (bắt luôn edit ngoài app) + khôi
  phục scroll chỉ cho **markdown render** (Monaco/ảnh trả về `view` nhưng không scroll nội
  bộ — đủ cho kịch bản "review file md"). `minimize()` gate `!editMode` để không mất draft.
- **Terminal** tái dùng `everOpened` sẵn có → thu nhỏ/khôi phục không giết PTY.
- **LibraryView `selectKey`** additive (không phá selection nội bộ) để task khôi phục được
  lựa chọn — session dùng global `activeId` nên không cần.

## Việc cần làm tiếp

- **Git PAGE diff** (trang /git, diff inline trong GitManager — khác overlay) chưa có
  minimize; hiện chỉ diff **workspace panel** (qua preview) được cover.
- (Tùy chọn) Persist dock qua reload (cần sidecar) — hiện in-memory theo chủ đích.
- (Tùy chọn) Kéo-thả sắp xếp pill, hover bung preview thu nhỏ.
