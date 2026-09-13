# Kế hoạch triển khai — họ tính năng Hạ tầng

- **Trạng thái:** Đề xuất, chờ chốt · **Ngày:** 2026-09-12
- **Bản đồ spec:** [infra-README.md](infra-README.md) · **ADR:** [0088](../decisions/0088-session-infra-context.md)
- **Quy mô:** 10 spec, 14 bề mặt. Tài liệu này biến chúng thành **8 mốc**, mỗi mốc tự nó dùng được.

## Ba nguyên tắc xếp thứ tự

1. **Lát cắt dọc trước, bề rộng sau.** Mốc 0 đi xuyên từ UI → cổng quyền → CLI → nhật ký để **kiểm chứng ba giả định** mà cả 10 spec đang dựa vào. Sai giả định thì sửa lúc này rẻ hơn sau khi đã viết graph, playbook, báo cáo.
2. **Hạ tầng dùng chung ra sớm.** `infra.run`, ma trận quyền, popup xác nhận, bảng registry, bộ xuất file — mỗi thứ viết một lần, năm bề mặt dùng. Viết muộn thì phải sửa ngược năm chỗ.
3. **Mỗi mốc phải dùng được hằng ngày**, không phải nửa vời chờ mốc sau.

### Ba giả định mốc 0 phải kiểm chứng

| Giả định | Sai thì sao | Đo bằng |
|---|---|---|
| Shell-out CLI đủ nhanh cho UI | Phải cân nhắc SDK ⇒ đảo ADR 0088 §3 | Thời gian `describe-instances` 200 máy, `list-objects` 5k object |
| Ma trận quyền không gây phiền | Người dùng bật bypass vĩnh viễn ⇒ mất ý nghĩa | Đếm số lần hỏi trong một ngày dùng thật |
| Người dùng chọn ngữ cảnh ở thanh trên | Phải đổi mô hình ngữ cảnh ⇒ ảnh hưởng mọi màn | Có ai chạy nhầm account trong 2 tuần không |

---

## Mốc 0 — Nền & lát cắt kiểm chứng · ~3 tuần

**Xong mốc này thì:** hỏi agent *"liệt kê S3 bucket"*, thấy popup duyệt có đủ account/region, chạy đúng tài khoản, và tra lại được trong nhật ký. Terminal trong phiên gõ `aws` không cần `--profile`.

