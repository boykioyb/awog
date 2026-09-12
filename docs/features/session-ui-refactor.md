# Feature — Refactor bố cục màn Session (giảm nhiễu thị giác)

> **Trạng thái:** **Đã ship** (P0–P4, trừ một hạng mục hoãn — xem §7) · 2026-09-12
> **Phạm vi:** `pages/sessions.vue`, `components/session/**`, `components/shell/AppStatusBar.vue` + `Status*.vue`, `components/browser/BrowserChrome.vue`
> **KHÔNG đảo:** mô hình 2-dock đồng thời của Workspace Panel ([workspace-panel.md](workspace-panel.md)), craft-parity transcript ([session-craft-parity.md](session-craft-parity.md)), token ADR 0079, checklist ADR 0069.

## 1. Vấn đề — đo được, không cảm tính

Màn Session hiện có **4 nơi chứa điều khiển phiên** mà không có ranh giới ngữ nghĩa: header, composer, status bar, footer message. Cùng một khái niệm xuất hiện nhiều lần, và mỗi vùng đều đầy.

| Vùng | File | Số affordance cùng hiện | Ghi chú |
|---|---|---|---|
| Tab strip project | `SessionTabBar.vue` | 1 collapse + N tab (dot + tên + badge + ×) + `+` | OK |
| Toolbar cột danh sách | `SessionList.vue:8-50` | ô tìm + **4 icon button** | tạo · chế độ chọn · bộ lọc · gấp tất cả |
| Header `.dh` (50px) | `SessionDetail.vue:14-170` | 1 chip project + **8 `iconbtn`** | Code · Config · Workspace · Popout · Minimize · Export · Delete · (dots) |
| Banner ngữ cảnh | `SessionDetail.vue:186-223` | tối đa **6 hàng chồng** (~170px), thường gặp 2–3 | aboutTask 1 · sshbar 3 (nút + AppSelect + warn) · todo 1 · bookmark 1 |
| Transcript nổi | `SessionTranscript.vue:1-80` | **5 lớp nổi** | foldbtn · ChapterNav · jumpTop · jumpBottom · FindBar |
| Footer mỗi message | `SessionMessageItem.vue:709-735` | **tối đa 10 icon** cùng lúc khi hover | copy · maximize · layers · quote · bookmark · regen · retryModel · rewind · branch · fork |
| Composer `.cbar` | `SessionComposer.vue:166-460` | 6 (+ split-send khi chạy) | mode · MCP · pin · enhance · clip · send |
| Status bar (26px) | `AppStatusBar.vue` | **11 mục** | usage · branch · context · project · model · account · effort · style · Files · Browser · Terminal |
| Workspace panel chrome | `SessionWorkspacePanel.vue:6-68` | mỗi tab = icon + label + × ; + 3 nút cố định (`+` · dock · close) | ×2–3 dock |
| Tab Browser | `BrowserChrome.vue` | **15 `<button>`** trong panel rộng 322px | thủ phạm nặng nhất của "panel rối mắt" |

Bốn triệu chứng rút ra:

1. **Trùng lặp 3 lần cùng một thông tin.** Tên project hiện ở tab strip *và* chip `.dproj` trong header *và* chip folder ở status bar.
2. **Không có thứ bậc hành động.** 10 icon footer message đều cùng cỡ, cùng màu, cùng trọng số — trong đó 4 cái là **cắt transcript** (regen/retryModel/rewind + fork). Hành động phá huỷ trông y hệt nút "copy".
3. **Chồng tầng theo chiều dọc.** Cột chat có thể chứa 10 thành phần anh em cùng lúc (`DoneFlash · TodoPanel · BookmarkBar · FindBar · Transcript · WakeCard · InboxChips · BackgroundChips · QuestionDrawer · Composer`) — chưa tính 2 banner ở trên `.chatwrap`.
4. **Không có trần chiều rộng đọc.** `.maw{max-width:92%}` (`prototype.css:399`) — trên màn 2000px một đoạn văn dài ~180 ký tự/dòng. Đây là lý do lớn nhất khiến ảnh chụp trông "rối", dù markdown heading đã ghìm rất hiền (`1.3em / 1.18em / 1.08em`).

## 2. Nguyên tắc chốt trước khi sửa

