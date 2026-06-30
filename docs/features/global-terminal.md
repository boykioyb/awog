# Global Terminal — dock terminal toàn app

> Trạng thái: Implemented (ui-next). Một **dock terminal cấp app** luôn truy cập được
> từ status bar trên **mọi trang**, độc lập với session. cwd mặc định = thư mục home
> (`~`). Tái dùng PTY engine của [workspace-panel](workspace-panel.md) ([ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)).
> Liên quan: [workspace-panel](workspace-panel.md) (Terminal tab project-scoped),
> [system-tray-status](system-tray-status.md).

## Bối cảnh

Trước đây terminal chỉ tồn tại như **một tab trong Workspace Panel của Session** —
gắn chặt vào session đang mở (cwd = project root, PTY group theo `ses:<id>`). Nút
Terminal ở footer chỉ hiện khi đang xem 1 session trên trang `/sessions`.

Yêu cầu: terminal (và donut quota) **luôn hiện ở footer, global** — mở được trên bất
kỳ trang nào, không cần session. Donut quota (`StatusUsage`) vốn đã global; phần thật
sự phải làm là **tách terminal khỏi session** để có một terminal cấp app với
cwd = home (`~`).

## Kiến trúc

```
layouts/default.vue (.appwrap, flex column)
├── .app  (NavRail | main)            ← flex:1, bị đẩy LÊN khi dock mở
├── GlobalTerminalHost                ← flex:0 0 <height>px; v-show theo isOpen
│   └── WorkspaceTerminal (root="~", pty-key="global")   ← v-if everOpened (PTY sống qua đóng/mở)
└── AppStatusBar (footer)             ← nút "Terminal" luôn hiện → toggle dock
```

Dock nằm **trong flex column** ngay trên status bar → khi mở nó **đẩy nội dung trang
lên** (là panel thật, không overlay). `v-show` (display:none khi đóng) gỡ nó khỏi flex
flow hoàn toàn mà vẫn **giữ terminal mounted** để PTY + scrollback sống qua đóng → mở.

### Tách `WorkspaceTerminal` khỏi session (SoC)

[WorkspaceTerminal.vue](../../apps/desktop/ui-next/components/session/workspace/WorkspaceTerminal.vue)
trước nhận prop `session` và tự resolve cwd qua `useWorkspaceData(session.project)` +
`ptyKey = ses:<id>`. Đã refactor để widget **chỉ biết cwd + grouping key**, không biết
session/project:

| Prop | Ý nghĩa |
|---|---|
| `root: string \| null` | cwd tuyệt đối **hoặc** `"~"` (sidecar expand). `null` = đang resolve → empty state |
| `ready: boolean` | engine bridge có + cwd sẵn sàng → gate xterm init + PTY spawn |
| `ptyKey: string` | khóa group PTY (`ses:<id>` hoặc `global`) |
| `visible: boolean` | tab/host đang hiện → spawn/refit (terminal off-screen có size 0) |
| `unavailableLabel?: string` | text empty-state khi thiếu bridge (global dock không dùng câu "this session") |

Hai host dùng chung widget này (Rule of Three: 2 caller → trừu tượng hóa đúng lúc, vì
logic PTY ~480 dòng không nên copy):
- **Session panel** ([SessionWorkspacePanel.vue](../../apps/desktop/ui-next/components/session/SessionWorkspacePanel.vue))
  tự resolve `root`/`ready` qua `useWorkspaceData(session.project)`, truyền `pty-key="ses:<id>"`.
- **Global dock** ([GlobalTerminalHost.vue](../../apps/desktop/ui-next/components/shell/GlobalTerminalHost.vue))
  truyền `root="~"`, `pty-key="global"`, `ready=sc.available`.

### State — `useGlobalTerminal`

[composables/useGlobalTerminal.ts](../../apps/desktop/ui-next/composables/useGlobalTerminal.ts)
— singleton module-level (như `useGitModal`/`useWorkspacePanel`):

