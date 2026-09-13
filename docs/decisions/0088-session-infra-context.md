# 0088 — Ngữ cảnh hạ tầng ghim theo phiên: tool có ràng buộc, không phải env gợi ý

- **Trạng thái:** Proposed
- **Ngày:** 2026-09-12
- **Người quyết định:** tech-lead + user
- **Spec:** [docs/features/session-infra-context.md](../features/session-infra-context.md)

## Bối cảnh

AWOG chạy lệnh ở ba bề mặt — terminal PTY, `Bash` tool của agent, task node — và cả ba đều có thể gọi `aws`, `terraform`, `kubectl`. Hôm nay không bề mặt nào biết *đang trỏ vào account/cluster/workspace nào*: `AWS_PROFILE` không có trong `ALLOW_ENV` của [runtime/tools/shell.ts](../../apps/desktop/sidecar/src/runtime/tools/shell.ts), cũng không có trong env đã lọc của [terminal/manager.ts](../../apps/desktop/sidecar/src/terminal/manager.ts). Lệnh chạy bằng `default` — mà `default` rất thường là production.

Yêu cầu người dùng chốt (2026-09-12): **trong màn Session chọn được ngữ cảnh hạ tầng và tương tác với đúng cái đã chỉ định**, cho cả AWS, Terraform lẫn kubectl.

Ràng buộc:

- Lệnh hạ tầng là **nhạy cảm**: kể cả `describe`/`list`/`plan` cũng phải xin duyệt; `apply`/`destroy` thì không bao giờ tự chạy.
- Máy dev đang có `aws-cli 2.35.9`, `terraform v1.15.8`, `kubectl v1.33.9`, `~/.aws/credentials` với **static key thật** (2 profile) và `~/.kube/config` có context. Mọi thiết kế kéo các giá trị đó vào tiến trình AWOG là tự tạo bề mặt rò rỉ mới ngay cạnh transcript, log, trace.
- `~/.aws` và `~/.kube` nằm **ngoài** workspace ⇒ `fs.*` ([ADR 0022](0022-fs-read-write-search-ipc.md)) chặn.
- Nút **"Always allow"** của [ADR 0080](0080-command-scoped-permission-rules.md) nhớ luật theo nội dung lệnh, nhưng `Bash(aws *)` vẫn là pattern hợp lệ — người dùng vẫn có thể cấp trọn quyền cloud bằng một cú bấm.

## Quyết định

### 1. AWOG không sở hữu credential hạ tầng. Handoff là **tên ngữ cảnh**.

Nguồn sự thật vẫn là `~/.aws/{config,credentials}`, `~/.kube/config`, và các file `*.tf` trong repo — nhà gốc của chính công cụ đó, đúng tinh thần [ADR 0070](0070-share-claude-home-for-config.md). AWOG đọc **metadata** (tên profile/context/workspace, region, namespace, backend) và truyền đi **tên**; tiến trình con tự resolve credential.

Parser của cả ba là allowlist-key: `aws_secret_access_key`, `aws_session_token`, `client-certificate-data`, `client-key-data`, `token`, nội dung `*.tfvars` — bị vứt **tại chỗ trong hàm parse**, không vào object, không lên IPC. AWS key chỉ còn quy thành `hasStaticKeys: boolean`. Không keychain `awog-aws`/`awog-k8s`, không store trong `~/.awog`.