1. **Mỗi lớp điều khiển có đúng một nhà.**
   - Status bar = **trạng thái phiên** (đọc là chính): usage · branch · context · model/account.
   - Header = **danh tính + view**: tiêu đề, chọn view workspace, `…` cho phần còn lại.
   - Composer = **chỉ thứ ảnh hưởng lượt sắp gửi**: mode · MCP · pin · đính kèm · gửi.
   - Footer message = **hành động trên lượt đó**.
2. **2 hành động chính + `…`.** Mọi cụm > 3 nút phải có 2–3 cái ở ngoài, còn lại vào overflow. Hành động phá huỷ **không bao giờ** nằm ngoài.
3. **Một strip ngữ cảnh duy nhất**, không chồng banner.
4. **Khoảng trắng thay đường kẻ.** Panel/section phân tách bằng nền + spacing; hairline chỉ ở thanh cao cố định (ADR 0079 đã quy định `inset box-shadow`).
5. **Trần chiều rộng đọc.** Cột transcript có `max-width` theo `ch`, căn giữa.
6. **Ẩn theo ngữ cảnh, không ẩn theo hover.** Nút chỉ có nghĩa ở một trạng thái thì mất hẳn ở trạng thái khác; nhưng không dùng `opacity:0` để giấu 10 nút rồi bung ra khi hover — đó là "flash of clutter".

## 3. Đề xuất theo vùng

### 3.1 Header `.dh` — 8 nút → 2 nút

```
[ Tiêu đề phiên (sửa inline) ]                       [ Views ▾ ]  [ … ]
```

- **Bỏ chip `.dproj`**: project đã là tab đang chọn ngay phía trên. Hành động "đổi project" vào `…`.
- **Gộp 6 nút vào `…`**: Open in VS Code · Config · Popout · Minimize · Export · Delete (Delete tô `danger`).
- **Gỡ nhánh `v-if="!isCute"` / `v-else`**: file hiện có **hai bản markup cho cùng 4 hành động** (bản 4 iconbtn cho `awog`, bản `…` menu cho `cute`). Nâng bản `…` thành mặc định cho cả hai family → xoá ~60 dòng trùng, đúng DRY.
- Chiều cao 50 → **44px** (28px iconbtn căn giữa ở 8 — số nguyên ở mọi base Appearance).

**Đụng tới:** `SessionDetail.vue` (template header), `prototype.css:198`.

### 3.2 Strip ngữ cảnh — tối đa 6 hàng → 1 hàng 28px

Thay các banner chồng nhau bằng một hàng chip duy nhất; mỗi chip mở popover của chính nó:

```
[Task: Fix egress IP]  [ssh: prod-01 · ask ▾]  [☑ 18/19]  [🔖 3]
```

- Chip **Task** / **SSH**: nhãn + mở chi tiết; selector `sshApprovalMode` vào popover; cảnh báo `auto` = chip đổi sang `danger` + tooltip (thay hàng `<p class="sshbar-warn">` riêng).
- Chip **Checklist**: `18/19` + vòng tiến độ. Đây **không phải đảo** hành vi đã chốt ở ADR 0069 — banner ghim vốn đã "thu thành strip `done/total`"; đề xuất này chỉ đưa dạng thu gọn đó thành hình thái mặc định và cho mở lại bằng một cú bấm.
- Chip **Bookmark**: số lượng; danh sách trong popover thay vì một thanh ngang riêng.
- Strip **không có chip nào thì không render** (giữ đúng luật hiện tại của `SessionBookmarkBar`).

**Đụng tới:** component mới `SessionContextStrip.vue`; `SessionTodoPanel.vue` + `SessionBookmarkBar.vue` đổi từ "thanh" thành "nội dung popover"; `SessionDetail.vue` bỏ `aboutbar` + `sshbar`.

### 3.3 Transcript — ~~trần đọc~~ *(đã bỏ, xem dưới)* + 5 lớp nổi → 3

- ~~**Trần chiều rộng** `78ch` căn giữa~~ — **đã bỏ 2026-09-12 sau khi dùng thật.**

  > Trần này là hạng mục tôi bán mạnh nhất ở P0, và nó **sai trong thực tế dùng**. Lý do: nó chỉ kẹp transcript, còn composer vẫn trải hết cột — hai khối xếp chồng trong cùng một cột mà lệch nhau cả trăm pixel, tin nhắn thụt vào giữa còn ô soạn dính mép. Tôi sửa lần đầu bằng cách **bóp composer xuống cho bằng** transcript; người dùng bác ngay: *"cho rộng ra chứ sao lại bé lại rồi"*. Đúng hướng là **nới transcript ra bằng composer**.
  >
  > Bài học: `180 ký tự/dòng` là con số tôi đo từ ảnh chụp, không phải điều người dùng từng phàn nàn. Tôi đã lấy một phép đo của chính mình làm vấn đề, rồi đánh đổi bề rộng thật lấy nó.

