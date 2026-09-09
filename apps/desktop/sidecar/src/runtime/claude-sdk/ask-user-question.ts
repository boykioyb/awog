// AskUserQuestion on the Claude SDK path — the CLI's OWN tool, answered by AWOG.
//
// Unlike the Pi path (runtime/tools/ask-user-question-tool.ts, an AWOG AgentTool)
// nothing is injected here: `AskUserQuestion` is a first-party CLI tool. Three facts
// about it (measured on claude-agent-sdk 0.3.260) shape the wiring below.
//
//  1. It declares `requiresUserInteraction()`, and the CLI's permission decision
//     returns `ask` for such a tool BEFORE the bypassPermissions short-circuit — so
//     the question reaches the host even though AWOG runs the SDK in
//     bypassPermissions with its own gate on a PreToolUse hook (ADR 0058 P4).
//  2. Its `isEnabled()` requires a permission-prompt surface whenever the CLI runs
//     non-interactively, and the SDK only passes `--permission-prompt-tool stdio`
//     when the caller supplies `canUseTool`. Without the gate below the tool is not
//     advertised AT ALL — which is why an Anthropic session never showed a question
//     card while the Pi path had them since July.
//  3. The question rides the permission channel, not a tool channel:
//     `checkPermissions` hands the host `{ questions }` and the tool's `call()`
//     reads `answers` back off its (updated) input, keyed by QUESTION TEXT, with
//     multi-select values joined the way `formatSelected` below reproduces.
//
// So the round trip is: canUseTool → the same `kind:'question'` step the Pi path
// emits → park on the SAME sessions/questions.ts promise that the
// sessions.answerQuestion RPC resolves → hand the answers back as `updatedInput`.
// The card (SessionGateCard.vue), the park and the RPC are shared with Pi; only the
// transport differs. See docs/features/ask-user-question.md.

import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'

import { stepFromQuestion } from '../../sessions/step-mapper.js'
import type { StreamCallbacks } from '../../sessions/runner.js'
import type {
  SessionQuestion,
  SessionQuestionAnswer,
  SessionQuestionReply,
} from '../../types/shared.js'
import { log } from '../../util/logger.js'
import type { AskUserQuestionFn } from '../permission-types.js'

export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

// Bật SCHEMA MỞ RỘNG của tool: `title` cho cả lời gọi, `kind: 'text' | 'number'`
// (ô nhập / thanh trượt) bên cạnh 'choice', `description` một dòng dưới câu hỏi,
// `placeholder`, và `min/max/step/defaultValue/unit` cho câu hỏi số.
//
// CLI đọc cờ này từ MÔI TRƯỜNG; `toolConfig.askUserQuestion.extendedQuestions` của
// SDK cũng chỉ dịch thành đúng biến này (sdk.mjs), mà `ToolConfig` trong sdk.d.ts
// bản 0.3.260 chưa khai field đó — nên đặt thẳng biến, cùng lối với ARTIFACT_ENV.
// Chỉ đi kèm nhánh chat: task/subagent không có gate nên tool tắt hẳn ở đó.
export const QUESTION_ENV = { CLAUDE_CODE_QUESTION_EXTENDED: '1' } as const

// Encode one question's picked option(s) the way the CLI decodes them: labels joined
// with ", ", JSON-quoting a label that itself contains ", " or a quote. Matching its
// encoder is what makes a multi-select answer read back to the model as the options
// the user actually picked instead of as one opaque string.
function formatSelected(selected: string[]): string {
  return selected
    .map((label) => (label.includes(', ') || label.includes('"') ? JSON.stringify(label) : label))
    .join(', ')
}

// `answers` is keyed by question TEXT (the tool's call() looks it up by that), while
// AWOG keys an answer by its question's header — so join the two here. A question the
// user skipped is simply absent, which the CLI renders as "(no option selected)".
function toSdkAnswers(
  questions: SessionQuestion[],
  answers: SessionQuestionAnswer[],
): Record<string, string> {
  const selectedByHeader = new Map(answers.map((a) => [a.header, a.selected]))
  const out: Record<string, string> = {}
  for (const q of questions) {
    const selected = selectedByHeader.get(q.header)
    if (!selected || selected.length === 0) continue
    // 'text'/'number' mang ĐÚNG MỘT giá trị: gửi thô. CLI kiểm câu hỏi số bằng
    // `Number(value)` trong min..max, nên nối ", " hay bọc nháy là hỏng ngay.
    const kind = q.kind ?? 'choice'
    out[q.question] = kind === 'choice' ? formatSelected(selected) : (selected[0] ?? '')
  }
  return out
}

