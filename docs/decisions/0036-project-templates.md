# 0036 — Project Templates (bundle config tái dùng + install)

- **Trạng thái:** Accepted (2026-06-12)
- **Ngày:** 2026-06-12
- **Người quyết định:** Tech Lead (theo yêu cầu user)

## Bối cảnh

Mỗi dự án mới user phải define lại agents/skills/hooks/rules/commands. Cần **template**: gói một "bộ chuẩn" config rồi **cài 1 nút** vào project mới.

Mô hình 3 lớp (đã thống nhất với user):
- **Global tier** (`~/.awog/`) — config chung **mọi** project (đã có sẵn, không cần template).
- **Template** — "bộ chuẩn" theo **loại** dự án, user *chọn* cài (vd "Web app team" ≠ "Data pipeline team").
- **Project tier** — context riêng, tuỳ biến chồng lên sau khi cài.

Template đứng được nhờ [ADR 0035](./0035-consolidate-config-tiers-to-awog.md): mọi loại đã đồng nhất trong `.awog/` → template = copy thư mục `.awog/`. **Không** phải marketplace (out-of-scope MVP) — đây là tái dùng **local**, đúng tinh thần "reusable guild" của [VISION](../../artifacts/VISION.md).

## Quyết định

| # | Vấn đề | Quyết định | Rationale |
|---|--------|------------|-----------|
| **D-1** | Lưu trữ | Bundle tự chứa tại `~/.awog/templates/<id>/`: `template.json` (manifest) + copy file entity theo layout `.awog`: `agents/ skills/ hooks/ rules/ commands/`. | Portable (zip/commit sau này); tái dùng đúng layout `.awog` (ADR 0035) → install = copy. |
| **D-2** | Manifest | `template.json`: `id`, `name`, `description`, `createdAt`, `sourceProjectId?`, `entities: { kind, id, file }[]`. `source`/`projectId` của entity **không** ghi (suy ra khi install). | Manifest mô tả "có gì", file chứa nội dung. KISS. |
| **D-3** | Phạm vi bundle | **5 loại:** agents, skills, hooks, rules, commands. **Không** kèm MCP/Connections (global-only, dùng chung mọi project) — user chốt. | Đúng các loại có tier project mà user phải lặp lại. |
| **D-4** | Tạo template | **(a) Export-from-project** (chính): chọn project → gom entity tier `project` (+ tuỳ chọn `global`) thành template. **(b) Sửa nhẹ** trong trang `/templates`: đổi name/description, bật/tắt từng entity, thêm entity từ tier khác, xoá. **Không** làm editor soạn nội dung entity từ đầu (đã có trang Agents/Skills/… — YAGNI). | Export là cách nhanh nhất build "bộ chuẩn" từ setup thật. |
| **D-5** | Install | `templates.install({ templateId, targetProjectId, conflictPolicy })`. Ghi vào tier **project** của target: hooks/rules/commands → `{project}/.awog/{kind}/`, agents/skills → `{project}/.awog/agents\|skills/`. **Dùng lại `save*`** (saveAgent/saveSkill/…) để được validate + atomic write, **không** copy thô. | Tái dùng store đã chín; an toàn + path sanitize sẵn. |
| **D-6** | Conflict | `conflictPolicy: 'skip' \| 'overwrite'`, **default `skip`**. Trả về report `{ installed[], skipped[] }`. | Không âm thầm đè config sẵn có; minh bạch. |
| **D-7** | Security | Hook install → **`trusted=false`** (gate [ADR 0032](./0032-hook-execution-engine-ipc-contract.md) D-8). Template **không** chứa giá trị secret — chỉ giữ ref `${secret:KEY}`, install xong nhắc user nhập keychain. Mọi write qua `assertInsideWorkspace`/`sanitizeChild`. | Bảo toàn 8 invariant AWOG. |
| **D-8** | UI entry | **Cả hai** (user chốt): trang `/templates` (list/detail/create/install/delete) + nút **Save as template** / **Install template** trong Projects detail. | Quản lý tập trung + cài nhanh đúng ngữ cảnh. |
| **D-9** | Store + RPC | Pinia store mới [`stores/templates.ts`](../../apps/desktop/ui/stores/templates.ts) (bounded context riêng). RPC: `templates.{list,get,create,install,delete}` mirror pattern `methods/*.ts` + `register()`. | Tách bounded context; nhất quán RPC. |

## Phương án đã cân nhắc

- **Editor soạn template từ đầu** — bị từ chối (D-4): trùng chức năng trang entity, vi phạm YAGNI/SRP.
- **Kèm MCP/Connections** — bị từ chối (D-3): connections global-only đã dùng chung; thêm secret-handling phức tạp, lợi ích thấp.
- **Marketplace / template remote** — out-of-scope MVP ([mvp-scope](../requirements/mvp-scope.md)); bundle tự chứa để *mở đường* nhưng chưa làm distribution.
- **Install qua copy file thô** — bị từ chối (D-5): bỏ qua validate/atomic của store; dùng `save*` an toàn hơn.

## Hệ quả

- **Tích cực:** Bộ chuẩn config tái dùng 1 nút; nhờ ADR 0035 logic install rất gọn (copy `.awog` + `save*`). Bundle portable cho tương lai chia sẻ.
- **Tiêu cực / Trade-off:** Phụ thuộc ADR 0035 hoàn tất trước. Secret không theo template → user nhập lại (chấp nhận được). Conflict resolution v1 chỉ skip/overwrite (chưa merge/diff).
- **Việc cần làm tiếp:** spec [project-templates](../features/project-templates.md); implement sau Pha A (ADR 0035); infosec (copy + hook trust + secret); cân nhắc export/import template ra file `.awogtemplate` (zip) như bước mở đường marketplace sau MVP.

## Tham chiếu

- Nền tảng: [ADR 0035](./0035-consolidate-config-tiers-to-awog.md)
- Feature: [project-templates](../features/project-templates.md)
- VISION "reusable guild": [artifacts/VISION.md](../../artifacts/VISION.md); MVP exclude marketplace: [mvp-scope](../requirements/mvp-scope.md)
- Security: [`.claude/rules/security.md`](../../.claude/rules/security.md)
