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
| 8.3 | ~~Parser `~/.kube/config` allowlist-key + ngữ cảnh kubectl trong chip~~ **đã code 2026-09-13** (`infra/kubectl/kubeconfig.ts` + `InfraKubectlChip.vue`; kèm `tf_cli`/`kubectl_cli` cho agent và chip Terraform — xem `session-infra-context.md` P1/P2) | M |
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

---

## Mốc 1 — trạng thái thực tế (cập nhật 2026-09-14)

**Đã land 1.1 → 1.6** (2026-09-13): trình soạn INI phẫu thuật + sao lưu/ghi nguyên tử/verify đọc lại · màn **Tài khoản** (danh sách nhóm theo kiểu · chi tiết · đặt mặc định · kiểm tra danh tính) · thêm/sửa/nhân bản/xoá theo kiểu form · nhập (dán khối · file credentials/config · CSV của IAM) **có màn xem trước** · nhập từ SSO · xuất cấu hình / kèm khoá có rào / sao chép lệnh `aws configure set`.

**Còn nợ:**

- **1.7 infosec audit #2 — chưa chạy.** [aws-profile-manager.md](aws-profile-manager.md) ghi nợ một lượt re-audit cho **A3/A5/A6** — ba đường ghi có secret (form static · nhập · nhập SSO). Đây là nợ đã biết, không phải việc bị bỏ quên.

**Bổ sung 2026-09-14** (yêu cầu người dùng, ngoài kế hoạch gốc): Region thành **dropdown** danh sách chuẩn + **tự dò khi ô trống** (region của chính profile → region đang ghim của app → profile `default`); thêm nút **Kiểm tra** chạy được **trước khi ghi** (khoá vừa gõ đi bằng env); ba ô secret **nạp giá trị thật** từ `~/.aws/credentials` khi mở form sửa. Chi tiết + ba điểm lệch: [aws-profile-manager.md](aws-profile-manager.md) §"Điểm lệch có chủ đích so với bản spec đầu".

## Mốc 2 — trạng thái thực tế (cập nhật 2026-09-14)

**Đã land 2.1 → 2.9.** Cửa vào: tab **Logs** và tab **Tổng quan** trong `/infra`.

| # | Việc | Trạng thái |
|---|---|---|
| 2.1 | Chọn nhiều nhóm log (+ pattern) · khoảng thời gian · `start-query` → poll → huỷ | xong — **nút Huỷ từng làm màn kẹt**, sửa 2026-09-14 (xem §"Huỷ kẹt") |
| 2.2 | Bảng kết quả · JSON chi tiết · copy · gửi vào chat | xong — "gửi vào chat" đi qua hộp chọn đích của mốc 3 |
| 2.3 | Monaco + Monarch tokenizer cú pháp Insights + gợi ý trường từ kết quả trước | xong — **kèm `⌘Enter` / `⌘.`** (nối 2026-09-14) |
| 2.4 | Thư viện câu lệnh: mẫu sẵn · đã lưu · lịch sử (2 tầng `.awog`) | xong |
| 2.5 | Histogram SVG **kéo-zoom** | xong |
| 2.6 | Ước lượng GB **trước khi chạy** + `bytesScanned` thật + không bao giờ auto-run | xong |
| 2.7 | Lọc nhanh tại chỗ · chip mức độ · facet bấm-để-chèn-`filter` | xong |
| 2.8 | Màn Tổng quan: 6 thẻ đèn + câu giải thích + chip hỏi agent | xong **một phần** — **2/6** thẻ có nguồn (Lỗi · Máy chủ), 4 thẻ còn lại chờ mốc 4/7 |
| 2.9 | Tool `logs_query` / `logs_tail_window` | xong |

### Điểm lệch của mốc 2

| Điểm | Kế hoạch | Thực tế | Vì sao |
|---|---|---|---|
| **4 trong 6 thẻ Tổng quan** | mỗi thẻ có đèn xanh/vàng/đỏ từ dữ liệu thật | hai thẻ có nguồn sống: **Lỗi 1 giờ qua** (Insights, hai bước Ước lượng → Chạy) và **Máy chủ** (`ec2 describe-instances`, nút *Đọc máy chủ EC2*, nối 2026-09-14). Bốn thẻ còn lại (Website · Chi phí · TLS · Deploy) hiện **đèn xám** + câu *"chưa đọc được…"* + chip hỏi agent | Nguồn của bốn thẻ kia nằm ở mốc 4/7 (CloudFront-Route53-ACM = 4.1, Amplify = 4.2–4.6, Cost Explorer = 7.1). Hiện đèn xanh cho một thứ chưa kiểm tra là **nói dối** — hỏng đúng chức năng của màn "có ổn không". Ghi lại để không ai đọc đèn xám thành đèn xanh |

