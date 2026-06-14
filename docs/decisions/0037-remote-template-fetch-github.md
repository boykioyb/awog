# 0037 — Fetch Project Templates từ folder GitHub (public)

- **Trạng thái:** Accepted (2026-06-13)
- **Ngày:** 2026-06-13
- **Người quyết định:** Tech Lead (theo yêu cầu user)

## Bối cảnh

[ADR 0036](./0036-project-templates.md) cho phép **export** template từ project ra bundle local
`~/.awog/templates/<id>/`, nhưng chỉ tạo được tại máy — muốn dùng "bộ chuẩn" của người khác phải
copy thủ công. ADR 0036 đã chừa đường: *"bundle tự chứa để mở đường marketplace"* và liệt
**remote** vào out-of-scope MVP. ADR này hiện thực hoá bước đó ở mức **đơn giản nhất, an toàn**:
**fetch từ 1 link GitHub trỏ vào 1 folder trong repo** — folder đó là **registry chứa nhiều bundle**
(mỗi subfolder 1 `template.json`), đúng layout `~/.awog/templates/`. Đây là *tái dùng local từ repo*,
**không** phải marketplace tập trung.

Ví dụ: `https://github.com/<owner>/<repo>/tree/main/templates`.

## Quyết định

| # | Vấn đề | Quyết định | Rationale |
|---|--------|------------|-----------|
| **D-1** | Nguồn | **Chỉ GitHub public**, không token/private ở v1. Host allowlist cứng: `api.github.com` + `raw.githubusercontent.com`. | Đủ cho use-case "repo riêng làm registry"; tránh keychain + lộ token. |
| **D-2** | Manifest | **Bắt buộc `template.json`** mỗi bundle (đọc theo manifest, **không** scan/suy đoán entity kind). Validate bằng **zod**. | Nhất quán ADR 0036 D-2; tránh đoán sai; user đã chốt. |
| **D-3** | Folder = registry | URL trỏ folder chứa **nhiều** bundle con (sâu 1 cấp) → fetch phát hiện & import từng cái. Vẫn hỗ trợ URL trỏ thẳng 1 bundle đơn. | Khớp layout `~/.awog/templates/`; 1 link kéo cả bộ. |
| **D-4** | Cơ chế tải | **Git Trees API recursive (1 call)** liệt kê cây repo → lọc blob dưới folder → tải raw từng file. `truncated` → lỗi. | 1 call lấy đủ cây (kể cả skill là thư mục); ít request. |
| **D-5** | Sau fetch | **Lưu thành template local** + (khi import đúng 1 bundle) **mở Install ngay**. Install tái dùng `templates.install` (ADR 0036). | "Cả hai" theo user; tái dùng lối install đã chín. |
| **D-6** | Conflict | Local id = `slugify(manifest.id ?? name)`. Param `overwrite` (default **false**): trùng id → **skip** (report); true → ghi đè. Trùng id trong cùng lần fetch → skip cái sau. | Tránh nhân bản khi re-fetch; cho phép "refresh" có chủ đích. |
| **D-7** | Giới hạn (L1 untrusted) | Mỗi file ≤ 1 MB; tổng ≤ 20 MB & ≤ 500 file; manifest ≤ 256 KB; timeout 20 s. Vượt → lỗi rõ (kiểm trước khi ghi). | Chặn repo độc/khổng lồ làm cạn đĩa/bộ nhớ. |
| **D-8** | Security | (#7 SSRF) `ssrfCheck()` + allowlist host + re-check host sau redirect. (#2 Path) mọi relPath qua `sanitizeChild` + `isInside` trước khi ghi. Hook import → **untrusted** (gate [ADR 0032](./0032-hook-execution-engine-ipc-contract.md) D-8, không đổi). Secret chỉ ref `${secret:KEY}` (không đổi). | Bảo toàn 8 invariant AWOG. |
| **D-9** | RPC + store | RPC `templates.fetchRemote({url, overwrite?})` → `{imported[], skipped[]}` ([methods/templates.fetch-remote.ts](../../apps/desktop/sidecar/src/methods/templates.fetch-remote.ts)). Logic ở [templates/remote.ts](../../apps/desktop/sidecar/src/templates/remote.ts); UI store `fetchRemote()`. | Tách bounded context; nhất quán pattern `register()`. |

## Phương án đã cân nhắc

- **Scan folder thô không manifest** (suy ra entity từ `agents/skills/...`) — bị từ chối (D-2): đoán sai, lệch tinh thần ADR 0036.
- **`git clone`/sparse** — bị từ chối (D-4): cần git + nặng; Trees API + raw đủ cho public, không phụ thuộc git.
- **Token/private repo** — defer (D-1): thêm keychain + UI + rủi ro lộ token, lợi ích thấp ở v1.
- **Mirror toàn bộ subtree** thay vì theo manifest — bị từ chối: kéo file thừa, khó kiểm soát; chỉ tải file mà manifest tham chiếu (skill = mọi blob dưới thư mục skill).

## Hệ quả

- **Tích cực:** 1 link kéo cả bộ template chuẩn từ repo; tái dùng `templates.install` nên logic gọn; mở đường share qua GitHub mà chưa cần hạ tầng marketplace.
- **Tiêu cực / Trade-off:** Phụ thuộc GitHub public + rate-limit unauthenticated (60 req/h/IP). `ssrfCheck` không resolve DNS (chấp nhận như MCP guard). Branch chứa `/` không hỗ trợ đầy đủ (ref = 1 segment). Discover bundle chỉ sâu 1 cấp.
- **Việc cần làm tiếp:** 1 pass agent `infosec` (network surface mới); cân nhắc token/private + zip `.awogtemplate` + versioning sau MVP.

## Tham chiếu

- Nền tảng: [ADR 0036](./0036-project-templates.md), [ADR 0035](./0035-consolidate-config-tiers-to-awog.md)
- Feature: [project-templates](../features/project-templates.md)
- Security: [`.claude/rules/security.md`](../../.claude/rules/security.md); SSRF guard tái dùng [mcp/http-client.ts](../../apps/desktop/sidecar/src/mcp/http-client.ts)
