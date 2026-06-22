# ADR 0049 — GitHub Issues & Pull Requests qua `gh` CLI (read-only) + dịch LLM

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-20
- **Người quyết định:** tech-lead
- **Liên quan:** [Feature: project-github](../features/project-github.md), [ADR 0017](0017-git-manager-ipc-contract.md) (git spawn invariant), [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md) (Pi SDK one-shot), [ADR 0042](0042-webfetch-tool-ssrf-guarded.md) (SSRF guard cho HTTP ngoài)

## Bối cảnh

Trang chi tiết Project cần hai tab GitHub read-only: **Issues** và **Pull Requests** ([feature](../features/project-github.md)). Mỗi tab: liệt kê (có **filter state**), xem chi tiết một mục kèm comment, và dịch nội dung sang tiếng Việt bằng LLM theo từng thành phần (title/body/comment). Phạm vi v1: **read-only**.

Ràng buộc:

- Repo của project đã có sẵn auth qua **`gh` CLI** trên máy người dùng (xác nhận: `gh` 2.89, đã `gh auth login`, scope `repo`).
- Issue và PR trong GitHub gần như **cùng shape** với các field cần dùng (`number, title, state, author, labels, body, comments, createdAt, updatedAt, url`). PR thêm: `state` có thể `MERGED`, `isDraft`, `baseRefName`/`headRefName`. → cùng ý nghĩa "một thread GitHub đọc + dịch được", không phải trùng lặp ngẫu nhiên ⇒ hợp lệ để chia sẻ code.
- Invariant AWOG: **token không rời sidecar** (#1), **không SSRF** (#7), **git scope = workspace** (#3), không thêm dependency lớn khi chưa có ADR.
- Sidecar đã có pattern spawn process ngoài an toàn (`git/runner.ts`).

Câu hỏi kiến trúc: lấy dữ liệu Issues/PR **bằng cách nào** — REST API trực tiếp, MCP GitHub server, hay `gh` CLI? Và mô hình hoá Issue vs PR ra sao?

## Quyết định

**Spawn `gh` CLI (read-only)** để lấy cả Issues lẫn PR, mô phỏng đúng pattern `git/runner.ts`; **tham số hoá theo `kind: 'issue' | 'pr'`** trên một bộ method/component dùng chung; dịch bằng **một one-shot `completePi()`** (Pi SDK).

1. **Helper mới `sidecar/src/github/runner.ts`** — `runGh(args, cwd)`:
   - `execFile('gh', args)` — **không shell**, arg array; `windowsHide`, `maxBuffer` 16 MiB, `timeout` 30s.
   - **env whitelist**: `PATH, HOME, GH_TOKEN, GITHUB_TOKEN, XDG_CONFIG_HOME, LANG, LC_ALL, USERPROFILE, SystemRoot`.
   - `cwd` **luôn = `project.path`** do sidecar tự nạp theo `projectId` (UI **không** truyền path/cwd) → gh tự resolve repo từ git remote, giữ invariant "scope = workspace".
   - Map lỗi → code chuỗi ổn định: `GH_NOT_FOUND` (ENOENT), `GH_NOT_AUTH` (chưa login), `GH_NO_REPO` (không có remote GitHub); còn lại RpcError với stderr **đã strip token** (`gho_/ghp_/ghs_/github_pat_`).

2. **4 RPC method dùng chung** (đăng ký side-effect import như mọi method), discriminate bằng `kind`:
   - `gh.accounts {}` → `gh auth status --json hosts`, parse → danh sách `{ login, active, scopes, state }` cho `github.com` (KHÔNG kèm token; không dùng `-t/--show-token`).
   - `gh.list { projectId, kind, state, assignee?, account?, limit }`
     - `kind='issue'` → `gh issue list --state <s> [--assignee <a>] --limit <n> --json number,title,state,author,assignees,labels,createdAt,updatedAt`
     - `kind='pr'` → `gh pr list --state <s> [--assignee <a>] --limit <n> --json number,title,state,isDraft,author,assignees,labels,baseRefName,headRefName,createdAt,updatedAt`
   - `gh.get { projectId, kind, number, account? }`
     - `gh issue view <n> --json …,body,comments` / `gh pr view <n> --json …,body,comments` — **gộp comment** vào cùng response (không tạo method comments riêng).
   - `gh.translate { text, targetLang?, provider, modelId, accountId? }` — one-shot `completePi()`, dịch một đoạn markdown bất kỳ (kind-agnostic), giữ nguyên code/link/@mention. Dịch độc lập theo từng đoạn.

3. **Filter** (đều áp dụng cho cả Issues lẫn PR):
   - **State** (Zod refine theo kind): issue `open|closed|all`; pr `open|closed|merged|all`.
   - **Assignee** — server-side qua `--assignee <a>`. Giá trị: `@me` hoặc một GitHub login. **Validate biên**: chỉ chấp nhận `@me` hoặc regex login `^[A-Za-z\d](?:-?[A-Za-z\d]){0,38}$`; bỏ qua khi "Anyone" (không truyền cờ). `assignees` được thêm vào `--json` của list để UI dựng option dropdown + hiển thị trên mỗi dòng.

4. **Đa account — định danh ở cấp app, KHÔNG suy ra từ project.** `gh` trên máy có thể có nhiều account; lệnh gh mặc định chỉ dùng *active account*. AWOG để người dùng chọn account (login) ở **cấp app** (UI settings), default = active account; UI truyền `account?` vào `gh.list`/`gh.get` (giống cách `enhancePrompt` truyền provider/model/account). Resolution trong sidecar:
   - `account` rỗng **hoặc** = active account → chạy gh bình thường (active keyring account).
   - `account` là login khác active → lấy token account đó bằng `gh auth token --user <login> --hostname github.com`, **inject `GH_TOKEN` vào env tiến trình con** rồi chạy lệnh. **KHÔNG dùng `gh auth switch`** (mutate active account global → ảnh hưởng terminal của user, side-effect ngoài workspace → cấm).
   - Validate `account` = regex login (`^[A-Za-z\d](?:-?[A-Za-z\d]){0,38}$`) và phải nằm trong danh sách `gh.accounts`.

5. **Validate biên**: stdout gh là dữ liệu ngoài (L1) → `JSON.parse` + **Zod schema** trước khi trả UI.

6. **Token không vào AWOG/UI**: gh tự quản token trong keyring; sidecar chỉ trả JSON đã parse. Riêng token lấy từ `gh auth token --user` được coi là **secret chỉ sống trong tiến trình sidecar** — đưa thẳng vào `GH_TOKEN` của child, **không log, không trả UI, không vào event/trace**; stderr luôn strip token (#1).

## Phương án đã cân nhắc

- **Tách method riêng `issues.*` + `pr.*`** thay vì `kind`. *Từ chối:* hai bộ method/parser/component gần như sao chép — đúng kiểu trùng lặp DRY nên gộp; `kind` giữ một nguồn logic, dễ bảo trì. (Shape + ý nghĩa thực sự giống nhau, không phải trùng ngẫu nhiên.)
- **Option A — GitHub REST API trực tiếp** (octokit/`fetch`). *Từ chối:* phải tự quản PAT/OAuth (keychain, refresh, UI nhập token), thêm SSRF allowlist + dependency, trùng auth `gh` đã có. Quá nặng cho read-only.
- **Option B — MCP GitHub server**. *Từ chối:* cần cấu hình thêm connection; đây là tính năng đọc tập trung, không cần lớp MCP động.
- **Option C — Chỉ dùng `git`**. *Loại:* git không có khái niệm issue/PR/comment.
- **Bundle `gh` kèm app**. *Từ chối v1:* tăng kích thước + auth riêng; tận dụng `gh` sẵn có là đủ.

## Hệ quả

**Tích cực**
- **Zero secret mới**: tái dùng auth `gh`; đúng invariant #1, né hẳn bề mặt SSRF (#7).
- Một bộ code phục vụ cả Issue lẫn PR (KISS + DRY hợp lý) — thêm PR gần như miễn phí.
- Nhất quán spawn pattern git; read-only nên bề mặt rủi ro hẹp, không command injection (chỉ `projectId` server-side + `number` int + enum vào args).

**Tiêu cực / Trade-off**
- **Hard dependency runtime vào `gh`**: chưa cài / chưa login / repo không phải GitHub → phải hiện empty-state hướng dẫn (`GH_NOT_FOUND`/`GH_NOT_AUTH`/`GH_NO_REPO`), không crash.
- Token nằm trong keyring `gh` (ngoài lớp `credentials/keychain.ts`) — chấp nhận vì AWOG không đọc.
- PR có khái niệm review/inline-comment/CI-check phong phú hơn → v1 chỉ lấy conversation comment (như issue), phần còn lại để follow-up.
- Project nhiều repo (root không phải repo) chưa hỗ trợ v1.

**Việc cần làm tiếp**
- Account: hiện chọn **global (app-level)**. Per-project override (work account vs personal account theo repo) → follow-up; nếu account global không có quyền truy cập repo → gh trả lỗi, UI surface để user đổi account.
- Multi-repo: repo picker dùng `git.discoverRepos`.
- PR nâng cao: reviews, inline review comments, trạng thái CI/checks, mergeable.
- Write actions (comment/close/merge/label) — **out of scope** v1, cần ADR riêng vì chạm mutation.
- Cân nhắc cache list theo project.

## Tham chiếu

- [Feature: project-github](../features/project-github.md)
- [ADR 0017](0017-git-manager-ipc-contract.md), [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md), [ADR 0042](0042-webfetch-tool-ssrf-guarded.md)
- `gh` CLI: https://cli.github.com/manual/gh_issue , https://cli.github.com/manual/gh_pr
