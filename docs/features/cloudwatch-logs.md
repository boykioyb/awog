# Feature — CloudWatch Logs: đọc, lọc nâng cao, truy vết một request

- **Trạng thái:** L1–L3 + L6 ship 2026-09-13; **L5 lần theo request ship 2026-09-16** (cùng G4 của [infra-topology-graph.md](infra-topology-graph.md)) — **L4 live tail vẫn còn nợ**; xem "Trạng thái triển khai" ở cuối
- **ADR:** [0088 — ngữ cảnh hạ tầng ghim theo phiên](../decisions/0088-session-infra-context.md)
- **Route:** `/infra` → **Logs**; và tab **Logs** trong Session Workspace Panel
- **Anh em:** [infra-explorer.md](infra-explorer.md) (khung màn hình), [infra-topology-graph.md](infra-topology-graph.md) (bấm một hop trên graph → mở đúng query ở đây)

## Vì sao đây là màn quan trọng nhất

Vòng lặp thật khi có sự cố là: *thấy lỗi → lọc log → khoanh thời gian → tìm request cụ thể → lần theo nó qua các service*. AWS Console làm được nhưng chậm và rời rạc (mỗi log group một tab, mất query khi reload, không mang được sang chỗ khác). AWOG có lợi thế riêng: **kết quả log nằm cạnh agent** — lọc ra 40 dòng rồi hỏi thẳng *"vì sao cái này 500"* mà không copy-paste.

## Ba chế độ đọc, dùng ba API khác nhau

| Chế độ | Khi nào | Lệnh nền |
|---|---|---|
| **Insights** (chính) | Phân tích, thống kê, lọc nâng cao, nhiều log group | `logs start-query` → poll `logs get-query-results` |
| **Live tail** | Đang deploy / đang tái hiện lỗi, muốn thấy chảy realtime | `logs tail <group> --follow [--filter-pattern]` |
| **Duyệt thô** | Một stream cụ thể, cuộn tới lui theo trang | `logs filter-log-events` (có `nextToken`) |

Người dùng không phải chọn API — UI chọn hộ: gõ query vào editor = Insights; bật công tắc **Live** = tail; mở một stream từ cây = duyệt thô.

## Màn hình

```
┌ Logs ─────────────────────────────────────────────────────────────────┐
│ Log group: [/aws/lambda/api-prod ×] [/aws/apigw/prod ×] [+ thêm]       │
│ Thời gian: [15m][1h][3h][12h][1d][tuỳ chọn]      ● Live    [▶ Chạy]   │
├───────────────────────────────────────────────────────────────────────┤
│ ▏▎▁▁▃█▅▂▁▁▂▇█▃▁  ← histogram theo bin, kéo chuột để zoom khoảng      │
├───────────────────────────────────────────────────────────────────────┤
│ 1 │ fields @timestamp, @message, @requestId                          │
│ 2 │ | filter @message like /ERROR|Exception/                          │
│ 3 │ | stats count(*) by bin(5m)                    ← Monaco + gợi ý   │
├───────────────────────────────────────────────────────────────────────┤
│ Đã quét 1.2 GB · 3.4s · 214 dòng        [ERROR 180][WARN 34]  [⇪ chat]│
│ 10:32:14  api-prod  ERROR  Timeout calling payments  req=8f3a…        │
│ 10:32:14  apigw     500    POST /v1/orders          req=8f3a…  ▸      │
└───────────────────────────────────────────────────────────────────────┘
```

### 1. Chọn log group

Nhiều group cùng lúc (Insights cho tới 50). Picker có tìm kiếm, nhóm theo tiền tố (`/aws/lambda/…`, `/aws/apigw/…`, `/ecs/…`), ghim group hay dùng, và **chọn theo pattern** (`/aws/lambda/*-prod`). Nhớ theo `(profile, region)`.

### 2. Khoảng thời gian + histogram

Quick pick (5m/15m/1h/3h/12h/1d/7d) và tuyệt đối. **Histogram** là một `stats count(*) by bin(auto)` chạy kèm, vẽ bằng SVG tay (repo không có chart lib, mà đây chỉ là cột) — **kéo chuột trên histogram để zoom vào đúng khoảng**, đó là thao tác hay dùng nhất khi khoanh sự cố. Bin tự chọn theo độ dài khoảng (1m/5m/1h).

### 3. Editor query (Monaco)

Monaco đã có trong repo; thêm một **Monarch tokenizer** cho cú pháp Insights (không thêm dependency):

