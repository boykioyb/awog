# Feature — Quản lý profile AWS (thêm · sửa · xoá · nhập · xuất)

- **Trạng thái:** Shipped 2026-09-13 (A1–A6) — còn nợ một lượt **infosec re-audit** cho A3/A5/A6 (xem "Điểm lệch có chủ đích" ở cuối)
- **ADR:** [0088 §1b — đường ghi vào `~/.aws`](../decisions/0088-session-infra-context.md)
- **Route:** `/infra` → **Tài khoản → Profiles**; vào được từ dropdown profile trên thanh ngữ cảnh ("Quản lý profile…") và từ Settings → Hạ tầng
- **Anh em:** [session-infra-context.md](session-infra-context.md) (ngữ cảnh dùng profile này), [infra-explorer.md](infra-explorer.md)

## Vì sao cần, và nó đổi gì trong thiết kế

Bản đầu của ADR 0088 chốt AWOG **chỉ đọc** `~/.aws/{config,credentials}`. Nhưng nếu người dùng phải mở terminal gõ `aws configure` mỗi lần thêm account, thì cái thanh chọn ngữ cảnh chỉ là nửa tính năng. Nên AWOG trở thành **trình soạn thảo** của hai file đó — và vì hai file đó là nhà của cả AWS CLI lẫn mọi SDK trên máy, việc ghi phải cẩn thận hơn một `writeFile` thường.

Bốn luật ghi, không có cờ tắt:

| Luật                                    | Vì sao                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sửa phẫu thuật, không serialize lại** | File của người dùng có comment, thứ tự khoá riêng, và khoá AWOG không mô hình hoá (`cli_pager`, `s3.*`, `endpoint_url`, cấu hình của tool khác). Parse-rồi-ghi-lại sẽ xoá sạch chúng. Chỉ đụng đúng những dòng đổi |
| **Sao lưu trước mỗi lần ghi**           | `~/.awog/aws-backups/<file>.<timestamp>`, chmod 600, giữ 20 bản gần nhất. File này hỏng thì người dùng mất quyền vào mọi thứ — bảo hiểm quá rẻ so với rủi ro                                                       |
| **Ghi nguyên tử + đúng quyền**          | tmp → `chmod 600` → rename, khuôn [mcp/store.ts](../../apps/desktop/sidecar/src/mcp/store.ts). `credentials` phải giữ `0600` sau khi ghi                                                                           |
| **Agent KHÔNG có đường ghi này**        | Không có tool `profile_create`/`profile_delete`. CRUD profile là bề mặt **chỉ của con người** — agent đọc được danh sách (tên/region/kind) và chuyển ngữ cảnh, nhưng không tạo/sửa/xoá credential                  |

Đường **đọc danh sách** vẫn nguyên như cũ: liệt kê profile không bao giờ nạp giá trị secret, chỉ `hasStaticKeys: boolean`.

**Cập nhật 2026-09-14 — form sửa hiển thị khoá hiện tại.** Ba ô secret của form sửa trước đây là placeholder ("để trống = giữ nguyên") vì không có đường đọc nào trả giá trị. Người dùng không nhìn thấy khoá nào đang nằm trên đĩa, nên sửa một ký tự bị gõ sai là phải dán lại cả cặp. Nay có **một** đường đọc secret, hẹp và có kiểm soát:

|                                    | Trước               | Nay                                                      |
| ---------------------------------- | ------------------- | -------------------------------------------------------- |
| Liệt kê profile (`infra.contexts`) | không có secret     | **không đổi** — vẫn chỉ `hasStaticKeys`                  |
| Mở form sửa một profile tĩnh       | không đọc gì        | `infra.profile-secrets` → ba khoá vào form               |
| Kiểm tra danh tính                 | chỉ sau khi **lưu** | nút **Kiểm tra** trong form, chạy được **trước** khi ghi |

Ba ràng buộc của đường đọc mới: (1) đúng MỘT profile theo TÊN, người dùng mở form mới gọi; (2) chỉ ba khoá trong allowlist của `infra/aws/secret-read.ts`, mọi khoá khác bị bỏ tại chỗ trong vòng lặp parse; (3) mỗi lần đọc để lại **một dòng nhật ký** (`tool: profile_secrets`, chỉ có tên profile) — cùng loại với "xuất kèm khoá", vì đây là hành động lấy credential ra khỏi `~/.aws`. Method này là **bề mặt của con người**: không AgentTool nào map tới, và nó không nằm trong catalogue Remote Gateway.

Secret vì thế đi qua IPC theo **hai chiều** (đọc khi mở form, ghi khi lưu), vẫn không lưu lại trong store/log/event/nhật ký, và vẫn bị `clearSecrets()` xoá khỏi state renderer ngay khi lưu xong hoặc đóng modal.

**Cập nhật 2026-09-14 (khuya 2) — Region trống không còn được ghi trong im lặng.** Người dùng báo: _"tôi đặt Region rồi mà khi lưu xong ra ngoài vẫn hiển thị chưa có"_. Điều thực sự xảy ra đọc được từ dấu vết trên máy, không phải suy đoán:

| Bằng chứng                                                                                                                        | Cho biết                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `~/Library/Logs/@awog/desktop/main.log` 01:32:13.932 — `aws: ini unchanged, skipping write` cho **cả** `config` lẫn `credentials` | Lượt Lưu đó không ghi gì: payload không mang `region` (và `output: json` đã nằm trên đĩa từ 01:16:41)  |
| `~/.awog/aws-backups/config.2026-09-13T18-34-41-677Z` — bản chụp TRƯỚC lượt ghi kế tiếp                                           | Trước 01:34:41 profile **không** có dòng `region`; `region = ap-northeast-1` chỉ xuất hiện sau lượt đó |
| `~/.awog/aws-backups/` chỉ có 2 bản `config.*` cho 3 lượt `profile_save` trong nhật ký                                            | Lượt 01:32:13 không sinh bản sao nào ⇒ không có lần ghi nào xảy ra                                     |
| `~/.awog/infra-audit/2026-09.jsonl` — ba lượt `NoRegion` (01:17:21 · 01:33:42 · 01:34:00)                                         | `[default] region = ap-northeast-1` **không** cứu được profile khác: chạy `--profile X` là dừng ngay   |
| Màn chi tiết lúc 01:32:26 hiện "Chưa đặt"                                                                                         | Màn chi tiết đọc từ file và **đang nói đúng**; thứ sai là sự im lặng                                   |

