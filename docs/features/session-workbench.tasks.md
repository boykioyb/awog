# Session Workbench — task breakdown

Nguồn chân lý: `docs/decisions/0098-session-workbench-ide-layout.md` + prototype `docs/features/ui-redesign-workbench-proto.html`.

## Nguyên tắc chung (mọi slice tuân theo)

- TS strict, không `any`, `<script setup>`, `useTheme()` cho màu — đọc `docs/coding/nuxt-frontend.md`.
- Đặt tên: component `PascalCase.vue`, composable `useXxx.ts`, file `kebab-case`.
- Component mới vào `components/workbench/`, composable mới `useWorkbench*.ts` trong `composables/`, store `stores/workbench.ts`.
- Không sửa file ngoài `scope` của mình; file chia sẻ (`types/index.ts`, `pages/sessions.vue`, `layouts/default.vue`) do integrator chốt.
- Chạy `pnpm typecheck` + `pnpm lint` trong `apps/desktop/ui-next` trước khi bàn giao.
- Text UI hiển thị: tiếng Việt như hiện trạng app; comment kỹ thuật tiếng Việt.

## Contract chia sẻ (integrator tạo trước, mọi slice import)

```ts
// types/workbench.ts — do integrator viết, slice chỉ dùng
export type WorkbenchDocKind = 'chat'|'file'|'md'|'web'|'img'|'mmd'|'settings'|'monitor'|'task'
export interface WorkbenchDoc { kind: WorkbenchDocKind; id: string; title: string; pin?: boolean; dirty?: boolean; browId?: string; nav?: string }
export type DockView = 'Terminal'|'Diff'|'Tasks'|'Team'
export type SideView = 'files'|'scm'|'gh'
```

```ts
// stores/workbench.ts — do integrator viết
docs: WorkbenchDoc[]; activeDoc: string; selPath: string
dockView: DockView; dockH: number; dockHidden: boolean
termTabs: { id,title,cwd }[]; termActive: string
curProject: string; sideView: SideView; sideClosed: boolean
openDoc(d), closeDoc(id), openFile(path), openWebTab(tab), toggleDock(), toggleSide(), setView(v)
```

---

## Slice A — Shell layout + store (integrator làm, các slice khác đợi)

Tạo khung: `stores/workbench.ts`, `types/workbench.ts`, `components/workbench/WorkbenchView.vue` (grid 5 vùng), `pages/workbench.vue` (route tạm `/workbench`, `layout:false`). Stage = 2 hàng tab (session strip placeholder + doc tabs placeholder) + `<component :is>` surface rỗng; dock placeholder 34–480px kéo được + checklist rail phải 210px.

**Acceptance**: `/workbench` render khung đúng tỉ lệ ảnh prototype; ⌘B toggle explorer panel, ⌘J toggle dock; typecheck 0 lỗi.

## Slice B — Explorer (files/SCM/GH views + view rail)

`components/workbench/explorer/`: `ExplorerPanel.vue` (toolbar: filter input, new file, new folder, refresh, collapse-all, close), `ExplorerTree.vue` (lazy children theo `fs.listDir`, section Changed files từ `useGitStore.dirtyCount`/status), `ExplorerCtxMenu.vue` (VS Code parity: mở/mở split/Finder/terminal/cut/copy/rename/delete/copy path), `SourceControlView.vue` (reuse git store: staged/unstaged rows, commit box, AI gen popover mock hook tới `git.commitMsg` nếu có), `GithubView.vue` (list PR/issue từ `useGhInbox`/`gh.*`, click → `openWebTab`), view rail `.svrail` 26px trong `WorkbenchView` (component `ViewRail.vue`).

`useWorkbenchExplorer.ts`: tree state, `selPath`, expand/collapse, `startNewEntry(isDir)` inline input (commit tạo `fs.createFile`/`fs.createDir`, hỗ trợ `a/b/c.ts`, Esc hủy, trùng → đỏ), `fs.fs-changed` → refresh.

**Đổi project (2026-10-13):** cây của project vừa rời được cất vào cache LRU 8 project (`treeCache`: children đã load + thư mục đang mở + node đang chọn). Quay lại ⇒ vẽ NGAY từ bản cất rồi nạp lại nền mọi dir đã load (watcher chỉ theo project hiện tại nên thay đổi lúc vắng mặt phải nạp lại); listDir trả y hệt thì giữ mảng cũ để không vá lại cây. Git scope + watcher + dò repo con chạy SONG SONG ở nền thay vì tuần tự trước khi nạp root. `loadDir`/`loadRepoEntries` bỏ kết quả về muộn của project cũ (chuyển nhanh không còn lẫn cây).