| # | Việc | Phụ thuộc | Cỡ |
|---|---|---|---|
| 0.1 | `infra/binary.ts` — dò binary theo allowlist prefix + verify realpath (khuôn `vpn/binary.ts`). ⚠ `kubectl` không có `--version`, dùng `version --client` (đo trên v1.33.9) | — | S |
| 0.1b | **Đường dẫn được người dùng bảo lãnh** — danh sách rỗng mặc định trong settings, thêm bằng một hành động UI tường minh, ghi vào nhật ký. Lý do: trên máy dev `/usr/local/bin/kubectl` realpath ra `/Applications/OrbStack.app/…`, tức allowlist prefix hiện tại **từ chối kubectl có thật**. Nới prefix sang `/Applications/` là hạ hàng rào cho mọi app bundle; bảo lãnh từng đường dẫn giữ được mặc-định-từ-chối mà không chặn máy thật | 0.1 | S |
| 0.2 | `infra/classify.ts` — 4 lớp `read/write/destructive/context-switch`, động từ lạ ⇒ `write`. **Test bảng bắt buộc** | — | M |
| 0.3 | `infra/run.ts` — spawn arg-array không shell, chèn cờ ngữ cảnh, timeout, clamp output. **Từ chối đủ bộ cờ**: `--profile` · `--region` · `--context` · `--namespace` (+ alias ngắn `-n` của kubectl) · `--endpoint-url` · `--server` · `--kubeconfig` · `--no-verify-ssl` · `--ca-bundle`. Danh sách 8 cờ ở 0.2 **còn thiếu `--server` và alias ngắn** — bịt tại đây, nơi có kiến thức cờ theo từng tool (invariant 7) | 0.1, 0.2 | M |
| 0.4 | `infra/aws/ini.ts` — parser allowlist-key (`[profile x]` vs `[x]`, comment `;`/`#`, CRLF, khoá trùng). Secret bị vứt **trong hàm parse** | — | M |
| 0.5 | `infra/aws/profiles.ts` — gộp 2 file, derive `kind`, honor `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE` | 0.4 | M |
| 0.6 | `audit/store.ts` — JSONL `~/.awog/infra-audit/YYYY-MM.jsonl`, ghi **tại `infra.run`** (không phải call site), redact **trước khi chạm đĩa**, xoay file theo tháng | 0.3 | M |
| 0.7 | Ma trận quyền: schema settings + `permission.ts` nhánh infra + bypass tạm thời có hết hạn + luật **Settings là trần, phiên chỉ siết** | 0.2 | L |
| 0.8 | `SessionHeader.infra` + `Project.infra` + `settings.infra` + `useInfraContext()` 3 tầng + đóng băng lúc tạo phiên | — | M |
| 0.9 | RPC `infra.contexts` / `infra.status` / `infra.run` / `infra.setSessionContext` + đăng ký `index.ts` | 0.3, 0.5 | S |
| 0.10 | `ConfirmDialog` dùng chung: hậu quả trước · chip ngữ cảnh · Chi tiết kỹ thuật gập · 4 biến thể (đọc/ghi/phá huỷ/chặn) · gõ-tên | — | M |
| 0.11 | `InfraChip` trong `SessionContextStrip` + thanh ngữ cảnh dùng chung (dùng lại cho mọi màn sau) | 0.8 | M |
| 0.12 | `runtime/tools/infra-tools.ts`: `aws_cli` · `aws_profiles` · `infra_context` — wire **cả 2 runtime** (Pi AgentTool + bridge Claude SDK) | 0.3, 0.7 | M |
| 0.13 | Tiêm `AWS_PROFILE` + `AWS_REGION` + `AWS_DEFAULT_REGION` vào PTY của phiên; đổi chữ ký `filteredShellEnv()` (3 call site) | 0.8 | M |
| 0.14 | Danh sách **cứng** không-thể-always-allow cho `Bash`: aws/terraform/kubectl/helm/gcloud/az | 0.2 | S |
| 0.15 | Block `<infra_context>` mỗi lượt (`context/environment.ts`, dùng chung 2 runtime) | 0.8 | S |
| 0.16 | Watcher `~/.aws` → `infra.fs-changed` + i18n en/vi | — | S |
| 0.17 | **infosec audit #1** — lần đầu agent chạm hạ tầng thật | 0.12 | M |

**Nghiệm thu:** (a) agent gọi `aws_cli(['s3api','list-buckets'])` → popup có account id → chạy đúng; (b) bảo agent *"dùng profile prod"* → **từ chối**, không im lặng đổi; (c) mỗi lệnh có đúng một dòng nhật ký; (d) ba phép đo giả định ở trên có số.

---

## Mốc 1 — Tài khoản · ~2 tuần

**Xong mốc này thì:** thêm/sửa/xoá/nhập tài khoản AWS ngay trong app, không phải mở terminal gõ `aws configure`.

| # | Việc | Cỡ |
|---|---|---|
| 1.1 | **Trình soạn INI phẫu thuật** — giữ comment, thứ tự khoá, khoá lạ; sao lưu 20 bản `~/.awog/aws-backups/`; ghi nguyên tử + `chmod 600`; verify đọc lại. **Test bảng bắt buộc** | L |
| 1.2 | Màn `/infra` → Tài khoản: danh sách nhóm theo kiểu · chi tiết · đặt mặc định · kiểm tra danh tính (`sts get-caller-identity`) | M |
| 1.3 | Thêm / sửa / nhân bản / xoá — form theo kiểu (static · SSO · assume-role; `process` chỉ đọc), validate, xác nhận nêu đang dùng ở đâu | M |
| 1.4 | Nhập: dán khối · file credentials/config · CSV của IAM — **màn xem trước** trước khi chạm đĩa | M |
| 1.5 | Nhập từ SSO: `sso login` → `list-accounts` + `list-account-roles` → tick hàng loạt | M |
| 1.6 | Xuất: cấu hình (không khoá) · kèm khoá có rào gõ-tên · sao chép lệnh `aws configure set` | S |
| 1.7 | **infosec audit #2** — lần đầu secret đi từ UI vào sidecar | M |

