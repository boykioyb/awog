# Feature: Project Code Workspace (in-app IDE)

**Trạng thái:** Draft (chờ approve)
**Ngày:** 2026-06-02
**Liên quan:** [projects.md](./projects.md) · [workspace-panel.md](./workspace-panel.md) · [git-manager.md](./git-manager.md) · [ADR 0021](../decisions/0021-monaco-code-editor.md) · [ADR 0022](../decisions/0022-fs-read-write-search-ipc.md)

## Vấn đề & Mục tiêu

Phần **Projects** hiện chỉ là màn hình metadata (tên / path / branch / language / task list). Muốn xem chi tiết, research hay sửa một file, người dùng vẫn phải mở VSCode. Khả năng chạm file duy nhất trong AWOG nằm ở **Sessions → Workspace Panel** và ở đó cũng **read-only**.

Mục tiêu: một **code workspace full-screen** mở từ một Project, đủ để **bỏ hẳn VSCode cho luồng làm việc cơ bản** — duyệt cây file, xem, tìm kiếm toàn project, sửa + lưu, tạo/xóa/đổi tên, chạy terminal, xem & commit git — tất cả trong AWOG, local-first.

## User Stories

- Là người dùng, tôi muốn mở một project và duyệt cây file ngay trong AWOG.
- ... mở nhiều file thành tab và sửa code với syntax highlight + autocomplete + multi-cursor.
- ... lưu file (Cmd/Ctrl+S) trực tiếp xuống đĩa.
- ... tạo / xóa / đổi tên file & thư mục từ explorer.
- ... tìm kiếm chuỗi hoặc regex trên toàn project (find-in-files) và nhảy tới kết quả.
- ... mở terminal chạy ngay trong thư mục project.
- ... xem git diff/status và commit mà không rời app.

## Functional Behavior

### Entry & Route

- Projects detail thêm action **Open in Editor** (icon `Code`, icon-only theo UI pattern) → `navigateTo('/projects/<id>/code')`.
- Route mới `pages/projects/[id]/code.vue` với `definePageMeta({ layout: false })` (full-screen, không NavRail/TopBar).
- `workspaceRoot = project.path`. Nếu path không tồn tại → empty state **"Path missing"** + nút mở lại Projects (đồng bộ open question của [projects.md](./projects.md)).
- Logic page đẩy vào composable `useProjectWorkspace()` (page-controller pattern — page chỉ còn template + destructure).

### Layout (VSCode-style)

```
┌─ Activity ─┬─ Side panel ──┬─ Editor area ─────────────────┐
│ Explorer   │ EXPLORER      │  app.vue ×  store.ts ●         │  ← tab strip (dirty ●)
│ Search     │  ▸ src        │  1  <template>                │
│ SourceCtrl │  ▸ docs       │  2    ...                     │  ← Monaco
│            │  README       │  3  </template>               │
├────────────┴───────────────┴───────────────────────────────┤
│ TERMINAL                                          [+] [×]   │  ← bottom panel (collapsible)
│ $ pnpm dev                                                  │
├─────────────────────────────────────────────────────────────┤
│ ⌥ main   Ln 2, Col 5   Vue   UTF-8                          │  ← status bar
└─────────────────────────────────────────────────────────────┘
```

- **Activity bar** (icon rail): Explorer / Search / Source Control. Resizable + collapsible side panel (tái dùng pattern sidebar của Git Manager).
- **Explorer**: cây file lazy (`fs.listDir`), context menu (New File, New Folder, Rename, Delete, Reveal). Highlight file đang active. Bỏ qua `.git`.
- **Editor area**: tab strip multi-file + Monaco. Dirty = chấm tròn trên tab. Cmd/Ctrl+S lưu; Cmd/Ctrl+W đóng (confirm nếu dirty).
- **Bottom panel** (collapsible): Terminal (tái dùng `terminal.*` PTY). MVP chỉ Terminal; Problems để sau.
- **Source Control**: điều hướng/nhúng Git Manager sẵn có ở context `workspaceRoot` này.
- **Status bar**: branch hiện tại · vị trí con trỏ (Ln, Col) · ngôn ngữ file · encoding.

### Editor (Monaco — [ADR 0021](../decisions/0021-monaco-code-editor.md))

