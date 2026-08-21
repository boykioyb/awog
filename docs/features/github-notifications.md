# GitHub notifications → hộp thông báo + toast trong app

> Trạng thái: **implemented** (2026-08-14; bổ sung inbox + mark-as-read 2026-08-21). Liên quan: [project-github.md](project-github.md), [ADR 0049](../decisions/0049-github-issues-and-prs-via-gh-cli.md).

## Vấn đề

Khi làm việc trong AWOG, các sự kiện đáng chú ý trên GitHub (được yêu cầu review, bị mention, có comment mới trên PR của mình) chỉ thấy được nếu chủ động mở tab Issues/PR hoặc rời app sang github.com. Người dùng muốn **biết ngay trong app**, không phải đi kiểm tra.

## Phạm vi

- **Poll hộp thông báo GitHub** của gh account đang dùng (mặc định app-level, Settings → Git).
- **Hộp thông báo trong app (bell ở TopBar)**: danh sách **toàn bộ** thread chưa đọc của account + badge số, bấm dòng → mở thread, đánh dấu đã đọc từng dòng hoặc tất cả.
- **Opt-in theo project quyết định việc BÁO, không quyết định việc HIỂN THỊ**: một tài khoản GitHub thường có hàng chục repo; chỉ project người dùng chọn mới được toast / bắn native. Danh sách trong bell luôn đầy đủ — một cái chuông trống phải có nghĩa "hộp thư sạch", không phải "thiếu tick một checkbox".
- **Chọn kiểu gửi**: toast in-app (bấm được → mở thẳng drawer PR/Issue), thông báo **native OS**, hoặc cả hai.
- KHÔNG có: subscribe/unsubscribe, lọc theo `reason`, mark-as-unread (chưa cần — YAGNI).

## Luồng

```
useGhNotifications (renderer, singleton, main window)  — TIMING + ALERTING
   │  mỗi tick (≥60s)
   ├─ gh.notifications { account?, limit }
   │        └─ sidecar: gh api "notifications?per_page=N"   (1 spawn, toàn bộ unread)
   ├─ setGhInbox(list)  ──────────────► useGhInbox (state danh sách + badge)
   │                                        └─ TopBarNotifications (bell + panel)
   ├─ lọc isAlerting (repo → project ĐÃ opt-in)
   ├─ dedupe theo (id, updatedAt) — persist localStorage
   ├─ pushActionToast(text, { action, icon })       → ActionToastHost
   └─ Notification API khi window hidden/blur       → click = focus + route
```

Hai module tách theo lý do thay đổi: `useGhNotifications` lo **khi nào poll / cái gì được phép ngắt lời**, `useGhInbox` lo **danh sách người dùng xem** (state, đếm, đã đọc). Poller đẩy list cho inbox nên badge cập nhật mà không tốn thêm spawn `gh`; mở panel gọi thêm 1 refresh (câu hỏi "giờ tôi đang có gì" đáng 1 lần fetch).

Click toast → `useProjectModal.open(projectId, { tab, ghNumber })` → ProjectQuickViewModal → ProjectDetail (chuyển tab + `openNumber`) → ProjectGh → `gh.open(number)` mở drawer. Không map được project/number (release, discussion…) ⇒ `openExternal(url)`.

## RPC

| Method | Params | Trả về |
|---|---|---|
| `gh.notifications` | `{ account?, limit?: 1..100 }` | `{ notifications: GhNotification[] }` (unread; GitHub cap 50/page) |
| `gh.notificationsRead` | `{ account?, threadId?: /^\d{1,20}$/ }` | `{ ok: true }` |
| `gh.subjectAuthors` | `{ account?, items: [{ repo: owner/name, number }] }` (≤50) | `{ authors: { "owner/repo#123": login } }` |

```ts
type GhNotificationType = 'PullRequest' | 'Issue' | 'Other'
interface GhNotification {
  id: string            // thread id (ổn định qua các lần update)
  unread: boolean       // false = đã đọc (field thiếu ⇒ coi là chưa đọc)
  reason: string        // review_requested | mention | assign | comment | …
  updatedAt: string
  title: string
  type: GhNotificationType
  repo: string          // owner/repo
  number: number | null // null cho release/discussion
  url: string           // LUÔN là https://github.com/… (khác ⇒ bỏ)
}
```