- Tô màu lệnh `fields · filter · stats · sort · limit · parse · display · dedup`, hàm (`count`, `sum`, `avg`, `pct`, `bin`, `earliest`), toán tử, regex, chuỗi.
- **Gợi ý trường**: `@timestamp @message @logStream @requestId @duration @billedDuration` + **trường phát hiện được** từ kết quả lần chạy trước (JSON log thì mỗi khoá là một trường).
- `⌘Enter` chạy, `⌘.` huỷ (`logs stop-query`).
- **Thư viện query** bên cạnh: mẫu sẵn (*lỗi 5xx theo endpoint*, *p95 latency*, *top exception*, *cold start Lambda*, *request chậm nhất*), **query đã lưu** và **lịch sử** — lưu ở `~/.awog/cloudwatch-queries/` (global) + `{project}/.awog/cloudwatch-queries/` (per-project), khuôn 2-tier như snippet terminal.

### 4. Lọc nâng cao — ba tầng, dùng đúng chỗ

| Tầng | Cú pháp | Chạy ở đâu | Dùng khi |
|---|---|---|---|
| **Insights** | `filter status >= 500 and duration > 1000` | AWS | Lọc thật, trên toàn khoảng thời gian |
| **Filter pattern** | `{ $.level = "ERROR" && $.userId = "u_9" }` | AWS | Live tail (Insights không tail được) |
| **Lọc nhanh tại chỗ** | chuỗi / regex / chip mức độ | Trong bảng đã tải | Thu hẹp cái đang nhìn, không tốn thêm tiền |

Chip mức độ (`ERROR` `WARN` `INFO`) và **facet theo trường**: sau khi có kết quả, panel phải liệt kê trường phát hiện được kèm top giá trị — bấm một giá trị là **chèn `filter` tương ứng vào query**, không phải tự gõ.

### 5. Bảng kết quả

Cột theo `fields` của query (mặc định thời gian · group · mức · message · requestId). Bấm dòng → mở JSON đầy đủ (Monaco read-only, fold được). Mỗi dòng có: copy · **"gửi 50 dòng quanh đây vào chat"** · *"lần theo request này"*.

### 6. Lần theo một request (điểm khác biệt lớn nhất)

Có `requestId` / `X-Amzn-Trace-Id` / correlation id tự đặt → một cú bấm chạy query **xuyên nhiều log group** rồi dựng **timeline dọc**: mỗi hop là một dòng (service · thời điểm · độ trễ tới hop sau · trạng thái), lỗi tô đỏ, bấm hop nào mở nguyên bản log của hop đó.

Hai nguồn, dùng cái nào có:

- **X-Ray** (nếu app bật): `xray batch-get-traces` cho segment + timing thật ⇒ timeline chính xác, kèm downstream (DynamoDB/RDS/HTTP).
- **Chỉ log**: tương quan theo id trong cùng khoảng thời gian ⇒ thứ tự đúng, độ trễ là ước lượng. **Nói rõ trên UI là ước lượng**, không giả vờ là trace thật.

Timeline này chính là chỗ nối sang [infra-topology-graph.md](infra-topology-graph.md): bấm một hop → highlight đúng node trên graph, và ngược lại.

### 7. Live tail

Công tắc **Live** chuyển sang `logs tail --follow` (có `--filter-pattern`): dòng mới chảy xuống, tự cuộn (tắt được), tô màu theo mức, giữ cửa sổ N dòng gần nhất rồi cắt. Đây là tiến trình sống — đếm và tắt khi rời tab, như PTY/port-forward đang làm.

## Tiền — nói thẳng trên UI

Insights **tính tiền theo GB quét**, không theo số dòng trả về. Nên:

1. Trước khi chạy: hiện **ước lượng quét** (khoảng thời gian × cỡ group ước tính) và cảnh báo khi > 24h hoặc > 10 group.
2. Sau khi chạy: hiện **`bytesScanned` thật** + thời gian + số bản ghi khớp (`statistics` trong `get-query-results`).
3. **Không bao giờ tự chạy** — kể cả khi đổi khoảng thời gian. Đổi tham số chỉ làm nút `▶ Chạy` sáng lên.
4. Query nặng lặp lại nhiều lần ⇒ gợi ý thu hẹp group hoặc dùng `filter` sớm hơn trong pipeline.

## Agent dùng được gì

Tool `logs_query({ groups, query, startTime, endTime })` và `logs_tail_window({ group, minutes, pattern })` — phân loại **read** theo ADR 0088, nên mức duyệt `auto` nới được; nhưng vì tốn tiền, prompt duyệt hiện **ước lượng quét** chứ không chỉ câu lệnh.