Lượt lưu 01:32 không hỏng ở tầng ghi — "vắng mặt = giữ nguyên" là luật đúng và vẫn giữ. Chỗ hỏng là AWOG **im lặng** về kết quả đó. Bản vá vì thế bịt ba chỗ:

1. `AwsRegionField.vue` — `manual` nay chỉ bật khi giá trị đang có là region **không** nằm trong danh sách. Trước đây ô rỗng cũng bật ô gõ tay, nên mở một profile chưa có region ra một **ô trống trơn** thay vì dropdown: không có gì để bấm, và giá trị tự dò (nếu có) không hiện ra.
2. `AwsProfileEditor.vue` — `regionMissing` (kiểu `static` · ô trống · trên đĩa cũng trống) là **điều kiện hợp lệ của form**, đứng cùng chỗ với `nameValid`: nút Lưu khoá. Lý do hiện ở **hai chỗ**: câu đầy đủ dưới ô Region, và một dòng ngắn ở **footer** cạnh nút — vì `.lem-body` cuộn được nên câu dưới ô rơi ra ngoài vùng nhìn ở cửa sổ thấp (đo ở 860px: đáy câu 774 > đáy vùng cuộn 740, và cuộn hộ không ăn vì modal tự focus ô Tên rồi kéo vùng cuộn về đầu). Vế "trên đĩa cũng trống" để ca "sửa profile đã có region rồi để trống" vẫn đúng nghĩa giữ nguyên và **không** bị chặn.
3. `InfraAccountsDetail.vue` — hàng Region khi trống đọc là "Chưa đặt (lệnh AWS sẽ báo thiếu Region)" + màu `--amber`. Nhãn cũ "Không đặt (theo mặc định của CLI)" **sai** (không có mặc định nào áp cho profile khác) nên đã bỏ.

**Kèm một sửa nhỏ ở CSS dùng chung.** Nút `:disabled` của app trước đây trông y hệt lúc bật (`.btn` không có luật `:disabled` nào; chỉ `.gsecbtn`/`.iact` có), nên khi validate chặn Lưu thì người dùng thấy một nút xanh bấm không có gì xảy ra. Đã thêm `.btn:disabled { opacity: .5; cursor: not-allowed }` vào `assets/css/prototype.css`, cùng khuôn với hai luật đã có.

**Đã đo lại (2026-09-14 sáng).** Tầng ghi (sidecar thật, code hiện tại, trên một `~/.aws` tạm dựng đúng trạng thái 01:32): payload không `region` ⇒ `aws: ini unchanged, skipping write` + `backups: []` (im lặng, y như cũ); payload có `region` ⇒ ghi `region = ap-southeast-1` vào đúng section + một bản sao lưu, đọc lại bằng `listAwsProfiles()` thấy đúng. UI (dev server `localhost:3031`, `window.awog` giả): mở profile chưa có region ⇒ **dropdown** chứ không phải ô trống, tự dò ra `ap-northeast-1` kèm câu "Tự dò từ profile `default` của máy"; chọn "Chưa đặt" ⇒ cảnh báo amber + bấm Lưu ⇒ hộp xác nhận và **0** RPC `infra.profile-save`; chọn `ap-southeast-1` rồi Lưu ⇒ **không** hỏi lại, payload `{region, output}`, màn chi tiết sau khi lưu hiện `ap-southeast-1`.

**Độ tin cậy.** Phần chắc chắn: payload 01:32 không có `region`, và trước bản vá AWOG không nói một câu nào về điều đó. Phần **không** khôi phục được: nguyên văn mã renderer chạy đúng lúc 01:32 — file chưa từng được commit và đã bị ghi đè, nên cơ chế "ô trống trơn" ở trên là kết luận từ việc dựng lại hành vi đó trên dev server, không phải đọc lại bản build lịch sử. Toàn bộ lượt đo chạy trên dev server + `window.awog` giả, **chưa** chạy trong Electron.

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

| Kiểu            | Trường                                                                                      | Ghi vào                                                         |
| --------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Static**      | access key id · secret access key (ô password) · session token (tuỳ chọn) · region · output | `credentials` (khoá) + `config` (region/output)                 |
| **SSO**         | sso_session **hoặc** start URL + sso region · account id · role name · region               | `config` (không có secret nào — token nằm ở `~/.aws/sso/cache`) |
| **Assume role** | role_arn · source_profile (chọn từ danh sách) · mfa_serial · external_id · duration         | `config`                                                        |
| **Process**     | `credential_process`                                                                        | **Chỉ đọc ở v1**                                                |

`credential_process` chỉ-đọc là một cắt phạm vi có chủ đích: dòng đó là **một lệnh sẽ chạy mỗi lần CLI cần credential**. Để AWOG ghi nó vào đây là mở một đường thực thi lệnh tuỳ ý nằm ngoài mọi cổng quyền của app. Ai cần thì sửa file trực tiếp — AWOG hiện nội dung và nút mở file.

Sau khi lưu, form đề nghị luôn **Kiểm tra danh tính** (`sts get-caller-identity`) — profile sai chỉ phát hiện được bằng cách gọi thử, và phát hiện ngay lúc vừa tạo thì rẻ hơn nhiều so với lúc đang chữa cháy.

Validate: tên profile `^[A-Za-z0-9._@:/+=-]{1,128}$` + không trùng (hiện cảnh báo khi trùng, cho phép **ghi đè** có xác nhận); access key id khớp `^(AKIA|ASIA)[A-Z0-9]{16}$` thì thôi, lệch thì **cảnh báo chứ không chặn** (AWS có định dạng khác cho vài loại khoá).

