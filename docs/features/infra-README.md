# Họ tính năng Infra — bản đồ đọc

Một ADR + các tài liệu dưới đây. Đọc theo thứ tự này khi onboard:

| # | Tài liệu | Trả lời câu hỏi | Ưu tiên |
|---|---|---|---|
| 0 | [ADR 0088](../decisions/0088-session-infra-context.md) | Luật chung: CLI shell-out, ngữ cảnh ghim phía sidecar, 3 cấp `read`/`write`/`forbidden` | nền |
| 1 | [session-infra-context.md](session-infra-context.md) | Chọn profile AWS / workspace Terraform / context kubectl **trong phiên**; tool cho agent; cổng duyệt | **P0 — phải xong trước** |
| 2 | [cloudwatch-logs.md](cloudwatch-logs.md) | Đọc log, lọc nâng cao (Insights), histogram, live tail, **lần theo một request** | **số 1** |
| 3 | [infra-explorer.md](infra-explorer.md) | Màn `/infra`: S3 · EC2 · CloudFront · API Gateway · Route53 · ACM · ECS/Fargate · EKS · Amplify · Lambda · CloudFormation · VPC · Kubernetes | cao |
| 4 | [infra-topology-graph.md](infra-topology-graph.md) | Domain → CloudFront → API → Lambda/ECS → DB dưới dạng **graph**, kèm lưu lượng/độ trễ | cao |
| 5 | [aws-website-playbook.md](aws-website-playbook.md) | Hai playbook **hướng dẫn** dựng sẵn (website tĩnh · website động) — nội dung chạy trên nền tảng ở dòng 10 | cao |
| 6 | [aws-profile-manager.md](aws-profile-manager.md) | **Quản lý tài khoản**: thêm · sửa · xoá · nhập · xuất profile AWS | cao |
| 7 | [infra-audit-log.md](infra-audit-log.md) | **Nhật ký hoạt động**: mọi thao tác được ghi, xem, lọc, dọn, và agent đọc được | **đi cùng P0** |
| 8 | [infra-cicd.md](infra-cicd.md) | **CI/CD**: GitHub Actions + CodePipeline + Amplify trong một bảng, xem log build, chạy lại, duyệt deploy | cao |
| 9 | [infra-monitoring-reports.md](infra-monitoring-reports.md) | **Giám sát & báo cáo**: biểu đồ số liệu, cảnh báo, bảng điều khiển, và 4 loại báo cáo lưu vào Wiki | cao |
| 10 | [playbooks.md](playbooks.md) | **Playbook**: trang riêng · kế hoạch triển khai trực quan · ảnh hưởng lan suy từ graph · quay lui · hồ sơ sau khi chạy | cao |
| 11 | [infra-bubble-session.md](infra-bubble-session.md) | **Bong bóng phiên**: phiên thu nhỏ ở góc phải · thư mục riêng `awog-infra` · "Mở full" về phiên · "Hỏi agent" chọn đích | mới 2026-09-14 |

## Trạng thái theo mốc

| Mốc | Nội dung | Trạng thái |
|---|---|---|
| 0 | Nền & lát cắt kiểm chứng | đã land (2026-09-13) |
| 1 | Tài khoản (A1–A6) | đã land (2026-09-13) — **nợ infosec audit #2** |
| 2 | Logs & Tổng quan (2.1–2.9) | đã land (2026-09-14) — 2/6 thẻ Tổng quan có nguồn, 4 thẻ chờ mốc 4/7 |
| 3 | Explorer: khung + bốn màn đầu (3.1–3.10) | đã land (2026-09-14) — trừ **SSM terminal** |
| 4 | Delivery/CI-CD: CloudFront-APIGW-Route53-ACM (4.1) + bảng CI/CD bốn nguồn (4.2–4.6) | đã land (2026-09-14) — thông báo **mặc định tắt**; chưa QA thật |
| 5 → 8 | Graph/Playbook · Giám sát/Báo cáo · Chi phí/An toàn/CloudTrail · Container/K8s | chưa |

Chi tiết + điểm lệch từng mốc: **[infra.tasks.md](infra.tasks.md)** §"trạng thái thực tế". **Toàn bộ mốc 1–4 chưa QA trong Electron thật** — các cổng đã xanh là `vitest` (sidecar) · `typecheck` · `lint`. Mốc 4 còn chưa chạy bằng **credential AWS thật** (CLI trên máy dev trả `ExpiredToken`) và chưa chạy bằng một `gh` đã đăng nhập.

## Luật thiết kế của cả họ: người không rành kỹ thuật cũng dùng được