Kết quả trả cho model đi qua `clampForLlm` **và** [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) — log ứng dụng rất hay chứa token, và nó sắp vào transcript.

Chiều ngược lại cũng có: agent **soạn query** cho người dùng (*"viết query tìm request chậm hơn 3s"*) rồi đẩy vào editor để người bấm chạy — đúng mô hình "agent đề xuất, người duyệt".

## Lộ trình

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **L1** | Chọn group (nhiều, có pattern) · khoảng thời gian · chạy Insights · bảng kết quả · JSON chi tiết · copy/gửi vào chat | L |
| **L2** | Editor Monaco + Monarch + gợi ý trường · thư viện query (mẫu/đã lưu/lịch sử) · histogram kéo-zoom | L |
| **L3** | Lọc nhanh tại chỗ · chip mức độ · facet theo trường · hiển thị bytesScanned + ước lượng trước khi chạy | M |
| **L4** | Live tail (`logs tail --follow`) + duyệt thô một stream | M |
| **L5** | **Lần theo request**: timeline xuyên group + nhánh X-Ray khi có | L — **xong 2026-09-16** |
| **L6** | Tool cho agent (`logs_query`, `logs_tail_window`) + agent soạn query đẩy vào editor | M |

Phụ thuộc: P0 của [session-infra-context.md](session-infra-context.md) (`infra.run` + gate + ngữ cảnh ghim).

## Câu hỏi mở

1. **Query đã lưu để ở đâu** — `~/.awog/cloudwatch-queries/` (khuôn snippet) hay một space trong Wiki (để agent đọc được và giải thích)? Đề xuất: `.awog` cho dữ liệu, và cho agent truy cập qua tool, không nhét vào Wiki.
2. **`start-live-tail` (API mới, WebSocket) hay `logs tail --follow` (CLI)?** Đề xuất CLI — không thêm dependency, và CLI đã bọc sẵn phần khó.
3. **Có cần tạo metric filter / alarm từ một query không?** (biến "query tìm lỗi" thành cảnh báo). Hữu ích nhưng là lệnh **ghi** — để sau L5, và luôn qua hộp xác nhận.

## Trạng thái triển khai (2026-09-13) — Mốc 2

Cây làm việc nhánh `feature/aws-infra`, **chưa commit**. Đây là bản mô tả những gì
thực sự có trong code, không phải kế hoạch.

### Đã có

| Việc (`infra.tasks.md`) | Ở đâu |
|---|---|
| **2.1** chọn nhiều log group (có pattern) · khoảng thời gian · chạy Insights → poll → huỷ | `sidecar/src/infra/aws/logs.ts`; 5 method `infra.logs-groups/estimate/query-start/query-status/query-cancel`; UI `composables/useInfraLogs.ts` + `components/infra/logs/InfraLogsGroupPicker.vue` (trần 25 group, hai bên cùng chặn). **Nút Huỷ từng làm màn kẹt — sửa 2026-09-14, xem §"Sửa 2026-09-14"** |
| **2.2** bảng kết quả · JSON chi tiết · copy · gửi vào chat | `components/infra/logs/InfraLogsResults.vue`; gửi chat đi qua `composables/useInfraAskAgent.ts` |
| **2.3** Monaco + Monarch tokenizer + gợi ý trường + **phím tắt `⌘Enter`/`⌘.`** | `utils/monaco-insights.ts` (`awog-insights`), `components/infra/logs/InfraLogsQueryEditor.vue` (bắt phím ở pha capture trên wrapper — không đụng `MonacoEditor` dùng chung); gợi ý trường lấy từ kết quả lần chạy trước |
| **2.4** thư viện: mẫu sẵn · đã lưu · lịch sử (2 tier `.awog`) | `sidecar/src/infra/logs/library.ts` (`~/.awog/infra/logs/queries.json`, 0700/0600, ghi nguyên tử), method `infra.logs-library`, UI `InfraLogsLibrary.vue` |
| **2.5** histogram SVG kéo-zoom | `components/infra/logs/InfraLogsHistogram.vue`; câu chạy kèm do `buildHistogramQuery()` dựng |
| **2.6** ước lượng GB trước · `bytesScanned` thật sau · **không bao giờ auto-run** | `infra.logs-estimate` (lịch sử → số đo, còn lại → tổng `storedBytes` = trần trên), `runInfra({ cost })` ghi số ước lượng vào nhật ký, `bytesScanned` hiện trên thanh trạng thái |
| **2.7** lọc nhanh · chip mức độ · facet (bấm giá trị ⇒ chèn `filter`) | `components/infra/logs/InfraLogsFilters.vue` + `useInfraLogs.ts` (lọc tại chỗ, không tốn thêm lượt quét) |
| **2.8** màn Tổng quan: 6 thẻ đèn + câu giải thích + chip câu hỏi | `components/infra/InfraOverview.vue` + `composables/useInfraOverview.ts`. **2/6 thẻ có nguồn sống**: *Lỗi 1 giờ qua* (Insights) và *Máy chủ* (`ec2.instances`, nút Đọc máy chủ EC2). **Đổi profile/region giữa chừng thì query đang chạy bị huỷ** (sửa 2026-09-14 — [infra.tasks.md](infra.tasks.md) §"Thẻ Lỗi 1 giờ qua") |
| **2.9** tool `logs_query` / `logs_tail_window` | `sidecar/src/runtime/tools/infra-tools.ts` và `runtime/claude-sdk/infra-sdk-server.ts` (chỉ xuất hiện khi đã ghim profile), popup duyệt kèm ước lượng GB |