- **Nay:** `.milist` và `.cbox` cùng trải hết cột chat, cùng lấy đệm `--padX` của `.msgs` / `.composer` → **thẳng hàng theo cấu trúc**, không phải canh bằng số. `.maw` đổi `92%` → `100%` để mép phải khối assistant trùng mép ô soạn; bubble user giữ trần riêng + căn phải vì nó là bong bóng, không phải cột.

  Đo được (cột chat 1100px): assistant và ô soạn cùng `l=22 · r=1078 · w=1056`; bubble user `r=1078`, rộng 162 — vẫn căn phải trong cột.
- **Gộp điều hướng:** `jumpTop` vào `ChapterNav` (mục đầu = "Đầu phiên"); chỉ giữ **một** nút nổi `jumpBottom` khi chưa ở đáy. `foldbtn` + `ChapterNav` gom vào một cụm góc trên-phải.
- **Footer message: 10 → 3 + `…`.**
  - Ngoài: `copy` · `quote` · `bookmark` (khi bookmark được).
  - Trong `…`: fullscreen response · fullscreen turn · branch · fork · **và nhóm phá huỷ tách bằng separator**: regenerate · retry-model · rewind.
  - **Bỏ `opacity:0`**: 3 nút hiện thường trực ở `--textFaint`, đậm lên khi hover message (`prototype.css:400-401`). Ít nút + luôn ở đó thì mắt quen vị trí; 10 nút bung ra khi rê chuột mới là cái gây giật.

**Đụng tới:** `SessionTranscript.vue`, `SessionMessageItem.vue:709-735`, `prototype.css:396-401`.

### 3.4 Status bar — 11 mục → 8 *(sửa lại sau khi dùng thật)*

```
[usage]          …          [branch] [43k/1M] [Opus 4.8 ▾] [terminal]
```

- **Gộp Model + Account + Effort + Style** thành một chip nhãn `Opus 4.8`, popover 4 section. Quota đã có donut usage lo, nên account không cần nhãn thường trực. **Giữ.**
- ~~Bỏ chip project~~ và ~~bỏ toggle Files + Browser~~ — **đã hoàn tác 2026-09-12 sau khi dùng thật.** Lập luận ban đầu ("tên project lặp lần thứ ba", "Files/Browser là *view* nên thuộc `Views ▾`") đúng về mặt phân loại nhưng sai về thực tế dùng: cái lặp lại là một *chuỗi*, còn cái bị mất là một *hành động* bấm hằng ngày — và một cú bấm ở mép cửa sổ không thay được bằng hai cú bấm qua menu. Hàng "Mở project" trong context-menu của tab giữ lại làm đường thứ hai.
- Kết quả thật: **11 → 8**. Phần giảm bền vững là cụm cấu hình 4 chip → 1.

> **Bài học ghi lại:** ba mục này bị cắt vì *mô hình phân loại*, không phải vì đo tần suất dùng. Trước khi bỏ một điều khiển khỏi bề mặt luôn-hiện, hỏi "nó được bấm bao nhiêu lần một ngày", đừng hỏi "nó thuộc loại nào".

**Chip cấu hình gộp — sửa lần hai (2026-09-12).** Bản đầu xếp bốn mục CHỒNG nhau trong một khung cuộn `60vh`, nên "Văn phong" nằm dưới ba danh sách và coi như biến mất. Nay:

- Bốn mục là bốn **segment** ở đầu popover — mọi mục cách chip đúng **một** cú bấm, không mục nào bị cuộn qua. Segment `Mức suy luận` tự ẩn với model không hỗ trợ.
- Nhãn chip mang **cả model lẫn văn phong** (`Opus 4.8 · Normal`). Gộp chip thì được, nhưng gộp xong mà giá trị biến khỏi thanh thì người dùng mất chỗ liếc — account và mức suy luận ở lại trong popover vì chúng ít đổi hơn.
- `/style` ở composer vẫn gọi `open('style')`; giá trị đó giờ chọn thẳng segment thay vì phải cuộn tới.

