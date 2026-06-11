# Feature: AskUserQuestion (hỏi người dùng trắc nghiệm giữa lượt)

> Trạng thái: **Implemented** · Liên quan: [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) (Pi runtime), [ADR 0030](../decisions/0030-subagent-task-tool.md) (graceful tool fallback), plan-mode flow (`ExitPlanMode`).

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
