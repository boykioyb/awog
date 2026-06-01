# Workspace Panel cho Sessions

> Panel công cụ workspace dock bên phải Session detail — chạy song song với chat,
> mô phỏng workspace switcher của Claude Code (Diff / Files / Plan / Terminal /
> Background tasks / Preview).

- **Trạng thái:** Implemented (MVP) — 6 tab wired. Terminal cần verify đóng gói native ([ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)).
- **Liên quan:** [sessions.md](sessions.md), [git-manager.md](git-manager.md), [ADR 0017](../decisions/0017-git-manager-ipc-contract.md), [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)

## Bối cảnh

Session detail trước đây chỉ có chat + step drawer. Workspace Panel cho người dùng
vừa chat vừa quan sát/thao tác trên workspace của project gắn với session: xem diff,
duyệt file, theo dõi plan, chạy terminal, theo dõi tác vụ nền, preview artifact.

Phần lớn tab **tái dùng primitive sẵn có** → không thêm dependency (trừ Terminal).

## Nền tảng: workspace root

Mọi tab thao tác trên đường dẫn tuyệt đối của project gắn session:
- UI: [SessionChat.vue](../../apps/desktop/ui/components/session/SessionChat.vue) resolve `workspaceRoot` = `workspace.projects.find(p => p.id === session.projectId)?.path`.
- Khi `projectId === null` → toàn panel hiển thị empty-state (CTA gắn project ở header).
- RPC mới nhận thẳng `workspaceRoot` (giống mọi `git.*`, [ADR 0017](../decisions/0017-git-manager-ipc-contract.md)).

## Kiến trúc

**Không phải tab bar.** Nút `PanelRight` ở header mở **dropdown menu** ([WorkspaceMenu.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceMenu.vue), giống ảnh Claude Code: Preview/Diff/Terminal/Files/Background tasks/Plan + phím tắt). Chọn 1 mục → mở **đúng 1 drawer** đó ở panel phải. Mỗi công cụ là 1 drawer riêng (có header title + nút close).

```
SessionChat (flex-col, relative)
├── SessionHeader → nút PanelRight → WorkspaceMenu (dropdown)
├── SessionMessageList
├── SessionComposer
└── SessionWorkspacePanel (v-if activeDrawer)      ← OVERLAY: absolute inset-y-0 right-0
    ├── (absolute, z-30, box-shadow trái) — phủ LÊN chat, KHÔNG co layout main
    ├── resizer (kéo trái = rộng ra) — mirror MasterDetailShell
    └── <KeepAlive> drawer đang active </KeepAlive>  ← giữ Terminal sống khi đổi drawer
```