**Tìm file (2026-10-13):** ô "Tìm file…" của view Files không còn làm mờ node trong thư mục đã mở (cũ: `filter` + `litPaths` + `isDim` — đã xoá). Focus ⇒ ô giãn hết bề ngang, nhóm nút trượt ẩn (`max-width`/`opacity`, `inert` khi ẩn); có chữ ⇒ cây được thay bằng danh sách file khớp của CẢ project (`composables/useFileFinder.ts`: `fs.listFiles` = `git ls-files`, trần 20k, cache theo root, làm tươi khi bắt đầu lượt tìm mà cache > 15s). Khớp **CHỈ theo tên file** (`utils/fuzzy.ts` `scoreFileName`: so dãy con trên phần sau `/` cuối, tên bắt đầu bằng chữ đang gõ xếp cao hơn) — thư mục chứa KHÔNG tham gia (người dùng chốt: gõ "issue" không được kéo mọi file trong thư mục `issues/`). Matcher `fuzzy` tách từ bảng lệnh ⌘K, giờ hai nơi dùng chung. ↑/↓ chọn, Enter/click mở doc (cây tự bung tới file), Esc xoá chữ rồi rời ô.

**Acceptance**: duyệt project thật; tạo/xóa/đổi tên file qua ctx menu + inline input; Changed files mở đúng doc file; SCM stage/unstage hoạt động.

## Slice C — Doc tabs + surfaces

`components/workbench/stage/`: `DocTabs.vue` (pin Trao đổi, dirty ●, close, ctx menu: đóng/đóng khác/đóng phải/copy path), surfaces: `DocFile.vue` (reuse `MonacoEditor` + `useCodeWorkspace` model cache), `DocMd.vue` (preview+edit seg), `DocWeb.vue` (reuse `useEmbeddedBrowser` attach + `BrowserNavBar` + pins), `DocImage.vue` (`fs.readFileBase64` fit/zoom), `DocMermaid.vue` (mermaid render + source seg), `DocSettings.vue` (embed `SettingsModal` internals hoặc `pages/settings.vue` sections — reuse `sections.ts`), `DocMonitor.vue` (embed `MonitorDisk`/`MonitorSystem` cards từ `pages/monitor.vue`).

`useWorkbenchDocs.ts`: open/close/pin/dirty, kind infer theo ext (`.md`→md, `.png/jpg/mp4`→img/vid, `.mmd`→mmd), max 12 doc, LRU close.

**Nạp lại từ đĩa (2026-10-14):** mọi doc file (`DocFile`/`DocMd`/`DocMermaid`/`DocImage`/`DocVid`) có nút nạp lại (`DocReloadButton.vue`) trên vbar. `useWorkbenchDocs.reloadFile` đọc lại KHÔNG qua trạng thái `loading` (editor/preview không nháy), có sửa chưa lưu thì hỏi trước; component đẩy nội dung mới vào model Monaco bằng `setValue` (không phát change ⇒ cờ dirty đúng), HTML/video tăng cache-buster. Cờ `WbFileState.diskChanged` đổi nút sang accent + nhãn "Đã thay đổi": text doc dò bằng so nội dung trên đĩa với `saved` khi có `fs:changed` của watcher explorer, khi chọn tab và khi cửa sổ lấy lại focus (doc `abs:`/project khác không có event); img/vid bật cờ thẳng khi có `fs:changed`. Cố ý KHÔNG tự nạp lại — người dùng bấm.

**Nhóm nút vbar:** `DocButtonGroup.vue` (Xem trước | Sửa, Sơ đồ | Mã nguồn, Thu nhỏ | Vừa khung | Phóng to, phạm vi monitor). ⚠ Không dùng `Button` của ui trong vbar `h-8`: Button mang `h-[var(--ctrl-h)]` 36px nên nhóm tràn khỏi thanh 32px — đúng lỗi "vỡ style" đã gặp ở md/mmd/img.

**Acceptance**: mở file .ts → Monaco; .md → preview; click PR trong GH view → doc web hiện nội dung; ctx tab hoạt động; settings/monitor render embed.

