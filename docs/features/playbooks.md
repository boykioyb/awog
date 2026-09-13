# Feature — Playbook: kế hoạch thay đổi trực quan, chạy được, quay lui được

- **Trạng thái:** Planned — chưa code
- **ADR:** [0088](../decisions/0088-session-infra-context.md) · **Route:** `/playbooks` (trang riêng, có mục trên nav rail)
- **Anh em:** [aws-website-playbook.md](aws-website-playbook.md) (hai playbook hướng dẫn dựng sẵn — nội dung chạy trên nền tảng này) · [infra-topology-graph.md](infra-topology-graph.md) (nguồn suy ra ảnh hưởng) · [infra-audit-log.md](infra-audit-log.md) (bản ghi sau khi chạy) · [infra-cicd.md](infra-cicd.md)

## Hai loại playbook, một nền tảng

| Loại | Trả lời | Vòng đời |
|---|---|---|
| **Hướng dẫn** | *"Dựng thứ này từ đầu thế nào?"* — dựng website, nối SSO, bật giám sát | Dùng lại nhiều lần, sửa hiếm |
| **Triển khai** | *"Lần đưa bản này lên sẽ làm gì, chạm vào đâu, hỏng thì lui ra sao?"* | **Một bản cho một lần thay đổi**, rồi thành hồ sơ |

Loại thứ hai là thứ DevOps thực sự cần và gần như không đội nào duy trì nổi: runbook viết tay trong Confluence luôn lạc hậu vì hạ tầng đổi mà trang wiki thì không. AWOG lật ngược việc đó — **playbook sinh ra từ chính thay đổi sắp chạy**, và phần ảnh hưởng **suy từ graph kiến trúc thật** thay vì từ trí nhớ.

## Trang `/playbooks`

```
┌ Playbooks ────────────────────────────────────────────────────────────┐
│ [+ Kế hoạch mới ▾]   Nháp 2 · Chờ duyệt 1 · Đã chạy 34                │
├──────────────────────┬────────────────────────────────────────────────┤
│ ĐANG MỞ              │ checkout v2.4.0                    ● chờ duyệt │
│ ● checkout v2.4.0    │ 4 bước · ước tính 12 phút · chạm 5 dịch vụ     │
│ ○ bật WAF cho CDN    │ quay lui: có cho 4/4 bước                      │
│ HƯỚNG DẪN            │ ┌ sơ đồ bước → dịch vụ → ảnh hưởng lan ┐       │
│ ○ Website tĩnh       │ └──────────────────────────────────────┘       │
│ ○ Website động       │ [Kiểm tra trước] [Gửi duyệt] [Chạy] [Quay lui] │
│ ĐÃ CHẠY              │                                                 │
│ ✓ checkout v2.3.1    │ Bước 1 · 2 · 3 · 4 …                           │
└──────────────────────┴────────────────────────────────────────────────┘
```

### Sơ đồ là phần chính, không phải trang trí

Ba hàng xếp chồng, cùng một trục ngang là **thứ tự bước**:

1. **Hàng bước** — mỗi bước một thẻ: tên · thời gian ước tính · trạng thái khi chạy thật.
2. **Hàng dịch vụ chạm** — dưới mỗi bước là các dịch vụ nó động vào (RDS, ECS, CloudFront…), tô theo lớp lệnh của hành động.
3. **Hàng ảnh hưởng lan** — từ mỗi dịch vụ bị chạm, **lần theo graph kiến trúc** ra những thứ phụ thuộc nó: `ECS checkout → API Gateway /v1/orders → CloudFront → shop.example.com`. Đây là câu trả lời cho *"đụng vào cái này thì ai chết theo"* — và nó **tự cập nhật** vì graph đọc từ cấu hình thật.

Bước nào có cảnh báo (khoá bảng, mất kết nối, thay bản đang chạy) thì thẻ mang dấu hiệu và câu giải thích ngắn ngay trên sơ đồ.

## Một bước gồm những gì

| Trường | Bắt buộc | Nội dung |
|---|---|---|
| `title` · `why` | ✓ | Làm gì và vì sao — `why` viết cho người không theo dõi từ đầu |
| `services` | ✓ | Dịch vụ + tài nguyên cụ thể bị chạm (dùng để vẽ hàng 2 và suy hàng 3) |
| `check` | ✓ | Lệnh **đọc**: bước này đã xong chưa / tiền đề đã đủ chưa |
| `do` | ✓ | Lệnh **ghi**: hành động thật, qua popup xác nhận + ma trận quyền |
| `verify` | ✓ | Lệnh **đọc**: kiểm chứng kết quả, không tin exit code |
| `impact` | ✓ | Ai bị ảnh hưởng, bao lâu, có gián đoạn không. **Không được bỏ trống** |
| `rollback` | ✓ nếu `do` là ghi | Cách lui lại. Playbook thiếu rollback ở bước ghi thì **không gửi duyệt được** |
| `estimate` | | Thời gian ước tính, dùng để cộng ra tổng |
| `owner` | | Ai chịu trách nhiệm bước này |