**Đụng tới:** `AppStatusBar.vue`, `StatusConfig.vue`.

### 3.5 Workspace panel — bớt chrome, không đổi mô hình dock

Giữ nguyên 2-dock đồng thời. Chỉ giảm chrome:

- **Tab = icon-only**, chỉ tab active hiện nhãn; `×` chỉ hiện khi hover tab. Ở 240–322px, tab strip hiện tại tiêu gần hết bề ngang cho nhãn lặp lại.
- **3 nút cố định → 2**: giữ `+` (thêm view) và `×` (đóng panel, ngoài cùng phải theo quy ước cửa sổ). **Đổi dock** chuyển vào context-menu chuột phải trên tab (đã có `ContextMenu` dùng chung) — thao tác tần suất thấp không đáng một nút thường trực ở mọi dock.
- **`wphead` cao cố định 32px** + hairline `inset box-shadow` (thay `border-bottom`, theo ADR 0079).
- **Primitive `WorkspaceViewHeader`**: 12 view đang tự vẽ toolbar riêng (0–15 nút). Chuẩn hoá một hàng 28px: `[nhãn/nguồn] … [≤2 action] [ … ]`. Rule of Three đã vượt từ lâu.

### 3.6 Tab Browser — 15 nút → 5 + `…`

View rối nhất. Trong 322px:

- **Ngoài:** `←` `→` `⟳` · ô URL · `…`
- **Trong `…`:** tab mới · dock · menu · popout · ghim · copy URL · dịch · trích dẫn · chọn phần tử · đóng.
- Tab strip của browser: favicon + nhãn **chỉ cho tab active** (cùng luật §3.5).
- Luật xuống dòng `flex: 1 1 110px` giữ nguyên — vẫn cần ở 240px, nhưng với 5 nút thì gần như không bao giờ phải wrap.

**Đụng tới:** `BrowserChrome.vue`.

### 3.7 Composer — 6 điều khiển → 4

```
[Execute ▾]                              … [clip] [ … • ] [ Gửi ]
```

Ngoài: **mode** (per-turn, hệ quả lớn nhất) · **đính kèm** · `…` · **Gửi**.
Trong `…`: **MCP whitelist** · **ghim context** · **làm đẹp prompt**. Ba cái này đều là cấu hình đặt một lần rồi để đó, không phải thao tác mỗi lượt — `…` mang một chấm accent khi có thứ đang bật (whitelist bị thu hẹp, hoặc có file đang ghim), nên không mất tín hiệu trạng thái.

### 3.8 Toolbar cột danh sách — 4 nút → 2

Ngoài: ô tìm · `+` (tạo phiên). Trong `…`: chế độ chọn · bộ lọc · gấp tất cả — ba thao tác tần suất thấp đang chiếm chỗ thường trực ngang hàng với nút tạo phiên.

### 3.9 Bán kính — thôi dùng viên thuốc cho nhãn chữ

Bo tròn hoàn toàn (`--r-pill` / `999px`) trên một nhãn chữ là idiom tag của web 2015–2019: ở cỡ 11–12px hai đầu cong ăn mất phần đệm ngang, và nó tách nhãn ra khỏi thang bán kính mà nút / ô nhập / thẻ đang dùng. Trong repo hiện có **~86 chỗ** gọi `--r-pill` hoặc `999px` (25 trong `assets/css/`, 61 trong `components/`).

**Luật:** `--r-pill` chỉ dành cho thứ mà *tròn là hình dạng*, không phải trang trí — thanh tiến độ, rãnh slider, công tắc, thanh cuộn, avatar tròn, chấm trạng thái. **Mọi container chứa chữ dùng `--r-sm` (8px)**, hoặc `--r-xs` (6px) khi cao < 20px.

Phải đổi: `.tag` · `.gchip` · `.ghstate` · `.ghlabel` · `.ghrepo` · `.ghref` · `.bswitch` · `.pagent` · `.glref .st` · `.fwanchor` · `.statusbadge` · `.archchip` (`prototype.css` + `SessionListItem.vue`).

Giữ nguyên: `.bar` · `.slider` · `.ctxbar` · `.tog` / `.tog2` · `.rlbar2` · `.cresize::after` · `.fbadge` · `.pav2` · scrollbar thumb.

Đổi trong cùng đợt với §3.2 (chip của strip ngữ cảnh sinh ra đã phải đúng luật này) — không tách thành một PR "đổi bán kính toàn app", vì như vậy là một diff lớn không kèm thay đổi hành vi nào.

