# Preview Modal — theme picker + file actions

> Trạng thái: Implemented (ui-next). Mở rộng [PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue)
> với **theme picker cho Monaco** + **9 thao tác file**, và refactor SFC theo
> page-controller (nuxt-vue rule). Liên quan: [ADR 0053](../decisions/0053-monaco-themes-dependency.md)
> (dependency `monaco-themes`), [ADR 0045](../decisions/0045-settings-json-file-persistence.md)
> (persist `~/.awog/settings.json`), [workspace-panel](workspace-panel.md) (nguồn preview file),
> [office-preview](office-preview.md) (kind `doc`/`sheet` — `.docx`/`.xlsx`).

## Bối cảnh

PreviewModal là viewer toàn cửa sổ dùng chung (mount 1 lần, drive bằng prop `item`
hoặc shared store `usePreview()`). Trước đây chỉ xem (read-only Monaco cho code/text,
marked+highlight.js cho markdown, ảnh/pdf). User muốn:

1. **Theme picker dành riêng cho Monaco** trong giao diện preview, persist xuống
   **global settings** của AWOG.
2. **9 thao tác file** ngay trong preview: edit · save · open in finder · rename ·
   move · delete · copy path · open in browser · add to chat.
3. Refactor file (834 dòng — vượt ngưỡng 250 của coding guide).

## Kiến trúc sau refactor

| File | Vai trò |
|---|---|
| [usePreviewModal.ts](../../apps/desktop/ui-next/composables/usePreviewModal.ts) | **Page-controller**: toàn bộ state + IPC (item resolution, workspace load, image transform, markdown view, edit/save, 9 actions, confirm/rename overlay). SoC: không `import fs`/SDK — đi qua `useSidecar`. |
| [useMonacoTheme.ts](../../apps/desktop/ui-next/composables/useMonacoTheme.ts) | Theme state (module-level shared) + persist `~/.awog/settings.json` key `monacoPreviewTheme` (settings.get/set) + lazy-load curated theme JSON. |
| [useMarkdownOutline.ts](../../apps/desktop/ui-next/composables/useMarkdownOutline.ts) | TOC + scroll-spy + reading-width (tách khỏi modal). |
| [useChatAttach.ts](../../apps/desktop/ui-next/composables/useChatAttach.ts) | Kênh decoupled "add to chat" (modal không biết sessions; SessionDetail là consumer drain queue). |
| [PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue) | Shell mỏng: head + body (image/pdf/markdown/code/empty) + overlay rename/confirm + style. Wire controller. |
| [PreviewToolbar.vue](../../apps/desktop/ui-next/components/common/PreviewToolbar.vue) | Floating bar: view controls + theme picker + edit/save + actions menu + feedback pill. Nhận `:ctrl` (pattern controller-prop như `FileTreeController`). |
| [MonacoViewer.vue](../../apps/desktop/ui-next/components/common/MonacoViewer.vue) | Viewer/editor: theme (follow-app + curated) + chế độ editable (`readOnly` prop, emit `change`/`save`). |

## Theme picker (Monaco)

- **`Follow app`** (mặc định) — derive editor color từ CSS token (dark/light + accent),
  phản ứng theo theme app. Đây là hành vi cũ.
- **Curated** — bộ ~16 theme kiểu VSCode (Dracula, Monokai, Nord, Night Owl, Tomorrow
  Night/Eighties, Cobalt2, Oceanic Next, GitHub Dark/Light, Solarized Dark/Light,
  Tomorrow, Clouds, Xcode, iPlastic) từ `monaco-themes` ([ADR 0053](../decisions/0053-monaco-themes-dependency.md)).
  Theme curated **cố định** (không đổi theo dark/light app).
- Persist: id chọn ghi `~/.awog/settings.json` (`monacoPreviewTheme`) qua `settings.set`;
  hydrate qua `settings.get` 1 lần/phiên. Browser-dev (không sidecar) → in-memory.
- Chỉ hiện khi Monaco đang hiển thị (code/text hoặc markdown ở chế độ raw).

## 9 thao tác file

Gate ở `hasWorkspaceFile` (item có `workspaceRoot`+`path` và có sidecar) — chỉ preview
file workspace thật mới có action. "Add to chat" gate riêng theo `canAddToChat`.