- State: [stores/workspacePanel.ts](../../apps/desktop/ui/stores/workspacePanel.ts) — `position` (right/left/bottom) + `widthPx` + `heightPx` global (localStorage), `activeDrawerBySession[id]` per-session (null = đóng). `openDrawer`/`closeDrawer`/`toggleDrawer`/`setPosition`.
- Mỗi tool dùng [WorkspaceDrawerHeader.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceDrawerHeader.vue) (title + actions slot + **position picker** dock phải/trái/dưới + close).
- **Vị trí dock:** overlay neo `right` (mặc định) / `left` / `bottom`; resizer đổi trục theo vị trí (kéo rộng/cao); double-click resizer = reset.
- **Phím tắt** ([utils/workspace-tools.ts](../../apps/desktop/ui/utils/workspace-tools.ts), đăng ký ở SessionChat): ⇧⌘P Preview, ⇧⌘D Diff, ⌃\` Terminal, ⇧⌘F Files (toggle open/close). Background tasks + Plan: không phím tắt (như ảnh).
- Component: [components/session/workspace/](../../apps/desktop/ui/components/session/workspace/).

## Tab

| Tab | Nguồn dữ liệu | Tái dùng | Dep mới |
|---|---|---|---|
| **Diff** | file **session này đụng** (step write/edit/save) ∩ `git.status` + `git.diff` + watcher auto-refresh | `GitDiffViewer`, `useGitApi` | — |
| **Files** | `fs.listDir` (lazy 1 cấp) + `fs.readFile` (cap 512KB, binary sniff) | `useFsApi` mới, recursive `WorkspaceFileTreeNode` | — |
| **Plan** | Plan step mới nhất trong `session.messages[].steps[]` (`kind:'plan'`) | `sessions.permission` (approve/reject) | — |
| **Tasks** | Step `tool:'terminal'`/`'task'` đang/đã chạy, running float top | inject `SELECT_STEP_KEY` mở drawer | — |
| **Preview** | `session.messages[].artifacts[]` (markdown) | `MarkdownBodyView` | — |
| **Terminal** | PTY tương tác qua `terminal.*` RPC/event | xterm | **node-pty + @xterm/xterm** |

### Diff
**Session-scoped:** chỉ hiện file mà session này đã ghi/sửa (step `tool` ∈ write/edit/save,
lấy `step.target` = `file_path` absolute → strip `workspaceRoot` thành relative, gồm cả
step của subagent) **giao** với `git.status` (working tree). `GitDiffViewer` toggle
unified/split. Auto-refresh debounce 200ms khi nhận `git:status:changed`. NO_REPO →
empty-state; session chưa đụng file nào → "no file changes from this session".

### Plan
Approve/Reject map vào **permission request ExitPlanMode đang park** → `sessions.permission`.
Chỉ hiển thị nút khi có pending permission cho session với `toolName` khớp `/exitplanmode|plan/i`.
Approve → SDK exit plan → store tự flip `mode` (convention sẵn có). Câu hỏi mở: plan
hiển thị mà không có request park (xem dưới).

### Terminal
**Multi-tab:** [WorkspaceTerminalTab.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceTerminalTab.vue) là manager — tab strip (+ tạo / X xóa / double-click đổi tên / click chuyển), mỗi tab là 1 [WorkspaceTerminalInstance.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceTerminalInstance.vue) (always-mounted, `v-show` active → PTY sống khi chuyển tab). Xóa tab cuối = đóng drawer.
xterm UI ↔ `terminal.create/write/resize/kill/list` + event `terminal.data`/`terminal.exit`.
PTY manager sidecar: [src/terminal/manager.ts](../../apps/desktop/sidecar/src/terminal/manager.ts) —
`Map<terminalId, …>`, idle-kill 30′, cleanup ở SIGTERM/SIGINT. node-pty nạp **dynamic
import + graceful fallback** → chưa cài/lỗi thì tab báo "unavailable", tab khác không sao.

## RPC & Event mới (sidecar)

**fs.* (read-only):**
- `fs.listDir {workspaceRoot, path?}` → `{entries: FsEntry[]}` — readdir 1 cấp, skip `.git`, `assertInsideWorkspace` mỗi entry.
- `fs.readFile {workspaceRoot, path, maxBytes?}` → `{path, content, language?, truncated, isBinary}` — cap 512KB (hard 4MB), null-byte sniff.
- `fs.listFiles {workspaceRoot}` → `{files: FsEntry[], truncated}` — flat index cho `@file` mention (git ls-files + walk fallback). *(thêm bởi composer feature, dùng chung type)*

**terminal.*** ([ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)):
- `terminal.create {workspaceRoot, sessionId, cols, rows}` → `{terminalId}`
- `terminal.write {terminalId, data}` / `terminal.resize {terminalId, cols, rows}` / `terminal.kill {terminalId}` / `terminal.list {sessionId?}`
- Event: `terminal.data {terminalId, sessionId, chunk}`, `terminal.exit {terminalId, sessionId, exitCode, signal?}`

## Bảo mật (invariant)

- `fs.*` + PTY: `assertInsideWorkspace` (resolve absolute + startsWith + reject `..`/symlink-escape), `workspaceRoot` phải absolute.
- Terminal: cwd **luôn** = workspaceRoot; shell binary cố định (`$SHELL`/default), arg array rỗng (không cmd-injection); `data` là byte opaque vào stdin PTY.
- **Env strip trước `pty.spawn`**: xoá `CLAUDE_CODE_OAUTH_TOKEN`/`*_API_KEY` + mọi key `/(_TOKEN|_KEY|_SECRET)$/i` (invariant #1 — shell không `echo` được token).
- Cap 5 PTY/session + idle-kill; PTY không persist (đúng restart-safe).

## Types mới
- UI [types/index.ts](../../apps/desktop/ui/types/index.ts): `WorkspaceTab`, `FsEntry`, `FsFileContent`, `TerminalSessionRef`, `WorkspaceBackgroundTask`.
- Sidecar [src/types/shared.ts](../../apps/desktop/sidecar/src/types/shared.ts): `FsEntry`, `FsFileContent`. `TerminalSessionRef` trong [terminal/manager.ts](../../apps/desktop/sidecar/src/terminal/manager.ts).

## Verify

- `cd apps/desktop/ui && pnpm typecheck && pnpm lint` — sạch (lỗi McpDetail/graph là pre-existing, không liên quan).
- `cd apps/desktop/sidecar && pnpm typecheck` — sạch.
- node-pty smoke test: spawn shell, gõ lệnh, nhận output, exit 0 — **đã verify** sau khi đảm bảo `prebuilds/<platform>/spawn-helper` có quyền `+x`.
- Thủ công (app desktop, session gắn project): nút header mở dropdown menu → chọn/phím tắt mở từng drawer; resize persist qua reload; Diff chỉ hiện file session đã đụng + auto-refresh; Files lazy-expand + preview file lớn/binary có flag; Plan approve/reject đổi mode; Terminal `pwd` = workspaceRoot, `echo $CLAUDE_CODE_OAUTH_TOKEN` rỗng.

## Rủi ro & câu hỏi mở

1. **Plan approve correlation** — khi plan hiển thị mà không có permission request park: hiện không hiện nút (read-only). Cần product/BA chốt: local flag hay auto-send follow-up "proceed".
2. **node-pty đóng gói** — prebuild ship sẵn nhưng `spawn-helper` cần `+x` (pnpm v10 + node-pty 1.1.0 không tự set). Pipeline bundle sidecar runtime ([ADR 0007]) phải đảm bảo `+x`. Đã thêm `node-pty: true` vào `pnpm-workspace.yaml > allowBuilds`.
3. **Diff session-scoped** = file session ghi/sửa ∩ working tree. Nếu agent đổi file qua Bash (không qua Write/Edit) thì step không bắt được → file đó không hiện. Chấp nhận ở MVP (đa số sửa qua Write/Edit/MultiEdit).
4. **Files refresh** — chưa có project-wide watcher; MVP nút refresh thủ công. Mở rộng chokidar watch repo → deferred (lo event storm repo lớn).
5. **Preview web dev-server** — deferred (cần Tauri webview + port detect + task registry).
6. **Background-task registry** persistent sống qua nhiều turn — deferred (đổi runtime model, cần ADR riêng).
7. **infosec review** Terminal trước merge (đụng exec + IPC + env) — chưa chạy.
