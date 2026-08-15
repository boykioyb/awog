# Feature: Project GitHub (tab Issues + Pull Requests + dịch LLM)

**Trạng thái:** Approved
**Ngày:** 2026-06-20
**ADR liên quan:** [0049 — GitHub Issues & PRs qua gh CLI](../decisions/0049-github-issues-and-prs-via-gh-cli.md)
**Feature liên quan:** [projects](./projects.md)

## Overview

Bổ sung hai tab GitHub vào trang chi tiết Project: **Issues** và **Pull Requests**. Mỗi tab liệt kê toàn bộ mục của repo (qua `gh` CLI) với **filter state riêng**, cho xem chi tiết một mục kèm comment trong một **drawer resize được**, và cho **dịch từng thành phần** (title / body / từng comment) sang tiếng Việt bằng LLM — mặc định luôn hiển thị bản gốc.

Issue và PR dùng **chung một bộ component + RPC**, phân biệt bằng `kind: 'issue' | 'pr'` (shape gần như đồng nhất; xem [ADR 0049](../decisions/0049-github-issues-and-prs-via-gh-cli.md)).

Đối tượng: dev dùng AWOG trên repo GitHub đã `gh auth login`, muốn đọc & hiểu issue/PR (kể cả tiếng Anh) ngay trong app.

## User Stories

- Là người dùng, tôi muốn xem danh sách issue **và** PR của repo trong project, lọc theo trạng thái, mà không rời app.
- Là người dùng, tôi muốn mở chi tiết một issue/PR (mô tả + comment) để hiểu ngữ cảnh đầy đủ.
- Là người dùng đọc tiếng Việt, tôi muốn dịch nhanh title/mô tả/comment tiếng Anh sang tiếng Việt, vẫn xem được bản gốc bất cứ lúc nào.

## Functional Behavior

### Tab Issues & Pull Requests

- Hai tab **Issues** và **Pull Requests** chỉ hiện khi `project.gitRemote` trỏ tới GitHub (regex `github\.com`). Repo không phải GitHub → ẩn cả hai.
- Trang detail project chuyển sang dạng có thanh tab: **Overview** (nội dung detail hiện tại) + **Issues** + **Pull Requests**. Mẫu thanh tab theo [GitTabBar.vue](../../apps/desktop/ui/components/git/GitTabBar.vue).
- Mở tab lần đầu → fetch danh sách (lazy). Có nút refresh thủ công.

### GitHub account (đa account) — định danh ở cấp app

- `gh` trên máy có thể đăng nhập **nhiều account**; lệnh gh mặc định chỉ dùng *active account*. AWOG cho chọn account ở **cấp app (ngoài project)**, không gắn vào từng project.
- **Account picker** (qua `AppSelect`) hiển thị ở header vùng GitHub (dùng chung cho cả hai tab), nạp từ `gh.accounts`, đánh dấu account `active`. Lựa chọn lưu **app-level** (settings store / settings.json), mặc định = active account. Đổi account → re-fetch list.
- UI truyền `account` (login) đã chọn vào mọi `gh.list`/`gh.get`. Sidecar chạy gh như account đó **không đổi active account global** (qua `GH_TOKEN`; xem [ADR 0049](../decisions/0049-github-issues-and-prs-via-gh-cli.md)).
- Account global không có quyền truy cập repo → gh báo lỗi, UI gợi ý đổi account.

### Danh sách (full-width) + filter — bắt buộc cả hai tab

- Hiển thị **full-width** trong tab (không split cột).
- **Filter state (bắt buộc cho cả Issues lẫn PR)** qua `AppSelect`:
  - Issues: **Open / Closed / All** (mặc định Open).
  - PR: **Open / Closed / Merged / All** (mặc định Open).
- **Filter assignee (cả hai tab)** qua `AppSelect`, server-side (`gh … --assignee`):
  - **Anyone** (mặc định, không lọc) / **Assigned to me** (`@me`) / từng assignee xuất hiện trong danh sách.
  - Option danh sách assignee dựng từ `assignees` của các dòng đã fetch (cộng "@me" luôn có sẵn); đổi assignee → **re-fetch** `gh.list`.
- **Filter reviewer (CHỈ tab PR)** qua `AppSelect`, server-side:
  - **Any reviewer** (mặc định, không lọc) / **@me** / từng requested reviewer xuất hiện trong danh sách.
  - `gh pr list` KHÔNG có cờ `--reviewer` → sidecar dịch thành qualifier `--search "review-requested:<login>"` (ghép với text search khi user gõ cả hai).
  - Option dựng từ `reviewRequests` của các dòng đã fetch (chỉ user; team request không có `login` nên bị bỏ). Giá trị đang chọn luôn nằm trong option list kể cả khi việc lọc làm nó biến mất khỏi danh sách.
  - Filter được persist theo `<projectId>:<kind>` như state/assignee; không bao giờ khôi phục sang tab Issues.
