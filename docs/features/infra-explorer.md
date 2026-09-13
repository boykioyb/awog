# Feature — Infra Explorer: màn hình quản lý AWS + Kubernetes trong app

- **Trạng thái:** Planned — chưa code
- **ADR:** [0088 — ngữ cảnh hạ tầng ghim theo phiên](../decisions/0088-session-infra-context.md) (chia chung invariant: CLI shell-out, ngữ cảnh ghim sidecar, 3 cấp read/write/forbidden)
- **Route:** `/infra` + tab **Infra** trong Session Workspace Panel
- **Anh em:**
  - [session-infra-context.md](session-infra-context.md) — nền: chọn ngữ cảnh trong phiên + tool cho agent
  - [cloudwatch-logs.md](cloudwatch-logs.md) — **màn Logs, ưu tiên số 1**, tách riêng vì sâu hơn một bảng
  - [infra-topology-graph.md](infra-topology-graph.md) — graph kiến trúc + luồng request theo domain
  - [aws-website-playbook.md](aws-website-playbook.md) — hướng dẫn dựng website chạy được từng bước

## Mục tiêu

Xem và vận hành hạ tầng **ngay trong AWOG**: liệt kê Amplify app và deployment, đọc log CloudWatch, duyệt S3, xem/điều khiển EC2 · ECS/Fargate · EKS · Lambda · RDS, và một màn Kubernetes đủ dùng (workload · log · exec · port-forward). Không phải mở 6 tab console để trả lời một câu hỏi.

### Phạm vi thật — nói trước để khỏi vỡ kỳ vọng

**Làm:** duyệt/tìm/lọc mọi resource chính, xem chi tiết, đọc log, và **hành động ngày-2** trên resource đã tồn tại (start/stop instance, scale service, redeploy branch, rollout restart, xoá object, chạy lại job).

**Không làm:** wizard **tạo mới** hạ tầng phức tạp (EC2 với VPC/subnet/SG/AMI/IAM, cụm EKS, RDS). Dựng lại cái đó là viết lại AWS Console — nhiều màn, nhiều ràng buộc chéo, sai một ô là tốn tiền thật. Chỗ nào cần tạo mới phức tạp, AWOG đưa **nút mở thẳng trang tương ứng trên AWS Console** (deep link theo region + resource id). Tạo mới **chỉ** làm ở nơi nó thật sự là một form nhỏ: bucket/folder S3, upload file, `ecs run-task` từ task-definition có sẵn, nodegroup scale, Amplify start-job.

Với hạ tầng-as-code, đường đúng vẫn là Terraform ([session-infra-context.md](session-infra-context.md) P4) — Explorer là để **nhìn và vận hành**, không phải để thay IaC.

## Kiến trúc: một bảng, nhiều mô tả — không phải 20 trang viết tay

Mấu chốt để "và các thứ khác…" không thành vô hạn: **không** viết một trang cho mỗi service. Viết **một** khung bảng + một **registry mô tả service**, mỗi service là một object khai báo.

Mỗi mô tả khai **hai bộ cột**: `columns.simple` (2–4 cột, nhãn tiếng người) và `columns.full` (đủ như bảng kỹ thuật). Công tắc Đơn giản/Chuyên sâu đổi giữa hai bộ — cùng dữ liệu, cùng màn.

```ts
type ResourceView = {
  id: 'ec2.instances'
  service: 'ec2'
  label: 'EC2 Instances'
  list: { args: (ctx) => string[]; pick: (json) => Row[]; paginate?: 'token' | 'none' }
  columns: { simple: Column[]; full: Column[] }   // Đơn giản: nhãn tiếng người; Chuyên sâu: đủ cột
  plain?: (row) => string                 // một câu mô tả dòng này bằng tiếng người
  detail?: { args: (row) => string[]; render: 'json' | 'kv' | Tabs[] }
  actions?: Action[]                      // { id, label, args, danger, confirm: 'simple'|'type-name' }
  consoleUrl?: (row, ctx) => string       // deep link khi cần làm thứ Explorer không làm
}
```

