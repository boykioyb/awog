# Feature — CI/CD: theo dõi và điều khiển pipeline

- **Trạng thái:** Planned — chưa code
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