Hệ quả phụ đáng giá: bộ lọc `SENSITIVE_SUFFIX` của terminal (`/(_TOKEN|_KEY|_SECRET)$/i`) **giữ nguyên** — nó vẫn chặn `AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, còn `AWS_PROFILE` (không phải secret) đi qua được.

### 1b. Ngoại lệ có kiểm soát: CRUD profile **được** ghi vào `~/.aws`.

Nếu thêm một account vẫn phải mở terminal gõ `aws configure` thì thanh chọn ngữ cảnh chỉ là nửa tính năng. Nên AWOG là **trình soạn thảo** của hai file đó, dưới bốn luật không có cờ tắt: **sửa phẫu thuật** (giữ comment, thứ tự khoá, và khoá AWOG không mô hình hoá — không serialize lại cả file), **sao lưu trước mỗi lần ghi** (`~/.awog/aws-backups/`, 20 bản), **ghi nguyên tử + `chmod 600`**, và **agent không có đường ghi này** (không tồn tại tool `profile_create`/`profile_delete` — CRUD credential là bề mặt chỉ của con người).

Đường đọc không đổi: liệt kê profile không bao giờ nạp giá trị secret. Secret chỉ đi UI → sidecar → file trong **đúng một** lần ghi; không lưu lại, không log, không event, không nhật ký lệnh, không vào context model. Chi tiết: [aws-profile-manager.md](../features/aws-profile-manager.md).

### 2. Không có store mới; watcher thay cho state.

Danh sách ngữ cảnh **derive** mỗi lần gọi; chokidar trên `~/.aws`, `~/.kube/config`, `**/.terraform/` bắn `infra.fs-changed`. Thứ AWOG persist là *lựa chọn*: `SessionHeader.infra` (tầng chính, đóng băng lúc tạo phiên) → `Project.infra` → `settings.infra`, khuôn `githubAccount` đã chạy.

### 3. Gọi CLI bằng arg array, **không** thêm SDK (`@aws-sdk/*`, `@kubernetes/client-node`).

SDK là dependency lớn và buộc sidecar phải tự cầm credential để ký request — phá thẳng quyết định 1. Shell-out: zero dep mới, credential không vào tiến trình AWOG, tái dùng khuôn spawn đã có ở [vpn/binary.ts](../../apps/desktop/sidecar/src/vpn/binary.ts) (allowlist prefix + verify realpath) và `git/runner.ts` (arg array, không shell string). Giá phải trả: phụ thuộc CLI có mặt trên máy (đã có cả ba) và parse JSON stdout.

### 4. Tool có **ràng buộc ngữ cảnh phía sidecar** — không phải tiêm env rồi để agent gõ `Bash`.

Đây là điểm đảo so với bản nháp đầu của ADR này (bản đầu: *"không có tool `aws_*`, agent dùng `Bash`"*). Yêu cầu "**được chỉ định**" làm phương án env sai về bản chất: env chỉ là *mặc định*, model hoàn toàn có thể viết `aws --profile prod …`, `kubectl --context prod …`, hay `AWS_PROFILE=prod aws …` và thoát khỏi ngữ cảnh đã chọn. Env là gợi ý; tool có ghim mới là chỉ định.

Nên: `aws_cli` / `tf_cli` / `kubectl_cli`, mỗi cái nhận **`args: string[]`** (không phải chuỗi shell ⇒ không spawn shell ⇒ không `|`, `&&`, `$(…)`, không injection), và sidecar:

- **chèn** cờ ngữ cảnh của phiên (`--profile`/`--region`, `-chdir`/workspace, `--context`/`--namespace`);
- **từ chối** nếu `args` tự mang cờ ghi đè, hoặc `--endpoint-url`/`--server`/`--kubeconfig`/`--no-verify-ssl`/`--ca-bundle` (bề mặt SSRF, invariant 7), với lỗi nói thẳng *"ngữ cảnh do phiên chỉ định, không ghi đè được"*.

### 5. Phân loại lệnh là **trục**, không phải kết luận. Kết luận nằm ở một bảng cài đặt.

`classify(args) → 'read' | 'write' | 'destructive' | 'context-switch'` — bốn **lớp**, không phải bốn mức quyền:

- **read** — `describe-*`/`list-*`/`get-*`/`ls` (aws), `validate`/`state list`/`output` (tf), `get`/`describe`/`logs`/`events`/`top` (k8s).
- **write** — tạo/sửa/scale/deploy, **và mọi thứ không nhận ra** (fail-safe: động từ lạ đắt nhất là một lần hỏi thừa). `terraform plan` ở đây vì nó giữ state lock.
- **destructive** — `delete-*`/`terminate-*`/`destroy`/`state rm`/`drain`/xoá hàng loạt.
- **context-switch** — chính agent tự đổi account/cluster/workspace đang ghim.

Quyền của mỗi lớp do **ma trận cài đặt** quyết định (Settings → Hạ tầng), ba lựa chọn mỗi ô: **Tự động** (agent chạy thẳng, không hỏi) · **Hỏi** (park chờ người duyệt) · **Chặn** (hiện lệnh để người tự chạy). Ma trận có hai cột: account thường và **account đánh dấu production**.

Mặc định xuất xưởng: read = Tự động / Tự động · write = Hỏi / Hỏi · destructive = Hỏi / **Chặn** · context-switch = Tự động / Hỏi.

Đây là **đảo** so với bản nháp trước của ADR này, vốn khoá cứng `forbidden` ở mức mã nguồn. Người dùng chốt (2026-09-12): *"agent có quyền thao tác toàn bộ, nhưng phải có setting gate là có thể bypass hoặc chờ human duyệt"*. Khoá cứng là quyết định của người viết app; ma trận là quyết định của người **sở hữu account** — và họ đúng chỗ hơn để quyết. Cái phải giữ lại không phải lệnh cấm, mà là **ba tính chất của bypass**:

1. **Nhìn thấy được** — bypass đang bật thì chip ngữ cảnh nhuộm cảnh báo ở mọi bề mặt, và mỗi lệnh tự động chạy đều bắn toast *"đã chạy X trên account Y"*.
2. **Ghi lại được** — mọi lệnh write/destructive, **kể cả khi Tự động**, vào ring buffer nhật ký lệnh (khuôn [git-command-log](../features/git-command-log.md)); trả lời được câu *"app đã làm gì trên account của tôi"*.
3. **Hết hạn được** — có **bypass tạm thời** (15/30/60 phút) cho lúc xử lý sự cố, hết giờ tự về ma trận. Bật vĩnh viễn là một lựa chọn, không phải mặc định vô tình.

### 5b. Settings là **trần**, phiên chỉ **siết**.

Ma trận ở Settings đặt quyền tối đa. Chip ngữ cảnh trong phiên hạ thấp được (ví dụ phiên này chỉ đọc) nhưng **không nâng lên được**. Nếu nâng được thì một phiên bị dẫn dụ có thể tự mở khoá cho chính nó — đúng lỗ hổng mà [ADR 0080](0080-command-scoped-permission-rules.md) vừa vá ở tầng khác.

### 6. `Bash(aws …)` đi vào cùng ma trận, không có cửa sau riêng.

Đường `Bash` vẫn còn (agent cần `sam`, `helm`, script riêng). Nhưng `aws`, `terraform`, `kubectl`, `helm`, `gcloud`, `az` chạy qua `Bash` được **phân loại bằng chính `classify()`** rồi áp đúng ma trận — và nút "Always allow" của ADR 0080 **không** phủ được chúng, vì nếu phủ được thì có hai nguồn sự thật về quyền hạ tầng và người dùng sẽ tin nhầm cái yếu hơn. Muốn cho chạy thẳng thì mở ở ma trận, nơi nhìn thấy được và hết hạn được.

Prompt duyệt luôn hiển thị **dòng lệnh đầy đủ + ngữ cảnh đang ghim** (profile/account id, thư mục/workspace, context/namespace) — không phải một chữ "cho phép kubectl".

### 7. Ngữ cảnh là **của không gian làm việc**, không phải của riêng màn chat.

Một ngữ cảnh hiệu lực tại một thời điểm, hiện ở **mọi** bề mặt hạ tầng (Explorer, graph, playbook, terminal, phiên) qua cùng một control. Mỗi view **không** có picker account riêng — có picker riêng là có cách để hai bảng cạnh nhau nói về hai account khác nhau mà không ai nhận ra. Thứ tự kế thừa: phiên (nếu đang trong phiên) → project → toàn app. Đổi ngữ cảnh thì mọi cache view bị vô hiệu và nạp lại, và mỗi bảng ghi rõ nó thuộc account nào.

## Phương án đã cân nhắc

- **Import credential vào keychain `awog-aws`/`awog-k8s`** (khuôn SSH/VPN) — từ chối: nhân đôi bí mật đã có nhà, tạo bề mặt rò rỉ mới, và phải tự viết lại vòng đời SSO/assume-role/exec-plugin mà CLI đã làm đúng.
- **SDK trong sidecar** — từ chối: dependency lớn cần ADR riêng, và buộc sidecar cầm credential (phá quyết định 1). Cân nhắc lại nếu explorer cần phân trang/stream mà CLI quá chậm.
- **Chỉ tiêm env, agent dùng `Bash`** (bản nháp đầu của chính ADR này) — từ chối: không thực thi được chữ "chỉ định", xem quyết định 4.
- **Cho `auto` nới cả lệnh ghi** — từ chối: mâu thuẫn trực tiếp với yêu cầu người dùng; `auto` chỉ nới nhánh đọc.
- **Ghi thẳng vào `~/.aws` cho MỌI thay đổi** — từ chối: AWOG ghim *lựa chọn ngữ cảnh* của riêng nó, không sửa file gốc chỉ vì bạn đổi profile đang dùng. Nhưng xem §1b: CRUD profile thì có ghi, vì đó là việc người dùng chủ động yêu cầu.

## Hệ quả

- **Tích cực:** ngữ cảnh hạ tầng hiện ngay trên context strip trước khi lệnh chạy; agent không thể lén đổi account/cluster; zero dep mới; không có bí mật mới nào sinh ra trong AWOG; một khuôn `InfraAdapter` phục vụ cả ba công cụ (và mở đường cho `gcloud`/`az` sau).
- **Trade-off:** phụ thuộc CLI có trên máy; không phủ credential nằm ngoài file cấu hình (biến env, ECS task role, `exec` plugin của kubeconfig) — chấp nhận, và `infra.contexts` nói rõ "không tìm thấy" thay vì đoán.
- **Trade-off:** `classify()` theo động từ là heuristic; động từ lạ rơi vào `write` (fail-safe) nên chi phí sai là *hỏi thừa*, không phải *chạy nhầm*. Danh sách cần bảo trì khi CLI thêm subcommand.
- **Trade-off:** `filteredShellEnv()` đổi chữ ký ⇒ chạm 3 call site (`bash-tool.ts:131`, `search-backend.ts:94,133`) và phải luồn context phiên xuống chỗ spawn.
- **Việc cần làm tiếp:** infosec audit trước khi bật tool ở **mỗi** pha; bổ sung pattern `ASIA…` vào [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts); chốt hai câu hỏi mở trong spec (`auto` có tồn tại không, thứ tự Terraform/kubectl).

## Tham chiếu

- [ADR 0064](0064-session-ssh-link.md) / [ADR 0063](0063-ssh-manager-ssh2-runtime.md) — khuôn Session↔tài nguyên ngoài, và lý do hạ tầng cần thêm cấp `forbidden`
- [ADR 0080](0080-command-scoped-permission-rules.md) — luật quyền theo nội dung lệnh (quyết định 6 vá tiếp lỗ hổng của nó)
- [ADR 0070](0070-share-claude-home-for-config.md) — config sống chung nhà với công cụ gốc
- [ADR 0022](0022-fs-read-write-search-ipc.md) — `assertInsideWorkspace`
- [ADR 0019](0019-pty-terminal-in-sidecar.md) — PTY, nền cho `kubectl exec`
- [.claude/rules/security.md](../../.claude/rules/security.md) — 8 invariant