- **Account-scoped, KHÔNG repo-scoped** → dùng `runGhAccount()` (không cwd): inbox trải trên mọi repo nên không có project cwd để gán, và cũng không có gì path-like đi vào args.
- **Không có `since`**: mỗi tick lấy **nguyên hộp unread** (`per_page=50`). Đây là điều kiện để bell là danh sách đúng — với delta, thread đã đọc bên github.com sẽ nằm lại trong panel mãi. Dedupe cho toast vẫn do `seen` lo, nên bỏ `since` không sinh toast lặp.
- `gh.notificationsRead` là **mutation duy nhất** của surface này: có `threadId` ⇒ `PATCH /notifications/threads/<id>` (1 thread), không có ⇒ `PUT /notifications` (cả hộp thư, kể cả repo AWOG không hiển thị ⇒ UI hỏi xác nhận trước). `threadId` validate `^\d{1,20}$` vì nó là giá trị duy nhất do renderer cấp được ghép vào request path.
- Parse bằng zod lenient (`.passthrough()`), chỉ pick field cần; `subject.url` (API url) map sang web url + số hiệu.

## Author (ai tạo PR/issue)

Payload REST của notifications **không có author** — chỉ `subject.title/url/type`. Lấy từng thread qua `subject.url` là **1 request/dòng** (50 spawn mỗi lần mở panel), nên `gh.subjectAuthors` gộp thành **1 request GraphQL** với 1 alias/item (`a0`, `a1`, …) và `issueOrPullRequest(number:)` phủ cả PR lẫn Issue.

- **Bảo mật**: mọi giá trị do renderer cấp (owner, name, number) đi bằng **GraphQL variable**, KHÔNG nội suy vào query string. Phần sinh động duy nhất trong query là chỉ số alias — caller không tác động được. `repo` vẫn validate `^[\w.-]+/[\w.-]+$` để entry sai fail sớm thay vì tốn một request.
- **Partial success**: GraphQL trả `data` tốt + `errors` cho alias bị từ chối (repo mất quyền/đã xoá) và **`gh` exit code 1** cho trường hợp đó (đo thật). Runner strict sẽ ném đi cả loạt dữ liệu tốt, nên có `runGhAccountAllowPartial` — non-zero mà vẫn có body thì trả body, schema của caller tự quyết định dùng được không. Một repo chết không được phép xoá author của 49 dòng còn lại.
- **Khi nào gọi**: lúc mở panel / refresh tay, KHÔNG theo mỗi tick poll — nó tốn thêm 1 spawn `gh` mà giữa các lần đó không ai đang đọc list. Cache theo `repo#number` **không TTL**: author của một PR không đổi.
- Dòng không có số hiệu (release/discussion/CI activity, `type: 'Other'`) thì bỏ trống — không hiện placeholder. Đo trên hộp thư thật: 43/50 dòng có author, 7 dòng còn lại là CI activity.

## Read state — vì sao KHÔNG dùng `all=true`

`gh.notifications` chỉ lấy **unread**. Muốn phân biệt đã-đọc/chưa-đọc thì cách hiển nhiên là hỏi GitHub cả thread đã đọc (`all=true`) — và nó **sai** ở đây: endpoint này trả tối đa **50 dòng/page** bất kể `per_page`, nên thread đã đọc sẽ **đẩy thread chưa đọc thật ra khỏi page** (đo trên hộp thư thật: `all=false` → 50 unread; `all=true` → 39 unread + 11 read, tức mất 11 thông báo chưa đọc, badge đếm thiếu 11).

Nên read-state là **bookkeeping của renderer**: `setGhInbox` fold page unread mới vào list cũ — thread từng có trong list mà không còn trong page unread ⇒ đã đọc (ở đây hoặc trên github.com) ⇒ **giữ lại, làm mờ** (cap `READ_KEEP` = 25 dòng mới nhất) thay vì biến mất. Bấm ✓ cũng giữ dòng lại: dòng lặng đi là feedback "đã xử lý", dòng biến mất đọc như bấm nhầm.

Hệ quả cho toast: poll giờ lọc thêm `n.unread` — thứ đã đọc trên github.com không bao giờ được toast lại. `checkGhNotifications` cũng đếm trên tập unread (câu hỏi nó trả lời là "thông báo có tới tay tôi không").

## Dedupe & seed

