# ADR 0098 — Session Workbench: layout IDE 3 vùng

Trạng thái: proposed · 2026-10-11

## Bối cảnh

`SessionDetail.vue` hiện là một cột chat + workspace panel dock **bên phải** (7 tab Diff/Files/Browser/Plan/Terminal/Tasks/Preview, kéo tới 240px). Qua dùng thực tế + prototype tương tác `docs/features/ui-redesign-workbench-proto.html`, các vấn đề:

- **Session ≠ file được sửa.** Người dùng làm việc theo *project*, mở nhiều file đọc/sửa cạnh chat — hiện phải bật PreviewModal lẻ tẻ, không có doc tab, không có explorer.
- **Chuyển session/project chậm.** Session list theo sidebar phả, không có quick-switch chéo project; session đang chạy ở project khác phải qua trang Sessions rồi lọc bằng mắt.
- **Workspace panel phải** chỉ chứa 1 view/lần và tranh chiều ngang với transcript; terminal/diff/checklist cần nhìn song song, không xếp chồng tab.
- **Status bar** là nơi tự nhiên cho branch/context/project/account nhưng hiện chỉ là chip hiển thị.

Mục tiêu: layout kiểu IDE (VS Code) — **Explorer trái · Stage giữa (doc tabs) · Dock dưới · Rail view 26px · Status bar**, giữ local-first, tái dùng tối đa component/composable hiện có.

## Quyết định

### L-1 — Session page trở thành Workbench, không phải chat page kèm panel

Route `/sessions` render `WorkbenchView` gồm 5 vùng cố định:

```text
┌──────┬─────────┬──────────────────────────┐
│ rail │ explorer│ stage (doc tabs + surface)│
│ 46px │  240px  │                          │
│      ├─────────┼──────────────────────────┤
│      │ view    │ dock (Terminal/Diff/     │
│      │ rail    │ Tasks[/Team]) + checklist │
│      │ 26px    │ rail 210px               │
├──────┴─────────┴──────────────────────────┤
│ status bar 26px                           │
└───────────────────────────────────────────┘
```

- **Stage** = danh sách *document tab*: `chat` (pin, luôn đầu), `file` (Monaco), `md` (preview), `web` (WebContentsView embed — tái dùng `useEmbeddedBrowser`), `img`, `mmd`, `settings`, `monitor`. Mỗi doc là một surface tự render; đóng file tab ≠ đóng session.
- **Session chính nó là doc `chat`** — `SessionDetail` lồng trong stage thay vì chiếm trang. Tab strip trên stage: hàng 1 session tabs (project hiện tại), hàng 2 doc tabs.
- **Explorer** = file tree project thật qua `fs.*` (ADR 0022) + section "Changed files" từ git store; ctx menu parity VS Code (new/rename/delete/copy path/open terminal); filter input + new file/folder/refresh/collapse-all; click dir/file đặt `selPath` quyết định thư mục cha khi tạo mới.
- **Dock** = `Terminal` (nhiều tab, mỗi tab một PTY `terminal.*`), `Diff` (reuse `WorkspaceDiff`), `Tasks` (`WorkspaceTasks`), `Team` — **chỉ khi session là channel đa-agent** (`session.agents`). Checklist pin rail phải dock (ADR 0069, luôn thấy — thay thế Plan view).
- **View rail 26px** luôn hiện (files/SCM/GitHub); click cùng view = toggle panel, khác view = đổi + mở; `⌘B` toggle.
- **Status bar** là hàng action: quota donuts (account), monitor chip → mở doc `monitor`, branch → menu git (fetch/pull/push/đổi/SCM), context meter → menu compact/clear, project → switcher, account+model → picker, toggles explorer/browser/dock, settings.

### L-2 — Cross-project session switching là first-class

