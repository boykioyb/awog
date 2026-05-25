import type { Skill, SkillCategory } from '~/types'

export type SkillDraft = Omit<Skill, 'id'>

const CATEGORY_KEYWORDS: Record<SkillCategory, string[]> = {
  Analysis: ['analy', 'research', 'investigat', 'explor', 'audit', 'review'],
  Design: ['design', 'architect', 'plan', 'spec', 'wireframe', 'ux', 'ui'],
  Development: ['implement', 'build', 'code', 'develop', 'refactor', 'fix', 'scaffold'],
  Quality: ['test', 'qa', 'verif', 'lint', 'check', 'valid'],
}

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

const inferCategory = (prompt: string): SkillCategory => {
  const lower = prompt.toLowerCase()
  const entries = Object.entries(CATEGORY_KEYWORDS) as [SkillCategory, string[]][]
  const scored = entries.map(
    ([cat, keywords]) =>
      [cat, keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0)] as const,
  )
  const winner = scored.reduce((best, current) => (current[1] > best[1] ? current : best), [
    'Development' as SkillCategory,
    0,
  ] as const)
  return winner[0]
}

const slugifyName = (prompt: string): string => {
  const firstLine = prompt.split('\n')[0] ?? ''
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 4)
  return words.length ? words.join('_') : 'new_skill'
}

const extractTags = (prompt: string): string[] => {
  const lower = prompt.toLowerCase()
  const words = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  const freq = words.reduce<Map<string, number>>((map, w) => {
    map.set(w, (map.get(w) ?? 0) + 1)
    return map
  }, new Map())
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w]) => w)
}

const firstSentence = (prompt: string): string => {
  const m = prompt.trim().match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.trim().slice(0, 140)
}

// NOTE: pure UI mock for now. When sidecar is wired, replace body with an IPC
// call into the engine and return the generated draft.
const mockGenerate = (prompt: string): SkillDraft => ({
  name: slugifyName(prompt),
  category: inferCategory(prompt),
  description: firstSentence(prompt),
  inputs: ['context'],
  outputs: ['output.md'],
  promptTemplate: prompt.trim(),
  tags: extractTags(prompt),
})

export const useSkillGenerator = () => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)

  const generate = async (prompt: string): Promise<SkillDraft | null> => {
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