Thêm một service = thêm một file mô tả (~40–80 dòng), không đụng khung. Bảng, phân trang, tìm kiếm, refresh, cột co giãn, empty state, error state, virtual scroll (>200 dòng, khuôn Git) viết **một lần**.

Mọi `args` đi qua `infra.run` của ADR 0088: arg array, không shell, ngữ cảnh (`--profile`/`--region`) do sidecar chèn, `--output json`, timeout, cap output. Nghĩa là Explorer **không có** đường ra mạng riêng — nó dùng đúng cái cổng mà agent dùng, nên cùng một luật duyệt và cùng một chỗ audit.

## Màn mở đầu: Tổng quan

`/infra` **không** mở ra ở một bảng resource. Nó mở ở **Tổng quan** — trả lời câu hỏi duy nhất mà cả người rành lẫn không rành đều hỏi đầu tiên: *mọi thứ có đang ổn không?*

| Thẻ | Đèn | Câu giải thích (luôn có, bằng tiếng người) |
|---|---|---|
| Website | xanh | "shop.example.com phản hồi bình thường, 38 ms" |
| Lỗi 1 giờ qua | đỏ | "214 lỗi ở dịch vụ thanh toán — chủ yếu là quá hạn chờ" → bấm mở Logs đã lọc sẵn |
| Máy chủ | vàng | "1 trong 4 máy đang tắt (batch-worker)" |
| Chi phí tháng này | xanh | "412 USD, tương đương tháng trước" |
| Chứng chỉ & tên miền | vàng | "Chứng chỉ shop.example.com hết hạn sau 21 ngày" |
| Bản triển khai gần nhất | xanh | "Amplify · nhánh main · thành công lúc 09:12" |

Mỗi thẻ bấm được để đi vào màn chi tiết tương ứng, và có nút **Hỏi agent** ngay trên thẻ. Dưới cùng là hàng chip câu hỏi gợi ý. Đây là màn duy nhất nạp nhiều view cùng lúc — nên nó nạp **khi bấm ↻ hoặc khi mở**, không tự làm mới, và ghi rõ thời điểm.

## Màn Dịch vụ: danh mục đầy đủ

Tổng quan trả lời *"có ổn không"*. **Dịch vụ** trả lời *"AWS có gì, tôi đang dùng gì, và vào đâu để xem"* — đây là màn duyệt từ trên xuống, thay cho việc phải nhớ tên service.

```
┌ /infra → Dịch vụ ─────────────────────────────────────────────────────┐
│ [tìm dịch vụ hoặc resource…  ⌘K]              [Đơn giản|Chuyên sâu]   │
├───────────────────────────────────────────────────────────────────────┤
│ ĐANG DÙNG TRONG TÀI KHOẢN NÀY (9)                    chi phí tháng 4  │
│  S3 · 18 bucket · 42$   EC2 · 4 máy · 96$   ECS · 4 service · 121$    │
│  CloudFront · 5 · 18$   Lambda · 23 · 3$    RDS · 3 · 104$      …     │
├───────────────────────────────────────────────────────────────────────┤
│ MÁY CHỦ & TÍNH TOÁN          │ LƯU TRỮ & CƠ SỞ DỮ LIỆU                │
│  EC2        Đầy đủ    4      │  S3          Đầy đủ    18              │
│  ECS/Fargate Đầy đủ   4      │  RDS         Đầy đủ     3              │
│  EKS        Đầy đủ    2      │  DynamoDB    Danh sách  7              │
│  Lambda     Đầy đủ   23      │  EFS         Console    —              │
│  Batch      Console   —      │  Backup      Danh sách  2              │
└───────────────────────────────────────────────────────────────────────┘
```

### Ba mức hỗ trợ, hiện thẳng trên thẻ

AWS có hơn 200 dịch vụ; AWOG sẽ không có màn riêng cho từng cái, và **nói thẳng điều đó** thay vì để người dùng bấm vào rồi mới biết.

