# Prompt khởi động — Mốc 1: Quản lý tài khoản AWS

> Dán nguyên file này vào phiên mới. Viết cho người/agent chưa đọc phiên trước.

## Bối cảnh

Repo **AWOG** (`/Users/kyro/KyroTech/Projects/awog`). Đang xây họ tính năng **Hạ tầng** — cho phép người dùng và agent làm việc với AWS/Kubernetes/Terraform ngay trong app.

**Mốc 0 đã xong và đã commit** trên nhánh `feature/aws-infra` (4 commit, đi trước `main` 4 commit). Bắt đầu bằng:

```bash
git switch feature/aws-infra
```

⚠ Cây làm việc có sẵn ~77 file dở dang **không liên quan** đến hạ tầng (browser panel, ssh forward, theme-cute, prototype.css…). Đừng commit chúng. Chỉ commit file thuộc phạm vi mốc này.

## Đọc trước khi code

| Thứ tự | Tài liệu | Vì sao |
|---|---|---|
| 1 | `docs/decisions/0088-session-infra-context.md` | ADR gốc — luật nền của cả họ |
| 2 | `docs/features/aws-profile-manager.md` | **Spec của chính Mốc 1** |
| 3 | `docs/features/infra.tasks.md` | Kế hoạch 8 mốc; mục "Mốc 0 — trạng thái thực tế" ở cuối liệt kê 6 bản vá bảo mật và phần còn nợ |
| 4 | `.claude/rules/security.md` | 8 invariant AWOG |
| 5 | `.claude/rules/nuxt-vue.md` | Guard design-token sẽ làm `pnpm lint` FAIL nếu vi phạm |

## Mốc 0 để lại gì cho bạn dùng

**Sidecar** (`apps/desktop/sidecar/src/`)
- `infra/aws/ini.ts` — parser INI **allowlist-key**, secret bị vứt ngay trong vòng lặp parse (chỉ còn `hasStaticKeys`/`hasSessionToken` boolean)
- `infra/aws/profiles.ts` — `listAwsProfiles()`, `awsConfigPath()`, `awsCredentialsPath()` (đã export sẵn cho Mốc 1)
- `infra/run.ts` — `runInfra()`, cổng DUY NHẤT ra CLI
- `infra/policy.ts` + `policy-store.ts` — ma trận quyền
- `infra/audit/store.ts` — nhật ký JSONL, `recordInfraAction()`
- `methods/infra.{status,contexts,run,policy,set-session-context}.ts`

**UI** (`apps/desktop/ui-next/`)
- `composables/useInfraContext.ts` + `utils/infra-context.ts` — resolver 3 tầng
- `components/session/InfraChip.vue` — chip ngữ cảnh trong context strip
- `composables/useConfirm.ts` — popup xác nhận, đã có chế độ `kind: 'infra'` 4 biến thể

## Việc của Mốc 1 (A1–A6 trong `aws-profile-manager.md`)

| # | Việc | Cỡ |
|---|---|---|
| **A1** | **Trình soạn INI phẫu thuật** — giữ comment, thứ tự khoá, và khoá AWOG không mô hình hoá; sao lưu 20 bản ở `~/.awog/aws-backups/`; ghi nguyên tử + `chmod 600`; verify đọc lại sau khi ghi | L |
| A2 | Màn `/infra` → Tài khoản: danh sách nhóm theo kiểu · chi tiết · đặt mặc định · kiểm tra danh tính | M |
| A3 | Thêm / sửa / nhân bản / xoá — form theo kiểu (static · SSO · assume-role; `process` **chỉ đọc**) | M |
| A4 | Nhập: dán khối · file credentials/config · CSV của IAM — **màn xem trước** trước khi chạm đĩa | M |
| A5 | Nhập từ SSO: `sso login` → `list-accounts` + `list-account-roles` → tick hàng loạt | M |
| A6 | Xuất: cấu hình (không khoá) · kèm khoá có rào gõ-tên · sao chép lệnh `aws configure set` | S |

**A1 là phần dễ bị xem nhẹ nhất và dễ làm hỏng file của người dùng nhất. Làm trước, viết test trước.**

## Luật cứng — đừng phá