// Supplied as `options.canUseTool`. Two jobs, in this order of importance: existing
// at all (fact 2 above — it is what switches the tool on), and answering the question
// when one arrives. Interactive sessions only: tasks/subagents leave `askUser`
// undefined upstream, so the tool stays off there rather than parking on nobody.
export function makeAskUserQuestionGate(
  askUser: AskUserQuestionFn,
  cb: StreamCallbacks,
): CanUseTool {
  return async (toolName, input, opts) => {
    // Anything else already passed AWOG's gate in the PreToolUse hook — and under
    // bypassPermissions the CLI answers it before consulting this callback. Allowing
    // decides nothing; it just keeps a surprise arrival from stalling the turn.
    if (toolName !== ASK_USER_QUESTION_TOOL) return { behavior: 'allow', updatedInput: input }

    const requestId = opts.toolUseID
    const raw = (input as { questions?: unknown }).questions
    // step-mapper normalizes the CLI's question shape into AWOG's (and drops what the
    // card cannot render, e.g. option previews). Nothing usable left ⇒ the call was
    // malformed: deny with a sentence the model can correct, rather than park the
    // turn on an empty card.
    const title = (input as { title?: unknown }).title
    const running = stepFromQuestion(requestId, raw, undefined, 'running', { title })
    const questions = running.questions ?? []
    if (questions.length === 0) {
      return {
        behavior: 'deny',
        message:
          'Malformed AskUserQuestion call: each question needs a header, the question text and 2–4 options with non-empty labels.',
      }
    }

    // The event adapter already emitted this step from the tool_use block; emitting it
    // again is an upsert on the same id and makes the card independent of which of the
    // two arrives first.
    cb.onStep?.(running)
    const reply: SessionQuestionReply = await askUser(requestId, questions, opts.signal)
    cb.onStep?.(
      stepFromQuestion(requestId, raw, reply.answers, 'done', {
        title,
        ...(reply.response ? { response: reply.response } : {}),
      }),
    )
    log.info('claude-sdk: AskUserQuestion answered', {
      toolUseId: requestId,
      questions: questions.length,
      answered: reply.answers.length,
      hasResponse: !!reply.response,
      followUp: !!reply.followUp,
    })
    // An aborted turn resolves the park with NO answers (sessions/questions.ts) — the
    // CLI turns that into "The user did not answer the questions." on its own, so an
    // empty map needs no special case here.
    // `response` và `followUp` là field ĐẦU RA của chính tool: chữ người dùng tự
    // viết thay cho (hoặc kèm) lựa chọn, và lời xin thêm một vòng câu hỏi. CLI tự
    // soạn tool_result cho cả hai — AWOG chỉ chuyển tiếp, NHƯNG phải biết thứ tự
    // ưu tiên của nó, đo được bằng probe:
    //
    //   afkTimeoutMs → followUp (đáp án + "They also wrote") → response → đáp án
    //
    // Nghĩa là `response` khi KHÔNG có followUp sẽ THAY THẾ toàn bộ đáp án: gửi cả
    // hai thì model chỉ đọc được câu ghi chú và mọi lựa chọn biến mất. Nên chữ tự do
    // đi đường nào là tuỳ ngữ cảnh: còn đáp án thì nó là `annotations.notes` (CLI in
    // kèm từng đáp án), không còn đáp án nào — "bạn tự quyết đi" — thì nó CHÍNH LÀ
    // câu trả lời và đi bằng `response`.
    const answers = toSdkAnswers(questions, reply.answers)
    const hasAnswers = Object.keys(answers).length > 0
    const asResponse = !!reply.response && (!hasAnswers || reply.followUp === true)
    const asNotes = !!reply.response && !asResponse
    const firstAnswered = questions.find((q) => answers[q.question] !== undefined)
    return {
      behavior: 'allow',
      updatedInput: {
        ...input,
        answers,
        ...(asResponse ? { response: reply.response } : {}),
        ...(asNotes && firstAnswered
          ? { annotations: { [firstAnswered.question]: { notes: reply.response } } }
          : {}),
        ...(reply.followUp ? { followUp: true } : {}),
      },
    }
  }
}
