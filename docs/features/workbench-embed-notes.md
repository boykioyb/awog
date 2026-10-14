# Ghi chú nhúng `SessionDetail` vào Session Workbench (slice G)

Phục vụ [ADR 0098](../decisions/0098-session-workbench-ide-layout.md). Đây là audit
để integrator embed `SessionDetail.vue` (2627 dòng) thành doc `chat` trên stage mà
không vỡ — **không phải** kế hoạch refactor.

Nguồn đọc: `components/session/SessionDetail.vue`, `pages/sessions.vue`,
`components/session/SessionWorkspacePanel.vue`, `components/session/workspace/WorkspaceBrowser.vue`,
`components/session/workspace/WorkspaceTerminal.vue`, `composables/useWorkspacePanel.ts`,
`composables/useBrowserPanelSizing.ts`, `composables/useEmbeddedBrowser.ts`,
`composables/useSessionMainTabs.ts`, `composables/useSessionTerminalRun.ts`,
`composables/useSessionFind.ts`, `composables/useTranscriptSurface.ts`.

## 1. Phụ thuộc layout của SessionDetail lên khung chứa

`SessionDetail` tự định hình theo **hộp flex chứa nó** — root `.detail.sdrow` lấy
`flex:1; display:flex; flex-direction:row` từ `prototype.css:206` + override hàng
ngang ở `SessionDetail.vue:2033` (`.sdrow`). Chỗ chứa phải là một **flex column
`height:100%/min-height:0`** hoặc flex row — trong workbench đó là `.docchat`
(`components/workbench/stage/DocChat.vue`).

| Điểm | Dòng | Chi tiết |
|---|---|---|
| Panel trái/phải = sibling của cột chính | 26–46, 567–587 | `<SessionWorkspacePanel dock="left|right">` nằm **ngoài** `.sdmain`, chạy hết chiều cao khung — mô hình sidebar VS Code. Khi embed vào stage, hai panel này vẫn nằm trong stage (không tràn ra ngoài), nhưng chiếm mép stage. |
| Panel dưới trong `.chatwrap` | 543–563 | Dock bottom là hàng dưới của cột chính — cùng không gian mà dock mới của workbench sẽ chiếm ⇒ **trùng chức năng, xem §7**. |
| Kéo tay resize | 41–45, 544–548, 568–572; handler 1995–2020 | `.rszwp` `flex:0 0 6px`; `onWpResize` kẹp `WP_SIDE {240..560}` / `WP_BOTTOM {120..600}` và ghi `settings.setWorkspace{Left,Right,Bottom}…` — biên chia sẻ qua settings store, không phải state cục bộ. |
| `useBrowserPanelSizing` đo chỗ trống | `useBrowserPanelSizing.ts:49-50` | `viewport.closest('.wpanel')?.parentElement` — leo DOM từ khung web lên hộp flex (chat + panel). Trong workbench hộp đó vẫn tồn tại bên trong `.sdrow` nên đo vẫn đúng **miễn là** panel workspace vẫn render; nếu tắt panel thì `closest('.wpanel')` trả `null` ⇒ `room=null` ⇒ `expandTarget` rơi về `WP_MAX` (không crash, chỉ mất clamp). |
| `position: fixed` bên trong | 670 (`menu` backdrop `inset:0`), `.selactions` 2287–2307, `.notebackdrop`/`.notepop` 2331–2339 | Backdrop + selection bar + note popover neo **viewport**, không neo khung chứa — nhúng vào đâu cũng đúng. `.dropzone` 2253–2262 là `absolute inset:0` trên `.detail` (root có `position:relative`? — `.detail` global không khai; dropzone thực tế neo vào ancestor gần nhất có position — kiểm lại: `.chat` 2180 có `position:relative` chỉ là ancestor của `.findwrap`; `.dropzone` cần `.detail` positioned). ⚠ `.detail` global (`prototype.css:206`) **không** có `position` — dropzone neo lên `.page`/`.wb`. Trong sessions page `.detail` là con `.md` nên vô hại; trong workbench `.docchat` nên thêm `position:relative` nếu muốn dropzone chỉ phủ stage. |
| `padding-bottom` cho dock toàn cục | `app-shell.css:2294-2295, 2305-2306` | Chỉ rule `[data-page='sessions'] .md > .detail` và `.body > .page:not([data-page='sessions'])` mới trừa chỗ cho `GlobalTerminalHost` (dock ⌘J global, `position:absolute` trong `.main`). Trang `/workbench` `data-page="workbench"` + markup `<WorkbenchView>` **không phải `.page`** ⇒ không rule nào trừa chỗ ⇒ dock global sẽ **đè lên** mép dưới workbench (kể cả dock mới). Integrator phải thêm rule/ẩn GlobalTerminalHost trên trang workbench. |
| Header `.dh` 44px + menu `.smenu` | 49–277; `.dh` 2052 | Menu `absolute` neo `.dhanchor` — hoạt động trong mọi hộp. |
| Strip tab chính (main tabs) | 285–353 | `.mtabs` nằm trong `.sdmain`, ngay dưới `.dh` — trên workbench strip này **trùng vai trò** với `WorkbenchDocTabs` (doc `web` = tab web). Xem §4. |