**Thẻ Máy chủ — luật riêng của nó.** Nút *Đọc máy chủ EC2* là GỌI AWS thật (dùng credential), nên nó chỉ chạy sau cú bấm, không có `onMounted`/`watch` nào gọi hộ. Đổi profile/region thì `watch` **chỉ XOÁ** kết quả cũ, và một con dấu `serversEpoch` vứt câu trả lời của lượt đã cũ — không có con dấu đó, `describe-instances` (1–3 giây) đáp xuống sau khi `watch` đã dọn, tức đúng con số nói dối mà luật đầu file cấm. Đọc được thì thẻ nói đúng thứ EC2 vừa kể (tổng số máy, bao nhiêu `running`, tên máy không `running`), và còn `NextToken` thì nói rõ *"mới đọc một trang"* + hiện nút đọc tiếp — im lặng về chuyện đó là biến một trần 200 dòng thành một tổng. Lỗi quyền/CLI hiện **câu lỗi**, không bị nuốt thành "0 máy chủ".

**Thẻ Lỗi 1 giờ qua — cùng con dấu, siết thêm một bậc** (sửa 2026-09-14). Thẻ này chạy Insights hai bước (Ước lượng → Chạy) và **tính tiền mỗi request**, nên đổi profile/region giữa chừng không chỉ là chuyện hiển thị: vòng poll cũ hỏi tiếp bằng credential mới là một đường rò dữ liệu, còn câu trả lời cũ đáp xuống thẻ mới là con số nói dối. Nay `errorsEpoch` (song sinh với `serversEpoch`) + `activeCtx` (ảnh chụp ngữ cảnh lúc `start`) làm hai việc: (a) `watch([profile, region])` **huỷ query đang chạy** bằng chính ngữ cảnh cũ, và (b) cả vòng poll lẫn hàm huỷ đều dùng `activeCtx` đã đóng băng, còn `finally` chỉ ghi state khi `epoch` chưa đổi. Đo trên trình duyệt (engine giả): chạy query trên `prod-admin` rồi đổi sang `dev-sandbox` → `infra.logs-query-cancel` gửi đi với `{queryId, profile: prod-admin, region}` và **không còn một lượt `logs-query-status` nào**; thẻ về trạng thái chỉ-còn-ghi-chú với nút *Ước lượng*.

### Huỷ kẹt — lỗi thật của mốc 2, sửa 2026-09-14

Cả hai vòng poll (`useInfraLogs.poll`, và vòng của thẻ Lỗi trong `useInfraOverview`) đều chờ nhịp bằng `await new Promise(r => { timer = setTimeout(r, 1500) })`, còn hàm huỷ thì `clearTimeout(timer)`. **`clearTimeout` không đánh thức một Promise đang chờ** — nó bỏ mặc Promise đó treo vĩnh viễn. Dây hậu quả: `poll()` không bao giờ trả về → `run()` không bao giờ tới `finally` → `running` kẹt `true` → bấm Huỷ xong màn vẫn hiện *"Đang chạy…"* và **không chạy được câu nào nữa** cho tới khi rời tab. Lỗi chỉ lộ khi cú huỷ rơi đúng lúc vòng lặp đang đợi nhịp (là trạng thái chiếm phần lớn thời gian), nên nó không lộ ra ở test mock.

Sửa bằng cách giữ `resolve` của nhịp đang treo (`pollWake` / `timerWake`) và gọi nó trong hàm huỷ; thêm một nhịp kiểm tra `cancelled` sau `await` để vòng lặp thoát ngay thay vì hỏi thêm một lượt `get-query-results` sau khi người dùng đã bảo dừng. Đo lại trên trình duyệt (engine giả, 2026-09-14): `⌘Enter` → `estimate` + 2 × `query-start` (biểu đồ mật độ đang bật) → `⌘.` → `logs-query-cancel`, runbar về **"Chạy"**, nút bật lại, và chạy lại được lần thứ hai; thẻ Lỗi cũng từ **"Huỷ"** về **"Chạy (~0.0050 USD)"**. Cùng cách đo cho `⌘Enter`: hàng đang chọn **không** bị chèn dòng mới (Monaco mặc định bind `⌘Enter` = insert-line-after, nên nếu listener capture không thắng thì editor đã có thêm một dòng), và `⌘.` không rơi ký tự chấm vào editor.