- **Key dedupe = `(id, updatedAt)`**, không phải id: GitHub giữ nguyên thread id khi có comment mới, nên chỉ so id sẽ nuốt mất "PR cũ có hoạt động mới".
- **Seed lần đầu**: lần poll đầu tiên của một máy mới chỉ ghi nhận inbox hiện có mà KHÔNG toast — nếu không, mở app lên là ăn một tường toast cho thứ đã đọc trên github.com.
- **Mốc "đã seed" = có `polledAt` trong localStorage**, KHÔNG phải "`seen` không rỗng". Bug cũ: `seen` chỉ có entry khi có thông báo khớp project đã opt-in, nên máy chưa từng khớp sẽ **seed lại mỗi lần mở app** — im lặng nuốt đúng lô thông báo đầu tiên sau mỗi lần khởi động (đây là triệu chứng "bật rồi mà chẳng thấy toast nào").
- `seen` (cap 300 entry) + `polledAt` persist localStorage → restart app không toast lại.
- Stamp `polledAt` TRƯỚC khi present để một lỗi khi hiển thị không làm tick sau coi lần chạy này là baseline im lặng lần nữa.
- Một tick nhiều thông báo mới → tối đa **3 toast** + 1 dòng gộp `+N`.

## Settings (Settings → Git)

| Setting | Mặc định | Ghi chú |
|---|---|---|
| `githubNotify.enabled` | `true` | Bật/tắt nguồn GitHub (công tắc nằm ở Settings → Thông báo). Tắt ⇒ không poll; bell chỉ cập nhật khi bấm refresh tay. |
| `githubNotify.intervalMs` | `60_000` | 1/2/5/10 phút. Poller **floor ở 60s** — mức tối thiểu GitHub tài liệu hoá cho API này. |
| `githubNotify.projectIds` | `[]` | Danh sách project được **báo** (checkbox). Rỗng ⇒ vẫn poll và vẫn đầy bell, chỉ là không toast/native. |

**Ranh giới cấu hình** (một chỗ một việc):

- **Settings → Thông báo** — *thông báo đến tay người dùng KIỂU GÌ*, dùng chung cho mọi nguồn: `notifications.delivery` (`toast` / `native` / `both`, mặc định `both`), `notifications.toastPosition` (6 góc, mặc định `bottom-right`) + nút Xem thử, và công tắc bật/tắt từng nguồn (`sessionEvents`, `githubNotify.enabled`).
- **Settings → Git → Thông báo GitHub** — *poll CÁI GÌ*: chu kỳ, danh sách project, nút **Kiểm tra kết nối** (`checkGhNotifications()`). Nút này là chẩn đoán: poll cố tình nuốt lỗi (toast lỗi mỗi phút còn tệ hơn thiếu tính năng) nên đây là chỗ duy nhất thấy được gh chưa auth / project map sai. Nó fetch một lần rồi báo inline `matched/total`, KHÔNG bắn toast và KHÔNG đụng `seen`/`polledAt`.

Slice `notifications` gom từ 3 chỗ cũ (`githubNotify.delivery`, `appearance.toastPosition`, `sessions.notificationsEnabled`) — store seed từ giá trị cũ khi hydrate nên install đang chạy không mất lựa chọn.

**Thông báo native OS** dùng Notification API của renderer (Chromium trong Electron) — cùng đường với native notification của Sessions, KHÔNG phải `Notification` của Electron main. Quyền chỉ xin khi người dùng chọn kiểu gửi có OS (không bao giờ xin lúc boot), và chọn xong là **bắn ngay một thông báo mẫu**: quyền bị từ chối mà im lặng thì không phân biệt được với "chưa có thông báo nào". Kết quả (`granted` / `denied` / `unsupported`) hiện ngay ở mô tả của field. Lưu ý môi trường: bản dev chưa ký hiện tên "Electron", và Focus/Do Not Disturb của macOS vẫn chặn được — đó là hành vi của OS, không phải lỗi app.

Kiểu gửi `native` cố tình bỏ qua cổng focus cho thông báo GitHub (không có toast thì phải có cái gì đó hiện ra kể cả khi app đang trước mặt); `both` giữ luật cũ — OS chỉ bắn khi cửa sổ không focus. **Sự kiện session luôn chỉ bắn khi mất focus** kể cả ở mode `native`: session đang mở đã hiện trạng thái trực tiếp rồi. Mode `toast` = không bao giờ đụng OS, áp cho mọi nguồn.

## repo → project

Map `owner/repo` (lowercase) → projectId, dựng lại mỗi khi đổi lựa chọn project / account:

1. `githubSlugFromRemote(project.gitRemote)` cho **mọi** project — đồng bộ, rẻ, phủ project single-repo. Phải là "mọi" (không chỉ project đã opt-in) vì bell hiển thị cả repo không theo dõi và vẫn cần route được cú click.
2. `git.discoverRepos` cho từng project **đã opt-in** — phủ **multi-repo workspace** (project root không có remote riêng). Chỉ giới hạn ở project đã chọn vì mỗi project tốn 1 lệnh sidecar.

`projectForRepo(repo)` → projectId | null (route click), `isAlerting(n)` → repo có project VÀ project đó đã opt-in (được phép toast/native).

## Hộp thông báo (bell ở TopBar)

- **Vị trí**: `TopBarNotifications` trong [AppTopBar](../../apps/desktop/ui-next/components/shell/AppTopBar.vue), ngay trước hộp tìm kiếm. Badge = số thread chưa đọc (cap hiển thị `99+`).
- **Panel**: hàng tab `Tất cả` / `Đang theo dõi` (kèm số + tooltip giải thích) · refresh (icon **quay khi đang tải** — phản hồi duy nhất cho một hành động không đổi gì trên màn hình khi hộp thư không có gì mới) · đánh dấu đã đọc tất cả · mở Settings → Git · footer "Đã kiểm tra …" + link mở github.com/notifications.
- **Hàng tab chỉ hiện khi nó THỰC SỰ lọc** (`watchedItems.length < items.length`). Hai tab cùng số (mọi thông báo đều thuộc project đang theo dõi) chỉ dạy người dùng đúng một điều: một trong hai tab vô nghĩa. Khi tab biến mất mà filter đang bật thì tự trả về `Tất cả` — không được lọc âm thầm mà không còn control trên màn hình.
- **Nhóm không theo dõi mang chip `không theo dõi`** thay vì chỉ làm mờ: nói ra lý do, đừng để người dùng suy từ một giá trị opacity.
- **Nhóm theo repo**: một hộp thư thực tế chỉ sâu vài repo (đo thật: 49/50 thông báo cùng 1 repo), nên in `owner/repo` trên từng dòng là đem cột rộng nhất cho chữ ít thông tin nhất. Header nhóm (sticky trong vùng cuộn) mang tên repo **một lần** + số lượng; nhóm không thuộc project đang theo dõi ⇒ mờ nhẹ (vẫn hiện — nó có trong hộp thư thật).
- **Thu gọn theo nhóm**: cả header là nút toggle (đích bấm to hơn hẳn một cái chevron đứng lẻ), chevron quay 90° khi mở, `aria-expanded` theo trạng thái. Nhóm đã thu gọn **vẫn giữ dot accent + số lượng** ⇒ gấp một repo ồn ào lại không bao giờ che mất việc nó có cái mới. State giữ trong component, **KHÔNG persist**: một nhóm bị gấp từ phiên trước sẽ âm thầm ẩn thông báo mới ở lần mở app sau.
- **Dòng** (`TopBarNotifyRow`) 3 khối xếp dọc trong cột text: **tiêu đề** (WRAP, clamp 3 dòng) → meta mờ 12px `#số · lý do · thời gian` → **hàng action riêng**. Tiêu đề là thứ người ta đọc nên nó được wrap thay vì cắt `…`: một title GitHub bị cắt thường mất đúng đoạn nói cái gì đã đổi. Clamp 3 dòng chỉ để một title bệnh lý không ăn hết panel (`-webkit-box` + `-webkit-line-clamp` — property `line-clamp` chuẩn chưa có trên Chromium 130).
- **Meta line**: `#số · @author · lý do · thời gian`. Author đứng **trước** lý do để không bị cắt trước — "PR của ai" là câu hỏi người ta hỏi cái dòng đó. Tooltip = "Người tạo: @login".
- **Chưa đọc vs đã đọc**: dòng chưa đọc có **nền tint accent** (`color-mix(in srgb, var(--accent) 8%, transparent)`, hover 15% — cùng một tint đậm lên, KHÔNG đổi sang xám kẻo dòng đang hover trông "ít chưa đọc" hơn dòng bên cạnh) + dot accent + tiêu đề `--text`; dòng đã đọc: nền trong suốt, không dot, `--textDim`. Dot **luôn chiếm chỗ** kể cả khi ẩn để 2 loại dòng vẫn thẳng hàng.
- **Seam giữa các dòng = KHOẢNG CÁCH, không phải hairline**: hairline giữa hai khối cùng tint là vô hình, hai dòng chưa đọc liền nhau sẽ dính thành một khối. Gap 4px + góc bo ⇒ mỗi dòng là một khối rõ ràng; hairline chỉ giữ lại giữa **hai dòng đã đọc** (cả hai trong suốt nên cần đường phân cách). Lý do thuộc nhóm cần-hành-động (`review_requested`/`mention`/`assign`/`team_mention`) mới lấy màu accent — inbox mà dòng nào cũng có màu là inbox không có tín hiệu (đo thật trên 1 hộp thư: 26 review request / 8 CI).
- **Action = 2 nút pill CÓ NHÃN trên hàng riêng**, luôn hiện: "Đánh dấu đã đọc" (chỉ dòng chưa đọc) + "Mở trên GitHub". Không tranh bề rộng với tiêu đề, và không có icon nào phải đoán nghĩa. Dòng cao hơn (~87–106px) là cái giá đổi lấy chỗ đó — cố ý.
- Đường hairline giữa các dòng: dòng nhiều dòng-chữ cần seam mới đọc ra là các item riêng.
- Lịch sử 2 bản trước (đã sửa): nút ✓ ở cột riêng chỉ hiện khi hover ⇒ **rãnh trống chạy suốt list** + action mà người dùng phải quét chuột mới biết là có; và `display:none` ⇒ không focus được, mark-read rơi khỏi đường bàn phím.
- **Bấm dòng = mở, KHÔNG mark read**: mở thread rồi âm thầm xoá khỏi hộp thư thì một cú click lỡ tay là mất dấu. Mark read là hành động riêng (nút ✓ mỗi dòng, hoặc ✓ ở header cho cả hộp thư + confirm).
- **Optimistic**: dòng rời list ngay khi bấm ✓; RPC lỗi ⇒ hiện lỗi và dòng quay lại ở tick sau. `pendingRead` chỉ giữ trong lúc RPC đang bay — một thread chưa đọc lại (comment mới, cùng id) phải được phép quay lại.
- **Dòng dùng CSS Grid, KHÔNG flex** — `grid-template-columns: 6px 13px minmax(0, 1fr)` (dot · icon · text). Bản flex (`flex: 1 1 auto` + `min-width: 0` trên `<button>`) truncate đúng trên **Chromium 151** nhưng **tràn trên Chromium 130** — engine mà Electron 33 thực sự dùng: form control giữ min-size nội tại, `min-width: 0` không cứu được. Track grid tính từ container nên mọi engine ra cùng một bề rộng. Thêm `overflow: hidden` ở `.ntf-row` + `.ntf-row-main` làm lớp chặn cuối: con có tính sai cũng không vẽ được sang cột action.
- **Verify layout phải chạy trên Chromium của Electron**, không phải Chrome hệ thống. Cách làm: mở UI dev-server bằng đúng binary `apps/desktop/electron/node_modules/electron` với `--remote-debugging-port`, rồi đo qua CDP (`scrollWidth - clientWidth`, `getBoundingClientRect`).
- Panel rộng 420px, `overflow-x: hidden`. Backdrop + Esc để đóng (band z-index 95/96: trên nội dung trang ≤61, dưới modal ≥100).