## 2. Mount `WorkspaceBrowser` / `useEmbeddedBrowser` — ai chủ `brow.tabs`?

Tab web là **`WebContentsView` thật do Electron main sở hữu** (`electron/browser.ts`),
không phải state của store hay composable — mỗi `useEmbeddedBrowser({ scope })` chỉ
giữ **bản liệt kê cục bộ** (`tabs = ref<AwogBrowserTab[]>([])`, đồng bộ qua bridge
`window.awog.browser`, `useEmbeddedBrowser.ts:120-121`). `scope` = `session.engineId`
⇒ **mọi bề mặt cùng scope thấy cùng một bộ tab**, dù mount ở đâu. Không có chủ
renderer nào sở hữu `brow.tabs` — chủ của *view* là cái khác:

- **Một owner mỗi cửa sổ** (`useEmbeddedBrowser.ts:82`, module-level `owner = ref<number|null>`):
  chỉ **một** instance `useEmbeddedBrowser` được `attach` view tại một thời điểm;
  các instance khác hiện placeholder `BrowserElsewhere` ("hiện ở chỗ khác") với nút
  `takeOver`. Đây là trọng tài cấp module, không cần thống nhất tay.
- Hai chỗ mount trong `SessionDetail` hôm nay:
  1. **Main-tab strip** — `SessionDetail.vue:505-541` (`.mbpane` + `ref="mbVpEl"`), setup 1807–1844: mode `pinnedTabId`, `visible: () => isActive && mainTab !== DISCUSS_TAB`.
  2. **Workspace panel view "Browser"** — `SessionWorkspacePanel.vue:136-141` → `WorkspaceBrowser.vue:126-136`: mode follow-agent (`activeByScope`), `visible: () => props.active !== false`, `scope: () => session.engineId`.
- **Xung đột với doc `web` (slice C):** doc `web` render một viewport *thứ ba* cùng
  `scope` ⇒ chỉ một trong ba được giữ view; hai kia nhận `elsewhere`. Cần quyết:
  (a) doc `web` nên **pin theo tab** (`pinnedTabId: () => doc.browId`) thay vì
  follow — `WorkbenchDoc.browId` đã có sẵn cho việc này (`types/workbench.ts:23-24`);
  (b) strip tab chính trong `SessionDetail` và `WorkbenchDocTabs` sẽ liệt kê cùng
  tab set ⇒ **hai strip hiển thị cùng tab** — hoặc chọn một, hoặc để strip của
  SessionDetail biến mất khi đã có doc tabs (nguồn sự thật con trỏ người dùng =
  `useSessionMainTabs` module map khoá `engineId`, `useSessionMainTabs.ts:23`;
  `useLinkOpen` đã gọi `openBrowserTab` → `setMainTab` — slice C nên để doc mở/đóng
  đi qua cùng hàm này, không tự quản).
- **Lifecycle**: `useEmbeddedBrowser` đã tự detach ở `onDeactivated` + `onUnmounted`
  (`useEmbeddedBrowser.ts:843-859`) — giữ `SessionDetail` trong `<KeepAlive>` là đủ
  để view không đè lên UI khác khi đổi doc/đổi phiên.
