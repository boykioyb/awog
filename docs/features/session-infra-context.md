# Feature — Ngữ cảnh hạ tầng trong phiên (AWS · Terraform · kubectl)

- **Trạng thái:** Planned — chưa code
- **ADR:** [0088 — ngữ cảnh hạ tầng ghim theo phiên](../decisions/0088-session-infra-context.md)
- **Bề mặt chính:** chip trong `SessionContextStrip` + tool `aws_cli` / `tf_cli` / `kubectl_cli` cho agent + 3 panel trong Workspace Panel
- **Màn hình quản lý:** [infra-explorer.md](infra-explorer.md) — trang `/infra` (S3 · CloudWatch · EC2 · ECS/Fargate · EKS · Amplify · Kubernetes). Doc này là **nền** của nó.
- **Liên quan:** [ADR 0064](../decisions/0064-session-ssh-link.md) (Session↔SSH — khuôn mẫu gần nhất), [session-ui-refactor](session-ui-refactor.md) §3.2, [ADR 0080](../decisions/0080-command-scoped-permission-rules.md), [ADR 0070](../decisions/0070-share-claude-home-for-config.md), [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md) (PTY), [security.md](../../.claude/rules/security.md)

## Một câu

Phiên chat chỉ định **profile AWS / thư mục + workspace Terraform / context + namespace kubectl**, rồi cả người lẫn agent làm việc với đúng cái đã chỉ định — không trôi sang account khác, không tự chạy lệnh ghi.

## Danh mục tính năng (làm được gì)

### AWS — P0

| Người dùng làm được | Cơ chế |
|---|---|
| Chọn profile + region cho phiên; nhìn chip là biết đang trỏ vào account nào | chip `⛅ Offshore-Developer · ap-southeast-1 · hỏi` trong context strip |
| Hỏi agent *"có bucket nào"*, *"instance nào đang chạy"*, *"log group X 30 phút qua nói gì"*, *"policy này cho phép gì"* | tool `aws_cli` với động từ đọc (`describe-*`/`list-*`/`get-*`/`ls`) |
| Xác nhận danh tính trước khi làm gì: account id · arn · alias | nút **Kiểm tra danh tính** trong popover + tool `aws_whoami` |
| Mở terminal trong phiên và gõ `aws …` mà không cần `--profile` | tiêm `AWS_PROFILE`/`AWS_REGION` vào PTY của phiên |
| Yên tâm agent **không thể** lén đổi account | `aws_cli` từ chối `--profile`/`--region`/`--endpoint-url` trong args |
| Biết token SSO còn hạn bao lâu, đăng nhập lại | đọc `~/.aws/sso/cache` (chỉ `expiresAt`) + nút điền sẵn `aws sso login` (P3) |

### Terraform — P1

| Người dùng làm được | Cơ chế |
|---|---|
| Chọn thư mục `.tf` + workspace cho phiên; chip `▲ infra/prod · default` | quét `*.tf` ≤ 2 cấp trong project (khuôn `git.discoverRepos`) + `terraform workspace list` |
| Biết **state nằm ở đâu** trước khi động vào | đọc block `backend` + `.terraform/terraform.tfstate` (chỉ metadata, không giá trị) |
| Bấm **Plan** và đọc kết quả như đọc diff: bảng resource với `+ tạo · ~ sửa · - xoá`, đếm tổng, lọc theo loại | `terraform plan -out=…` rồi `terraform show -json` → parse `resource_changes` → render trong tab **Plan** của Workspace Panel |
| Hỏi agent *"cái gì sắp bị xoá"*, *"vì sao resource này thay đổi"*, *"plan này có phá downtime không"* — agent đọc **plan đã chạy**, không tự chạy lại | tóm tắt JSON của plan đưa vào context phiên |
| Cho agent chạy `validate` / `fmt -check` / `state list` / `state show` / `output` | `tf_cli` allowlist đọc |
| `init` (ghi backend) và `plan` (giữ lock) → **duyệt từng lần**, prompt nói rõ thư mục + workspace + backend | gate `infraApprovalMode` |
| `apply` / `destroy` / `state rm` / `import` → **AWOG không chạy**. Chỉ hiện lệnh chính xác + nút mở terminal điền sẵn, người dùng tự Enter | luật cứng, không có cờ tắt |

