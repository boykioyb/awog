# Feature — CloudWatch Logs: đọc, lọc nâng cao, truy vết một request

- **Trạng thái:** Planned — **ưu tiên số 1** trong họ Infra
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
| **L5** | **Lần theo request**: timeline xuyên group + nhánh X-Ray khi có | L |
| **L6** | Tool cho agent (`logs_query`, `logs_tail_window`) + agent soạn query đẩy vào editor | M |

Phụ thuộc: P0 của [session-infra-context.md](session-infra-context.md) (`infra.run` + gate + ngữ cảnh ghim).

## Câu hỏi mở

1. **Query đã lưu để ở đâu** — `~/.awog/cloudwatch-queries/` (khuôn snippet) hay một space trong Wiki (để agent đọc được và giải thích)? Đề xuất: `.awog` cho dữ liệu, và cho agent truy cập qua tool, không nhét vào Wiki.
2. **`start-live-tail` (API mới, WebSocket) hay `logs tail --follow` (CLI)?** Đề xuất CLI — không thêm dependency, và CLI đã bọc sẵn phần khó.
3. **Có cần tạo metric filter / alarm từ một query không?** (biến "query tìm lỗi" thành cảnh báo). Hữu ích nhưng là lệnh **ghi** — để sau L5, và luôn qua hộp xác nhận.