## Slice D — Dock + terminal multi-tab
⚠ Điều chỉnh sau khi đọc code: app ĐÃ CÓ `GlobalTerminalHost.vue` (516 dòng) — terminal dock toàn app, multi-tab PTY per-project, xterm, persist. Slice D **wrap `WorkspaceTerminal` với `pty-key="workbench:<projectId>"`** bên trong workbench dock (cùng pattern host toàn cục), KHÔNG viết PTY/xterm mới. Trên route `/workbench`, `GlobalTerminalHost` ở layout cần ẩn (`v-if` theo route) để tránh 2 dock chồng nhau; ⌘J trong workbench toggle dock của workbench.


`components/workbench/dock/`: `DockBar.vue` (view tabs, collapse/expand/close ⌘J, badge Diff), `DockTerminal.vue` (tab strip `zsh·pnpm dev·+`, per-tab xterm.js instance lazy `terminal.create`, `terminal.write/resize/kill`, close tab → kill PTY), `DockDiff.vue` (reuse `WorkspaceDiff`), `DockTasks.vue` (reuse `WorkspaceTasks`), `DockTeam.vue` (reuse `WorkspaceTeam`, chỉ hiện khi `session.agents`), `DockChecklist.vue` (rail phải: checklist strip từ `useSessionTodo`, click cycle state).

`useWorkbenchDock.ts`: dockH 34–480 drag, 3 trạng thái (full/collapse 34/hidden), `toggleDock`.

**Acceptance**: ≥2 terminal tab chạy PTY thật đồng thời (echo test); đóng tab active → nhảy tab kế; dock kéo mượt; checklist click cycle; Team xuất hiện/ẩn đúng `session.agents`.

## Slice E — Session strip + cross-project switching

`components/workbench/stage/SessionStrip.vue` (session tabs của project hiện tại: dot state, running spin, close → archive, `+` new, `▾` manager popover: list đóng/archive/cost/delete), `SessionSwitcher.vue` (⌘K overlay: input filter, list group "ĐANG MỞ — project" rồi từng project khác, ↑↓ Enter Esc, running trước), `ProjectCrumb.vue` (breadcrumb `project / Sessions ▾` → popover đổi project + đếm running + "mở thư mục").

`useSessionSwitcher.ts`: `allSessions()` (sessions store + `projects` store), `jumpSession(project, title)` — đổi `useWorkspaceStore.activeProject` rồi activate session.

**Acceptance**: ⌘K mở, gõ lọc được session project khác, Enter nhảy + activate đúng session; popover rail icon liệt kê đủ; toast "session xong project khác" → nút Mở session nhảy được.

## Slice F — Status bar + rail bottom (bell/theme/settings)

`components/workbench/WorkbenchStatusBar.vue`: quota donuts (reuse `useAccountUsage`/`StatusUsageRing`), monitor chip → `openDoc({kind:'monitor'})`, branch chip → ctx menu (fetch/pull/push/đổi/SCM/diff), context meter → menu (compact/summary/clear), project chip → switcher popover, account chip → menu (accounts + models + mở Settings→Models), toggles explorer/browser/dock, ⚙ settings → `openDoc({kind:'settings'})`.

`components/workbench/WorkbenchRail.vue` (thay nav rail mặc định trong workbench): logo, Sessions(⌘K hint+badge), Tasks, Git, Monitor, Wiki, spacer, 🔔 notif popover (reuse `useGhInbox` + `useAppNotify` feed, "đánh dấu đã đọc", click item → jump), ☀/🌙 theme toggle (`useTheme` thêm `mode` dark/light + `body[data-theme]`), ⚙, avatar `K` → menu profile.

**Acceptance**: mọi chip bấm được đúng menu/popover; theme đổi sáng/tối toàn app (tokens sáng mới); bell đếm đúng unread.

## Slice G — SessionDetail embed + cutover (làm SAU A–F, có thể vẫn song song phần prep)

