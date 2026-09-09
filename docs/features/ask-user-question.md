# Feature: AskUserQuestion (hỏi người dùng trắc nghiệm giữa lượt)

> Trạng thái: **Implemented trên cả 2 runtime** (Pi = tool AWOG tự viết; Claude SDK = tool builtin của CLI, AWOG chỉ trả lời — xem [§ Nhánh Claude SDK](#nhánh-claude-sdk-2026-09-09)) · Liên quan: [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) (Pi runtime), [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (dual runtime), [ADR 0030](../decisions/0030-subagent-task-tool.md) (graceful tool fallback), plan-mode flow (`ExitPlanMode`).

## Vấn đề

Trong Session, model (qua Pi runtime) thỉnh thoảng cần **hỏi người dùng chọn** giữa vài phương án trước khi đi tiếp — đúng tool `AskUserQuestion` của Claude Code. Khảo sát cho thấy:

- **Pi SDK không implement** `AskUserQuestion`. Tên này chỉ nằm trong bảng canonical tool-name của "stealth mode" (`pi-ai/.../providers/anthropic.ts` → `claudeCodeTools`) để request OAuth giả dạng Claude Code — không có tool/execute/event/UI nào.
- **craft-agents-oss** (repo tham chiếu) cũng **không** làm: bản backend Claude **chặn thẳng** (`disallowedTools = [..., 'AskUserQuestion']`) vì "requires interactive UI"; bản backend Pi không nhắc tới. Điểm dừng tương tác duy nhất craft làm là plan review (terminate + resume-by-message) = đúng flow `ExitPlanMode` AWOG đã có.

Hệ quả: hiện tại nếu model (dưới OAuth, biết tool này từ training) tự gọi `AskUserQuestion` → lỗi `Tool AskUserQuestion not found` (cùng class lỗi mà `builtin-stubs.ts` xử lý cho `TodoWrite`/`WebSearch`/`WebFetch`).

## Quyết định cơ chế: **mid-turn park** (không terminate)

AWOG chạy `runAgentLoop` **in-process** nên tool `execute()` **park được** giữa lượt — đã chứng minh qua **permission-park** (`parkPermissionRequest`). Đây là ràng buộc mà subprocess của craft không có, nên AWOG chọn hướng sạch hơn craft:

- Tool `execute()` **block** trên một Promise đã park (keyed theo `toolCallId`).
- Đáp án của user trả về **chính là `tool_result`** của call đó → loop tiếp tục **cùng lượt**, mạch lạc (không phải bơm user-message giả như kiểu terminate-resume).

Đối chiếu plan-mode: plan dùng terminate-resume (đổi mode + lượt mới); AskUserQuestion dùng mid-turn park (không đổi mode, cùng lượt).

## Phạm vi

- **Chỉ Sessions** có handler tương tác. **Tasks/subagent headless** → tool trả graceful "no interactive user available, proceed with best judgment" (không deadlock; cũng vá luôn lỗi `Tool not found`).
- Available ở **mọi mode** (ask/accept-edits/plan/execute) — tool read-only, không qua permission gate.

## Round-trip

```
model gọi AskUserQuestion({ questions })
 → event-adapter (tool_execution_start): stepFromQuestion(toolCallId, questions, status:'running')
       → cb.onStep → emit('session.step')  ──────────────►  UI: SessionQuestionCard render form (luôn hiện, không bị collapse)
 → tool.execute(id, params, signal): askUser(id, questions, signal)
       → parkQuestionRequest(id) → await   (loop DỪNG)
 ◄── user submit → store.answerQuestion(sid, stepId, answers)
            → RPC sessions.answerQuestion({ requestId, answers })
            → resolveQuestionRequest(requestId, answers)   (UNPARK)
 → tool.execute trả content = đáp án (text) + details:{questions,answers}  → loop TIẾP cùng lượt
 → event-adapter (tool_execution_end): stepFromQuestion(toolCallId, questions, answers, status:'done')  → step thành bản ghi
```

`toolCallId` = `stepId` = `requestId` → một khoá chung, không sinh id riêng.

## Schema (model gọi)

```ts
AskUserQuestion({
  questions: [{
    header: string,            // chip ngắn ≤ ~12 ký tự
    question: string,
    options: [{ label: string, description?: string }],  // 2–4
    multiSelect: boolean,
  }],                          // 1–4 câu
})
```

Validate fail-fast trong `execute()` (1–4 câu, mỗi câu 2–4 option, label/header không rỗng) → trả lỗi dạng text cho model tự sửa, không crash. UI luôn thêm lựa chọn **"Other"** (free-text) cho mỗi câu.

## Nhánh Claude SDK (2026-09-09)

Từ [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md), session `provider === 'anthropic'` chạy `runtime/claude-sdk/run-stream.ts` — và ở đó **không có gì của phần trên chạy cả**: `args.askUserQuestion` bị bỏ qua, nên từ 2026-08-27 tới 2026-09-09 người dùng tài khoản Anthropic **không bao giờ thấy thẻ câu hỏi** (session cuối cùng có step `kind:'question'` là 2026-07-15).

Cách vá **không** phải bắc cầu một tool AWOG sang SDK: `AskUserQuestion` là **tool builtin của CLI**, AWOG chỉ cần trả lời nó. Ba dữ kiện đo trên `claude-agent-sdk` 0.3.260 quyết định cách nối:

1. Tool khai `requiresUserInteraction()`. Trong hàm quyết định quyền của CLI, nhánh này trả `ask` **trước** nhánh rẽ `bypassPermissions` — nên câu hỏi vẫn tới host dù AWOG chạy SDK ở `bypassPermissions` với gate riêng trên PreToolUse hook.
2. `isEnabled()` của tool đòi có bề mặt hỏi quyền khi CLI chạy non-interactive, mà SDK **chỉ** truyền `--permission-prompt-tool stdio` khi caller có `canUseTool`. Không có `canUseTool` ⇒ tool **không được quảng cáo**, model không thấy để gọi. Đây chính là nguyên nhân gốc (đo được: cùng một `query()`, bỏ `canUseTool` thì `AskUserQuestion` vắng mặt trong danh sách tool của message `init`, thêm vào thì có).
3. Câu hỏi đi trên **kênh permission**, không phải kênh tool: `checkPermissions` đưa host `{ questions }`, còn `call()` của tool đọc `answers` ngược lại từ chính input (đã cập nhật), **khoá theo NỘI DUNG CÂU HỎI** chứ không phải header; multi-select nối bằng `", "` (label chứa `", "` hoặc dấu nháy thì JSON-quote).

Round-trip vì thế là:

```
model gọi AskUserQuestion({questions})
 → event-adapter (tool_use): stepFromQuestion(block.id, input.questions)   ─────► UI: thẻ câu hỏi (dùng chung SessionGateCard)
 → CLI: checkPermissions → 'ask' (requiresUserInteraction) → can_use_tool control request
 → canUseTool: makeAskUserQuestionGate → askUser(toolUseID, questions) → PARK (sessions/questions.ts — CÙNG park của nhánh Pi)
 ◄── user submit → sessions.answerQuestion → resolveQuestionRequest
 → gate trả { behavior:'allow', updatedInput:{ ...input, answers } }  → tool call() đọc answers → loop TIẾP cùng lượt
 → CLI tự soạn tool_result ("Your questions have been answered: …") → event-adapter BỎ QUA (thẻ đã có), không đè thành row tool thường
```

`toolUseID` = step id = requestId, y hệt nhánh Pi. Park, RPC `sessions.answerQuestion` và `SessionGateCard.vue` dùng chung — **chỉ khác đường truyền**.

**File chạm (nhánh SDK)**
- `runtime/claude-sdk/ask-user-question.ts` *(mới)* — `makeAskUserQuestionGate(askUser, cb)` + encode `answers` đúng cách CLI decode.
- `runtime/claude-sdk/run-stream.ts` — PreToolUse hook **bỏ qua** `AskUserQuestion` (hook quyết định = nuốt mất câu hỏi), và `options.canUseTool` khi session có `askUserQuestion`.
- `runtime/claude-sdk/event-adapter.ts` — `tool_use` → thẻ câu hỏi; `tool_result` thành công → bỏ qua.

**Quyết định phụ**
- **Không** bật `toolConfig.askUserQuestion.previewFormat: 'html'`. Nó bảo model sinh HTML cho `preview` của từng lựa chọn; thẻ hiện tại không render preview, mà render được thì là nhét HTML của model vào GUI — đúng surface XSS mà invariant #Sink cấm. Giữ mặc định markdown, `parseQuestions` bỏ `preview`.
- **Tasks / subagent headless**: `askUserQuestion` không được truyền ⇒ không có `canUseTool` ⇒ tool tắt hẳn ở đó (sạch hơn nhánh Pi, nơi tool vẫn tồn tại và trả no-op).
- Hook bỏ qua tool này ⇒ **câu hỏi không tính vào ngân sách tool/lượt** và **deny rule theo tên tool không được hỏi tới**. Chấp nhận: tool read-only, tác dụng duy nhất là đứng chờ user; công tắc tắt thật vẫn còn vì `disabledTools` đi tới CLI dưới dạng `disallowedTools` và gỡ hẳn tool.
- SDK in cảnh báo `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` mỗi lượt ("canUseTool will not be invoked: permissionMode 'bypassPermissions'…"). **Đúng và vô hại**: mọi tool khác đã bị hook quyết định trước; chỉ tool `requiresUserInteraction` mới rơi xuống callback này.

## Dạng câu hỏi mở rộng (2026-09-09)

CLI có **hai** schema cho tool này, chọn bằng cờ khởi động `extendedQuestions` (SDK dịch `toolConfig.askUserQuestion.extendedQuestions` thành env `CLAUDE_CODE_QUESTION_EXTENDED=1`; `ToolConfig` trong `sdk.d.ts` 0.3.260 chưa khai field đó nên AWOG đặt thẳng biến môi trường — `QUESTION_ENV` trong [ask-user-question.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/ask-user-question.ts), cùng lối `ARTIFACT_ENV`). Cờ chỉ đi kèm phiên chat, vì tool chỉ tồn tại khi có `canUseTool`.

Bản mở rộng thêm, so với bản cơ bản (`question` · `header` · `options[2–4]` · `multiSelect`):

| Field | Nghĩa |
|---|---|
| `title` | Tiêu đề một dòng cho cả lời gọi, trên mọi câu hỏi |
| `kind: 'choice' \| 'text' \| 'number'` | Vắng ⇒ `choice`. `text` = ô nhập tự do (không option), `number` = thanh trượt |
| `description` | Một dòng gợi ý dưới câu hỏi |
| `placeholder` | `text` only |
| `min` / `max` / `step` / `defaultValue` / `unit` | `number` only (min < max bắt buộc) |

Phía đáp án (đã có sẵn ở cả hai bản): `answers` (khoá = **nội dung câu hỏi**), `annotations[câu hỏi].{notes, preview}`, `response` (chữ tự do), `followUp`, `afkTimeoutMs`.

### ⚠ Thứ tự ưu tiên khi CLI soạn `tool_result` — đo bằng probe, không suy đoán

```
afkTimeoutMs  →  followUp (in đáp án + "They also wrote")  →  response  →  đáp án
```

`response` khi **không** có `followUp` **THAY THẾ** toàn bộ đáp án: gửi kèm cả hai thì model chỉ đọc được câu ghi chú, mọi lựa chọn biến mất (đo được: gửi 2 đáp án + response ⇒ `tool_result` = `"The user responded: …"`). Vì vậy chữ tự do của người dùng đi hai đường khác nhau:

- **Còn đáp án** (và không xin hỏi thêm) ⇒ `annotations[câu-hỏi-đầu].notes` — CLI in kèm ngay sau đáp án (`"Q"="A" notes: …`).
- **Không đáp án nào** ("Bạn tự quyết đi") hoặc **có `followUp`** ⇒ `response`, vì lúc đó nó CHÍNH LÀ câu trả lời.

### Ba lối kết thúc trong UI

| Nút | Gửi gì | Model nhận |
|---|---|---|
| **Gửi** | `answers` (+ `annotations.notes` nếu có ghi chú) | đáp án đầy đủ |
| **Hỏi tôi thêm vòng nữa** | phần đã trả lời + `followUp: true` (+ `response`) | CLI yêu cầu gọi `AskUserQuestion` lần nữa, **chưa** được bắt tay vào việc |
| **Bạn tự quyết đi** | `answers: {}` + `response` = ghi chú của user (nếu có) + câu "Decide for me — use your best judgment and continue." | "The user responded: …" |

Vì một lời đáp hợp lệ **có thể không chứa đáp án nào**, block câu hỏi ở UI mang thêm cờ `done` (`SessionStep.status === 'done'`, và set ngay khi bấm) — thiếu nó thì `questionAnswered()` mãi false, ngăn kéo không đóng và phiên kẹt ở `awaiting`.

**File chạm (UI)**: [SessionQuestionForm.vue](../../apps/desktop/ui-next/components/session/SessionQuestionForm.vue) *(mới — tách khỏi `SessionGateCard`, nay thẻ gate chỉ uỷ quyền)*, [SessionQuestionDrawer.vue](../../apps/desktop/ui-next/components/session/SessionQuestionDrawer.vue) (ngăn kéo trên composer), `stores/sessions.ts` (`answerQuestion(…, { response, followUp })`), `sessions.answerQuestion` RPC (zod cho 2 field mới).

**Nhánh Pi vẫn ở bản cơ bản**: schema tool AWOG tự viết chưa có `kind/title/description`, nên tài khoản OpenAI/Google chỉ có câu hỏi trắc nghiệm. Đáp án thì đã dùng chung `SessionQuestionReply` (answers + response + followUp), nên khi mở rộng schema bên đó chỉ phải sửa đúng phần input.

## Kiểu dữ liệu

```ts
// sidecar types/shared.ts (mirror ở ui/types/index.ts)
interface SessionQuestionOption { label: string; description?: string }
interface SessionQuestion { header: string; question: string; options: SessionQuestionOption[]; multiSelect: boolean }
interface SessionQuestionAnswer { header: string; selected: string[] }  // label đã chọn / text "Other"

// SessionStep mở rộng
kind: ... | 'question'
questions?: SessionQuestion[]
answers?: SessionQuestionAnswer[]   // có khi đã trả lời (status 'done')
```

## File chạm

**Sidecar**
- `types/shared.ts` — thêm 3 type + mở rộng `SessionStep`.
- `runtime/permission-types.ts` — type `AskUserQuestionFn`.
- `sessions/questions.ts` *(mới)* — park store (mirror `permissions.ts`): `parkQuestionRequest` / `resolveQuestionRequest` / `rejectQuestionRequest`.
- `runtime/tools/ask-user-question-tool.ts` *(mới)* — `createAskUserQuestionTool(askUser?)`; có handler = interactive, không có = graceful.
- `runtime/tools/index.ts` — thread `askUser` qua `createAwogToolDefinitions` / `createRuntimeToolDefinitions` (chỉ chat top-level truyền).
- `runtime/run-stream.ts` — truyền `args.askUserQuestion`.
- `sessions/runner.ts` — `RunNonStreamArgs.askUserQuestion`.
- `runtime/event-adapter.ts` — handle start/end cho `AskUserQuestion`.
- `sessions/step-mapper.ts` — `stepFromQuestion(...)` + map tên tool.
- `methods/sessions.send-message.ts` — build `askUser` closure, reject khi abort.
- `methods/sessions.answer-question.ts` *(mới)* + đăng ký ở `index.ts` — RPC zod-validate payload (L1).

**UI**
- `types/index.ts` — mirror 3 type + field `SessionStep`.
- `utils/step-context.ts` — inject key `ANSWER_QUESTION_KEY`.
- `stores/sessions.ts` — action `answerQuestion` (optimistic + RPC); `session.step` đã upsert sẵn (không cần listener mới).
- `components/session/SessionQuestionCard.vue` *(mới)* — card: tab theo câu, radio/checkbox, "Other", "Submit"; pending → tương tác, done → read-only.
- `components/session/SessionMessageItem.vue` — render card (luôn hiện như `SessionInlinePermission`); loại question step khỏi cluster timeline.
- `components/session/SessionMessageList.vue` — `provide(ANSWER_QUESTION_KEY)`.
- `i18n/en.json` + `i18n/vi.json`.

## Bảo mật (8 invariant)

- `answers` là **input L1** từ UI → zod-validate ở RPC (mảng `{header, selected: string[]}`, giới hạn độ dài). Đáp án đi vào context model dưới dạng text thuần (chính input của user cho model của họ) — OK.
- Tool không chạm fs/path/network/key → không mở surface mới.

## Edge case / giới hạn

- **Abort giữa câu hỏi:** `send-message` onAbort gọi `rejectQuestionRequest` → tool trả "canceled" → loop unwind. (Cùng pattern reject permission khi cancel.)
- **Restart-safe:** park là in-memory (giống permission). Sidecar restart lúc đang hỏi → step persisted vẫn `running` nhưng không trả lời được nữa (loop đã mất). Chấp nhận cho MVP.
- **Visibility:** card render **ngoài** cluster timeline (không bị ẩn khi user collapse steps) — bắt buộc vì phải trả lời mới mở khoá loop.
