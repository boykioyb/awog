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
- **Search** theo title/number (lọc client trên danh sách đã fetch).
- Mỗi dòng:
  - **Issue**: `#number`, title, state badge (Open/Closed), labels, author, thời điểm cập nhật.
  - **PR**: `#number`, title, state badge (Open/Closed/**Merged**) + nhãn **Draft** nếu `isDraft`, `base ← head` branch, labels, author, thời điểm cập nhật.
- Empty/error state riêng (xem [Trạng thái lỗi](#trạng-thái-lỗi--empty)).

### Chi tiết (drawer resize được)

- Click một dòng → mở **drawer** dock bên phải, **kéo resize chiều ngang** (tái dùng pattern resize của Workspace/Git sidebar), có nút đóng. Danh sách phía sau giữ full-width.
- Drawer hiển thị:
  - **Header**: title + `#number` + state badge + author + labels + link "Open on GitHub" (mở `url` external). PR thêm `base ← head` + cờ Draft.
  - **Body** render markdown qua [MarkdownBodyView.vue](../../apps/desktop/ui/components/markdown/MarkdownBodyView.vue) (an toàn, không `v-html` thô).
  - **Danh sách comment**: mỗi comment = author + thời gian + body (markdown). Sort cũ → mới.

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
    TranslatableMarkdown ×N ─gh.translate─▶ gh.translate ─▶ completePi() (Pi SDK)
```

### RPC (sidecar) — dùng chung, phân biệt `kind`

| Method | Params | Trả về |
|---|---|---|
| `gh.accounts` | `{}` | `{ accounts: GhAccount[] }` (login + active; KHÔNG token) |
| `gh.list` | `{ projectId, kind: 'issue'\|'pr', state, assignee?, account?, limit?<=200 }` | `{ items: GhThreadSummary[] }` |
| `gh.get` | `{ projectId, kind, number, account? }` | `GhThread` (kèm `comments: GhThreadComment[]`) |
| `gh.translate` | `{ text, targetLang?, provider, modelId, accountId? }` | `{ text }` |

- `state` validate theo `kind`: issue ∈ {open,closed,all}; pr ∈ {open,closed,merged,all}.
- `assignee` (tùy chọn): `@me` hoặc GitHub login (regex `^[A-Za-z\d](?:-?[A-Za-z\d]){0,38}$`); bỏ qua khi "Anyone". `assignees` có trong `--json` list để dựng dropdown + hiển thị dòng.
- `account` (tùy chọn): GitHub login đã chọn ở app-level. Sidecar resolve: = active hoặc rỗng → gh active account; khác → inject `GH_TOKEN` từ `gh auth token --user <login>`. Validate login regex + phải thuộc `gh.accounts`. Token không bao giờ trả UI/log.
- `runGh(args, cwd)` helper mới ở `sidecar/src/github/runner.ts` (xem [ADR 0049](../decisions/0049-github-issues-and-prs-via-gh-cli.md)).
- `cwd` = `project.path` (sidecar tự nạp theo `projectId`; UI không truyền path).
- gh stdout (`--json`) parse + **Zod validate** trước khi trả.

### Types (UI — `types/index.ts`)

```ts
interface GhAccount { login: string; active: boolean; scopes: string }
type GhThreadKind = 'issue' | 'pr'
type GhThreadState = 'OPEN' | 'CLOSED' | 'MERGED'
interface GhThreadLabel { name: string; color: string }
interface GhThreadComment { author: { login: string }; body: string; createdAt: string }
interface GhThreadSummary {
  kind: GhThreadKind
  number: number; title: string; state: GhThreadState
  author: { login: string }; assignees: { login: string }[]; labels: GhThreadLabel[]
  createdAt: string; updatedAt: string
  // PR-only:
  isDraft?: boolean; baseRefName?: string; headRefName?: string
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
- **No command injection**: chỉ `projectId` (server-side load) + `number` (int) + enum (kind/state) + `assignee`/`account` (validate `@me`/login regex) vào args; gh chạy arg-array, no shell. **Không `gh auth switch`** (mutate global state).
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
- **AC3 — Phân biệt PR:** Dòng PR hiển thị state Merged (màu riêng), cờ Draft khi `isDraft`, và `base ← head` branch.
- **AC4 — Chi tiết + comment:** Click 1 mục → drawer mở hiện body + toàn bộ comment (markdown). Drawer **kéo resize được** và đóng được. Giữ nguyên code block, link.
- **AC5 — Mặc định bản gốc:** Khi mở chi tiết, mọi thành phần hiển thị bản gốc; không tự gọi LLM.
- **AC6 — Dịch theo thành phần:** Bấm "Dịch" ở title → chỉ title được dịch tại chỗ, nút đổi "Xem bản gốc"; tương tự body và từng comment, độc lập. Toggle qua lại tức thì (đã cache).
- **AC7 — Dịch giữ định dạng:** Bản dịch giữ markdown, code fence, link, `@mention`, `#ref`, `\`identifier\`` — chỉ dịch prose.
- **AC8 — gh chưa sẵn sàng:** Chưa cài/chưa login/không phải repo GitHub → empty state hướng dẫn đúng, không crash.
- **AC9 — Đa account:** `gh` có ≥2 account → account picker liệt kê đủ, đánh dấu active, mặc định chọn active. Đổi account → list re-fetch theo account đó. Lựa chọn persist sau reload app (app-level). Account không có quyền repo → lỗi rõ ràng, không crash. Chạy gh như account đã chọn **không làm đổi active account** của `gh` ngoài AWOG.
- **AC10 — Bảo mật:** Token GitHub (kể cả token lấy qua `gh auth token`) không xuất hiện trong payload IPC/UI/log/trace; không path/cwd nào từ UI đi vào lệnh gh; `account`/`assignee` không hợp lệ bị reject ở sidecar.