### 3.10 Nhịp ngang — cột detail đang có ba lề trái khác nhau

Đo trên `prototype.css`, ba thứ xếp chồng trong cùng một cột lại neo vào ba lề khác nhau:

| Thành phần | Lề trái hiệu dụng | Nguồn |
|---|---|---|
| Tiêu đề header | **16px** | `.dh{padding:0 16px}` (dòng 198) |
| Nội dung transcript | **20px** | `.msgs{padding:20px}` (dòng 396) |
| Chữ trong ô soạn | **29px** | `.composer{padding:13px 16px}` + `.cbox{padding:11px 13px}` (dòng 275–276) |

Mắt bắt được độ lệch 4px giữa hai khối xếp dọc, và ở đây có hai độ lệch chồng lên nhau. Kèm theo đó, các cụm phụ cũng mỗi chỗ một số: `.ltop` 11 · `.li` 10 · `.wphead` 8 · `.wptab2` 8.

**Luật:** hai token, không hơn.

- `--padX` (**22px**) — dùng cho **mọi** thứ trong cột detail: `.dh` · strip ngữ cảnh · `.msgs` · `.composer`. Ô soạn bù lại bằng cách giảm đệm trong `.cbox` để chữ vẫn rơi đúng lề chung.
- `--padXs` (**14px**) — cột danh sách và workspace panel, vốn hẹp nên cần lề nhỏ hơn: `.ltop` · `.rows` · `.wphead` · toolbar của các view.

Đồng thời nới đệm ngang của control nhỏ (chip 9→11, tab 7→10, `.sbi` 7→9, menu item 9→12): ở cỡ chữ 11–12px thì 7px đệm làm chữ dính vào viền.

**Không đổi đệm dọc** trong đợt này — chiều cao thanh đã bị ADR 0079 ràng (chẵn, để icon không rơi vào nửa pixel), đụng vào là phải đo lại cả bảng.

### 3.11 Dock bên chạy hết chiều cao khung

Trước: `.detail` là một CỘT — header, rồi `.chatwrap > .wptop` chứa (dock trái · chat · dock phải). Hệ quả: panel bắt đầu **dưới** header phiên, và header trải ngang cả phần nằm trên panel.

Sau: `.detail` là một **HÀNG** (`.sdrow`, class riêng vì `.detail` dùng chung với mọi trang detail khác):

```
.detail.sdrow                     ← flex row
├── [dock trái] [rszwp]           ← full height
├── .sdmain                       ← flex column, flex:1
│   ├── .dh                       ← header CHỈ trải trên cột chat
│   └── .chatwrap
│       ├── .wptop > .chat
│       └── [rszwp vert] [dock dưới]   ← chỉ dưới cột chat
└── [rszwp] [dock phải]           ← full height
```

Dock **dưới** cố ý ở lại trong `.sdmain`: nó nằm dưới chat chứ không chui xuống dưới hai panel bên — đúng mô hình bottom panel của VS Code.

**Đo được sau khi sửa** (khung 1200×600, panel phải 322px):

| Kiểm | Kết quả |
|---|---|
| Panel chạy hết chiều cao khung | `top 0 = khung 0`, `bottom 600 = khung 600` ✅ |
| Panel chạm mép phải | `right 1200 = khung 1200` ✅ |
| Header không trải dưới panel | `header.right 872 ≤ panel.left 878` ✅ |
| Strip ngữ cảnh không trải dưới panel | ✅ |
| Dock dưới chỉ nằm dưới cột chat | `0…872`, bằng đúng `.sdmain` ✅ |
| `boxOf()` của trần mở rộng | `.detail` — vẫn đúng bề rộng panel thật sự có ✅ |

Không phải sửa: luật `@media(max-width:1040px){.wpanel,.rszwp{display:none!important}}` vẫn chạy (ẩn cả tay kéo nên hàng thu gọn sạch); `boxOf()` đo `parentElement` nên tự theo cây mới; rect của `WebContentsView` đo trên chính element placeholder nên đổi vị trí trong cây là trong suốt với nó.

## 4. Lộ trình — 5 pha, mỗi pha ship độc lập