## Bảo mật

- Token gh không rời sidecar (invariant #1): `runGhAccount` dùng đúng đường `resolveGhEnv` như mọi lệnh gh khác — token chỉ vào env của child.
- `url` trả về UI được ép phải nằm trên `https://github.com/` trước khi đưa vào `openExternal` — dữ liệu từ API vẫn coi là L1.
- Không thêm surface remote-gateway: `gh.*` KHÔNG nằm trong allowlist mobile (không cần infosec re-audit cho PWA).
- Poll thất bại (gh chưa cài / chưa auth / rate limit) là **im lặng** — toast lỗi mỗi phút còn tệ hơn thiếu tính năng; lỗi cuối lưu ở `useGhNotificationsStatus()` và hiện trong panel bell (đúng chỗ: người dùng đang mở ra để hỏi "có gì không?").
- `gh.notificationsRead` chỉ nhận `threadId` dạng số (`^\d{1,20}$`) → không có gì path-like ghép được vào endpoint; mark-all là `PUT /notifications` cố định, không nhận input.
- Kiểu gửi `native` mà OS **không cấp quyền** (hoặc webview không có Notification API) ⇒ tự rơi về toast. Trước đây trường hợp này rơi vào hư không: người dùng chọn `native`, OS im, app cũng im.

## Acceptance

- **AC1** — Bật toggle + chọn ≥1 project ⇒ trong vòng ≤ interval, notification mới của repo thuộc project đó hiện thành toast; project không chọn thì không.
- **AC2** — Bấm toast của PR/Issue ⇒ mở quick-view của đúng project, đúng tab, drawer đúng số hiệu. Bấm toast của release/discussion ⇒ mở github.com.
- **AC3** — Mở lại app không toast lại thông báo đã thấy; máy mới chạy lần đầu KHÔNG toast backlog.
- **AC4** — Kiểu gửi `both`: cửa sổ không focus ⇒ có native notification (khi đã cấp quyền), click vào route đúng như toast. Kiểu `native`: có notification OS kể cả khi app đang focus và KHÔNG có toast. Kiểu `toast`: không đụng OS.
- **AC5** — Tắt toggle ⇒ không còn lệnh `gh` nào chạy theo chu kỳ (bỏ chọn hết project thì VẪN poll — chỉ mất toast).
- **AC6** — gh chưa auth / lỗi mạng ⇒ không toast lỗi lặp lại, app vẫn hoạt động bình thường.
- **AC7** — Settings → Thông báo: đổi vị trí toast ⇒ toast mẫu hiện ngay ở góc mới; nút "Xem thử" bắn lại được mà không cần đổi vị trí. Vị trí áp dụng cho mọi toast, không riêng GitHub.
- **AC8** — Settings → Git → "Kiểm tra kết nối" ⇒ báo inline `matched/total` khi OK, hoặc lý do khi hỏng (chưa chọn project / engine không khả dụng / lỗi gh). KHÔNG bắn toast, và sau khi kiểm tra thì thông báo thật vẫn được bắn ở tick sau (không ghi `seen`/`polledAt`).

- **AC9** — Bell hiện badge = số thread chưa đọc của account; mở panel thấy đủ danh sách kể cả repo chưa opt-in; tab "Đang theo dõi" chỉ còn repo của project đã chọn. Danh sách nhóm theo repo, header sticky, KHÔNG scroll ngang ở mọi độ dài tiêu đề/repo.
- **AC17** — Dòng chưa đọc có nền tint (đậm hơn khi hover), dòng đã đọc trong suốt; hai dòng chưa đọc liền nhau vẫn tách được nhau ra bằng khoảng cách.
- **AC15** — Đang tải ⇒ icon refresh quay; xong thì dừng (và tắt khi người dùng bật Reduce motion).
- **AC16** — Mọi thông báo đều thuộc project đang theo dõi ⇒ **không hiện hàng tab**; có ít nhất 1 repo ngoài ⇒ hiện 2 tab với số khác nhau + nhóm ngoài mang chip "không theo dõi".
- **AC14** — Mở panel ⇒ trong ~1 request các dòng PR/Issue hiện `@login` người tạo; dòng release/CI không có thì bỏ trống. Một repo trong batch mất quyền ⇒ các dòng còn lại VẪN có author.
- **AC13** — Bấm header nhóm ⇒ nhóm đó thu gọn (mất hết dòng), header vẫn còn tên repo + dot + số lượng, `aria-expanded=false`, chevron thẳng; bấm lại ⇒ mở lại đúng danh sách cũ.
- **AC10** — Bấm ✓ một dòng ⇒ dòng **ở lại nhưng thành đã đọc** (mất dot, chữ mờ, mất nút ✓) và thread đó hết chưa đọc trên github.com; badge giảm 1. Bấm ✓ header ⇒ hỏi xác nhận, đồng ý thì hộp thư sạch cả hai bên.
- **AC12** — Đọc một thread trên github.com ⇒ tick sau dòng đó chuyển sang đã-đọc trong panel (không biến mất), badge giảm, và nó KHÔNG toast lại.
- **AC11** — Máy chưa từng khớp project nào: mở app lần thứ hai trở đi, thông báo mới ĐƯỢC toast (không còn seed lại mỗi lần khởi động).

## Chưa làm (có thể sau)

- Lọc theo `reason` (chỉ review_requested/mention).
- Mark-as-unread, subscribe/unsubscribe thread.
- Gộp nguồn khác (session, task) vào cùng bell — hiện bell chỉ là hộp thông báo GitHub.
- Dùng header `X-Poll-Interval` / `Last-Modified` của GitHub để nhịp poll tự thích ứng (hiện `gh api` không expose header cho caller).
