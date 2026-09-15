# Feature — CI/CD: theo dõi và điều khiển pipeline

- **Trạng thái:** **Đã code (2026-09-14)** — tab **Triển khai** trong `/infra`, bốn nguồn, hành động ghi, thông báo. **Chưa QA trong Electron thật** và **chưa chạy bằng credential AWS thật**; xem §"Trạng thái thực tế" cuối file
- **ADR:** [0088](../decisions/0088-session-infra-context.md) (ngữ cảnh + ma trận quyền), [ADR 0049](../decisions/0049-github-pr-issue-tabs.md) (gh CLI đã có trong app)
- **Route:** `/infra` → **Triển khai**; và chip trạng thái trên thẻ Tổng quan
- **Anh em:** [infra-audit-log.md](infra-audit-log.md) (mọi thao tác pipeline đều vào nhật ký), [cloudwatch-logs.md](cloudwatch-logs.md) (log build dùng chung viewer)

## Vì sao AWOG làm được cái này rẻ

Ba nguồn CI/CD, và AWOG **đã có sẵn hạ tầng cho nguồn lớn nhất**:

| Nguồn | Gọi bằng | Đã có gì trong repo |
|---|---|---|
| **GitHub Actions** | `gh` CLI | Toàn bộ: quản lý account ([gh.accounts](../../apps/desktop/sidecar/src/github/accounts.ts)), runner, error-map, per-project account, tab PR/Issue, hộp thông báo |
| **AWS CodePipeline / CodeBuild** | `aws` CLI | `infra.run` của ADR 0088 |
| **Amplify Hosting** | `aws amplify` | như trên |

Nên màn này chủ yếu là **gộp ba nguồn vào một bảng** và nối chúng với những thứ AWOG đã có: PR, phiên chat, nhật ký, log viewer.

## Màn Triển khai

```
┌ /infra → Triển khai ──────────────────────────────────────────────────┐
│ [tất cả nguồn ▾] [nhánh: tất cả ▾] [7 ngày ▾]              [↻]       │
├───────────────────────────────────────────────────────────────────────┤
│ ⨯  shop-api · Deploy production      main    a3f91c  thất bại  4m12s  │
│    GitHub Actions · Hoàng · 10 phút trước · hỏng ở bước "Kiểm thử"    │
│      [Xem log]  [Chạy lại bước hỏng]  [Hỏi agent]                     │
│ ●  shop-web · Build & deploy        main    a3f91c  đang chạy  1m40s  │
│    Amplify · tự động khi push · bước 3/5: Build                       │
│ ✓  infra · terraform plan            main    77b0e2  xong      2m05s  │
│    CodePipeline · chờ DUYỆT THỦ CÔNG ở bước "Apply production"        │
│      [Xem plan]  [Duyệt]  [Từ chối]                                   │
└───────────────────────────────────────────────────────────────────────┘
```

Một bảng xuyên nguồn: dự án · tên pipeline · nhánh · commit · trạng thái · thời lượng · ai kích hoạt · **hỏng ở bước nào**. Dòng phụ nói bằng tiếng người — *"hỏng ở bước Kiểm thử, 3 test không đạt"* — chứ không bắt người ta tự đọc log để biết.

### Chi tiết một lần chạy

Cột bước dọc (job/stage) với trạng thái và thời lượng từng bước; bấm bước nào mở **log của bước đó**, stream trực tiếp, dùng lại log viewer của [cloudwatch-logs.md](cloudwatch-logs.md) (tìm chuỗi, copy dòng, gửi đoạn vào chat). Tải artifact nếu có. Hiện commit + PR liên quan, bấm là mở tab PR **đã có sẵn trong app**.

### Hành động

| Hành động | Lớp | Ghi chú |
|---|---|---|
| Chạy lại toàn bộ / chỉ bước hỏng | ghi | `gh run rerun --failed` · `codepipeline retry-stage-execution` |
| Huỷ lần chạy | ghi | |
| Kích hoạt chạy mới | ghi | `gh workflow run` với input; Amplify `start-job` |
| **Duyệt bước thủ công** | ghi (cột production nếu môi trường là prod) | CodePipeline approval · GitHub environment protection rule |
| Xem biến môi trường / secret của pipeline | đọc | **Chỉ tên**, không giá trị |

Tất cả đi qua ma trận quyền như mọi lệnh khác, và **tất cả vào [nhật ký hoạt động](infra-audit-log.md)** — "ai duyệt deploy production lúc mấy giờ" là câu hỏi phải trả lời được.