| Pha | Nội dung | Tác động thị giác | Rủi ro |
|---|---|---|---|
| **P0** | Trần `78ch` cho transcript + footer message 10→3+`…` + nhịp ngang `--padX`/`--padXs` (§3.10) | **Cao nhất / rẻ nhất** | Thấp — CSS + một mảng `msgActions` |
| **P1** | Header 8→2 nút, gỡ nhánh `isCute` trùng lặp | Cao | Thấp — markup đã có sẵn ở nhánh cute |
| **P2** | `SessionContextStrip` gộp banner | Cao | Trung — đụng ADR 0069, phải giữ luật "không tự ẩn" |
| **P3** | Status bar 11→5, toolbar danh sách 4→2, composer 6→4, chuyển Files/Browser sang `Views ▾` | Trung | Trung — đụng `useWorkspacePanel` bridge |
| **P4** | `WorkspaceViewHeader` + BrowserChrome 15→5 | Cao (trong panel) | Trung — 12 view migrate dần |

P0+P1 làm được trong một PR và đã giải quyết phần lớn cảm giác "rối mắt" ở cột chat.

## 5. Đã ship gì

| Pha | Trạng thái | File chính |
|---|---|---|
| P0 | ✅ | `prototype.css` (`--padX` / `--readw`) · `SessionTranscript.vue` · **mới** `SessionMsgActions.vue` · `SessionMessageItem.vue` |
| P1 | ✅ | `SessionDetail.vue` (8 nút → 2; gỡ nhánh `isCute` trùng) · `app-shell.css` (`.smenu .msep`) |
| P2 | ✅ | **mới** `SessionContextStrip.vue` · `SessionTodoPanel.vue` + `SessionBookmarkBar.vue` (thêm `variant: 'bar' \| 'chip'`) · `app-shell.css` (`.ctxstrip` / `.ctxchip`) |
| P3 | ✅ (status bar 11→8, không phải →5 — xem §3.4) | `StatusConfig.vue` (4 chip → 1) · `AppStatusBar.vue` · `SessionTabBar.vue` (nhận quick-view project) · `SessionList.vue` · `SessionComposer.vue` · `SessionMcpChip.vue` (`variant: 'inline'`) |
| P4 | ✅ một phần | `SessionWorkspacePanel.vue` (chrome 3 → 2, tab chỉ-icon) · `BrowserChrome.vue` (15 nút → 7) |

Verify: `pnpm typecheck` = 0, `pnpm lint` = 0 (gồm `check-design-tokens`), app boot sạch console.

## 6. Không làm (YAGNI)

- Không đổi mô hình 2-dock đồng thời.
- Không đụng pipeline render craft-parity (`SessionTurnActivities`, grouping, streaming).
- Không thêm thư viện UI.
- Không đổi `useTheme()` token hay bảng màu — đây là bài toán **mật độ** (và một phần bán kính), không phải bài toán màu.
- Không đụng `--r-pill` ở nhóm track/knob/avatar (§3.9) — chỉ nhãn chữ.
- Không đụng theme `cute` ngoài việc xoá nhánh markup trùng ở §3.1.

## 7. Còn nợ — primitive `WorkspaceViewHeader`

Hạng mục cuối của §3.5 **chưa làm**: chuẩn hoá toolbar của 12 view trong Workspace Panel thành một primitive dùng chung. Lý do hoãn, nói thẳng: nó là **churn thuần** — chạm 12 file mà không đổi gì người dùng nhìn thấy, trong khi phần rối thật sự của panel (BrowserChrome 15 nút) đã xử lý rồi. Nó xứng đáng một PR riêng có QA riêng, chứ không phải đi ké một đợt đang đổi bố cục.

## 8. Cách đo là đã đỡ rối

1. **Đếm nút/chip hiện thường trực** trên toàn màn (panel Browser mở, cụm hành động một lượt tính khi hover), không tính tab và nội dung transcript: **70 → 37** (34 theo thiết kế ban đầu, +3 sau khi trả lại chip project · Files · Browser ở §3.4). *(Con số 35→18 trong bản nháp đầu là ước lượng và nhẹ hơn thực tế — đếm lại trên bản dựng mới ra 70→34.)*
2. **Số lớp nổi trên `.msgs`**: 5 → 3.
3. **Ký tự/dòng** ở cửa sổ 1800px: ~180 → ~78.
4. **Số hàng chrome dọc giữa tab strip và transcript**: tối đa 7 → 2.
5. Không regression: `pnpm lint` (gồm `check-design-tokens.mjs`) + `pnpm typecheck` = 0 error.
