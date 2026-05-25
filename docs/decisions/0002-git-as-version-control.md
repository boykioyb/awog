# 0002 — Dùng Git cho artifact versioning

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-23

## Bối cảnh

Artifact là source of truth cho cộng tác giữa các agent. Người dùng phải xem được history, diff giữa các phiên bản và roll back. Cần một cơ chế versioning tin cậy, quen thuộc và chi phí tích hợp bằng 0.

## Quyết định

Dùng **Git** làm lớp versioning cho toàn bộ workspace. AWOG chạy `git init` lần đầu và tự động commit khi artifact thay đổi.

## Phương án đã cân nhắc

- **Tự làm versioning file** (ví dụ `file.v1.md`, `file.v2.md`) — Tái phát minh Git một cách kém; không có merge, không có blame.
- **Bảng history trong database** — Đưa database trở lại (đã từ chối ở [0001](./0001-local-first-storage.md)).
- **Không versioning** — Mất quá nhiều giá trị; review artifact trung gian là UX cốt lõi.

## Hệ quả

- **Tích cực:**
  - Diff, blame, branch và push remote miễn phí.
  - Người dùng có thể dùng tool Git ngoài (GitHub, GitLab, GitX) trên workspace của họ.
  - Mô hình quen thuộc.
- **Tiêu cực / Trade-off:**
  - Phụ thuộc hệ thống: Git phải được cài.
  - Auto-commit có thể nhiễu; có thể cần batching hoặc squash.
  - Artifact binary làm phình repo — tạm thời không khuyến khích.
- **Việc cần làm tiếp:**
  - Quyết định độ mịn của auto-commit (per ghi vs per workflow step).
  - Cung cấp lệnh "compact history" cho workspace dùng lâu.

## Tham chiếu

- [0001](./0001-local-first-storage.md)
- [../features/artifact-system.md](../features/artifact-system.md)