Không phải làm một phiên bản rút gọn thứ hai. Cùng một màn, phục vụ hai loại người bằng sáu luật:

1. **Gọi tên theo thứ người ta nhận ra**, thuật ngữ đứng hàng hai. *"Máy chủ web-prod-1"* là dòng chính, `i-0a3f9c21 · t3.medium` là dòng phụ. *"Xoá bộ nhớ đệm CDN"* là nhãn nút, `CloudFront invalidation` là chú thích.
2. **Công tắc Đơn giản / Chuyên sâu**, nhớ theo người dùng. Đơn giản = ít cột hơn, nhãn tiếng người, ẩn ARN/JSON/cú pháp query; Chuyên sâu = đủ như hôm nay. Cùng dữ liệu, cùng màn — không phải hai sản phẩm.
3. **Hộp xác nhận nói hậu quả trước, lệnh sau.** *"Máy chủ này sẽ bị xoá vĩnh viễn. Website đang chạy trên nó sẽ ngừng."* rồi mới tới dòng `aws ec2 terminate-instances…` nằm trong mục *Chi tiết kỹ thuật* gập lại.
4. **Câu hỏi gợi ý thay cho ô trống.** Người không rành sẽ không gõ query Insights. Mỗi màn có sẵn chip câu hỏi — *"Website có đang hoạt động không?"*, *"1 giờ qua có lỗi gì?"*, *"Tháng này tốn bao nhiêu?"* — bấm là agent chạy hộ và trả lời bằng tiếng Việt.
5. **Chế độ Đơn giản thì an toàn mặc định chặt hơn.** Lớp phá huỷ = **Chặn** ở mọi account; muốn nới phải sang Chuyên sâu. Người không đọc được hậu quả kỹ thuật thì không nên cầm nút đỏ.
6. **Trạng thái rỗng và lỗi phải nói cách sửa.** *"Chưa kết nối tài khoản nào — Kết nối ngay"*, không phải *"no profiles found"*. Lỗi nói đã sai gì và bấm gì tiếp.

Hệ quả bố cục: `/infra` mở ra ở màn **Tổng quan** (đèn xanh/vàng/đỏ + một câu giải thích cho mỗi mục), không phải ở một bảng resource.

## Kế hoạch triển khai

Chi tiết theo mốc, task, phụ thuộc, nghiệm thu và rủi ro: **[infra.tasks.md](infra.tasks.md)** — 8 mốc, mỗi mốc tự nó dùng được.

## Thứ tự triển khai đề xuất

```
P0 nền (1) + N1 nhật ký (7)  →  A1–A3 Tài khoản (6)  →  Tổng quan + L1–L3 Logs (2)  →  E1+E3 khung + S3/EC2 (3)
                                                                    ↘  C1–C3 CI/CD qua gh (8)
                                        ↓
                     E4 CloudFront/APIGW/Route53/ACM (3)
                            ↓                    ↓
                  G1–G2 graph (4)        B1–B2 playbook (5)
                            ↓
        L5 lần theo request  ⟷  G4 tô sáng đường đi trên graph
```

**N1 phải ship cùng P0.** Nếu `infra.run` ra mắt mà chưa ghi nhật ký thì có một quãng chế độ tự động chạy mà không ai kiểm lại được — đúng thứ ma trận quyền hứa là kiểm được.

Ba thứ dùng chung một hạ tầng nên không được làm rời: `infra.run` (một cổng duy nhất ra CLI, một chỗ audit), registry `ResourceView` (thêm service = thêm một file mô tả), và hộp xác nhận ghi (hiện đúng dòng lệnh + account, gõ tên khi phá huỷ).

## Không thêm dependency nào

| Cần gì | Dùng cái đã có |
|---|---|
| Gọi AWS/k8s | `aws`/`kubectl`/`terraform` CLI trên máy (đã có đủ), arg array, không SDK |
| Graph | VueFlow (đang chạy Workflow Builder) + layout DAG tự viết ở [useWorkflowGen.ts:60](../../apps/desktop/ui-next/composables/useWorkflowGen.ts) |
| Editor query / template | Monaco (đã có) + Monarch tokenizer tự khai |
| Histogram | SVG vẽ tay (chỉ là cột) |
| Xem file S3 | `usePreview()` + `PreviewModal` đã có |
| Port-forward UI | khuôn [SshForwardPanel.vue](../../apps/desktop/ui-next/components/ssh/SshForwardPanel.vue) |
| Terminal / exec vào pod | node-pty ([ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)) |
| Che secret trước khi vào chat | [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) |
| Xuất sơ đồ | MermaidView (đã render sẵn) |