Trường bắt buộc mang dấu `*` ngay trên nhãn, và dấu đó **chỉ hiện khi ô đang thật sự chặn Lưu**. Lượt tạo mới bắt buộc
tên profile + các ô của kiểu đang chọn (static: access key id · secret access key · region; sso: `sso_session` hoặc
start URL + sso region, account id, role name; assume-role: `role_arn`, `source_profile`). Lượt sửa thì ô trống là
"giữ nguyên giá trị trên đĩa" nên không có dấu, trừ **Region của profile `static` khi trên đĩa chưa có region** —
profile thiếu region hỏng ngay ở mọi lệnh, nên nó bắt buộc ở cả hai lượt. Dòng chú giải "Ô có dấu * là bắt buộc."
đứng đầu form; `.ape-req` dùng `--danger` giống `.sse-req`/`.vpe-req` của SshEditor/VpnEditor.

## Nhập

| Nguồn                                | Luồng                                                                                                                                                      | Ghi chú                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Dán khối từ SSO portal**           | Dán nguyên cụm `[229015218011_Offshore-Developer] aws_access_key_id=… aws_secret_access_key=… aws_session_token=…` → parse → xem trước → đặt tên → lưu     | Luồng phổ biến nhất. Ô dán là password-field, **xoá sạch sau khi lưu**                             |
| **File `credentials`/`config` khác** | Chọn file → hiện danh sách profile tìm thấy → tick cái nào nhập → xử lý trùng tên (đổi tên · ghi đè · bỏ qua)                                              | Máy cũ, hoặc đồng nghiệp gửi                                                                       |
| **CSV của IAM console**              | File `*_accessKeys.csv` tải về khi tạo access key → đọc 2 cột → tạo profile                                                                                |                                                                                                    |
| **Từ SSO (khám phá)**                | Nhập start URL + region → `aws sso login` (mở trình duyệt) → `sso list-accounts` + `list-account-roles` → **tick hàng loạt** account/role muốn tạo profile | Giá trị cao nhất: một lần là có đủ profile cho cả tổ chức, và **không sinh ra secret dài hạn nào** |
| **Từ `~/.aws` sẵn có**               | Không cần nhập — AWOG đọc trực tiếp                                                                                                                        |                                                                                                    |

Mọi luồng nhập đều đi qua **màn xem trước**: thấy sẽ tạo/ghi đè profile nào, vào file nào, trước khi có gì chạm đĩa.

### Đăng nhập Console — `aws login` trong app (bổ sung 2026-09-13)

Mục tiêu: người chỉ có `Account ID/alias + IAM username + Password` **không phải tạo access key
bằng tay, cũng không phải mở terminal**. Hộp thoại đã điền sẵn tên profile (`console`, tự nhảy
`console-2` nếu trùng) và region (lấy region đang ghim của app), nên đường ngắn nhất là **một cú
bấm** rồi đăng nhập trong trình duyệt.

Chỗ vào nằm trong menu **Thêm profile** (mục ĐẦU tiên), **không** nằm trong menu **Nhập**: nhóm
người dùng này không _nhập_ gì cả — họ đang **thêm một profile mới**, chỉ khác ở chỗ nguồn
credential là phiên Console chứ không phải khoá họ tự dán vào. Màn danh sách trống còn hiện thẳng
hai nút (**Đăng nhập Console** / **Tạo profile thủ công**) thay vì giấu sau menu, vì người chưa có
profile nào chính là người cần đường này nhất.