| Mức | Nghĩa là | Cách làm |
|---|---|---|
| **Đầy đủ** | Bảng + chi tiết + hành động ngày-2 | File mô tả `ResourceView` viết tay (~40–80 dòng) |
| **Danh sách** | Bảng chỉ đọc, vài cột chính, không hành động | Mô tả **tối giản**: một lệnh `list-*`/`describe-*` + 3–4 cột. Rẻ tới mức thêm được hàng chục dịch vụ mỗi đợt |
| **Mở Console** | Chưa có trong app | Thẻ vẫn hiện, bấm là deep-link đúng region; kèm nút **Hỏi agent** |

Mức "Mở Console" **không phải ngõ cụt**: agent có CLI đầy đủ, nên vẫn hỏi được *"liệt kê các hàng đợi SQS"* và nhận bảng trả lời — chỉ là chưa có màn riêng. Đây cũng là cách chọn dịch vụ nào nâng lên "Danh sách" hay "Đầy đủ" tiếp theo: cái nào bị hỏi nhiều.

### "Đang dùng trong tài khoản này" — phần quan trọng nhất

Tài khoản trống mà hiện 200 thẻ thì vô dụng. Hàng đầu tiên luôn là **những dịch vụ thực sự đang có resource**, kèm số lượng và **chi phí tháng này**:

- Nguồn chính: `ce get-cost-and-usage --group-by SERVICE` — trả lời chính xác "tôi đang trả tiền cho cái gì". ⚠ API này **tính tiền mỗi request** nên chỉ chạy khi bấm, cache theo ngày, ghi rõ thời điểm.
- Nguồn phụ (miễn phí): `resourcegroupstaggingapi get-resources` cho resource có tag, cộng với số đếm từ chính các view đã nạp.

Bấm một dịch vụ trong hàng này là vào thẳng view của nó.

### Danh mục — đặt tên theo việc, không theo bảng chữ cái

Máy chủ & tính toán · Lưu trữ & cơ sở dữ liệu · Mạng & phân phối · Tên miền & chứng chỉ · Triển khai & CI/CD · Theo dõi & nhật ký · Bảo mật & quyền · Hàng đợi & sự kiện · Chi phí & hoá đơn · Hạ tầng dạng mã.

Mỗi thẻ dịch vụ có **một dòng nói nó dùng để làm gì** bằng tiếng người ("S3 — nơi chứa file: ảnh, bản build, sao lưu"), hiện ở chế độ Đơn giản và thành tooltip ở chế độ Chuyên sâu.

### Ghim để đổi sidebar

Ghim một dịch vụ ⇒ nó xuất hiện trong sidebar Explorer. Nghĩa là **sidebar là của bạn**, không phải danh sách tôi chọn cứng: người làm web ghim CloudFront/S3/Route53, người làm data ghim RDS/DynamoDB/Glue. Mặc định ghim sẵn 6 cái hay dùng nhất.

### Tìm kiếm ⌘K — một ô cho cả hai loại câu hỏi

Gõ `s3` hoặc `lưu trữ` → ra dịch vụ. Gõ `web-prod-1` hoặc `i-0a3f` → ra **chính resource đó** trong các view đã nạp. Gõ `tại sao 502` → chuyển thành câu hỏi cho agent. Một ô, ba loại kết quả, phân nhóm rõ.

## Bố cục màn hình