## Mốc 3 — trạng thái thực tế (cập nhật 2026-09-14)

**Đã land 3.1 → 3.10.** Cửa vào: tab **Dịch vụ** (danh mục 3.8 + bảng tài nguyên 3.1–3.7 — gộp làm một sau phản hồi người dùng 2026-09-14) · **Nhật ký** (3.9) trong `/infra`. Chi tiết từng việc: [infra-explorer.md](infra-explorer.md) §"Trạng thái thực tế (Mốc 3)" và [infra-audit-log.md](infra-audit-log.md) §"Trạng thái thực tế".

### Ba điểm lệch của mốc 3

| # | Kế hoạch | Thực tế | Vì sao |
|---|---|---|---|
| 3.7 | EC2 + **Kết nối SSM mở terminal** | **chưa làm** phần SSM; vẫn còn nút Console ↗ | `session start-session` cần đường PTY + một đích terminal trong tab — việc của khung PTY (E7/E8), không nên nhét vào bảng EC2 |
| 3.8 | hàng **"đang dùng"** lấy từ Cost Explorer + tagging API | "đang dùng" = service của view **đang có dòng** | `ce get-cost-and-usage` **tính tiền mỗi request** ⇒ thuộc việc 7.1 của mốc 7. Không bịa số |
| 3.1 | tìm kiếm đẩy xuống CLI khi service hỗ trợ filter | lọc tại client trên số dòng **ĐÃ NẠP**, có nhãn nói rõ điều đó | Cờ `--filters` khác nhau theo từng service; ô tìm kiếm giả vờ đẩy xuống CLI là hứa điều khung bảng không giữ được |

### Việc ngoài kế hoạch — bong bóng phiên (bổ sung 2026-09-14)

Người dùng yêu cầu thêm một **phiên thu nhỏ ở góc phải màn hình**: thư mục tương tác riêng `awog-infra`, "Mở full" điều hướng **về phiên** (không phải `/infra`), mọi nút "Hỏi agent" có hai lựa chọn (phiên hiện tại / phiên mới), và trong bong bóng xem được **toàn bộ danh sách phiên**. Đặc tả: [infra-bubble-session.md](infra-bubble-session.md).

### Việc ngoài kế hoạch — thanh ngữ cảnh + cột trái đầy đủ (bổ sung 2026-09-14)

Ba yêu cầu từ ảnh chụp của người dùng: bỏ dải rỗng khi thu gọn cột dịch vụ · **đưa ô chọn tài khoản lên hàng tab** và bắt dịch vụ đọc theo tài khoản đó · cột trái hiện **cả danh mục**, chia nhóm gập được (trước chỉ có danh sách ghim). Đây là việc **nằm trong spec** — [infra-explorer.md](infra-explorer.md) §"Bố cục màn hình" vốn đã chốt "thanh ngữ cảnh đầu trang là control DUY NHẤT chọn tài khoản" — nhưng chưa ai làm ở mốc 3. Chi tiết + số đo: cùng file, §"Ba sửa đổi theo ảnh chụp thứ tư (2026-09-14)".

**Còn thiếu ở thanh này:** `cluster` (giữ ở tab Kubernetes) và nhãn cảnh báo cho tài khoản production (cần `accountKindOf()` của sidecar theo từng lời gọi).

### Việc ngoài kế hoạch — mở rộng danh mục 39 → 102 dịch vụ (bổ sung 2026-09-14)

Người dùng: *"phần dịch vụ tôi thấy vẫn thiếu nhiều dịch vụ như valkey?"* rồi *"tôi nghĩ cứ thêm hết đi cho phong phú"*. Valkey hoá ra không phải dịch vụ thiếu — nó là engine của ElastiCache/MemoryDB, nên câu mô tả của thẻ ElastiCache mới là chỗ sai (nay kể đủ Redis/Valkey/Memcached); phần "thiếu dịch vụ" thì đúng. Danh mục nay có **102 dịch vụ + Kubernetes**, thêm **nhóm thứ 11 "Dữ liệu & AI"**, mọi thẻ Console đều có deep link đã kiểm bằng HTTP (200/302 so với 404). Hai lỗi phát hiện dọc đường: thẻ CloudFormation in ra khoá i18n thô (`about.cfn` lệch với service id) và một dịch vụ mức Console có thể bị thêm mà thiếu dòng `svcConsole` (nay có test khoá lại). Số đo + cách kiểm slug: [infra-explorer.md](infra-explorer.md) §"Mở rộng danh mục 39 → 102 dịch vụ (2026-09-14)".

