# 0083 — Ngang bằng khả năng subagent giữa nhánh Pi và nhánh Claude SDK

- **Trạng thái:** Accepted (mục §c để Proposed — xem "Việc cần làm tiếp")
- **Ngày:** 2026-09-07
- **Người quyết định:** developer (gói #7a–7e), theo [ADR 0030](0030-subagent-task-tool.md) + [ADR 0058](0058-claude-agent-sdk-vs-pi-runtime-revisit.md)

## Bối cảnh

AWOG chọn runtime **theo provider** ([ADR 0058](0058-claude-agent-sdk-vs-pi-runtime-revisit.md)): `provider === 'anthropic'` chạy `runtime/claude-sdk/run-stream.ts`, provider khác chạy `runtime/run-stream.ts` (Pi). Cùng một phiên, cùng một người dùng, nhưng tool `Task` ở hai nhánh không còn giống nhau.

`AgentInput` của Claude Agent SDK 0.3.260 (`sdk-tools.d.ts`) cho model 5 thứ mà nhánh Pi **không có thứ nào**:

| Khả năng | Claude SDK (`AgentInput`) | Nhánh Pi trước bản này |
|---|---|---|
| a. Chọn model tại call site | `model?: "sonnet" \| "opus" \| "haiku" \| "fable"` | Chỉ lấy model từ frontmatter AGENT.md |
| b. Chạy nền không chặn | `run_in_background?: boolean` + tool `TaskOutput` / `TaskStop` | `await runAgentLoop(...)` đồng bộ trong `execute()` |
| c. Worktree cô lập | `isolation?: "worktree" \| "remote"` | Dùng chung `cwd` với cha |
| d. Fork context của cha | `subagent_type: "fork"` | Kế thừa *cấu hình*, không kế thừa *lịch sử* |
| e. Nhắn tiếp cho subagent cũ | `name` + `SendMessage({ to })` | One-shot, không giữ handle |

Hệ quả thực tế: cùng một prompt, người dùng OpenAI/Google/custom endpoint nhận một `Task` nghèo hơn hẳn — mà model (bị điều kiện hoá như Claude Code dưới OAuth) vẫn cứ gọi `run_in_background`, `model`, `TaskOutput` như thể có.

## Quyết định

### §a. `model` = TIER đóng, không phải model id tự do

`Task` nhận thêm `model?: opus | sonnet | haiku | fable | inherit`. [`runtime/subagents/model-tier.ts`](../../apps/desktop/sidecar/src/runtime/subagents/model-tier.ts) resolve tier → model id **theo đúng tài khoản đang dùng**:

1. `inherit` ⇒ giữ model thừa kế (AGENT.md, hoặc model của turn cha).
2. `account.models` (danh sách người dùng tự khai cho custom endpoint) có id chứa tên tier ⇒ dùng id đó.
3. Provider `anthropic` + không custom endpoint ⇒ đi qua `MODEL_ALIASES` + `isAnthropicModel` của [`providers/anthropic/models-map.ts`](../../apps/desktop/sidecar/src/providers/anthropic/models-map.ts) (nguồn sự thật sẵn có, không chép lại bảng model thứ hai).
4. Không khớp gì ⇒ **giữ nguyên model thừa kế** và trả một câu giải thích trong tool result.

Ba tính chất bắt buộc: (i) prompt **không** đặt được model id tuỳ ý — chỉ 5 tier; (ii) tier không bao giờ biến thành một id mà provider không biết (tránh 400 giữa lượt); (iii) không honour được thì **nói ra**, không im lặng đổi model.

Với `subagent_type: "fork"`, `model` bị bỏ qua — fork là "chính tôi, chạy song song", đổi model thì không còn là fork nữa (đúng bằng ghi chú trong `AgentInput`).

### §b. Chạy nền = TRONG LƯỢT, không sống qua lượt

`Task({ run_in_background: true })` trả về ngay một `task_id`; model làm việc khác rồi thu kết quả bằng `TaskOutput({ task_id, block, timeout })`, hoặc bỏ bằng `TaskStop`.

Vòng đời **đúng bằng lượt cha**, không dài hơn:

- [`runtime/subagents/registry.ts`](../../apps/desktop/sidecar/src/runtime/subagents/registry.ts) là đối tượng **theo lượt**; `run-stream.ts` gọi `disposeAll()` trong `finally` của vòng lặp agent.
- Signal của lượt (pi truyền vào `execute`) được nối vào từng subagent ⇒ người dùng bấm Stop là subagent nền chết ngay.
- Đây cũng đúng bằng lời hứa nhánh Claude SDK đang nói với model (`runtime/claude-sdk/shared.ts`: *"What does NOT survive is the END of the turn"*), nên hai runtime không hứa hai điều khác nhau.

Lý do **không** chọn mô hình "sống qua lượt" (kiểu background shell của [ADR 0066](0066-session-background-exec-and-wake.md)): một phiên chỉ có **một lượt tại một thời điểm**. Subagent sống sau lượt sẽ gọi tool khi không còn lượt nào để hỏi quyền, không còn transcript để ghi step, và sẽ giẫm lên lượt kế tiếp. Background shell không vướng chuyện đó vì nó là tiến trình hệ điều hành, không phải một agent gọi tool.

**Chỉ chat** được chạy nền. Task node (`runtime/invoke.ts`) là one-shot: hết node là hết tiến trình, một subagent nền ở đó là kết quả không ai thu được — nhánh Claude SDK cũng ép task chạy đồng bộ vì đúng lý do này. Yêu cầu `run_in_background` ở task ⇒ **degrade sang đồng bộ** + ghi rõ trong kết quả, không báo lỗi (việc vẫn phải xong).

**Trần an toàn** (subagent nền chạy không người trực):

| Trần | Giá trị | Vì sao |
|---|---|---|
| `MAX_SUBAGENTS_PER_TURN` | 25 (sẵn có) | Chặn bề rộng |
| `MAX_BACKGROUND_SUBAGENTS` | 4 | Bằng cap background shell + cap scheduler của Task — một mô hình duy nhất cho "AWOG tự fan-out rộng bao nhiêu" |
| `BACKGROUND_SUBAGENT_TIMEOUT_MS` | 30 phút / subagent | Không ai nhìn nó; hết giờ thì abort |
| `TaskOutput` block | mặc định 120s, tối đa 600s | Model xin chờ 1 tiếng thì cả lượt đứng hình |
| Ngân sách lượt | `withTurnBudget` (sẵn có) | Tool call của subagent đi qua **đúng** `beforeToolCall` của cha ⇒ đã bị đếm |

Subagent nền được soi thành **chip nền** qua chính `sessions/bg-registry.ts` (đường `registerExternalBackground` mà nhánh Claude SDK đã dùng) ⇒ người dùng thấy một danh sách duy nhất và bấm dừng được. Bản đồng bộ **không** tạo chip (sinh/tắt trong cùng một tool call, chip chỉ là nhiễu).

### §c. Worktree cô lập — **KHÔNG** làm ở bản này

Xem "Phương án đã cân nhắc" và "Việc cần làm tiếp".

### §d. `subagent_type: "fork"` = general-purpose + đuôi transcript có trần

`fork` chạy subagent general-purpose (kế thừa system prompt / tool / model của cha) **và** replay thêm phần **cuối** transcript của phiên cha, cắt theo trần ký tự ([`runtime/subagents/fork-history.ts`](../../apps/desktop/sidecar/src/runtime/subagents/fork-history.ts), mặc định 60k ký tự ≈ 15k token, luôn giữ ít nhất 1 message).

Trần nằm **trong đường dựng context**, không phải một lời khuyên trong prompt: fork là chỗ duy nhất một subagent có thể thổi ngân sách context theo đúng thiết kế (một phiên dài fork 3 lần là trả tiền cho cùng transcript 4 lần).

### §e. `SendMessage({ to, message })` = nối tiếp hội thoại cũ

Đặt `name` khi spawn ⇒ subagent có địa chỉ. `SendMessage` chạy **thêm một lượt** trên **đúng `AgentContext` cũ** (pi cộng dồn message vào `context.messages`, nên lượt mới thấy toàn bộ tool call + kết quả của lượt trước) rồi trả lời về cho cha.

Khác biệt có chủ ý so với Claude SDK: bên đó nhắn được cho subagent **đang chạy**; ở đây chỉ nhắn được khi nó **đã xong lượt hiện tại** (đang chạy ⇒ trả lời "thu bằng TaskOutput trước"). Steering giữa lượt là cơ chế của `sessions/runner.ts`, không với tới được từ trong một tool call — và chen một message vào giữa vòng lặp lồng nhau thì không có đường nào báo cho người dùng biết. Đã chết (`error`/`stopped`) thì từ chối luôn: context của nó không còn đáng tin để nối tiếp.

`TaskOutput` / `TaskStop` / `SendMessage` là **một phần của khả năng `Task`**, không phải ba tool độc lập: chúng chỉ được đăng ký khi `Task` được phép (không plan mode, không bị `allowedTools`/`disabledTools` loại) và theo đúng allowance của `Task`. Nếu tách allowance riêng, một agent whitelist `Task` mà quên `TaskOutput` sẽ spawn được subagent nền rồi **không bao giờ thu được kết quả**.

## Phương án đã cân nhắc

- **§b — tái dùng `sessions/bg-registry.ts` làm nơi giữ subagent nền (sống qua lượt).** Từ chối: registry đó quản *tiến trình hệ điều hành* (pid, file log, exit file), còn subagent là một vòng lặp agent trong tiến trình sidecar. Quan trọng hơn, "sống qua lượt" vi phạm invariant một-lượt-một-thời-điểm (xem §b). Chỉ **soi chip** qua nó (`registerExternalBackground`) — đúng phần nó làm tốt.
- **§c — tái dùng `tasks/worktree.ts` cho subagent.** Từ chối ở bản này, ba lý do:
  1. **Vòng đời khác.** Module đó khoá theo `taskId`: thư mục checkout nằm dưới `~/.awog/tasks/<taskId>/worktrees/`, neo nhánh ghi vào `~/.awog/tasks/<taskId>/worktree-base`, branch mang prefix `awog/task/<taskId>/`, và `sweepOrphanWorktrees()` ở boot quét theo `listTaskIds()`. Một subagent trong **phiên chat** không có `taskId`; mượn `sessionId` làm `taskId` sẽ đẻ ra thư mục task ma trong store Task và **checkout mồ côi không ai quét** khi sidecar chết giữa chừng — đúng cái lỗi mất dữ liệu mà ADR 0081 vừa vá.
  2. **Điều kiện `canCommit` không thoả.** ADR 0081 chỉ cấp worktree khi node **chắc chắn có commit** (auto-commit per-phase bật), vì worktree không commit là bẫy mất dữ liệu. Auto-commit là chuyện của **Tasks**, cố ý không wire vào sessions. Nên với subagent chat, chính `acquireNodeWorkspace` sẽ degrade về cây gốc — tái dùng cũng không được gì.
  3. **Ranh giới sản phẩm.** `integrateTaskBranches()` merge vào nhánh người dùng đang checkout. Làm việc đó **từ một lượt chat** nghĩa là AWOG tự tạo branch + commit WIP + merge vào repo của người dùng mà họ không hề bật một công tắc nào. Đây là quyết định sản phẩm, không phải chi tiết kỹ thuật ⇒ cần tech-lead chốt trước khi code.
  Thêm một ràng buộc thực tế: đường Task (`runtime/invoke.ts`) — nơi worktree **hợp lý nhất** vì đã có auto-commit — nằm ngoài quyền sửa của gói này.
- **§d — fork toàn bộ transcript.** Từ chối: không trần thì mỗi fork nhân đôi hoá đơn token của phiên, và một phiên dài sẽ vượt cửa sổ context của chính subagent.
- **§a — cho model truyền model id đầy đủ.** Từ chối: prompt là **L1 không tin** (`.claude/rules/security.md`). Id tự do vừa mở đường gọi một model ngoài ý muốn người dùng (tiền), vừa sinh 400 giữa lượt khi id không thuộc catalog của account.

## Hệ quả

- **Tích cực:** 4/5 khả năng ngang nhánh Claude SDK; model dưới OAuth gọi `run_in_background` / `model` / `TaskOutput` không còn rơi vào "tool not found" hay bị chặn đứng; delegate rẻ tiền (haiku) và fan-out song song thật sự khả dụng ở mọi provider.
- **Tiêu cực / Trade-off:**
  - Subagent nền chết khi lượt kết thúc. Model được **nói thẳng** điều đó trong description của `Task` và `TaskOutput`, nhưng một model bất cẩn vẫn có thể kết thúc lượt sớm và mất công việc đang chạy.
  - `SendMessage` chỉ nối tiếp được subagent đã xong lượt (§e).
  - Context của subagent giữ trong bộ nhớ tới hết lượt (để `SendMessage` nối tiếp) — nhiều subagent lớn trong một lượt sẽ tốn RAM. Trần 25/lượt giữ mức này hữu hạn.
  - Chưa có worktree ⇒ hai subagent nền cùng sửa một file vẫn giẫm chân nhau. Trong chat, `MAX_BACKGROUND_SUBAGENTS = 4` và việc người dùng đang ngồi xem là lưới đỡ tạm; đây là lý do §c phải làm tiếp.
- **Việc cần làm tiếp:**
  1. **§c worktree** — tech-lead chốt ranh giới sản phẩm ("AWOG được tự tạo branch/commit từ một lượt chat không?"), rồi tổng quát hoá `tasks/worktree.ts` từ "khoá theo task" sang "khoá theo owner" (`{ kind: 'task' | 'session', id }`) để cả sweeper lẫn neo nhánh dùng chung. Không fork thêm một bản worktree thứ hai.
  2. Bật `Task` nền cho `runtime/invoke.ts` là **không** làm — trừ khi Task engine cho phép một node chờ subagent qua nhiều lượt.
  3. Infosec soi lại khi mở rộng: subagent nền dùng đúng `beforeToolCall` của cha (không nới quyền), nhưng nó gọi tool khi người dùng đang đọc thứ khác — đáng review UX của prompt quyền.

## Tham chiếu

- [ADR 0030 — Subagent Task tool](0030-subagent-task-tool.md) (bản này mở rộng)
- [ADR 0058 — Claude Agent SDK vs Pi runtime](0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (vì sao có hai nhánh)
- [ADR 0066 — Background exec + wake](0066-session-background-exec-and-wake.md) (mô hình chip nền được tái dùng)
- [ADR 0081 — Worktree cho node Task](0081-task-node-worktree-isolation.md) (module §c sẽ tổng quát hoá)
- [Spec: Subagent Task tool](../features/subagent-task-tool.md)