```
┌ /infra ───────────────────────────────────────────────────────────────┐
│ ⛅ Offshore-Developer ▾   ap-southeast-1 ▾        [↻]  [Console ↗]    │
├────────────┬──────────────────────────────────────────────────────────┤
│ COMPUTE    │  ┌ EC2 Instances ─────────────── [tìm] [lọc: state ▾] ┐  │
│  EC2    12 │  │ ● i-0a3f…  web-prod-1   t3.medium  running  2d    │  │
│  ECS     4 │  │ ○ i-0b71…  batch-1      t3.small   stopped  14d   │  │
│  Lambda 23 │  └──────────────────────────────────────────────────────┘ │
│  EKS     2 │  ┌ Chi tiết: i-0a3f… ───────────────────────────────────┐ │
│ STORAGE    │  │ Tổng quan · Networking · Volumes · Tags · Log        │ │
│  S3     18 │  │ private ip 10.0.3.14 · sg-web · az ap-southeast-1a   │ │
│ DEPLOY     │  │                      [Stop] [Reboot] [Console ↗]     │ │
│  Amplify 3 │  └──────────────────────────────────────────────────────┘ │
│ OBSERVE    │                                                           │
│  Logs      │                                                           │
│ KUBERNETES │                                                           │
│  prod-eks  │                                                           │
└────────────┴──────────────────────────────────────────────────────────┘
```

Sidebar nhóm theo **việc** (Compute · Storage · Deploy · Observe · Data · Kubernetes), không theo bảng chữ cái — và đếm số resource sau lần nạp đầu. Khung ba vùng (sidebar · bảng · chi tiết) tái dùng shell của trang Git, gồm cả sidebar resize/collapse và virtual scroll.

Sidebar có bốn mục cố định trên cùng — **Tổng quan · Dịch vụ · Tài khoản · Nhật ký** — rồi tới các view đã ghim, rồi Topology và Playbooks.