- `isOpen` — dock đang mở.
- `everOpened` — đã mở ít nhất 1 lần → `WorkspaceTerminal` mount (PTY sống qua đóng/mở; đóng chỉ `v-show`).
- `height` — chiều cao dock, persist `localStorage` (`awog-global-terminal-height`, clamp 120–900px).
- `open/close/toggle`, `setHeight` (clamp + persist khi kéo resize).

### Footer — nút Terminal luôn hiện

[AppStatusBar.vue](../../apps/desktop/ui-next/components/shell/AppStatusBar.vue): nút
**Terminal** chuyển ra **ngoài** `v-if="active"` → luôn hiện ở mọi trang, `@click=toggle`,
active state khi `isOpen`. Chip Terminal session-scoped cũ (toggle `wpToggle('Terminal')`)
đã gỡ; chip **Files** giữ nguyên. Terminal **project-scoped** trong session vẫn mở được
từ view picker của Workspace Panel → không mất chức năng.

### Sidecar — expand `~`

[terminal.create.ts](../../apps/desktop/sidecar/src/methods/terminal.create.ts) thêm
`expandHome()` (mirror `projects.upsert`): `~`/`~/...` → `homedir()`. Nhờ vậy global dock
chỉ cần truyền `"~"` — **UI không bao giờ cần biết đường dẫn home tuyệt đối**, việc resolve
home nằm hẳn ở sidecar. `terminalManager` giữ nguyên assert `isAbsolute` làm chốt an toàn
(nhận đường dẫn đã expand).

## Luồng

- **Mở lần đầu:** click Terminal → `open()` đặt `everOpened=true` + `isOpen=true` → dock
  hiện, `WorkspaceTerminal` mount → spawn PTY tại `~`.
- **Đóng:** `isOpen=false` → dock `display:none`, **không kill** PTY (widget vẫn mounted).
- **Mở lại:** `isOpen=true` → `visible` flip → refit + focus, dùng lại PTY cũ.
- **Điều hướng trang:** host mount 1 lần ở layout → PTY **sống xuyên route**.
- **Resize:** kéo mép trên → `setHeight` clamp + persist.
- **Dọn dẹp:** sidecar idle-sweep kill shell idle > 30 phút; thoát app kill toàn bộ.

## Bảo mật

Kế thừa các bất biến của [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md):

- **cwd home resolve ở sidecar** (`homedir()`), không nhận đường dẫn home tuyệt đối từ UI.
- **Env nhạy cảm bị strip** trước khi spawn shell (`*_TOKEN/_KEY/_SECRET`, OAuth/API key) →
  shell tương tác không thể `echo` credential (invariant #1).
- Shell binary cố định (`$SHELL`/default), arg array rỗng — không nối shell string.
- `pty-key="global"` cap 5 PTY (`MAX_PER_SESSION`).

## Quyết định thiết kế

- **Một nút "Terminal" duy nhất ở footer = global** (cwd `~`), tránh trùng nhãn với
  terminal trong session. Terminal project-scoped vẫn truy cập qua view picker của panel.
- **PTY persist qua đóng/mở** (mô hình giống integrated terminal của VSCode) — đóng dock
  không mất phiên shell; idle-sweep + thoát app lo việc reap.
- **Tách widget thay vì copy** — logic PTY là một "tri thức" duy nhất; tham số hóa
  cwd + grouping key cho cả 2 host (đúng SoC: widget không biết session/project).

## Out of scope

- cwd theo project khi đang trong session (đã chốt: luôn `~`). Terminal project-scoped
  vẫn nằm ở Workspace Panel của session.
- Multi-dock / di chuyển dock sang trái/phải (global terminal chỉ dock đáy).
- Persist phiên shell qua **restart app** (PTY không sống qua restart — đúng bản chất).

## Open questions

- Khi vừa ở trong session vừa mở dock global, có thể tồn tại đồng thời terminal global
  (cwd `~`) và Terminal tab project trong panel. Giữ tách bạch hay gộp lại — chờ phản hồi.
- Phím tắt mở/đóng dock global (vd `⌃\``) — chưa thêm.