- **Lazy-load** Monaco (dynamic import, client-only — Nuxt `ssr: false`). Instance giữ trong `shallowRef`; dispose khi unmount / đóng tab.
- **Ngôn ngữ** theo phần mở rộng — tái dùng map ext→language đã có ở sidecar [fs.read-file.ts](../../apps/desktop/sidecar/src/methods/fs.read-file.ts), trả qua `FsFileContent.language`.
- **Theme** map từ `useTheme()` tokens → `monaco.editor.defineTheme` (đồng bộ dark/light + theme preset của app, không hardcode hex).
- **Tính năng**: syntax highlight, autocomplete built-in, multi-cursor, find/replace trong file (Cmd+F), bracket match, minimap (toggle). LSP/go-to-definition cross-file: out of scope MVP.
- **Markdown preview**: khi tab đang mở là file `.md` (language `markdown`), tab strip hiện toggle 3 chế độ **Editor / Split / Preview** (ghim bên phải). Preview render live theo nội dung đang gõ qua `MarkdownRenderer` (tái dùng — AST tự viết, theme-aware, hỗ trợ mermaid; cùng renderer với artifact editor). View mode được nhớ khi chuyển giữa các file markdown; file không phải markdown luôn hiển thị dạng `code`. Monaco giữ mounted (`v-show`) ở chế độ Preview-only để không mất model/undo.
- File > size cap hoặc binary → mở **read-only** + notice "open externally".

### File operations

- **New File / New Folder** — explorer context menu.
- **Rename** — inline trong cây.
- **Delete** — confirm modal; **reject xóa `workspaceRoot`**.
- **Save** — `fs.writeFile` atomic (`.tmp` + rename). Dirty indicator + cảnh báo khi rời route còn unsaved.
- **External change reconciliation**: watcher project-wide báo file đổi ngoài app → tab **không** dirty: reload nội dung; tab **dirty**: cảnh báo conflict (giữ bản đang sửa, cho chọn reload/giữ).

### Find-in-files (Search panel)

- Input query + toggle: **regex**, **case-sensitive**, **whole-word**, **include/exclude glob**.
- Kết quả gom theo file, click → mở file + nhảy tới dòng/cột + highlight.
- Backend `fs.search` (xem [ADR 0022](../decisions/0022-fs-read-write-search-ipc.md)): `git grep` cho repo (tôn trọng `.gitignore`), fallback node walk cho non-git dir. Cap số kết quả + wallclock.

### Tích hợp với Sessions (bridge, không merge)

Hai surface giữ riêng (session = đồng hành agent/overlay đọc context; workspace = người tự code/full-screen) nhưng:
- **Cầu nối**: route nhận deep-link `/projects/:id/code?file=<path>` — mở thẳng file đó khi Monaco ready. Session **Files tab** thêm nút *"Open in editor"* (chỉ khi session gắn `projectId`) → điều hướng sang workspace với file đang xem.
- **Editor dùng chung**: Files tab của session đổi từ line-renderer read-only sang **`MonacoEditor` (read-only)** — nhất quán syntax highlight + jump-to-line (`revealPosition`) cho chat link `path#Lnn`. Vai trò panel không đổi (vẫn read-only đọc context).

### Terminal & Git

- **Terminal**: tái dùng `terminal.*` (ADR 0019) với `workspaceRoot = project.path`. *Lưu ý:* `terminal.create` hiện đòi `sessionId` — cần nới để gắn theo `projectId`/không session (xem Câu hỏi mở).
- **Git**: tái dùng toàn bộ Git Manager (đã có 24 method `git.*`) ở context project này.

## IPC Contract (mới)

### Mở rộng `fs.*` từ read-only → read-write + search ([ADR 0022](../decisions/0022-fs-read-write-search-ipc.md))

| Method | Payload | Trả về |
|---|---|---|
| `fs.writeFile` | `{workspaceRoot, path, content}` | `{bytesWritten}` |
| `fs.createFile` | `{workspaceRoot, path}` | `{ok}` (fail nếu đã tồn tại) |
| `fs.createDir` | `{workspaceRoot, path}` | `{ok}` |
| `fs.rename` | `{workspaceRoot, fromPath, toPath}` | `{ok}` |
| `fs.delete` | `{workspaceRoot, path, recursive?}` | `{ok}` |
| `fs.search` | `{workspaceRoot, query, regex?, caseSensitive?, wholeWord?, includeGlob?, excludeGlob?, maxResults?}` | `{matches: [{path, line, column, preview}], truncated}` |

Tất cả đi qua `assertInsideWorkspace` ([path-sanitize.ts](../../apps/desktop/sidecar/src/git/path-sanitize.ts), đã có). Write = atomic `.tmp` + rename. Có size cap. Composable [`useFsApi`](../../apps/desktop/ui/composables/useFsApi.ts) mở rộng các method tương ứng.