- Refactor `SessionDetail.vue`: tách workspace panel phải (code di chuyển thành doc `web` + dock view — xóa `useWorkspacePanel` right-dock), thành `components/workbench/stage/DocChat.vue` wrapper giữ nguyên transcript/composer/checklist inject.
- `pages/sessions.vue` → redirect `/workbench`; route `/session?id=` popout giữ nguyên.
- **Trang mở đầu (2026-10-13):** `middleware/workbench-redirect.global.ts` đưa lần điều hướng KHỞI ĐỘNG tới `/` sang `/workbench` (cờ `booted` cấp module — ở SPA Nuxt chỉ chạy middleware từ cú `router.replace(force)` lúc `app:created`, khi đó `from` đã là `/` nên không dùng `from` để nhận ra lần đầu được). Bấm Home sau đó vẫn vào Home; ⌘R khi đang ở Home cũng là "khởi động" nên quay về workbench.
- KeepAlive `<NuxtPage>` không đổi; đảm bảo `useEmbeddedBrowser` detach đúng khi đổi doc.

**Acceptance**: chat hiển thị trong doc Trao đổi; mọi action transcript (rewind/fork/bookmark/⌘F) vẫn chạy; panel phải cũ biến mất khỏi SessionDetail.

## Wave plan

```
Wave 0 (tôi): types + store + WorkbenchView shell + route /workbench     [integrator]
Wave 1 (6 subagent song song):
  B explorer · C doc surfaces · D dock/terminal · E switcher · F statusbar · G-prep SessionDetail audit
Wave 2 (tôi + 1 subagent): G cutover embed chat + page redirect + keep-alive check
Wave 3 (tôi): typecheck + lint + browser verify toàn flow + cập nhật docs
```

## Tiến độ thực tế (2026-10-11)

Wave 0 + Wave 1 (B–G) đã land trên `/workbench`. Trạng thái nợ (chi tiết ở `workbench-embed-notes.md` §8):

1. ~~GlobalTerminalHost đè dock~~ — xong: `v-if="!isWorkbench"` ở `layouts/default.vue` + `useGlobalTerminal().setSuppressed` trong `WorkbenchDock`.
2. ~~`.docchat` position~~ — xong: `position:relative` neo `.dropzone` trong stage.
3. ~~`visible()`/`isActive()` chưa biết doc-visible~~ — xong: `SessionDetail` nhận prop `embedded`; `visible()` của `useEmbeddedBrowser` gate `!embedded`, `useSessionFind.isActive` thêm `wb.isChatActive` (⌘F không mở trên doc chat bị che).
4. ~~Main-tab strip web trùng doc tabs~~ — xong: `mtabs` + `mbpane` ẩn khi `embedded`; `useSessionMainTabs.openBrowserTab` trên route `/workbench` mở `web` doc (DocWeb pin theo `browId`) thay vì pin mtabs — state `activeTabs`/`DISCUSS_TAB` giữ nguyên.
5. ~~Workspace panel 3 mép chưa có prop tắt~~ — xong: panel trái/phải/dưới + nút Views + menu workspace ẩn khi `embedded`; `wpBridge.requested` được reroute: `Files`/`Plan` → explorer, `Browser` → `openNewWebDoc`, còn lại (`Terminal`/`Diff`/`Tasks`/`Team`) → `wb.dockView` + `dockHidden=false` + expand.
6. ~~`useSessionTerminalRun` repoint~~ — xong: không cần sửa; `visibleRunnerKey` của `WorkspaceTerminal` đã tự claim khoá `workbench:<tab>` khi dock Terminal hiển thị (claim/visible-first đúng cơ chế cũ), `openViews` của footer bridge không còn tác động ở embedded.
7. ~~`OVERLAYS`~~ — xong: thêm `.wbm` (ctx menu explorer) + `.wbcm-backdrop` (backdrop của WorkbenchContextMenu) vào `useEmbeddedBrowser.OVERLAYS`.
8. **Cutover `/sessions → /workbench`** — chưa làm; `/sessions` vẫn nguyên vẹn (prop `embedded` optional, path cũ bất biến). Cần verify trong Electron thật (PTY + session + browser tab + agent mở tab web) trước khi đổi redirect.

## Ước lượng

| Slice | Files | Ước lượng |
|---|---|---|
| A shell | 4 | nhỏ — tôi làm |
| B explorer | 5-6 | lớn (fs + git + gh) |
| C surfaces | 7-8 | lớn (Monaco + browser embed) |
| D dock | 5-6 | vừa (xterm reuse) |
| E switcher | 3-4 | vừa |
| F statusbar | 2-3 | vừa |
| G embed | 1-2 | rủi ro cao (touch 2627 dòng) |