### kubectl — P2

| Người dùng làm được | Cơ chế |
|---|---|
| Chọn context + namespace cho phiên; chip `⎈ prod-eks · default` | đọc `~/.kube/config` (chỉ tên context/cluster/namespace — không đọc token/cert) |
| Hỏi agent *"pod nào đang CrashLoop"*, *"describe deploy X"*, *"event 10 phút qua"*, *"node nào hết RAM"* | `kubectl_cli` động từ đọc (`get`/`describe`/`logs`/`events`/`top`/`explain`) |
| **Xem log pod ngay trong panel**, tail theo thời gian thực, nhiều container | tab **Logs** trong Workspace Panel, stream `kubectl logs -f` |
| **Exec vào pod** như một terminal thật | `kubectl exec -it` qua node-pty — cắm vào hạ tầng PTY sẵn có ([ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)) |
| **Port-forward** bật/tắt bằng panel, thấy cổng nào đang mở | `kubectl port-forward`, tái dùng khuôn [SshForwardPanel.vue](../../apps/desktop/ui-next/components/ssh/SshForwardPanel.vue) |
| `apply` / `scale` / `rollout restart` / `delete` → duyệt từng lần; ở context đánh dấu production, `delete`/`drain` bắt **gõ lại tên context** mới cho chạy | gate + xác nhận kiểu "gõ tên để xoá" |
| Nối AWS ↔ EKS: từ profile AWS sinh/cập nhật kubeconfig | `aws eks update-kubeconfig` (lệnh ghi ⇒ duyệt) |

### Chung cả ba

- Một chip mỗi công cụ trong context strip, **không có chip nào thì không mất pixel nào**.
- Prompt duyệt hiện **dòng lệnh đầy đủ + ngữ cảnh đang ghim** (profile/account, thư mục/workspace, context/namespace) — không phải một chữ "cho phép kubectl".
- `<infra_context>` mỗi lượt: agent biết nó đang ở account/cluster/workspace nào và phải nêu ra trước khi đề xuất.

## Ngữ cảnh là của không gian làm việc, không phải của riêng màn chat

**Một ngữ cảnh hiệu lực tại một thời điểm**, hiện ở mọi bề mặt qua cùng một control: thanh ngữ cảnh đầu trang `/infra`, chip trong phiên, chip trên status bar, env của terminal. **Không view nào có picker account riêng** — có picker riêng là có cách để hai bảng cạnh nhau nói về hai account khác nhau mà không ai nhận ra.

| Tầng | Ai đặt | Ghi chú |
|---|---|---|
| Phiên | chip context strip | Thắng khi đang ở trong phiên; đóng băng lúc tạo phiên |
| Project | Projects / quick-view | Mặc định cho phiên và cho `/infra` khi đang mở project đó |
| Toàn app | Settings → Hạ tầng · thanh `/infra` | Mặc định cuối |

Đổi ngữ cảnh ⇒ **vô hiệu toàn bộ cache view và nạp lại**; mỗi bảng ghi rõ account + thời điểm nạp. Account đánh dấu production làm thanh ngữ cảnh đổi màu ở mọi màn.

## Cổng quyền = một ma trận, không phải một công tắc

Bốn lớp lệnh × hai loại account × ba chế độ. Đây là **quyết định của người sở hữu account**, nên nó nằm ở Settings chứ không khoá cứng trong mã.

| Lớp lệnh | Account thường | Account production |
|---|---|---|
| **Đọc** — `describe`/`list`/`get`/`logs` | Tự động | Tự động |
| **Ghi** — `create`/`update`/`scale`/`deploy`/`plan` | Hỏi | Hỏi |
| **Phá huỷ** — `delete`/`terminate`/`destroy`/`drain` | Hỏi | **Chặn** |
| **Đổi ngữ cảnh** — agent tự chuyển account/cluster | Tự động | Hỏi |