**Rủi ro chính:** 1.1 dễ bị xem nhẹ và dễ làm hỏng file của người dùng nhất. Làm trước, test trước.

---

## Mốc 2 — Logs & Tổng quan · ~3 tuần

**Xong mốc này thì:** dùng AWOG thay Console để soi log hằng ngày.

| # | Việc | Cỡ |
|---|---|---|
| 2.1 | Chọn nhiều log group (có pattern) · khoảng thời gian · chạy Insights (`start-query` → poll `get-query-results`) · huỷ | L |
| 2.2 | Bảng kết quả · JSON chi tiết · copy · gửi vào chat (qua redact) | M |
| 2.3 | Editor Monaco + **Monarch tokenizer** cú pháp Insights + gợi ý trường từ kết quả trước | M |
| 2.4 | Thư viện query: mẫu sẵn · đã lưu · lịch sử (2 tier `.awog`) | S |
| 2.5 | **Histogram SVG kéo-zoom** (chạy kèm `stats count(*) by bin(auto)`) | M |
| 2.6 | Ước lượng GB quét **trước khi chạy** + `bytesScanned` thật sau khi chạy + không bao giờ auto-run | M |
| 2.7 | Lọc nhanh tại chỗ · chip mức độ · facet theo trường (bấm giá trị ⇒ chèn `filter`) | M |
| 2.8 | Màn **Tổng quan**: 6 thẻ đèn + câu giải thích + chip câu hỏi gợi ý | M |
| 2.9 | Tool `logs_query` / `logs_tail_window` — popup duyệt kèm ước lượng GB | M |

---

## Mốc 3 — Explorer: khung + bốn màn đầu · ~3 tuần

**Xong mốc này thì:** thêm một dịch vụ mới = thêm một file mô tả, không đụng khung.

| # | Việc | Cỡ |
|---|---|---|
| 3.1 | Registry `ResourceView` + khung bảng dùng chung: tìm · lọc · phân trang theo token CLI · virtual scroll >200 · empty/error state · "nạp lúc HH:MM" | L |
| 3.2 | **Hai bộ cột** (`columns.simple` / `columns.full`) + công tắc Đơn giản/Chuyên sâu nhớ theo người dùng | M |
| 3.3 | **Dò quyền lúc mở màn ⇒ ẩn nút ghi** thay vì để bấm rồi nhận `AccessDenied` | M |
| 3.4 | Nút ⓘ (lý thuyết dịch vụ) · nút Console ↗ (deep link, **bọc SSO start-url**, dịch vụ toàn cầu không kèm region) · nút Hỏi agent | M |
| 3.5 | **Dock phiên thu nhỏ** — dùng lại `useMinimizeDock`, mang chip ngữ cảnh của đối tượng đang chọn | M |
| 3.6 | View **S3** (duyệt cây · xem file qua `usePreview()` · upload/tải/xoá · presign ≤15 phút, **không vào nhật ký**) | L |
| 3.7 | View **EC2** (bảng + start/stop/reboot/terminate gõ-tên + Kết nối SSM mở terminal) | M |
| 3.8 | Màn **Dịch vụ** (danh mục): hàng "đang dùng" · ba mức hỗ trợ · ghim đổi sidebar · tìm kiếm ⌘K | M |
| 3.9 | Màn **Nhật ký hoạt động**: bảng · lọc · chi tiết · ↗ nhảy về phiên · dọn có xác nhận · dòng ghi việc dọn · xuất CSV | M |
| 3.10 | Tool `infra_view` / `infra_action` + agent lái được màn đang mở | M |

---

## Mốc 4 — Delivery, API & CI/CD · ~2,5 tuần