| Bước                                   | Ai làm                        | Ghi chú                                                                                                                                                 |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aws login --profile <p> --region <r>` | sidecar, sau cú bấm           | CLI tự mở trình duyệt; `--region` là bắt buộc vì thiếu nó CLI rơi vào prompt chọn region trên TTY mà tiến trình này không có TTY ⇒ treo tới hết timeout |
| đăng nhập + MFA                        | người dùng, trong trình duyệt | mật khẩu chỉ đi vào trang của AWS                                                                                                                       |
| chép `login_session`                   | sidecar                       | **từ file tạm** vào `~/.aws/config` thật qua `applyAwsIniEdits`                                                                                         |

Ba tính chất đáng nhớ:

- **Luật ghi `~/.aws` không bị nới.** `aws login` tự ghi file config, nên lời gọi CLI bị trỏ
  `AWS_CONFIG_FILE` vào một file tạm (0600, xoá trong `finally`); AWOG đọc đúng MỘT khoá
  `login_session` rồi tự ghi vào config thật bằng `applyAwsIniEdits` — vẫn sửa phẫu thuật, sao
  lưu, ghi nguyên tử, 0600. Hai module nội bộ dùng `env` của `runInfra` (2026-09-14):
  `console-login.ts` và nhánh `secrets` của `infra.identity-check` (kiểm tra khoá
  vừa gõ trước khi ghi). Đường của agent (`infra.run`) không có tham số đó và
  không được thêm (env là bề mặt đổi ngữ cảnh).
- **Token không đi qua AWOG.** Refresh/access token nằm trong cache của chính CLI
  (`~/.aws/login/cache`). Vì vậy `AWS_LOGIN_CACHE_DIRECTORY` được luồn xuống `runInfra` cùng
  `AWS_CONFIG_FILE` — người dùng đặt biến đó thì lần chạy sau của CLI phải đọc đúng chỗ ấy.
- **Chặn đè kiểu credential khác.** Hàng rào sẵn có của CLI chạy trên file TẠM (rỗng) nên không
  bao giờ bắn; `assertLoginTarget()` là bản sao ở tầng AWOG, ném `EXISTS_OTHER_STYLE`. Không có nó
  thì `aws login` lên một profile static sẽ ghi thêm `login_session` trong khi khoá tĩnh vẫn có
  quyền cao hơn — người dùng tưởng đang dùng phiên Console nhưng thực tế vẫn là access key cũ.

Profile tạo ra mang kind **`login`** (`login_session`), và vì thế:

- `AwsProfileEditor` mở nó ở dạng **chỉ đọc ruột**: sửa được **tên** và **region**, không có ô nhập
  khoá, không có ô đổi kiểu. Form static ở đây sẽ ghi khoá dài hạn đè lên phiên Console — đúng cái
  bẫy vừa nói. Sidecar giữ đúng hàng rào đó (`assertLoginEdit`): tạo profile `login` bằng form,
  đổi kiểu khỏi `login`, hay gửi `login_session` từ payload đều ném `LOGIN_READONLY`.
- **Tên sửa được là bắt buộc, không phải tiện nghi** (2026-09-14). Tên do người dùng đặt TRƯỚC khi
  đăng nhập, mặc định là `console`, và bản trước không đổi được nó — muốn tên khác thì phải đăng
  nhập lần nữa, mà đăng nhập lần nữa với tên khác là **tạo profile thứ hai** cho cùng một tài khoản
  (`console` + `hoatq.dev`, cùng `login_session = arn:aws:iam::797859922771:root`, đo trên máy người
  dùng lúc 08:36 và 08:37). Rename đi qua `renameSection` nên phiên không đổi: cache của CLI đánh
  khoá theo **ARN phiên**, không theo tên profile.
- Màn Sửa hiện **định danh phiên** (`login_session`, kèm account id rút từ ARN) và cảnh báo khi một
  profile KHÁC đang dùng cùng phiên — `otherProfilesWithSameSession()`. Đây là chỗ duy nhất người
  dùng nhìn thấy "hai profile cho một tài khoản" mà không phải tự so file.
- **Nhân bản bị chặn, xoá thì không.** `duplicateProfile()` từ chối profile `login`
  (`LOGIN_READONLY`): bản sao dùng chung phiên nên nó chính là đường đẻ ra profile thứ hai cho một
  tài khoản. UI dịch mã này thành `infra.list.err.loginReadonly` ("… đổi tên profile này, hoặc xoá
  nó rồi tạo mới") thay vì lộ message thô của sidecar. Chiều ngược lại vẫn mở: `deleteProfile` chỉ
  chặn `credential_process`, nên dọn một cặp trùng phiên = đổi tên một cái rồi xoá cái còn lại.
- Modal "Đăng nhập lại" (mở từ màn Sửa) **khoá ô tên**: nó làm mới phiên cho đúng profile đó, còn
  tạo profile mới là việc của nút **Đăng nhập Console** ở toolbar (ở đó ô tên mở và gợi ý tên chưa
  bị chiếm, `console-2`…).
- `login_session` đã vào allowlist đọc/ghi (`ini.ts`, `ini-edit.ts`, `CONFIG_KEYS`) nên profile
  không còn rơi vào nhóm `unknown` và **không bị mất khoá khi xuất cấu hình**.
- "Sao chép lệnh tương đương" trả `aws login --profile <p>`: `aws configure set` KHÔNG tái tạo được
  profile này (định danh phiên do CLI sinh, token nằm trong cache của CLI).
- AWOG **không đọc** `~/.aws/login/cache`: token/refresh token nằm ở đó, và thứ duy nhất AWOG cần
  biết về phiên (account id) đã nằm sẵn trong ARN của `login_session`.

**Đo được / chưa đo.** Unit test: `readLoginSession`, `assertLoginTarget`, validate biên
(`console-login.test.ts`). **Chưa đo**: luồng trình duyệt đầu-cuối — chưa ai chạy `/infra → Thêm
profile → Đăng nhập Console` trên một tài khoản thật (cùng số phận với N1).

#### Lỗi 400 Bad Request khi mở trình duyệt — lỗi ĐÃ BIẾT của aws-cli (đo 2026-09-13)

Ca có thật, gặp ngay lần thử đầu: bấm Đăng nhập Console, trình duyệt mở ra trang **400 Bad Request**
của AWS (`ap-southeast-1.signin.aws.amazon.com`), CLI **không in gì thêm** và treo tới hết timeout.

Đã đối chiếu: **không phải lỗi của AWOG**. Cùng URL đó, `curl` và Chrome-sạch (profile tạm) đều
nhận 302 → trang đăng nhập 200 — URL đúng, chỉ _phiên cookie_ là khác. Cơ chế đầy đủ có trong issue
upstream [aws/aws-cli#10186](https://github.com/aws/aws-cli/issues/10186): tra lại **2026-09-13**
vẫn **mở** (`bug`/`p2`/`login`), AWS đã chuyển nội bộ (`P411663187`) và **chưa có bản vá**.

1. `aws login` dựng callback server `127.0.0.1:PORT` rồi mở `/v1/authorize?...` bằng trình duyệt.
2. Trình duyệt **còn cookie phiên Console** (đã từng đăng nhập Console) nhưng **phiên phía server
   đã hết hạn**.
3. Service thấy cookie, thử dùng lại phiên cũ: `/v1/sessions` → `/oauth?iam_user=true&…`.
4. Service trả thẳng **400 Bad Request**, `redirect_uri` **không bao giờ được gọi** ⇒ CLI treo im
   lặng tới hết timeout của nó (issue ghi `_OVERALL_TIMEOUT` ~10 phút; AWOG cắt sớm ở 300s).

**Hệ quả: không phải "lần nào cũng phải mở ẩn danh".** Lỗi chỉ xuất hiện khi trình duyệt đang ở
đúng trạng thái _cookie còn, phiên chết_. Hai đường thoát, mỗi lần kẹt chỉ cần một:

- **Làm mới phiên trong trình duyệt chính** (đăng nhập lại Console) rồi bấm đăng nhập lại — phiên
  còn hạn thì `aws login` dùng lại được (đúng mục đích luồng `same-device`), tức lần đó chỉ còn
  **một cú bấm**. Đây là đường nên dùng cho người đăng nhập thường xuyên; UI có nút mở thẳng trang
  đăng nhập Console.
- **Cửa sổ ẩn danh** — nhanh, không phải đụng trình duyệt chính, nhưng không có cookie để dùng lại
  nên **mỗi lần đều phải gõ lại Account ID + username + mật khẩu**. Vì vậy nút ẩn danh là đường
  THOÁT, không phải đường chính.

⚠ **Ẩn danh không cứu được mọi ca — ca thứ hai có nguyên nhân khác hẳn.** Người dùng thật gặp: cửa
sổ ẩn danh (không còn cookie) vẫn lỗi (`Authentication failed / Invalid request`); trong issue
upstream cũng có người báo y hệt — _"tried it with incognito mode and still got the same error,
regardless of browser used"_. Nguyên nhân của ca thứ hai: **user IAM thiếu policy
`SignInLocalDevelopmentAccess`**. Đây là policy AWS quản lý, có trang tài liệu chính thức — _"Provides
permissions for programmatic access to AWS through the AWS Sign-in service, including OAuth2 token
creation for developer tools and applications"_ (tạo **2025-11-19**, bản `v3`) — và ca thật trên
re:Post kết luận: _"the issue was that the `SignInLocalDevelopmentAccess` policy was disabled for my
group. Enabling it allowed me to sign in and the issue is resolved"_. Policy mới có từ cuối 2025 nên
nhiều tổ chức chưa gắn (hoặc đã tắt) ⇒ `aws login` không dùng được **về mặt quyền**, không liên
quan cookie. Việc này thuộc người quản trị AWS; AWOG không vượt được.

Ghi chú kỹ thuật: CLI 2.35.9 có hai luồng — `same-device` (mặc định, `client_id=…/same-device`,
callback `127.0.0.1`) và `cross-device` (`--remote`, `client_id=…/cross-device`, redirect về
`<base>/v1/sessions/confirmation` rồi người dùng dán code). Luồng thứ hai **chưa thử**; nó khác
endpoint nên có thể là đường vòng cho ca 400, nhưng cần ô nhập code ở UI + luồn stdin xuống CLI.

AWOG không sửa được phía AWS, nhưng **không để người dùng chết kẹt**:

- **URL uỷ quyền được đẩy lên UI ngay khi CLI in ra.** `runInfra` có thêm `onOutput` (chỉ
  `console-login.ts` truyền — đường của agent không có, xem lại luật env/ngữ cảnh ở trên);
  `extractAuthorizeUrl()` bóc URL và sidecar bắn sự kiện `infra.console-login.url`. Modal hiện
  URL kèm ba nút: **Mở cửa sổ ẩn danh** (bổ sung sau, xem dưới), **Sao chép URL**, và **Mở lại
  trong trình duyệt**. Dán URL đó vào **cửa sổ ẩn danh** là đi tiếp được (không có cookie cũ) —
  đo bằng `curl`: gọi lại 3 lần liên tiếp đều 302 → 200.
  ⚠ Nhưng URL chỉ _mở được_ sau khi CLI chết, không _hoàn tất_ được: `execFile` giết tiến trình
  khi hết timeout, nên callback `http://127.0.0.1:PORT/oauth/callback` cũng chết theo — đăng nhập
  xong sẽ ra trang "không kết nối được" và không có `login_session` nào được ghi. Vì vậy khối URL
  chỉ hiện khi phiên còn sống (`busy`), và câu lỗi hết giờ nói đúng việc cần làm: chạy lại rồi mở
  ẩn danh ngay khi URL hiện ra.
