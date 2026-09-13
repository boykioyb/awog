# Feature — Playbook: dựng một website hoàn chỉnh trên AWS (hướng dẫn chạy được)

- **Trạng thái:** Planned — chưa code
- **ADR:** [0088 — ngữ cảnh hạ tầng ghim theo phiên](../decisions/0088-session-infra-context.md)
- **Route:** `/infra` → **Playbooks**
- **Anh em:** [infra-explorer.md](infra-explorer.md) · [infra-topology-graph.md](infra-topology-graph.md) (dựng xong thì bấm "Xem graph" để nhìn lại thứ mình vừa tạo) · [cloudwatch-logs.md](cloudwatch-logs.md)

## Mục tiêu

Một hướng dẫn **vừa đọc vừa chạy vừa kiểm tra được**: từ tên miền trắng tới website có HTTPS, CDN, API và log — mỗi bước nói rõ *làm gì · vì sao · lệnh nào · tốn bao nhiêu · kiểm tra thế nào*, và bấm chạy được ngay trong app với hộp xác nhận.

Khác một bài blog ở ba chỗ: **biết bước nào đã xong** (kiểm tra bằng lệnh đọc, không bằng trí nhớ), **chạy đúng account đang ghim** (ngữ cảnh ADR 0088), và **hỏi được agent ngay tại bước đang đứng**.

## Playbook là gì trên đĩa

Một file markdown + front-matter, 2 tier như mọi config AWOG: `~/.awog/playbooks/<id>.md` và `{project}/.awog/playbooks/<id>.md`. Playbook dựng sẵn đi kèm app ở tier "built-in" (chỉ đọc, người dùng **fork** ra tier của mình để sửa).

```yaml
---
id: static-site
title: Website tĩnh + CDN + HTTPS
requires: { tools: [aws], region: any }
inputs:
  - { key: domain,  label: "Tên miền",     example: "shop.example.com" }
  - { key: bucket,  label: "Tên bucket S3", default: "{{domain}}-site" }
steps:
  - id: hosted-zone
    title: Có hosted zone cho tên miền
    why: Route53 phải quản DNS thì mới trỏ ALIAS sang CloudFront và tự xác thực cert.
    check: [route53, list-hosted-zones-by-name, --dns-name, "{{domain}}"]   # đọc — đã có chưa
    do:    [route53, create-hosted-zone, --name, "{{domain}}", --caller-reference, "{{nonce}}"]
    verify:[route53, list-hosted-zones-by-name, --dns-name, "{{domain}}"]
    cost: "0.50 USD/tháng mỗi hosted zone"
    note: Nếu tên miền mua ở nơi khác, đổi nameserver sang 4 NS mà bước này in ra rồi đợi lan truyền.
---
```

Mỗi bước có tối đa bốn lệnh, và **ba trong số đó là lệnh đọc**:

| Trường | Loại | Vai trò |
|---|---|---|
| `check` | đọc | Bước này **đã xong chưa**? Chạy tự động khi mở playbook ⇒ vào giữa chừng vẫn đúng trạng thái |
| `do` | **ghi** | Hành động thật. Luôn qua hộp xác nhận hiện đúng dòng lệnh + account/region |
| `verify` | đọc | Sau khi chạy, **kiểm chứng** kết quả chứ không tin exit code |
| `rollback` | ghi | Gợi ý hoàn tác (hiện dạng lệnh để tự chạy, app không tự rollback) |

Bước nào phức tạp quá cho một lệnh (chờ cert `ISSUED`, chờ distribution `Deployed`) thì `do` là **một chuỗi lệnh + điều kiện chờ**, hiện tiến trình và cho huỷ.

## Màn hình