| Thao tác | Cơ chế | Ghi chú |
|---|---|---|
| **Edit file** | toggle `readOnly=false` ở MonacoViewer | markdown chuyển sang raw để sửa nguồn |
| **Save** | `fs.writeFile` (atomic) | baseline update → dirty clear; ⌘/Ctrl+S trong editor |
| **Open in finder** | `revealPath` (main process) | |
| **Rename** | `fs.rename(fromPath, toPath)` | overlay sửa path; repoint shared item → tự reload |
| **Move** | `fs.rename` | cùng overlay rename (sửa cả thư mục) |
| **Delete** | `fs.delete` | confirm overlay trước; thành công → đóng modal |
| **Copy path** | `navigator.clipboard` (absolute path) | |
| **Open in browser** | `openFileExternal` (file:// trong browser) | |
| **Add to chat** | `useChatAttach.request()` → SessionDetail drain | ảnh gửi dataUrl, text cắt 20k ký tự |

**Bảo vệ chỉnh sửa chưa lưu:** đóng modal khi `dirty` → confirm "discard?". Mọi mutation
qua sidecar đã được `assertInsideWorkspace` gate (refuse `.git`, refuse clobber, refuse root).

## Gallery ảnh (‹ › giữa các ảnh cùng thư mục)

Mở một ảnh trong một loạt ảnh (folder render output, batch screenshot) rồi phải đóng — mở
lại cho ảnh kế tiếp là điểm đau. Preview ảnh vì thế tự có gallery:

- **Phạm vi = ngữ cảnh, KHÔNG phải thư mục.** Gallery luôn là tập sibling do **opener** truyền
  vào (`usePreview().open(item, siblings)`). Đã thử liệt kê `fs.listDir` cả thư mục và **bỏ**:
  nó kéo vào file không liên quan và vô nghĩa với attachment in-memory (chúng không có thư mục
  nào). Nguồn sibling hiện có:
  | Opener | Tập ảnh |
  |---|---|
  | Attachment trong message ([SessionAttachmentChip](../../apps/desktop/ui-next/components/session/SessionAttachmentChip.vue) ← prop `siblings`) | ảnh của **message đó** |
  | Attachment đang chờ gửi (`SessionDetail.previewAtt`) | ảnh trong **composer tray** |
  | Panel context-files (`useSessionContextFiles`) | ảnh trong **context của session** |
  | Link / chip / ảnh inline trong chat (`useFilePreview.open`) | ảnh **của session** (xem dưới) |
  | Files tab (`WorkspaceFiles.openFile`) | **mọi ảnh trong folder đó** — folder chính là ngữ cảnh người dùng đang xem; entries đã có sẵn trong tree nên không tốn IPC, và thứ tự ‹ › đúng bằng thứ tự tree hiển thị |
  | Diff, SFTP, cửa sổ popout | không có → 1 ảnh, không ‹ › |
- **Tập ảnh của session** ([useFilePreview](../../apps/desktop/ui-next/composables/useFilePreview.ts)):
  derive từ chính transcript nên khớp thứ người dùng thấy — `touchedPaths` (file session
  write/edit) + path ảnh **được nhắc trong text** của mọi message (user prose + text block của
  assistant; step bỏ qua vì đã có trong touchedPaths), giữ **thứ tự transcript**. Cap 80 path /
  8 thư mục.
  - **Xác thực bằng `fs.listDir`, KHÔNG bằng `matchPath`.** `matchPath` dựa trên `fs.listFiles`
    → `git ls-files`, nên ảnh render/gitignored (đúng case `output/remotion/*.png`) **vô hình**
    với nó và gallery ra rỗng. `listDir` đọc filesystem thật: một ảnh model chỉ *đề xuất* mà
    chưa ghi thì tự bị loại vì không có trên đĩa. Một `listDir` cho mỗi thư mục được nhắc, cache
    theo `root::dir`.
- **Nhận dạng item trong tập:** file workspace theo `workspaceRoot + path`, attachment
  in-memory theo `src`, cuối cùng mới theo `name` (`sameEntry`).
- **Mapper dùng chung** `previewRefFromAttachment` / `imageSiblingsFromAttachments` trong
  [usePreview.ts](../../apps/desktop/ui-next/composables/usePreview.ts) — gom 3 bản copy
  attachment→PreviewRef (bubble chip, composer tray, context-files panel).
- **Điều khiển:** `‹ 3/8 ›` trong cụm ảnh của PreviewToolbar + phím `←`/`→` (bị bỏ qua khi
  rename overlay / confirm / find bar đang giữ bàn phím). Cuộn vòng ở hai đầu.
- **Không nháy khi chuyển ảnh.** Đọc file là async, nên đổi ảnh làm modal rơi về placeholder
  "loading" một frame → **nhấp nháy**. Fix: cache data-URL (`Map`, cap 6, evict cũ nhất) +
  prefetch 2 ảnh kề (và `new Image().src` để decode sẵn). Cache hit → `loadedSrc` set **ngay
  trong tick đó**, `loadStatus` không bao giờ vào `loading`, `<img>` giữ nguyên element và chỉ
  đổi `src`. Miss (bấm nhanh hơn prefetch) mới thấy placeholder như trước.
- **CSS không sizing ảnh — chỉ zoom (JS) sizing.** Hai lần thử dùng `max-height: 100%` đều
  thất bại: percentage max-height cần **grid area / flex container có chiều cao definite**, mà
  cả flex item cao `100%` lẫn grid row `auto` đều không phải — row phình lên bằng natural
  height của ảnh nên (1) không có gì bị constrain và (2) `place-items: center` vô nghĩa (item
  cao bằng row), khiến ảnh dọc bị **neo đáy khung**. Layout hiện tại:
  - `.pvimgvp` = khung cố định (`position: absolute; inset: 0` của `.pvbody`, `overflow: hidden`).
  - `.pvimgcenter` = `left/top: 50%` + `translate(-50%, -50%)` → tâm hộp **luôn** trùng tâm
    khung kể cả khi ảnh lớn hơn khung (grid/flex sẽ "safe align" về start trong trường hợp
    này). Scale của ảnh quanh tâm nó ⇒ ảnh center ở mọi mức zoom.
  - `.pvimg` = natural size (`max-width/height: none`) ⇒ **100% = 1:1 pixel**.
  Đừng quay lại sizing ảnh bằng CSS percentage.
- **Fit + auto-fit khi mở ảnh.**
  - `fitImage()` đo **layout box** của `<img>` (`offsetWidth/offsetHeight` — không chịu ảnh
    hưởng transform, tức natural size) so với client box của khung, KHÔNG
    `getBoundingClientRect` (đã gồm transform). `scale = min(vw/w, vh/h)`; xoay 90° lẻ đảo
    trục; reset pan về giữa.
  - Mỗi ảnh **auto-fit một lần** khi bitmap có box (`@load` → `onImageLoad`), **shrink-only** —
    đây là thứ làm ảnh *mở ra đã fit* (CSS render natural size nên không có nó ảnh dọc sẽ tràn
    khung), ảnh nhỏ vẫn ở 1:1. Một lần / item nên `Reload` không giẫm lên zoom đang đặt.
  - Nút Fit (icon `Scan`) fit **hai chiều**; nút `⤢` bên cạnh là reset 100% + xoá rotate/flip.
- **Không đẩy back-stack.** Bước gallery dùng `replace()` chứ không `push()`: đi qua các ảnh
  cùng folder không phải "đi vào" file mới, nên Back vẫn về đúng chỗ đã mở ảnh đầu tiên.
  Mỗi bước `resetView()` (zoom/rotate/flip về mặc định).
- Chỉ hiện khi thư mục có **>1** ảnh; folder không đọc được → không có gallery, ảnh đang xem
  vẫn hiển thị bình thường.

## Quyết định / trade-off

- **PreviewToolbar nhận controller object** (`:ctrl`) thay vì ~30 props — theo precedent
  `FileTreeController`. Destructure ref/fn ổn định → unwrap trong template.
- **Confirm/feedback inline** (chưa có toast system ở ui-next): confirm overlay generic
  (delete + discard), feedback pill transient. Khi có toast chung → thay sau.
- **Theme JSON lazy** qua Vite alias (`monaco-themes/themes` → thư mục thật) vì package
  `exports` map chặn deep import — xem [ADR 0053](../decisions/0053-monaco-themes-dependency.md).

## Việc cần làm tiếp

- (Tùy chọn) Migrate các app setting khác sang `~/.awog/settings.json` (hiện chỉ
  `monacoPreviewTheme` ghi file; phần còn lại vẫn localStorage) — cần lớp `useSettingsSync`.
- (Tùy chọn) Toast system chung cho ui-next → thay feedback pill + confirm inline.
- infosec review khi đụng `fs.writeFile`/`fs.delete`/`fs.rename` từ surface mới này (đã gate
  sẵn ở sidecar; xác nhận không có path nào lọt).