### Watcher project-wide

- Sidecar watch `workspaceRoot` (chokidar, debounce ~300ms, dùng lại pattern [watcher.ts](../../apps/desktop/sidecar/src/watcher.ts)) → emit `fs:changed {workspaceRoot, path, type}`. UI cập nhật cây + reconcile tab đang mở.

## Security (8 invariant — [.claude/rules/security.md](../../.claude/rules/security.md))

- **#2 Path sanitize**: mọi method qua `assertInsideWorkspace` (resolve absolute + `startsWith` + reject `..` + chặn symlink ra ngoài). Write không được ghi đè ngoài workspace.
- **#4 IPC boundary**: UI **không** `import fs`/`child_process`; mọi thao tác qua sidecar.
- **Write + delete + search(exec git grep)** là bề mặt mutation/exec mới → **infosec review bắt buộc trước merge** (agent `infosec` + skill `security-audit`).
- `git grep`: arg array (không shell string), validate độ dài/ký tự query, allowlist subcommand.
- `fs.delete`: reject `path === workspaceRoot`; confirm ở UI; cân nhắc move-to-trash (Câu hỏi mở).
- **Monaco workers**: chỉ local asset bundle, **không CDN** (invariant #5 no telemetry / no external host).

## Dependencies (mới)

- `monaco-editor` (UI) — [ADR 0021](../decisions/0021-monaco-code-editor.md), + cấu hình worker trong Vite (client-only).
- **Search**: không thêm dependency — dùng system `git grep` + node fallback. (ripgrep đã cân nhắc nhưng từ chối để tránh thêm native binary.)

## Storage

Không thêm storage layer mới. Editor state (tab đang mở, layout panel, kích thước) → `localStorage` per project (giống [workspacePanel store](../../apps/desktop/ui/stores/workspacePanel.ts)). Nội dung file = nguồn chân lý trên đĩa.

## Out of Scope (MVP)

- IntelliSense ngôn ngữ-aware nâng cao (LSP), go-to-definition cross-file, debugger.
- Extensions / plugin marketplace.
- Remote / SSH workspace.
- Drag-drop upload, image/binary editor.
- 3-way merge editor (Git Manager đã lo conflict cơ bản).

## Câu hỏi mở

- ~~`terminal.create` đòi `sessionId`~~ → **Đã giải quyết:** tái dùng nguyên `terminal.*` với khóa nhóm tổng hợp `proj:<projectId>` (sidecar coi `sessionId` là opaque grouping key, event lọc theo `terminalId` nên không đụng); `WorkspaceTerminalInstance` được tổng quát hóa prop `session: Session` → `sessionId: string`. Không cần đổi contract sidecar.
- `fs.delete`: hard delete vs OS trash? Đề xuất trash nếu khả thi, fallback confirm + hard delete.
- Size cap khi **mở để edit** (hiện read cap 512KB) — có nâng cho edit không?
- "Save All" + format-on-save → để sau MVP.

## Acceptance Criteria

- **AC1 — Browse**: mở project → thấy cây file, expand lazy, không hiển thị `.git`.
- **AC2 — Open + view**: click file text → mở tab Monaco đúng ngôn ngữ highlight; binary/oversize → read-only notice.
- **AC3 — Edit + save**: sửa + Cmd/Ctrl+S → ghi xuống đĩa (verify `git status` thấy modified). Reload route → nội dung mới persist.
- **AC4 — Multi-tab**: mở nhiều file, chuyển tab giữ trạng thái, dirty indicator đúng, đóng tab dirty → confirm.
- **AC5 — New/rename/delete**: tạo file/thư mục, đổi tên, xóa (confirm) → cây + đĩa cập nhật. Thao tác ngoài `workspaceRoot` (path `..`) → reject.
- **AC6 — Find-in-files**: search chuỗi → kết quả gom theo file, click nhảy đúng dòng; regex + case toggle hoạt động; cap kết quả hiển thị rõ ("hiện N/total").
- **AC7 — Terminal**: mở terminal, `cwd = project.path`, chạy lệnh OK.
- **AC8 — Git**: Source Control thấy đúng status/diff của project, commit được.
- **AC9 — External change**: sửa file ngoài app → cây refresh; tab không dirty → reload; tab dirty → cảnh báo.
- **AC10 — Security**: mọi fs method với path `..`/ngoài workspace → reject; API key/OAuth không xuất hiện trong env terminal.
