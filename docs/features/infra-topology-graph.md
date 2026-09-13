# Feature — Graph kiến trúc & luồng request của một application / domain

- **Trạng thái:** Planned — chưa code
- **ADR:** [0088 — ngữ cảnh hạ tầng ghim theo phiên](../decisions/0088-session-infra-context.md)
- **Route:** `/infra` → **Topology**; mở được từ một domain, một CloudFront distribution, một API, hay một stack
- **Anh em:** [cloudwatch-logs.md](cloudwatch-logs.md) (bấm hop → mở log của hop đó), [infra-explorer.md](infra-explorer.md) (bấm node → mở resource)

## Mục tiêu

Trả lời trong **một** màn: *"gõ tên miền này vào trình duyệt thì request đi qua những đâu, và chỗ nào đang hỏng?"* — vẽ thành graph, không phải mở 6 tab console rồi tự ghép trong đầu.

Hai lớp chồng lên nhau trên **cùng một** graph:

| Lớp | Nguồn | Trả lời câu hỏi |
|---|---|---|
| **Cấu trúc** (tĩnh) | `describe-*` của Route53 · CloudFront · API Gateway · ALB · Lambda · ECS · S3 · RDS · VPC | *"Hệ thống nối với nhau thế nào?"* |
| **Lưu lượng** (động) | X-Ray service graph; không có X-Ray thì đếm từ CloudWatch | *"Đường nào đang chạy, chậm bao nhiêu, lỗi bao nhiêu?"* |

## Vẽ bằng gì

**VueFlow — đã là dependency** (`@vue-flow/core|background|controls|minimap`, đang chạy Workflow Builder), và repo **đã có sẵn layout DAG phân tầng tự viết** ở [useWorkflowGen.ts:60](../../apps/desktop/ui-next/composables/useWorkflowGen.ts) (x theo rank đường-dài-nhất, y theo thứ tự trong rank). Topology cũng là DAG phân tầng ⇒ **dùng lại**, **không thêm** dagre/elkjs.

Node type riêng mỗi service (icon + màu + 2 dòng nhãn), edge có nhãn (path pattern, stage, route key, port).

## Dựng graph từ đâu — đi ngược từ điểm vào

Người dùng cho một **điểm vào**, AWOG lần theo cấu hình:

```
Domain (Route53 hosted zone → record)
   └─ ALIAS → CloudFront distribution
        ├─ behavior "/"       → Origin: S3 bucket (OAC)          → [web tĩnh]
        └─ behavior "/api/*"  → Origin: API Gateway (stage prod)
                                   ├─ route POST /v1/orders → Lambda api-prod
                                   │     ├─ env: DB_HOST → RDS orders-db  (VPC, SG)
                                   │     └─ env: QUEUE   → SQS orders
                                   └─ route GET  /v1/health → Lambda health
```

Bộ **resolver** cho mỗi loại cạnh, mỗi cái là một lần gọi CLI qua `infra.run`:

| Từ | Tới | Lấy bằng |
|---|---|---|
| Hosted zone record | CloudFront / ALB / S3 website | `route53 list-resource-record-sets` → ALIAS target |
| CloudFront | origin + behavior | `cloudfront get-distribution-config` |
| API Gateway (v1/v2) | integration | `apigateway get-resources` / `apigatewayv2 get-routes|get-integrations` |
| ALB | target group → ECS service / EC2 | `elbv2 describe-rules|describe-target-groups|describe-target-health` |
| Lambda | downstream | biến môi trường + `list-event-source-mappings` (**chỉ tên/ARN, không giá trị secret**) |
| ECS service | task-def → image, secrets ref, SG/subnet | `ecs describe-services|describe-task-definition` |
| Bất kỳ | VPC/subnet/SG | `ec2 describe-*` khi resource có ENI |
| CloudFormation stack | mọi resource của stack | `cloudformation list-stack-resources` — đường vào nhanh nhất khi hạ tầng dựng bằng stack |

Suy luận cạnh từ **biến môi trường** là heuristic (khớp hostname RDS/endpoint SQS trong giá trị env) ⇒ cạnh đó vẽ **nét đứt** và ghi *"suy luận"*. Không bao giờ trộn lẫn với cạnh đọc được từ cấu hình thật.

**Dựng dần, không chờ trọn:** mỗi resolver xong là graph mọc thêm nhánh — account lớn thì không đứng nhìn spinner. Có nút *"mở rộng node này"* để không quét cả account khi chỉ cần một nhánh.

## Lớp lưu lượng

Bật công tắc **Lưu lượng** thì mỗi node/edge nhận số liệu của khoảng thời gian đang chọn:

- **Có X-Ray**: `xray get-service-graph` cho thẳng service map kèm `ResponseTimeHistogram`, `ErrorStatistics`, `FaultStatistics` ⇒ node hiện p50/p95 + %lỗi, edge dày theo lưu lượng, đỏ theo tỉ lệ fault. Đây là nguồn đúng nhất cho "luồng request".
- **Không X-Ray**: đếm từ CloudWatch (invocations/errors của Lambda, 5xx của API GW/ALB, `RequestCount` của CloudFront) ⇒ có sức khoẻ từng node nhưng **không có** độ trễ từng cạnh. UI ghi rõ nguồn nào đang dùng.

## Tương tác

| Thao tác | Kết quả |
|---|---|
| Bấm node | Mở chi tiết resource trong Explorer (cùng trang, pane phải) |
| Bấm edge | Hiện chính cấu hình tạo ra cạnh đó (behavior path, route key, target group, rule) |
| **Xem log** trên node | Mở [Logs](cloudwatch-logs.md) với log group của node đó đã chọn sẵn + khoảng thời gian đang xem |
| **Lần theo request** | Dán `requestId`/trace id → tô sáng đúng đường request đã đi, các node ngoài đường mờ đi |
| **Gửi vào chat** | Xuất graph dạng text có cấu trúc (node + edge + số liệu) vào composer để hỏi agent — *"chỗ nào là nút thắt"*, *"vì sao 502"* |
| Xuất | PNG, hoặc **Mermaid** (repo đã render Mermaid sẵn qua `MermaidView`) để dán vào Wiki/PR |

Nút *"lưu vào Wiki"* ghi graph dạng Mermaid + bảng resource thành một trang trong [Wiki](wiki.md) — thành tài liệu kiến trúc **tự sinh từ hạ tầng thật**, thay vì sơ đồ vẽ tay hết hạn từ năm ngoái.

## Giới hạn nói trước

- Graph phản ánh **cấu hình**, không phải ý định. Resource mồ côi (không ai trỏ tới) vẫn hiện, có nhãn *"không có đường vào"* — thường chính là cái đáng xoá.
- Cạnh suy luận từ env là **đoán** (nét đứt). Không có X-Ray thì không có độ trễ từng cạnh.
- Account nhiều nghìn resource: **luôn** bắt đầu từ một điểm vào (domain/distribution/API/stack), không có nút "vẽ cả account". Giới hạn độ sâu mặc định 4 hop, mở rộng thủ công.
- Cross-account / cross-region: chỉ vẽ trong ngữ cảnh đang ghim; cạnh ra ngoài vẽ thành node "external" có nhãn.

## Lộ trình

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **G1** | Khung graph (VueFlow + layout có sẵn) · node type theo service · điểm vào = CloudFront hoặc API Gateway · resolver CloudFront/APIGW/Lambda | L |
| **G2** | Điểm vào = **domain** (Route53 + ACM) · resolver ALB/ECS/S3 · cạnh suy luận từ env (nét đứt) | M |
| **G3** | Lớp lưu lượng: X-Ray service graph, fallback CloudWatch · tô sức khoẻ node/edge | L |
| **G4** | Nối hai chiều với Logs: node → log group; **lần theo request** tô sáng đường đi | M |
| **G5** | Xuất Mermaid/PNG · lưu vào Wiki · gửi vào chat | M |
| **G6** | Lớp VPC (subnet/SG/route) như một chế độ xem thứ hai của cùng graph | M |

Phụ thuộc: P0 của [session-infra-context.md](session-infra-context.md); các resolver dùng chung view của [infra-explorer.md](infra-explorer.md) (E3 giúp G1 nhanh hơn nhưng không chặn).

## Bảo mật

- Resolver chỉ gọi động từ **đọc** — graph không có nút ghi nào.
- Biến môi trường Lambda/ECS: **chỉ đọc khoá và ARN**, giá trị không vào graph, không vào cache, không vào chat (invariant 1). Secret ref chỉ hiện dưới dạng tên.
- Xuất graph (Mermaid/PNG/chat) đi qua [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) — endpoint và ARN thì giữ, chuỗi giống token thì che.

## Câu hỏi mở

1. **X-Ray có bật trên hệ thống của bạn không?** Có thì G3 ra "luồng request" đúng nghĩa (độ trễ từng hop); không thì G3 chỉ là sức khoẻ từng node — nên biết trước để xếp G3 sớm hay muộn.
2. **Điểm vào chính nên là gì** — domain, hay CloudFormation stack? Nếu hạ tầng dựng bằng stack/Terraform thì đi từ stack nhanh và chính xác hơn nhiều.
3. Có cần **so sánh hai môi trường** (dev vs prod) cạnh nhau để tìm khác biệt cấu hình không? Hữu ích nhưng là màn khác — hoãn.
