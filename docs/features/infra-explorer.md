# Feature — Infra Explorer: màn hình quản lý AWS + Kubernetes trong app

- **Trạng thái:** **Mốc 3 đã code** (2026-09-14) — E1 khung · E3 S3/EC2 · E9 màn Dịch vụ · Nhật ký · + bong bóng phiên. Xem [§Trạng thái thực tế](#trạng-thái-thực-tế-mốc-3--cập-nhật-2026-09-14) ở cuối. **Chưa QA trong Electron thật**
- **ADR:** [0088 — ngữ cảnh hạ tầng ghim theo phiên](../decisions/0088-session-infra-context.md) (chia chung invariant: CLI shell-out, ngữ cảnh ghim sidecar, 3 cấp read/write/forbidden)
- **Route:** `/infra` — **nhãn menu: "AWS"** (đổi 2026-09-14: các mục bên trong gần như toàn dịch vụ AWS; nhãn cũ là "Hạ tầng"). Thanh trên cùng đọc cùng một khoá nên tiêu đề trang cũng là "AWS"
- **Anh em:**
  - [session-infra-context.md](session-infra-context.md) — nền: chọn ngữ cảnh trong phiên + tool cho agent
  - [cloudwatch-logs.md](cloudwatch-logs.md) — **màn Logs, ưu tiên số 1**, tách riêng vì sâu hơn một bảng
  - [infra-topology-graph.md](infra-topology-graph.md) — graph kiến trúc + luồng request theo domain
  - [aws-website-playbook.md](aws-website-playbook.md) — hướng dẫn dựng website chạy được từng bước

## Mục tiêu

Xem và vận hành hạ tầng **ngay trong AWOG**: liệt kê Amplify app và deployment, đọc log CloudWatch, duyệt S3, xem/điều khiển EC2 · ECS/Fargate · EKS · Lambda · RDS, và một màn Kubernetes đủ dùng (workload · log · exec · port-forward). Không phải mở 6 tab console để trả lời một câu hỏi.

### Phạm vi thật — nói trước để khỏi vỡ kỳ vọng

**Làm:** duyệt/tìm/lọc mọi resource chính, xem chi tiết, đọc log, và **hành động ngày-2** trên resource đã tồn tại (start/stop instance, scale service, redeploy branch, rollout restart, xoá object, chạy lại job).

**Không làm:** wizard **tạo mới** hạ tầng phức tạp (EC2 với VPC/subnet/SG/AMI/IAM, cụm EKS, RDS). Dựng lại cái đó là viết lại AWS Console — nhiều màn, nhiều ràng buộc chéo, sai một ô là tốn tiền thật. Chỗ nào cần tạo mới phức tạp, AWOG đưa **nút mở thẳng trang tương ứng trên AWS Console** (deep link theo region + resource id). Tạo mới **chỉ** làm ở nơi nó thật sự là một form nhỏ: bucket/folder S3, upload file, `ecs run-task` từ task-definition có sẵn, nodegroup scale, Amplify start-job.

Với hạ tầng-as-code, đường đúng vẫn là Terraform ([session-infra-context.md](session-infra-context.md) P4) — Explorer là để **nhìn và vận hành**, không phải để thay IaC.

## Kiến trúc: một bảng, nhiều mô tả — không phải 20 trang viết tay

Mấu chốt để "và các thứ khác…" không thành vô hạn: **không** viết một trang cho mỗi service. Viết **một** khung bảng + một **registry mô tả service**, mỗi service là một object khai báo.

Mỗi mô tả khai **hai bộ cột**: `columns.simple` (2–4 cột, nhãn tiếng người) và `columns.full` (đủ như bảng kỹ thuật). Công tắc Đơn giản/Chuyên sâu đổi giữa hai bộ — cùng dữ liệu, cùng màn.

```ts
type ResourceView = {
  id: "ec2.instances";
  service: "ec2";
  label: "EC2 Instances";
  list: {
    args: (ctx) => string[];
    pick: (json) => Row[];
    paginate?: "token" | "none";
  };
  columns: { simple: Column[]; full: Column[] }; // Đơn giản: nhãn tiếng người; Chuyên sâu: đủ cột
  plain?: (row) => string; // một câu mô tả dòng này bằng tiếng người
  detail?: { args: (row) => string[]; render: "json" | "kv" | Tabs[] };
  actions?: Action[]; // { id, label, args, danger, confirm: 'simple'|'type-name' }
  consoleUrl?: (row, ctx) => string; // deep link khi cần làm thứ Explorer không làm
};
```

Thêm một service = thêm một file mô tả (~40–80 dòng), không đụng khung. Bảng, phân trang, tìm kiếm, refresh, cột co giãn, empty state, error state, virtual scroll (>200 dòng, khuôn Git) viết **một lần**.

Mọi `args` đi qua `infra.run` của ADR 0088: arg array, không shell, ngữ cảnh (`--profile`/`--region`) do sidecar chèn, `--output json`, timeout, cap output. Nghĩa là Explorer **không có** đường ra mạng riêng — nó dùng đúng cái cổng mà agent dùng, nên cùng một luật duyệt và cùng một chỗ audit.

## Màn mở đầu: Tổng quan

`/infra` **không** mở ra ở một bảng resource. Nó mở ở **Tổng quan** — trả lời câu hỏi duy nhất mà cả người rành lẫn không rành đều hỏi đầu tiên: _mọi thứ có đang ổn không?_

| Thẻ                     | Đèn  | Câu giải thích (luôn có, bằng tiếng người)                                       |
| ----------------------- | ---- | -------------------------------------------------------------------------------- |
| Website                 | xanh | "shop.example.com phản hồi bình thường, 38 ms"                                   |
| Lỗi 1 giờ qua           | đỏ   | "214 lỗi ở dịch vụ thanh toán — chủ yếu là quá hạn chờ" → bấm mở Logs đã lọc sẵn |
| Máy chủ                 | vàng | "1 trong 4 máy đang tắt (batch-worker)"                                          |
| Chi phí tháng này       | xanh | "412 USD, tương đương tháng trước"                                               |
| Chứng chỉ & tên miền    | vàng | "Chứng chỉ shop.example.com hết hạn sau 21 ngày"                                 |
| Bản triển khai gần nhất | xanh | "Amplify · nhánh main · thành công lúc 09:12"                                    |

Mỗi thẻ bấm được để đi vào màn chi tiết tương ứng, và có nút **Hỏi agent** ngay trên thẻ. Dưới cùng là hàng chip câu hỏi gợi ý. Đây là màn duy nhất nạp nhiều view cùng lúc — nên nó nạp **khi bấm ↻ hoặc khi mở**, không tự làm mới, và ghi rõ thời điểm.

> **Trạng thái 2026-09-13 (Mốc 2).** Màn này đã có ở `/infra` → **Tổng quan** và là
> tab mặc định: `apps/desktop/ui-next/components/infra/InfraOverview.vue` +
> `composables/useInfraOverview.ts`. Bố cục là bento của app (một thẻ "Nền tảng" đọc
> miễn phí: tài khoản/region đang ghim · số profile · binary CLI có trên máy · ma trận
> quyền; sáu thẻ đèn; hàng chip câu hỏi).
>
> **Chỉ thẻ "Lỗi 1 giờ qua" đã có nguồn dữ liệu** — nó chạy CloudWatch Logs Insights
> theo đúng hai bước có người bấm (Ước lượng → Chạy, kèm số USD trên nút), và lấy nhóm
> log từ lịch sử chạy gần đây trong thư viện (đọc trên đĩa, không gọi mạng). Năm thẻ
> còn lại (Website · Máy chủ · Chi phí · Chứng chỉ · Triển khai) hiện **đèn xám** kèm
> câu "chưa đọc được trong bản này" + nút Hỏi agent — chúng thuộc Mốc 3–6. Hiện đèn
> xanh cho một thứ chưa kiểm tra là nói dối người dùng, nên đèn xám là trạng thái
> trung thực, không phải chỗ trống quên lấp.

## Màn Dịch vụ: danh mục đầy đủ

Tổng quan trả lời _"có ổn không"_. **Dịch vụ** trả lời _"AWS có gì, tôi đang dùng gì, và vào đâu để xem"_ — đây là màn duyệt từ trên xuống, thay cho việc phải nhớ tên service.

```
┌ /infra → Dịch vụ ─────────────────────────────────────────────────────┐
│ [tìm dịch vụ hoặc resource…  ⌘K]              [Đơn giản|Chuyên sâu]   │
├───────────────────────────────────────────────────────────────────────┤
│ ĐANG DÙNG TRONG TÀI KHOẢN NÀY (9)                    chi phí tháng 4  │
│  S3 · 18 bucket · 42$   EC2 · 4 máy · 96$   ECS · 4 service · 121$    │
│  CloudFront · 5 · 18$   Lambda · 23 · 3$    RDS · 3 · 104$      …     │
├───────────────────────────────────────────────────────────────────────┤
│ MÁY CHỦ & TÍNH TOÁN          │ LƯU TRỮ & CƠ SỞ DỮ LIỆU                │
│  EC2        Đầy đủ    4      │  S3          Đầy đủ    18              │
│  ECS/Fargate Đầy đủ   4      │  RDS         Đầy đủ     3              │
│  EKS        Đầy đủ    2      │  DynamoDB    Danh sách  7              │
│  Lambda     Đầy đủ   23      │  EFS         Console    —              │
│  Batch      Console   —      │  Backup      Danh sách  2              │
└───────────────────────────────────────────────────────────────────────┘
```

### Ba mức hỗ trợ, hiện thẳng trên thẻ

AWS có hơn 200 dịch vụ; AWOG sẽ không có màn riêng cho từng cái, và **nói thẳng điều đó** thay vì để người dùng bấm vào rồi mới biết.

| Mức nội bộ | Nhãn trên thẻ (vi / en)                | Nghĩa là                                     | Cách làm                                                                                                     |
| ---------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `full`     | **Xem và thao tác** · View and manage  | Bảng + chi tiết + hành động ngày-2           | File mô tả `ResourceView` viết tay (~40–80 dòng)                                                             |
| `list`     | **Chỉ xem danh sách** · List only      | Bảng chỉ đọc, vài cột chính, không hành động | Mô tả **tối giản**: một lệnh `list-*`/`describe-*` + 3–4 cột. Rẻ tới mức thêm được hàng chục dịch vụ mỗi đợt |
| `console`  | **Mở trong Console AWS** · Open in AWS Console | Chưa có trong app                    | Thẻ vẫn hiện, bấm là deep-link đúng region; kèm nút **Hỏi agent**                                            |

**Nhãn đã đổi tên (2026-09-14).** Người dùng: *"tôi chưa hiểu ý nghĩa của các từ này, các badge này?"* — và họ đúng. Nhãn cũ là `full` = *"Full screen in the app"*, một câu đọc ra thành **"mở toàn màn hình"** chứ không nói gì về việc bạn làm được gì; bản tiếng Việt lại là *"Dựng đầy đủ trong app"*, tức "dựng" theo nghĩa của người viết code — hai bản dịch còn không nói cùng một chuyện. Luật mới: **nhãn trả lời "tôi làm được gì"**, còn `title` giữ phần giải thích đầy đủ cho ai cần rê chuột. Nhãn không được nhắc tới chuyện AWOG đã dựng tới đâu — đó là chuyện của AWOG, không phải của người đọc.

### Nút ⓘ giải thích ba nhãn (2026-09-14)

Người dùng: *"có 1 cái button icon info ở góc để mô tả được không?"* — có, và nó bịt đúng lỗ hổng còn lại của lần sửa trước: `title` chỉ giúp người **đã biết là cần rê chuột**, còn người mới thì không biết mà rê.

- **Nút**: `.iconbtn` + icon `info`, nằm ở **góc phải header danh mục** (`.iwrap.ixc-info { margin-left: auto }`). Có `aria-label`, `title` và `aria-expanded`.
- **Nội dung**: mở dưới dạng **popover neo vào nút**, không phải hộp thoại và cũng không phải khối chèn vào luồng trang. Bản đầu (cùng ngày) chèn một `<section>` ngay dưới header: đọc được, nhưng **đẩy cả lưới thẻ xuống**, nên mỗi lần xem lại nhãn là một lần xô lệch trang — người dùng: *"nhấn vào button info sao không hiện dưới dạng popover"*. Popover vẫn để nhìn thấy thẻ phía sau (đó là toàn bộ mục đích), mà không đụng tới bố cục.
- **Khuôn popover là khuôn có sẵn của app**: `.iwrap` + `.ibackdrop` + `.pop.ipop` (cùng thứ ba chip hạ tầng `InfraChip`/`InfraKubectlChip`/`InfraTerraformChip` đang dùng, CSS ở `assets/css/app-shell.css`). Ba đường đóng: nút ✕, bấm ra ngoài (`.ibackdrop` phủ toàn màn hình), bấm lại ⓘ; thêm **Esc** vì bàn phím không "bấm ra ngoài" được.
- **Neo phải, không neo trái**: nút ⓘ nằm sát mép phải header nên `.ixc-ipop { left: auto; right: 0 }` — neo trái thì popover thò ra ngoài cửa sổ. Rộng 320px (rộng hơn `.ipop` mặc định 296px vì ở đây có ba đoạn giải thích), kèm `max-width: calc(100vw - 32px)`.
- **Chú giải dùng CHÍNH những badge đang có trên thẻ** (cùng `.chip` + `.lv-*`, cùng chuỗi `infra.explorer.support.*`), không phải ảnh hay mô tả bằng lời, nên đối chiếu được ngay. Trong popover 320px, nhãn xếp **trên** câu giải thích chứ không hai cột: cột nhãn `max-content` sẽ bóp cột chữ còn ~140px và câu giải thích xuống dòng liên tục. Giữa ba mức có vạch mảnh `1px` để ba mức không đọc liền thành một khối.
- Chuỗi: `infra.explorer.levels.{title,intro,open}`. Phần giải thích từng mức **dùng lại** `infra.explorer.support.hint.*` — một nguồn chữ cho cả tooltip lẫn chú giải, nên hai chỗ không thể lệch nhau.

Kiểm chứng (2026-09-14, dev server + Chromium headless qua CDP, hồ sơ mới nên đã tắt onboarding): popover `position: absolute` (không phải `fixed` như `.pop` mặc định), `right` trùng mép phải nút ⓘ, nằm dưới nút, **`gridTop` của lưới thẻ không đổi sau khi mở** (bằng chứng không đẩy bố cục), không sinh thanh cuộn ngang, `elementFromPoint` tại popover trả về chính popover (không bị lưới thẻ hay bong bóng session che), 3 dòng đúng badge, ✕ / backdrop / Esc đều đóng, `aria-expanded` đổi theo, ở 900px và 1440px đều không tràn cửa sổ. **Chỉ đo ở locale `vi`** trong lần này: hồ sơ headless mặc định `vi`; phần `en` chỉ khác nội dung chuỗi (đã kiểm khớp khoá 215/215 lúc đó; sau đợt mở rộng danh mục cùng ngày là **346/346**), không khác đường render.

Mức "Mở Console" **không phải ngõ cụt**: agent có CLI đầy đủ, nên vẫn hỏi được _"liệt kê các hàng đợi SQS"_ và nhận bảng trả lời — chỉ là chưa có màn riêng. Đây cũng là cách chọn dịch vụ nào nâng lên "Danh sách" hay "Đầy đủ" tiếp theo: cái nào bị hỏi nhiều.

### "Đang dùng trong tài khoản này" — phần quan trọng nhất

Tài khoản trống mà hiện 200 thẻ thì vô dụng. Hàng đầu tiên luôn là **những dịch vụ thực sự đang có resource**, kèm số lượng và **chi phí tháng này**:

- Nguồn chính: `ce get-cost-and-usage --group-by SERVICE` — trả lời chính xác "tôi đang trả tiền cho cái gì". ⚠ API này **tính tiền mỗi request** nên chỉ chạy khi bấm, cache theo ngày, ghi rõ thời điểm.
- Nguồn phụ (miễn phí): `resourcegroupstaggingapi get-resources` cho resource có tag, cộng với số đếm từ chính các view đã nạp.

Bấm một dịch vụ trong hàng này là vào thẳng view của nó.

### Danh mục — đặt tên theo việc, không theo bảng chữ cái

Máy chủ & tính toán · Lưu trữ & cơ sở dữ liệu · Mạng & phân phối · Tên miền & chứng chỉ · Triển khai & CI/CD · Theo dõi & nhật ký · Bảo mật & quyền · Hàng đợi & sự kiện · Chi phí & hoá đơn · Hạ tầng dạng mã · Dữ liệu & AI.

Mỗi thẻ dịch vụ có **một dòng nói nó dùng để làm gì** bằng tiếng người ("S3 — nơi chứa file: ảnh, bản build, sao lưu"), hiện ở chế độ Đơn giản và thành tooltip ở chế độ Chuyên sâu.

#### Mở rộng danh mục 39 → 102 dịch vụ (2026-09-14)

Người dùng: *"phần dịch vụ tôi thấy vẫn thiếu nhiều dịch vụ như valkey?"* rồi *"tôi nghĩ cứ thêm hết đi cho phong phú"*. Hai nửa của câu đó là hai việc khác nhau:

- **Valkey không phải một dịch vụ AWS** — nó là một *engine* của ElastiCache và MemoryDB. Thẻ `elasticache` vốn đã có; chỗ sai chỉ là câu mô tả nói thiếu ("Redis/Memcached"). Nay câu đó kể đủ ba engine ("Redis, Valkey hoặc Memcached", cả `vi` lẫn `en`), và **MemoryDB** được thêm thành thẻ riêng vì nó *là* một dịch vụ riêng (Redis/Valkey bền dữ liệu).
- **Thiếu dịch vụ là thật**: 39 dịch vụ đầu chỉ phủ nhóm hay dùng nhất. Nay danh mục có **102 dịch vụ AWS + Kubernetes = 103 thẻ**, **11 nhóm**.

**Nhóm thứ 11 — "Dữ liệu & AI".** Athena · Glue · EMR · Redshift · OpenSearch · Lake Formation · Bedrock · SageMaker · Textract · Transcribe · Comprehend · Rekognition. Không nhét vào "Lưu trữ & cơ sở dữ liệu" được: nhóm đó trả lời "dữ liệu nằm ở đâu", còn đây là "xử lý/học từ dữ liệu đó" — hai việc khác nhau, và cách đặt tên nhóm theo VIỆC là luật của spec này.

**Slug Console phải kiểm, không được đoán.** Một path sai cho ra thẻ mở **trang trắng** — tệ hơn hẳn một thẻ không có nút ↗, vì người dùng tin là nó sẽ mở được. Cách kiểm không cần credential: `https://<region>.console.aws.amazon.com/<path>/home` trả **200/302** khi path có thật và **404** khi không (`curl`). Nhờ đó loại được `es` (đúng là `aos`), `sso` (đúng là `singlesignon`), `ssm` (đúng là `systems-manager`), `quicksight`, `codestar`, `savingsplans`, `iotanalytics`, `applicationinsights`, `network-firewall`, và giữ `dms/v2` thay vì `dms`. Dịch vụ toàn cầu (Organizations, Global Accelerator, Artifact) dùng host `console.aws.amazon.com` không kèm `?region=`, đúng luật của task 3.4.

**Hai lỗi tìm ra khi làm việc này:**

| Lỗi | Triệu chứng | Sửa |
|---|---|---|
| View `cfn.stacks` khai `about: 'infra.explorer.about.cfn'`, trong khi khoá đó là khoá **duy nhất** tồn tại — còn thẻ danh mục suy khoá theo service id (`about.cloudformation`) | Thẻ CloudFormation in ra chữ `infra.explorer.about.cloudformation` | Đổi khoá thành `about.cloudformation` (theo service id, đúng luật "about theo dịch vụ") và bỏ `about.cfn` |
| Một dịch vụ mức Console có thể được thêm vào `SERVICE_CATALOG` mà quên bảng `svcConsole` | Thẻ có badge "Mở trong Console AWS" nhưng **không có nút ↗** — ngõ cụt | Test mới trong `spec.test.ts`: *mọi dịch vụ mức Console đều có deep link* |

**Bốn chỗ phải sửa cùng lúc** khi thêm một dịch vụ (giữ nguyên như cũ, chỉ nhiều dòng hơn): `SERVICE_CATALOG` + bảng `svcConsole` ở `services-catalog.ts`, bản sao ở `composables/infraCatalogFallback.ts`, và 2 khoá i18n (`svc.*` + `about.*`) ở `vi` + `en`. Bản sao ở renderer đã được đối chiếu lại: **102 mục cùng thứ tự, 88 dòng Console cùng thứ tự, 11 nhóm trùng khớp**.

### Ghim để đổi sidebar

Ghim một dịch vụ ⇒ nó xuất hiện ở **nhóm đầu tiên** của sidebar Explorer. Nghĩa là **sidebar là của bạn**, không phải danh sách tôi chọn cứng: người làm web ghim CloudFront/S3/Route53, người làm data ghim RDS/DynamoDB/Glue. Mặc định ghim sẵn 6 cái hay dùng nhất.

Cột trái **không chỉ có mục đã ghim** (đổi 2026-09-14): dưới nhóm ghim là **toàn bộ 102 dịch vụ của danh mục, chia theo 11 nhóm việc và gập được** — xem §"Ba sửa đổi theo ảnh chụp 2026-09-14".

### Tìm kiếm ⌘K — một ô cho cả hai loại câu hỏi

Gõ `s3` hoặc `lưu trữ` → ra dịch vụ. Gõ `web-prod-1` hoặc `i-0a3f` → ra **chính resource đó** trong các view đã nạp. Gõ `tại sao 502` → chuyển thành câu hỏi cho agent. Một ô, ba loại kết quả, phân nhóm rõ.

### Ba trạng thái trống — và vì sao chúng không được gộp (2026-09-14)

Danh mục nằm ở sidecar (`infra.explorer-catalog`), không nằm trong trang. Nên "không thấy dịch vụ" có **ba nguyên nhân khác hẳn nhau**, và màn Dịch vụ phải nói đúng cái đang xảy ra:

| Trạng thái       | Màn hình nói gì                                                    | Khi nào                                                              |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Đang đọc         | "Đang nạp…"                                                        | RPC đang bay                                                          |
| **Không đọc được** | "Chưa nối được vào AWOG engine…" + nút **Thử lại**               | Chạy `pnpm dev:ui` ở `localhost:3031` bằng trình duyệt thường (`window.awog` không có), hoặc RPC trả lỗi |
| Đọc rồi, không khớp | "Không dịch vụ nào khớp"                                          | Danh mục đã có, ô tìm lọc sạch                                         |

**Lỗi đã sửa.** Bản đầu của `ensureCatalog()` thoát im lặng khi `!sidecar.available`, để `services = []`, và màn Dịch vụ rơi vào nhánh "Không dịch vụ nào khớp" — một câu nói về **ô tìm**. Người mở `localhost:3031/infra` bằng Chrome đọc câu đó và hiểu thành "AWOG không có dịch vụ nào", trong khi thật ra chưa hề gọi được engine. Nay `useInfraExplorerCatalog` giữ `catalogError` (`'offline'` \| `'failed'` \| `null`) và màn Dịch vụ hiện lý do kèm nút thử lại.

Đây đúng quy ước đã dùng cho panel trình duyệt trong session (`session-browser-panel.md`): thiếu shell Electron thì nói thẳng là thiếu, không giả vờ rỗng.

#### Nhưng "nói thẳng là thiếu" vẫn chưa đủ: bản web phải XEM ĐƯỢC (2026-09-14)

Người dùng phản hồi ngay sau đó: *"ủa trên web thì cũng phải hiện chứ? bản mock cũng được chứ"* — đúng. Câu giải thích là đúng nhưng vẫn để lại một màn hình không ai review được bằng web, mà review giao diện bằng `localhost:3031` là việc bình thường.

Nay khi **không có engine**, màn Dịch vụ dựng từ **danh mục mẫu** (`composables/infraCatalogFallback.ts`) và hiện một **băng amber** nói rõ đang xem bản mẫu, không phải tài khoản AWS của người đọc. Chỉ `'failed'` (có engine mà lời gọi hỏng) mới là lỗi thật; `'offline'` chỉ còn là nhãn nội bộ.

| Tình huống | Danh mục | Băng | Nút "Thử lại" |
|---|---|---|---|
| Có engine, gọi được | RPC `infra.explorer-catalog` | không | không |
| **Không có engine** (mở web) | **bản mẫu, đủ 102 dịch vụ** | **có** | không — gọi lại không sinh ra được cầu nối |
| Có engine, gọi hỏng | giữ nguyên thứ đang có | không | có |

**Vì sao bản mẫu là bản sao chứ không import thẳng sidecar.** `services-catalog.ts` kéo theo `aws-views.ts`, tức toàn bộ argv của CLI, vào bundle của renderer — đúng thứ `registry.ts` cố ý chặn. Nên bản mẫu là **dữ liệu thuần**: không lệnh, không hàm chạy được. Nó giữ **đúng hình dạng và đúng thứ tự** của `SERVICE_CATALOG` + `catalogFor()` để diff được hai file bằng mắt; lệch thì hỏng đúng một việc (bản xem trên web trông khác bản thật), và băng amber là thứ chặn hậu quả nặng hơn: hiểu nhầm nó là tài khoản thật.

Hai chỗ dễ sai khi chép, đã dính và đã sửa: `about` của view là khoá theo **dịch vụ** (`infra.explorer.about.s3`) chứ không theo view, và nhãn của tab Kubernetes nằm ở `KUBERNETES_ENTRY` chứ không trong `SERVICE_CATALOG`.

Đo trên `localhost:3031` (2026-09-14, sau khi mở rộng danh mục; engine giả trả đúng payload của `infra.explorer-catalog`, vì bản web hiện có một cầu nối rỗng nên nhánh "không engine" không còn đo được trực tiếp): **103 thẻ**, đủ **11 nhóm**, badge **5 · 10 · 88** (thao tác / danh sách / Console), **88 nút ↗** + **15 nút ›**, **0 thẻ in ra khoá i18n thô**, không có thanh cuộn ngang (`scrollWidth` = `clientWidth` = 962). Bấm EC2 thì sidebar dựng đúng 5 view đã ghim kèm tiêu đề + mô tả lấy từ i18n. Bảng tài nguyên vẫn trống vì **cố ý không tự nạp** — nạp dòng cần engine, và luật "không tự chạy CLI" không bị bản mẫu phá.

## Bố cục màn hình

```
┌ /infra ───────────────────────────────────────────────────────────────┐
│ ⛅ Offshore-Developer ▾   ap-southeast-1 ▾        [↻]  [Console ↗]    │
├────────────┬──────────────────────────────────────────────────────────┤
│ COMPUTE    │  ┌ EC2 Instances ─────────────── [tìm] [lọc: state ▾] ┐  │
│  EC2    12 │  │ ● i-0a3f…  web-prod-1   t3.medium  running  2d    │  │
│  ECS     4 │  │ ○ i-0b71…  batch-1      t3.small   stopped  14d   │  │
│  Lambda 23 │  └──────────────────────────────────────────────────────┘ │
│  EKS     2 │  ┌ Chi tiết: i-0a3f… ───────────────────────────────────┐ │
│ STORAGE    │  │ Tổng quan · Networking · Volumes · Tags · Log        │ │
│  S3     18 │  │ private ip 10.0.3.14 · sg-web · az ap-southeast-1a   │ │
│ DEPLOY     │  │                      [Stop] [Reboot] [Console ↗]     │ │
│  Amplify 3 │  └──────────────────────────────────────────────────────┘ │
│ OBSERVE    │                                                           │
│  Logs      │                                                           │
│ KUBERNETES │                                                           │
│  prod-eks  │                                                           │
└────────────┴──────────────────────────────────────────────────────────┘
```

Sidebar nhóm theo **việc** (Compute · Storage · Deploy · Observe · Data · Kubernetes), không theo bảng chữ cái — và đếm số resource sau lần nạp đầu. Khung ba vùng (sidebar · bảng · chi tiết) tái dùng shell của trang Git, gồm cả sidebar resize/collapse và virtual scroll.

Sidebar có bốn mục cố định trên cùng — **Tổng quan · Dịch vụ · Tài khoản · Nhật ký** — rồi tới các view đã ghim, rồi Topology và Playbooks. *(Khi code, bốn mục cố định đó thành **tab của `/infra`**; riêng **Dịch vụ** là một MẶT của tab chứ không phải tab riêng — xem §"Trạng thái thực tế (Mốc 3)". Cột trái của khung bảng, sau 2026-09-14, là **cả danh mục** chứ không chỉ các view đã ghim.)*

**Thanh ngữ cảnh đầu trang là control DUY NHẤT chọn tài khoản.** Profile · region (*cluster* chưa có ở đây — xem ghi chú dưới) nằm ở đó, mọi view bên dưới derive từ nó — **không view nào có picker account riêng**, vì có picker riêng là có cách để hai bảng cạnh nhau nói về hai account khác nhau mà không ai nhận ra. Đổi ngữ cảnh ⇒ vô hiệu toàn bộ cache và nạp lại; mỗi bảng ghi rõ account + "nạp lúc HH:MM". Account đánh dấu production làm cả thanh đổi màu. Thanh này dùng chung state với chip trong phiên và chip status bar — xem [session-infra-context.md](session-infra-context.md#ngữ-cảnh-là-của-không-gian-làm-việc-không-phải-của-riêng-màn-chat).

*(Trạng thái 2026-09-14: thanh này đã có thật, ở hàng tab của `/infra` — hai ô chọn **Profile AWS** và **Region**; xem §"Ba sửa đổi theo ảnh chụp 2026-09-14" để biết cái gì đã làm và cái gì còn thiếu — `cluster` nằm ở tab Kubernetes, nơi nó vốn đã có ô chọn dùng chung state.)*

**Mỗi dòng, mỗi node, mỗi bước đều có "Hỏi agent"** — đẩy đối tượng đang chọn (JSON rút gọn, đã redact) vào phiên; và ngược lại agent lái được chính màn hình bạn đang mở qua `infra_view`/`infra_action`.

**Trong phiên chat:** cùng khung đó làm **tab Infra** của Workspace Panel, hẹp hơn (bảng + chi tiết, bỏ sidebar → dùng dropdown). Mỗi dòng có **"Gửi vào chat"** — đẩy resource đang chọn (dạng JSON đã rút gọn) vào composer, để hỏi agent _"vì sao pod này restart 14 lần"_ mà không phải copy tay.

## Các view theo service

### AWS — Compute

| View                                | Cột                                                                                                                 | Hành động (day-2)                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **EC2 Instances**                   | id · name (tag) · type · state · AZ · private/public IP · uptime                                                    | Start · Stop · Reboot · _Terminate (gõ tên để xác nhận)_ · Console ↗                                      |
| **ECS Clusters / Services / Tasks** | cluster · service · desired/running/pending · launch type (**Fargate**/EC2) · task-def revision · deployment status | Scale (`--desired-count`) · Redeploy (`--force-new-deployment`) · Stop task · Xem log task (→ CloudWatch) |
| **EKS Clusters**                    | tên · version · status · endpoint · nodegroup (số node, instance type, desired/min/max)                             | `update-kubeconfig` (nối sang màn Kubernetes) · Scale nodegroup · Console ↗                               |
| **Lambda Functions**                | tên · runtime · memory · timeout · last modified · lần gọi gần nhất                                                 | Xem log (→ CloudWatch) · Invoke (payload JSON, **duyệt**) · Console ↗                                     |

### AWS — Storage · Data

| View                     | Cột                                                                    | Hành động                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S3 Buckets → Objects** | duyệt như cây thư mục: key · size · storage class · sửa lần cuối       | Upload · Tạo folder · Tải về · **Xem nội dung qua `usePreview()` sẵn có** (ảnh/PDF/md/text) · Copy URL ký sẵn (presign, hạn ngắn) · Xoá (xác nhận) |
| **RDS Instances**        | id · engine + version · class · status · storage · multi-AZ · endpoint | Console ↗ · _(không start/stop ở v1 — dễ tốn tiền và có ràng buộc thời gian)_                                                                      |
| **DynamoDB Tables**      | tên · item count · size · billing mode · index                         | Xem item mẫu (scan giới hạn) · Console ↗                                                                                                           |

### AWS — Deploy · Observe

| View                               | Cột                                                                                 | Hành động                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Amplify Apps → Branches → Jobs** | app · branch · job id · status (`SUCCEED`/`FAILED`/`RUNNING`) · commit · thời lượng | **Xem log build** (stream) · **Start job** (redeploy branch) · Stop job · Mở URL branch ↗                                                     |
| **CloudWatch Logs**                | → **[cloudwatch-logs.md](cloudwatch-logs.md)**                                      | Insights · lọc nâng cao · histogram kéo-zoom · live tail · **lần theo một request xuyên service**. Đây là màn được đầu tư nhất, có spec riêng |

### AWS — Network · Delivery · Định nghĩa hạ tầng

| View                                | Cột                                                                                                                                                 | Hành động                                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API Gateway** (REST v1 + HTTP v2) | api · protocol · stage · route/resource + method · integration (→ Lambda/ALB/HTTP) · authorizer · custom domain · access log bật/tắt                | Xem log của stage (→ Logs) · Deploy stage (**duyệt**) · Bật access log (**duyệt**) · Console ↗                                                                                                                 |
| **CloudFront**                      | distribution · aliases (tên miền) · origin · behavior (path → origin) · cache policy · status · WAF                                                 | **Tạo invalidation** (thao tác ngày-2 hay dùng nhất) · Xem lịch sử invalidation · Bật/tắt distribution (**gõ tên xác nhận**) · Console ↗                                                                       |
| **VPC**                             | VPC · subnet (AZ, CIDR, public/private theo route table) · route table · IGW/NAT · **security group + luật in/out** · NACL · endpoint · peering/TGW | Xem luật SG dạng bảng đọc được · _(sửa SG = duyệt, sau)_ · **Xem dạng graph** (→ [topology](infra-topology-graph.md) chế độ VPC)                                                                               |
| **CloudFormation**                  | stack · status · drift · cập nhật lần cuối · outputs · parameters                                                                                   | Xem resource của stack (bấm là nhảy sang view của service đó) · Xem events theo thời gian · **Xem template** (Monaco read-only) · Xem change set · _Thực thi change set → **forbidden**_, hiện lệnh để tự chạy |
| **Route53**                         | hosted zone · record (type, giá trị, TTL, ALIAS target) · health check                                                                              | Xem NS · **Mở graph từ domain này** · Console ↗                                                                                                                                                                |
| **ACM**                             | cert · domain + SAN · status · ngày hết hạn · region                                                                                                | Cảnh báo cert sắp hết hạn · Xem CNAME xác thực còn thiếu                                                                                                                                                       |

> ⚠ ACM cho CloudFront **bắt buộc ở `us-east-1`** — view ACM vì thế luôn hiện thêm cột region và cảnh báo khi bạn đang ở region khác mà tìm cert cho CloudFront. Đây là chỗ sai phổ biến nhất khi dựng website.

### Kubernetes (một màn kiểu Lens-lite)

Nguồn: `kubectl` với context + namespace ghim theo ngữ cảnh (ADR 0088). Không dùng SDK.

| Nhóm          | View                                                                                                          | Hành động                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workloads** | Pods (tên · ready · status · restarts · node · age) · Deployments · StatefulSets · DaemonSets · Jobs/CronJobs | **Log** (tail, chọn container, `--previous` khi crash) · **Exec** (terminal thật qua node-pty) · Describe · **Scale** · **Rollout restart** · Xoá pod (xác nhận) |
| **Network**   | Services · Ingress · Endpoints                                                                                | **Port-forward** bật/tắt (khuôn [SshForwardPanel](../../apps/desktop/ui-next/components/ssh/SshForwardPanel.vue), bind `127.0.0.1`)                              |
| **Config**    | ConfigMaps (xem được) · Secrets (**chỉ tên + key, không hiện giá trị**; muốn xem thì bấm nút riêng có duyệt)  | Sửa ConfigMap (duyệt)                                                                                                                                            |
| **Cluster**   | Nodes (cpu/mem, điều kiện) · Events (sắp theo thời gian, lọc warning) · Namespaces                            | Cordon/Drain → **forbidden** trong app, chỉ hiện lệnh để tự chạy                                                                                                 |

#### Đã có trước E7: tab **Kubernetes** trong `/infra` (2026-09-14)

Phần nền của mục này đã land sớm hơn E7 vì hai lý do không phải "xem cho biết": **onboarding** (người
không quen terminal không có cách nào thêm một cluster) và **ba câu hỏi hằng ngày** (pod nào hỏng, log nó
ra sao, restart deployment thế nào). Cấu trúc: `pages/infra.vue` (tab `kubernetes`, mount lười) →
`components/infra/InfraKubernetes.vue` → `useInfraKube.ts` (page-controller) → RPC **`infra.kube`**.

| Đã có                                                                         | Ghi chú                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bảng context + chọn context · file kubeconfig đang đọc · khối bảo lãnh binary | Trong modal _Quản lý cluster_. `~/.kube/config` + `KUBECONFIG`, parser allowlist-key — token/cert/khối `exec` không bao giờ rời file                       |
| **Thêm cluster EKS** bằng cú bấm                                              | chọn profile AWS → region → _Tìm cluster_ (`aws eks list-clusters`) → _Thêm vào kubeconfig_ (`aws eks update-kubeconfig`). Lớp `write` ⇒ hỏi duyệt một lần |
| **Pods** (tên · ready · status · restarts · age) + ô chọn namespace           | `kubectl get pods --no-headers`; bảng chữ nên là lớp `read` chạy thẳng                                                                                     |
| **Xem log** pod (chọn container, số dòng, ↻) và **Chi tiết** (`describe`)     | Bấm cả hàng pod để mở **modal** hai tab Log ⇄ Chi tiết. Không stream — `kubectl logs -f` là việc của tab Logs (việc 21)                                    |
| **Khởi động lại** deployment (`rollout restart`) · **Xoá pod**                | Cùng cổng quyền như mọi bề mặt: `write` ⇒ hộp duyệt + vé; `destructive` ⇒ mặc định **chặn**, hiện đúng dòng lệnh để tự chạy                                |
| **Tìm** trong bảng đang xem                                                   | Khớp tên hoặc bất kỳ ô nào, lọc **tại chỗ** trên hàng đã tải — không lượt `kubectl` nào thêm (xem _Tìm trong bảng, lọc log, và mục Báo cáo_)               |
| **Lọc dòng** trong khung log/`describe`                                       | Giấu dòng không khớp (mặc định) hoặc giữ cả mạch log và tô sáng dòng khớp; trần 2000 dòng có đếm ra                                                        |
| Mục **Báo cáo** của vùng bảng                                                 | Đèn + điểm sức khoẻ tự tính + thanh phân bố trạng thái + top khởi động lại + dải xu hướng; _Theo dõi_ là hành động **có người bấm**, có trần 15 phút       |

#### Bố cục: một màn, không cuộn trang (2026-09-14)

Bản đầu của tab xếp bốn khối dọc (bảng context · thêm cluster · hai bảng workload · khung log) nên màn nào
cũng phải cuộn để thấy hết. Nay tab **không cuộn ở cấp trang**: một thanh ngữ cảnh, rồi một khung bảng lấp
hết phần còn lại — **Pods** và **Deployments** là hai tab của cùng một chỗ, và chỉ bảng bên trong cuộn.
Thứ gì không phải câu hỏi hằng ngày thì nằm trong lớp phủ: quản lý cluster (bảng context + thêm EKS) là một
modal, log/describe của một pod là một modal, chú thích dài là một popover.

Kèm theo đó là một luật về _thời điểm nạp_: **chọn cluster hoặc namespace là nạp bảng ngay**. "Không
auto-refresh" ở dưới cấm nạp _sau lưng_ người dùng (poll, watch, timer); nó không cấm làm theo đúng cú bấm
vừa rồi. Ngược lại, để màn trống chờ người dùng tự tìm nút ↻ là ngõ cụt với người không quen terminal.

**Chưa có (vẫn ⬜ của E7):** log viewer **stream** (`-f`, nhiều container, tìm trong _luồng đang chảy_ — lọc
trên ảnh chụp đã có, xem mục dưới) · **exec** vào pod
qua PTY · **port-forward** có trạng thái · bảng ConfigMaps/Secrets/Nodes/Events · scale. Và vẫn cần một tab
`Explorer` riêng với sidebar nhóm theo việc (Compute · Storage · Deploy · Observe · Data · Kubernetes) cho
phần AWS còn lại.

#### Trạng thái chờ, khoá nút, và phản hồi (2026-09-14)

Lượt đầu của tab nạp và ghi dữ liệu mà không nói gì: thân bảng trắng trong lúc nạp (trông y hệt "không có
pod nào"), nút ghi bấm được hai lần (hai `rollout restart` cho cùng một deployment), lỗi nằm im trong bảng,
và `null` (bị chặn / CLI không chạy được) trả về khung log trống không một chữ giải thích. Năm luật để không
lặp lại:

1. **Đang nạp thì phải thấy đang nạp.** Chưa có hàng nào ⇒ khung xương
   ([InfraKubeTableSkeleton.vue](../../apps/desktop/ui-next/components/infra/kube/InfraKubeTableSkeleton.vue))
   bám theo số cột của bảng thật để lúc dữ liệu về không nhảy bố cục. Nạp **lại cùng ngữ cảnh** (↻) ⇒ giữ
   nguyên hàng và **làm mờ** (`.ikdim`) thay vì xoá: người dùng đang đọc dở mà hàng biến mất là mất chỗ đang
   đọc. Đổi **cluster hoặc namespace** thì ngược lại — hàng cũ bị xoá và khung xương hiện ra, vì hàng của
   namespace khác nằm dưới tên namespace mới còn tệ hơn một bảng trống.
2. **Một hành động ghi tại một thời điểm.** `restarting`/`deleting` giữ **tên đối tượng** (không phải boolean)
   nên chỉ nút của đúng hàng đó quay/khoá, và mọi nút ghi khác trong khung cũng khoá (`actionBusy`) — cú bấm
   thứ hai (chuột đúp, hoặc bấm vội vì tưởng chưa ăn) không được thành lệnh thứ hai.
3. **Nút đang chạy phải tự nói nó đang chạy**: icon `refresh` + `.ikspin`, `aria-busy`, và chữ đổi
   ("Đang bảo lãnh…", "Đang tìm…"). Nút vô hiệu mà đứng im thì không phân biệt được với nút hỏng.
4. **Đổi ngữ cảnh giữa chừng là cảnh race thật** (`loadEpoch`). Mỗi lần đổi cluster/namespace tăng một số thế
   hệ; hàm nạp đọc số đó lúc bắt đầu và **bỏ** kết quả về muộn — không đụng cờ nạp, không đụng bảng. Không có
   nó, bảng của cluster CŨ đổ vào màn của cluster MỚI: dữ liệu đúng nhưng sai ngữ cảnh, thứ nguy hiểm nhất ở
   màn hạ tầng. Ô chọn cluster/namespace và nút _Dùng_ trong modal cũng khoá trong lúc nạp (lớp thứ hai,
   dành cho người dùng).
5. **Thành công lẫn thất bại đều phải thành tiếng.** Toastr cho mọi hành động ghi (`rollout restart`, xoá
   pod, thêm cluster EKS, bảo lãnh đường dẫn binary, chép lệnh — chép _hỏng_ cũng báo, vì "Đã chép" khi
   clipboard không ghi được là lời nói dối) **và** cho lượt nạp hỏng: lỗi nằm rải trong từng bảng thì người
   dùng ngồi đợi một khung không bao giờ đầy. Xác nhận trước khi ghi vẫn là hộp duyệt hạ tầng
   (`useConfirm kind: 'infra'`): `write` ⇒ hỏi + vé; xoá pod ⇒ phải **gõ lại tên pod**.

#### Tìm trong bảng, lọc log, và mục Báo cáo (2026-09-14)

Ba câu hỏi của người dùng — _"pod nào hỏng"_, _"log nó nói gì"_, _"cụm này có ổn không"_ — trước phiên này
đều phải trả lời bằng mắt trên một bảng dài: không có ô tìm, log chỉ cuộn chứ không lọc, và không có chỗ nào
nói "ổn hay không" ngoài việc tự đếm. Nay:

| Thêm                                                                                                                                                                                                                 | Ở đâu                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Ô **tìm** trong bảng đang xem — khớp **tên hoặc bất kỳ ô nào** (trạng thái, số lần restart…), đếm `Khớp {shown}/{total} hàng`, nút xoá, và khối "không hàng nào khớp" kèm đường thoát                                | `InfraKubeWorkloads.vue`                        |
| Thanh **lọc dòng** trong khung log/`describe`: số dòng khớp, nút đổi _Chỉ dòng khớp ⇄ Tất cả dòng_ (giấu dòng không khớp, hoặc giữ cả mạch log và **tô sáng** dòng khớp), trần 2000 dòng có **đếm ra** phần không vẽ | `InfraKubeOutPane.vue`                          |
| Mục thứ ba của vùng bảng: **Báo cáo** — đèn 4 mức, điểm sức khoẻ 0–100, 4–5 ô chỉ số, thanh phân bố theo trạng thái, top khởi động lại, danh sách "cái gì đang lệch", dải xu hướng, _Sao chép báo cáo_ / _Hỏi agent_ | `InfraKubeReport.vue` + `useInfraKubeReport.ts` |
| **Theo dõi** (mặc định TẮT, nhịp 30s, trần 15 phút, `onBeforeUnmount` dừng khi rời mục) — vòng lặp _có người bấm và nhìn thấy_, không phải auto-refresh sau lưng ai                                                  | `useInfraKubeReport.ts`                         |

Vì sao Báo cáo **không** thành một màn riêng cấp trang: mọi con số ở đây là chuyện của _một_ cluster/namespace
đang ghim (pod, deployment, số lần khởi động lại). Màn _Tổng quan_ nói về tài khoản AWS (chi phí, log, danh
tính) — trộn hai thứ đó là để người dùng đọc một chỗ rồi tưởng nó nói về chỗ khác. Và vì sao **không** có màn
"monitor" riêng: một màn chỉ để tự nạp lại theo nhịp là đúng thứ luật "không auto-refresh" cấm.

Số liệu của Báo cáo **không** có nguồn riêng (không RPC mới, không hộp duyệt mới) — nó là cách nhìn khác của
đúng hai bảng người dùng vừa nạp. Điểm sức khoẻ là **công thức tự khai**: 55% tỉ lệ pod sẵn sàng · 35% tỉ lệ
bản sao deployment · 10% mức khởi động lại, và **mỗi phần chỉ được tính khi có dữ liệu** (một cụm chỉ có pod
thì không bị trừ điểm vì "không có deployment"). Chưa đo được gì ⇒ đèn **xám** và điểm hiện `—`, tuyệt đối
không phải 0 điểm xanh; pod `Completed` (Job/CronJob) không bị tính là hỏng nhưng vẫn được **nói ra** để
"3/5 sẵn sàng" không thành câu đố.

**Chín luật đáng nhớ của nhánh này** (đừng vô hiệu hoá khi sửa tiếp):

1. UI **không ghép argv**. Nó gửi `op` + tên đã chọn từ danh sách; sidecar validate (DNS-1123, không bắt
   đầu bằng `-`) rồi mới dựng lệnh. Tên pod do một cluster bịa ra (`--kubeconfig=/etc/passwd`) không bao
   giờ trở thành cờ.
2. Bảng dùng `--no-headers`, **không** `-o json`/`custom-columns`: hai định dạng sau in nội dung object nên
   bị `sensitiveReadOf()` xếp vào nhóm phải hỏi — mỗi lần nạp bảng sẽ là một hộp duyệt.
3. Cổng quyền là **một hàm dùng chung** (`infra/gated.ts`), không phải logic chép trong từng RPC: `block`
   thì không spawn, `ask` thì đòi vé do sidecar phát và dùng một lần.
4. Trang **không cuộn**: chỉ thân modal (`.ikm-body`) và bảng (`.ikscroll`) được cuộn. Thêm một khối vào
   luồng của trang là mở lại đúng vấn đề bố cục mà bốn khối cũ gây ra — chỗ của nó là một lớp phủ.
5. Ô chọn ngữ cảnh **luôn chứa giá trị đang ghim** (`withPinned` trong `InfraKubernetes.vue`), kể cả khi lượt
   đọc danh sách hỏng hoặc quyền hạn chế không trả về nó. Thiếu nó thì ô chọn hiện placeholder trong khi app
   vẫn đang nói chuyện với cluster/namespace đó — người dùng đọc được một ngữ cảnh khác hẳn sự thật.
6. Mọi lượt nạp và lượt ghi đều có **trạng thái chờ + phản hồi** (khung xương/khoá nút/thế hệ ngữ cảnh/toast —
   xem _Trạng thái chờ, khoá nút, và phản hồi_ ở trên). Thêm một hành động mới vào tab này thì thêm luôn bốn
   thứ đó; thiếu chúng là quay lại đúng bộ lỗi vừa vá.
7. **Tìm và lọc là việc của màn hình, không phải của cluster.** Ô tìm trong bảng lọc **tại chỗ** trên các
   hàng đã tải (khớp tên **hoặc** bất kỳ ô nào — gõ `CrashLoop` phải ra nhóm pod đó), thanh lọc trong khung
   log lọc trên chữ **đã** tải về; **không** RPC mới, không `--field-selector`, không lượt `kubectl` thứ hai.
   Muốn nhiều dữ liệu hơn thì đổi _số dòng_ hoặc bấm ↻ — hai hành động nói thẳng điều đó.
8. **Đổi đối tượng thì xoá từ khoá, và luôn có đường thoát.** Chuyển tab bảng, đổi pod, đổi namespace ⇒ từ
   khoá bị xoá (từ khoá gõ cho pod mang sang bảng deployment là lọc nhầm bảng khác, và người dùng sẽ tưởng
   bảng kia rỗng). Không kết quả nào khớp ⇒ **câu giải thích + nút xoá từ khoá**, không phải bảng trắng.
9. **Mục _Báo cáo_ là một CÁCH NHÌN, không phải một nguồn dữ liệu mới.** Nó chỉ tính từ hai bảng người dùng
   đã tự nạp, nên không tốn thêm giây nào và không cần hộp duyệt mới. Điểm sức khoẻ là **công thức tự khai**
   (55% pod sẵn sàng · 35% bản sao deployment · 10% khởi động lại; phần nào không có dữ liệu thì không tính)
   và mọi chỗ hiện nó đều kèm "tự tính / không phải SLA". Chưa đo được gì ⇒ đèn **xám** + `—`, không bao giờ
   là 0 điểm xanh. Muốn số mới thì bấm ↻ hoặc **bật theo dõi** — vòng lặp có người bấm, có trần 15 phút, dừng
   khi rời mục; một màn "monitor" tự nạp theo nhịp chính là thứ luật _không auto-refresh_ cấm.

Ba thứ làm màn này khác một bảng `kubectl get`: **log viewer** (tail + tìm + nhiều container), **exec** (cắm thẳng vào PTY sẵn có — [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md)), **port-forward có trạng thái** (thấy cổng nào đang mở, tắt được).

## Hành động ghi: luật chung

Người bấm nút _chính là_ hành vi duyệt. Agent bấm cùng nút đó qua `infra_action` thì đi qua **ma trận quyền** ở Settings (Tự động / Hỏi / Chặn, cột riêng cho account production) — cùng một hành động, hai đường vào, một luật. Luật:

1. Mọi nút ghi mở hộp xác nhận **nói hậu quả trước bằng tiếng người** — _"Máy chủ web-prod-1 sẽ bị xoá vĩnh viễn. Website đang chạy trên nó sẽ ngừng."_ — rồi mới tới ngữ cảnh (`profile · region · account id`) và **dòng lệnh đầy đủ nằm trong mục _Chi tiết kỹ thuật_ gập lại**. Không có "cho phép và đừng hỏi lại".
2. Hành động **phá huỷ hoặc tốn tiền** (terminate instance, xoá bucket/object hàng loạt, xoá deployment, scale về 0 ở prod) → **gõ lại tên resource** mới bật được nút, khuôn "gõ tên repo để xoá" của GitHub.
3. Ngữ cảnh **đánh dấu production** → viền đỏ toàn hộp + câu xác nhận nhắc tên account/cluster.
4. Lớp **phá huỷ** mặc định là **Chặn** trên account production (hiện lệnh + deep link Console thay vì chạy) — nhưng đây là **ô trong ma trận**, chủ account nới được nếu muốn; nới thì chip nhuộm cảnh báo và mọi lệnh vào nhật ký.
5. Mọi lệnh ghi đi qua `infra.run` ⇒ vào **git-command-log-style ring buffer** để xem lại "app đã chạy gì trên account của tôi" ([khuôn log lệnh git](git-command-log.md)).
6. Nút ghi **tự khoá và tự quay** trong lúc lệnh chạy, và nói kết quả bằng **toastr** — thành công _và_ thất bại. Nút bấm được hai lần nghĩa là hai lệnh; im lặng khi hỏng nghĩa là để người dùng tự đoán. Chi tiết ở _Trạng thái chờ, khoá nút, và phản hồi_ phía trên.

## Hiệu năng, chi phí, và giới hạn

- **Không auto-refresh.** Mỗi view nạp khi mở và khi bấm ↻. Lý do: mỗi lần nạp là một lần gọi API thật; auto-refresh 30s trên 10 view là hàng nghìn call/ngày (và với Cost Explorer thì **mỗi request tốn tiền**).
- **Cache theo `(profile, region, view)`** trong bộ nhớ sidecar, TTL ngắn, hiện "nạp lúc HH:MM" trên bảng để không ai nhầm số cũ là số live.
- **Phân trang bằng token của CLI** (`--max-items`/`--starting-token`), không kéo hết rồi lọc client.
- **Tail log là tiến trình sống** — đếm và tắt khi rời tab, như PTY/port-forward đang làm.
- Account nhiều nghìn resource: bảng ảo hoá (>200 dòng) + tìm kiếm đẩy xuống CLI khi service hỗ trợ filter, không lọc trong JS.

## Lộ trình

Phụ thuộc: **P0 của [session-infra-context.md](session-infra-context.md)** (adapter + `infra.run` + gate + ngữ cảnh ghim) phải xong trước — Explorer ngồi trên đúng cái cổng đó.

| Pha     | Nội dung                                                                                                                                                                                                                               | Ước lượng |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **E1**  | Khung Explorer: registry `ResourceView`, trang `/infra` (sidebar · bảng · chi tiết), bảng dùng chung (tìm/lọc/phân trang/virtual scroll/empty/error), hộp xác nhận ghi, ring buffer lệnh                                               | L         |
| **E2**  | **CloudWatch Logs L1–L3** → [cloudwatch-logs.md](cloudwatch-logs.md). Đi trước mọi view khác vì đây là thứ mở hằng ngày                                                                                                                | L         |
| **E3**  | **S3** (duyệt + preview + upload/tải/xoá) · **EC2** (start/stop/reboot) — hai view "đơn giản" để chốt khung bảng và hộp xác nhận                                                                                                       | M         |
| **E4**  | **Delivery & API**: **CloudFront** (+ invalidation) · **API Gateway** · **Route53** · **ACM** — cụm phục vụ website, và là đầu vào của graph                                                                                           | L         |
| **E5**  | **Container & deploy**: **ECS/Fargate** · **EKS** · **Amplify** (log build, start job) · **Lambda**                                                                                                                                    | L         |
| **E6**  | **CloudFormation** (resource/events/template/change set) · **VPC** (subnet/route/SG)                                                                                                                                                   | M         |
| **E7**  | **Màn Kubernetes**: phần nền (context · thêm cluster · pods · log ảnh chụp · describe · rollout restart) **đã có** ở tab `/infra → Kubernetes`; còn lại **log stream**, exec PTY, port-forward, ConfigMaps/Secrets/Nodes/Events, scale | L         |
| **E8**  | Tab **Infra** trong Session Workspace Panel + "Gửi vào chat" + agent đọc được view đang mở                                                                                                                                             | M         |
| **E9**  | **Màn Dịch vụ**: danh mục đầy đủ · hàng "đang dùng" (Cost Explorer + tagging API) · ba mức hỗ trợ · ghim đổi sidebar · tìm kiếm ⌘K                                                                                                     | M         |
| **E10** | Mức **Danh sách** hàng loạt: mô tả tối giản cho những dịch vụ đang ở mức Console mà hay dùng (SSM · Glue · EKS · CloudFront…). Danh mục 2026-09-14 đã có 102 dịch vụ, nhưng mức hỗ trợ thì chưa nâng: 88/102 vẫn chỉ mở được Console                                    | S/dịch vụ |

Thứ tự theo **tần suất mở thật**, không theo độ khó. CloudWatch trước tiên; cụm CloudFront/APIGW/Route53/ACM (E4) đi sớm vì nó vừa là thứ hay động tới, vừa là dữ liệu đầu vào của [graph](infra-topology-graph.md) và [playbook](aws-website-playbook.md).

## Trạng thái thực tế (Mốc 3) — cập nhật 2026-09-14

Đã code **3.1 → 3.10** (trừ hai điểm lệch ghi dưới bảng). Cửa vào là **6 tab** của `/infra`: Tổng quan · **Dịch vụ** (danh mục + bảng tài nguyên) · Nhật ký · Logs · Kubernetes · Tài khoản.

**Gộp tab "Khám phá" + "Dịch vụ" (2026-09-14).** Người dùng nhận ra: *"cái khám phá này là cái gì nhỉ? tôi hiểu nó là page con trong dịch vụ thôi chứ?"* — đúng, và nó lệch với chính §"Bố cục màn hình" ở trên (một màn, sidebar có mục *Dịch vụ*). Bằng chứng của sự trùng lặp: danh mục không có dữ liệu nào của riêng nó; cột trái của bảng có nút "+ Dịch vụ" chỉ để **nhảy sang tab kia**; hai tab dùng chung một store `useInfraExplorerCatalog`; ô ⌘K của danh mục còn tìm trên dòng đã nạp của bảng.

Luật mới — **một tab, hai mặt**:

| Mặt | Khi nào | Ghi chú |
|---|---|---|
| **Danh mục** (`InfraServicesCatalog`) | mặc định khi mở tab | chiếm trọn vùng bảng; tốn **0 lời gọi** (chỉ đọc hằng số ở sidecar) |
| **Bảng tài nguyên** (`InfraExplorer`) | ngay khi chọn một dịch vụ / một dòng đã nạp | cột "Dịch vụ đã ghim" vẫn ở bên trái; nút **Tất cả dịch vụ** mở lại danh mục |

Nút **Quay lại** của danh mục chỉ hiện khi đã từng mở một view — một nút dẫn tới khung trống còn tệ hơn không có nút (luật đã dùng cho nút ↗ ở màn Nhật ký). Không còn cú nhảy tab nào ở giữa, và **không có lời gọi CLI nào** cho tới khi người dùng chọn một dịch vụ: khung Explorer lúc mount chỉ đọc hằng số danh mục rồi chọn view đầu **trong bộ nhớ** (không nạp).

**Sửa kèm một lỗi CSS hiện trên ảnh chụp:** `.infra-pane` của trang bị gắn thẳng lên phần tử gốc của component con, mà Vue đưa scope-id của cha xuống gốc con ⇒ `display:flex; flex-direction:column` của pane **đè** `display:grid` hai cột của `.ixe` khiến cột "Dịch vụ đã ghim" chảy xuống nằm **trên** bảng. Nay mọi pane là một `<div>` bọc, và có luật `.infra-pane > *` để khung bên trong lấp hết chỗ.

**Sửa kèm lỗi thứ hai trên ảnh chụp tiếp theo (`assets/css/prototype.css`).** Màn **Tổng quan** vỡ: các thẻ bento chồng lên nhau, chữ bị cắt thành cột vài chục px. Nguyên nhân **không** nằm ở `/infra` mà ở lưới dùng chung: `@media(max-width:980px)` đổi `.bento` sang **6 cột** nhưng **quên `.c12`**, nên thẻ `grid-column: span 12` đẻ ra 6 cột ẩn và làm cả lưới co lại. Đo ở viewport 884px trước khi sửa: `grid-template-columns` = 6 track **1.33px** + 6 track 111.8px, hai thẻ đầu cao **2047px** và đè lên nhau. Sau khi thêm `.c12{grid-column:span 6}`: 6 track đều 127.16px, thẻ rộng 410px, **0 cặp chồng nhau**.

Lỗi này **có sẵn trong `prototype.css`** (không phải do đợt sửa pane ở trên) và ảnh hưởng cả **trang Home** vì `pages/index.vue` cũng dùng `.tile c12` — đã đo lại trang Home sau khi sửa: 6 track đều nhau, không chồng lấn. Cửa sổ AWOG hẹp hơn 980px là điều kiện kích hoạt, nên nó chỉ hiện khi người dùng kéo nhỏ cửa sổ.

**Sửa kèm hai lỗi nhỏ hơn trên ảnh chụp thứ ba (2026-09-14).** Người dùng: *"đang thiếu margin top. các text trên tab đang hơi mỏng khó đọc."*

1. **Thiếu đệm trên ở tab Dịch vụ.** Đo khoảng từ vạch phân cách của thanh tab xuống **chữ đầu tiên** ở cả 6 tab:

   | Tab | Trước | Sau |
   |---|---|---|
   | Tổng quan | 20px | 20px |
   | Nhật ký | 16px | 16px |
   | **Dịch vụ** | **6px** | **14px** |
   | Logs | 14px | 14px |
   | Tài khoản | 12px | 12px |
   | Kubernetes | 10px | 10px |

   Đây **không** phải lỗi của thanh tab: mọi pane khác đều tự mang đệm trên (10–20px) từ component của nó, riêng `InfraServicesCatalog` để `.ixc-hd` ở `0` nên hàng "Danh mục Dịch vụ" dính sát vạch kẻ. Sửa bằng 8px ở `.ixc-hd`, đưa tab Dịch vụ về đúng dải của các tab còn lại.

2. **Nhãn tab quá mảnh.** `.infra-section-tab` không khai `font-weight` nên kế thừa `400` từ `body`; ở `--fs-sm` (12px) trên nền tối thì khó đọc. Nay **550** cho tab thường và **650** cho tab đang chọn — cùng dãy độ đậm app đã dùng (`.li .ttl` = 550, `.iov-title` = 650), không phải một cỡ mới. Không đổi `color`: `--textMuted` là token, tăng độ đậm đã đủ cải thiện tương phản cảm nhận.

Đổi độ đậm ảnh hưởng cả 6 tab (đúng ý người dùng); đệm trên chỉ đổi tab Dịch vụ.

### Ba sửa đổi theo ảnh chụp thứ tư (2026-09-14)

Người dùng, ba câu liền nhau: *"1. khi collapse trang dịch vụ đang hiển thị 1 gap lớn hãy bỏ 2. đưa dropdown account lên trên đầu, các dịch vụ, service phải theo account đó 3. đang chỉ hiển thị danh sách pin, tôi muốn hiển thị full danh sách, hiện thị theo group collapse"*.

**1. Thu gọn cột trái = KHÔNG VẼ CỘT.** Bản trước, khi thu gọn, `InfraExplorer` vẫn vẽ một thanh ray 44px suốt chiều cao pane chỉ để giữ nút mở lại — cộng lề 14px và đệm pane thành một dải rỗng ~74px bên trái bảng (ảnh chụp: khung đỏ người dùng khoanh). Nay cột bị `v-if` bỏ hẳn, và **nút mở lại nằm ở đầu cột phải** (`.ixe-expand`, icon + chữ "Dịch vụ") — nơi nó không chiếm chỗ của bảng và vẫn hiện khi chưa chọn view nào. `SIDEBAR_RAIL`, CSS `.ixe-side.off` và nhánh "nút nằm giữa ray" đều bị xoá theo: một hằng số còn lại nhưng không ai dùng là thứ sẽ được "khôi phục" nhầm ở lần sau.

**2. Thanh ngữ cảnh AWS ở hàng tab.** Component mới `components/infra/InfraContextBar.vue`, đặt trong hàng tab của `/infra` (bọc `.infra-top` + `.infra-sections` để `role="tablist"` không chứa một control khác loại). Hai ô chọn: **Profile AWS** (danh sách gốc từ `~/.aws`, không lọc theo ô tìm của tab Tài khoản) và **Region** (region đang ghim + region khai trong các profile + danh sách region chuẩn).

- Component chỉ BIND; luật an toàn đi qua `useInfraPage`: `setDefaultProfile()` (đổi profile ⇒ `accountId` cũ bị xoá, chỉ điền lại khi `ssoAccountId` là giá trị nằm sẵn trong `~/.aws/config`) và `setRegion()`. **Region đi theo profile khi profile có khai region**: đọc tài khoản mới bằng region cũ là đúng credential nhưng sai chỗ. Profile không khai region thì giữ region đang ghim (xoá trắng ⇒ mất luôn region cho mọi lệnh sau).
- **Dịch vụ đọc theo tài khoản đó** — `useInfraExplorer` nay theo dõi khoá ngữ cảnh `(profile, region, accountId)`: dòng, trang kế, chi tiết và kết quả dò quyền bị dọn, view đang mở (không cần tham số) được **nạp lại**, và phép dò quyền chạy lại vì quyền của tài khoản mới là quyền khác. Nhịp hydrate `settings.infra` lúc mở app cũng đổi khoá này — nên `list` chỉ chạy lại khi **trước đó đã có số liệu**: chưa có gì để vô hiệu thì không gọi CLI (luật 1 của `useInfraExplorer.ts` vẫn nguyên).
- Một số hiệu ngữ cảnh (`ctxGen`) chặn ca "phản hồi của lệnh cũ về sau khi đã đổi tài khoản": lời gọi cất cánh ở ngữ cảnh cũ bị bỏ khi về tới nơi, thay vì đổ dòng của tài khoản cũ vào bảng vừa dọn.
- Mục cuối menu Profile là **"Quản lý profile…"** (`infra.bar.manage`) — một LỐI ĐI, không phải một giá trị: chọn nó thì KHÔNG đổi profile đang ghim, chỉ nhảy sang tab Tài khoản (nơi thêm/sửa/import profile), nên nhãn trên trigger vẫn là profile cũ. Nó có mặt kể cả khi `~/.aws` rỗng — đó chính là lúc cần nhất, và là đường duy nhất từ tab Dịch vụ sang chỗ thêm profile mà không phải đoán tab.
- **MỘT dropdown cho cả profile lẫn region** (2026-09-14: *"Region đi theo profile rồi mà cần gì phải chọn riêng?"* ⇒ *"ẩn đi"* ⇒ *"gộp cả 2 trong 1 dropdown đi"*). Hai ô `AppSelect` cạnh nhau, rồi bản "ẩn Region sau một nút", đều sai cùng một chỗ: profile và region là **hai nửa của một ngữ cảnh** — cùng đi vào một lệnh `aws`, cùng đổi khi chuyển tài khoản — nên tách chúng là bắt người đọc tự ghép thông tin ở hai nơi. Nay `InfraContextBar.vue` là một trigger hiện cả hai giá trị (`dev-sandbox · Theo profile`) và một menu hai mục: **Profile AWS** ở trên (danh sách profile + mục cuối "Quản lý profile…"), **Region** ở dưới, ngăn cách bằng một vạch. Trigger **neo phải** và menu cuộn được (danh sách region chuẩn hơn 30 mục). Chọn profile thì region đi theo — luật vẫn nằm nguyên ở `useInfraPage`.
- Menu dựng bằng `iwrap`/`ibackdrop`/`ipop` (khuôn có sẵn của ba chip hạ tầng) + `useEscToClose`; trạng thái mở/đóng **không** nhớ vào `localStorage` — nó là trạng thái của một lần nhìn, không phải một lựa chọn (khác bề rộng cột hay nhóm đã gập, là thứ chỉnh một lần rồi mong ở yên).
- **MỖI MỤC MỘT Ô TÌM, KHÔNG PHẢI MỘT Ô CHUNG** (2026-09-14: *"trong dropbox thì các mục phải để là SearchableCombobox chứ?"* ⇒ *"SearchableCombobox cho từng mục riêng biệt chứ sao lại 1 mục chung vậy?"*). Ô tìm chung lọc cả hai danh sách nghe thì gọn, nhưng nó trả lời sai câu người dùng đang hỏi: gõ một mã region thì mục Profile biến mất, và ngược lại — hai câu hỏi khác nhau ("tài khoản nào" và "ở đâu") bị một ô chữ trả lời chung. Nay mỗi khối `.ictx-sec` có ô tìm của riêng nó, đứng ngay trên danh sách nó lọc: gõ `stag` chỉ lọc Profile (Region còn nguyên), gõ `eu-c` chỉ lọc Region. Lọc literal substring trên nhãn (không regex, không fuzzy: gõ `ap-s` để tìm `ap-southeast-1` là ý định của người dùng, còn fuzzy trả về một danh sách không ai đoán được vì sao có những mục kia); bỏ khác biệt hoa/thường + chuẩn hoá NFC vì tên profile có thể mang dấu tiếng Việt ở dạng tổ hợp. Focus **ở lại trong ô tìm** (mọi phím bắt từ đó, nên không có chuyện bấm ↓ rồi "mất dấu"), ↑/↓ đi qua **danh sách phẳng** (profile rồi region), **Enter** chọn, **Esc** đóng; mỗi khối tự hiện `infra.bar.noMatch` khi không còn hàng nào khớp, còn lý do danh sách profile trống (đang đọc / đọc hỏng / `~/.aws` rỗng) vẫn là câu riêng. Trong repo **chưa có** component nào tên `SearchableCombobox`; primitive duy nhất là `AppSelect` (không có ô tìm), nên phần tìm nằm ngay trong menu này thay vì nâng `AppSelect` — component đó đang được dùng ở nhiều màn khác (chip phiên, tab Kubernetes, Settings).
- **Hover KHÔNG cuộn theo hàng — "nháy hover" 2026-09-14 là HAI bug chồng lên nhau.** (a) `setActive()` gọi từ `mouseenter` cũng gọi `scrollIntoView`, nên hàng mới trôi vào đúng dưới con trỏ, lại sinh một `mouseenter`, lại cuộn — một vòng lặp tự kích. Nay chỉ `move()` (↑/↓) mới cuộn: người gõ phím không có con trỏ nào để thấy hàng vừa đi qua, còn người dùng chuột thì không cần. (b) Hàng đang chọn mang class **`.cursor`** — trùng tên với `.cursor` **toàn cục** trong `assets/css/prototype.css` (con trỏ nhấp nháy của composer: `width: 7px; height: 15px; animation: bl 1s steps(2) infinite`), và class toàn cục thì vẫn áp lên phần tử của component scoped, nên hàng đang chọn bị ép thành ô 7×15px nhấp nháy `opacity` — đúng cái "lỗi hiển thị" người dùng thấy. Đổi tên thành `.ictx-cur`.
- **Mục đầu của Region là "Theo profile"** (`infra.region.follow`) — cùng nhãn với ô region của chip trong phiên, vì cùng một giá trị: `run.ts` chỉ chèn `--region` khi `ctx.region` có giá trị, nên để trống nghĩa là không truyền cờ và `aws` tự lấy region từ `~/.aws/config` của profile. Đường ghi đè vẫn phải giữ vì ba ca mà "theo profile" không trả lời được: (a) **profile không khai `region`** — `toProfile()` chỉ đọc khoá `region` khi nó có trong ini (`aws/profiles.ts`), và profile SSO rất hay thiếu, nên "region của profile" không tồn tại để theo; (b) **dịch vụ global** — IAM/Route53/CloudFront không thuộc region nào, còn chứng chỉ ACM dùng cho CloudFront **bắt buộc** ở `us-east-1`; (c) **đổi tạm để xem một region khác** mà không phải sửa `~/.aws/config` (AWOG không ghi file đó).
- Danh mục được đọc lại khi **region** đổi: deep link Console mang region trong URL, để nguyên thì mọi nút ↗ vẫn trỏ về region cũ.

*Chưa làm ở thanh này:* `cluster` (nằm ở tab Kubernetes, nơi đã có ô chọn dùng chung state — thêm ô thứ hai ở đây là bản sao), và nhãn "production" cho cả thanh (cần `accountKindOf()` của sidecar, hiện chỉ trả về theo từng lời gọi).

**3. Cột trái = cả danh mục, nhóm gập được.** Nhóm **Dịch vụ đã ghim** đứng đầu (giữ đúng thứ tự ghim, có biểu tượng ghim), rồi **11 nhóm việc của danh mục** với đúng thứ tự sidecar trả về. Mục của dịch vụ có màn riêng mượn **nhãn của view** ("EC2 — Instances" — đó là thứ người dùng đọc ở tiêu đề bảng khi mở nó); dịch vụ chỉ có Console hiện tên dịch vụ kèm dấu ↗. Nhãn dài được `text-overflow: ellipsis` thay vì nới cột. Trạng thái gập/mở nhớ trong `localStorage` (`awog-infra-side-groups`), **mặc định mở hết** — yêu cầu là "hiển thị full danh sách", nên gập là để người dùng tự dọn. Hàng tiêu đề đứng yên, chỉ phần danh mục cuộn.

Kiểm chứng (2026-09-14, `pnpm dev:ui` + Chromium headless qua Playwright, hồ sơ sạch nên đã bật lại cờ onboarding):

| Đo | Kết quả |
|---|---|
| Cột trái khi mở (đo lại 2026-09-14 bằng engine giả, sau khi mở rộng danh mục) | **12 nhóm** (ghim + 11 nhóm danh mục), **109 mục** (6 ghim + 103 dịch vụ); gập nhóm "Dữ liệu & AI" ⇒ **0 mục** trong nhóm, `aria-expanded=false`, mở lại ⇒ **12 mục** |
| Bấm tiêu đề một nhóm | `aria-expanded=false`, mục trong nhóm biến mất khỏi DOM; mở lại trang vẫn giữ trạng thái đã gập |
| Thu gọn cột | `.ixe-side` **không còn trong DOM**, `boundingBox` của `.ixe-main` bắt đầu ngay đệm pane (**x=234**, trước đó là sau dải rỗng) |
| Nút mở lại | `.ixe-expand` 83×30 ở đầu cột phải; hàng tiêu đề view nằm dưới nó |
| Hàng tab ở 760px | thanh ngữ cảnh **xuống dòng riêng**, nhãn "Profile AWS"/"Region" vẫn hiện (bỏ nhãn thì hai ô chọn trông giống nhau) |

Phần "dịch vụ đọc theo tài khoản" được đo bằng **engine giả** (chặn `window.awog` trong trình duyệt, trả catalog + `resource-list` tự bịa theo `context`): chọn `prod-admin` (region `ap-northeast-1`) ⇒ `settings.set` ghi `infra.profile/region/accountId` (giữ nguyên `cluster`/`namespace` đang ghim) và có **đúng một** `infra.resource-list` với `context {profile: 'prod-admin', region: 'ap-northeast-1', accountId: '111122223333'}`; đổi sang `dev-sandbox` ⇒ `context {profile: 'dev-sandbox', region: 'us-west-2'}` (**region đi theo profile**, `accountId` rơi về trống vì profile đó không khai), bảng chỉ còn dòng của tài khoản mới và `infra.explorer-catalog` được đọc lại với `region: 'us-west-2'`; đổi region trực tiếp ⇒ đọc lại với region mới, giữ nguyên profile. **Chưa** đo bằng tài khoản AWS thật (không có credential trong phiên này).
Đo lại phần tìm kiếm cũng bằng engine giả (3 profile: `prod-admin`/`ap-northeast-1`, `dev-sandbox`/`us-west-2`, `staging-eu`/`eu-central-1`): gõ `stag` ⇒ Profile còn **1 hàng** và Region **không đổi**; gõ `eu-c` ⇒ Region còn **2 hàng** và Profile **không đổi**; xoá ô này không làm ô kia nhúc nhích; ↑/↓ đổi `aria-activedescendant` đúng hàng và cuộn theo, còn `mouseenter` **không** đổi `scrollTop` (0 trước và sau); **Enter** chọn đúng ngữ cảnh rồi đóng. Sau khi đổi `.cursor` ⇒ `.ictx-cur`: hàng cao **30px**, `opacity: 1`, `animation: none`.

| # | Việc | Trạng thái |
|---|---|---|
| 3.1 | Registry `ResourceView` + khung bảng dùng chung (tìm · "nạp lúc HH:MM" · virtual scroll >200 · empty/error) | xong |
| 3.2 | Hai bộ cột `columns.simple`/`columns.full` + công tắc Đơn giản/Chuyên sâu nhớ theo người dùng | xong |
| 3.3 | Dò quyền lúc mở màn ⇒ **ẩn** nút ghi (không disable) | xong |
| 3.4 | Nút Console ↗ (deep link, **bọc SSO start-url**) · dòng lý thuyết dịch vụ · nút Hỏi agent | xong |
| 3.5 | Dock phiên thu nhỏ (`useMinimizeDock`) mang chip ngữ cảnh | xong |
| 3.6 | View S3: duyệt cây · xem qua `usePreview()` · upload/tải/xoá · presign ≤15 phút | xong |
| 3.7 | View EC2: start/stop/reboot/terminate (gõ-tên) | xong — **Kết nối SSM mở terminal: chưa làm** |
| 3.8 | Danh mục Dịch vụ: ba mức hỗ trợ · ghim đổi sidebar · tìm kiếm ⌘K | xong — là **mặt danh mục của tab Dịch vụ** (gộp 2026-09-14, xem đầu mục); hàng "đang dùng" chưa nối Cost Explorer |
| 3.9 | Màn Nhật ký: bảng · lọc · chi tiết · ↗ về phiên · dọn có xác nhận · dòng ghi việc dọn · xuất CSV/JSONL | xong |
| 3.10 | Tool `infra_view` / `infra_action` | xong |

### Điểm lệch có chủ đích (Mốc 3)

| Điểm | Spec | Đã code | Vì sao |
|---|---|---|---|
| **Tìm kiếm ở client** | đẩy filter xuống CLI khi service hỗ trợ | lọc tại client trên số dòng ĐÃ NẠP, và **nói thẳng điều đó trên UI** | Cờ `--filters` khác nhau theo từng service; một ô tìm kiếm giả vờ đẩy xuống CLI là hứa điều khung bảng không giữ được. Nhãn "chỉ lọc những dòng đã nạp" để không ai tưởng đã quét cả account |
| **Lý thuyết dịch vụ** | nút ⓘ | hiện thành **dòng mô tả luôn thấy** ở đầu bảng | Một dòng chữ không cần thêm một cú bấm; `about` vẫn là dữ liệu của mô tả view |
| **Hàng "đang dùng"** | Cost Explorer + tagging API | hiện "đang dùng" = service của view **đang có dòng** | `ce get-cost-and-usage` **tính tiền mỗi request**; dữ liệu chi phí thuộc việc 7.1 của mốc 7. Không bịa số |
| **Presign** | "không vào nhật ký" | xếp lớp `read` và không ghi dòng nhật ký | URL ký sẵn **là** credential; ghi nó vào nhật ký là nhân bản một bí mật vào file thứ hai |
| **Kết nối SSM** | mở terminal trong app | chưa làm, còn nút Console ↗ | `session start-session` cần đường PTY + đích terminal trong tab; đó là việc của khung PTY (E7/E8), không nên nhét vào bảng EC2 |

### Dùng chung với các màn khác

- **Hỏi agent** ở cả 5 màn (Tổng quan · Logs · Explorer · Nhật ký · Kubernetes) đều mở **hộp chọn đích**: phiên hiện tại (nối thêm vào draft) hay **phiên mới** trong project `awog-infra` — xem [infra-bubble-session.md](infra-bubble-session.md).
- **Presign · xuất file · tải S3** là ba đường ghi/đọc file duy nhất của Explorer, và cả ba đều đi qua `assertInsideWorkspace` hoặc `saveFilePath()`.

## Bảo mật

Thừa kế toàn bộ ADR 0088 (CLI shell-out, arg array không shell, ngữ cảnh ghim sidecar, chặn `--endpoint-url`/`--kubeconfig`, binary allowlist + verify realpath). Thêm bốn điều riêng của Explorer:

| Rủi ro                                                                          | Xử lý                                                                                                                                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Secret hiện trên màn** (k8s Secret, SSM SecureString, biến môi trường Lambda) | Mặc định **chỉ hiện tên/key**. Xem giá trị là một hành động riêng có duyệt, giá trị **không** vào cache, **không** vào ring buffer, **không** tự động vào chat |
| **Tải S3 object về máy**                                                        | Đích tải phải `assertInsideWorkspace` (invariant 2); tên file sanitize; không ghi đè im lặng                                                                   |
| **URL ký sẵn (presign)**                                                        | Hạn ngắn (≤15 phút), hiện rõ hạn, không log URL vào ring buffer (nó _là_ credential)                                                                           |
| **Log/JSON đổ vào chat**                                                        | Đi qua [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) trước khi vào transcript — log ứng dụng rất hay chứa token                               |

**infosec audit bắt buộc** trước E2 (lần đầu app tự gọi API cloud ngoài phiên chat) và trước bất kỳ nút ghi nào lên production.

## Câu hỏi mở

1. **Nhiều account cùng lúc?** Thiết kế hiện tại là _một ngữ cảnh tại một thời điểm_ (đổi bằng dropdown ở đầu trang). Xem song song hai account (dev vs prod) là mô hình khác — đề xuất hoãn, mở lại nếu thực tế cần.
2. **Cost Explorer** có làm không? Hữu ích nhưng `ce get-cost-and-usage` **tính tiền mỗi request** — nếu làm thì phải là view nạp-khi-bấm, có cảnh báo, không bao giờ auto.
3. **E4 (màn k8s) có nên đi trước E3 không?** Nếu công việc hằng ngày của bạn nằm ở Kubernetes nhiều hơn ECS/Amplify thì đảo — cái nào mở nhiều hơn thì làm trước.
