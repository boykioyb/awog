// AskUserQuestion AgentTool for the Pi runtime — lets the model pause the turn
// to ask the user 1–4 multiple-choice questions, then resumes with the chosen
// answers as this call's tool result (mid-turn park, NOT a turn-terminating
// handoff). See docs/features/ask-user-question.md.
//
// Neither Pi nor craft-agents-oss implement this (Pi only knows the NAME for
// OAuth stealth-mode casing; craft blocks it). AWOG can do it because the Pi
// loop runs in-process — execute() blocks on a parked promise the same way the
// permission gate already does.
//
// Two modes from one factory:
//   askUser provided (chat session) → interactive: emit nothing here (the
//     question reaches the UI as the kind:'question' step event-adapter emits
//     from THIS call's input); call askUser, which parks until the
//     sessions.answerQuestion RPC lands, then return the answers as text.
//   askUser absent (headless task / subagent) → graceful no-op so a stray call
//     never deadlocks or yields "Tool AskUserQuestion not found" (ADR 0030).
//
// Security: read-only. Touches no fs/network/credential; the answers are the
// user's own input flowing back into their own model. Validates the question
// shape (fail fast) and returns an error result the model can correct, rather
// than throwing.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { AskUserQuestionFn } from '../permission-types.js'
import type { SessionQuestion, SessionQuestionAnswer } from '../../types/shared.js'

const MAX_QUESTIONS = 4
const MAX_OPTIONS = 4
const MIN_OPTIONS = 2

const AskUserQuestionParams = Type.Object({
  questions: Type.Array(
    Type.Object({
      header: Type.String({ description: 'A short (≤12 char) tab label for this question.' }),
      question: Type.String({ description: 'The question to ask the user.' }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ description: 'The option the user can pick.' }),
          description: Type.Optional(
            Type.String({ description: 'A short explanation of what choosing this option means.' }),
          ),
        }),
        { description: `2–${MAX_OPTIONS} options.` },
      ),
      multiSelect: Type.Boolean({ description: 'Allow selecting more than one option.' }),
    }),
    { description: `1–${MAX_QUESTIONS} questions.` },
  ),
})

interface AskUserQuestionDetails {
  questions: SessionQuestion[]
  answers: SessionQuestionAnswer[]
  // tool-error.ts: a malformed call is a failed call — it must render as an
  // error step, not as an answered question.
  isError?: boolean
}

type RawParams = {
  questions: {
    header: string
    question: string
    options: { label: string; description?: string }[]
    multiSelect: boolean
  }[]
}

// Validate the model-supplied shape past what TypeBox enforces (count bounds,
// non-empty strings). Returns an error sentence on failure, else null.
function validate(questions: RawParams['questions']): string | null {
  if (!Array.isArray(questions) || questions.length === 0) {
    return 'You must provide at least one question.'
  }
  if (questions.length > MAX_QUESTIONS) {
    return `Too many questions (${questions.length}); ask at most ${MAX_QUESTIONS} at once.`
  }
  for (const q of questions) {
    if (!q.header?.trim() || !q.question?.trim()) {
      return 'Each question needs a non-empty header and question text.'
    }
    if (!Array.isArray(q.options) || q.options.length < MIN_OPTIONS) {
      return `Question "${q.header}" needs at least ${MIN_OPTIONS} options.`
    }
    if (q.options.length > MAX_OPTIONS) {
      return `Question "${q.header}" has too many options; provide at most ${MAX_OPTIONS}.`
    }
    if (q.options.some((o) => !o.label?.trim())) {
      return `Question "${q.header}" has an option with an empty label.`
    }
  }
  return null
}

// Render the chosen answers as the tool-result text the model reads back.
function formatAnswers(questions: SessionQuestion[], answers: SessionQuestionAnswer[]): string {
  if (answers.length === 0) {
    return 'The user did not answer (the question was canceled). Proceed using your best judgment or ask again if essential.'
  }
  const byHeader = new Map(answers.map((a) => [a.header, a.selected]))
  const lines = questions.map((q) => {
    const selected = byHeader.get(q.header) ?? []
    const value = selected.length > 0 ? selected.join(', ') : '(no answer)'
    return `- ${q.question}\n  → ${value}`
  })
  return `The user answered:\n${lines.join('\n')}`
}

export function createAskUserQuestionTool(
  askUser?: AskUserQuestionFn,
): AgentTool<typeof AskUserQuestionParams, AskUserQuestionDetails> {
  return {
    name: 'AskUserQuestion',
    label: 'Ask',
    description:
      'Ask the user 1–4 multiple-choice questions and wait for their answer before continuing. Use ONLY when you genuinely need the user to decide between options you cannot resolve yourself (not for confirmation or for questions you can answer from the workspace). Each question has a short header, the question text, 2–4 options (label + optional description), and multiSelect. The user can always add a custom "Other" answer.',
    parameters: AskUserQuestionParams,
    async execute(id, params, signal): Promise<AgentToolResult<AskUserQuestionDetails>> {
      const questions = (params as RawParams).questions
      const error = validate(questions)
      if (error) {
        // AgentToolResult has no isError flag of its own, so the failure rides in
        // `details` (tool-error.ts) — the descriptive text is how the model learns
        // to correct the call, the flag is how the step renders as an error rather
        // than as an answered question.
        return {
          content: [{ type: 'text', text: `AskUserQuestion error: ${error}` }],
          details: { questions: [], answers: [], isError: true },
        }
      }

      // Headless (task / subagent): no interactive user. Don't block — return a
      // clear notice so the model proceeds instead of deadlocking.
      if (!askUser) {
        return {
          content: [
            {
              type: 'text',
              text: 'No interactive user is available in this context, so the question cannot be answered. Proceed using your best judgment, or state the assumption you are making.',
            },
          ],
          details: { questions, answers: [] },
        }
      }

      const answers = await askUser(id, questions, signal)
      return {
        content: [{ type: 'text', text: formatAnswers(questions, answers) }],
        details: { questions, answers },
      }
    },
  }
}
