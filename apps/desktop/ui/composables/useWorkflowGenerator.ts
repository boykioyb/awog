import type { Workflow } from '~/types'

export type WorkflowDraft = Pick<Workflow, 'name' | 'description'>

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'with',
  'will',
  'should',
])

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
  const m = prompt.trim().match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.trim().slice(0, 140)
}

// NOTE: pure UI mock for now. Replace with sidecar IPC when engine is wired.
const mockGenerate = (prompt: string): WorkflowDraft => ({
  name: titleize(prompt),
  description: firstSentence(prompt),
})

export const useWorkflowGenerator = () => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)

  const generate = async (prompt: string): Promise<WorkflowDraft | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Prompt cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    try {
      await new Promise((resolve) => {
        setTimeout(resolve, 400)
      })
      return mockGenerate(trimmed)
    } finally {
      isGenerating.value = false
    }
  }

  return { generate, isGenerating, error }
}