- **Mở cửa sổ ẩn danh bằng MỘT cú bấm.** RPC `infra.console-login-private` →
  `infra/aws/open-private.ts`: chọn trình duyệt mặc định của máy (`plutil -convert json` trên
  `com.apple.launchservices.secure.plist`, rơi về thứ tự Chrome → Brave → Edge → Arc → Vivaldi →
  Chromium → Firefox nếu không đọc được), dựng `open -n -a <app> --args --incognito <url>`, rồi
  mở. Không chạy lại `aws login`: đúng URL đó, cửa sổ sạch redirect về callback mà CLI đang lắng
  nghe nên phiên cũ hoàn tất bình thường. `shell.openExternal` của Electron không dùng được ở đây
  — nó luôn mở trình duyệt mặc định và không truyền được cờ nào (tức mở lại đúng cửa sổ đang 400).
  Chi tiết kỹ thuật đáng nhớ: `-n` là bắt buộc, thiếu nó `open` chuyển URL cho instance đang chạy
  và **bỏ qua `--args`** ⇒ cờ ẩn danh biến mất (có test khoá lại). **Safari không có cờ dòng lệnh
  cho cửa sổ riêng tư** nên không nằm trong bảng: máy chỉ có Safari nhận mã `NO_BROWSER` và UI
  giữ lại đường "sao chép URL" thay vì mở một cửa sổ thường rồi dính đúng 400.

- **Huỷ là huỷ CỨNG.** Thêm RPC `infra.console-login-cancel` + `AbortSignal` cho `runInfra`;
  đóng modal lúc đang chờ sẽ giết tiến trình `aws login`. Trước đây "Huỷ" chỉ bỏ chờ ở UI: tiến
  trình sống tiếp 300s và **vẫn ghi `login_session`** nếu người dùng đăng nhập nốt trong trình
  duyệt (profile tự xuất hiện ngoài ý muốn). Phần huỷ cứng của nợ N7 đã trả cho luồng này.
- **Hết giờ nói ra nguyên nhân.** `exitCode === null` (bị timeout, không phải CLI tự thoát) trả
  mã `LOGIN_TIMEOUT`; modal dịch thành câu có cách xử lý, kèm cảnh báo trước khi bấm.
- **Khối "vẫn không được?" hiện NGAY trong lúc chờ** (không đợi hết 5 phút): trang lỗi của AWS
  hiện ra tức thì còn CLI thì im lặng, nên modal nói luôn hai đường ở trên + nút mở trang đăng
  nhập Console (`CONSOLE_SIGN_IN_URL`, mở bằng `openExternally` chứ không phải `<a href>` — nếu để
  interceptor của `useLinkOpen` hỏi "mở trong AWOG hay browser?" thì người dùng sẽ gõ mật khẩu AWS
  vào Chromium của app; cùng lý do với `AwsProfileCredentialHelp.vue`).