## Nối với những thứ đã có

- **PR ⇄ pipeline**: từ tab PR thấy pipeline của nhánh đó; từ pipeline hỏng nhảy về PR. AWOG đã có cả hai đầu.
- **Thông báo**: pipeline hỏng đi vào chính hộp thông báo bell + toast đã có ([github-notifications.md](github-notifications.md)), theo đúng cài đặt kênh gửi ở Settings → Thông báo.
- **Phiên chat**: nút *Hỏi agent* trên một lần chạy hỏng đẩy **log của bước hỏng** (đã clamp, đã redact) vào phiên. Agent đọc log, tìm nguyên nhân, sửa code, rồi **chạy lại pipeline** — vòng lặp khép kín, mỗi bước ghi đè vẫn qua cổng quyền.
- **Playbook**: bước CI/CD trong [playbook dựng website](aws-website-playbook.md) (tạo OIDC role cho GitHub Actions) kiểm chứng bằng chính màn này.

## Với người không rành kỹ thuật

Chế độ Đơn giản gọi đúng tên việc: **"Bản triển khai"** thay cho "pipeline run", **"Đưa lên web"** thay cho "deploy", trạng thái là *Thành công · Đang chạy · Thất bại* với đèn màu, và một câu giải thích. Thẻ **Bản triển khai gần nhất** trên màn Tổng quan là đường vào chính. Hành động còn đúng hai nút: **Chạy lại** và **Hỏi agent**.

## Lộ trình

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **C1** | Bảng xuyên nguồn (GitHub Actions trước — hạ tầng `gh` đã có) · lọc · trạng thái · ai kích hoạt | M |
| **C2** | Chi tiết một lần chạy: cột bước · log từng bước stream · artifact · nối PR | M |
| **C3** | Hành động: chạy lại · huỷ · kích hoạt · **duyệt bước thủ công** — qua ma trận + nhật ký | M |
| **C4** | Nguồn AWS: CodePipeline · CodeBuild · Amplify job | M |
| **C5** | Nối thông báo + "Hỏi agent về lần chạy hỏng" + agent chạy lại sau khi sửa | M |

Phụ thuộc: P0 của [session-infra-context.md](session-infra-context.md) cho nhánh AWS; nhánh GitHub Actions chạy được sớm hơn vì `gh` đã sẵn.

## Bảo mật

- Token `gh` đi qua **ENV**, không bao giờ qua argv — luật đã có sẵn ở [git-command-log](git-command-log.md), giữ nguyên.
- Log build là dữ liệu **L1**: clamp + redact trước khi vào chat hoặc nhật ký. Log CI nổi tiếng là hay chứa token in nhầm.
- Biến môi trường / secret của pipeline: **chỉ liệt kê tên**. Không có nút xem giá trị ở v1.
- Duyệt bước thủ công trên môi trường production đi theo **cột production** của ma trận quyền — mặc định phải có người bấm.

## Trạng thái thực tế (Mốc 4, 2026-09-14)

Đã code **4.1 → 4.6**. Cửa vào: tab **Triển khai** trong `/infra` (4.1 còn bổ sung sáu view vào tab **Dịch vụ**: `cloudfront.distributions` + `cloudfront.invalidations` · `apigateway.restApis` · `apigatewayv2.httpApis` · `acm.certificates` · `route53.records`). Danh sách việc + điểm lệch: [infra.tasks.md](infra.tasks.md) §"Mốc 4 — trạng thái thực tế".

### Nằm ở đâu

| Tầng | File |
|---|---|
| Kiểu chung + thang trạng thái | `apps/desktop/sidecar/src/infra/cicd/types.ts` |
| GitHub Actions (`gh`) | `…/cicd/github.ts` |
| CodePipeline · CodeBuild · Amplify (`aws`) | `…/cicd/aws.ts` |
| Ghép nguồn + hành động + nhật ký | `…/cicd/index.ts` |
| Cổng quyền (allowlist + op đọc nhạy cảm) | `…/infra/classify.ts` |
| RPC | `src/methods/infra.cicd-{runs,run,log,action,workflows}.ts` |
| Vỏ gọi + điều khiển trang | `composables/useInfraCicdApi.ts` · `useInfraCicd.ts` |
| Màn | `components/infra/cicd/InfraCicd.vue` |
| Thông báo | `composables/useCicdNotify.ts` (poll) + tab "Triển khai" của bell (`components/shell/TopBarNotifications.vue`) |

