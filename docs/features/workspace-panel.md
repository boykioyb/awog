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

**Split pane + tab bar (multi-tab).** Nút `PanelRight` ở header mở **dropdown menu** ([WorkspaceMenu.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceMenu.vue): Preview/Diff/Terminal/Files/Background tasks/Plan + phím tắt). Chọn 1 mục → **mở thêm 1 tab** ở panel; **nhiều tab mở đồng thời** (vd Files + Terminal cùng lúc), strip tab ở đầu panel để chuyển/đóng từng tab + nút `+` mở tab mới. Panel là **split pane inline** — đẩy chat sang bên, **không** phủ đè.

```
SessionChat (flex, relative) — layoutClass theo position (flex-row / flex-row-reverse / flex-col)
├── Chat column (flex-1 min-w-0 min-h-0 relative)   ← info panel / step drawer / lightbox float LÊN cột này
│   ├── SessionHeader → nút PanelRight → WorkspaceMenu (dropdown)
│   ├── SessionMessageList
│   └── SessionComposer
└── SessionWorkspacePanel (v-if openTabs.length)     ← SPLIT PANE: flex-shrink-0, co chat lại (không overlay)
    ├── resizer (kéo = rộng/cao ra, cap = chừa MIN_CHAT_PX cho chat)
    ├── tab strip (chip mỗi tab: icon + label + ✕; nút + = WorkspaceMenu thêm tab)
    └── mỗi open tab mount đồng thời (v-show tab active) ← giữ Terminal/Files sống khi đổi tab
```

- State: [stores/workspacePanel.ts](../../apps/desktop/ui/stores/workspacePanel.ts) — `position` (right/left/bottom) + `widthPx` + `heightPx` global (localStorage); per-session: `openTabsBySession[id]` (mảng tab mở, có thứ tự) + `activeTabBySession[id]` (tab đang hiện, null = panel đóng). Actions: `openDrawer` (thêm+active), `setActiveTab` (đổi tab hiện), `closeTab` (đóng 1 tab → active fallback sang neighbor), `closeDrawer` (đóng tab active — giữ cho call-site cũ), `closePanel` (đóng cả panel — khi Info panel chiếm dock), `toggleDrawer` (phím tắt), `setPosition`.
- Mỗi tool dùng [WorkspaceDrawerHeader.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceDrawerHeader.vue) (title + actions slot + **position picker** dock phải/trái/dưới + close tab active).
- **Vị trí dock:** split pane neo `right` (mặc định) / `left` / `bottom`; resizer đổi trục theo vị trí (kéo rộng/cao), clamp để chat luôn còn ≥ `MIN_CHAT_PX`; double-click resizer = reset.
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
| **Info** | Metadata session (meta + project + context files) qua `useSessionInfo` | `SessionInfoSection`, `SessionInfoFileRow` | — |

> **Info** là tab duy nhất chạy **không cần project** (`tabNeedsRoot=false`). Trước đây là overlay riêng (`stores/sessionInfoPanel.ts`); nay gộp vào panel chung như một tab. Nút Info ở `SessionHeader` `toggleDrawer('info')`; mở context file dùng inject `OPEN_ATTACHMENT_KEY` (SessionChat cấp lightbox).

### Diff
**Session-scoped:** chỉ hiện file mà session này đã ghi/sửa (step `tool` ∈ write/edit/save,
lấy `step.target` = `file_path` absolute → strip `workspaceRoot` thành relative, gồm cả
step của subagent) **giao** với `git.status` (working tree). `GitDiffViewer` toggle
unified/split. Auto-refresh debounce 200ms khi nhận `git:status:changed`. NO_REPO →
empty-state; session chưa đụng file nào → "no file changes from this session".

### Files
Cây thư mục lazy (1 cấp/expand) + preview file. Preview render **theo dòng có số** (`whitespace-pre`) thay vì `<pre>` đơn khối → cho phép cuộn tới + highlight dòng mục tiêu.
**Open-at-line từ chat:** click link path trong reply (vd `apps/api/foo.py#L42`) gọi `workspacePanel.requestOpenFile(sessionId, path, line)` → mở Files drawer + watcher trong tab `readFile` path, select, `scrollIntoView` + tô nền dòng `line`. Click thủ công trong cây thì không highlight (clear `targetLine`).