- **⌘K quick-switch**: overlay lọc mọi session mọi project (running trước, project hiện tại lên đầu), Enter nhảy — `useCommandPalette` mở rộng hoặc composable riêng `useSessionSwitcher`.
- Click icon Sessions ở app rail = popover cây session mọi project (đã có pattern `projpop` trong prototype).
- Breadcrumb `project / Sessions` = project switcher có đếm session running.
- Toast "session xong · project khác" → nút "Mở session" nhảy project (đã có `useAppNotify`, thêm action).

### L-3 — Cắt view không có giá trị riêng

| View | Quyết định |
|---|---|
| Plan | cắt — checklist rail phải dock là Plan surface |
| Cost | gộp — donuts status bar + info session |
| Info | gộp — ⓘ popover cạnh state chip |
| Preview | cắt — artifact là doc tab trên stage |
| Browser (panel phải) | giữ làm doc `web` trên stage + toggle status bar; `useEmbeddedBrowser` không đổi hợp đồng |

### L-4 — New file/folder = inline input trong cây, đúng VS Code

Không `prompt()`. Selection tracking (`selPath`): chọn dir → tạo trong dir; chọn file → tạo cạnh file; không chọn → root. Hỗ trợ `a/b/c.ts` tạo cấp lồng. Enter/blur commit, Esc hủy, trùng tên → đỏ. Mọi ghi đi qua `fs.createFile`/`fs.createDir` (đã gated `assertInsideWorkspace`).

### L-5 — Không đổi hợp đồng IPC / store

- `fs.*`, `terminal.*`, `git.*`, `sessions.*`, `monitor.sample`, `accounts.*` dùng nguyên.
- Store mới **một** bounded context: `stores/workbench.ts` — `docs[]`, `activeDoc`, `selPath`, `dockView`, `dockH`, `termTabs[]`, `curProject`. Không nhét vào `sessions` store (bounded context khác).
- Theme light: thêm token set thứ hai vào `useTheme` (hiện chỉ dark) — `body[data-theme]` như `data-theme-family`.

## Hệ quả

- `SessionDetail.vue` (2627 dòng) **được nhúng nguyên** vào doc `chat` — không viết lại transcript; chỉ bỏ workspace panel dock phải (code panel chuyển thành doc `web`/dock view).
- `WorkspaceFiles/WorkspaceDiff/WorkspaceTasks/WorkspaceTerminal` tái dùng trong explorer/dock — cần prop `compact` nơi cần.
- Trang `/monitor`, `/settings` (nav section) vẫn tồn tại; doc `monitor`/`settings` trong workbench là *embed* cùng component, không route mới.
- Trạng thái popout session (`session-window.ts`) vẫn route `/session?id=` riêng — workbench không ảnh hưởng.

## Rủi ro & giảm thiểu

| Rủi | Giảm thiểu |
|---|---|
| `SessionDetail` phụ thuộc layout hiện tại (đo chiều rộng chat, workspace panel sizing) | Slice C làm sau cùng; giữ `useBrowserPanelSizing` riêng; test keep-alive 2 lớp |
| File tree project lớn (>10k node) | Lazy render theo dir đã mở; virtualize khi >500 visible rows |
| PTY per tab tốn tài nguyên | PTY spawn khi tab mở lần đầu (lazy), `terminal.kill` khi đóng tab; cap 8 tab |
| WebContentsView trong doc tab đè overlay | Tái dùng đúng `useEmbeddedBrowser` + `OVERLAYS` selector đã có — không viết lại |
| Light theme: component hardcode màu | Guard `check-design-tokens.mjs` + sweep `#[0-9a-f]{3,6}` trong files mới |

## Tham chiếu

- Prototype: `docs/features/ui-redesign-workbench-proto.html` (interactive, đã duyệt)
- Spec: `docs/features/session-workbench.md`
- Tasks: `docs/features/session-workbench.tasks.md`
- ADR liên quan: 0019 (PTY), 0022 (fs IPC), 0055 (session↔task), 0069 (checklist), 0074-76 (transcript nav), 0086 (embedded browser)
