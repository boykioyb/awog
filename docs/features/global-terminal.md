# Global Terminal — dock terminal toàn app

> Trạng thái: Implemented (ui-next). Một **dock terminal cấp app** luôn truy cập được
> từ status bar trên **mọi trang**, độc lập với session. Bộ tab **tách theo project**
> (mỗi project 1 bộ tab + PTY riêng, giữ qua chuyển project); có **thu nhỏ roll-up**
> tại chỗ; và mở được **tab SSH** ngay trong dock (bên cạnh shell local). Tái dùng PTY
> engine của [workspace-panel](workspace-panel.md) ([ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md))
> + transport SSH của [ssh-manager](ssh-manager.md) ([ADR 0063](../decisions/0063-ssh-manager-ssh2-runtime.md)).
> Liên quan: [workspace-panel](workspace-panel.md) (Terminal tab project-scoped),
> [minimize-dock](minimize-dock.md), [system-tray-status](system-tray-status.md).

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
├── GlobalTerminalHost                ← flex:0 0 <height>px; v-show theo isOpen; collapsed → chỉ header
│   ├── .gterm-main (flex:1)
│   │   └── <KeepAlive :max=4>        ← cache 1 instance / project (LRU)
│   │       └── WorkspaceTerminal     ← :key=projectKey, pty-key="global:<projectKey>"
│   │           (root=cwd active session, new-tab-menu = New shell + hosts SSH)
│   └── TerminalSnippetsRail (260px)  ← nút Snippets ở header toggle; project + Global tier
├── SshHostKeyHost                    ← host-key TOFU prompt app-wide (SSH connect từ dock bất kỳ trang)
└── AppStatusBar (footer)             ← nút "Terminal" luôn hiện → toggle dock
```

Dock nằm **trong flex column** ngay trên status bar → khi mở nó **đẩy nội dung trang
lên** (là panel thật, không overlay). `v-show` (display:none khi đóng) gỡ nó khỏi flex
flow hoàn toàn mà vẫn **giữ terminal mounted** để PTY + scrollback sống qua đóng → mở.

### Tách bộ tab theo project (KeepAlive)

`WorkspaceTerminal` giữ toàn bộ state tab/pane/PTY trong instance của nó. Để mỗi project
có bộ tab riêng, `GlobalTerminalHost` bọc widget trong `<KeepAlive :max="4">` với
`:key="projectKey"` (`= sessions.active?.project ?? '__home__'`) và `pty-key="global:<projectKey>"`:

- Đổi project (active session sang project khác) → instance cũ **deactivate** (KeepAlive
  giữ cache; `onBeforeUnmount` **không** chạy khi deactivate → PTY + shell **sống**), instance
  project mới activate/mount. Quay lại project cũ → restore đúng bộ tab đã để lại.
- `WorkspaceTerminal` thêm `onActivated` → refit tab active (DOM bị detach khi ở cache nên
  size xterm cũ đã stale).
- Hai session **cùng project** dùng chung 1 bộ tab (khóa theo project, không theo session).
  Không session/project → 1 bộ "home" (cwd `~`).
- Vượt `max=4` project → LRU evict → instance thật sự unmount → `onBeforeUnmount` kill PTY.

### Tách `WorkspaceTerminal` khỏi session (SoC)

[WorkspaceTerminal.vue](../../apps/desktop/ui-next/components/session/workspace/WorkspaceTerminal.vue)
trước nhận prop `session` và tự resolve cwd qua `useWorkspaceData(session.project)` +
`ptyKey = ses:<id>`. Đã refactor để widget **chỉ biết cwd + grouping key**, không biết
session/project:

| Prop | Ý nghĩa |
|---|---|
| `root: string \| null` | cwd tuyệt đối **hoặc** `"~"` (sidecar expand). `null` = đang resolve → empty state |
| `ready: boolean` | engine bridge có + cwd sẵn sàng → gate xterm init + PTY spawn |
| `ptyKey: string` | khóa group PTY (`ses:<id>`, `global:<projectKey>`, hoặc `ssh:<hostId>`) |
| `visible: boolean` | tab/host đang hiện → spawn/refit (terminal off-screen có size 0) |
| `unavailableLabel?: string` | text empty-state khi thiếu bridge (global dock không dùng câu "this session") |
| `transport?: TerminalTransport` | backend **mặc định** cho tab mới. Vắng → local PTY; có (SshTerminal) → mọi tab dùng adapter đó |
| `newTabMenu?: TerminalTabKind[]` | có → nút "+" mở dropdown (mỗi kind mang transport riêng); vắng → "+" thêm tab local mặc định |

Ba host dùng chung widget này (session panel / global dock / SSH — logic PTY ~500 dòng
là một "tri thức", không copy):
- **Session panel** ([SessionWorkspacePanel.vue](../../apps/desktop/ui-next/components/session/SessionWorkspacePanel.vue))
  tự resolve `root`/`ready` qua `useWorkspaceData(session.project)`, truyền `pty-key="ses:<id>"`.
- **Global dock** ([GlobalTerminalHost.vue](../../apps/desktop/ui-next/components/shell/GlobalTerminalHost.vue))
  truyền `root` = cwd active session (folder kéo → project path → `~`), `pty-key="global:<projectKey>"`,
  `ready=sc.available`, `new-tab-menu` = New shell + host SSH.
- **SSH** ([SshTerminal.vue](../../apps/desktop/ui-next/components/ssh/SshTerminal.vue)) truyền
  `transport` SSH → mọi tab là shell tới host đó.

### State — `useGlobalTerminal`

[composables/useGlobalTerminal.ts](../../apps/desktop/ui-next/composables/useGlobalTerminal.ts)
— singleton module-level (như `useGitModal`/`useWorkspacePanel`):

- `isOpen` — dock đang mở.
- `everOpened` — đã mở ít nhất 1 lần → `WorkspaceTerminal` mount (PTY sống qua đóng/mở; đóng chỉ `v-show`).
- `height` — chiều cao dock, persist `localStorage` (`awog-global-terminal-height`, clamp 120–900px).
- `collapsed` — trạng thái **thu nhỏ roll-up** (chỉ còn header), persist `localStorage`
  (`awog-global-terminal-collapsed`). Trực giao với `isOpen` — dock collapsed vẫn "mở", chỉ tí hon.
- `open/close/toggle`, `setHeight` (clamp + persist khi kéo resize), `toggleCollapse`/`setCollapsed`.
  `open()` luôn `setCollapsed(false)` → click "Terminal" luôn thấy nội dung, không phải thanh header trơ.

### Thu nhỏ roll-up (in-place)

Nút chevron ở header cuộn dock về **chỉ còn thanh header** ở đáy màn hình (`collapsed`), giữ
nguyên PTY; click vào thanh header (hoặc chevron) để bung lại. Khác với nút X (ẩn hẳn dock —
`isOpen=false`, PTY vẫn sống, mở lại từ status bar). Khi collapsed: bỏ resize handle, ẩn body
(`v-show`), `visible=false` (không refit vô ích), section co về đúng chiều cao header.

### Footer — nút Terminal luôn hiện

[AppStatusBar.vue](../../apps/desktop/ui-next/components/shell/AppStatusBar.vue): nút
**Terminal** chuyển ra **ngoài** `v-if="active"` → luôn hiện ở mọi trang, `@click=toggle`,
active state khi `isOpen`. Chip Terminal session-scoped cũ (toggle `wpToggle('Terminal')`)
đã gỡ; chip **Files** giữ nguyên. Terminal **project-scoped** trong session vẫn mở được
từ view picker của Workspace Panel → không mất chức năng.

### Tab SSH trong dock

`WorkspaceTerminal` chuyển transport từ **cấp component → cấp tab**: mỗi `TerminalTab` mang
`transport` riêng (local PTY hoặc kênh SSH), gán lúc tạo; mọi pane của tab (split) chia sẻ
transport đó. Routing sự kiện định tuyến **theo transport của từng pane** (`transportOf(pane)`):
pane local bỏ qua `ssh:*`, pane SSH bỏ qua `terminal.*`. Nút "+" mở dropdown `newTabMenu`.

`GlobalTerminalHost` dựng `newTabMenu` = `New shell` (local) + 1 mục / host trong
[useSshStore](../../apps/desktop/ui-next/stores/ssh.ts)`.hosts`, mỗi host → `makeSshTransport(hostId)`
(mirror [SshTerminal](../../apps/desktop/ui-next/components/ssh/SshTerminal.vue): `ssh.connect/write/resize/disconnect`,
event `ssh:data`/`ssh:exit`, id `connId`). Không có host nào → `newTabMenu` = `undefined` → "+"
thêm thẳng shell local (không hiện dropdown 1 mục).

Để SSH chạy được **ngoài trang /ssh**:
- `GlobalTerminalHost.onMounted` gọi `sshStore.loadAll()` (nạp hosts + subscribe `ssh:host-key-prompt`
  app-wide; idempotent với `loadAll` của trang /ssh).
- [SshHostKeyHost.vue](../../apps/desktop/ui-next/components/ssh/SshHostKeyHost.vue) mount ở layout →
  hiện host-key TOFU prompt cho connect khởi từ dock ở bất kỳ trang nào (đã gỡ modal trùng khỏi `pages/ssh.vue`).

`SoC`: `WorkspaceTerminal` **không** import SSH — host truyền factory transport qua `newTabMenu`,
widget chỉ spawn tab với transport được đưa.

### Split pane (kiểu VSCode)

`WorkspaceTerminal` đã có sẵn split-tree (splitLeaf/splitter kéo được/drag-grip/drop-zone
qua [WorkspaceTerminalNode.vue](../../apps/desktop/ui-next/components/session/workspace/WorkspaceTerminalNode.vue)),
trước chỉ vào được qua menu chuột phải tab hoặc kéo grip pane. Đã thêm **nút split** (icon
`dock-right`) ngay cạnh nút "+" ở thanh tab → click = chia pane active sang phải
(`splitActive` → `splitTab(activeTabId, 'row')`). Menu chuột phải tab vẫn còn split-down +
rename/duplicate. Nút này ở trong `WorkspaceTerminal` nên **dùng chung cả 3 host** (session
panel / global dock / SSH). Mỗi pane là 1 PTY/SSH độc lập; kéo grip để di chuyển/gộp, kéo
splitter để chỉnh tỉ lệ.

### Snippets theo project (rail cạnh terminal)

Thư viện lệnh tái dùng cho terminal global, **tách riêng** khỏi SSH snippets (quyết định
sản phẩm: 2 thư viện, không lẫn). Store [terminalSnippets.ts](../../apps/desktop/ui-next/stores/terminalSnippets.ts)
— renderer-only (localStorage `awog-terminal-snippets`, không qua IPC, không secret). Mỗi
`TerminalSnippet { id, name, command, project }` với `project: string | null` (null = tầng
**Global** dùng chung; else khóa project).

- **Rail** [TerminalSnippetsRail.vue](../../apps/desktop/ui-next/components/shell/TerminalSnippetsRail.vue):
  panel dọc cạnh terminal body (mở/đóng bằng nút Snippets ở header dock, state
  `useGlobalTerminal.snippetsOpen` persist localStorage). Hiện snippet của project hiện tại
  **+** tầng Global (project-first, badge "Global"). Mỗi row: Run / Copy / Edit / Delete.
- **Chạy:** rail emit `run(command)` → `GlobalTerminalHost` gọi `WorkspaceTerminal.runText(command + '\n')`
  (`defineExpose`), ghi vào **pane active** qua **transport của chính tab đó** → chạy đúng cho
  cả tab local lẫn tab SSH. Gate bằng `canRun` (có terminal sống chưa — lấy từ `@conn`).
- **Editor** [TerminalSnippetEditor.vue](../../apps/desktop/ui-next/components/shell/TerminalSnippetEditor.vue):
  name + command + tier (AppSelect: "Project này" / "Global"; không có project → chỉ Global).
- **Scope key** = `sessions.active?.project` (null khi không có project → chỉ thấy Global).
  Layout dock body thành flex row: `.gterm-main` (terminal, flex:1) + rail (260px).

### Sidecar — expand `~`

[terminal.create.ts](../../apps/desktop/sidecar/src/methods/terminal.create.ts) thêm
`expandHome()` (mirror `projects.upsert`): `~`/`~/...` → `homedir()`. Nhờ vậy global dock
chỉ cần truyền `"~"` — **UI không bao giờ cần biết đường dẫn home tuyệt đối**, việc resolve
home nằm hẳn ở sidecar. `terminalManager` giữ nguyên assert `isAbsolute` làm chốt an toàn
(nhận đường dẫn đã expand).

## Luồng

- **Mở lần đầu:** click Terminal → `open()` đặt `everOpened=true` + `isOpen=true` + bung collapse
  → dock hiện, `WorkspaceTerminal` (project hiện tại) mount → spawn PTY tại cwd project.
- **Đóng (X):** `isOpen=false` → dock `display:none`, **không kill** PTY (widget vẫn mounted).
- **Thu nhỏ (chevron):** `collapsed=true` → dock co còn header; PTY sống; click header/chevron bung lại.
- **Mở lại:** `isOpen=true` → `visible` flip → refit + focus, dùng lại PTY cũ.
- **Đổi project:** active session sang project khác → KeepAlive deactivate instance cũ (PTY sống)
  + activate/mount instance project mới; quay lại → `onActivated` refit bộ tab cũ.
- **Điều hướng trang:** host mount 1 lần ở layout → PTY **sống xuyên route**.
- **Mở SSH:** "+" → chọn host → tab mới dùng transport SSH; host-key mới → `SshHostKeyHost` hỏi TOFU.
- **Resize:** kéo mép trên → `setHeight` clamp + persist.
- **Dọn dẹp:** sidecar idle-sweep kill shell idle > 30 phút; LRU evict project thứ 5; thoát app kill toàn bộ.

## Bảo mật

Kế thừa các bất biến của [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md):

- **cwd home resolve ở sidecar** (`homedir()`), không nhận đường dẫn home tuyệt đối từ UI.
- **Env nhạy cảm bị strip** trước khi spawn shell (`*_TOKEN/_KEY/_SECRET`, OAuth/API key) →
  shell tương tác không thể `echo` credential (invariant #1).
- Shell binary cố định (`$SHELL`/default), arg array rỗng — không nối shell string.
- Mỗi `pty-key="global:<projectKey>"` cap 5 PTY (`MAX_PER_SESSION`) — tách theo project.
- **Tab SSH** kế thừa bất biến [ADR 0063](../decisions/0063-ssh-manager-ssh2-runtime.md): credential (mật khẩu/passphrase/
  private key) **chỉ** trong OS keychain, không rời sidecar; host-key TOFU trước khi kết nối lần đầu.

## Quyết định thiết kế

- **Một nút "Terminal" duy nhất ở footer = global** (cwd `~`), tránh trùng nhãn với
  terminal trong session. Terminal project-scoped vẫn truy cập qua view picker của panel.
- **PTY persist qua đóng/mở** (mô hình giống integrated terminal của VSCode) — đóng dock
  không mất phiên shell; idle-sweep + thoát app lo việc reap.
- **Tách widget thay vì copy** — logic PTY là một "tri thức" duy nhất; tham số hóa
  cwd + grouping key cho cả 2 host (đúng SoC: widget không biết session/project).

## Out of scope

- Multi-dock / di chuyển dock sang trái/phải (global terminal chỉ dock đáy).
- Persist phiên shell / kết nối SSH qua **restart app** (PTY + SSH không sống qua restart — đúng bản chất).
- Tách bộ tab theo **session** thay vì project (đã chốt: theo project; 2 session cùng project dùng chung).

## Open questions

- Số project cache tối đa (`KeepAlive max=4`) — có cần chỉnh/persist theo nhu cầu người dùng?
- Phím tắt mở/đóng dock global (vd `⌃\``) — chưa thêm.