**Đo được.** `aws login` **tôn trọng `$BROWSER`** — trỏ biến này vào một script bất kỳ thì script
nhận đúng URL uỷ quyền kèm `redirect_uri=http://127.0.0.1:52140/oauth/callback` (nên còn một đường
chưa dùng: đặt `$BROWSER` ngay từ lúc spawn để CLI tự mở cửa sổ sạch). Hàm thuần của đường ẩn danh
(`isAuthorizeUrl`, `parseDefaultBrowserBundleId`, `pickPrivateBrowser`, `buildPrivateOpenArgs`) có
17 test ở `__tests__/open-private.test.ts`.

**Chưa đo**: (a) bấm nút ẩn danh rồi đăng nhập thật và CLI nhận được code; (b) "làm mới phiên
trong trình duyệt chính rồi `aws login` dùng lại phiên đó" — suy ra từ luồng `same-device`, CHƯA
đo; (c) đường ẩn danh trên máy đang có cookie cũ. Cả ba cần tài khoản AWS thật, chung số phận N1.

### Lấy credential ở đâu

Ba luồng đầu của bảng trên đều **giả định người dùng đã có credential**. Bản đầu không nói
cách lấy, nên người chỉ có `Account ID/alias + IAM username + Password` — bộ ba đăng nhập
Console — đọc hint "file mà IAM console đưa ngay sau khi tạo access key" mà không biết bấm vào
đâu.

⚠ **Đính chính (đo trên aws-cli 2.35.9, 2026-09-13).** Bản đầu của mục này viết "ba giá trị đó
không dùng được ở dòng lệnh". Điều đó đúng với CLI v1/cũ, nhưng **sai với v2 hiện hành**:

| Lệnh                        | Đầu vào                               | Ra cái gì                                                                                |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `aws login`                 | phiên đăng nhập Console (trình duyệt) | credential tạm + refresh token, tự ghi `login_session` vào profile trong `~/.aws/config` |
| `aws configure sso`         | start URL của IAM Identity Center     | `[sso-session x]` + profile trỏ vào nó; chạy tiếp `aws sso login` mới có credential      |
| `aws configure sso-session` | như trên, nhưng chỉ tạo block session |
| `aws configure mfa-login`   | access key dài hạn **+** mã MFA       | `sts get-session-token` → credential tạm vào một profile                                 |

Nguồn: `aws login help`, `aws configure help` (liệt kê `mfa-login`/`sso`/`sso-session`), và
`awscli/customizations/login/login.py` trong bundle 2.35.9 (`_update_profile_with_login_session`
ghi `login_session`; `ensure_profile_does_not_have_existing_credentials` từ chối profile đã có
kiểu credential khác — nên không gắn `aws login` lên một profile static sẵn có).

Hệ quả cho AWOG (đã xử lý 2026-09-13, trừ dòng cuối):

- ✅ `login_session` đã vào ba allowlist (`ini.ts` để đọc, `ini-edit.ts` để ghi, `CONFIG_KEYS` để
  nhập/xuất) và `deriveKind()` trả kind `login` — trước đó profile do `aws login` tạo bị xếp vào
  nhóm "không rõ" và **bị bỏ mất khoá khi xuất cấu hình**.
- ✅ `aws login` chạy được qua `runInfra()` bằng `env` (chỉ sidecar nội bộ dùng) + `host` là chính
  lệnh `aws login`; xem §"Đăng nhập Console" ở trên.
- ☐ **UNVERIFIED**: `aws login` có dùng được với phiên Console liên kết SSO/federated hay không.

Khối [`AwsProfileCredentialHelp.vue`](../../apps/desktop/ui-next/components/infra/AwsProfileCredentialHelp.vue) trả lời câu đó ngay tại chỗ:

| Bề mặt                             | Hiện khi                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Wizard nhập, nhánh **CSV của IAM** | luôn                                                                          |
| Form thêm/sửa profile **static**   | chỉ khi **tạo mới** — lúc sửa một profile đã có khoá thì câu hỏi này là nhiễu |

Nội dung: **hai đường** — (1) **Thêm profile → Đăng nhập Console** trong app (không sinh khoá dài hạn,
không gõ lệnh; lệnh tương đương `aws login` chỉ nhắc trong ngoặc); (2) tạo access key qua 4 bước
(đăng nhập Console → IAM → Security credentials → Create access key → tải CSV) — kèm hai link ra
ngoài, và một nhánh thoát cho ca **bị chặn**: không thấy nút `Create access key` hoặc
`AccessDenied` nghĩa là tổ chức cấm khoá dài hạn, phải xin start URL của IAM Identity Center (dùng
**Nhập → Từ SSO**, tương đương `aws configure sso`) hoặc ARN của một role được phép assume.

Ba ràng buộc của khối này:

- **Link tĩnh, không ghép từ input.** `signin.aws.amazon.com/console` và trang doc của AWS là
  hằng số. URL dựng từ Account ID/alias người dùng gõ vào là bề mặt invariant #7 canh; deep link
  tới đúng trang của user để dành cho nút Console ↗ ở Mốc 3.4 (`infra.tasks.md`), làm một lần ở
  đó kèm validate.
- **Không đi qua popover "mở trong app".** Hai link gọi thẳng `openExternally()` thay vì để
  interceptor của `useLinkOpen` bắt `<a href>`: popover 2 lựa chọn (ADR 0086) sẽ mời người dùng
  gõ mật khẩu AWS vào Chromium của app. Cùng khuôn với `SettingsDevices.vue → openTailscale`.