Ba chế độ: **Tự động** (chạy thẳng) · **Hỏi** (park chờ người duyệt) · **Chặn** (hiện lệnh để người tự chạy). Bảng trên là mặc định xuất xưởng, đổi được từng ô.

Ba tính chất bắt buộc của bypass (chi tiết ở [ADR 0088 §5](../decisions/0088-session-infra-context.md)):

1. **Nhìn thấy** — bypass bật thì chip nhuộm cảnh báo ở mọi bề mặt; mỗi lệnh tự động chạy bắn toast *"đã chạy X trên account Y"*.
2. **Ghi lại** — mọi lệnh ghi/phá huỷ **kể cả khi Tự động** vào ring buffer nhật ký lệnh.
3. **Hết hạn** — **bypass tạm thời** 15/30/60 phút cho lúc xử lý sự cố, hết giờ tự về ma trận.

**Settings là trần, phiên chỉ siết.** Chip trong phiên hạ quyền xuống được (phiên này chỉ đọc) nhưng không nâng lên được — nếu nâng được thì một phiên bị dẫn dụ tự mở khoá cho chính nó.

## Agent thao tác được toàn bộ, không chỉ trong khung chat

Tool phủ đủ năm bề mặt, cùng một ma trận quyền:

| Tool | Lớp | Làm gì |
|---|---|---|
| `infra_context` | đọc / đổi ngữ cảnh | Xem và chuyển account/cluster/workspace đang ghim |
| `aws_cli` · `kubectl_cli` · `tf_cli` | theo `classify()` | Lệnh CLI có ràng buộc ngữ cảnh |
| `logs_query` · `logs_tail_window` | đọc | Chạy Insights / tail (prompt duyệt kèm **ước lượng GB quét**) |
| `infra_view` | đọc | Mở một view Explorer và đọc bảng đang hiện |
| `infra_action` | ghi / phá huỷ | Bấm hộ một nút hành động của view (scale, redeploy, invalidation…) |
| `graph_build` | đọc | Dựng graph từ một điểm vào và đọc node/edge |
| `playbook_status` · `playbook_step` | đọc / ghi | Xem tiến độ và chạy một bước playbook |

**Agent lái màn hình người dùng đang mở** — khuôn "lái terminal" của [session-ssh-terminal-copilot](session-ssh-terminal-copilot.md): agent chạy query thì kết quả hiện ngay trong tab Logs bạn đang nhìn, agent mở view thì bảng đổi trước mắt bạn. Không phải một bản sao vô hình chạy đâu đó.

**Chiều ngược lại — "Hỏi agent" ở mọi nơi:** mỗi dòng bảng Explorer, mỗi node graph, mỗi bước playbook, mỗi vùng chọn trong log đều có nút đẩy đối tượng đó (JSON đã rút gọn, đã redact) vào phiên — mở phiên mới hoặc nối vào phiên đang bàn về ngữ cảnh này (`Session.aboutInfraView`, khuôn `aboutSshHostId` của [ADR 0064](../decisions/0064-session-ssh-link.md)).

## Hai ràng buộc UI phải tôn trọng

1. **"Mỗi control đúng một nhà"** (commit `372b0dc`). Composer vừa dọn còn `Mode · đính kèm · ⋯ · Gửi`, bốn chip config gộp thành một. → hạ tầng **không** vào composer.
2. **`SessionContextStrip`** ([session-ui-refactor](session-ui-refactor.md) §3.2) đã là nhà của "phiên này gắn với cái gì": chip task, chip SSH host + mức duyệt, popover riêng mỗi chip, `warn` khi `auto`. → ba chip hạ tầng vào đây, **dùng chung một component** `InfraChip` tham số hoá, không copy ba lần (Rule of Three: đây là 3 ngay từ đầu).

## Mô hình chung — một khuôn, ba adapter