1. **Bốn luật ghi vào `~/.aws`** (ADR 0088 §1b): sửa phẫu thuật · sao lưu trước mỗi lần ghi · ghi nguyên tử + `chmod 600` · **agent KHÔNG có đường ghi này** (không tạo tool `profile_create`/`profile_delete`).
2. **Secret chỉ đi UI → sidecar trong ĐÚNG một lần ghi.** Không lưu lại, không log, không event, không nhật ký lệnh, không vào context model. Ô nhập là `type=password`, xoá sau khi lưu.
3. **`credential_process` chỉ đọc ở v1** — để AWOG ghi dòng đó là mở một đường thực thi lệnh tuỳ ý ngoài mọi cổng quyền.
4. **Xuất kèm khoá: mặc định TẮT**, gõ tên xác nhận, ghi nhật ký, file `0600`.
5. **Tên profile** validate `^[A-Za-z0-9._@:/+=-]{1,128}$` — KHÔNG dùng `SSH_ID_RE`; máy dev có profile thật tên `229015218011_Offshore-Developer`.
6. **Mọi thao tác ghi vào nhật ký** qua `recordInfraAction`.

## Quy ước code

- TS strict, **cấm `any`**; import nội bộ sidecar có đuôi `.js`
- Comment kỹ thuật **tiếng Việt**, identifier/log **tiếng Anh**
- Vue: `<script setup lang="ts">`, `AppSelect` chứ không `<select>` native, màu qua `useTheme()`, **cấm hardcode hex / `font-size` px tuỳ ý / `border-radius: <n>px`**
- ⚠ Bẫy đã biết: template ref dùng `useTemplateRef('x')`, KHÔNG `ref<HTMLElement>(null)`
- i18n en + vi đủ cặp, file riêng trong `i18n/locales/{en,vi}/` (glob-merge theo area)
- **Không thêm dependency** — repo chưa wire vitest runner nhưng `npx vitest@2 run <file>` chạy được

## Nghiệm thu

```bash
cd apps/desktop/sidecar && pnpm typecheck && npx vitest@2 run
cd apps/desktop/ui-next && pnpm typecheck && pnpm lint
```

Tất cả EXIT 0. Hiện tại: **939 test sidecar xanh**, đừng làm đỏ.

Ngoài typecheck, **đo thật**: chạy trình soạn INI trên một bản sao `~/.aws` trong thư mục tạm, chứng minh comment và khoá lạ còn nguyên sau khi sửa một profile.

## Món nợ của Mốc 0 — biết để không ngạc nhiên

1. **Chưa ai chạy thử trong Electron thật.** Mọi kiểm chứng là unit test + probe biên dịch. Chip / popup / thẻ duyệt / watcher chưa ai thấy render. Nếu bạn mở app và thấy sai, đó là bug thật chứ không phải bạn hiểu nhầm.
2. **`Bash` chưa nhận `AWS_PROFILE`** — `bash-tool.ts` vẫn gọi `filteredShellEnv()` trần, nên lệnh qua `Bash` chạy bằng profile `default`. Cổng quyền vì thế chấm nhánh Bash theo cột `production` vô điều kiện (giải pháp tạm). Luồn env xuống thì gỡ được cách tạm này.
3. **`~/.awog` vẫn trong tầm ghi của agent qua `Bash`** — hàng rào hiện tại chặn theo chuỗi đường dẫn, là độ sâu chứ không kín.
4. **`describeInfraCommand` (permission.ts) là bản sao có chủ đích** của `withContext()` (run.ts). Gộp khi được phép chạm cả hai.
5. **Quyết định còn treo, cần hỏi người dùng:** mặc định `read = auto` cho phép agent tự chạy `logs get-log-events` / `filter-log-events` trên **production** rồi đẩy log ứng dụng vào context model. CloudWatch là nơi credential/PII hay nằm nhất trong allowlist `read`. Hai lựa chọn: bỏ nhóm `logs` khỏi auto, hoặc đặt `read/production = ask`.

## Hai bài học từ Mốc 0 — áp dụng lại

**Test có thể đang khoá lại chính lỗ hổng.** Hai lần trong Mốc 0, một ca test khẳng định đúng hành vi nguy hiểm (`matches the whole flag name, not a prefix of it`, và `không có accountId thì tính vào cột tài khoản thường`). Khi sửa bảo mật mà test đỏ, hãy đọc xem test đang bảo vệ điều gì trước khi cho rằng code sai.

**Danh sách cấm là allowlist trá hình.** Nhận diện `read` bằng tiền tố động từ cho phép mọi thứ chưa kịp nghĩ tới. Ở Mốc 1, luật tương đương là: **allowlist khoá INI**, không phải denylist khoá secret.
