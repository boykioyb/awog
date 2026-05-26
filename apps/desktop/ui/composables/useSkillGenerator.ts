import type { Skill, SkillCategory } from '~/types'
import { STOP_WORDS } from '~/utils/stop-words'

export type SkillDraft = Omit<Skill, 'id'>

const CATEGORY_KEYWORDS: Record<SkillCategory, string[]> = {
  Analysis: ['analy', 'research', 'investigat', 'explor', 'audit', 'review'],
  Design: ['design', 'architect', 'plan', 'spec', 'wireframe', 'ux', 'ui'],
  Development: ['implement', 'build', 'code', 'develop', 'refactor', 'fix', 'scaffold'],
  Quality: ['test', 'qa', 'verif', 'lint', 'check', 'valid'],
}

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
  const m = prompt.match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.slice(0, 140)
}

const mockGenerate = (prompt: string): SkillDraft => ({
  name: slugifyName(prompt),
  category: inferCategory(prompt),
  description: firstSentence(prompt),
  inputs: ['context'],
  outputs: ['output.md'],
  promptTemplate: prompt,
  tags: extractTags(prompt),
})

export const useSkillGenerator = () => useMockGenerator<SkillDraft>({ generate: mockGenerate })
