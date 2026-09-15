# Feature — Ngữ cảnh hạ tầng trong phiên (AWS · Terraform · kubectl)

- **Trạng thái:** P0 (AWS) + Mốc 2 đã code trong cây làm việc (chưa commit) · **P1 Terraform + P2 kubectl: đã nối phần lõi** (đọc ngữ cảnh + chip + `tf_cli`/`kubectl_cli`), còn Plan viewer · Logs tab · exec · port-forward — xem cột ✅ ở hai bảng dưới
- **ADR:** [0088 — ngữ cảnh hạ tầng ghim theo phiên](../decisions/0088-session-infra-context.md)
- **Bề mặt chính:** chip trong `SessionContextStrip` + tool `aws_cli` / `tf_cli` / `kubectl_cli` cho agent + 3 panel trong Workspace Panel
- **Màn hình quản lý:** [infra-explorer.md](infra-explorer.md) — trang `/infra` (S3 · CloudWatch · EC2 · ECS/Fargate · EKS · Amplify · Kubernetes). Doc này là **nền** của nó.
- **Liên quan:** [ADR 0064](../decisions/0064-session-ssh-link.md) (Session↔SSH — khuôn mẫu gần nhất), [session-ui-refactor](session-ui-refactor.md) §3.2, [ADR 0080](../decisions/0080-command-scoped-permission-rules.md), [ADR 0070](../decisions/0070-share-claude-home-for-config.md), [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md) (PTY), [security.md](../../.claude/rules/security.md)

## Một câu

Phiên chat chỉ định **profile AWS / thư mục + workspace Terraform / context + namespace kubectl**, rồi cả người lẫn agent làm việc với đúng cái đã chỉ định — không trôi sang account khác, không tự chạy lệnh ghi.

## Danh mục tính năng (làm được gì)

### AWS — P0

| Người dùng làm được                                                                                                     | Cơ chế                                                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Chọn profile + region cho phiên; nhìn chip là biết đang trỏ vào account nào                                             | chip `⛅ Offshore-Developer · ap-southeast-1 · hỏi` trong context strip      |
| Hỏi agent _"có bucket nào"_, _"instance nào đang chạy"_, _"log group X 30 phút qua nói gì"_, _"policy này cho phép gì"_ | tool `aws_cli` với động từ đọc (`describe-*`/`list-*`/`get-*`/`ls`)          |
| Xác nhận danh tính trước khi làm gì: account id · arn · alias                                                           | nút **Kiểm tra danh tính** trong popover + tool `aws_whoami`                 |
| Mở terminal trong phiên và gõ `aws …` mà không cần `--profile`                                                          | tiêm `AWS_PROFILE`/`AWS_REGION` vào PTY của phiên                            |
| Yên tâm agent **không thể** lén đổi account                                                                             | `aws_cli` từ chối `--profile`/`--region`/`--endpoint-url` trong args         |
| Biết token SSO còn hạn bao lâu, đăng nhập lại                                                                           | đọc `~/.aws/sso/cache` (chỉ `expiresAt`) + nút điền sẵn `aws sso login` (P3) |

### Terraform — P1

| Người dùng làm được                                                                                                                                   | Cơ chế                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Chọn thư mục `.tf` + workspace cho phiên; chip `▲ infra/prod · default`                                                                               | quét `*.tf` ≤ 2 cấp trong project (khuôn `git.discoverRepos`) + `terraform workspace list`                                    |
| Biết **state nằm ở đâu** trước khi động vào                                                                                                           | đọc block `backend` + `.terraform/terraform.tfstate` (chỉ metadata, không giá trị)                                            |
| Bấm **Plan** và đọc kết quả như đọc diff: bảng resource với `+ tạo · ~ sửa · - xoá`, đếm tổng, lọc theo loại                                          | `terraform plan -out=…` rồi `terraform show -json` → parse `resource_changes` → render trong tab **Plan** của Workspace Panel |
| Hỏi agent _"cái gì sắp bị xoá"_, _"vì sao resource này thay đổi"_, _"plan này có phá downtime không"_ — agent đọc **plan đã chạy**, không tự chạy lại | tóm tắt JSON của plan đưa vào context phiên                                                                                   |
| Cho agent chạy `validate` / `fmt -check` / `state list` / `state show` / `output`                                                                     | `tf_cli` allowlist đọc                                                                                                        |
| `init` (ghi backend) và `plan` (giữ lock) → **duyệt từng lần**, prompt nói rõ thư mục + workspace + backend                                           | gate `infraApprovalMode`                                                                                                      |
| `apply` / `destroy` / `state rm` / `import` → **AWOG không chạy**. Chỉ hiện lệnh chính xác + nút mở terminal điền sẵn, người dùng tự Enter            | luật cứng, không có cờ tắt                                                                                                    |