### Còn nợ chung của mốc 1–3

- **QA trong Electron thật** — cả ba mốc mới có unit test + `typecheck` + `lint`; **chưa ai bấm thử trong app**. Mọi tuyên bố "xanh" ở trên là xanh của cổng tĩnh.
- **infosec audit #2** (nợ từ mốc 1, xem trên).
- **Nhật ký N4/N5** — tool `audit_query`/`audit_summary` cho agent và dòng thời gian sự cố.
- **Nhật ký: tự hết hạn** — `pruneExpired()` có trong store nhưng **chưa ai gọi**; chưa có khoá Settings 30/90/365/vĩnh viễn.
- **Nhật ký: nút "Hỏi agent" / "Chạy lại" trên từng dòng** — mới có ↗ nhảy về phiên.
- **4/6 thẻ Tổng quan** chưa có nguồn dữ liệu (xem mốc 2 — hai thẻ có nguồn là *Lỗi 1 giờ qua* và *Máy chủ*).

## Mốc 4 — trạng thái thực tế (cập nhật 2026-09-14)

**Đã land 4.1 → 4.6.** Cửa vào: tab **Triển khai** trong `/infra` (4.1 còn thêm sáu view vào tab **Dịch vụ**). Chi tiết kiến trúc + luật đã cài trong code: [infra-cicd.md](infra-cicd.md) §"Trạng thái thực tế".

| # | Việc | Trạng thái |
|---|---|---|
| 4.1 | CloudFront (+ tạo invalidation, lịch sử) · API Gateway · Route53 · ACM | xong |
| 4.2 | Bảng xuyên nguồn, **GitHub Actions trước** | xong |
| 4.3 | Chi tiết lần chạy: cột bước · log từng bước · artifact · nối PR đã có | xong — log CodeBuild **gieo sang tab Logs** thay vì dựng viewer thứ hai |
| 4.4 | Chạy lại · huỷ · kích hoạt · **duyệt bước thủ công** | xong — mọi thao tác ghi đi qua `runGated()` + vào nhật ký |
| 4.5 | Nối thông báo vào hộp bell + toast | xong — **nguồn mặc định TẮT**, bật ở Settings → Thông báo |
| 4.6 | Nguồn AWS: CodePipeline · CodeBuild · Amplify job | xong |

### Bốn điểm lệch có chủ đích

| Điểm | Kế hoạch / mặc định | Thực tế | Vì sao |
|---|---|---|---|
| **4.5 bật/tắt** | thông báo đi vào hộp bell + toast như mọi nguồn khác | công tắc riêng `notifications.cicdEvents`, **mặc định tắt**, nhịp **sàn 5 phút**, lượt poll đầu im lặng để dựng mốc | một lượt kiểm tra là **nhiều tiến trình `aws` cộng một `gh run list` mỗi dự án**; chạy nền mặc định chính là thứ mà luật "không auto-refresh" của màn này cấm |
| **Log từng bước của CodeBuild** | 4.3: "log từng bước stream" | bấm bước ⇒ **gieo log group sang tab Logs** (viewer đã có, đã redact), không dựng viewer thứ hai | log của CodeBuild nằm ở CloudWatch Logs; AWOG không có lý do đọc nó bằng đường thứ hai |
| **Xem secret của pipeline** | bảng hành động ghi "xem biến môi trường / secret — lớp đọc" | chỉ **TÊN**; `codebuild: batch-get-builds` bị xếp vào `AWS_SENSITIVE_READ_OPS` (production ⇒ phải có người duyệt) | payload trả về **VALUE** của biến `PLAINTEXT`; nới từ tên sang giá trị là một quyết định, không phải một lần sửa nhỏ |
| **Kích hoạt chạy mới trên AWS** | "`gh workflow run` với input; Amplify `start-job`" | form workflow + git ref **chỉ có ở GitHub**; CodePipeline/CodeBuild/Amplify bấm là chạy | pipeline/build/app đã nằm trong `ref` của dòng — thêm ô nhập nữa là thêm chỗ để gõ sai một thứ AWS đã biết |

