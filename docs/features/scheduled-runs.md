# Chạy theo lịch (Scheduled Runs)

> Quyết định kiến trúc: [ADR 0082](../decisions/0082-scheduled-runs.md).
> Trang: `/schedules` · Nav: **Work → Lịch chạy**

Đặt hẹn giờ cho agent: mỗi sáng gửi một prompt vào phiên mới, hoặc mỗi đêm chạy một workflow thành
task. Mục tiêu là lớp use-case "agent làm việc lúc người dùng không ngồi máy".

## Giới hạn — đọc trước

**Lịch chỉ chạy khi AWOG đang mở.** Không có dịch vụ nền, không đăng ký launchd/systemd/Task
Scheduler. Đóng app là không có gì bấm cò.

Mở lại app thì lần lỡ gần nhất được **chạy bù đúng một lần** (không dồn N lần). Giới hạn này hiện
ngay trên pane chi tiết của mỗi lịch, không giấu trong tài liệu.

## Biểu thức lịch

Ba dạng, đủ cho nhu cầu desktop, không dùng cú pháp cron:

| Dạng | Ý nghĩa | Ghi trên đĩa |
|---|---|---|
| **Mỗi N phút/giờ** | khoảng lặp theo thời gian thật | `{ kind: 'interval', everyMinutes: 30 }` |
| **Hằng ngày lúc HH:MM** | giờ tường, giờ địa phương | `{ kind: 'daily', time: '09:00' }` |
| **Các ngày trong tuần lúc HH:MM** | 0 = CN … 6 = T7 | `{ kind: 'weekly', weekdays: [1,3,5], time: '18:00' }` |

Trần khoảng lặp là 1 tuần (10080 phút); dài hơn thì dùng `weekly`. Giờ luôn là **giờ địa phương của
máy** — đặt "8:30 sáng" là 8:30 sáng theo đồng hồ của bạn, kể cả sau khi đổi giờ mùa.

### Đổi giờ mùa (DST)

`interval` là phép cộng mili-giây thuần nên miễn nhiễm — "mỗi 1 giờ" luôn là 60 phút thật.

`daily` / `weekly` dựng lại `Date` từ (năm, tháng, ngày+n, giờ, phút) chứ **không** cộng
86 400 000 ms, nên constructor local-time của JS tự giải DST:

- **Nhảy tiến** (02:00 → 03:00): mốc 02:30 không tồn tại → chạy lúc 03:30 cùng ngày. Trễ một tiếng,
  không mất một ngày.
- **Lùi lại** (02:30 xảy ra hai lần): chỉ chạy ở lần **đầu**. Mốc kế tiếp luôn phải lớn hơn mốc vừa
  chạy nên lần thứ hai bị bỏ qua — không chạy đúp.

Toàn bộ hành vi này có test: `apps/desktop/sidecar/src/schedules/__tests__/cron.test.ts` (ghim
`TZ=America/New_York` để có một vùng thật sự đổi giờ).

## Loại việc

### `session-prompt` — gửi prompt vào một phiên mới

Sidecar tạo phiên (`sessions.upsert`) rồi gửi lượt chat (`sessions.sendMessage`) — đúng hai RPC mà
composer vẫn dùng, nên phiên do lịch tạo giống hệt phiên bạn tự mở: cùng context, cùng cổng quyền,
cùng transcript JSONL.

Cấu hình LLM (provider / model / mức suy luận / tài khoản) được **chụp lại từ Settings → Defaults**
lúc tạo lịch. Riêng **chế độ quyền** chọn được, và chỉ có hai lựa chọn:

| Mode | Nghĩa trong một lượt chạy không người trực |
|---|---|
| `execute` | chạy tool không hỏi — uỷ quyền tường minh |
| `plan` | đọc và suy nghĩ; chặn mọi Write/Edit/Bash |

`ask` và `accept-edits` **không** được đưa vào picker: chúng park ở tool call đầu tiên cần quyền, mà
hộp xin quyền lại phát ra lúc không cửa sổ nào biết phiên đó tồn tại ⇒ lượt chạy treo vĩnh viễn. Xem
[ADR 0082 §D9](../decisions/0082-scheduled-runs.md).

### `workflow-task` — chạy một workflow thành task

Gọi `tasks.create` với `source: { type: 'manual' }`. Task chạy trên Task Execution Engine
([ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md)) như mọi task khác — parallel
scheduler, auto-commit theo phase, resume được sau restart.

## Cách nó chạy