```
┌ Playbook: Website tĩnh + CDN + HTTPS ──────── ⛅ prod · ap-southeast-1 ┐
│ ✔ 1 Hosted zone cho shop.example.com                                   │
│ ✔ 2 Chứng chỉ ACM (us-east-1)              ← cert cho CloudFront BẮT   │
│ ◉ 3 Bucket S3 + chặn public access           BUỘC ở us-east-1          │
│ ○ 4 CloudFront + OAC trỏ vào bucket                                    │
│ ○ 5 Bản ghi ALIAS trong Route53                                        │
│ ○ 6 SPA fallback 403/404 → /index.html                                 │
│ ○ 7 Log truy cập + cảnh báo ngân sách                                  │
├────────────────────────────────────────────────────────────────────────┤
│ Bước 3 — Bucket S3 + chặn public access                                │
│ Vì sao: với OAC thì bucket KHÔNG cần public; chặn public là mặc định an │
│ toàn, và là lỗi cấu hình phổ biến nhất của website tĩnh trên AWS.       │
│ Lệnh sẽ chạy:  aws s3api create-bucket --bucket shop-example-site …     │
│ Tốn: ~0.023 USD/GB/tháng + phí request                                 │
│         [Kiểm tra]  [Chạy bước này]  [Bỏ qua]  [Hỏi agent về bước này] │
└────────────────────────────────────────────────────────────────────────┘
```

Trạng thái từng bước lưu theo `(playbook, profile, region, project)` — cùng playbook chạy cho dev và prod là hai tiến trình riêng.

## Hai playbook dựng sẵn

### A. Website tĩnh / SPA — `static-site`

1. **Hosted zone** cho tên miền (hoặc xác nhận zone đã có, in ra NS cần trỏ).
2. **Chứng chỉ ACM** — ⚠ cert dùng cho CloudFront **bắt buộc nằm ở `us-east-1`** bất kể site ở region nào; playbook tự ghim region cho riêng bước này và giải thích, vì đây là chỗ sai phổ biến nhất. Xác thực bằng DNS, bước tự thêm bản ghi CNAME rồi chờ `ISSUED`.
3. **Bucket S3** + **chặn toàn bộ public access** (với OAC thì không cần public).
4. **CloudFront** + **OAC** (không dùng OAI cũ), `default root object = index.html`, nén, HTTPS-only, HTTP/2+3.
5. **ALIAS record** trong Route53 trỏ vào distribution.
6. **SPA fallback**: 403/404 → `/index.html` với mã 200 (nếu là SPA).
7. **Vận hành**: bật log truy cập, **cảnh báo ngân sách** (AWS Budgets), và nút *"invalidation sau khi deploy"*.
8. **Deploy**: `s3 sync` thư mục build + tạo invalidation — bước này lặp lại mỗi lần deploy, có nút chạy nhanh.

### B. Website động (API + DB) — `dynamic-site`

Tiếp nối A, thêm nhánh `/api/*`:

1. **Chọn tầng chạy**: Lambda + API Gateway (rẻ, scale-to-zero) **hay** ECS Fargate + ALB (chạy container sẵn có, không giới hạn thời gian). Playbook hỏi ngay đầu và rẽ nhánh, kèm bảng đánh đổi ngắn.
2. **VPC**: subnet public/private, NAT (⚠ **NAT Gateway ~32 USD/tháng** — nói rõ, và nêu phương án VPC endpoint khi chỉ cần S3/DynamoDB), security group tối thiểu.
3. **Cơ sở dữ liệu**: RDS (hoặc DynamoDB nếu hợp mô hình) trong subnet private, SG chỉ mở từ SG của tầng app.
4. **Bí mật**: Secrets Manager / SSM Parameter Store; app đọc qua IAM role, **không** biến môi trường chứa mật khẩu.
5. **IAM role tối thiểu** cho Lambda/task — playbook in ra policy và giải thích từng quyền.
6. **API Gateway** (hoặc ALB) + route + integration; bật **access log** ra CloudWatch với định dạng có `requestId` (để [lần theo request](cloudwatch-logs.md) chạy được).
7. **Nối vào CloudFront**: thêm behavior `/api/*` trỏ sang API — một domain, không CORS.
8. **Quan sát**: log group + retention, alarm 5xx và p95 latency, (tuỳ chọn) bật **X-Ray** để [graph](infra-topology-graph.md) có độ trễ từng hop.
9. **CI/CD**: GitHub Actions dùng **OIDC role** (không cần access key dài hạn) — playbook in ra trust policy và workflow mẫu.