Ba trong năm lệnh là **đọc** — nên mở một playbook đang dở vẫn biết đúng mình đang ở đâu.

## Vòng đời và cửa duyệt

```
nháp → kiểm tra trước → chờ duyệt → đã duyệt → đang chạy → xong
                                                    ↘ lỗi → đã quay lui
```

- **Kiểm tra trước (preflight)** chạy toàn bộ `check` của mọi bước **trước khi** chạy bước nào: biết ngay bước 3 sẽ hỏng vì thiếu quyền, thay vì phát hiện lúc đã làm xong bước 1–2.
- **Cửa duyệt**: playbook chạm tài khoản production thì phải có người **duyệt** (khác người tạo nếu đội bật luật đó). Duyệt là một hành động ghi → vào nhật ký: *ai duyệt, lúc nào, bản nào*.
- **Cửa sổ thời gian**: ước tính tổng thời gian; nếu khoảng chạy rơi vào **giờ cao điểm** (đọc từ [số liệu thật](infra-monitoring-reports.md), không phải đoán) thì cảnh báo và đề nghị dời.
- **Chạy**: từng bước, dừng ở bước lỗi, không bao giờ tự nhảy tiếp. Mỗi `do` vẫn mở popup xác nhận như mọi lệnh ghi khác.
- **Quay lui**: nút **Chạy kế hoạch quay lui** dựng ngược thứ tự từ bước đã chạy cuối cùng. Vẫn là lệnh ghi, vẫn qua popup — chỉ là được soạn sẵn, không phải nghĩ lúc đang cháy.

## Sinh nháp tự động — không bắt ai gõ từ đầu

Bốn nguồn, đều là thứ AWOG đã có:

| Từ | Thành |
|---|---|
| **`terraform plan`** | Mỗi `resource_changes` thành một bước; `create/update/delete` thành lớp lệnh; `delete` tự sinh cảnh báo impact |
| **Change set CloudFormation** | Tương tự, theo từng resource |
| **Pipeline CI/CD** | Các stage thành các bước; bước duyệt thủ công thành cửa duyệt |
| **Nhật ký lần triển khai trước** | *"Làm lại y như lần trước"* — dựng lại chuỗi lệnh đã chạy, giữ nguyên thứ tự |

Agent điền phần **`impact` và `rollback`** dựa trên graph kiến trúc + lịch sử: nó biết `orders-db` bị `checkout` gọi, `checkout` nằm sau `API Gateway`, `API Gateway` nằm sau `CloudFront` của `shop.example.com`. Người dùng **sửa và duyệt** — agent đề xuất, không tự quyết.

## Sau khi chạy: hồ sơ, không phải lịch sử chat

Playbook đã chạy đóng băng thành **bản ghi bất biến**: bản nào, ai duyệt, chạy lúc nào, bước nào mất bao lâu, bước nào lỗi, có quay lui không, và **liên kết tới từng dòng nhật ký hoạt động** tương ứng. Lưu thành trang [Wiki](wiki.md) ⇒ thành **change log** của đội mà không ai phải viết tay, và LLM đọc lại được ở phiên sau.

Đây cũng là nguyên liệu cho **báo cáo sự cố**: ghép playbook + nhật ký + biểu đồ ra được dòng thời gian *"10:28 chạy bước 2 → 10:31 p95 vọt → 10:34 quay lui bước 2 → 10:36 bình thường"*.

## Chia sẻ: xuất ra Markdown hoặc HTML

Người cần đọc kế hoạch thường **không có AWOG**: quản lý duyệt, đội khác bị ảnh hưởng, khách hàng, kiểm toán. Nên bản xuất phải **tự đứng một mình** — mở lên là đủ hiểu, không phụ thuộc app, không tải gì thêm.

### Ba mẫu, chọn theo người đọc

| Mẫu | Cho ai | Có gì / không có gì |
|---|---|---|
| **Kế hoạch để duyệt** | Quản lý, đội bị ảnh hưởng | Bước · ảnh hưởng · thời gian · quay lui · sơ đồ. **Không** có dòng lệnh, không ARN |
| **Runbook kỹ thuật** | Người trực, đội vận hành | Đủ mọi thứ: lệnh `check`/`do`/`verify`/`rollback`, resource id, thứ tự chính xác |
| **Báo cáo sau khi chạy** | Hồ sơ, kiểm toán, hậu kiểm sự cố | Kết quả thật: bước nào mất bao lâu, ai duyệt, có lui không, nối tới nhật ký |

Gửi cho sếp bản có `aws ecs update-service --desired-count 4` là gửi sai thứ — mẫu tồn tại để không phải cắt tay mỗi lần.

### Hai định dạng, hai mục đích

**Markdown** — để **commit vào repo** (kế hoạch triển khai được review trong PR như code), dán vào issue/ticket, hoặc lưu thành trang [Wiki](wiki.md). Sơ đồ ba hàng xuất thành **Mermaid** nên GitHub/GitLab render thẳng, và [MermaidView](../../apps/desktop/ui-next/components/common/MermaidView.vue) của app cũng đã render được.