### Quyết định đã chốt — thay cho "Quyết định còn treo"

Đề bài để mở hai lựa chọn (bỏ nhóm `logs` khỏi `read = auto`, hoặc `read/production =
ask`). Đã chọn **cách thứ ba, hẹp hơn cả hai**: chỉ bốn operation `read` mà kết quả
**là nội dung log** (`start-query`, `get-query-results`, `get-log-events`,
`filter-log-events`) bị siết lên `ask` **trên tài khoản production**.

- `AWS_SENSITIVE_READ_OPS` + `sensitiveReadOf()` — `sidecar/src/infra/classify.ts`
- `InfraDecisionInput.sensitiveRead` + lý do `'sensitive-read'` — `sidecar/src/infra/policy.ts`
- Nối vào cổng quyền cho **cả hai** đường (tool của agent và `Bash`) —
  `sidecar/src/runtime/permission.ts`

Vì sao không chọn hai cách kia: bỏ cả nhóm `logs` khỏi `read` chặn nhầm
`describe-log-groups` (thuần metadata, dùng để vẽ danh sách chọn) và biến màn Logs
thành chuỗi hộp duyệt; hạ cả cột `read/production` xuống `ask` sẽ bắt mọi `describe-*`
của Explorer hỏi người dùng ở Mốc 3 trong khi thứ nguy hiểm chỉ là bốn op. Luật chỉ
**siết được**, đứng sau bypass và trước `sessionFloor`, nên không mở thêm đường nào.

### Điểm lệch có chủ đích

| Điểm | Spec | Thực tế | Vì sao |
|---|---|---|---|
| **`bin(auto)`** | histogram chạy `stats count(*) by bin(auto)` | `bin(1m/5m/1h/1d)` chọn theo độ dài cửa sổ (`histogramBucket()`) | CloudWatch **không có** đơn vị `auto`. Chọn sai bước chỉ làm biểu đồ thô/mịn hơn — không đổi dữ liệu, không đổi hoá đơn, nên không đáng thêm một lượt gọi `describe-log-groups` để đo |
| **Histogram là truy vấn thứ hai** | "chạy kèm" | Chỉ tốn thêm khi câu gốc **chưa có** `stats`; `plannedQueries`/`plannedUsd` hiện con số thật của lần bấm kế tiếp và công tắc tắt được | Giấu một lượt quét thứ hai sau chữ "kèm" là cách trung thực nhất để người dùng mất tiền mà không biết |
| **`⌘Enter` / `⌘.`** | chạy / huỷ bằng phím tắt trong Monaco | **Đã nối 2026-09-14**, nhưng KHÔNG qua `MonacoEditorHandle`: `InfraLogsQueryEditor.vue` gắn `@keydown.capture` trên wrapper của chính nó (Monaco gắn handler ở node con, nên capture của wrapper chạy trước), rồi `preventDefault()` + `stopPropagation()` và phát `run`/`cancel`; guard nằm nguyên ở `InfraLogs.onRun`/`onCancel` | Không mở rộng handle dùng chung thì không phải đụng vào `MonacoEditor.vue` — component mà editor code của cả app sống nhờ. Phím tắt chỉ làm đúng việc cú bấm vẫn làm, nên luật "không tự chạy" không bị nới |
| **Màn Tổng quan** | 6 thẻ đèn cho 6 nguồn dữ liệu | Hai nguồn đã nối: thẻ "Lỗi 1 giờ qua" (hai bước Ước lượng → Chạy) và thẻ "Máy chủ" (`ec2 describe-instances`, nút Đọc máy chủ EC2); 4 thẻ còn lại hiện **đèn xám** + đường hỏi agent | Nguồn của từng thẻ nằm ở mốc sau: EC2 **đã có** (view `ec2.instances` của mốc 3) nên nối được ngay; CloudFront/Route53 và ACM ở việc **4.1**; Amplify/CI-CD ở việc **4.2–4.6**; chi phí (Cost Explorer) ở việc **7.1** — chưa có nguồn nào trong số đó. Hiện đèn xanh cho thứ chưa kiểm tra là nói dối người dùng |