Kèm **playbook dọn dẹp** (`teardown`) theo thứ tự ngược, để môi trường thử không âm thầm tính tiền.

## Ranh giới — thứ này không thay IaC

Playbook là **click-ops có hướng dẫn và có kiểm chứng**: hợp để học, để dựng môi trường thử, để sửa một mảnh thiếu. Hạ tầng thật lâu dài vẫn nên là code.

Nên mỗi playbook có nút **"Xuất ra Terraform"**: sinh skeleton `.tf` tương ứng những bước đã chạy (resource + biến + output), để chuyển từ click-ops sang IaC mà không phải viết lại từ đầu. Skeleton là **điểm bắt đầu, không phải state** — không `import` tự động, và doc nói thẳng điều đó. Sau đó vòng đời đi tiếp bằng [Plan viewer](session-infra-context.md).

## Agent trong playbook

- **"Hỏi agent về bước này"** đẩy vào chat: nội dung bước + lệnh + kết quả `check`/`verify` gần nhất + lỗi (nếu có). Agent giải thích, chẩn đoán, đề xuất sửa — **không** tự chạy lệnh ghi.
- Agent **đọc được** trạng thái playbook (tool read) để trả lời *"tôi đang thiếu bước nào"*.
- Lỗi phổ biến có **chẩn đoán sẵn**: cert kẹt `PENDING_VALIDATION` (chưa thêm CNAME / zone sai), distribution `InProgress` (chờ ~5–15 phút), 403 từ S3 (thiếu policy OAC), ALIAS trỏ sai hosted zone id của CloudFront (`Z2FDTNDATAQYW2` là hằng số).

## Lộ trình

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **B1** | Định dạng playbook + runner (check/do/verify, trạng thái theo profile+region, hộp xác nhận, chờ-điều-kiện) | L |
| **B2** | Playbook **A — static-site** đầy đủ 8 bước + teardown | M |
| **B3** | Playbook **B — dynamic-site** cả hai nhánh (Lambda/APIGW và Fargate/ALB) | L |
| **B4** | "Hỏi agent về bước này" + agent đọc trạng thái + chẩn đoán lỗi phổ biến | M |
| **B5** | Xuất ra Terraform skeleton | M |
| **B6** | Người dùng tự viết playbook (fork bản dựng sẵn, sửa trong app) | M |

Phụ thuộc: P0 của [session-infra-context.md](session-infra-context.md); B2 dùng lại hộp xác nhận ghi của [infra-explorer.md](infra-explorer.md) E1.

## Bảo mật

- Mọi bước `do` là lệnh **ghi** ⇒ hộp xác nhận hiện đúng dòng lệnh + account id + region; bước phá huỷ trong teardown bắt **gõ lại tên resource**.
- Playbook là **dữ liệu L1 không tin** (người dùng sửa được, agent có thể sinh ra): `check/do/verify` phải là **arg array** đi qua `infra.run` với allowlist binary — **không** chuỗi shell, **không** `eval`, và không nhận binary tuỳ ý (invariant 8).
- Input người dùng (`{{domain}}`, `{{bucket}}`) validate charset trước khi nội suy; không bao giờ nội suy vào chuỗi shell (không có shell).
- Giá trị secret sinh ra trong quá trình (mật khẩu DB) đi thẳng vào Secrets Manager, **không** hiện trên UI, **không** vào trạng thái playbook, **không** vào chat.

## Câu hỏi mở

1. **Playbook đầu tiên nên là A hay B?** A nhanh thấy kết quả; B mới là thứ dựng sản phẩm thật. Đề xuất A trước để chạy thử khung runner, rồi B ngay sau.
2. **Nhánh nào của B là mặc định** — Lambda/API Gateway hay Fargate/ALB? Tuỳ app của bạn; nói cho tôi biết để viết nhánh đó trước.
3. Có cần **Amplify Hosting** như một playbook thứ ba (đơn giản hơn nhiều so với A, đổi lại ít kiểm soát) không?