**HTML một file** — inline CSS + **inline SVG** + **không script, không tài nguyên ngoài**. Gửi qua email/chat, mở bằng bất kỳ trình duyệt nào, và có **print stylesheet** nên Ctrl+P ra PDF gọn gàng (không thêm thư viện PDF).

Thêm **Sao chép dạng Markdown** cho việc dán nhanh vào Slack/Jira.

### Che thông tin trước khi ra khỏi máy

Đây là phần bắt buộc, không phải tuỳ chọn nâng cao. Playbook mang account id, ARN, endpoint RDS, tên bucket, đôi khi cả địa chỉ nội bộ — chia sẻ là **một hành động rò rỉ tiềm tàng**.

Hộp xuất có **chế độ che, mặc định BẬT** cho mẫu "Kế hoạch để duyệt" và cho mọi bản xuất ra ngoài thư mục làm việc:

| Nhóm | Che thành |
|---|---|
| Account id | `2290********` |
| ARN | rút còn `…:service/checkout` |
| Endpoint nội bộ, IP riêng | `<endpoint nội bộ>` |
| Tên bucket / tên miền nội bộ | giữ hay che — **bật/tắt riêng**, vì nhiều khi đó chính là thứ cần bàn |

Luôn có **xem trước bản đã che** trước khi ghi file — người dùng thấy chính xác thứ sắp gửi đi. Toàn bộ đi qua [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) thêm một lớp nữa để bắt token lỡ nằm trong ghi chú.

### Bản xuất là ảnh chụp, không phải bản sống

Mỗi file ghi ở chân trang: **sinh từ AWOG lúc nào · playbook bản nào · trạng thái lúc xuất**. Playbook sửa sau đó thì file đã gửi **không tự đổi** — và điều đó được nói rõ, vì người đọc cần biết mình đang cầm bản nào. Xuất lại sinh bản mới, không ghi đè.

### Bộ xuất dùng chung

Playbook, [báo cáo](infra-monitoring-reports.md) và [graph kiến trúc](infra-topology-graph.md) **dùng chung một bộ xuất**: cùng ba định dạng (Markdown · HTML một file · in ra PDF), cùng lớp che, cùng chân trang ghi nguồn. Viết một lần, ba bề mặt dùng.

Đích ghi file phải `assertInsideWorkspace` (invariant 2); muốn ghi ra ngoài thì đi qua hộp thoại chọn nơi lưu của hệ điều hành.

## Với người không rành kỹ thuật

Gọi là **"Kế hoạch triển khai"**. Sơ đồ đọc được mà không cần biết tên dịch vụ: mỗi thẻ nói *"Cập nhật cơ sở dữ liệu — khách không đặt hàng được trong khoảng 40 giây"*. Ba nút: **Kiểm tra trước · Chạy · Quay lui**. Cột kỹ thuật (lệnh, ARN, resource id) nằm trong mục gập.

## Lộ trình

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **PB1** | Định dạng playbook + runner (check/do/verify/rollback, trạng thái theo ngữ cảnh, popup xác nhận) | L |
| **PB2** | Trang `/playbooks`: danh sách · chi tiết · **sơ đồ ba hàng** · preflight | L |
| **PB3** | Vòng đời + cửa duyệt + quay lui dựng ngược + cửa sổ thời gian đọc từ số liệu | M |
| **PB4** | Sinh nháp từ `terraform plan` và change set; agent điền impact/rollback từ graph | L |
| **PB5** | Hồ sơ sau khi chạy: đóng băng, lưu Wiki, nối tới nhật ký, nguyên liệu cho báo cáo sự cố | M |
| **PB6** | Sinh từ pipeline CI/CD và từ nhật ký lần trước ("làm lại y như lần trước") | M |
| **PB7** | **Chia sẻ**: ba mẫu · xuất Markdown (Mermaid) · HTML một file (+ print → PDF) · lớp che có xem trước · chân trang ghi nguồn. Bộ xuất dùng chung với báo cáo và graph | M |

Phụ thuộc: P0 ([ngữ cảnh](session-infra-context.md)) · N1 ([nhật ký](infra-audit-log.md)) · G1–G2 ([graph](infra-topology-graph.md), cho phần ảnh hưởng lan).

## Bảo mật

- Playbook là **dữ liệu L1 không tin** (người sửa được, agent sinh ra được): `check/do/verify/rollback` phải là **arg array** qua `infra.run` với allowlist binary — không chuỗi shell, không `eval`, không nhận binary tuỳ ý.
- Biến nội suy (`{{domain}}`, `{{image_tag}}`) validate charset trước khi ghép; không có shell nên không có injection qua biến.
- Mọi `do`/`rollback` đi qua ma trận quyền và vào nhật ký — playbook **không phải** đường vòng để chạy lệnh không bị ghi.
- Bản ghi đã đóng băng **không sửa được**; muốn đổi thì tạo bản mới, giữ liên kết tới bản cũ.
- **Xuất file là hành động rời máy**: lớp che mặc định bật, luôn có xem trước, và mỗi lần xuất **vào nhật ký hoạt động** (xuất mẫu nào, che hay không, ra đâu) — để trả lời được "ai đã gửi kế hoạch này ra ngoài".