### Sửa 2026-09-14 — nút Huỷ làm màn kẹt

`poll()` (và vòng poll của thẻ Lỗi) chờ nhịp bằng `await new Promise(r => { timer = setTimeout(r, POLL_MS) })`, còn hàm huỷ thì `clearTimeout(timer)`. `clearTimeout` **không** đánh thức một Promise đang chờ — nó bỏ mặc Promise đó treo vĩnh viễn, nên `poll()` không bao giờ trả về, `run()` không bao giờ tới `finally`, `running` kẹt `true`, và người dùng bấm Huỷ xong vẫn thấy *Đang chạy…* cùng nút Chạy bị vô hiệu **cho tới khi rời tab**.

Sửa: giữ `resolve` của nhịp đang treo (`pollWake` ở `useInfraLogs.ts`, `timerWake` ở `useInfraOverview.ts`) và gọi nó trong hàm huỷ; thêm nhịp kiểm tra `cancelled` sau `await` để vòng lặp thoát ngay, không hỏi thêm một lượt `get-query-results` sau khi đã bảo dừng.

Đo trên trình duyệt (engine giả): `⌘Enter` → `estimate` + 2 × `query-start` (biểu đồ mật độ bật) → `⌘.` → `logs-query-cancel` → runbar về **Chạy**, nút bật lại, chạy lại được lần hai. Thẻ Lỗi: **Huỷ** → **Chạy (~0.0050 USD)**. Lỗi này chỉ lộ khi cú huỷ rơi đúng lúc vòng lặp đang đợi nhịp — trạng thái chiếm phần lớn thời gian — nên test mock không bắt được.

### Sửa 2026-09-14 — danh sách log group trắng vì `--limit` > 50

Mở màn Logs là ô **Nhóm log** hiện nguyên văn câu của AWS, không có group nào:

> An error occurred (InvalidParameterException) when calling the DescribeLogGroups operation: 1 validation error detected: Value at 'limit' failed to satisfy constraint: Member must have value less than or equal to 50

`describe-log-groups` chỉ nhận **50 group mỗi lượt gọi** (`limit` của API có trần 50),
nhưng `listLogGroups` truyền thẳng `--limit` của người gọi vào MỘT lượt: màn Logs xin
`limit: 100` (`useInfraLogs.loadGroups`), còn trần phía sidecar là 500
(`MAX_GROUP_LIMIT`) — cả hai đều vượt 50, nên AWS từ chối và danh sách chọn group
không bao giờ vẽ được.

Sửa: 50 trở thành trần **từng trang** (`GROUP_PAGE_LIMIT`), và `listLogGroups` nối
trang bằng `nextToken` cho tới khi đủ `limit` (tối đa `MAX_GROUP_PAGES` = 10 lượt
gọi ⇒ trần tổng 500 group vẫn giữ nguyên). Kèm theo: khử trùng theo tên trước khi
trả (tên là `:key` của danh sách chọn), và **một trang lỗi giữa chừng làm hỏng cả
lời gọi** thay vì trả về một danh sách cụt — trả cụt mà không nói gì sẽ khiến người
dùng tưởng tài khoản chỉ có chừng ấy log group.

Kiểm bằng 4 ca mới trong `apps/desktop/sidecar/src/infra/aws/__tests__/logs.test.ts`:
không lượt gọi nào được gửi `--limit` > 50, trang nối đúng bằng `nextToken`, trang
cụt thì dừng ngay, và lỗi ở trang hai thì cả lời gọi trả lỗi.

### Chưa đo trên dữ liệu thật