- **`visible()` cần thêm điều kiện "doc chat đang hiện"**: hôm nay
  `visible: () => isActive && mainTab !== DISCUSS_TAB` (1841) không biết doc nào đang
  mở trên stage. Nếu doc `chat` được giữ mounted (KeepAlive/v-show) khi chuyển sang
  doc khác mà `mainTab` đang pin web, native view vẫn được giữ và **vẽ đè** doc mới.
  Integrator: hoặc `v-if` nguyên `DocChat` (mất state composer — không nên), hoặc
  thêm điều kiện doc-visible vào `visible()` (prop mới, ví dụ `dockVisible`), hoặc
  deactivate bằng KeepAlive khi đổi doc — xem §5.
- **`OVERLAYS`** (`useEmbeddedBrowser.ts:59-73`): danh sách selector overlay phải
  bảo trì tay — nếu slice nào thêm loại overlay/modal mới cho workbench mà quên khai
  báo class ở đây, trang web sẽ **vẽ đè lên nó** (DOM không thắng được WebContentsView).

## 3. Checklist — hiện nằm đâu, có bản thứ hai không?

`Session.todos` hiện render ở **hai chỗ có thể sửa + một chỗ lịch sử read-only**:

| Chỗ | File:dòng | Bản chất |
|---|---|---|
| Chip trên header | `SessionContextStrip.vue:53` `<SessionTodoPanel variant="chip">` — được `SessionDetail.vue:67` render trong hàng chip ngữ cảnh | Popover `fixed` (`.pop.todopop`), list **editable** (`SessionTodoList editable`, `SessionTodoPanel.vue:31`) — đây là bản "sống" của ADR 0069. Slice D đưa checklist sang dock rail ⇒ **xoá/tắt chip này** hoặc giữ chip làm nút mở rail. |
| Plan tab của workspace panel | `WorkspacePlan.vue:27` `<SessionTodoList :todos editable>` | Bản thứ hai editable cùng `useSessionTodo(() => props.session)` — cùng một `Session.todos`, không có bản sao dữ liệu; khi Plan view di chuyển xuống dock (proto: "Checklist đầy đủ — Plan view show bản lớn") thì đây vẫn là một render hợp lệ, không phải duplicate trạng thái. |
| Step `todo` trong transcript | `SessionStepItem.vue:56`, `SessionMessageItem.vue:133-134` | Checklist lịch sử read-only (`editable` mặc định false) — giữ nguyên, đó là log lượt cũ. |

`SessionDetail` **không** render thêm bản checklist nào khác (composer/banner đã
fold vào chip). Banner ghim cũ đã bỏ — chỉ còn chip.

## 4. Terminal — khoá PTY đang dùng, có trùng dock mới không?

`WorkspaceTerminal` là widget nhận `pty-key` opaque, gom PTY trong registry phía
sidecar (`WorkspaceTerminal.vue:150-152`, comment 109-112). Các khoá đang sống:

| Khoá | Nơi dùng |
|---|---|
| `ses:<session.id>` | View Terminal của workspace panel — `SessionWorkspacePanel.vue:128`. Nút "Run" trên code block (`useSessionTerminalRun.ts:84`) **resolve đúng khoá này** để ghi lệnh vào terminal của phiên. |
| `cli:<session.engineId>` | Pane "Open in CLI" trong `.chat` — `SessionDetail.vue:1549` vùng 1540-1650. Shell CLI riêng, không phải view panel. |
| `global:<key>` | `GlobalTerminalHost.vue:77` — dock terminal toàn cục (⌘J ở mọi trang, `layouts/default.vue:27`). |
| `ssh:<hostId>`, `kube-exec:<pod>` | `SshTerminal.vue:5`, `InfraKubeExecTab.vue:39` — ngoài phạm vi session. |