```
Electron main                     Sidecar
─────────────                     ───────
setInterval 30s ──► schedules.tick ──► listSchedules()
powerMonitor                          │
 'resume'   ──────►                   ├─ lịch nào tới hạn?
                                      ├─ neo lại nextRunAt TỪ BÂY GIỜ, ghi đĩa
                                      ├─ lần trước còn chạy? → ghi 'skipped'
                                      └─ bấm cò:
                                          session-prompt → sessions.upsert + sessions.sendMessage
                                          workflow-task  → tasks.create
```

- **Bộ đếm giờ ở Electron main** vì nó là tiến trình sống lâu nhất (sidecar bị respawn khi crash/treo)
  và chỉ nó nghe được `powerMonitor`.
- **Tick thưa 30 giây** chứ không hẹn giờ dài tới đúng mốc: timer dài không sống qua giấc ngủ của máy.
- Nhịp đầu tiên hoãn 15 giây sau khi app mở, để engine kịp sẵn sàng.
- `schedules.tick` **không nhận tham số thời gian** — sidecar dùng đồng hồ của chính nó.

### Chạy bù

Quá hạn thì chạy **một lần**, rồi neo mốc kế tiếp từ **bây giờ**. Lịch 15 phút mà máy ngủ 3 tiếng →
một lần chạy, không phải 12. Lần chạy được gắn nhãn `chạy bù` khi trễ hơn 5 phút.

### Không chạy chồng

Trước khi bấm cò, sidecar hỏi thẳng bên thực thi về lần chạy gần nhất:

- có `taskId` → `loadTask()`; trạng thái chưa `completed`/`failed` ⇒ bỏ qua;
- có `sessionId` → `activeSessionIds()`; còn trong đó ⇒ bỏ qua.

Bỏ qua thì ghi **một** dòng `skipped` kèm lý do (hiện trên UI + log `schedules: run skipped (overlap)`),
không phải mỗi 30 giây một dòng.

## Lưu trữ

`~/.awog/schedules/<id>.json` — một file một lịch, ghi nguyên tử (`.tmp` + rename), `chmod 600`.
Đọc thì validate zod; file hỏng bị bỏ qua kèm log, không làm chết danh sách.

```jsonc
{
  "id": "morning-triage",
  "name": "Rà soát buổi sáng",
  "enabled": true,
  "trigger": { "kind": "daily", "time": "08:30" },
  "job": {
    "kind": "session-prompt",
    "prompt": "Xem lại commit hôm qua và tóm tắt những gì đã thay đổi.",
    "projectId": "awog",
    "settings": { "provider": "anthropic", "modelId": "…", "level": "medium", "mode": "execute" }
  },
  "createdAt": "2026-09-07T01:00:00.000Z",
  "updatedAt": "2026-09-07T01:00:00.000Z",
  "nextRunAt": "2026-09-08T01:30:00.000Z",
  "lastRunAt": "2026-09-07T01:30:00.000Z",
  "lastStatus": "ok",
  "runs": [ /* tối đa 20 dòng, mới nhất đứng đầu */ ]
}
```

`nextRunAt` / `lastRunAt` / `lastStatus` / `runs` do sidecar tính và giữ — RPC `schedules.upsert`
**không** nhận chúng từ UI.

## RPC

| Method | Vào | Ra |
|---|---|---|
| `schedules.list` | — | `{ schedules }` |
| `schedules.upsert` | `{ id, name, enabled, trigger, job }` | `{ schedule }` (đã tính `nextRunAt`) |
| `schedules.delete` | `{ id }` | `{ ok: true }` |
| `schedules.runNow` | `{ id }` | `{ run }` — dòng `running`, hoặc `skipped` |
| `schedules.tick` | — | `{ checked, fired[], skipped[] }` |

Event `schedules.changed` `{ id }` phát mỗi lần lịch sử/mốc thay đổi; store UI nạp lại danh sách.

"Chạy ngay" **không** đụng `nextRunAt` — chạy tay là việc phát sinh, nhịp định kỳ giữ nguyên.

## UI

- Danh sách (`LibraryView`) — tên, biểu thức lịch, trạng thái lần cuối, mốc kế tiếp ở dòng phụ.
- Chi tiết — banner giới hạn "app phải đang mở", bảng lịch/việc/mốc, và **20 lần chạy gần nhất**
  (trạng thái · thời điểm · theo lịch hay chạy tay · nhãn chạy bù · lý do lỗi/bỏ qua).
- Nút **Chạy ngay** · công tắc bật/tắt · sửa · xoá.
- Lần chạy `session-prompt` có nút **Mở phiên**.

### Vì sao "Mở phiên" mở ở cửa sổ riêng