- **Search** theo title/number (lọc client trên danh sách đã fetch).
- Mỗi dòng:
  - **Issue**: `#number`, title, state badge (Open/Closed), labels, author, thời điểm cập nhật.
  - **PR**: `#number`, title, state badge (Open/Closed/**Merged**) + nhãn **Draft** nếu `isDraft`, `base ← head` branch, **chip reviewer**, labels, author, thời điểm cập nhật.
- **Chip reviewer trên mỗi dòng PR** — ai đang ở trong vòng review, **pending trước** rồi tới người đã review:
  - `PENDING` (icon `clock`, dim) = đã request nhưng chưa review · `APPROVED` (`check`, green) · `CHANGES_REQUESTED` (`x`, danger) · `COMMENTED` (`message`, dim) · `DISMISSED` (`minus`, dim).
  - Nguồn: `reviewRequests` (pending) + `latestReviews` (review mới nhất mỗi người) — merge theo login, **pending thắng** khi một người vừa review vừa bị request review lại. Body của review bị bỏ ở sidecar (dòng list chỉ cần ai + verdict).
  - `title` chip = "{login} · trạng thái" (i18n `projects.gh.reviewState.*`).
- Empty/error state riêng (xem [Trạng thái lỗi](#trạng-thái-lỗi--empty)).
- **Prefetch + cache (mục tiêu: mở tab KHÔNG thấy loading):**
  - **Warm sớm:** mở detail của project GitHub → `prefetchGhList()` chạy nền (`requestIdleCallback`, fallback `setTimeout 250ms`) cho **cả Issues lẫn PR** của repo mặc định, trong lúc user còn đang đọc Overview. Trong tab GH, đổi repo → warm luôn tab còn lại. Prefetch đọc **đúng filter đã persist** nên entry rơi vào đúng key mà tab sẽ đọc.
  - **Dedupe in-flight:** `gh.list` đang chạy được join theo key — prefetch + tab mở ngay sau đó dùng CHUNG 1 promise, không spawn gh 2 lần.
  - **3 tầng cache:** memory (`ghCache`, TTL 1h) → **disk seed** (`localStorage awog.gh.listCache`: chỉ view mặc định — không search, page đầu — tối đa 30 dòng đầu × 8 entry × 24h) → gh. Disk tier tồn tại để lần mở đầu **sau khi khởi động app** cũng có sẵn dòng để vẽ; nó là seed để paint, KHÔNG phải nguồn sự thật (luôn revalidate đè lên). Chỉ chứa metadata đã hiển thị trên UI (title/login/branch) — không token, không path.
  - **Stale-while-revalidate:** cache hit → vẽ ngay; nếu entry cũ hơn 45s thì chạy `gh.list` ngầm phía sau và swap khi có kết quả. Fetch ngầm KHÔNG bật `loading` (không skeleton, không làm mờ) — chỉ nút refresh xoay.
  - **Stale-response guard:** mỗi lần fetch mang một token; response của filter cũ về muộn thì bị bỏ, không ghi đè view hiện tại.
  - `refresh()` gọi ngay trong setup (không đợi `onMounted`) để cache hit gán `items` đồng bộ → khung hình ĐẦU TIÊN của tab đã có dòng.
- **Trạng thái đang fetch:**
  - Lần fetch đầu **và cache rỗng** (chưa có dòng nào) → **skeleton shimmer** `ProjectGhListSkeleton.vue` mô phỏng đúng layout dòng thật (số + title + state pill / branch + chip), thay cho dòng chữ "Loading…".
  - Fetch lại khi ĐÃ có dòng (refresh / đổi filter / search / load more) → **giữ nguyên dòng cũ, làm mờ** (`opacity .5`, transition 140ms). KHÔNG `pointer-events:none` vì `.ghlist` chính là scroller (sẽ chặn cuộn).
  - Nút refresh **xoay icon** trong lúc fetch + disabled.
  - Dòng mới mount **fade + rise** (200ms), stagger 22ms theo index, cap ở dòng thứ 10 (để "Load more" không phải chờ ramp dài). Dòng còn sống qua re-fetch được Vue tái dùng DOM (key = `number`) nên không animate lại.
  - Toàn bộ animation tắt dưới `prefers-reduced-motion: reduce`.

### Chi tiết (drawer resize được)

- Click một dòng → mở **drawer** dock bên phải, **kéo resize chiều ngang** (tái dùng pattern resize của Workspace/Git sidebar), có nút đóng. Danh sách phía sau giữ full-width.
- Drawer hiển thị:
  - **Header**: title + `#number` + state badge + author + labels + link "Open on GitHub" (mở `url` external). PR thêm `base ← head` + cờ Draft.
  - **Body** render markdown qua [MarkdownBodyView.vue](../../apps/desktop/ui/components/markdown/MarkdownBodyView.vue) (an toàn, không `v-html` thô).
  - **Danh sách comment**: mỗi comment = author + thời gian + body (markdown). Sort cũ → mới.
- **Mở drawer theo 3 chặng (lazy) — không chờ trắng màn:**
  1. **Seed từ dòng list (0 round-trip):** dữ liệu dòng đã có sẵn (title, `#number`, state, author, labels, `base ← head`) được shape thành `GhThread` và vẽ NGAY khi click. Chỉ vùng body/comment shimmer.
  2. **Core `gh.get` (1 spawn gh, ~0.7s):** body + comments + files.
  3. **Review timeline `gh.reviews` (2 REST call, ~0.9s):** stream vào SAU, không chặn bước 2. Trước đây `gh.get` gọi luôn 2 REST này ⇒ drawer chờ ~1.6s mới hiện gì; giờ chặng chặn chỉ còn ~0.7s và phần thấy đầu tiên là tức thì.
- **Prefetch theo hover:** rê chuột lên một dòng ≥140ms → warm core detail của dòng đó (`prefetchThread`). Click sau đó mở từ cache. Có debounce theo hover-intent nên quét chuột qua list không bắn gh mỗi dòng; request được dedupe theo số hiệu (hover + click dùng chung 1 promise).
- **Cache detail:** thread + review timeline + diff + commits cache riêng theo key (project|repo|kind|account|number), TTL 1h. Reviews được fold vào thread đã cache nên mở lại là đủ. Approve / refresh thread / post comment invalidate đúng phần liên quan.

### Dịch LLM theo từng thành phần

- **Mặc định: bản gốc.** Không tự động dịch gì.
- **Nút dịch riêng ở mỗi thành phần dịch được**: **title**, **body**, và **mỗi comment** đều có nút "Dịch" nhỏ (icon `Languages`).
- Bấm → gọi `gh.translate` cho **đúng đoạn đó** (provider/model/account resolve từ `project.llmDefaults`, fallback default app — giống Sessions). Hiện spinner trên đoạn đó.
- Có kết quả → đoạn chuyển sang bản dịch, nút đổi thành "Xem bản gốc" (toggle tại chỗ). Kết quả **cache theo đoạn** trong phiên xem → toggle tức thì.
- Tùy chọn: nút "Dịch tất cả" ở header drawer (dịch song song các đoạn chưa dịch).
- targetLang mặc định theo locale UI (vi → `Vietnamese`).

## Kiến trúc / Data flow

```
ProjectGhTab(kind) ──gh.list──▶ sidecar gh.list  ─▶ gh issue/pr list --json (cwd=project.path)
  ProjectGhList (full-width + filter)
  ProjectGhDrawer (resize) ─gh.get─▶ gh.get  ─▶ gh issue/pr view N --json (+comments)
                           ─gh.reviews─▶ gh api pulls/N/reviews + /comments (lazy, PR)
    TranslatableMarkdown ×N ─gh.translate─▶ gh.translate ─▶ completePi() (Pi SDK)
```

### RPC (sidecar) — dùng chung, phân biệt `kind`

| Method | Params | Trả về |
|---|---|---|
| `gh.accounts` | `{}` | `{ accounts: GhAccount[] }` (login + active; KHÔNG token) |
| `gh.list` | `{ projectId, kind: 'issue'\|'pr', state, assignee?, reviewer?, account?, limit?<=200 }` | `{ items: GhThreadSummary[] }` |
| `gh.get` | `{ projectId, kind, number, account?, withReviews?: boolean }` | `GhThread` (kèm `comments: GhThreadComment[]`) |
| `gh.reviews` | `{ projectId, number, account?, repoPath? }` | `{ reviews: GhReview[] }` (PR-only, best-effort → `[]`) |
| `gh.translate` | `{ text, targetLang?, provider, modelId, accountId? }` | `{ text }` |

- `state` validate theo `kind`: issue ∈ {open,closed,all}; pr ∈ {open,closed,merged,all}.
- `assignee` (tùy chọn): `@me` hoặc GitHub login (regex `^[A-Za-z\d](?:-?[A-Za-z\d]){0,38}$`); bỏ qua khi "Anyone". `assignees` có trong `--json` list để dựng dropdown + hiển thị dòng.
- `reviewer` (tùy chọn, **chỉ `kind='pr'`**): `@me` hoặc GitHub login (cùng regex với `assignee`); sidecar reject khi `kind='issue'` hoặc login sai định dạng. Map sang `--search "review-requested:<login>"`; `reviewRequests` + `latestReviews` có trong `--json` list để dựng chip reviewer trên dòng (dropdown chỉ lấy login đang `PENDING` — vì filter khớp theo review-requested).
- `account` (tùy chọn): GitHub login đã chọn ở app-level. Sidecar resolve: = active hoặc rỗng → gh active account; khác → inject `GH_TOKEN` từ `gh auth token --user <login>`. Validate login regex + phải thuộc `gh.accounts`. Token không bao giờ trả UI/log.
- `runGh(args, cwd)` helper mới ở `sidecar/src/github/runner.ts` (xem [ADR 0049](../decisions/0049-github-issues-and-prs-via-gh-cli.md)).
- `cwd` = `project.path` (sidecar tự nạp theo `projectId`; UI không truyền path).
- gh stdout (`--json`) parse + **Zod validate** trước khi trả.

### Types (UI — `types/index.ts`)

```ts
interface GhAccount { login: string; active: boolean; scopes: string }
type GhThreadKind = 'issue' | 'pr'
type GhThreadState = 'OPEN' | 'CLOSED' | 'MERGED'
type GhReviewerState = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'
interface GhThreadLabel { name: string; color: string }
interface GhThreadComment { author: { login: string }; body: string; createdAt: string }
interface GhThreadSummary {
  kind: GhThreadKind
  number: number; title: string; state: GhThreadState
  author: { login: string }; assignees: { login: string }[]; labels: GhThreadLabel[]
  createdAt: string; updatedAt: string
  // PR-only:
  isDraft?: boolean; baseRefName?: string; headRefName?: string
  // pending request + review đã submit, merge theo login (user, bỏ team)
  reviewers?: { login: string; state: GhReviewerState }[]
}
interface GhThread extends GhThreadSummary {
  body: string; url: string
  comments: GhThreadComment[]
}
```

### UI components

| File | Vai trò |
|---|---|
| `components/project/ProjectGhTab.vue` | Container theo `kind`: account picker + list full-width + drawer; dùng `useProjectGh(projectId, kind)` |
| `components/project/ProjectGhList.vue` | Danh sách + filter state (enum theo kind) + filter assignee + search |
| `components/project/ProjectGhListSkeleton.vue` | Skeleton shimmer của danh sách cho lần fetch đầu (bản implement: list là `ProjectIssues.vue`, container là `ProjectGh.vue`) |
| `components/project/ProjectGhAccountPicker.vue` | Dropdown chọn GitHub account (app-level), nạp từ `gh.accounts` |
| `components/project/ProjectGhDrawer.vue` | Drawer resize được, chứa detail + comments (render khác biệt nhỏ cho PR) |
| `components/project/TranslatableMarkdown.vue` | Khối markdown + nút Dịch/Xem gốc + cache + spinner (dùng cho title/body/comment) |
| `composables/useProjectGh.ts` | State controller theo kind: list/loading/state-filter/selected/translate-cache |

- Page [pages/projects/index.vue](../../apps/desktop/ui/pages/projects/index.vue) chỉ thêm thanh tab + `activeProjectTab`; logic dồn vào `useProjectGh` (template mỏng). Tab Issues = `ProjectGhTab kind="issue"`, tab PR = `ProjectGhTab kind="pr"`.

## Trạng thái lỗi / empty

| Tình huống | Code | UI |
|---|---|---|
| Chưa cài gh | `GH_NOT_FOUND` | "Cần cài GitHub CLI (gh)" + link cli.github.com |
| Chưa đăng nhập | `GH_NOT_AUTH` | "Chạy `gh auth login` để xem Issues/PR" |
| Repo không có remote GitHub | `GH_NO_REPO` | "Project này không liên kết repo GitHub" |
| Repo không có issue/PR | — | "Chưa có issue nào" / "Chưa có PR nào" |
| Dịch lỗi | — | Toast/inline lỗi, giữ nguyên bản gốc |

## Bảo mật (invariant)

- **Token không rời sidecar**: chỉ trả JSON đã parse; stderr strip token trước khi lên UI. Token từ `gh auth token --user` chỉ vào `GH_TOKEN` của child process, **không log/không trả UI/không vào trace**. `gh.accounts` không bao giờ kèm token (không dùng `--show-token`).
- **No command injection**: chỉ `projectId` (server-side load) + `number` (int) + enum (kind/state) + `assignee`/`reviewer`/`account` (validate `@me`/login regex — `reviewer` validate TRƯỚC khi ghép vào chuỗi `--search`) vào args; gh chạy arg-array, no shell. **Không `gh auth switch`** (mutate global state).
- **Scope = workspace**: cwd = `project.path`, UI không truyền cwd.
- **Validate biên**: gh JSON qua Zod; markdown render qua renderer AST, không inject HTML.

## i18n

Thêm nhóm `project.github.*` ở `en.json` + `vi.json`: tab label (Issues/Pull Requests), account picker (label, "Active"), filter (open/closed/merged/all + assignee: Anyone/Assigned to me), search placeholder, empty/error state, nút "Dịch"/"Xem bản gốc"/"Dịch tất cả", "Translating…", comment label, Draft, "Open on GitHub".

## Lưu trữ

- Account GitHub đã chọn lưu **app-level** trong settings store (persist `settings.json`, ngoài project). Default = active account của `gh`.

## Out of Scope (v1)

- Write actions: comment, close/reopen, merge, gán label/assignee.
- PR nâng cao: reviews, inline review comments, trạng thái CI/checks, mergeable, diff/files.
- Project nhiều repo (root không phải repo) → follow-up dùng `git.discoverRepos`.
- Phân trang vô hạn (v1: `--limit` cố định, mặc định 50, tối đa 200).
- Cache list xuyên phiên / live-update khi GitHub đổi.

## Acceptance Criteria

- **AC1 — Hiện tab có điều kiện:** Project có remote GitHub → hiện cả tab "Issues" lẫn "Pull Requests". Project không phải GitHub → không có hai tab này.
- **AC2 — Filter state (cả hai):** Mở mỗi tab → danh sách (mặc định Open). Issues filter Open/Closed/All; PR filter Open/Closed/Merged/All; đổi filter → list cập nhật. Rỗng → empty state đúng loại.
- **AC2b — Filter assignee (cả hai):** Mỗi tab có dropdown assignee: Anyone (mặc định) / Assigned to me (`@me`) / từng assignee trong danh sách. Chọn một assignee → list chỉ còn mục được gán cho người đó (re-fetch qua `gh --assignee`). Chọn "@me" → chỉ mục gán cho user hiện tại. Giá trị assignee không hợp lệ bị reject ở sidecar.
- **AC2c — Filter reviewer (chỉ PR):** Tab Pull Requests có thêm dropdown reviewer: Any reviewer (mặc định) / `@me` / từng requested reviewer trong danh sách. Chọn một reviewer → list chỉ còn PR đang chờ người đó review (re-fetch qua `--search "review-requested:<login>"`). Tab Issues KHÔNG hiển thị dropdown này; `reviewer` gửi kèm `kind='issue'` bị reject ở sidecar.
- **AC3 — Phân biệt PR:** Dòng PR hiển thị state Merged (màu riêng), cờ Draft khi `isDraft`, và `base ← head` branch.
- **AC4 — Chi tiết + comment:** Click 1 mục → drawer mở hiện body + toàn bộ comment (markdown). Drawer **kéo resize được** và đóng được. Giữ nguyên code block, link.
- **AC5 — Mặc định bản gốc:** Khi mở chi tiết, mọi thành phần hiển thị bản gốc; không tự gọi LLM.
- **AC6 — Dịch theo thành phần:** Bấm "Dịch" ở title → chỉ title được dịch tại chỗ, nút đổi "Xem bản gốc"; tương tự body và từng comment, độc lập. Toggle qua lại tức thì (đã cache).
- **AC7 — Dịch giữ định dạng:** Bản dịch giữ markdown, code fence, link, `@mention`, `#ref`, `\`identifier\`` — chỉ dịch prose.
- **AC8 — gh chưa sẵn sàng:** Chưa cài/chưa login/không phải repo GitHub → empty state hướng dẫn đúng, không crash.
- **AC9 — Đa account:** `gh` có ≥2 account → account picker liệt kê đủ, đánh dấu active, mặc định chọn active. Đổi account → list re-fetch theo account đó. Lựa chọn persist sau reload app (app-level). Account không có quyền repo → lỗi rõ ràng, không crash. Chạy gh như account đã chọn **không làm đổi active account** của `gh` ngoài AWOG.
- **AC10 — Bảo mật:** Token GitHub (kể cả token lấy qua `gh auth token`) không xuất hiện trong payload IPC/UI/log/trace; không path/cwd nào từ UI đi vào lệnh gh; `account`/`assignee`/`reviewer` không hợp lệ bị reject ở sidecar.