### Còn nợ của mốc 4

- **QA trong Electron thật** — như mốc 1–3: cổng đã xanh là `vitest` (sidecar, 719 test của `src/infra`) · `pnpm typecheck` · `pnpm lint` (cả hai app).
- **Credential AWS thật** — CLI trên máy dev trả `ExpiredToken` ⇒ mọi đường AWS của mốc 4 mới được kiểm bằng JSON mẫu.
- **`gh` đã đăng nhập** — các đường GitHub Actions của mốc 4 chưa chạy thật lần nào.
- **Tài khoản production** — nhánh "đọc bị siết nhịp ⇒ hiện `blocked` + xin vé ⇒ gọi lại kèm vé" mới có test đơn vị, chưa gặp cổng thật.
- **Agent chạy lại pipeline** (vế hai của C5) — `runtime/tools/infra-tools.ts` chưa có tool nào chạm tới màn này; nút *Hỏi agent* mới đẩy log vào phiên.
- **`infosec audit #2`** vẫn treo từ mốc 1 (xem trên).

---

## Mốc 5 — trạng thái thực tế (cập nhật 2026-09-15)

**Đã land 5.1 → 5.7**, nhưng **5.2 và 5.3 không đủ như bảng kế hoạch mô tả** (xem hai dòng đầu bảng lệch). Cửa vào: tab **Topology** trong `/infra` + trang riêng `/playbooks`. Thiết kế: [infra-topology-graph.md](infra-topology-graph.md) · [playbooks.md](playbooks.md) · [aws-website-playbook.md](aws-website-playbook.md).

| # | Việc | Trạng thái |
|---|---|---|
| 5.1 | Khung graph (VueFlow + layout DAG) · node type theo dịch vụ | xong — hai điểm lệch nhỏ về *cách* dùng lại, xem bảng dưới |
| 5.2 | Resolver Route53 → CloudFront → behavior → API GW → Lambda/ECS → RDS/SQS · cạnh suy luận **nét đứt** | **một phần** — 5 resolver; `rds`·`sqs`·`s3`·`elb` là **lá**, có mặt làm node nhưng không mở rộng. Nét đứt: xong (`InfraGraphEdge.vue` `border-style: dashed` + nhãn nói rõ "suy luận") |
| 5.3 | Dựng dần + nút mở rộng từng node + giới hạn độ sâu 4 | **hai trong ba** — `graph-expand` từng node xong; `INFRA_GRAPH_MAX_DEPTH = 4` xong; **"dựng dần" thì không** |
| 5.4 | Playbook: định dạng + runner (check/do/verify/rollback · trạng thái theo ngữ cảnh · popup) | xong — 4 verb, 8 trạng thái, **mọi bước ghi qua `runGated` với `actor: playbook:<id>#<bước>`** |
| 5.5 | Trang `/playbooks`: danh sách · chi tiết · sơ đồ ba hàng | xong — hàng 3 lấy từ graph thật, và **nói ra khi chưa có graph** thay vì vẽ bừa |
| 5.6 | Vòng đời · cửa duyệt · preflight · quay lui dựng ngược · luật thiếu rollback thì không gửi duyệt được | xong — luật cưỡng chế ở `submit` (`canSubmit`), **không phải gợi ý ở UI** |
| 5.7 | Hai playbook hướng dẫn dựng sẵn | xong — `static-site` + `teardown`, cả hai `kind: 'instruction'` |