| # | Việc | Cỡ |
|---|---|---|
| 4.1 | View **CloudFront** (+ tạo invalidation, lịch sử) · **API Gateway** · **Route53** · **ACM** (cảnh báo us-east-1) | L |
| 4.2 | CI/CD bảng xuyên nguồn — **GitHub Actions trước** (hạ tầng `gh` đã có) | M |
| 4.3 | Chi tiết lần chạy: cột bước · log từng bước stream · artifact · nối PR đã có trong app | M |
| 4.4 | Hành động: chạy lại · huỷ · kích hoạt · **duyệt bước thủ công** (cột production của ma trận) | M |
| 4.5 | Nối thông báo: pipeline hỏng vào hộp bell + toast đã có | S |
| 4.6 | Nguồn AWS: CodePipeline · CodeBuild · Amplify job | M |

---

## Mốc 5 — Graph & Playbook nền · ~3 tuần

| # | Việc | Cỡ |
|---|---|---|
| 5.1 | Khung graph (VueFlow + layout DAG sẵn có ở `useWorkflowGen.ts:60`) · node type theo dịch vụ | M |
| 5.2 | Resolver: Route53 → CloudFront → behavior → API GW → Lambda/ECS → RDS/SQS; cạnh suy luận vẽ **nét đứt** | L |
| 5.3 | Dựng dần (mỗi resolver xong là graph mọc thêm) + nút mở rộng từng node + giới hạn độ sâu 4 | M |
| 5.4 | Playbook: định dạng + runner (check/do/verify/rollback, trạng thái theo ngữ cảnh, popup) | L |
| 5.5 | Trang `/playbooks`: danh sách · chi tiết · **sơ đồ ba hàng** (bước → dịch vụ → ảnh hưởng lan từ graph) | L |
| 5.6 | Vòng đời + cửa duyệt + preflight + quay lui dựng ngược + **luật: thiếu rollback thì không gửi duyệt được** | M |
| 5.7 | Hai playbook hướng dẫn dựng sẵn: website tĩnh + teardown | M |

---

## Mốc 6 — Giám sát, Báo cáo & bộ xuất · ~3 tuần

| # | Việc | Cỡ |
|---|---|---|
| 6.1 | `MetricChart` SVG: đường · vùng · cột · lưới · nhãn trục · **lớp hover** (đường dóng + tooltip). Không thêm thư viện | L |
| 6.2 | `get-metric-data` theo lô + cache + không tự làm mới | M |
| 6.3 | Màn Giám sát: dải cảnh báo (biểu tượng + chữ) · ô số có mốc so sánh · lưới 4 biểu đồ · **dải sự cố tô trên cả bốn** · đồng bộ khoảng thời gian với Logs | L |
| 6.4 | Tạo/sửa cảnh báo từ chính biểu đồ (`put-metric-alarm`) + lịch sử alarm | M |
| 6.5 | **Bộ xuất dùng chung**: Markdown (Mermaid) · HTML một file không script (+ print → PDF) · **lớp che có xem trước** · chân trang ghi nguồn · mỗi lần xuất vào nhật ký | L |
| 6.6 | Báo cáo: 4 loại · lưu Wiki · gửi chat · đặt lịch qua **lịch chạy đã có** | M |
| 6.7 | Chia sẻ playbook: 3 mẫu theo người đọc (duyệt · runbook · sau khi chạy) | M |

---

## Mốc 7 — Chi phí, An toàn & CloudTrail · ~2,5 tuần

| # | Việc | Cỡ |
|---|---|---|
| 7.1 | Màn Chi phí: dự báo cuối tháng · top tăng · so kỳ trước (`ce get-cost-and-usage`, **cache theo ngày, chỉ chạy khi bấm**) | M |
| 7.2 | **Dò lãng phí**: EIP rỗi · EBS không attach · snapshot cũ · log group vô hạn · instance idle · NAT thừa · ALB không đích — mỗi phát hiện kèm số tiền | L |
| 7.3 | Nút **đưa vào playbook dọn dẹp** (nối thẳng vào mốc 5) | S |
| 7.4 | Ngân sách + cảnh báo ngưỡng (AWS Budgets) | M |
| 7.5 | **Rà soát an toàn**: ~25 kiểm tra read-only · chấm điểm · mức nghiêm trọng · cách sửa · gộp thành playbook khắc phục | L |
| 7.6 | **CloudTrail**: `lookup-events` ghép vào màn nhật ký, phân biệt **trong AWOG** / **ngoài AWOG**; tab "Lịch sử thay đổi" cho mỗi tài nguyên | M |
| 7.7 | **infosec audit #3** — trước khi mở rộng ra tài khoản production thật | M |