**Xung đột với dock mới của workbench:**
- Nếu dock dùng khoá **khác** (ví dụ `wb:<tabId>` như `stores/workbench.ts.termTabs`):
  hai terminal cùng lúc sống song song — ổn, nhưng nút Run trong transcript vẫn gọi
  `toggleView('Terminal')` qua `useWorkspacePanel` ⇒ **mở lại panel workspace cũ**
  chứ không ghi vào dock. Nếu dock là nơi Run nên tới, `useSessionTerminalRun` phải
  repoint (registry `runners` theo khoá đã sẵn sàng — `claimVisibleTerminalRunner`
  thắng khi terminal hiển thị, `useSessionTerminalRun.ts:30-37`).
- Nếu dock tái dùng `ses:<sessionId>`: cùng registry nhóm ⇒ tab dock và panel
  workspace **chia sẻ/đá nhau** PTY — không nên trừ khi cố ý "một terminal của phiên".
- Đề xuất cho integrator: dock Terminal của workbench mang khoá riêng (`wb:` hoặc
  `ses:` có chủ đích), và `useWorkspacePanel().requested` — hiện là cầu nối duy nhất
  giữa status bar / nút Run với `SessionDetail` (`useWorkspacePanel.ts:11`,
  `SessionDetail.vue:1955-1961`) — cần reroute sang `useWorkbenchStore.dockView`
  khi bỏ view Terminal khỏi panel nhúng.

## 5. KeepAlive — cần gì?

- Trang sessions hiện `<KeepAlive :max="5">` quanh `SessionHandoffCard`/`SessionDetail`,
  **key = `store.active.id`** (số), còn `key="handoff"` cho placeholder
  (`pages/sessions.vue:80-101`). Comment bắt buộc nằm NGOÀI `<KeepAlive>` (comment
  node tính là child). Bản thân trang nằm trong `<NuxtPage keepalive>` cấp app.
- Workbench: `DocChat.vue` đã mirror đúng cấu trúc đó (KeepAlive `:max="5"`, cùng key,
  cùng nhánh handoff/empty). Nếu sau này surface bọc từng doc trong `<KeepAlive>`
  riêng (giữ state khi đổi doc): phải thêm `include`/key — `SessionDetail` không
  phải async component nên `include` cần tên component; an toàn hơn là key theo doc id.
- Cơ chế `isActive` của `SessionDetail` (`SessionDetail.vue:721`:
  `session.id === store.activeId`) gate **phiên-active**, không phải doc-visible —
  KeepAlive-deactivate vẫn đúng cho browser (xem §2), nhưng **⌘F và footer bridge
  không bị ảnh hưởng bởi deactivation**: `useSessionFind` chỉ kiểm `isActive()`
  (`useSessionFind.ts:241`) — nếu doc `chat` bị che bởi doc khác mà instance vẫn
  mounted và phiên vẫn active, ⌘F sẽ mở find bar **trên surface đang ẩn**. Cùng lớp
  vấn đề với `visible()` ở §2: cần một đường "doc-visible" (prop truyền xuống, hoặc
  `v-if` trên `DocChat` chấp nhận mất state tạm của composer).
- `onActivated/onDeactivated` đã được `useEmbeddedBrowser` tự xử (detach/reattach) —
  `pages/workbench.vue` đã `definePageMeta({ keepalive: true })`.

## 6. Destructive guards · bookmarks · ⌘F · surface scoping — phụ thuộc DOM ngoài?

**Không phụ thuộc DOM ngoài `SessionDetail`** — mọi thứ tự chứa:

- **4 guard cắt transcript** (rewind/resend/edit&resend/regenerate) ở
  `SessionMessageItem.vue:671-773`: `await confirm(...)` đi qua `useConfirm()` —
  host modal cấp app (`AppGlobalHosts`), không phải DOM của page. An toàn khi nhúng.
- **Bookmarks**: `SessionBookmarkBar` render trong `SessionContextStrip:54`
  (chip variant) + chip trong message; điều hướng dùng `useTranscriptSurface()` —
  inject **từ ancestor** (`useTranscriptSurface.ts:41-43`), và `SessionDetail` tự
  `provideTranscriptSurface()` ở `SessionDetail.vue:739` ⇒ DocChat **không cần
  provide gì**. Bookmark prune vẫn theo store, không phụ thuộc nơi mount.