Cả ba công cụ chia nhau **một** trừu tượng, vì chúng giống nhau ở đúng ba điểm: có một *ngữ cảnh được chọn*, có *lệnh đọc rẻ và lệnh ghi nguy hiểm*, và *credential nằm ở file cấu hình của chính công cụ đó*.

```
InfraAdapter
  id            'aws' | 'terraform' | 'kubectl'
  discover()    → danh sách ngữ cảnh khả dụng  (profile / thư mục+workspace / context+ns)
  binary()      → đường dẫn binary đã verify   (allowlist prefix + realpath)
  classify(args)→ 'read' | 'write' | 'destructive' | 'context-switch'
  bind(args)    → chèn cờ ngữ cảnh, TỪ CHỐI nếu args tự mang cờ ghi đè
  run(args)     → spawn arg-array, không shell, --output json, timeout, clamp
```

> **Sửa 2026-09-12 (ADR 0088 §5):** bản đầu của doc này có cấp thứ ba tên `forbidden` khoá cứng trong mã. Nay **không còn** — `classify()` trả **lớp** (`read`/`write`/`destructive`/`context-switch`), còn chạy hay hỏi hay chặn do **ma trận quyền ở Settings** quyết định. `terraform apply/destroy/state rm/import` và `kubectl drain` xếp lớp **`destructive`**, mặc định **Chặn** ở tài khoản production và **Hỏi** ở tài khoản thường — chủ tài khoản nới được. Lệnh bị Chặn thì AWOG hiển thị đúng dòng lệnh để người dùng tự chạy.

Hai điều **vẫn** khoá cứng, không nằm trong ma trận: cờ ghi đè ngữ cảnh (`--profile`, `--region`, `--context`, `--namespace`) và cờ đổi điểm cuối (`--endpoint-url`, `--server`, `--kubeconfig`, `--no-verify-ssl`, `--ca-bundle`) — `run.ts` **từ chối** chúng ở mọi mức duyệt, vì chúng phá chính định nghĩa "ngữ cảnh được chỉ định" (invariant 7).

### Nguồn sự thật = file cấu hình của công cụ, AWOG không sở hữu

| Công cụ | Đọc gì | KHÔNG đọc gì |
|---|---|---|
| AWS | `~/.aws/config` + `credentials`: tên profile, region, `kind`, `sso_*`, `role_arn` | giá trị `aws_secret_access_key`/`aws_session_token` (chỉ quy thành boolean), `endpoint_url` |
| Terraform | `*.tf` (block `backend`, `terraform.required_version`), `.terraform/terraform.tfstate` (metadata backend) | state thật, `*.tfvars`, `TF_VAR_*` |
| kubectl | `~/.kube/config`: tên context/cluster/user/namespace | `client-certificate-data`, `client-key-data`, `token`, `exec.command` args |

Parser của cả ba là **allowlist-key**: key không nằm trong cột "đọc gì" bị vứt **tại chỗ lúc parse**, không bao giờ vào object, không bao giờ lên IPC. Không có store mới, không keychain — AWOG chỉ persist *lựa chọn*.

### Lựa chọn persist ở đâu

| Nơi | Field | Ngữ nghĩa |
|---|---|---|
| `SessionHeader` | `infra?: { aws?, terraform?, kubectl?, approvalMode? }` | **tầng chính**; `undefined` = kế thừa project |
| `Project` | `infra?` (cùng shape) | mặc định cho phiên mới |
| `settings.json` | `infra` + `prodMarkers` (account id / context name đánh dấu production) | mặc định app |

Phiên mới kế thừa từ project lúc tạo rồi **đóng băng** vào header — đổi mặc định project sau không âm thầm đổi account của phiên đang chạy dở. Luồng xuống runtime đi đúng đường `aboutSshHostId`/`sshApprovalMode` đang chạy (`sessions.send-message` → `run-stream`, cả 2 runtime).

## Bề mặt RPC