### Bốn luật đã cài trong code (không phải trong tài liệu)

1. **UI không bao giờ gửi argv.** Hàng của bảng mang một `ref` chỉ chứa **id** (tên pipeline, tên project, `pipelineExecutionId`, `buildId`…); sidecar tra ngữ cảnh rồi dựng `aws`/`gh` argv sau khi `safeToken()` kiểm. `cwd` của `gh` vẫn là `project.path` đọc từ đĩa, không phải đường dẫn renderer gửi lên.
2. **Vé duyệt do sidecar cấp.** Cổng chặn ⇒ sidecar trả `blocked` + vé; UI mở hộp duyệt hạ tầng (`useConfirm` `kind: 'infra'`) rồi gọi lại **y hệt payload** kèm vé. Không có đường nào để renderer tự khai "đã duyệt".
3. **Chỉ tên, không giá trị.** `codebuildRunDetail()` chỉ lấy `.name` của `environment.environmentVariables`; `batch-get-builds` nằm trong `AWS_SENSITIVE_READ_OPS` (production ⇒ phải có người bấm) chính vì payload của nó có VALUE của biến `PLAINTEXT`.
4. **Hỏng một nguồn không làm trắng bảng.** `infra.cicd-runs` trả về **mỗi nguồn một `CicdSourceResult`**, tự khai `error` · `blocked` · `note` (bị cắt bớt). Bảng thiếu nguồn mà im lặng là bảng trả lời sai câu "có gì hỏng không".

Đo được bằng test: `src/infra/cicd/__tests__/*` khoá cả bốn luật trên (redact **trước** khi clamp · `SUPER-SECRET` không được xuất hiện ở bất kỳ trường nào · token duyệt CodePipeline do sidecar đọc, **không** đi qua UI · nguồn bị cổng chặn giữa vòng lặp trả về nguồn rỗng chứ không trả bảng nửa vời).

### Thông báo: vì sao mặc định TẮT

Task 4.5 nói "pipeline hỏng đi vào chính hộp bell + toast đã có". Nó đi vào **đúng** đường đó — thêm một tab "Triển khai" trong bell (cạnh hộp thư GitHub và danh sách PR đang theo dõi), và mọi lời gọi đi qua `useCicdNotify` với đúng ngữ nghĩa kênh gửi của Settings → Thông báo (`toast` / `native` / `both`). Khác một điểm: **nguồn này mặc định tắt** (`notifications.cicdEvents`).

Vì một lượt kiểm tra là **nhiều tiến trình `aws` cộng một `gh run list` cho mỗi dự án** — đúng thứ mà luật 1 của màn này cấm làm sau lưng người dùng. Chạy nền mặc định là tự chạy; nên nó là lựa chọn, nhịp bị chặn sàn **5 phút**, lượt poll ĐẦU TIÊN trên máy chỉ dựng mốc im lặng (không toast một loạt lần chạy đã hỏng từ trước), và tắt công tắc thì vòng poll dừng hẳn + danh sách bị xoá.

Trên tài khoản **production**, lượt poll có thể bị cổng chặn ở CodeBuild (op đọc nhạy cảm) — nguồn đó đơn giản là không có hàng trong danh sách thông báo, không có vé nào được tự cấp.

### Còn nợ (chuyển tiếp)

- **QA trong Electron thật**: chưa ai bấm thử. `pnpm typecheck` + `pnpm lint` + `vitest` xanh ở cả hai app là xanh của **cổng tĩnh**.
- **Credential AWS thật**: CLI trên máy này trả `ExpiredToken` ⇒ mọi đường AWS của mốc 4 mới được test bằng JSON mẫu, chưa qua `aws` thật.
- **`gh` thật**: các đường GitHub của mốc 4 chưa chạy với một `gh` đã đăng nhập.
- **`cicd-runs` chưa chạy trên tài khoản production** ⇒ nhánh "đọc bị siết nhịp + xin vé" mới có test đơn vị.
- **Agent chạy lại pipeline sau khi sửa** (vế thứ hai của C5): nút *Hỏi agent* đẩy log của bước hỏng (đã redact + clamp) vào phiên, nhưng `runtime/tools/infra-tools.ts` **chưa có tool nào chạm tới màn này** (`infra_view`/`infra_action` chỉ đi qua danh mục tài nguyên) — vòng lặp khép kín "agent sửa rồi chạy lại" vẫn phải bấm tay ở tab Triển khai.