Kho playbook là **Markdown + frontmatter** 2 tier (`~/.awog/playbooks/<id>.md` + `{project}/.awog/playbooks/`), không phải JSON: một playbook là thứ người ta **đọc**, commit vào repo và dán vào issue. Phần máy đọc nằm trong một khối ` ```json ` ở thân file. `id` suy từ tên file, `tier` suy từ thư mục — cùng luật với wiki.

### Sáu điểm lệch có chủ đích

| Điểm | Kế hoạch / mặc định | Thực tế | Vì sao |
|---|---|---|---|
| **Chuỗi resolver (5.2)** | "… → Lambda/ECS → **RDS/SQS**" | resolver dừng ở `lambda`/`ecs`; `rds`·`sqs`·`s3`·`elb` **có mặt làm node** (suy từ env/config của Lambda/ECS) nhưng `hasGraphResolver` trả `false` ⇒ không mở rộng được | chúng là **lá của graph hôm nay**: một hàng đợi SQS hay một instance RDS không dẫn tiếp đi đâu trong mô hình "luồng request". Ghi thẳng trong mã, không phải bỏ sót |
| **Dựng dần (5.3)** | "mỗi resolver xong là graph mọc thêm" | `infra.graph-resolve` chạy BFS **trong sidecar** rồi trả **cả graph trong một lượt**; không có event tiến độ nào | phần "mọc thêm" mà người dùng thật sự dùng là `graph-expand` **theo node**. Streaming tiến độ cho một lượt dựng cần một kênh event mới cho đúng một màn — chưa đổi lấy gì |
| **Bố cục DAG (5.1)** | "layout DAG sẵn có ở `useWorkflowGen.ts:60`" | **chép lại thuật toán** (x theo rank đường-dài-nhất, y theo thứ tự trong rank) vào `useInfraGraph.ts` | hàm `layout()` gốc là hàm **cục bộ không export**. Chép ~40 dòng thuần rẻ hơn thêm `dagre`/`elkjs`, và rẻ hơn mở API của một composable khác chỉ để lấy một hàm |
| **Node type theo dịch vụ (5.1)** | mỗi dịch vụ một node type | **hai** node type VueFlow (`service`, `external`) cùng trỏ **một** component `InfraGraphNode.vue`; dịch vụ phân biệt bằng **dữ liệu** (`node.service`) | thêm một dịch vụ thì chỉ thêm màu + biểu tượng, không phải thêm một component và một dòng đăng ký |
| **Hàng "ảnh hưởng lan" (5.5)** | suy từ graph kiến trúc | cần graph **đã dựng**; chưa có thì hàng 3 hiện **bốn trạng thái riêng** (đang nạp · không khả dụng · lỗi · chưa dựng) kèm nút sang tab Topology | hàng này là thứ người duyệt nhìn để quyết định. Vẽ một hàng trống trông giống "không ảnh hưởng gì", mà đó là câu trả lời sai và nguy hiểm |
| **Đóng băng hồ sơ chạy** (ngoài kế hoạch) | — | tới trạng thái cuối (`done`/`rolled-back`), bản ghi ghi thêm **một trang Wiki** (`mode: 'create'` ⇒ trùng đường dẫn là LỖI) và từ đó `persistRun` **từ chối mọi lần ghi** | "đã chạy cái gì, ai duyệt, bản nào" phải trả lời được sau đó. Bản ghi chạy cũng **chụp lại playbook lúc gửi duyệt**, nên sửa file sau khi duyệt không đổi thứ đã duyệt |

### Còn nợ của mốc 5

- **Không soạn được playbook trong app.** `infra.playbook-save` / `-delete` có ở sidecar và đã bọc trong `usePlaybooksApi`, nhưng **không component nào gọi** — thêm một playbook nghĩa là đặt file tay vào `~/.awog/playbooks/`. Trang `/playbooks` hiện là đọc · chạy · chia sẻ.
- **`kind: 'deployment'` chưa có bản nào.** Hai builtin đều `instruction`; nhóm "deployment" của danh sách rỗng cho tới khi có người đặt file tay. Đường chạy thì đã có sẵn cho cả hai loại.
- **QA trong Electron thật** — cổng đã xanh là `vitest` (**95 test / 6 file** cho `graph` + `playbook`; 989 test cho cả `src/infra`) · `pnpm typecheck` · `pnpm lint`. Chưa màn nào được bấm trong app đóng gói.
- **Credential AWS thật** — năm resolver mới kiểm bằng JSON mẫu; chưa lần nào dựng graph từ một tài khoản sống, nên chưa biết hình dạng thật ở độ sâu 4 có đọc được không.
- **Chưa chạy playbook `do` nào thật** — `runGated` · preflight · quay lui dựng ngược mới có test đơn vị. Đường quay lui đặc biệt: nó chỉ được thử ở nơi **không có gì để mất**.
- **Agent chưa chạm graph lẫn playbook** — `runtime/tools/infra-tools.ts` không có tool nào đọc graph hay chạy playbook.
- **`infosec audit #2`** — playbook là đường **chạy lệnh ghi theo kịch bản**; runner đã bắt buộc `runGated` + `actor` + nhật ký (ghi rõ "không phải đường vòng để bỏ qua ma trận quyền"), nhưng chính câu đó là thứ cần người thứ hai kiểm.