Module mới `apps/desktop/sidecar/src/infra/`: `adapter.ts` (khuôn chung), `aws/`, `terraform/`, `kubectl/`, `binary.ts` (detect + verify realpath, khuôn [vpn/binary.ts](../../apps/desktop/sidecar/src/vpn/binary.ts)), `classify.ts`, `watch.ts`.

| Method | Pha | Chạm hạ tầng? |
|---|---|---|
| `infra.contexts({ tool })` | P0/P1/P2 | không — đọc file cấu hình |
| `infra.status()` | P0 | không — binary nào có, version nào |
| `infra.run({ tool, args })` | theo pha | **có** — lõi của cả tool lẫn nút UI |
| `infra.setSessionContext` | P0 | không |
| `aws.whoami` | P3 | có |
| `tf.plan` / `tf.planJson` | P1 | có (giữ lock) |
| `k8s.logs` (stream) / `k8s.exec` (PTY) / `k8s.forward.*` | P2 | có |

Event: `infra.fs-changed` (chokidar trên `~/.aws`, `~/.kube/config`, `**/.terraform/`, debounce 200ms).

## Lộ trình

### P0 — Nền chung + AWS

| # | Việc | Ước lượng |
|---|---|---|
| 1 | `infra/binary.ts` + `classify.ts` (4 lớp) + `run.ts` spawn arg-array không shell | M |
| 2 | Adapter AWS: parser INI allowlist-key (`[profile x]` vs `[x]`, comment, CRLF, key trùng) + derive `kind` | M |
| 3 | `SessionHeader.infra` + `Project.infra` + `settings.infra` + resolver 3 tầng `useInfraContext()` | M |
| 4 | RPC `infra.contexts` / `infra.status` / `infra.run` / `infra.setSessionContext` | S |
| 5 | `runtime/tools/infra-tools.ts`: `aws_cli` / `aws_profiles`, wire **cả 2 runtime** (Pi AgentTool + bridge Claude SDK) | M |
| 6 | Gate `infraApprovalMode` trong `runtime/permission.ts` cạnh nhánh SSH; payload prompt mang lệnh + ngữ cảnh | M |
| 7 | `InfraChip.vue` tham số hoá + gắn AWS vào `SessionContextStrip` | M |
| 8 | Tiêm `AWS_PROFILE`/`AWS_REGION` vào PTY của phiên | M |
| 9 | Block `<infra_context>` mỗi lượt (`context/environment.ts`, dùng chung 2 runtime) | S |
| 10 | Danh sách **cứng** không-thể-always-allow cho `Bash`: `aws`/`terraform`/`kubectl`/`helm`/`gcloud`/`az` (vá lỗ ADR 0080) | S |
| 11 | Watcher + i18n en/vi | S |

**Nghiệm thu:** chọn profile trong chip → hỏi *"liệt kê S3 bucket"* → agent gọi `aws_cli(['s3api','list-buckets'])` → prompt duyệt hiện đủ lệnh + profile + region → chạy đúng account. Bảo agent *"dùng profile prod"* → tool **từ chối**, không im lặng đổi.

### P1 — Terraform (điểm nhấn: Plan viewer)

| # | Việc | Ước lượng |
|---|---|---|
| 12 | Discover thư mục `*.tf` ≤2 cấp + `terraform workspace list` + đọc block `backend` | M |
| 13 | `tf_cli` read allowlist (`validate`/`fmt -check`/`state list`/`state show`/`output`/`version`) | S |
| 14 | `tf.plan` → `-out` + `show -json`, parse `resource_changes`, cap kích thước | M |
| 15 | **Tab Plan** trong Workspace Panel: bảng `+ ~ -` theo resource, đếm tổng, lọc, bấm resource xem chi tiết before/after | L |
| 16 | Tóm tắt plan vào context phiên để agent giải thích/rà soát mà không chạy lại | S |
| 17 | Lớp `destructive` cho `apply`/`destroy`/`state rm`/`import` + UI "mở terminal điền sẵn lệnh" khi ma trận đặt **Chặn** | S |
| 18 | Chip Terraform trong context strip | S |