### kubectl — P2

| Người dùng làm được                                                                                                                                        | Cơ chế                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Chọn context + namespace cho phiên; chip `⎈ prod-eks · default`                                                                                            | đọc `~/.kube/config` (chỉ tên context/cluster/namespace — không đọc token/cert)                                             |
| Hỏi agent _"pod nào đang CrashLoop"_, _"describe deploy X"_, _"event 10 phút qua"_, _"node nào hết RAM"_                                                   | `kubectl_cli` động từ đọc (`get`/`describe`/`logs`/`events`/`top`/`explain`)                                                |
| **Xem log pod ngay trong panel**, tail theo thời gian thực, nhiều container                                                                                | tab **Logs** trong Workspace Panel, stream `kubectl logs -f`                                                                |
| **Exec vào pod** như một terminal thật                                                                                                                     | `kubectl exec -it` qua node-pty — cắm vào hạ tầng PTY sẵn có ([ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md))     |
| **Port-forward** bật/tắt bằng panel, thấy cổng nào đang mở                                                                                                 | `kubectl port-forward`, tái dùng khuôn [SshForwardPanel.vue](../../apps/desktop/ui-next/components/ssh/SshForwardPanel.vue) |
| `apply` / `scale` / `rollout restart` / `delete` → duyệt từng lần; ở context đánh dấu production, `delete`/`drain` bắt **gõ lại tên context** mới cho chạy | gate + xác nhận kiểu "gõ tên để xoá"                                                                                        |
| Nối AWS ↔ EKS: từ profile AWS sinh/cập nhật kubeconfig                                                                                                     | `aws eks update-kubeconfig` (lệnh ghi ⇒ duyệt)                                                                              |

### Chung cả ba

- Một chip mỗi công cụ trong context strip, **không có chip nào thì không mất pixel nào**.
- Prompt duyệt hiện **dòng lệnh đầy đủ + ngữ cảnh đang ghim** (profile/account, thư mục/workspace, context/namespace) — không phải một chữ "cho phép kubectl".
- `<infra_context>` mỗi lượt: agent biết nó đang ở account/cluster/workspace nào và phải nêu ra trước khi đề xuất.

## Ngữ cảnh là của không gian làm việc, không phải của riêng màn chat

**Một ngữ cảnh hiệu lực tại một thời điểm**, hiện ở mọi bề mặt qua cùng một control: thanh ngữ cảnh đầu trang `/infra`, chip trong phiên, chip trên status bar, env của terminal. **Không view nào có picker account riêng** — có picker riêng là có cách để hai bảng cạnh nhau nói về hai account khác nhau mà không ai nhận ra.

| Tầng     | Ai đặt                              | Ghi chú                                                   |
| -------- | ----------------------------------- | --------------------------------------------------------- |
| Phiên    | chip context strip                  | Thắng khi đang ở trong phiên; đóng băng lúc tạo phiên     |
| Project  | Projects / quick-view               | Mặc định cho phiên và cho `/infra` khi đang mở project đó |
| Toàn app | Settings → Hạ tầng · thanh `/infra` | Mặc định cuối                                             |

Đổi ngữ cảnh ⇒ **vô hiệu toàn bộ cache view và nạp lại**; mỗi bảng ghi rõ account + thời điểm nạp. Account đánh dấu production làm thanh ngữ cảnh đổi màu ở mọi màn.

## Cổng quyền = một ma trận, không phải một công tắc

Bốn lớp lệnh × hai loại account × ba chế độ. Đây là **quyết định của người sở hữu account**, nên nó nằm ở Settings chứ không khoá cứng trong mã.

| Lớp lệnh                                             | Account thường | Account production |
| ---------------------------------------------------- | -------------- | ------------------ |
| **Đọc** — `describe`/`list`/`get`/`logs`             | Tự động        | Tự động            |
| **Ghi** — `create`/`update`/`scale`/`deploy`/`plan`  | Hỏi            | Hỏi                |
| **Phá huỷ** — `delete`/`terminate`/`destroy`/`drain` | Hỏi            | **Chặn**           |
| **Đổi ngữ cảnh** — agent tự chuyển account/cluster   | Tự động        | Hỏi                |

Ba chế độ: **Tự động** (chạy thẳng) · **Hỏi** (park chờ người duyệt) · **Chặn** (hiện lệnh để người tự chạy). Bảng trên là mặc định xuất xưởng, đổi được từng ô.

Ba tính chất bắt buộc của bypass (chi tiết ở [ADR 0088 §5](../decisions/0088-session-infra-context.md)):

