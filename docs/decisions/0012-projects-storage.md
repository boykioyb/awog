# 0012 — Lưu trữ Projects bằng plain JSON per-file

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-27
- **Người quyết định:** Tech Lead

## Bối cảnh

[Feature projects](../features/projects.md) cần persist metadata project (path, gitRemote, gitBranch, language…) xuống đĩa để sống sót qua restart sidecar/UI. Spec gốc đề xuất `workspace/projects/<project-id>.json`.

Hiện tại sidecar đã có **hai pattern persistence**:

- **Credentials store** (`auth/state-store.ts`, `credentials/store.ts`) — **plain JSON 1 file**, đọc/ghi đè toàn bộ.
- **Sessions store** (`sessions/store.ts`) — **JSONL event-sourced per session**, append-only event log, snapshot dựng bằng fold.

Câu hỏi: project nên đi theo pattern nào?

Đặc tính dữ liệu project:
- Số lượng ít (vài chục → vài trăm dự kiến).
- Metadata nhỏ (< 1 KB / project).
- Mutate hiếm: tạo 1 lần, sửa description/branch thỉnh thoảng, xóa.
- Không cần audit lịch sử thay đổi (khác với session messages).
- Không có concurrent writer (một người dùng, một sidecar instance).

## Quyết định

Dùng **plain JSON 1 file per project**: `~/.awog/projects/<project-id>.json`. Mỗi file là snapshot toàn phần của một `Project`. Update = ghi đè atomic (write to `.tmp` rồi rename). Delete = unlink file.

Folder convention:
- Mode `0700` cho directory, `0600` cho file (giống `sessions/`).
- Filename qua `sanitizeChild(id)` để chặn traversal.
- ID format: `prj-<timestamp>-<rand>` (giống convention sessions).

Validate bằng zod ở RPC boundary trước khi ghi.

## Phương án đã cân nhắc

- **JSONL event-sourced** (giống sessions) — overkill cho dữ liệu metadata ít mutate, không cần audit. Thêm phức tạp fold/replay mà không lấy được lợi ích (sessions cần vì messages append liên tục).
- **1 file tổng `projects.json`** — đơn giản hơn nhưng concurrent write nguy hiểm khi có nhiều UI window, và mỗi save lại phải đọc-merge-ghi toàn bộ. Per-file scale linear theo số project.
- **SQLite** — không phù hợp invariant local-first filesystem-as-data và `data-model.md` (không database trong MVP).

## Hệ quả

- **Tích cực:**
  - Đồng nhất với spec gốc (`<id>.json`).
  - Đơn giản, dễ debug — user có thể mở file JSON xem trực tiếp.
  - Xóa = unlink, không cần tombstone.
  - Atomic write (`.tmp` + rename) chống corrupt khi crash.
- **Tiêu cực:**
  - Không có lịch sử thay đổi (acceptable — Git tracking cho codebase đã đủ).
  - Khi đổi schema, phải migrate file-by-file (chấp nhận vì project ít).
- **Việc cần làm tiếp:**
  - Implement `projects/store.ts` với atomic write helper.
  - Reuse helper này cho task store sau (M5+) nếu cần.
  - Câu hỏi mở của spec (detect move/rename folder) → để phase sau, không block ADR này.

## Tham chiếu

- [docs/features/projects.md](../features/projects.md)
- [ADR 0001 — local-first storage](./0001-local-first-storage.md)
- [ADR 0004 — artifacts as source of truth](./0004-artifacts-as-source-of-truth.md)
- [apps/desktop/sidecar/src/sessions/store.ts](../../apps/desktop/sidecar/src/sessions/store.ts) — pattern JSONL đã từ chối
- [apps/desktop/sidecar/src/credentials/store.ts](../../apps/desktop/sidecar/src/credentials/store.ts) — pattern plain JSON đã chọn