Máy này **không có phiên SSO sống**, nên toàn bộ đường log (`listLogGroups`,
`startInsightsQuery`, `getInsightsResults`, `tailWindow`) chưa từng chạy trên
CloudWatch thật: mọi test đều mock `runInfra`. Cần một lượt đo thật trước khi coi L1–L3
là "đã nghiệm thu".


## L5 — trạng thái thực tế (2026-09-16)

Cửa vào: chế độ thứ ba của màn Logs (**Dòng mới nhất · Truy vấn nâng cao · Lần theo
request**), cộng nút *"Lần theo request này"* trên khung JSON của một dòng log.

| Việc | Ở đâu |
|---|---|
| Nhận diện id · dựng câu · gộp chặng · đọc segment X-Ray | `sidecar/src/infra/logs/trace.ts` (50 test bảng) |
| Hai RPC `infra.trace-start` / `infra.trace-status` | `sidecar/src/methods/infra.trace-*.ts`; huỷ dùng lại `infra.logs-query-cancel` |
| Vòng đời một lượt lần theo (chạy · poll · huỷ · mở chặng) | `ui-next/composables/useInfraTrace.ts` |
| Dòng thời gian dọc | `ui-next/components/infra/logs/InfraLogsTrace.vue` |
| Rút id từ một dòng log | `ui-next/utils/infra-trace-id.ts` |
| `xray batch-get-traces` + `get-service-graph` vào allowlist `read` | `sidecar/src/infra/classify.ts` |

### Bốn điểm lệch có chủ đích

| Điểm | Spec | Thực tế | Vì sao |
|---|---|---|---|
| **Nhánh X-Ray chỉ nhận TRACE ID** | "`requestId` / `X-Amzn-Trace-Id` / correlation id → một cú bấm" | X-Ray chỉ chạy khi id đúng dạng `1-<8 hex>-<24 hex>`; `requestId` và id tự đặt đi nhánh log | đi từ `requestId` sang trace id đòi `get-trace-summaries --filter-expression`, tức **quét cả cửa sổ thời gian và trả tiền** cho một phép tìm có thể không ra gì. Thà nói thẳng "id này không có timing từng chặng" |
| **Gộp theo LOG GROUP, không theo lần ghé** | "mỗi hop là một dòng" | một request quay lại cùng một hàm hai lần ⇒ MỘT chặng, `count: 2` | tách theo lần ghé biến một vòng retry 30 lần thành 30 hàng không đọc nổi, đúng lúc người ta đang chữa cháy |
| **Hai con số, hai nhãn** | "độ trễ tới hop sau" | X-Ray ⇒ *"chạy 250 ms"* (thời gian xử lý thật); nhánh log ⇒ *"cách chặng sau 400 ms"* | nhánh log **không biết** chặng chạy bao lâu — nó chỉ thấy dòng log. Dùng chung một nhãn là mời người đọc kết luận sai chỗ hệ thống chậm |
| **`filter @message like "<chuỗi>"`, không phải regex** | — | dạng chuỗi con trong nháy kép | id là dữ liệu L1; một dấu `.` trong đó mà rơi vào ngữ cảnh regex sẽ khớp RỘNG hơn người dùng tưởng mà **không báo lỗi**. Bộ ký tự hợp lệ của id cũng cấm `/` nên `file://` không bao giờ thành argv |

### Còn nợ của L5

- **QA trong Electron thật** — cổng đã xanh là `vitest` (1109 test của `src/infra`) · `pnpm typecheck` cả hai package · `pnpm lint` + guard design-token. Chưa màn nào được bấm trong app đóng gói.
- **Chưa chạy bằng credential AWS thật** — cả hai nhánh mới kiểm bằng JSON mẫu. Câu hỏi Q4 của [infra.tasks.md](infra.tasks.md) (*"hệ thống đã bật X-Ray chưa?"*) vẫn chưa ai trả lời, nên nhánh X-Ray chưa lần nào chạm dữ liệu sống.
- **Agent chưa chạm L5** — `runtime/tools/infra-tools.ts` không có tool lần theo request; agent chỉ tới được qua `logs_query`.
- **`infosec` cho bề mặt mới** — allowlist `read` vừa nhận thêm hai op `xray`. `batch-get-traces` đã vào `AWS_SENSITIVE_READ_OPS` (segment document mang URL + annotation của ứng dụng ⇒ cùng hạng nội dung với dòng log, production phải hỏi), nhưng chính quyết định đó là thứ cần người thứ hai soi.
- **L4 live tail vẫn chưa làm.** `infra.logs-tail` là cửa sổ `filter-log-events`, KHÔNG phải `--follow`.
