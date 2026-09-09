// MCP elicitation → thẻ câu hỏi của AWOG.
//
// Khi một MCP server cần input của người dùng (form field, hoặc mở URL để cấp
// quyền), CLI hỏi host qua callback `onElicitation`. **Không khai callback ⇒ SDK từ
// chối TỰ ĐỘNG mọi request** — nghĩa là một Source cần OAuth qua trình duyệt sẽ
// hỏng câm trên nhánh Claude SDK, đúng lúc AWOG đã có sẵn cả lớp OAuth lẫn một chỗ
// để hỏi người dùng giữa lượt.
//
// Nên: dựng lại yêu cầu đó thành đúng thẻ câu hỏi của AskUserQuestion (park chung ở
// sessions/questions.ts, thẻ chung SessionQuestionForm.vue). Schema `form` được ánh
// xạ theo kiểu field: enum → chọn một, boolean → Có/Không, number/integer → thanh
// trượt, còn lại → ô chữ. Chat-only: task chạy không người trông nên không truyền
// askUser, và ở đó request bị từ chối như cũ — có điều nay còn một dòng log nói rõ.

import type { ElicitationResult, OnElicitation } from '@anthropic-ai/claude-agent-sdk'
import { randomBytes } from 'node:crypto'

import { stepFromQuestion } from '../../sessions/step-mapper.js'
import type { StreamCallbacks } from '../../sessions/runner.js'
import type { SessionQuestion } from '../../types/shared.js'
import { log } from '../../util/logger.js'
import type { AskUserQuestionFn } from '../permission-types.js'

// Trần số field dựng thành câu hỏi. Form dài hơn thế là dấu hiệu server muốn một
// biểu mẫu thật, không phải một câu hỏi giữa lượt — lúc đó thà từ chối kèm lý do
// còn hơn ép người dùng lội qua 20 tab câu hỏi.
const MAX_FIELDS = 8

const ACCEPT_LABEL = 'Continue'
const CANCEL_LABEL = 'Cancel'

type SchemaField = {
  type?: unknown
  title?: unknown
  description?: unknown
  enum?: unknown
  minimum?: unknown
  maximum?: unknown
  default?: unknown
}

// Một field JSON Schema → một câu hỏi. Trả undefined cho field không dựng nổi.
function fieldToQuestion(name: string, raw: unknown): SessionQuestion | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const f = raw as SchemaField
  const title = typeof f.title === 'string' && f.title ? f.title : name
  const question = typeof f.description === 'string' && f.description ? f.description : title
  const base = { header: title.slice(0, 24), question, options: [], multiSelect: false }

  if (Array.isArray(f.enum) && f.enum.length >= 2) {
    return {
      ...base,
      kind: 'choice',
      options: f.enum.slice(0, 4).map((v) => ({ label: String(v) })),
    }
  }
  if (f.type === 'boolean') {
    return { ...base, kind: 'choice', options: [{ label: 'Yes' }, { label: 'No' }] }
  }
  if (f.type === 'number' || f.type === 'integer') {
    const min = typeof f.minimum === 'number' ? f.minimum : 0
    const max = typeof f.maximum === 'number' ? f.maximum : min + 100
    return {
      ...base,
      kind: 'number',
      min,
      max,
      ...(typeof f.default === 'number' ? { defaultValue: f.default } : {}),
      ...(f.type === 'integer' ? { step: 1 } : {}),
    }
  }
  return { ...base, kind: 'text' }
}

// Đáp án (mảng nhãn) → giá trị đúng kiểu của field.
type ElicitValue = string | number | boolean | string[]

function answerToValue(q: SessionQuestion, selected: string[]): ElicitValue {
  const first = selected[0] ?? ''
  if (q.kind === 'number') {
    const n = Number(first)
    return Number.isFinite(n) ? n : first
  }
  if (q.kind === 'choice' && q.options.length === 2) {
    const [yes] = q.options
    if (yes?.label === 'Yes') return first === 'Yes'
  }
  return q.multiSelect ? selected : first
}

export function makeElicitationHandler(
  askUser: AskUserQuestionFn,
  cb: StreamCallbacks,
): OnElicitation {
  return async (request, opts): Promise<ElicitationResult> => {
    // Id riêng: elicitation KHÔNG gắn với một tool call nào nên không mượn được
    // toolUseID làm khoá park/step như AskUserQuestion.
    const requestId = `elicit_${randomBytes(8).toString('hex')}`
    const server = request.serverName || 'An MCP server'
    const intro = request.message?.trim() || `${server} needs some input.`

    let questions: SessionQuestion[]
    if (request.mode === 'url' && request.url) {
      questions = [
        {
          header: 'Authorize',
          question: `${intro}\n\nOpen this link, finish there, then answer here:\n${request.url}`,
          options: [{ label: ACCEPT_LABEL, description: 'I finished in the browser.' }, { label: CANCEL_LABEL }],
          multiSelect: false,
          kind: 'choice',
        },
      ]
    } else {
      const props = (request.requestedSchema as { properties?: Record<string, unknown> } | undefined)
        ?.properties
      const entries = props && typeof props === 'object' ? Object.entries(props) : []
      if (entries.length === 0 || entries.length > MAX_FIELDS) {
        log.warn('claude-sdk: declining an elicitation AWOG cannot render', {
          server,
          fields: entries.length,
        })
        return { action: 'decline' }
      }
      questions = entries
        .map(([name, def]) => fieldToQuestion(name, def))
        .filter((q): q is SessionQuestion => q !== undefined)
      if (questions.length === 0) return { action: 'decline' }
    }

    // Thẻ hiện ra transcript y như một AskUserQuestion, kèm tên server + lời nhắn
    // của nó làm tiêu đề — người dùng phải biết AI ĐANG HỎI HỘ AI.
    cb.onStep?.(
      stepFromQuestion(requestId, questions, undefined, 'running', {
        title: `${server}: ${intro}`.slice(0, 200),
      }),
    )
    const reply = await askUser(requestId, questions, opts.signal)
    cb.onStep?.(
      stepFromQuestion(requestId, questions, reply.answers, 'done', {
        title: `${server}: ${intro}`.slice(0, 200),
        ...(reply.response ? { response: reply.response } : {}),
      }),
    )

    if (reply.answers.length === 0) return { action: 'cancel' }
    if (request.mode === 'url') {
      const picked = reply.answers[0]?.selected[0]
      return picked === ACCEPT_LABEL ? { action: 'accept' } : { action: 'decline' }
    }
    const byHeader = new Map(reply.answers.map((a) => [a.header, a.selected]))
    const content: Record<string, ElicitValue> = {}
    const props = (request.requestedSchema as { properties?: Record<string, unknown> } | undefined)
      ?.properties
    const names = props ? Object.keys(props) : []
    questions.forEach((q, i) => {
      const selected = byHeader.get(q.header)
      const name = names[i]
      if (!name || !selected || selected.length === 0) return
      content[name] = answerToValue(q, selected)
    })
    return { action: 'accept', content }
  }
}
