# Feature — Nhật ký hoạt động hạ tầng (audit)

- **Trạng thái:** **N1–N3 đã code** (2026-09-14) — ghi JSONL tại `infra.run` · màn Nhật ký · dọn/xuất. N4/N5 còn nợ (xem [§Trạng thái thực tế](#trạng-thái-thực-tế--cập-nhật-2026-09-14)). **Chưa QA trong Electron thật**
- **ADR:** [0088 §5](../decisions/0088-session-infra-context.md) (ba tính chất của bypass: nhìn thấy · **ghi lại** · hết hạn)
- **Route:** `/infra` → **Nhật ký**; và tab trong Session Workspace Panel
- **Anh em:** [git-command-log.md](git-command-log.md) (người anh trong bộ nhớ — cái này là bản **bền vững, truy vấn được**)

## Vì sao phải có, và vì sao ring buffer không đủ

Ma trận quyền cho agent chạy thẳng một số lớp lệnh. Điều đó chỉ chấp nhận được nếu trả lời được, bất cứ lúc nào: **"app đã làm gì trên tài khoản của tôi, lúc nào, do ai bảo?"**

[Nhật ký lệnh git](git-command-log.md) đã chứng minh giá trị của việc phơi lệnh ra — nhưng nó là ring buffer 400 entry **cấp tiến trình**: reload là mất, restart là mất, không lọc được, không hỏi lại được sau một tuần. Với hạ tầng thì đó là thiếu sót nghiêm trọng: lệnh chạy trên tài khoản thật, tốn tiền thật, và câu hỏi "tuần trước ai scale service này" là câu hỏi bình thường.

Nên nhật ký hạ tầng là **JSONL bền vững trên đĩa**, truy vấn được, dọn được, và **agent đọc được**.

## Ghi cái gì

Một hành động = một dòng JSONL ở `~/.awog/infra-audit/YYYY-MM.jsonl` (append-only, khuôn byte-minimal của session JSONL).

| Trường | Ví dụ | Vì sao cần |
|---|---|---|
| `at` | `2026-09-12T10:32:14.204Z` | |
| `actor` | `human` · `agent:code-reviewer` · `playbook:static-site#3` · `schedule:nightly` | **Ai bảo làm** — trường quan trọng nhất |
| `sessionId` / `messageId` | `ses-8f3a…` | Nhảy ngược về đúng đoạn hội thoại đã sinh ra lệnh |
| `surface` | `explorer` · `logs` · `graph` · `playbook` · `session` · `terminal` · `pipeline` | |
| `tool` | `aws_cli` · `infra_action` · `logs_query` | |
| `context` | `{ profile, accountId, region, cluster, namespace, workspace }` | Chạy **ở đâu** |
| `class` | `read` · `write` · `destructive` · `context-switch` | |
| `decision` | `auto` · `approved` · `denied` · `blocked` · `bypass:temp` | **Cổng quyền đã quyết gì** — phân biệt "bạn đồng ý" với "chế độ tự động" |
| `argv` | `["ecs","update-service","--desired-count","4"]` | Lệnh đầy đủ, **đã redact** |
| `result` | `{ exitCode, durationMs, bytesScanned?, summary }` | |
| `cost?` | `{ estimatedUsd }` | Với Insights/Cost Explorer — lệnh có tính tiền |

**Không bao giờ ghi:** giá trị secret, nội dung file credential, token, URL ký sẵn (presign *là* credential), giá trị k8s Secret / SSM SecureString mà người dùng vừa xem. Mọi `argv` và output tóm tắt đi qua [redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts) **trước khi** chạm đĩa — không phải trước khi hiển thị.

## Màn Nhật ký

```
┌ /infra → Nhật ký ─────────────────────────────────────────────────────┐
│ [7 ngày ▾] [ai: tất cả ▾] [lớp: tất cả ▾] [kết quả ▾]  [tìm lệnh…]   │
│ 412 hành động · 38 ghi · 2 phá huỷ · 1 bị từ chối        [Xuất] [Dọn] │
├───────────────────────────────────────────────────────────────────────┤
│ 10:32:41  agent  ghi       ecs update-service --desired-count 4   ✓   │
│           bạn đã duyệt · 229015218011 · ap-southeast-1 · 1.2s   ↗phiên│
│ 10:32:14  agent  đọc       logs start-query (1.24 GB · ~0.006$)   ✓   │
│           tự động · 229015218011                                      │
│ 10:28:03  bạn    phá huỷ   ec2 terminate-instances i-0b7142ee     ✓   │
│           gõ tên xác nhận · production                                │
│ 09:41:55  agent  phá huỷ   rds delete-db-instance                 ⨯   │
│           BỊ CHẶN bởi ma trận quyền (cột production)                  │
└───────────────────────────────────────────────────────────────────────┘
```

Mỗi dòng: thời gian · ai · lớp · lệnh · kết quả; dòng phụ nêu **quyết định của cổng** và ngữ cảnh. Bấm mở JSON đầy đủ. Có **↗ phiên** khi hành động sinh ra từ một cuộc hội thoại — nhảy thẳng về đúng message đó ([ADR 0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) neo `eid`).

Lọc: khoảng thời gian · ai (bạn/agent nào/playbook/lịch) · lớp · quyết định · tài khoản · chuỗi trong lệnh. Ở chế độ Đơn giản, cột "lệnh" hiện câu tiếng người (*"Tăng số bản chạy của dịch vụ checkout lên 4"*) và dòng lệnh nằm trong chi tiết.

## Dọn — và điều không bao giờ dọn được

| Hành động | Luật |
|---|---|
| **Dọn theo bộ lọc đang chọn** | Hộp xác nhận nêu **đúng số dòng** sẽ mất và khoảng thời gian. Đề nghị **Xuất trước khi dọn** |
| **Dọn toàn bộ** | Gõ xác nhận |
| **Tự động hết hạn** | Settings: 30 / 90 / 365 ngày / vĩnh viễn. Mặc định **90 ngày** |
| **Dòng ghi việc dọn** | Bản thân việc dọn là một hành động ⇒ **được ghi lại**, và dòng đó **không bị xoá cùng**: `{ actor:"human", class:"destructive", argv:["audit","clean"], result:{ removed: 1284, range:"…" } }` |
| **Agent không dọn được** | Không tồn tại tool `audit_clean`. Xoá dấu vết là việc chỉ con người làm, và vẫn để lại dấu |

Đó là chỗ duy nhất trong cả họ tính năng mà tôi cố ý **không** cho ma trận quyền nới: nếu agent dọn được nhật ký thì nhật ký không còn là bằng chứng.

## Xuất

CSV (mở bằng Excel — cho người không rành) hoặc JSONL (đầy đủ trường). Đích ghi phải `assertInsideWorkspace`. Xuất **không** kèm secret vì nhật ký vốn đã không chứa secret.

## Agent và phiên tương tác thế nào

| Tool | Lớp | Dùng để |
|---|---|---|
| `audit_query({ since, actor, class, contains, limit })` | đọc | *"Tuần này tôi đã chạy gì trên production?"* · *"Ai scale service checkout?"* |
| `audit_summary({ since })` | đọc | Thống kê: bao nhiêu hành động, bao nhiêu ghi, tốn bao nhiêu tiền cho lệnh có tính phí |
| — | | **Không có** tool xoá |

Ba việc cụ thể agent làm được ngay khi có nhật ký:

1. **Báo cáo phiên** — cuối một phiên xử lý sự cố: *"Trong phiên này đã chạy 14 lệnh, 3 lệnh ghi (bạn duyệt cả 3), quét 4.1 GB log ≈ 0.02 $."*
2. **Dựng lại dòng thời gian sự cố** — ghép nhật ký hành động với nhật ký CloudWatch: *"10:28 bạn tắt batch-worker → 10:31 hàng đợi bắt đầu đầy → 10:32 checkout timeout."* Đây là thứ không công cụ nào khác làm được, vì chỉ AWOG giữ **cả hai** phía.
3. **Soát lại quyền** — *"Tháng này có 12 lệnh chạy ở chế độ tự động trên tài khoản production. Bạn có muốn siết ô đó lại không?"*

Chiều ngược lại: mỗi dòng nhật ký có nút **Hỏi agent** (đẩy dòng đó vào phiên) và **Chạy lại** (tạo lại lệnh đó, đi qua cổng quyền như mới — không bao giờ "chạy lại không hỏi").

## Lộ trình

| Pha | Nội dung | Ước lượng |
|---|---|---|
| **N1** | Ghi JSONL tại **một điểm duy nhất** trong `infra.run` (không phải tại call site) + redact trước khi ghi + xoay file theo tháng | M |
| **N2** | Màn Nhật ký: bảng · lọc · chi tiết JSON · ↗ nhảy về phiên | M |
| **N3** | Dọn theo bộ lọc · dọn toàn bộ · tự hết hạn · dòng ghi việc dọn · xuất CSV/JSONL | S |
| **N4** | Tool `audit_query` / `audit_summary` + báo cáo cuối phiên | M |
| **N5** | Dòng thời gian sự cố: ghép nhật ký hành động với log CloudWatch | M |

N1 phải làm **cùng lúc** với P0 của [session-infra-context.md](session-infra-context.md) — nếu `infra.run` ship trước mà chưa ghi nhật ký thì có một quãng thời gian chế độ tự động chạy mà không ai kiểm lại được.

## Trạng thái thực tế — cập nhật 2026-09-14

Màn: `/infra` → tab **Nhật ký**.

| Pha | Trạng thái |
|---|---|
| **N1** Ghi JSONL một điểm · redact trước khi ghi · xoay theo tháng | xong (đã land ở mốc 0, `infra/audit/store.ts`) |
| **N2** Màn Nhật ký: bảng · lọc (khoảng thời gian · lớp · quyết định · actor · chuỗi) · chi tiết JSON · ↗ nhảy về phiên | xong |
| **N3** Dọn theo bộ lọc · dọn toàn bộ · dòng ghi việc dọn · xuất CSV/JSONL | xong — **trừ tự hết hạn** |
| **N4** Tool `audit_query` / `audit_summary` cho agent | **chưa** — mới có RPC `infra.audit-query` cho chính màn Nhật ký |
| **N5** Dòng thời gian sự cố (ghép nhật ký hành động với log CloudWatch) | chưa |

### Năm điểm cần biết khi đọc màn này

1. **Dòng ghi việc dọn nằm NGOÀI khoảng vừa xoá** — `cleanInfraAudit()` ghi dòng `audit clean` **sau** khi xoá xong, nên nó không bao giờ tự xoá chính mình. Cùng luật cho `pruneExpired()` (actor `schedule:retention`).
2. **Tự hết hạn chưa được nối.** `pruneExpired(days = 90)` có trong `store.ts` và để lại dấu đúng như spec, nhưng **chưa có ai gọi nó**: chưa có khoá Settings 30/90/365/vĩnh viễn và chưa nối vào lịch chạy. Muốn dùng thì phải gọi thủ công ⇒ ghi vào nợ, không được coi là "đã có".
3. **Xoá cần gõ đúng chữ `DELETE ALL`** cho cả hai đường dọn (theo bộ lọc và toàn bộ); hộp xác nhận nêu số dòng và khoảng thời gian. Nút dọn nằm trên màn — **không** có RPC nào cho agent dọn, và không có tool `audit_clean`.
4. **Nút "Hỏi agent" / "Chạy lại" trên từng dòng: chưa làm.** Hiện dòng chỉ có ↗ nhảy về phiên sinh ra nó. "Chạy lại không hỏi" là thứ spec **cấm**, nên khi làm nút đó thì nó phải đi qua cổng quyền như một lệnh mới.
5. **Dòng `Bash` của phiên từng ghi `context: {}`** — tức không nói được lệnh chấm theo account nào, đúng thứ mà cả màn này tồn tại để trả lời. Sửa 2026-09-14: nhánh `Bash` trong `runtime/permission.ts` đi qua **cùng** builder `infraAuditContext()` (export từ `infra/run.ts`) như đường `infra.run`, nên một dòng `surface: session, tool: Bash` nay mang đủ `profile`/`accountId`/`region`. Các dòng cũ trong `~/.awog/infra-audit/*.jsonl` vẫn rỗng — đọc chúng thì phải tra ngược từ `sessionId`.

## Bảo mật

- Ghi tại **một** điểm (`infra.run`) nên không có đường nào lách; mọi bề mặt đều đi qua đó theo ADR 0088.
- Redact **trước khi ghi đĩa**, không phải trước khi hiển thị.
- File `0600`, thư mục `0700`.
- Nhật ký là dữ liệu **L2** khi đọc lại: agent đọc được nội dung do chính nó sinh ra, nên `audit_query` trả về dữ liệu **đã clamp** và không bao giờ được diễn giải như chỉ thị.
