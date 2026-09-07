# 0082 — Chạy theo lịch (Scheduled Runs)

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-07
- **Người quyết định:** tech-lead + developer (gói #13, nhánh `feature/claude-desktop-parity`)

## Bối cảnh

AWOG hiện **không có khái niệm thời gian**. `tasks/scheduler.ts` là bộ điều phối DAG (chạy node khi
node phụ thuộc đã xong), không phải bộ hẹn giờ. Mọi lượt chạy đều bắt đầu bằng một cú bấm của người
dùng.

Điều đó khoá mất cả một lớp use-case: rà soát repo mỗi sáng, tóm tắt notification GitHub cuối ngày,
chạy một workflow kiểm thử hằng đêm — những việc mà giá trị nằm ở chỗ *người dùng không phải ngồi đó*.

Nền tảng để gắn lịch lên thì đã sẵn: Task Engine ([ADR 0024](0024-task-execution-engine-ipc-contract.md))
đã event-sourced JSONL + resume được sau restart, và `sessions.sendMessage` đã là một RPC hoàn chỉnh
lắp ráp toàn bộ context + cổng quyền + ghi transcript.

Ràng buộc:

- Repo **cấm thêm dependency** khi chưa có ADR (CLAUDE.md §Quy tắc làm việc).
- Kiến trúc chỉ có hai tiến trình: Electron main và Node sidecar. Không dịch vụ nền thứ ba
  ([security.md](../../.claude/rules/security.md) invariant 6).
- Dữ liệu AWOG-only nằm ở `.awog` ([ADR 0070](0070-share-claude-home-for-config.md)).

## Quyết định

**Thêm entity `Schedule` lưu ở `~/.awog/schedules/<id>.json`, một bộ đếm giờ tick thưa ở Electron
main, và toàn bộ phần bấm cò nằm ở sidecar dưới dạng gọi lại chính các RPC mà UI đang dùng.**

### D1 — Biểu thức lịch là union rời rạc, không phải chuỗi cron

```ts
type ScheduleTrigger =
  | { kind: 'interval'; everyMinutes: number }            // 1 … 10080
  | { kind: 'daily';    time: 'HH:MM' }                   // giờ địa phương
  | { kind: 'weekly';   weekdays: number[]; time: 'HH:MM' } // 0 = CN … 6 = T7
```

Ba biến thể phủ đúng yêu cầu ("mỗi N phút/giờ", "hằng ngày lúc HH:MM", "các ngày trong tuần lúc
HH:MM"). "Mỗi N giờ" quy về `everyMinutes = N × 60` — một đơn vị, không hai.

### D2 — Không thêm `node-cron` (hay bất kỳ thư viện lịch nào)

Xem [Phương án đã cân nhắc](#phương-án-đã-cân-nhắc). Parser + `computeNextRun` tự viết nằm gọn trong
~90 dòng thuần ở `schedules/cron.ts`, không I/O, có 25 test.

### D3 — Bộ đếm giờ ở Electron main, không ở sidecar

`electron/src/scheduler.ts` chạy `setInterval` 30 giây, mỗi nhịp gọi RPC `schedules.tick`.

Vì sao **main** chứ không phải sidecar:

1. **Main là tiến trình sống lâu nhất.** Sidecar bị kill và respawn khi crash hoặc khi heartbeat phát
   hiện nó bị treo (`electron/src/engine.ts`) — một `setInterval` trong sidecar sẽ chết theo và không
   ai dựng lại đúng thời điểm. Main chỉ chết khi app thoát.
2. **Chỉ main mới nghe được `powerMonitor`.** Máy thức dậy → quét ngay thay vì đợi hết nhịp.
3. **SoC:** main là chủ vòng đời (window, tray, updater, remote gateway). Một cái nhịp đập thuộc về
   đó; sidecar là chỗ *làm việc*, không phải chỗ *đếm giờ*.

Vì sao **tick thưa** chứ không phải một `setTimeout` dài tới đúng mốc: timer dài **không sống qua
giấc ngủ của máy**. Máy ngủ 8 tiếng thì cái hẹn 8 tiếng nữa nổ muộn đúng 8 tiếng. Quét lại mỗi 30
giây rồi so `nextRunAt` (epoch tuyệt đối) với đồng hồ thật thì ngủ bao lâu cũng không sai — và đổi
giờ mùa cũng không ảnh hưởng, vì so sánh là epoch chứ không phải giờ tường.

Main **không gửi "bây giờ là mấy giờ"** xuống sidecar: `schedules.tick` không có tham số, sidecar
dùng đồng hồ của chính nó. Host không đẩy được thời gian để ép một lịch chạy sớm.

### D4 — Giới hạn: lịch chỉ chạy khi app đang chạy

Không có daemon, không launchd/systemd/Task Scheduler, không tiến trình nền. **Đóng app là không có
gì bấm cò.** Đây là hệ quả trực tiếp của invariant "chỉ hai tiến trình" và của mô hình local-first
(một daemon nền cầm OAuth token là một bề mặt hoàn toàn khác, cần ADR + audit riêng).

Giới hạn này được nói ra ở **ba** chỗ, không giấu chỗ nào:

- banner trong pane chi tiết của mỗi lịch (`ScheduleDetail.vue`, khoá i18n `schedules.limit.*`),
- [docs/features/scheduled-runs.md](../features/scheduled-runs.md) §Giới hạn,
- comment đầu file `electron/src/scheduler.ts`.

### D5 — Chính sách chạy bù: lỡ bao nhiêu cũng chỉ chạy **một** lần

Khi tick thấy `now >= nextRunAt`:

1. Neo lại `nextRunAt = computeNextRun(trigger, now)` — tính từ **bây giờ**, không phải từ mốc đã lỡ
   — rồi ghi xuống đĩa **ngay**.
2. Rồi mới bấm cò một lần.

Neo từ mốc đã lỡ sẽ biến một đêm ngủ máy thành N lần chạy dồn toa (lịch 15 phút, ngủ 8 tiếng ⇒ 32
lần). Neo từ `now` cho đúng một lần chạy bù rồi trở lại nhịp cũ. Ghi đĩa **trước khi** bấm cò là để
một lượt chạy dài vài phút không để mốc cũ nằm đó cho tick 30 giây sau bấm cò lần nữa.

Lần chạy được gắn nhãn `catchUp` khi trễ hơn 5 phút, để lịch sử phân biệt được "trễ một nhịp" với
"máy vừa ngủ dậy". Không có ngưỡng "quá cũ thì thôi": quá hạn là chạy, một lần, dù quá hạn bao lâu.

### D6 — Không chạy chồng: hỏi bên thực thi, không tin cờ trong bộ nhớ

Trước khi bấm cò, `busyReason()` tra lần chạy gần nhất:

- có `taskId` → `loadTask()`; trạng thái chưa thuộc `{completed, failed}` ⇒ bỏ qua;
- có `sessionId` → `activeSessionIds()` của session runner; còn trong đó ⇒ bỏ qua.

Hỏi thẳng nguồn sự thật nên vẫn đúng sau khi sidecar restart giữa chừng. Thêm một `Set` in-memory
`firing` che khoảng ngắn giữa lúc bấm cò và lúc lượt chạy hiện ra ở nguồn sự thật.

Bỏ qua thì ghi **một** dòng `skipped` kèm lý do (hiện trên UI + log), không phải mỗi 30 giây một
dòng — vì `nextRunAt` đã được neo lại ở bước 1.

### D7 — Bấm cò = gọi lại chính RPC của UI

`schedules/runner.ts` gọi `dispatch()` trên registry RPC:

| Loại việc | Gọi |
|---|---|
| `session-prompt` | `sessions.upsert` (create) → `sessions.sendMessage` |
| `workflow-task` | `tasks.create` |

Không dựng đường chạy thứ hai. Lịch thừa hưởng nguyên vẹn phần lắp ráp context (memory files, wiki,
rules, sources), cổng quyền, ghi JSONL, luồng event — và mọi sửa lỗi ở đường chạy thường tự động
áp cho lịch. Một bản sao "chạy nền" của `sessions.send-message.ts` (≈500 dòng, nhiều đoạn nhạy cảm
về bảo mật) là thứ chắc chắn sẽ lệch.

### D8 — Lịch mang **id**, không mang đường dẫn

`projectId` / `workflowId` là id trong store; sidecar tự resolve ra đường dẫn lúc chạy. Không trường
nào trong `ScheduleJob` nhận path, command hay argv. Một file lịch bị sửa tay (hoặc do model ghi)
không thể trỏ runtime vào thư mục bất kỳ. `schedules.upsert` kiểm project/workflow **có thật** ngay
lúc lưu (fail fast), thay vì để im lặng tới 3 giờ sáng.

### D9 — Bảo mật: chế độ quyền của một lượt chạy không người trực

Runtime fail-safe: thiếu `canUseTool` ⇒ **chặn** (`runtime/permission.ts`). Nhưng
`sessions.sendMessage` luôn cấp `canUseTool`, nên ở chế độ `ask` / `accept-edits`, tool call cần
quyền sẽ **park** — và hộp xin quyền được phát ra lúc **không cửa sổ nào biết phiên đó tồn tại**, nên
không ai trả lời được: lượt chạy treo vĩnh viễn và giữ luôn lịch.

Vì vậy form tạo lịch **chỉ cho chọn `execute` và `plan`**:

- `execute` — chạy tool không hỏi. Người dùng chọn tường minh, biết mình đang uỷ quyền cho một lượt
  chạy không người trực.
- `plan` — đọc và suy nghĩ, chặn mọi Write/Edit/Bash mà **không** park.

`ask`/`accept-edits` vẫn hợp lệ trong schema (chúng là `SessionSettings` bình thường) nhưng không
xuất hiện trong picker; nếu một file lịch cũ mang chúng thì mode đó vẫn hiện ra trong form để không
bị nuốt mất.

## Phương án đã cân nhắc

- **`node-cron` / `croner` / `node-schedule`** — thêm dependency cho ~90 dòng số học. Cả ba đều theo
  mô hình "một job = một timer nội bộ", đúng thứ chết qua giấc ngủ (D3); dùng chúng ta vẫn phải tự
  viết lớp catch-up. Cú pháp cron 5 trường lại vừa quá mạnh (người dùng desktop không cần
  `*/7 3-18 * * 1-5`) vừa không render ngược ra câu tiếng người nếu không viết thêm parser. Với một
  repo cấm thêm dep, đổi bề mặt phụ thuộc + rủi ro chuỗi cung ứng lấy một hàm cộng ngày là lỗ vốn.
  **Từ chối.**
- **Bộ đếm giờ trong sidecar** — sidecar bị respawn khi crash/treo, timer chết theo; và nó không nghe
  được `powerMonitor`. **Từ chối** (D3).
- **Dịch vụ nền của HĐH (launchd / systemd / Task Scheduler)** — chạy được khi app đóng, nhưng dựng
  một tiến trình thứ ba cầm OAuth token, ngoài mô hình hai tiến trình và ngoài mọi audit hiện có.
  Phạm vi riêng, ADR riêng. **Từ chối cho gói này**, ghi vào Việc cần làm tiếp.
- **Renderer lái lượt chạy `session-prompt`** (main báo cửa sổ chính, cửa sổ chính gọi `create()` +
  `sendMessage()`) — dùng lại được store sessions, nhưng chết khi cửa sổ đóng (macOS giữ app sống với
  0 cửa sổ) và phải thêm cơ chế chống trùng giữa cửa sổ chính và popout. **Từ chối** (D7 làm được
  cùng việc mà không cần renderer).
- **Neo `nextRunAt` từ mốc đã lỡ (chạy bù đủ N lần)** — đúng theo nghĩa cron trên server, sai theo
  nghĩa desktop: mở máy buổi sáng ăn ngay 32 lượt chạy. **Từ chối** (D5).
- **Cộng 86_400_000 ms cho `daily`** — hỏng ở hai ngày đổi giờ mỗi năm (lịch 09:00 trôi thành 08:00
  hoặc 10:00 và ở luôn đó). **Từ chối**: dựng lại `Date` từ (năm, tháng, ngày+n, giờ, phút) để
  constructor local-time tự giải DST.

## Hệ quả

- **Tích cực:** AWOG có lớp use-case "agent chạy khi người dùng không ngồi máy" mà không thêm
  dependency, không thêm tiến trình, không thêm cổng mạng. Đường chạy dùng lại 100% RPC sẵn có nên
  không có nhánh code thứ hai để lệch. Số học lịch là hàm thuần, có 33 test.
- **Tiêu cực / Trade-off:**
  - Đóng app là lịch ngừng. Đây là trade-off cố ý, không phải bug (D4).
  - Sai số bấm cò tối đa ~30 giây (một nhịp tick). Chấp nhận được cho lịch tính bằng phút.
  - `session-prompt` chỉ chạy được ở `execute` / `plan` (D9).
  - Phiên do lịch tạo **không xuất hiện ngay** trong danh sách của cửa sổ chính: `stores/sessions.ts`
    nạp danh sách đúng một lần lúc khởi động và không có event "phiên mới". Lịch sử chạy có nút "Mở
    phiên" mở nó ở **cửa sổ popout** (renderer mới ⇒ tự nạp lại ⇒ thấy phiên). Xem Việc cần làm tiếp.
- **Việc cần làm tiếp:**
  1. `stores/sessions.ts`: một action `adoptSession(engineId)` hoặc lắng nghe event `sessions.created`
     để phiên do lịch tạo hiện ngay trong danh sách cửa sổ chính (ngoài phạm vi gói #13 — file thuộc
     agent khác).
  2. Chính sách quyền riêng cho lượt chạy theo lịch: thay vì park, gate mặc-định-từ-chối có ghi lại
     "đã chặn tool X" vào transcript, để mở lại `ask` / `accept-edits`.
  3. Thông báo khi một lịch chạy lỗi (đi qua `settings.notifications` của
     [github-notifications](../features/github-notifications.md)).
  4. Cân nhắc dịch vụ nền của HĐH — ADR riêng, bắt buộc infosec.
  5. Chọn tài khoản / model riêng cho từng lịch (hiện chụp lại từ Settings → Defaults lúc tạo).

## Tham chiếu

- [docs/features/scheduled-runs.md](../features/scheduled-runs.md) — spec chi tiết
- [ADR 0024](0024-task-execution-engine-ipc-contract.md) — Task Execution Engine (đường chạy `workflow-task`)
- [ADR 0070](0070-share-claude-home-for-config.md) — dữ liệu AWOG-only ở `.awog`
- [ADR 0027](0027-tauri-vs-electron-revisit.md) — Electron main là chủ vòng đời
- [.claude/rules/security.md](../../.claude/rules/security.md) — 8 invariant