**Context menu (chuột phải vào file/folder trong cây):** dùng [ContextMenu.vue](../../apps/desktop/ui/components/ContextMenu.vue) chung. Actions: **Rename** (inline input trong node, `fs.rename`), **Copy Path** (tuyệt đối) / **Copy Relative Path** (workspace-relative, qua `navigator.clipboard`), **Reveal in OS** (`shell.revealPath`), **Open in VS Code** (chỉ hiện khi CLI `code` khả dụng — `shell:vscodeAvailable`/`shell:openInVscode` ở Electron main, [vscode.ts](../../apps/desktop/electron/src/vscode.ts) probe vị trí cài đặt theo OS rồi `spawn` arg-array, không shell), **Delete** (confirm modal, `recursive` cho dir). Sau rename/delete reload thư mục cha + repoint/clear preview. Logic tách vào composable [useWorkspaceFiles.ts](../../apps/desktop/ui/composables/useWorkspaceFiles.ts) (component giữ thin theo nuxt-vue page-controller).

**Fullscreen file viewer:** nút Maximize trên thanh toolbar của file (khi file không phải binary) mở [FileFullscreenModal.vue](../../apps/desktop/ui/components/workspace/FileFullscreenModal.vue) — overlay `Teleport`/`fixed inset-0` (z-100, dưới mermaid zoom z-120), toggle preview/raw, copy, Esc/click-ngoài để đóng. Markdown render qua `MarkdownRenderer` (đọc thoải mái ở cột `max-w-3xl`), file khác render `<pre>`. Dùng để thoát panel hẹp khi đọc file dài.