1. **Nhìn thấy** — bypass bật thì chip nhuộm cảnh báo ở mọi bề mặt; mỗi lệnh tự động chạy bắn toast _"đã chạy X trên account Y"_.
2. **Ghi lại** — mọi lệnh ghi/phá huỷ **kể cả khi Tự động** vào ring buffer nhật ký lệnh.
3. **Hết hạn** — **bypass tạm thời** 15/30/60 phút cho lúc xử lý sự cố, hết giờ tự về ma trận.

**Settings là trần, phiên chỉ siết.** Chip trong phiên hạ quyền xuống được (phiên này chỉ đọc) nhưng không nâng lên được — nếu nâng được thì một phiên bị dẫn dụ tự mở khoá cho chính nó.

### Thẻ duyệt — sửa 2026-09-14

Ba lỗi người dùng gặp khi duyệt một lệnh hạ tầng trong phiên, và một lỗ đã có từ trước:

1. **Dòng lệnh dài bị cắt cụt, không xuống dòng.** `.icmd` để `white-space: pre` + `overflow-x: auto` với lý do "một lệnh bị bẻ dòng đọc ra thành nhiều lệnh" — đúng về nguyên tắc, nhưng trên thực tế phần **đuôi** bị đẩy ra ngoài tầm nhìn và thanh cuộn ngang không hiện (macOS ẩn scrollbar), nên người duyệt đọc `… | env | grep -c '^AWS_'` mà **không thấy** `'^AWS_'`. Nay `pre-wrap` + `overflow-wrap: anywhere`: chữ vẫn nguyên văn (không thêm/bớt ký tự nào, copy ra terminal vẫn chạy đúng) và chỉ bẻ khi token không còn chỗ. Đo lại: `scrollWidth === clientWidth`, không còn tràn ngang.
2. **Duyệt xong không thấy lệnh trả về gì.** Thẻ chỉ nói *"✓ Đã cho phép"*, còn output nằm trong khối **"Đã xong các bước"** mặc định thu gọn ngay dưới thẻ. Cách sửa: event quyền mang `toolUseID`, step của cùng lời gọi mang đúng id đó — store dùng nó làm khoá (`attachPermResult`, `stores/sessions.ts`) để chép `detail`/`detailKind`/`result` từ step sang `PermBlock`, và nhánh "đã duyệt" của thẻ in khối **Kết quả** (kèm chip `exit 254` khi khác 0). Chỉ in kết quả **dạng chữ** (`terminal`/`text`/`list`): diff/file đã có nguyên một khối bước ngay dưới thẻ, chép lại là nhân đôi cả một file vào transcript.
3. **Câu ghi chú "No account is pinned" vừa sai vừa thừa.** Bản đầu của thẻ hạ tầng ghim `undefined` cho ngữ cảnh ở nhánh `Bash`, và câu chữ còn lại đọc như thể *app không biết account nào*. Sự thật: phiên Claude SDK chạy `Bash` của **CLI**, mà CLI không nhận env của sidecar — `aws` vì thế không có `AWS_PROFILE`, và dòng ghi chú đang mô tả đúng một lỗ thật. Nay `buildSdkEnv` nhận ngữ cảnh phiên và đặt `AWS_PROFILE`/`AWS_REGION`/`AWS_DEFAULT_REGION` **sau** bản sao `process.env` (ghim của phiên thắng, khớp `infraEnv()` của `infra/run.ts`), còn thẻ nói đúng mức của nó bằng câu mới `infraGate.hint.shell`: *"Lệnh chạy trong một chuỗi shell: profile ở trên là MẶC ĐỊNH của phiên, còn chuỗi vẫn tự đổi được bằng cờ riêng — nên ma trận chấm ở mức chặt nhất."* Env là mặc định chứ không phải chỉ định (đúng [ADR 0088 §4](../decisions/0088-session-infra-context.md)/§6), nên câu chữ phải nói ra điều đó thay vì im lặng hứa hộ một account.

**Đường Codex cố ý không nối:** daemon của nó dùng chung theo `codexHome`, nên một biến env theo từng phiên sẽ đua nhau giữa các phiên — đã ghi lại ngay tại `runtime/codex/app-server.ts` thay vì để người sau "phát hiện" sự bất đối xứng này.

**Kèm theo — nhật ký lệnh:** nhánh `Bash` ghi `context: {}`, tức dòng nhật ký không nói được lệnh chấm theo account nào. Nay cả hai đường ghi đi qua **một** builder `infraAuditContext()` (export từ `infra/run.ts`), nên dòng `surface: session, tool: Bash` mang đủ profile/account/region như dòng của tool `aws_cli`.

## Agent thao tác được toàn bộ, không chỉ trong khung chat

Tool phủ đủ năm bề mặt, cùng một ma trận quyền:

| Tool                                 | Lớp                | Làm gì                                                             |
| ------------------------------------ | ------------------ | ------------------------------------------------------------------ |
| `infra_context`                      | đọc / đổi ngữ cảnh | Xem và chuyển account/cluster/workspace đang ghim                  |
| `aws_cli` · `kubectl_cli` · `tf_cli` | theo `classify()`  | Lệnh CLI có ràng buộc ngữ cảnh                                     |
| `logs_query` · `logs_tail_window`    | đọc                | Chạy Insights / tail (prompt duyệt kèm **ước lượng GB quét**)      |
| `infra_view`                         | đọc                | Mở một view Explorer và đọc bảng đang hiện                         |
| `infra_action`                       | ghi / phá huỷ      | Bấm hộ một nút hành động của view (scale, redeploy, invalidation…) |
| `graph_build`                        | đọc                | Dựng graph từ một điểm vào và đọc node/edge                        |
| `playbook_status` · `playbook_step`  | đọc / ghi          | Xem tiến độ và chạy một bước playbook                              |

**Agent lái màn hình người dùng đang mở** — khuôn "lái terminal" của [session-ssh-terminal-copilot](session-ssh-terminal-copilot.md): agent chạy query thì kết quả hiện ngay trong tab Logs bạn đang nhìn, agent mở view thì bảng đổi trước mắt bạn. Không phải một bản sao vô hình chạy đâu đó.

**Chiều ngược lại — "Hỏi agent" ở mọi nơi:** mỗi dòng bảng Explorer, mỗi node graph, mỗi bước playbook, mỗi vùng chọn trong log đều có nút đẩy đối tượng đó (JSON đã rút gọn, đã redact) vào phiên — mở phiên mới hoặc nối vào phiên đang bàn về ngữ cảnh này (`Session.aboutInfraView`, khuôn `aboutSshHostId` của [ADR 0064](../decisions/0064-session-ssh-link.md)).

## Hai ràng buộc UI phải tôn trọng

1. **"Mỗi control đúng một nhà"** (commit `372b0dc`). Composer vừa dọn còn `Mode · đính kèm · ⋯ · Gửi`, bốn chip config gộp thành một. → hạ tầng **không** vào composer.
2. **`SessionContextStrip`** ([session-ui-refactor](session-ui-refactor.md) §3.2) đã là nhà của "phiên này gắn với cái gì": chip task, chip SSH host + mức duyệt, popover riêng mỗi chip, `warn` khi `auto`. → ba chip hạ tầng vào đây.
   - **Sửa 2026-09-13 (khi nối P1/P2):** bản đầu của doc này chốt "dùng chung MỘT component `InfraChip` tham số hoá". Thực tế cho thấy ba nhánh không chia sẻ được phần nào của thân chip — AWS có profile/region/mức duyệt/kiểm tra danh tính, kubectl có context/namespace, Terraform có thư mục/backend/workspace; một component với ba `v-if` khổng lồ là ba component đội lốt, mà lại đúng một file. Nay là **ba SFC riêng** (`InfraChip.vue`, `InfraKubectlChip.vue`, `InfraTerraformChip.vue`) **dùng chung CSS** đã nâng lên `assets/css/app-shell.css` (`.iwrap`, `.ipop`, `.ifield`, `.iact`, …) — chỗ thật sự giống nhau vẫn nằm đúng một bản.
   - **Lệch có chủ đích so với nhánh AWS:** chip AWS ẩn khi chưa ghim gì (việc ghim đầu tiên nằm ở trang `/infra`). Chip kubectl/Terraform **hiện cả khi chưa ghim**, miễn là máy có kubeconfig / project có `*.tf` — chúng không có chỗ nào khác để ghim, nên ẩn tiếp ở đây là tự khoá đường vào. Máy không có gì để chọn thì vẫn không thấy chip nào.
   - **Bổ sung 2026-09-14:** tab **Kubernetes** trong `/infra` nay là một màn thật, không phải một dòng hướng dẫn. Mọi thứ vào bằng cú bấm: chọn profile → region → cluster → _Thêm vào kubeconfig_ (việc 25 ✅).
   - **Sửa 2026-09-14 (bố cục MỘT MÀN):** bản đầu xếp bốn khối dọc trên trang (bảng context · khối thêm cluster · hai bảng workload · khung log) nên màn nào cũng phải cuộn. Nay trang `/infra → Kubernetes` **không cuộn**: một thanh ngữ cảnh (chọn cluster · chọn namespace · _Quản lý cluster_ · ↻ · nút ⓘ mở chú thích dài) rồi tới một khung bảng lấp hết phần còn lại, trong đó **Pods** và **Deployments** là hai tab của cùng một chỗ và chỉ **bảng** bên trong được cuộn. Ba thứ từng chiếm chỗ trên trang dồn vào lớp phủ: **quản lý cluster** (bảng context + _Thêm cluster EKS_) là một **modal**, **log/describe** của một pod là một **modal** có hai tab (bấm cả hàng pod để mở; _Xoá pod_ nằm trong chân modal đó, cạnh thứ đang nói về đúng pod ấy), **chú thích "danh tính kubectl dùng"** là một **popover**. CSS dùng chung của cả tab nằm ở `assets/css/app-shell.css` khối `.ik*/.ikm-*`.
   - **Hệ quả (đã chủ ý): chọn cluster/namespace là nạp bảng luôn.** Luật "không auto-refresh" của [infra-explorer.md](infra-explorer.md) cấm nạp _sau lưng_ người dùng (poll, watch); nó không cấm làm theo đúng thứ người dùng vừa chọn. Trước đây chọn cluster xong màn vẫn trống cho tới khi bấm ↻ — với người không quen terminal thì đó là ngõ cụt.
   - **Ngữ cảnh chọn ở tab này là ngữ cảnh CHUNG của app** (`useInfraContext({ sessionId: null })` → ghi tầng app), không phải biến riêng của tab — đúng luật "một ngữ cảnh hiệu lực tại một thời điểm" ở đầu file này. Ghim cho từng PHIÊN vẫn chỉ làm được ở chip của phiên đó (ADR 0088 §7).
   - **Bổ sung 2026-09-14 (tìm · lọc · Báo cáo):** vùng bảng có ô **tìm** lọc tại chỗ (khớp tên hoặc bất kỳ ô nào; không lượt `kubectl` nào thêm), khung log/`describe` có thanh **lọc dòng**, và `seg` có mục thứ ba **Báo cáo** — cách nhìn theo chỉ số của đúng hai bảng người dùng vừa nạp (đèn, điểm sức khoẻ tự tính, phân bố trạng thái, top khởi động lại, dải xu hướng). Luật "không auto-refresh" vẫn nguyên: con số mới chỉ đến từ cú bấm ↻ hoặc từ _Theo dõi_ — một vòng lặp **người dùng tự bật**, nhịp 30s, trần 15 phút, dừng ngay khi rời mục. Một màn "monitor" tự nạp theo nhịp vẫn bị cấm.