**Thanh ngữ cảnh đầu trang là control DUY NHẤT chọn tài khoản.** Profile · region · cluster nằm ở đó, mọi view bên dưới derive từ nó — **không view nào có picker account riêng**, vì có picker riêng là có cách để hai bảng cạnh nhau nói về hai account khác nhau mà không ai nhận ra. Đổi ngữ cảnh ⇒ vô hiệu toàn bộ cache và nạp lại; mỗi bảng ghi rõ account + "nạp lúc HH:MM". Account đánh dấu production làm cả thanh đổi màu. Thanh này dùng chung state với chip trong phiên và chip status bar — xem [session-infra-context.md](session-infra-context.md#ngữ-cảnh-là-của-không-gian-làm-việc-không-phải-của-riêng-màn-chat).

**Mỗi dòng, mỗi node, mỗi bước đều có "Hỏi agent"** — đẩy đối tượng đang chọn (JSON rút gọn, đã redact) vào phiên; và ngược lại agent lái được chính màn hình bạn đang mở qua `infra_view`/`infra_action`.

**Trong phiên chat:** cùng khung đó làm **tab Infra** của Workspace Panel, hẹp hơn (bảng + chi tiết, bỏ sidebar → dùng dropdown). Mỗi dòng có **"Gửi vào chat"** — đẩy resource đang chọn (dạng JSON đã rút gọn) vào composer, để hỏi agent *"vì sao pod này restart 14 lần"* mà không phải copy tay.

## Các view theo service

### AWS — Compute

| View | Cột | Hành động (day-2) |
|---|---|---|
| **EC2 Instances** | id · name (tag) · type · state · AZ · private/public IP · uptime | Start · Stop · Reboot · *Terminate (gõ tên để xác nhận)* · Console ↗ |
| **ECS Clusters / Services / Tasks** | cluster · service · desired/running/pending · launch type (**Fargate**/EC2) · task-def revision · deployment status | Scale (`--desired-count`) · Redeploy (`--force-new-deployment`) · Stop task · Xem log task (→ CloudWatch) |
| **EKS Clusters** | tên · version · status · endpoint · nodegroup (số node, instance type, desired/min/max) | `update-kubeconfig` (nối sang màn Kubernetes) · Scale nodegroup · Console ↗ |
| **Lambda Functions** | tên · runtime · memory · timeout · last modified · lần gọi gần nhất | Xem log (→ CloudWatch) · Invoke (payload JSON, **duyệt**) · Console ↗ |

### AWS — Storage · Data

| View | Cột | Hành động |
|---|---|---|
| **S3 Buckets → Objects** | duyệt như cây thư mục: key · size · storage class · sửa lần cuối | Upload · Tạo folder · Tải về · **Xem nội dung qua `usePreview()` sẵn có** (ảnh/PDF/md/text) · Copy URL ký sẵn (presign, hạn ngắn) · Xoá (xác nhận) |
| **RDS Instances** | id · engine + version · class · status · storage · multi-AZ · endpoint | Console ↗ · *(không start/stop ở v1 — dễ tốn tiền và có ràng buộc thời gian)* |
| **DynamoDB Tables** | tên · item count · size · billing mode · index | Xem item mẫu (scan giới hạn) · Console ↗ |

### AWS — Deploy · Observe

| View | Cột | Hành động |
|---|---|---|
| **Amplify Apps → Branches → Jobs** | app · branch · job id · status (`SUCCEED`/`FAILED`/`RUNNING`) · commit · thời lượng | **Xem log build** (stream) · **Start job** (redeploy branch) · Stop job · Mở URL branch ↗ |
| **CloudWatch Logs** | → **[cloudwatch-logs.md](cloudwatch-logs.md)** | Insights · lọc nâng cao · histogram kéo-zoom · live tail · **lần theo một request xuyên service**. Đây là màn được đầu tư nhất, có spec riêng |

### AWS — Network · Delivery · Định nghĩa hạ tầng

| View | Cột | Hành động |
|---|---|---|
| **API Gateway** (REST v1 + HTTP v2) | api · protocol · stage · route/resource + method · integration (→ Lambda/ALB/HTTP) · authorizer · custom domain · access log bật/tắt | Xem log của stage (→ Logs) · Deploy stage (**duyệt**) · Bật access log (**duyệt**) · Console ↗ |
| **CloudFront** | distribution · aliases (tên miền) · origin · behavior (path → origin) · cache policy · status · WAF | **Tạo invalidation** (thao tác ngày-2 hay dùng nhất) · Xem lịch sử invalidation · Bật/tắt distribution (**gõ tên xác nhận**) · Console ↗ |
| **VPC** | VPC · subnet (AZ, CIDR, public/private theo route table) · route table · IGW/NAT · **security group + luật in/out** · NACL · endpoint · peering/TGW | Xem luật SG dạng bảng đọc được · *(sửa SG = duyệt, sau)* · **Xem dạng graph** (→ [topology](infra-topology-graph.md) chế độ VPC) |
| **CloudFormation** | stack · status · drift · cập nhật lần cuối · outputs · parameters | Xem resource của stack (bấm là nhảy sang view của service đó) · Xem events theo thời gian · **Xem template** (Monaco read-only) · Xem change set · *Thực thi change set → **forbidden***, hiện lệnh để tự chạy |
| **Route53** | hosted zone · record (type, giá trị, TTL, ALIAS target) · health check | Xem NS · **Mở graph từ domain này** · Console ↗ |
| **ACM** | cert · domain + SAN · status · ngày hết hạn · region | Cảnh báo cert sắp hết hạn · Xem CNAME xác thực còn thiếu |

> ⚠ ACM cho CloudFront **bắt buộc ở `us-east-1`** — view ACM vì thế luôn hiện thêm cột region và cảnh báo khi bạn đang ở region khác mà tìm cert cho CloudFront. Đây là chỗ sai phổ biến nhất khi dựng website.

### Kubernetes (một màn kiểu Lens-lite)

Nguồn: `kubectl` với context + namespace ghim theo ngữ cảnh (ADR 0088). Không dùng SDK.

| Nhóm | View | Hành động |
|---|---|---|
| **Workloads** | Pods (tên · ready · status · restarts · node · age) · Deployments · StatefulSets · DaemonSets · Jobs/CronJobs | **Log** (tail, chọn container, `--previous` khi crash) · **Exec** (terminal thật qua node-pty) · Describe · **Scale** · **Rollout restart** · Xoá pod (xác nhận) |
| **Network** | Services · Ingress · Endpoints | **Port-forward** bật/tắt (khuôn [SshForwardPanel](../../apps/desktop/ui-next/components/ssh/SshForwardPanel.vue), bind `127.0.0.1`) |
| **Config** | ConfigMaps (xem được) · Secrets (**chỉ tên + key, không hiện giá trị**; muốn xem thì bấm nút riêng có duyệt) | Sửa ConfigMap (duyệt) |
| **Cluster** | Nodes (cpu/mem, điều kiện) · Events (sắp theo thời gian, lọc warning) · Namespaces | Cordon/Drain → **forbidden** trong app, chỉ hiện lệnh để tự chạy |

Ba thứ làm màn này khác một bảng `kubectl get`: **log viewer** (tail + tìm + nhiều container), **exec** (cắm thẳng vào PTY sẵn có — [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)), **port-forward có trạng thái** (thấy cổng nào đang mở, tắt được).

## Hành động ghi: luật chung

Người bấm nút *chính là* hành vi duyệt. Agent bấm cùng nút đó qua `infra_action` thì đi qua **ma trận quyền** ở Settings (Tự động / Hỏi / Chặn, cột riêng cho account production) — cùng một hành động, hai đường vào, một luật. Luật:

1. Mọi nút ghi mở hộp xác nhận **nói hậu quả trước bằng tiếng người** — *"Máy chủ web-prod-1 sẽ bị xoá vĩnh viễn. Website đang chạy trên nó sẽ ngừng."* — rồi mới tới ngữ cảnh (`profile · region · account id`) và **dòng lệnh đầy đủ nằm trong mục *Chi tiết kỹ thuật* gập lại**. Không có "cho phép và đừng hỏi lại".
2. Hành động **phá huỷ hoặc tốn tiền** (terminate instance, xoá bucket/object hàng loạt, xoá deployment, scale về 0 ở prod) → **gõ lại tên resource** mới bật được nút, khuôn "gõ tên repo để xoá" của GitHub.
3. Ngữ cảnh **đánh dấu production** → viền đỏ toàn hộp + câu xác nhận nhắc tên account/cluster.
4. Lớp **phá huỷ** mặc định là **Chặn** trên account production (hiện lệnh + deep link Console thay vì chạy) — nhưng đây là **ô trong ma trận**, chủ account nới được nếu muốn; nới thì chip nhuộm cảnh báo và mọi lệnh vào nhật ký.
5. Mọi lệnh ghi đi qua `infra.run` ⇒ vào **git-command-log-style ring buffer** để xem lại "app đã chạy gì trên account của tôi" ([khuôn log lệnh git](git-command-log.md)).

## Hiệu năng, chi phí, và giới hạn

- **Không auto-refresh.** Mỗi view nạp khi mở và khi bấm ↻. Lý do: mỗi lần nạp là một lần gọi API thật; auto-refresh 30s trên 10 view là hàng nghìn call/ngày (và với Cost Explorer thì **mỗi request tốn tiền**).
- **Cache theo `(profile, region, view)`** trong bộ nhớ sidecar, TTL ngắn, hiện "nạp lúc HH:MM" trên bảng để không ai nhầm số cũ là số live.
- **Phân trang bằng token của CLI** (`--max-items`/`--starting-token`), không kéo hết rồi lọc client.
- **Tail log là tiến trình sống** — đếm và tắt khi rời tab, như PTY/port-forward đang làm.
- Account nhiều nghìn resource: bảng ảo hoá (>200 dòng) + tìm kiếm đẩy xuống CLI khi service hỗ trợ filter, không lọc trong JS.

## Lộ trình

Phụ thuộc: **P0 của [session-infra-context.md](session-infra-context.md)** (adapter + `infra.run` + gate + ngữ cảnh ghim) phải xong trước — Explorer ngồi trên đúng cái cổng đó.

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **E1** | Khung Explorer: registry `ResourceView`, trang `/infra` (sidebar · bảng · chi tiết), bảng dùng chung (tìm/lọc/phân trang/virtual scroll/empty/error), hộp xác nhận ghi, ring buffer lệnh | L |
| **E2** | **CloudWatch Logs L1–L3** → [cloudwatch-logs.md](cloudwatch-logs.md). Đi trước mọi view khác vì đây là thứ mở hằng ngày | L |
| **E3** | **S3** (duyệt + preview + upload/tải/xoá) · **EC2** (start/stop/reboot) — hai view "đơn giản" để chốt khung bảng và hộp xác nhận | M |
| **E4** | **Delivery & API**: **CloudFront** (+ invalidation) · **API Gateway** · **Route53** · **ACM** — cụm phục vụ website, và là đầu vào của graph | L |
| **E5** | **Container & deploy**: **ECS/Fargate** · **EKS** · **Amplify** (log build, start job) · **Lambda** | L |
| **E6** | **CloudFormation** (resource/events/template/change set) · **VPC** (subnet/route/SG) | M |
| **E7** | **Màn Kubernetes**: workloads, log viewer, exec PTY, port-forward panel, scale/rollout restart | L |
| **E8** | Tab **Infra** trong Session Workspace Panel + "Gửi vào chat" + agent đọc được view đang mở | M |
| **E9** | **Màn Dịch vụ**: danh mục đầy đủ · hàng "đang dùng" (Cost Explorer + tagging API) · ba mức hỗ trợ · ghim đổi sidebar · tìm kiếm ⌘K | M |
| **E10** | Mức **Danh sách** hàng loạt: mô tả tối giản cho ~40 dịch vụ còn lại (SQS · SNS · DynamoDB · Secrets · SSM · Glue · Step Functions · WAF · IAM read-only…) | S/dịch vụ |

Thứ tự theo **tần suất mở thật**, không theo độ khó. CloudWatch trước tiên; cụm CloudFront/APIGW/Route53/ACM (E4) đi sớm vì nó vừa là thứ hay động tới, vừa là dữ liệu đầu vào của [graph](infra-topology-graph.md) và [playbook](aws-website-playbook.md).

## Bảo mật

Thừa kế toàn bộ ADR 0088 (CLI shell-out, arg array không shell, ngữ cảnh ghim sidecar, chặn `--endpoint-url`/`--kubeconfig`, binary allowlist + verify realpath). Thêm bốn điều riêng của Explorer:

| Rủi ro | Xử lý |
|---|---|
| **Secret hiện trên màn** (k8s Secret, SSM SecureString, biến môi trường Lambda) | Mặc định **chỉ hiện tên/key**. Xem giá trị là một hành động riêng có duyệt, giá trị **không** vào cache, **không** vào ring buffer, **không** tự động vào chat |
| **Tải S3 object về máy** | Đích tải phải `assertInsideWorkspace` (invariant 2); tên file sanitize; không ghi đè im lặng |
| **URL ký sẵn (presign)** | Hạn ngắn (≤15 phút), hiện rõ hạn, không log URL vào ring buffer (nó *là* credential) |
| **Log/JSON đổ vào chat** | Đi qua [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) trước khi vào transcript — log ứng dụng rất hay chứa token |

**infosec audit bắt buộc** trước E2 (lần đầu app tự gọi API cloud ngoài phiên chat) và trước bất kỳ nút ghi nào lên production.

## Câu hỏi mở

1. **Nhiều account cùng lúc?** Thiết kế hiện tại là *một ngữ cảnh tại một thời điểm* (đổi bằng dropdown ở đầu trang). Xem song song hai account (dev vs prod) là mô hình khác — đề xuất hoãn, mở lại nếu thực tế cần.
2. **Cost Explorer** có làm không? Hữu ích nhưng `ce get-cost-and-usage` **tính tiền mỗi request** — nếu làm thì phải là view nạp-khi-bấm, có cảnh báo, không bao giờ auto.
3. **E4 (màn k8s) có nên đi trước E3 không?** Nếu công việc hằng ngày của bạn nằm ở Kubernetes nhiều hơn ECS/Amplify thì đảo — cái nào mở nhiều hơn thì làm trước.
