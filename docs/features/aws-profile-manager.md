# Feature — Quản lý profile AWS (thêm · sửa · xoá · nhập · xuất)

- **Trạng thái:** Planned — chưa code
- **ADR:** [0088 §1b — đường ghi vào `~/.aws`](../decisions/0088-session-infra-context.md)
- **Route:** `/infra` → **Tài khoản → Profiles**; vào được từ dropdown profile trên thanh ngữ cảnh ("Quản lý profile…") và từ Settings → Hạ tầng
- **Anh em:** [session-infra-context.md](session-infra-context.md) (ngữ cảnh dùng profile này), [infra-explorer.md](infra-explorer.md)

## Vì sao cần, và nó đổi gì trong thiết kế

Bản đầu của ADR 0088 chốt AWOG **chỉ đọc** `~/.aws/{config,credentials}`. Nhưng nếu người dùng phải mở terminal gõ `aws configure` mỗi lần thêm account, thì cái thanh chọn ngữ cảnh chỉ là nửa tính năng. Nên AWOG trở thành **trình soạn thảo** của hai file đó — và vì hai file đó là nhà của cả AWS CLI lẫn mọi SDK trên máy, việc ghi phải cẩn thận hơn một `writeFile` thường.

Bốn luật ghi, không có cờ tắt:

| Luật | Vì sao |
|---|---|
| **Sửa phẫu thuật, không serialize lại** | File của người dùng có comment, thứ tự khoá riêng, và khoá AWOG không mô hình hoá (`cli_pager`, `s3.*`, `endpoint_url`, cấu hình của tool khác). Parse-rồi-ghi-lại sẽ xoá sạch chúng. Chỉ đụng đúng những dòng đổi |
| **Sao lưu trước mỗi lần ghi** | `~/.awog/aws-backups/<file>.<timestamp>`, chmod 600, giữ 20 bản gần nhất. File này hỏng thì người dùng mất quyền vào mọi thứ — bảo hiểm quá rẻ so với rủi ro |
| **Ghi nguyên tử + đúng quyền** | tmp → `chmod 600` → rename, khuôn [mcp/store.ts](../../apps/desktop/sidecar/src/mcp/store.ts). `credentials` phải giữ `0600` sau khi ghi |
| **Agent KHÔNG có đường ghi này** | Không có tool `profile_create`/`profile_delete`. CRUD profile là bề mặt **chỉ của con người** — agent đọc được danh sách (tên/region/kind) và chuyển ngữ cảnh, nhưng không tạo/sửa/xoá credential |

Đường **đọc** vẫn nguyên như cũ: liệt kê profile không bao giờ nạp giá trị secret, chỉ `hasStaticKeys: boolean`. Secret chỉ đi qua sidecar **trong đúng một lần ghi**, không lưu lại, không log, không vào event, không vào nhật ký lệnh, không vào context của model.

## Màn hình

```
┌ /infra → Tài khoản ───────────────────────────────────────────────────┐
│ [+ Thêm profile] [⬇ Nhập ▾] [⬆ Xuất ▾]            [tìm profile…]     │
├──────────────────────────┬────────────────────────────────────────────┤
│ SSO (2)                  │  Offshore-Developer            ● mặc định  │
│  ● Offshore-Developer    │  ─────────────────────────────────────────  │
│    229015218011 · 3h12m  │  Kiểu        SSO                            │
│  ○ readonly-audit        │  Start URL   https://d-9xx.awsapps.com/…    │
│ STATIC (1)               │  Account     229015218011  Role  Offshore…  │
│  ● default               │  Region      ap-southeast-1                 │
│    AKIA…7TQ2 · 2 dự án   │  Hết hạn     còn 3 giờ 12 phút              │
│ ASSUME ROLE (1)          │  Dùng ở      2 project · 1 phiên đang mở    │
│  ○ prod-deploy           │  ───────────────────────────────────────── │
│    → default · MFA       │  [Kiểm tra danh tính] [Sửa] [Nhân bản]      │
│                          │  [Đặt làm mặc định]           [Xoá]         │
└──────────────────────────┴────────────────────────────────────────────┘
```