- **Không có ô nhập username/password** ở đây, và không được thêm — mật khẩu Console thậm chí
  không phải credential mà sidecar dùng được (luật cứng #2).

## Xuất

Hai chế độ, và mặc định là chế độ an toàn:

| Chế độ                  | Xuất gì                                                                             | Rào                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Cấu hình** (mặc định) | Tên profile, region, output, `sso_*`, `role_arn`, `source_profile` — **không** khoá | Không rào. Đây là thứ chia sẻ được cho đồng đội, commit được vào repo nội bộ         |
| **Gồm cả khoá**         | Thêm `aws_access_key_id` + `aws_secret_access_key`                                  | Gõ lại tên profile để xác nhận · cảnh báo rõ · ghi nhật ký · file ghi ra `chmod 600` |

Một câu tôi sẽ nói ở ngay chỗ đó, một lần, không lặp lại: static key xuất ra file là **thứ rủi ro nhất** trong cả họ tính năng này — nó không hết hạn, không truy vết được ai dùng, và đi theo file. Nếu mục tiêu là để đồng đội dùng chung account thì xuất **cấu hình SSO** rồi để mỗi người tự `sso login` sẽ đạt cùng kết quả mà không ai phải cầm khoá của ai.

Ngoài ra có **Sao chép lệnh tương đương** (`aws configure set …`) cho ai muốn tự chạy thay vì để AWOG ghi file.

## Xoá

Hộp xác nhận nêu đủ ba điều: profile nằm ở **file nào** (`config`, `credentials`, hay cả hai), **đang được dùng ở đâu** (project/phiên nào), và **có sao lưu** ở đâu để khôi phục. Profile đang là mặc định của app thì phải chọn profile thay thế trước.

Xoá profile **không** đụng `~/.aws/sso/cache` — token SSO là của start URL, không của riêng profile.

## Kubernetes và Terraform thì sao

v1 chỉ quản lý profile AWS. Kube context hiện **danh sách chỉ đọc** + nút mở `~/.kube/config` — sửa kubeconfig rủi ro hơn hẳn (`exec` plugin, client cert nhúng, cụm được tool khác quản), nên chờ nhu cầu thật rồi mở, không đoán trước. Terraform không có khái niệm "profile" riêng: nó dùng chính profile AWS ở đây.

## Lộ trình

| Pha    | Nội dung                                                                                     | Ước lượng |
| ------ | -------------------------------------------------------------------------------------------- | --------- |
| **A1** | Trình soạn INI phẫu thuật (giữ comment/thứ tự/khoá lạ) + sao lưu + ghi nguyên tử + test bảng | M         |
| **A2** | Màn Profiles: danh sách nhóm theo kiểu · chi tiết · đặt mặc định · kiểm tra danh tính        | M         |
| **A3** | Thêm / sửa / nhân bản / xoá — form theo kiểu, validate, xác nhận có ngữ cảnh                 | M         |
| **A4** | Nhập: dán khối · file credentials/config · CSV của IAM — có màn xem trước                    | M         |
| **A5** | Nhập từ SSO (list-accounts / list-account-roles, tick hàng loạt)                             | M         |
| **A6** | Xuất cấu hình · xuất kèm khoá có rào · sao chép lệnh `aws configure set`                     | S         |

Phụ thuộc: P0 của [session-infra-context.md](session-infra-context.md) (parser + `infra.run`). A1 là phần dễ bị xem nhẹ nhất và cũng dễ làm hỏng file của người dùng nhất — làm trước và có test trước.

## Bảo mật

| Rủi ro                 | Xử lý                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret đi qua IPC      | Hai chiều: **đọc** khi mở form sửa (`infra.profile-secrets`, một profile theo tên, có dòng nhật ký) và **ghi** trong một lần lưu. Không lưu lại, không log, không event, không vào nhật ký lệnh, không vào context model. `secret`/`session token` là ô `type=password` có nút hiện; `access key id` hiện thẳng (nó không phải phần bí mật của cặp khoá) |
| Kiểm tra trước khi ghi | Khoá vừa gõ đi tới `sts get-caller-identity` bằng **env** của tiến trình con, không bằng cờ/argv (`ps` và log kiểm toán đọc được argv; env thì không), không chạm `~/.aws`, và không kèm `AWS_PROFILE` — hai nguồn danh tính trên cùng tiến trình là lỗi                                                                                                 |
| Agent lạm dụng         | **Không có tool ghi profile.** Agent đọc được tên/region/kind và đổi ngữ cảnh (qua ma trận quyền), không tạo/sửa/xoá được credential                                                                                                                                                                                                                     |
| Ghi hỏng file          | Sửa phẫu thuật + sao lưu 20 bản + ghi nguyên tử + verify đọc lại sau khi ghi                                                                                                                                                                                                                                                                             |
| Quyền file             | `credentials` giữ `0600`; thư mục `~/.awog/aws-backups` `0700`                                                                                                                                                                                                                                                                                           |
| `credential_process`   | Chỉ đọc ở v1 — không để AWOG ghi một lệnh sẽ tự chạy ngoài mọi cổng quyền                                                                                                                                                                                                                                                                                |
| Xuất kèm khoá          | Mặc định tắt, gõ tên xác nhận, ghi nhật ký, file `0600`                                                                                                                                                                                                                                                                                                  |

**infosec audit bắt buộc** trước A3 (lần đầu secret đi từ UI vào sidecar) và trước A6.

## Điểm lệch có chủ đích so với bản spec đầu (ghi 2026-09-13)

| Điểm                             | Bản spec đầu                                                                                                                                                    | Thực tế đã ship                                                                                                                                                                                                     | Vì sao                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Xuất kèm khoá**                | "mặc định TẮT · gõ lại tên để xác nhận · file 0600"                                                                                                             | Thêm **bắt buộc có đích ghi**: `includeSecrets: true` mà không `targetPath` ⇒ `TARGET_REQUIRED`, và kiểu trả về là union nên nhánh `text` không đồng tồn với khoá                                                   | Luật "KHÔNG xem trước nội dung có khoá trên màn hình" trước đó chỉ được `AwsProfileExport.vue` giữ (nó luôn gọi `saveFilePath()` trước). Bất biến phải nằm ở **biên**, không ở renderer — một lần refactor UI hay một lời gọi RPC từ bề mặt khác là rò                                                                                                                                                                                                     |
| **Đích xuất**                    | denylist thư mục (`~/.aws`, `~/.awog`)                                                                                                                          | So trên đường dẫn đã **giải symlink**, ở cả hai vế (đích và danh sách cấm)                                                                                                                                          | Một symlink `~/Desktop/out.ini → ~/.aws/credentials` vượt qua denylist so-chuỗi rồi ghi đè file credential — không sao lưu, không verify. Vế thứ hai cũng phải giải: trên macOS `/var/…` tự nó là symlink                                                                                                                                                                                                                                                  |
| **Đổi kiểu profile khi sửa**     | không nói                                                                                                                                                       | `saveProfile` gỡ khoá của kiểu cũ (`removeKeys`), gồm 3 khoá secret khi kiểu mới ≠ `static`                                                                                                                         | Không gỡ thì profile hiện "SSO" trong danh sách mà botocore vẫn lấy `aws_access_key_id` từ `credentials` — người dùng tin đã bỏ khoá dài hạn trong khi lệnh vẫn chạy bằng chính khoá đó                                                                                                                                                                                                                                                                    |
| **`overwrite` của A5**           | "chỉ chạm `config`"                                                                                                                                             | Còn gỡ khoá tĩnh của profile bị đè khỏi `credentials` và báo lại qua `clearedStaticKeys`                                                                                                                            | Cùng lớp lỗi trên. "Ghi đè" ở A4 (`applyImport`) đã là THAY THẾ — hai đường ghi phải cùng một nghĩa                                                                                                                                                                                                                                                                                                                                                        |
| **Token SSO**                    | `--access-token <giá trị>` qua argv, kèm ghi chú "cần infosec chốt"                                                                                             | `--access-token file://<file tạm 0600 trong ~/.awog>`                                                                                                                                                               | `ps` của cùng user (và mọi thứ thu thập dòng lệnh: EDR, log kiểm toán) đọc được argv. Đo trên aws-cli 2.35.9 trước khi đổi: `file://` **có** được mở rộng cho chính cờ này (đường dẫn không tồn tại ⇒ lỗi `ParamValidation` **cục bộ**, chưa gọi mạng), và nội dung file tới API y hệt giá trị truyền thẳng. Hệ quả: `classify()` nâng hai lệnh này từ `read` lên `write` — vô hại vì chúng luôn đi với `decision:'approved'`, nhưng dòng nhật ký đổi nhãn |
| **Ba ô secret khi sửa**          | không nói (đường đọc không có secret)                                                                                                                           | Nạp giá trị THẬT từ `~/.aws/credentials` khi mở form; `hint` của khối khoá nói rõ điều đó                                                                                                                           | Yêu cầu người dùng 2026-09-14. Placeholder "để trống = giữ nguyên" khiến không ai kiểm tra được khoá nào đang nằm trên đĩa — mà đó lại là thứ duy nhất quyết định profile có chạy được hay không. Đường LIỆT KÊ không đổi, nên một danh sách 20 profile vẫn không kéo theo 20 cặp khoá                                                                                                                                                                     |
| **Kiểm tra trong form**          | "sau khi lưu, form đề nghị luôn Kiểm tra danh tính"                                                                                                             | Thêm nút **Kiểm tra** chạy được trước khi ghi (khoá vừa gõ đi bằng env), và vẫn tự kiểm tra sau khi lưu                                                                                                             | Bắt lỗi gõ nhầm một ký tự trước khi nó thành một cặp khoá nằm trong `~/.aws`. Chế độ `profile` (kiểm tra bản đã ghi) không đi qua secret: sidecar tự đọc file                                                                                                                                                                                                                                                                                              |
| **Region**                       | ô nhập tay tự do                                                                                                                                                | Dropdown danh sách region chuẩn + ô nhập tay cho region ngoài danh sách + tự dò khi ô trống                                                                                                                         | Yêu cầu người dùng 2026-09-14. Không có API nào để AWS dò region từ credential (region là khái niệm phía client), nên "tự dò" nghĩa là: region của chính profile → region đang ghim của app → profile `default` của máy. Chỉ điền khi ô TRỐNG                                                                                                                                                                                                              |
| **Region trống lúc bấm Lưu**     | im lặng: payload không có `region` ⇒ luật "vắng mặt = giữ nguyên" ghi ra **không gì cả**, màn chi tiết vẫn "Chưa đặt", không một dòng nhật ký, không nói vì sao | Chặn ở nút Lưu (Region là điều kiện hợp lệ của form, cùng chỗ với tên profile) + câu yêu cầu màu `--amber` tại ô khi ô trống **và** trên đĩa cũng trống; màn chi tiết đọc "Chưa đặt (lệnh AWS sẽ báo thiếu Region)" | Ca thật 2026-09-14 01:32 (xem "Cập nhật 2026-09-14 (khuya 2)"). `region` **không** có fallback từ `[default]` khi chạy `--profile` khác — đo được: ba lượt `NoRegion` trong `~/.awog/infra-audit` xen giữa các lần lưu không region, trong khi `[default] region = ap-northeast-1` nằm nguyên trên đĩa                                                                                                                                                     |
| **`sso_region` không tự dò**     | (như trên)                                                                                                                                                      | Dropdown nhưng KHÔNG tự điền                                                                                                                                                                                        | Portal SSO thường ở `us-east-1` trong khi tài nguyên ở `ap-southeast-1`; dò hộ ở trường này là gợi ý sai cho một giá trị mà sai một ký tự thì `sso login` hỏng                                                                                                                                                                                                                                                                                             |
| **`credential_process` chỉ đọc** | ép ở `profile-ops.ts`                                                                                                                                           | Ép thêm ở `applyImport` và `ssoCreateProfiles` (bỏ qua + `warnings`, không ném)                                                                                                                                     | Nhập và A5 là hai đường ghi KHÁC vào cùng hai file; không ép thì một lần nhập biến profile của người dùng thành thứ chính app không sửa/xoá lại được                                                                                                                                                                                                                                                                                                       |
