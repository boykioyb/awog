# 0010 — Pause-on-quota để cho phép switch connection thủ công

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-25
- **Người quyết định:** Tech Lead

## Bối cảnh

Agent của AWOG gắn chặt vào đúng một provider connection (xem [stores/settings.ts](../../apps/desktop/ui/stores/settings.ts) — mỗi provider chỉ có một `apiKey`). Khi key đó hết quota giữa lúc task đang chạy, theo [execution-model.md](../architecture/execution-model.md) hiện tại task sẽ rơi vào `Failed`, người dùng phải rerun thủ công từ đầu node và mất toàn bộ tiến độ tool-call loop trong node đó.

Ràng buộc của AWOG:

- Local-first, không có scheduler tự retry phức tạp.
- DNA hiện tại đã có **approval gate** (`WaitingApproval`) và **node-level checkpoint** (state persist trước khi đổi status — [execution-model.md#L67-L72](../architecture/execution-model.md#L67-L72)).
- Invariant security #1: API key không rời sidecar — bất kỳ cơ chế switch nào cũng không được leak key qua UI/event/trace.
- MVP scope: không thêm entity mới phức tạp ([0001](./0001-local-first-storage.md), không có database).

## Quyết định

Khi node execution thất bại vì lỗi quota/rate-limit của provider, **engine pause task** vào trạng thái mới `WaitingConnection` (tương tự `WaitingApproval`) thay vì `Failed`. UI prompt người dùng cập nhật API key của provider tương ứng trong Settings rồi nhấn **Resume**; engine re-run node fail từ đầu với credential mới.

Chi tiết:

1. **Phát hiện lỗi quota** trong Model Adapter (sidecar): map các response 429, `insufficient_quota`, `rate_limit_exceeded` (Anthropic/OpenAI) thành một `QuotaExhaustedError` chuyên biệt — phân biệt với lỗi runtime khác.
2. **Pause thay vì fail**: khi node bắt `QuotaExhaustedError`, engine ghi event vào `events.log` (sanitized, không chứa key), persist task ở trạng thái `WaitingConnection { provider, lastNodeId }`, dừng worker.
3. **UI prompt**: badge trên task + modal hướng dẫn cập nhật key trong Settings, không hiển thị thông tin key cũ.
4. **Resume**: action `resumeTask(taskId)` re-queue task; node fail được chạy lại từ đầu (mất tool-call loop trong node, nhưng artifact của node trước được giữ — đúng với mô hình checkpoint hiện tại).
5. **Không auto-rotate**: giữ user-in-the-loop, phù hợp với DNA approval gate. Auto-failover (multi-key pool) thuộc về scope sau MVP.

## Phương án đã cân nhắc

- **Multi-key per provider + auto-rotate trong suốt** — Sidecar tự thử key kế tiếp khi gặp 429. Loại bỏ vì: (1) cần thêm UI quản lý list key, (2) các key cùng organization share quota → rotate vô nghĩa, (3) đi ngược tinh thần "approval gate" của AWOG, (4) phức tạp hơn mức cần cho MVP.
- **Entity `Connection` độc lập + connection pool có priority** — Cleaner SoC, mở đường cho team workspace. Loại bỏ ở MVP vì: phải sửa data model, workspace layout, và 3 store; effort gấp nhiều lần lợi ích trước-MVP. Để dành cho V2 — ADR mới có thể supersede ADR này khi đó.
- **Giữ nguyên `Failed` + rerun thủ công** — Status quo. Loại bỏ vì user phải rerun từ đầu workflow trong UX hiện tại, mất tiến độ các node trước đã hoàn tất artifact.

## Hệ quả

- **Tích cực:**
  - Tận dụng pattern `WaitingApproval` + node-level checkpoint sẵn có — implement nhỏ.
  - Không thêm entity, không phá data model — tương thích [0001](./0001-local-first-storage.md), [0004](./0004-artifacts-as-source-of-truth.md).
  - Giữ invariant security: key không bao giờ lên payload IPC ra UI; UI chỉ thấy "provider X cần key mới".
  - Người dùng quyết định switch key nào — phù hợp với local-first / user-controlled.
- **Tiêu cực / Trade-off:**
  - Không suitable cho automation chạy đêm không người trực — chấp nhận ở MVP.
  - Tool-call loop bên trong node fail bị mất; chỉ checkpoint ở biên node. (Có thể nâng cấp sau bằng intra-node checkpoint, không thuộc ADR này.)
  - Lỗi quota của provider khác nhau có thể trả mã không nhất quán — cần test fixture cho từng provider.
- **Việc cần làm tiếp:**
  - BA viết feature spec ở `docs/features/connection-quota-handling.md`.
  - Thêm task status `WaitingConnection` vào [types/index.ts](../../apps/desktop/ui/types/index.ts) và lifecycle diagram trong [execution-model.md](../architecture/execution-model.md).
  - Sidecar: định nghĩa `QuotaExhaustedError`, map response 429/insufficient_quota của Anthropic + OpenAI.
  - UI: badge + modal hướng dẫn cập nhật key + nút Resume trên task detail.
  - Workspace store: action `resumeTask(taskId)`.
  - Sanitize event log để không in raw error message từ provider (có thể chứa request ID nhạy cảm).

## Tham chiếu

- [0001](./0001-local-first-storage.md) — local-first storage
- [0004](./0004-artifacts-as-source-of-truth.md) — artifact-based collaboration
- [execution-model.md](../architecture/execution-model.md) — lifecycle task hiện tại
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #1 API key isolation