---

## Mốc 8 — Container, Kubernetes & phần còn lại · ~3,5 tuần

| # | Việc | Cỡ |
|---|---|---|
| 8.1 | View **ECS/Fargate** (scale · redeploy · quay bản · exec vào container) · **EKS** · **Lambda** · **Amplify** | L |
| 8.2 | View **CloudFormation** (resource · events · template Monaco · change set) · **VPC** (subnet · route · SG) | M |
| 8.3 | Parser `~/.kube/config` allowlist-key + ngữ cảnh kubectl trong chip | M |
| 8.4 | Màn **Kubernetes**: workloads · log viewer · **exec qua node-pty** · **port-forward panel** (khuôn `SshForwardPanel`) | L |
| 8.5 | Terraform: workspace + `plan -out` → `show -json` → **Plan viewer** bảng `+ ~ -` | L |
| 8.6 | Playbook nâng cao: sinh nháp từ `terraform plan`/change set; agent điền impact + rollback từ graph; hồ sơ sau khi chạy | L |
| 8.7 | Mức **Danh sách** hàng loạt: ~10 dịch vụ còn lại, mỗi cái một mô tả tối giản | M |

---

## Việc chạy suốt mọi mốc

| Hạng mục | Luật |
|---|---|
| **i18n** | Mỗi màn mới ⇒ key en/vi trong cùng PR. Không để "dịch sau" |
| **Đơn giản / Chuyên sâu** | Mỗi bảng mới ⇒ khai đủ **hai bộ cột** ngay từ đầu. Bù sau đắt gấp đôi |
| **Nhật ký** | Mỗi lệnh mới ⇒ tự động vào nhật ký vì ghi tại `infra.run`. **Không** ghi tại call site |
| **infosec** | Ba cửa bắt buộc: #1 cuối mốc 0 · #2 cuối mốc 1 · #3 cuối mốc 7 |
| **Kiểm tra** | `pnpm typecheck && pnpm lint` xanh trước khi báo xong; test bảng cho 0.2, 0.4, 1.1 |
| **Degrade** | Quyền hẹp ⇒ ẩn nút ghi · token hết hạn giữa chừng ⇒ park rồi chạy tiếp, không hỏng |

## Quyết định cần chốt trước khi code

| # | Câu hỏi | Chặn mốc |
|---|---|---|
| Q1 | Mức duyệt `auto` có được tồn tại không, hay chỉ `prompt`/`session`? | 0 |
| Q2 | `terraform plan` tính lớp **ghi** (giữ state lock) — đồng ý? | 0 |
| Q3 | Đánh dấu production theo **account id** (đề xuất) hay tên profile? | 0 |
| Q4 | App đã bật **X-Ray** chưa? Quyết định graph ra luồng request thật hay chỉ sức khoẻ node | 5 |
| Q5 | Hạ tầng hiện dựng bằng CloudFormation/Terraform hay bằng tay? Nếu bằng stack thì graph đi từ stack nhanh hơn nhiều | 5 |
| Q6 | Nhánh website động viết trước: Lambda/API Gateway hay Fargate/ALB? | 5 |

## Rủi ro