## Mô hình chung — một khuôn, ba adapter

Cả ba công cụ chia nhau **một** trừu tượng, vì chúng giống nhau ở đúng ba điểm: có một _ngữ cảnh được chọn_, có _lệnh đọc rẻ và lệnh ghi nguy hiểm_, và _credential nằm ở file cấu hình của chính công cụ đó_.

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

| Công cụ   | Đọc gì                                                                                                    | KHÔNG đọc gì                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| AWS       | `~/.aws/config` + `credentials`: tên profile, region, `kind`, `sso_*`, `role_arn`                         | giá trị `aws_secret_access_key`/`aws_session_token` (chỉ quy thành boolean), `endpoint_url` |
| Terraform | `*.tf` (block `backend`, `terraform.required_version`), `.terraform/terraform.tfstate` (metadata backend) | state thật, `*.tfvars`, `TF_VAR_*`                                                          |
| kubectl   | `~/.kube/config`: tên context/cluster/user/namespace                                                      | `client-certificate-data`, `client-key-data`, `token`, `exec.command` args                  |

Parser của cả ba là **allowlist-key**: key không nằm trong cột "đọc gì" bị vứt **tại chỗ lúc parse**, không bao giờ vào object, không bao giờ lên IPC. Không có store mới, không keychain — AWOG chỉ persist _lựa chọn_.

### Ngữ cảnh vào tiến trình con: `aws` bằng CỜ, `kubectl`/Terraform bằng ENV

Ngữ cảnh đã ghim phải tới được **tiến trình con**, và ba công cụ không nhận nó theo cùng một đường:

| Công cụ   | Ngữ cảnh đi bằng                                                                  | Vì sao                                                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aws`     | `--profile` / `--region` trong argv                                               | cờ là đường tường minh nhất, và cờ tự mang ngữ cảnh thì `run.ts` từ chối được (`findForbiddenFlag`)                                                                                  |
| `kubectl` | `--context` / `--namespace` trong argv **+** `AWS_PROFILE`/`AWS_REGION` trong env | kubeconfig của EKS trỏ user vào **exec plugin** `aws eks get-token`; plugin đó lấy credential từ env của tiến trình kubectl, không đọc profile của phiên (nó không biết phiên là gì) |
| Terraform | `-chdir=` trong argv **+** `AWS_PROFILE`/`AWS_REGION` trong env                   | AWS provider đọc credential từ env; `profile = "…"` khai trong `.tf` vẫn thắng env, đúng thứ tự ưu tiên của chính Terraform                                                          |

**Không luồn env cho `aws`** — nếu vừa có `--profile` vừa có `AWS_PROFILE` (do người dùng export sẵn trong shell), hai đường nói về hai account khác nhau khi hai bên lệch nhau; giữ một đường duy nhất cho mỗi công cụ. `filteredShellEnv` cố ý **không** mang `AWS_PROFILE` của tiến trình AWOG: env của app không được lặng lẽ quyết định lệnh chạy trên account nào. Nó chỉ vào khi người dùng đã _ghim_.

Giới hạn đã biết: nếu kubeconfig tự khai `exec.env: [AWS_PROFILE=other]`, khoá trong **file** thắng env của AWOG (kubectl chạy plugin với env đó), mà parser cố ý không đọc khối `exec` nên không cảnh báo được. Cách sạch nhất là sinh kubeconfig bằng `aws eks update-kubeconfig --name <cluster> --region <r> --profile <profile>` — khi đó profile nằm ngay trong user block.

### Lựa chọn persist ở đâu

| Nơi             | Field                                                                   | Ngữ nghĩa                                     |
| --------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| `SessionHeader` | `infra?: { aws?, terraform?, kubectl?, approvalMode? }`                 | **tầng chính**; `undefined` = kế thừa project |
| `Project`       | `infra?` (cùng shape)                                                   | mặc định cho phiên mới                        |
| `settings.json` | `infra` + `prodMarkers` (account id / context name đánh dấu production) | mặc định app                                  |

Phiên mới kế thừa từ project lúc tạo rồi **đóng băng** vào header — đổi mặc định project sau không âm thầm đổi account của phiên đang chạy dở. Luồng xuống runtime đi đúng đường `aboutSshHostId`/`sshApprovalMode` đang chạy (`sessions.send-message` → `run-stream`, cả 2 runtime).

## Bề mặt RPC

Module mới `apps/desktop/sidecar/src/infra/`: `adapter.ts` (khuôn chung), `aws/`, `terraform/`, `kubectl/`, `binary.ts` (detect + verify realpath, khuôn [vpn/binary.ts](../../apps/desktop/sidecar/src/vpn/binary.ts)), `classify.ts`, `watch.ts`.

| Method                                                   | Pha      | Chạm hạ tầng?                       |
| -------------------------------------------------------- | -------- | ----------------------------------- |
| `infra.contexts({ tool })`                               | P0/P1/P2 | không — đọc file cấu hình           |
| `infra.status()`                                         | P0       | không — binary nào có, version nào  |
| `infra.run({ tool, args })`                              | theo pha | **có** — lõi của cả tool lẫn nút UI |
| `infra.setSessionContext`                                | P0       | không                               |
| `aws.whoami`                                             | P3       | có                                  |
| `tf.plan` / `tf.planJson`                                | P1       | có (giữ lock)                       |
| `k8s.logs` (stream) / `k8s.exec` (PTY) / `k8s.forward.*` | P2       | có                                  |

Event: `infra.fs-changed` (chokidar trên `~/.aws`, `~/.kube/config`, `**/.terraform/`, debounce 200ms).

## Lộ trình

### P0 — Nền chung + AWS

| #   | Việc                                                                                                                    | Ước lượng |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `infra/binary.ts` + `classify.ts` (4 lớp) + `run.ts` spawn arg-array không shell                                        | M         |
| 2   | Adapter AWS: parser INI allowlist-key (`[profile x]` vs `[x]`, comment, CRLF, key trùng) + derive `kind`                | M         |
| 3   | `SessionHeader.infra` + `Project.infra` + `settings.infra` + resolver 3 tầng `useInfraContext()`                        | M         |
| 4   | RPC `infra.contexts` / `infra.status` / `infra.run` / `infra.setSessionContext`                                         | S         |
| 5   | `runtime/tools/infra-tools.ts`: `aws_cli` / `aws_profiles`, wire **cả 2 runtime** (Pi AgentTool + bridge Claude SDK)    | M         |
| 6   | Gate `infraApprovalMode` trong `runtime/permission.ts` cạnh nhánh SSH; payload prompt mang lệnh + ngữ cảnh              | M         |
| 7   | `InfraChip.vue` tham số hoá + gắn AWS vào `SessionContextStrip`                                                         | M         |
| 8   | Tiêm `AWS_PROFILE`/`AWS_REGION` vào PTY của phiên                                                                       | M         |
| 9   | Block `<infra_context>` mỗi lượt (`context/environment.ts`, dùng chung 2 runtime)                                       | S         |
| 10  | Danh sách **cứng** không-thể-always-allow cho `Bash`: `aws`/`terraform`/`kubectl`/`helm`/`gcloud`/`az` (vá lỗ ADR 0080) | S         |
| 11  | Watcher + i18n en/vi                                                                                                    | S         |

**Nghiệm thu:** chọn profile trong chip → hỏi _"liệt kê S3 bucket"_ → agent gọi `aws_cli(['s3api','list-buckets'])` → prompt duyệt hiện đủ lệnh + profile + region → chạy đúng account. Bảo agent _"dùng profile prod"_ → tool **từ chối**, không im lặng đổi.

### P1 — Terraform (điểm nhấn: Plan viewer)

| #   | Việc | Ước lượng                                                                                                                                                                           |
| --- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #   | ✅   | Việc                                                                                                                                                                                | Ước lượng |
| --- | ---  | ---                                                                                                                                                                                 | ---       |
| 12  | ✅   | Discover thư mục `*.tf` ≤2 cấp + đọc block `backend` (`infra/terraform/discover.ts`) + `terraform workspace list` qua RPC riêng `infra.tf-workspaces` (chỉ chạy khi người dùng bấm) | M         |
| 13  | ✅   | `tf_cli` read allowlist (`validate`/`fmt -check`/`state list`/`state show`/`output`/`version`); `fmt` trần và `workspace select/new/delete` là `write`                              | S         |
| 14  | ⬜   | `tf.plan` → `-out` + `show -json`, parse `resource_changes`, cap kích thước                                                                                                         | M         |
| 15  | ⬜   | **Tab Plan** trong Workspace Panel: bảng `+ ~ -` theo resource, đếm tổng, lọc, bấm resource xem chi tiết before/after                                                               | L         |
| 16  | ⬜   | Tóm tắt plan vào context phiên để agent giải thích/rà soát mà không chạy lại                                                                                                        | S         |
| 17  | ◐    | Lớp `destructive` cho `apply`/`destroy`/`state rm`/`import` đã có (mặc định **Chặn**); nút "mở terminal điền sẵn lệnh" **chưa**                                                     | S         |
| 18  | ✅   | Chip Terraform trong context strip (`InfraTerraformChip.vue`)                                                                                                                       | S         |

### P2 — kubectl

| #   | Việc | Ước lượng                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #   | ✅   | Việc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Ước lượng |
| --- | ---  | ---                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ---       |
| 19  | ✅   | Parser `~/.kube/config` allowlist-key (`infra/kubectl/kubeconfig.ts`) — chỉ cắt ra tên context/cluster/namespace/user + URL API server; `token`, `*-data`, khối `exec` bị bỏ ngay trong vòng lặp parse. Đọc cả `KUBECONFIG` (nhiều file, file đầu thắng)                                                                                                                                                                                                                                                                                                                                                                                               | M         |
| 20  | ✅   | `kubectl_cli` read allowlist (`get`/`describe`/`logs`/`events`/`top`/`explain`/`api-resources`) + `kubectl get secret … -o yaml` bị **chặn cứng** (output chính là credential). **Sửa 2026-09-14:** `-o custom-columns[‑file]` vào cùng nhóm — nó chọn được `.data.password` nên trước đó là đường vòng lấy credential mà không lớp nào nhìn thấy                                                                                                                                                                                                                                                                                                      | S         |
| 20b | ✅   | **Bảng workload + log trong tab `/infra`** (2026-09-14): RPC `infra.kube` với 10 thao tác đóng (namespaces · pods · deployments · containers · logs · describe · restart · delete-pod · eks-clusters · add-cluster). UI **không** ghép argv: tên do cluster trả về được validate ở sidecar rồi mới thành phần tử argv. Bảng dùng `--no-headers` (bảng chữ) chứ không `-o json`/`custom-columns`, nên nạp bảng là `read` chạy thẳng thay vì mỗi lần một hộp duyệt                                                                                                                                                                                       | M         |
| 21  | ⬜   | **Tab Logs**: stream `kubectl logs -f`, chọn pod/container, tail + tìm kiếm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | M         |
| 22  | ⬜   | **Exec vào pod** qua node-pty, mở như một pane terminal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | M         |
| 23  | ⬜   | **Port-forward panel** (khuôn `SshForwardPanel`): thêm/bật/tắt, hiện cổng đang mở                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | M         |
| 24  | ◐    | Lệnh ghi → duyệt đã có; `delete`/`drain` bị chặn ở mặc định vì kubectl chưa có account id để so ⇒ luôn nằm ở cột production. "Bắt gõ lại tên context" **chưa**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | M         |
| 25  | ✅   | Chip kubectl + tab **Kubernetes** trong `/infra`: bảng context, nút _Thêm cluster_ chạy `aws eks list-clusters` → `aws eks update-kubeconfig` (hỏi duyệt một lần vì là lớp `write`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | S         |
| 25b | ✅   | **Tab Kubernetes một màn** (2026-09-14): thanh ngữ cảnh + vùng bảng (Pods ⇄ Deployments) là cả trang, không cuộn cấp trang; quản lý cluster và log/describe dồn vào modal, chú thích vào popover (`assets/css/app-shell.css` khối `.ik*/.ikm-*`). Chọn cluster/namespace nạp bảng ngay (theo cú bấm, không phải auto-refresh nền). Thêm 2026-09-14: khung xương khi nạp lần đầu + làm mờ bảng khi nạp lại, khoá nút ghi (`actionBusy`) và chỉ nút của đúng hàng đang chạy mới quay, thế hệ ngữ cảnh (`loadEpoch`) bỏ kết quả về muộn sau khi đổi cluster/namespace, toast cho cả thành công lẫn thất bại (gồm cả lượt nạp hỏng và lượt chép lệnh hỏng) | S         |
| 25c | ✅   | **Tìm · lọc · Báo cáo trong tab Kubernetes** (2026-09-14): ô tìm lọc tại chỗ trong bảng đang xem (khớp tên **hoặc** bất kỳ ô nào, không RPC mới) · thanh lọc dòng trong khung log/`describe` (giấu dòng không khớp hoặc tô sáng, trần 2000 dòng có đếm ra) · mục **Báo cáo** là cách nhìn khác của hai bảng vừa nạp: đèn 4 mức, điểm sức khoẻ tự tính (55/35/10, chỉ tính phần có dữ liệu), thanh phân bố trạng thái, top khởi động lại, dải xu hướng, chép/gửi agent. _Theo dõi_ mặc định tắt, 30s/lượt, trần 15 phút, dừng khi rời mục — không có màn monitor tự nạp (`useInfraKubeReport.ts` + `InfraKubeReport.vue`)                               | M         |

### P3 — Danh tính, SSO, đánh dấu production

| #   | Việc                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 26  | `aws.whoami` + cache + hiện trong popover chip                                                                                            |
| 27  | SSO expiry từ `~/.aws/sso/cache` (chỉ `expiresAt`) + badge đếm ngược + nút điền sẵn `aws sso login`                                       |
| 28  | Đánh dấu production (account id / context name) ở Settings + nhuộm chip danger + xác nhận mạnh hơn                                        |
| 29  | Bổ sung pattern `ASIA…` vào [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts)                                                |
| 30  | Settings → Hạ tầng (mặc định app, đánh dấu production). Màn hình quản lý resource nằm ở [infra-explorer.md](infra-explorer.md), pha E1–E6 |

## Bảo mật — đối chiếu 8 invariant

| Invariant                | Áp dụng                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Key không rời sidecar | Mạnh hơn: **không vào** sidecar. Parser vứt giá trị secret tại chỗ (AWS key, k8s token/cert, tfvars); handoff bằng **tên** ngữ cảnh                            |
| 2. Path sanitize         | `~/.aws`, `~/.kube` đọc qua module riêng allowlist file cố định; thư mục tf phải nằm trong project (`assertInsideWorkspace`)                                   |
| 3. Git scope             | không chạm                                                                                                                                                     |
| 4. IPC boundary          | UI không đọc file cấu hình hạ tầng; mọi thứ qua `infra.*`                                                                                                      |
| 5. No telemetry          | Chỉ gọi API của chính người dùng; `--endpoint-url`/`--server` bị chặn                                                                                          |
| 6. No port public        | `kubectl port-forward` bind `127.0.0.1` mặc định (như SSH forward)                                                                                             |
| 7. No SSRF               | Không nhận endpoint/URL/kubeconfig path từ UI hay model                                                                                                        |
| 8. No eval / injection   | Spawn arg-array **không qua shell**; binary từ allowlist prefix + verify realpath; tên ngữ cảnh validate charset hẹp, chặn dấu `-` đầu để không hoá thành flag |

**infosec audit bắt buộc** trước khi bật tool cho agent ở mỗi pha — đây là lần đầu agent chạm hạ tầng thật.

## Câu hỏi mở

1. **Mức duyệt `auto` (nới cho nhánh đọc) có được tồn tại không?** Vẫn nới hơn luật bạn từng nêu (_"kể cả `describe`/`list` cũng phải duyệt"_). Đề xuất: **giữ, mặc định `prompt`**, chip nhuộm `warn` khi bật, bật/tắt theo từng phiên.
2. **`terraform plan` có được coi là "đọc" không?** Nó giữ state lock và cần credential thật. Đề xuất: **không** — plan luôn ở nhánh duyệt, kể cả mức `auto`.
3. **Thứ tự sau P0** — ba nhánh cùng chờ: Terraform (Plan viewer), kubectl (tool cho agent), và **Explorer E1–E2** (màn hình S3/CloudWatch/EC2). Đề xuất: **Explorer trước**, vì nó là thứ bạn mở hằng ngày và nó dựng luôn khung bảng mà các nhánh sau dùng lại.
