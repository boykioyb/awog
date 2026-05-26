import type { Workflow } from '~/types'
import { STOP_WORDS } from '~/utils/stop-words'

export type WorkflowDraft = Pick<Workflow, 'name' | 'description'>

const titleize = (prompt: string): string => {
  const firstLine = prompt.split('\n')[0] ?? ''
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 5)
  return words.length
    ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
    : 'New Workflow'
}

const firstSentence = (prompt: string): string => {
  const m = prompt.match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.slice(0, 140)
}

const mockGenerate = (prompt: string): WorkflowDraft => ({
  name: titleize(prompt),
  description: firstSentence(prompt),
})

export const useWorkflowGenerator = () =>
  useMockGenerator<WorkflowDraft>({ generate: mockGenerate })