### P2 — kubectl

| # | Việc | Ước lượng |
|---|---|---|
| 19 | Parser `~/.kube/config` allowlist-key (tên context/cluster/ns; bỏ mọi field credential) | M |
| 20 | `kubectl_cli` read allowlist (`get`/`describe`/`logs`/`events`/`top`/`explain`/`api-resources`) | S |
| 21 | **Tab Logs**: stream `kubectl logs -f`, chọn pod/container, tail + tìm kiếm | M |
| 22 | **Exec vào pod** qua node-pty, mở như một pane terminal | M |
| 23 | **Port-forward panel** (khuôn `SshForwardPanel`): thêm/bật/tắt, hiện cổng đang mở | M |
| 24 | Lệnh ghi → duyệt; `delete`/`drain` ở context đánh dấu prod → bắt gõ lại tên context | M |
| 25 | Chip kubectl + `aws eks update-kubeconfig` nối AWS ↔ EKS | S |

### P3 — Danh tính, SSO, đánh dấu production

| # | Việc |
|---|---|
| 26 | `aws.whoami` + cache + hiện trong popover chip |
| 27 | SSO expiry từ `~/.aws/sso/cache` (chỉ `expiresAt`) + badge đếm ngược + nút điền sẵn `aws sso login` |
| 28 | Đánh dấu production (account id / context name) ở Settings + nhuộm chip danger + xác nhận mạnh hơn |
| 29 | Bổ sung pattern `ASIA…` vào [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) |
| 30 | Settings → Hạ tầng (mặc định app, đánh dấu production). Màn hình quản lý resource nằm ở [infra-explorer.md](infra-explorer.md), pha E1–E6 |

## Bảo mật — đối chiếu 8 invariant

| Invariant | Áp dụng |
|---|---|
| 1. Key không rời sidecar | Mạnh hơn: **không vào** sidecar. Parser vứt giá trị secret tại chỗ (AWS key, k8s token/cert, tfvars); handoff bằng **tên** ngữ cảnh |
| 2. Path sanitize | `~/.aws`, `~/.kube` đọc qua module riêng allowlist file cố định; thư mục tf phải nằm trong project (`assertInsideWorkspace`) |
| 3. Git scope | không chạm |
| 4. IPC boundary | UI không đọc file cấu hình hạ tầng; mọi thứ qua `infra.*` |
| 5. No telemetry | Chỉ gọi API của chính người dùng; `--endpoint-url`/`--server` bị chặn |
| 6. No port public | `kubectl port-forward` bind `127.0.0.1` mặc định (như SSH forward) |
| 7. No SSRF | Không nhận endpoint/URL/kubeconfig path từ UI hay model |
| 8. No eval / injection | Spawn arg-array **không qua shell**; binary từ allowlist prefix + verify realpath; tên ngữ cảnh validate charset hẹp, chặn dấu `-` đầu để không hoá thành flag |

**infosec audit bắt buộc** trước khi bật tool cho agent ở mỗi pha — đây là lần đầu agent chạm hạ tầng thật.

## Câu hỏi mở

1. **Mức duyệt `auto` (nới cho nhánh đọc) có được tồn tại không?** Vẫn nới hơn luật bạn từng nêu (*"kể cả `describe`/`list` cũng phải duyệt"*). Đề xuất: **giữ, mặc định `prompt`**, chip nhuộm `warn` khi bật, bật/tắt theo từng phiên.
2. **`terraform plan` có được coi là "đọc" không?** Nó giữ state lock và cần credential thật. Đề xuất: **không** — plan luôn ở nhánh duyệt, kể cả mức `auto`.
3. **Thứ tự sau P0** — ba nhánh cùng chờ: Terraform (Plan viewer), kubectl (tool cho agent), và **Explorer E1–E2** (màn hình S3/CloudWatch/EC2). Đề xuất: **Explorer trước**, vì nó là thứ bạn mở hằng ngày và nó dựng luôn khung bảng mà các nhánh sau dùng lại.