`stores/sessions.ts` nạp danh sách phiên đúng **một lần** lúc khởi động và không có event "phiên
mới", nên phiên do lịch tạo sau đó không có trong danh sách của cửa sổ chính. Cửa sổ popout là một
renderer mới ⇒ tự nạp lại ⇒ thấy phiên ngay. Đây là cách đi vòng, không phải thiết kế mong muốn —
việc cần làm tiếp là một action `adoptSession(engineId)` trong store sessions
([ADR 0082 §Việc cần làm tiếp](../decisions/0082-scheduled-runs.md)).

## Trần chi tiêu — luôn có, kể cả khi bỏ trống

Một lượt chạy theo lịch không có ai ngồi trước máy, và ở mode `execute` thì cũng
không có cổng quyền nào bấm phanh. "Không đặt trần" ở đây nghĩa là một vòng lặp
hỏng chạy tới khi hết tiền — đúng sink *"Loop gọi model — cháy tiền"* trong
[`.claude/rules/security.md`](../../.claude/rules/security.md).

Nên trần **không phải tuỳ chọn**. `job.budget` bỏ trống KHÔNG có nghĩa là vô hạn:
`runner.ts` trộn bản mặc định thận trọng vào trước, bản của người dùng ghi đè lên
từng trường.

| Chiều | Mặc định | Env |
|---|---|---|
| Chi phí (hard) | 3 USD | `AWOG_SCHEDULE_MAX_USD` |
| Số tool call | 300 | `AWOG_SCHEDULE_MAX_TOOL_CALLS` |
| Wallclock | 15 phút | `AWOG_SCHEDULE_MAX_WALLCLOCK_MS` |

Trần đi kèm phiên qua tham số `budget` của `sessions.upsert` (cạnh `session`), nên
cổng quyền và vòng lặp tool đọc được nó ngay từ lượt đầu — không phải một lớp kiểm
tra riêng chạy sau.

Nhánh `workflow-task` đã có trần riêng ở cấp task
([ADR 0081](../decisions/0081-task-node-worktree-isolation.md)), không dùng bảng trên.

## Bảo mật

- Lịch mang **id** (`projectId`, `workflowId`), không mang path/command/argv. Không có đường nào để
  một file lịch bị sửa tay trỏ runtime vào thư mục bất kỳ.
- File trên đĩa và payload IPC đều là **L1**: validate zod trước khi dùng; `schedules.upsert` chỉ
  nhận đúng 5 trường người dùng đặt được (không spread payload).
- `id` khớp `SCHEDULE_ID_RE` (`^[a-z0-9][a-z0-9_-]{0,120}$`) và vẫn đi qua `sanitizeChild` trước khi
  ghép đường dẫn.
- Lịch **không chứa bí mật** — chỉ `accountId`, token vẫn nằm ở keychain/sidecar.
- Chế độ quyền của lượt chạy không người trực: xem [§Loại việc](#session-prompt--gửi-prompt-vào-một-phiên-mới).

## File

| Path | Vai trò |
|---|---|
| `apps/desktop/sidecar/src/schedules/schema.ts` | Zod schema + type (single source of truth) |
| `apps/desktop/sidecar/src/schedules/cron.ts` | `computeNextRun` / `parseTimeOfDay` / chính sách chạy bù — hàm thuần |
| `apps/desktop/sidecar/src/schedules/store.ts` | `~/.awog/schedules/<id>.json`, ghi nguyên tử |
| `apps/desktop/sidecar/src/schedules/runner.ts` | tick · chặn chạy chồng · bấm cò · lịch sử |
| `apps/desktop/sidecar/src/methods/schedules.*.ts` | 5 RPC |
| `apps/desktop/electron/src/scheduler.ts` | Bộ đếm giờ 30s + `powerMonitor.resume` |
| `apps/desktop/ui-next/stores/schedules.ts` | Store Pinia (CRUD + runNow + `schedules.changed`) |
| `apps/desktop/ui-next/pages/schedules.vue` | Trang |
| `apps/desktop/ui-next/components/schedule/` | `ScheduleDetail.vue` · `ScheduleEditor.vue` · `schedule-format.ts` |
| `apps/desktop/ui-next/i18n/locales/{en,vi}/schedules.json` | Chuỗi UI |

## Test

```bash
cd apps/desktop/sidecar
npx vitest@2 run src/schedules/__tests__/
```

33 test: parser `HH:MM`, `computeNextRun` cho cả ba dạng, hai ca DST (nhảy tiến / lùi lại), ngày 25
tiếng, vắt tháng, vắt tuần, chính sách chạy bù, và biên L1 của schema (id traversal, trường lạ bị gỡ).
