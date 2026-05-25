# 0004 — Artifact là cơ chế chính để các agent cộng tác

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-23

## Bối cảnh

Hệ thống multi-agent thường truyền context giữa các agent qua chat history chung hoặc message passing. Cả hai cách đều scale kém: chat history làm bẩn context window; message passing ad-hoc khiến review và replay khó khăn.

## Quyết định

Agent **không** giao tiếp trực tiếp. Mỗi workflow step đọc input từ artifact và ghi output vào artifact. Artifact là kênh cộng tác giữa agent *duy nhất* được hỗ trợ chính thức.

## Phương án đã cân nhắc

- **Chat history chung** — Tuyến tính, khó review, làm phình context, không có diff.
- **Message bus trong RAM** — Phù du, không auditable, không restart-safe.
- **Lai (chat + artifact)** — Khuyến khích bỏ qua mô hình artifact và phá vỡ khả năng review.

## Hệ quả

- **Tích cực:**
  - Mỗi lần handoff đều là một tài liệu có thể review, có version, đọc được bởi con người.
  - Workflow trở nên xác định và replay được chỉ từ artifact.
  - Approval gate cho con người có đối tượng cụ thể để review.
  - Restart-safe: state nằm trên đĩa.
- **Tiêu cực / Trade-off:**
  - Cần suy nghĩ kỹ hơn từ đầu để mô hình hóa output của agent thành artifact.
  - Một số tín hiệu nhẹ (ví dụ "skip bước này") vẫn cần cơ chế out-of-band — TBD.
- **Việc cần làm tiếp:**
  - Định nghĩa shape artifact chuẩn cho các bước phổ biến (requirement, architecture, review).

## Tham chiếu

- [../features/artifact-system.md](../features/artifact-system.md)
- [../requirements/product-overview.md](../requirements/product-overview.md)