**HTML/PDF preview + Show in browser:** file `.html`/`.htm`/`.pdf` có thêm nút **Preview** (toggle inline trong panel) và **Show in browser** (Globe). Preview render qua [FilePreviewFrame.vue](../../apps/desktop/ui/components/workspace/FilePreviewFrame.vue): HTML → `<iframe srcdoc sandbox="allow-scripts allow-popups allow-forms allow-modals">` (chạy JS trong **origin opaque**, KHÔNG `allow-same-origin` → render được nội dung do JS sinh nhưng không chạm được app://; asset tương đối vẫn không resolve → full-fidelity là "Show in browser"); PDF → đọc `fs.readFileBase64` → Blob `application/pdf` → `<iframe>` cho Chromium tự render (quá cap → báo "mở bằng browser"). PDF luôn ở chế độ preview (binary, không có raw); HTML có toggle preview/raw. Fullscreen modal cũng render được HTML/PDF (truyền `workspaceRoot`).

**Mermaid zoom (mọi surface):** [MermaidBlock.vue](../../apps/desktop/ui/components/markdown/MermaidBlock.vue) (renderer dùng chung bởi `MarkdownRenderer` — Files preview, artifact editor, code workspace preview, phase output, plan, attachment, modal body…) có nút **Expand** (hover) mở [MermaidZoomModal.vue](../../apps/desktop/ui/components/markdown/MermaidZoomModal.vue): fullscreen + zoom nút/`%` + **scroll-to-zoom** (anchored con trỏ) + drag-to-pan + Esc. Trước đây chỉ chat session có zoom; nay mọi sơ đồ mermaid đều phóng được.

### Plan
**Decoupled khỏi permission gate** (Pi runtime, ADR 0029): ở plan mode, runtime inject tool
`ExitPlanMode` + plan-mode system prompt. Model nghiên cứu read-only rồi gọi `ExitPlanMode({plan})`;
[event-adapter](../../apps/desktop/sidecar/src/runtime/event-adapter.ts) map call này thành
`kind:'plan'` step (parse `planItems`/`planRationale` từ markdown trong [step-mapper](../../apps/desktop/sidecar/src/sessions/step-mapper.ts) `stepFromPlan`), tool `terminate` → kết thúc turn chờ duyệt.
Approve/Reject hành động thẳng trên plan step (không qua `sessions.permission`): `store.resolvePlan(sessionId, stepId, decision)`.
**Approve** → `planStatus='approved'` + flip `mode='execute'` + tự gửi turn tiếp tục → model chạy.
**Reject** → `planStatus='rejected'`. Nút hiện khi `planStatus` còn `pending`. Surface kép: card inline trong [StepItem.vue](../../apps/desktop/ui/components/phase/StepItem.vue) (qua inject `RESOLVE_PLAN_KEY`) + tab Plan.

### Terminal
**Multi-tab:** [WorkspaceTerminalTab.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceTerminalTab.vue) là manager — tab strip (+ tạo / X xóa / double-click đổi tên / click chuyển), mỗi tab là 1 [WorkspaceTerminalInstance.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceTerminalInstance.vue) (always-mounted, `v-show` active → PTY sống khi chuyển tab). Xóa tab cuối = đóng drawer.
xterm UI ↔ `terminal.create/write/resize/kill/list` + event `terminal.data`/`terminal.exit`.
PTY manager sidecar: [src/terminal/manager.ts](../../apps/desktop/sidecar/src/terminal/manager.ts) —
`Map<terminalId, …>`, **không idle-kill** (shell sống tới khi user đóng; xem
[ADR 0019 § Cập nhật](../decisions/0019-pty-terminal-in-sidecar.md#cập-nhật-2026-08-09--bỏ-idle-kill--vòng-đời-shell)),
cleanup ở SIGTERM/SIGINT. node-pty nạp **dynamic
import + graceful fallback** → chưa cài/lỗi thì tab báo "unavailable", tab khác không sao.

**Shell chết ≠ pane treo.** Khi PTY thoát (`exit`, process chết) hoặc engine restart
(`engine.crashed`/`engine.restarted` → mọi `terminalId` thành stale), pane được đánh dấu
`exited`: in `[… — nhấn phím bất kỳ để mở shell mới]`, giữ nguyên scrollback, và **phím
bấm kế tiếp spawn shell mới** trong chính xterm đó. Resize KHÔNG tự hồi sinh shell user đã
đóng. Write/resize RPC lỗi `Unknown terminal` cũng chuyển pane sang `exited` (phòng khi mất
event) — trước đây lỗi bị nuốt im lặng nên pane trông sống mà gõ không ăn.

## RPC & Event mới (sidecar)

**fs.* (read-only):**
- `fs.listDir {workspaceRoot, path?}` → `{entries: FsEntry[]}` — readdir 1 cấp, skip `.git`, `assertInsideWorkspace` mỗi entry.
- `fs.readFile {workspaceRoot, path, maxBytes?}` → `{path, content, language?, truncated, isBinary}` — cap 512KB (hard 4MB), null-byte sniff.
- `fs.readFileBase64 {workspaceRoot, path, maxBytes?}` → `{path, base64, mimeType, size, truncated}` — bytes base64 cho in-app preview HTML/PDF (cap 10MB, hard 25MB; quá cap trả `base64:''` + `truncated:true` để UI fallback "Show in browser"). `assertInsideWorkspace`.
- `fs.listFiles {workspaceRoot}` → `{files: FsEntry[], truncated}` — flat index cho `@file` mention (git ls-files + walk fallback). *(thêm bởi composer feature, dùng chung type)*

**Electron IPC (shell):** `shell:openFileExternal {root, path}` — validate `resolveInsideWorkspace` rồi `shell.openExternal(pathToFileURL(abs))` → mở file workspace bằng **trình duyệt mặc định** (khác `shell:openExternal` vốn chỉ cho http/mailto). Dùng cho "Show in browser" HTML/PDF.

**terminal.*** ([ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)):
- `terminal.create {workspaceRoot, sessionId, cols, rows}` → `{terminalId}`
- `terminal.write {terminalId, data}` / `terminal.resize {terminalId, cols, rows}` / `terminal.kill {terminalId}` / `terminal.list {sessionId?}`
- Event: `terminal.data {terminalId, sessionId, chunk}`, `terminal.exit {terminalId, sessionId, exitCode, signal?}`

## Bảo mật (invariant)

- `fs.*` + PTY: `assertInsideWorkspace` (resolve absolute + startsWith + reject `..`/symlink-escape), `workspaceRoot` phải absolute.
- Terminal: cwd **luôn** = workspaceRoot; shell binary cố định (`$SHELL`/default), arg array rỗng (không cmd-injection); `data` là byte opaque vào stdin PTY.
- **Env strip trước `pty.spawn`**: xoá `CLAUDE_CODE_OAUTH_TOKEN`/`*_API_KEY` + mọi key `/(_TOKEN|_KEY|_SECRET)$/i` (invariant #1 — shell không `echo` được token).
- Cap 20 PTY/session (abuse guard — 1 host có nhiều tab × nhiều pane); **không** idle-kill; PTY không persist qua restart sidecar (đúng restart-safe).
- Env strip thêm `ELECTRON_RUN_AS_NODE`/`NODE_OPTIONS` (sidecar chạy bằng `electron --run-as-node`, rò sang shell sẽ phá `node`/`electron` user gõ); set `TERM_PROGRAM=AWOG`, `COLORTERM=truecolor`, `LANG` fallback.
- **Reveal / Open in VS Code**: chạy ở Electron main (không phải sidecar), path qua `resolveInsideWorkspace` trước khi `shell.showItemInFolder`/`spawn`; `code` binary resolve từ allowlist vị trí cài đặt theo OS, `spawn` arg-array (không shell string, không nhận input ngoài 'code' cho probe) → không cmd-injection.

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