---

## Mốc 6 — trạng thái thực tế (cập nhật 2026-09-15)

**Đã land 6.1 → 6.7**, cộng **M4** của [infra-monitoring-reports.md](infra-monitoring-reports.md) §Lộ trình — hạng mục này có trong spec nhưng **không có dòng tương ứng trong bảng 6.x ở trên**, nên đây là việc ngoài kế hoạch của mốc, không phải một dòng bị bỏ sót.

Cửa vào: ba tab mới trong `/infra` — **Giám sát** · **Bảng điều khiển** · **Báo cáo** (tổng 11 tab) — cộng hộp xuất dùng chung mở được từ `/playbooks` và từ transcript phiên. Chi tiết thiết kế: [infra-monitoring-reports.md](infra-monitoring-reports.md).

| # | Việc | Trạng thái |
|---|---|---|
| 6.1 | `MetricChart` SVG (đường · vùng · cột · lưới · nhãn trục · lớp hover) | xong — không thêm thư viện vẽ nào |
| 6.2 | `get-metric-data` theo lô + cache + không tự làm mới | xong — cache theo `(profile, region, cửa sổ, query)`, TTL 10 phút, 64 entry; **không `onMounted`/`watch`/hẹn giờ nào gọi metric** |
| 6.3 | Màn Giám sát: dải cảnh báo · ô số có mốc so sánh · lưới 4 biểu đồ · dải sự cố · đồng bộ khoảng với Logs | xong — đồng bộ hai chiều qua `useInfraWindowSync` |
| 6.4 | Tạo/sửa cảnh báo từ chính biểu đồ + lịch sử alarm | xong — `put-metric-alarm` đi qua ma trận quyền; `describe-alarm-history` là đọc |
| 6.5 | Bộ xuất dùng chung: Markdown · HTML một file không script · lớp che có xem trước · chân trang ghi nguồn · vào nhật ký | xong — xem bốn điểm lệch bên dưới |
| 6.6 | Báo cáo: 4 loại · lưu Wiki · gửi chat · đặt lịch qua lịch chạy có sẵn | xong — 4 loại ở `REPORT_KINDS`; **chỉ `health-weekly` đặt lịch được** (xem bảng lệch) |
| 6.7 | Chia sẻ playbook: 3 mẫu theo người đọc | xong — `SHARE_AUDIENCES = approval · runbook · post-run`; mẫu `approval` **ép bật lớp che** |
| M4 | Bảng điều khiển tự lắp + 3 mẫu dựng sẵn | xong — tab **Bảng điều khiển**; ba bảng `website` · `api` · `cost` đúng tên spec; kho 2 tier `~/.awog/dashboards/<id>.json` + `{project}/.awog/dashboards/` |

### Hai lỗ bịt ngày 2026-09-15

Cả hai là **đường nối thiếu**, không phải tính năng thiếu — mã hai đầu đã có từ trước, chỉ không ai gọi.

| Lỗ | Triệu chứng | Bịt bằng |
|---|---|---|
| **6.6 — báo cáo agent viết không vào được hộp xuất** | `buildReportShare` đã viết xong ở `share/templates.ts` và đường `kind: 'report'` của `useShareExport` đã đủ (lưu Wiki · gửi chat), nhưng `openShare` chỉ có **hai** caller, cả hai ở `/playbooks` | một hành động overflow trên message của trợ lý → `InfraReportPublishDialog` hỏi **loại** báo cáo → giao subject cho hộp xuất đã có. Loại không đoán được từ văn bản: nó quyết định thư mục Wiki và dòng nguồn |
| **M4 — bảng điều khiển chưa tồn tại** | spec có, mã không | sidecar `infra/dashboard/{schema,builtin,store}.ts` + 4 RPC `infra.dashboard-*`; UI tab mới + `useInfraDashboards` + hộp ghim mở từ chip ghim trên `MetricChart` |

### Sáu điểm lệch có chủ đích