| Rủi ro | Dấu hiệu sớm | Cách xử |
|---|---|---|
| Shell-out quá chậm cho bảng lớn | Mốc 0: `describe-instances` 200 máy > 3 s | Cache + phân trang đẩy xuống CLI; cân nhắc SDK **chỉ cho view nặng**, ADR mới |
| Ma trận quyền gây phiền ⇒ bật bypass vĩnh viễn | Đếm số lần hỏi/ngày ở mốc 0 | Nới mặc định lớp đọc; giữ bypass **có hết hạn** làm van xả |
| Ghi hỏng `~/.aws` | Bất kỳ báo cáo mất profile nào | Sao lưu + verify đọc lại (1.1) là bắt buộc, không phải tuỳ chọn |
| Phạm vi phình theo từng mốc | Mốc trượt > 1 tuần | Cắt theo **mức Danh sách** thay vì bỏ cả dịch vụ |
| Chi phí API do chính app gây ra | Hoá đơn CloudWatch/Cost Explorer tăng | Không auto-refresh (đã là luật); hiện ước lượng trước khi chạy |

---

## Mốc 0 — trạng thái thực tế (cập nhật 2026-09-13)

**Đã land toàn bộ** 0.1 → 0.17 (kể cả 0.1b đường dẫn bảo lãnh). `pnpm typecheck` EXIT 0 cả hai package · 939 test sidecar xanh · `pnpm lint` ui-next sạch gồm guard design-token.

### Sáu bản vá sau infosec audit #1

| # | Lỗ | Vá |
|---|---|---|
| 1 | Tiền tố động từ (`get-`/`list-`) là **danh sách cấm trá hình**: `sts assume-role`, `s3api get-object <outfile>`, op mới của AWS đều tự động thành `read` ⇒ chạy không ai hỏi | `classify.ts` đảo sang **allowlist cặp `(service, operation)`**; op lạ ⇒ `write` |
| 2 | Chèn một cờ có giá trị làm lệch chỉ số positional ⇒ hạ `destructive` xuống `write` (trên production: **chặn → hỏi**) | Nhận diện phá huỷ quét **tham lam** mọi token không phải cờ; nhận diện đọc đòi **dạng chính tắc**. Hai chiều cố ý không đối xứng |
| 3 | `file://`/`fileb://` biến mọi lệnh `read` thành đọc file tuỳ ý rồi gửi đi | Có mặt chúng ⇒ nâng lớp khỏi `read` |
| 4 | AWS CLI cho **viết tắt cờ dài** (`--e` = `--endpoint-url`) ⇒ guard SSRF vô hiệu | `findForbiddenFlag` khớp **theo tiền tố**; thêm `findLeakyFlag` chặn `--debug` (in request đã ký + session token ra stderr) |
| 5 | `Bash(aws …)` bỏ qua ma trận ở `execute`/auto-approve và **không để lại dòng nhật ký** | Nhánh Bash-hạ-tầng đặt **trước** execute/auto-approve; chuỗi shell không đọc sạch ⇒ ép `write`. Thêm chặn cứng đường ghi vào `infra-policy.json` và `infra-audit/` |
| 6 | `infra.run` tin cờ `approved: boolean` **do renderer tự khai** | **Vé một-lần** do sidecar phát (`infra/approvals.ts`), gắn vân tay `(tool, args, context)`, TTL 5 phút, thử sai chỗ là cháy |

Kèm: `redactString` áp lên stdout/stderr **trước khi clamp** (cắt trước làm regex mất dấu token), và `accountId` được ghim sau khi xác minh danh tính — trước đó cột `production` của ma trận gần như luôn rỗng, tức hàng rào mạnh nhất đang ngủ.

### Còn nợ, chuyển sang mốc sau

- **QA trong Electron thật** — chưa ai thấy chip/popup/thẻ duyệt/watcher chạy. Mọi kiểm chứng tới giờ là unit test + probe biên dịch.
- **Ghi vào `~/.awog` vẫn trong tầm với của agent qua `Bash`** — bản vá #5 chặn theo chuỗi đường dẫn, là hàng rào độ sâu chứ không kín. Chốt thật: agent không nên có quyền ghi vào `~/.awog`.
- **`describeInfraCommand` là bản sao có chủ đích** của `withContext()` trong `run.ts` — gộp khi được phép chạm file đó.
- **`context.workspace` kẹp 500 ký tự**, dài hơn thì lượt ghi nhật ký ném và mất cả lệnh lẫn dấu vết.