Danh sách nhóm theo **kiểu** (SSO · static · assume-role · process), vì kiểu quyết định form sửa và cả cách xử lý hết hạn. Mỗi dòng: tên · account id (khi biết) · dấu hiệu hết hạn · **đang được dùng ở đâu** (số project + phiên) — cái cuối để không ai xoá nhầm profile mà ba phiên đang chạy trên đó.

## Form theo kiểu profile

| Kiểu | Trường | Ghi vào |
|---|---|---|
| **Static** | access key id · secret access key (ô password) · session token (tuỳ chọn) · region · output | `credentials` (khoá) + `config` (region/output) |
| **SSO** | sso_session **hoặc** start URL + sso region · account id · role name · region | `config` (không có secret nào — token nằm ở `~/.aws/sso/cache`) |
| **Assume role** | role_arn · source_profile (chọn từ danh sách) · mfa_serial · external_id · duration | `config` |
| **Process** | `credential_process` | **Chỉ đọc ở v1** |

`credential_process` chỉ-đọc là một cắt phạm vi có chủ đích: dòng đó là **một lệnh sẽ chạy mỗi lần CLI cần credential**. Để AWOG ghi nó vào đây là mở một đường thực thi lệnh tuỳ ý nằm ngoài mọi cổng quyền của app. Ai cần thì sửa file trực tiếp — AWOG hiện nội dung và nút mở file.

Sau khi lưu, form đề nghị luôn **Kiểm tra danh tính** (`sts get-caller-identity`) — profile sai chỉ phát hiện được bằng cách gọi thử, và phát hiện ngay lúc vừa tạo thì rẻ hơn nhiều so với lúc đang chữa cháy.

Validate: tên profile `^[A-Za-z0-9._@:/+=-]{1,128}$` + không trùng (hiện cảnh báo khi trùng, cho phép **ghi đè** có xác nhận); access key id khớp `^(AKIA|ASIA)[A-Z0-9]{16}$` thì thôi, lệch thì **cảnh báo chứ không chặn** (AWS có định dạng khác cho vài loại khoá).

## Nhập

| Nguồn | Luồng | Ghi chú |
|---|---|---|
| **Dán khối từ SSO portal** | Dán nguyên cụm `[229015218011_Offshore-Developer] aws_access_key_id=… aws_secret_access_key=… aws_session_token=…` → parse → xem trước → đặt tên → lưu | Luồng phổ biến nhất. Ô dán là password-field, **xoá sạch sau khi lưu** |
| **File `credentials`/`config` khác** | Chọn file → hiện danh sách profile tìm thấy → tick cái nào nhập → xử lý trùng tên (đổi tên · ghi đè · bỏ qua) | Máy cũ, hoặc đồng nghiệp gửi |
| **CSV của IAM console** | File `*_accessKeys.csv` tải về khi tạo access key → đọc 2 cột → tạo profile | |
| **Từ SSO (khám phá)** | Nhập start URL + region → `aws sso login` (mở trình duyệt) → `sso list-accounts` + `list-account-roles` → **tick hàng loạt** account/role muốn tạo profile | Giá trị cao nhất: một lần là có đủ profile cho cả tổ chức, và **không sinh ra secret dài hạn nào** |
| **Từ `~/.aws` sẵn có** | Không cần nhập — AWOG đọc trực tiếp | |

Mọi luồng nhập đều đi qua **màn xem trước**: thấy sẽ tạo/ghi đè profile nào, vào file nào, trước khi có gì chạm đĩa.

## Xuất

Hai chế độ, và mặc định là chế độ an toàn:

| Chế độ | Xuất gì | Rào |
|---|---|---|
| **Cấu hình** (mặc định) | Tên profile, region, output, `sso_*`, `role_arn`, `source_profile` — **không** khoá | Không rào. Đây là thứ chia sẻ được cho đồng đội, commit được vào repo nội bộ |
| **Gồm cả khoá** | Thêm `aws_access_key_id` + `aws_secret_access_key` | Gõ lại tên profile để xác nhận · cảnh báo rõ · ghi nhật ký · file ghi ra `chmod 600` |

Một câu tôi sẽ nói ở ngay chỗ đó, một lần, không lặp lại: static key xuất ra file là **thứ rủi ro nhất** trong cả họ tính năng này — nó không hết hạn, không truy vết được ai dùng, và đi theo file. Nếu mục tiêu là để đồng đội dùng chung account thì xuất **cấu hình SSO** rồi để mỗi người tự `sso login` sẽ đạt cùng kết quả mà không ai phải cầm khoá của ai.

Ngoài ra có **Sao chép lệnh tương đương** (`aws configure set …`) cho ai muốn tự chạy thay vì để AWOG ghi file.

## Xoá

Hộp xác nhận nêu đủ ba điều: profile nằm ở **file nào** (`config`, `credentials`, hay cả hai), **đang được dùng ở đâu** (project/phiên nào), và **có sao lưu** ở đâu để khôi phục. Profile đang là mặc định của app thì phải chọn profile thay thế trước.

Xoá profile **không** đụng `~/.aws/sso/cache` — token SSO là của start URL, không của riêng profile.

## Kubernetes và Terraform thì sao

v1 chỉ quản lý profile AWS. Kube context hiện **danh sách chỉ đọc** + nút mở `~/.kube/config` — sửa kubeconfig rủi ro hơn hẳn (`exec` plugin, client cert nhúng, cụm được tool khác quản), nên chờ nhu cầu thật rồi mở, không đoán trước. Terraform không có khái niệm "profile" riêng: nó dùng chính profile AWS ở đây.

## Lộ trình

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **A1** | Trình soạn INI phẫu thuật (giữ comment/thứ tự/khoá lạ) + sao lưu + ghi nguyên tử + test bảng | M |
| **A2** | Màn Profiles: danh sách nhóm theo kiểu · chi tiết · đặt mặc định · kiểm tra danh tính | M |
| **A3** | Thêm / sửa / nhân bản / xoá — form theo kiểu, validate, xác nhận có ngữ cảnh | M |
| **A4** | Nhập: dán khối · file credentials/config · CSV của IAM — có màn xem trước | M |
| **A5** | Nhập từ SSO (list-accounts / list-account-roles, tick hàng loạt) | M |
| **A6** | Xuất cấu hình · xuất kèm khoá có rào · sao chép lệnh `aws configure set` | S |

Phụ thuộc: P0 của [session-infra-context.md](session-infra-context.md) (parser + `infra.run`). A1 là phần dễ bị xem nhẹ nhất và cũng dễ làm hỏng file của người dùng nhất — làm trước và có test trước.

## Bảo mật

| Rủi ro | Xử lý |
|---|---|
| Secret đi qua IPC | Chỉ trong **một** lần ghi, không lưu lại, không log, không event, không nhật ký lệnh, không vào context model. Ô nhập là `type=password`, xoá sau khi lưu |
| Agent lạm dụng | **Không có tool ghi profile.** Agent đọc được tên/region/kind và đổi ngữ cảnh (qua ma trận quyền), không tạo/sửa/xoá được credential |
| Ghi hỏng file | Sửa phẫu thuật + sao lưu 20 bản + ghi nguyên tử + verify đọc lại sau khi ghi |
| Quyền file | `credentials` giữ `0600`; thư mục `~/.awog/aws-backups` `0700` |
| `credential_process` | Chỉ đọc ở v1 — không để AWOG ghi một lệnh sẽ tự chạy ngoài mọi cổng quyền |
| Xuất kèm khoá | Mặc định tắt, gõ tên xác nhận, ghi nhật ký, file `0600` |

**infosec audit bắt buộc** trước A3 (lần đầu secret đi từ UI vào sidecar) và trước A6.