| Điểm | Kế hoạch / mặc định | Thực tế | Vì sao |
|---|---|---|---|
| **Đặt lịch báo cáo (6.6)** | cả 4 loại đặt lịch qua lịch chạy có sẵn | **chỉ `health-weekly`**; ba loại còn lại tắt nút và nói ra lý do qua `scheduleGapKey` | lịch chạy chỉ có nhịp ≤ 7 ngày · daily · weekly ⇒ `cost-monthly` **không biểu diễn được**; `activity`/`incident` thì cố ý chạy tay. Một nút bấm vào chỉ để nghe lại câu đang đọc là nhiễu |
| **PDF (6.5)** | "HTML một file không script (+ print → PDF)" | không thêm thư viện PDF nào; `@media print` nằm **trong chính tệp HTML xuất ra** (`share/kit.ts`), Ctrl+P trên tệp đã lưu | spec nói rõ "không thêm thư viện PDF"; trình duyệt đã có sẵn đường in |
| **Lớp che (6.5)** | "đi qua `redact.ts` trước khi ghi" | **hai lớp NỐI TIẾP**, không thay thế: `redact.ts` hỏi *"có phải bí mật không?"*, `share/mask.ts` hỏi *"có phải định danh hạ tầng không?"* (account id · ARN · endpoint nội bộ · tên bucket) | gộp làm một là tự tạo định nghĩa thứ hai về "bí mật". Hai công tắc riêng vì tên bucket "nhiều khi chính là thứ cần bàn" |
| **AWOG không tự viết báo cáo** | màn Báo cáo = nơi tạo báo cáo | màn Báo cáo chỉ là **danh mục 4 loại**; nút chính mở một phiên với đúng câu lệnh của loại đó, **agent** đọc dữ liệu thật rồi viết | không có ô xem trước và không có nút xuất, vì thứ để xuất chưa tồn tại cho tới khi agent viết xong. Đó cũng là lý do transcript phải là điểm nối của 6.6 |
| **`unit` của bảng điều khiển không lên dây (M4)** | — | bảng gửi query **không kèm `Unit`** | `unit` trong file là **nhãn hiển thị**, còn `Unit` gửi CloudWatch là **ràng buộc lọc**: lệch một chữ thì `get-metric-data` trả RỖNG *không báo lỗi*. Màn Giám sát gửi được vì ở đó `unit` là hằng của bộ spec; ở bảng nó là dữ liệu người dùng sửa tay |
| **Nhật ký có surface riêng `dashboards` (M4)** | dùng lại `explorer` | thêm một giá trị vào `INFRA_SURFACES` | lượt nạp của bảng là một lô metric **trả tiền**; sổ kiểm toán phải trả lời được "lượt đó do màn nào bấm" |

### Còn nợ của mốc 6

- **QA trong Electron thật** — cổng đã xanh là `vitest` (sidecar, **989 test / 43 file** của `src/infra`) · `pnpm typecheck` (cả hai app) · `pnpm lint` + guard design-token. Chưa màn nào của mốc 6 được bấm trong app đóng gói.
- **Credential AWS thật** — vẫn như mốc 4: mọi đường `get-metric-data` · `describe-alarms` · `put-metric-alarm` mới kiểm bằng JSON mẫu.
- **Mẫu Chi phí chưa đo được** — `AWS/Billing` chỉ có metric khi tài khoản **đã bật billing alerts**, và chỉ phát ở `us-east-1`. Chưa bật thì bảng vẽ trắng; nhãn "không có dữ liệu" của nhánh đó chưa xác nhận trên tài khoản thật.
- **Bảng trộn vùng phải gọi nhiều lượt** — `region` đi trong `context` của lời gọi chứ không phải của từng query. Ba bảng dựng sẵn đều đơn vùng nên hiện tại luôn đúng một lượt; bảng người dùng tự trộn vùng thì tách lượt, chưa đo chi phí thực tế của trường hợp đó.
- **Agent chưa chạm bảng điều khiển** — `runtime/tools/infra-tools.ts` không có tool nào đọc/ghi bảng; agent chỉ tới được số liệu qua màn Giám sát.
- **`infosec audit #2`** vẫn treo từ mốc 1. Mốc 6 thêm bốn bề mặt cần soi: lớp che (`share/mask.ts`) là hàng rào **duy nhất** trước khi nội dung rời máy; `put-metric-alarm` là lệnh ghi đổi hành vi tài khoản; kho bảng 2 tier ghi file theo `id` từ UI (`store.ts` đã chặn thoát thư mục + symlink, cần soi lại); báo cáo lưu Wiki là **dữ liệu sẽ vào context của LLM**.
