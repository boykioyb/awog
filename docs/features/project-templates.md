# Feature: Project Templates

**Trạng thái:** v1 implemented (2026-06-12) + remote fetch (2026-06-13) + **danh mục duyệt được** (2026-09-07, gói #37) — contract: [ADR 0036](../decisions/0036-project-templates.md) + [ADR 0037](../decisions/0037-remote-template-fetch-github.md) (nền: [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md))

## Overview

Template là **gói config tái dùng** (agents + skills + hooks + rules + commands) — một "bộ chuẩn" theo loại dự án. User **export** từ một project đã set up, rồi **install 1 nút** vào project mới. Ngoài export tại chỗ còn hai đường lấy từ xa: dán URL GitHub thủ công ([ADR 0037](../decisions/0037-remote-template-fetch-github.md)) và **duyệt một danh mục do AWOG công bố** (gói #37, mục bên dưới).

## User Stories

- Là người dùng, tôi set up agents/skills/hooks/rules/commands cho 1 project rồi muốn lưu thành template để dự án sau dùng lại.
- Là người dùng tạo project mới, tôi muốn bấm "Install template" để có ngay bộ chuẩn, rồi tuỳ biến tiếp.
- Là người dùng, tôi muốn xem template có gì và sửa nhẹ (bật/tắt entity, đổi tên) trước khi cài.

## Functional Behavior

- **Tạo (`templates.create`):**
  - **Export-from-project:** chọn project → gom entity tier `project` (tuỳ chọn kèm `global`) → ghi bundle `~/.awog/templates/<id>/`.
  - **Sửa nhẹ** trong `/templates`: đổi name/description, bật/tắt từng entity trong bundle, thêm entity từ tier khác, xoá template.
  - *Không* soạn nội dung entity từ đầu (dùng trang Agents/Skills/… — [ADR 0036](../decisions/0036-project-templates.md) D-4).
- **List/Detail (`templates.list`/`templates.get`):** danh sách template + chi tiết (manifest + entity theo kind).
- **Install (`templates.install`):** chọn template + project đích + `conflictPolicy` → ghi vào tier `project` của đích qua `save*` (validate + atomic). Report `{ installed[], skipped[] }`.
  - Đường ghi: hooks/rules/commands → `{project}/.awog/{kind}/`; agents/skills → `{project}/.awog/agents|skills/`.
- **Conflict:** trùng id ở project đích → default **skip**, option **overwrite** ([ADR 0036](../decisions/0036-project-templates.md) D-6).
- **Delete (`templates.delete`):** xoá bundle `~/.awog/templates/<id>/`.
- **Fetch từ GitHub (`templates.fetchRemote`, [ADR 0037](../decisions/0037-remote-template-fetch-github.md)):** nhập 1 link folder GitHub **public** → tải bundle về `~/.awog/templates/`. Folder có thể là **1 bundle** hoặc **registry nhiều bundle con** (mỗi cái 1 `template.json`). Param `overwrite` (default false → trùng id thì skip). Import xong: lưu local **+** mở Install ngay (khi đúng 1 bundle). Report `{ imported[], skipped[] }`.
  - Ví dụ URL: `https://github.com/<owner>/<repo>/tree/main/templates`.
  - Bảo mật: chỉ host `api.github.com`/`raw.githubusercontent.com` (allowlist + SSRF guard); mọi path qua `sanitizeChild`/`isInside`; giới hạn file ≤ 1 MB, tổng ≤ 20 MB & ≤ 500 file; hook import vẫn untrusted.

### Danh mục duyệt được (gói #37, 2026-09-07)

Trước gói này, đường vào duy nhất của một template từ xa là **tự dán URL** — người dùng phải biết trước cái link. Nay có danh mục để duyệt, nhưng **cách cài không đổi**: vẫn đi qua đúng lớp `templates/remote.ts` (plan → tải → ghi staging → swap), nên mọi cap/guard của nó áp nguyên vẹn.

**Nguồn danh mục.** Không có registry chính thức cho template/plugin của AWOG (khác MCP — nó có `registry.modelcontextprotocol.io` do chính dự án MCP vận hành). Nên AWOG tự công bố một danh mục ở **một repo cố định**, đọc qua `raw.githubusercontent.com` với owner/repo/ref/path là **hằng số biên dịch**:

```
https://raw.githubusercontent.com/boykioyb/awog-templates/main/catalog.json
```

Đánh đổi, nói thẳng:

| | |
|---|---|
| ✔ | Bề mặt SSRF là **đúng một tên miền**, y hệt [`sources/registry.ts`](../../apps/desktop/sidecar/src/sources/registry.ts). Không setting nào, không payload UI nào đổi được nó. |
| ✔ | Công bố template mới = sửa một file trong repo đó, **không cần release app** — thứ mà catalog hằng-số-biên-dịch không làm được. |
| ✘ | Tập trung: chỉ AWOG thêm được entry. Đây là danh mục **được tuyển**, không phải marketplace mở. Ai muốn phát hành ngoài danh mục vẫn dùng "Lấy từ GitHub". |
| ✘ | Repo danh mục thành một điểm tin cậy. Vì vậy danh mục **không bao giờ** quyết định được thứ gì chạy: entry chỉ mang metadata + một URL `github.com`; nội dung thật đọc từ `template.json` của chính bundle. |
| ~ | Đã cân nhắc và bỏ: tìm repo theo topic qua `api.github.com/search` (phi tập trung) — nhưng không có tuyển chọn, rate limit 10 req/phút khi không đăng nhập, và repo của người lạ hiện ra như thể AWOG giới thiệu. |

`catalog.json`:

```json
{
  "version": 1,
  "templates": [
    {
      "id": "web-app-team",
      "name": "Web app team",
      "description": "BA + dev + QA + reviewer, coding rules",
      "author": "AWOG",
      "version": "1.2.0",
      "url": "https://github.com/owner/repo/tree/main/bundles/web-app-team",
      "kinds": ["agent", "rule"],
      "tags": ["web", "team"]
    }
  ]
}
```

`kinds`/`tags` là thứ **listing khai** — chỉ để lọc/gắn nhãn. Sự thật đọc từ bundle; lệch nhau thì màn hình đồng ý báo đỏ (`undisclosedKinds`).

**RPC** (không có gì được ghi ở hai method đầu):

| Method | Việc |
|---|---|
| `templates.marketplaceList` `{ query?, refresh? }` | Danh mục + `origin`/`stale`/`error`. Lọc cục bộ (danh mục là một file nhỏ, không có tìm kiếm phía máy chủ) nên **offline vẫn tìm được** trong cache. |
| `templates.marketplaceInspect` `{ id }` | Đọc `template.json` thật của bundle → danh sách entity đầy đủ, số file, dung lượng, `undisclosedKinds`, `token`. |
| `templates.marketplaceInstall` `{ id, token, overwrite? }` | Ghi bundle vào `~/.awog/templates/`. |

**Màn hình đồng ý là ràng buộc của engine, không phải của UI.** `marketplaceInstall` bắt buộc nhận `token` — băm SHA-256 của **kế hoạch** (danh sách entity + từng file + blob SHA-1 + URL bundle) mà `marketplaceInspect` vừa trả. Engine lập lại kế hoạch rồi so; lệch ⇒ **không ghi gì**, trả `status: 'changed'` kèm bản kiểm tra mới để hỏi lại. Hệ quả: (a) nguồn không tráo được nội dung trong lúc người dùng đang đọc, (b) một client gọi thẳng RPC cũng không bỏ qua được bước đồng ý — không có token thì không có đường ghi.

Người dùng phải thấy, đầy đủ, trước khi ghi: tên + phiên bản, **URL nguồn thật**, **mọi entity sẽ được ghi kèm đường dẫn file** (không cắt bớt), số file + dung lượng, cảnh báo riêng cho **hook** (script chạy được) và **rule** (đi thẳng vào system prompt), và banner đỏ khi bundle chứa loại mà listing không khai.

**Giảm cấp offline** (như bản MCP): mạng → cache có TTL 24h + banner "đang xem bản cũ" → danh sách rỗng **có giải thích** + gợi ý dùng "Lấy từ GitHub".

**Hook trong bundle tải về không tự được trust.** Cài từ danh mục chỉ ghi bundle vào **thư viện** `~/.awog/templates/` — không entity nào vào project, không hook nào chạy. Đưa vào project là bước riêng (`templates.install`) và nó ghi vào **tier project** (`{project}/.awog/hooks/`), nơi trust đọc từ `~/.awog/hook-trust/<sha256(projectPath)>.json` ([ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md) D-8 + đính chính 2026-09-07) — mặc định **chưa được duyệt**, dispatcher lọc `trusted !== false` nên nó không chạy. Ghim bằng test: [`templates/__tests__/install-hook-trust.test.ts`](../../apps/desktop/sidecar/src/templates/__tests__/install-hook-trust.test.ts).

> ⚠ **Nợ đã biết (ngoài phạm vi gói #37):** bản ghi trust của hook keyed theo **id**, không theo nội dung. Nếu người dùng đã duyệt `format-on-save` trong một project rồi cài (overwrite) một bundle mang hook **trùng id**, nội dung mới thừa hưởng trust cũ. Cách chữa nằm ở [`hooks/store.ts`](../../apps/desktop/sidecar/src/hooks/store.ts): lưu kèm băm nội dung hook trong bản ghi trust và thu hồi khi băm đổi.

## Data Model

Bundle `~/.awog/templates/<id>/`:

```
template.json
agents/<id>.md
skills/<id>/SKILL.md
hooks/<id>.json
rules/<id>.md
commands/<id>.md
```

`template.json`:

```json
{
  "id": "web-app-team",
  "name": "Web app team",
  "description": "BA + dev + QA + reviewer, coding rules, commit hook",
  "createdAt": "2026-06-12T00:00:00.000Z",
  "sourceProjectId": "proj_abc",
  "entities": [
    { "kind": "agent", "id": "business-analyst", "file": "agents/business-analyst.md" },
    { "kind": "rule", "id": "code-style", "file": "rules/code-style.md" }
  ]
}
```

`source`/`projectId` của entity **không** ghi vào bundle — suy ra khi install ([ADR 0036](../decisions/0036-project-templates.md) D-2).

RPC: `templates.{list,get,create,install,fetchRemote,checkUpdate,update,delete,marketplaceList,marketplaceInspect,marketplaceInstall}`. Store: [`stores/templates.ts`](../../apps/desktop/ui-next/stores/templates.ts).

## Security (theo [ADR 0036](../decisions/0036-project-templates.md) D-7 + [security.md](../../.claude/rules/security.md))

- Hook install → `trusted=false` (gate [ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md) D-8) — kể cả hook đến từ danh mục.
- Danh mục là **L1**: zod + cap byte/entry + timeout + `redirect: 'manual'`; URL của mỗi entry phải là `https://github.com`, entry vi phạm bị **loại ngay lúc map** (không hiện ra rồi mới hỏng lúc cài). Cache đọc lại cũng validate lại bằng schema.
- Host danh mục là hằng số biên dịch + ba lớp chặn (`ssrfCheck` → so hostname chính xác → `dns.lookup` kiểm **từng IP**, chặn DNS rebinding).
- Template **không** chứa giá trị secret — chỉ ref `${secret:KEY}`; install xong nhắc user nhập keychain.
- Mọi write qua `assertInsideWorkspace`/`sanitizeChild`.

## UI/UX Notes

- **Trang `/templates`** (NavRail): master-detail — list template + search + New (export) + Refresh; detail = manifest + entity theo kind, nút Install (chọn project đích + conflict) / Edit / Delete.
- **Duyệt danh mục** (`TemplateDiscoverDialog` + `TemplateConsentPanel`): nút "Duyệt danh mục" ở thanh trên → tìm/lọc → bấm một mục mở **màn hình đồng ý** (không cài gì) → Cài. Cài xong mở luôn Install để chọn project đích — đưa vào project là quyết định riêng, không phải hệ quả tự động.
- **Projects detail:** nút **Save as template** (export project đang chọn) + **Install template** (picker template → cài vào project này).
- Theme token qua `useTheme()`; i18n en/vi; tuân UI patterns ([nuxt-vue.md](../../.claude/rules/nuxt-vue.md)).

## Dependencies

- [ADR 0035](../decisions/0035-consolidate-config-tiers-to-awog.md) — **bắt buộc xong trước** (layout `.awog` đồng nhất).
- Store entity (`save*`) để install; `projects` store để chọn đích.

## Out of Scope (v1)

- **Marketplace MỞ (ai cũng phát hành được)** — gói #37 mới có danh mục **được tuyển** do AWOG công bố; chưa có đường cho bên thứ ba tự đăng ký entry, chưa có xếp hạng/đánh giá/lượt cài.
- **Fetch private repo / token** — chỉ public ở v1 ([ADR 0037](../decisions/0037-remote-template-fetch-github.md) D-1).
- **Kèm MCP/Connections** trong template ([ADR 0036](../decisions/0036-project-templates.md) D-3).
- **Export bundle ra file `.awogtemplate` (zip)** — defer.
- **Conflict merge/diff** — chỉ skip/overwrite.
- **Versioning template** — chưa.

## Open Questions

- Export có nên gồm cả global entity không, hay chỉ project? (v1: chọn được, default chỉ project.)
- Install có cho chọn subset entity của template, hay all-or-nothing? (v1 đề xuất: chọn được, mặc định all.)