- **⌘F / find bar**: `useSessionFind` mount listener `window` capture
  (`useSessionFind.ts:269-270`), gate `isActive()` + nhường Monaco/xterm/ftovl —
  hoạt động trong workbench ngay; **duy nhất** thiếu gate doc-visible (§5).
- **Surface scoping**: `provideTranscriptSurface` (739), `provideSessionScope`
  (741), `provideFilePreview` (725), `provideGhCommentLink` (731) đều nằm trong
  setup của `SessionDetail` ⇒ tự cung cấp; `useSessionScroll(transcriptSurface)`
  (750) nhận ref trực tiếp. `store.pendingJump` (778) là cầu nối cấp store —
  cross-session search từ explorer workbench có thể dùng lại đúng kênh này.
- **Chat attach queue + footer bridge** (`chatAttach`, `useWorkspacePanel`) gate
  bằng `isActive` — chỉ instance đang hiện phản ứng (`SessionDetail.vue:716-721`).

## 7. Mount — props & context `SessionDetail` cần

- **Prop duy nhất**: `{ session: Session }` — `defineProps` ở `SessionDetail.vue:705`.
  Truyền `sessions.active` (store). `isActive` tự suy từ `store.activeId` —
  **không truyền flag**.
- `Session` = type từ `composables/useSessionsData` (id **number**, `engineId` string).
- Handoff: phiên popout sang cửa sổ riêng render `SessionHandoffCard` thay
  (`store.isHandedOff(engineId)`, `pages/sessions.vue:81-85`) — DocChat đã mirror.
- **Không có prop tắt workspace panel**: `wpOpen = ref(false)` (1444) khởi đầu đóng,
  nhưng `openViews`/footer bridge/`useSessionTerminalRun` có thể mở lại, và nút
  workspace + picker trên header vẫn hiện (93 vùng). Để "chỉ wrap" an toàn ở slice
  này: **giữ nguyên** — panel chỉ mở khi user bấm (không chồng sẵn). Integrator muốn
  tắt hẳn phải thêm prop (vd `embedded`/`hideWorkspacePanel`) hoặc cắt code — **đây
  là điểm nợ duy nhất không tự xử được từ ngoài**.
- Provide/inject: **DocChat không cần provide gì** (xem §6).
- Store phụ thuộc: `useSessionsStore` (msgs/send/store actions), `useSettingsStore`
  (`workspacePanel.*`, `workspaceDockOf`), `useProjects`, `useI18n`, `useThemeFamily`,
  `useMinimizeDock`, `usePreview`, `useSelectionTranslate`, `useSessionExportModal`,
  `useSessionSpawnDialog`, `useSessionTerminalRun` — tất cả cấp app/module, sẵn sàng
  trong workbench vì cùng một renderer + cùng store instance.
- Empty/hand-off state: DocChat render empty state giống sessions page khi
  `!store.active` (nút `store.create(store.activeTab)`).

## 8. Nợ kỹ thuật integrator cần xử (tóm tắt)

1. `data-page='workbench'` không trừa chỗ cho `GlobalTerminalHost` — dock global đè
   dock workbench (`app-shell.css:2305`).
2. `visible()`/`isActive()` của browser + find + footer bridge chỉ biết "phiên
   active", chưa biết "doc chat đang hiển thị" — cần thêm điều kiện khi doc tabs
   thật sự chuyển được (§2, §5).
3. Main-tab strip web của `SessionDetail` trùng vai trò `WorkbenchDocTabs` cho doc
   `web` — chọn một nguồn; `useSessionMainTabs` là state phải giữ (§2).
4. Không có prop tắt workspace panel 3 mép — thêm prop hoặc để user tự đóng (§7).
5. `useWorkspacePanel().requested`/`useSessionTerminalRun` vẫn trỏ view Terminal của
   panel nhúng — reroute sang dock khi dock Terminal thay thế (§4).
6. `OVERLAYS` của `useEmbeddedBrowser` phải được cập nhật với class overlay mới của
   workbench nếu có (§2).
7. `.docchat` nên cân nhắc `position: relative` để `.dropzone` (absolute inset:0)
   chỉ phủ stage thay vì leo lên `.wb` (§1).
