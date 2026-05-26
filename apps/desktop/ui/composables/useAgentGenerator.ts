import type { Agent } from '~/types'
import { MODELS } from '~/utils/models'
import { STOP_WORDS } from '~/utils/stop-words'

export type AgentDraft = Omit<Agent, 'id'>

const ROLE_KEYWORDS: Record<string, string[]> = {
  Reviewer: ['review', 'audit', 'critique'],
  Tester: ['test', 'qa', 'verify'],
  Designer: ['design', 'wireframe', 'ux', 'ui'],
  Architect: ['architect', 'plan', 'system', 'adr'],
  Researcher: ['research', 'analy', 'investig', 'explor'],
  Developer: ['implement', 'build', 'code', 'develop', 'refactor', 'fix'],
  Writer: ['write', 'document', 'draft', 'spec', 'brief'],
}

const slugifyName = (prompt: string): string => {
  const firstLine = prompt.split('\n')[0] ?? ''
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 3)
  return words.length ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') : 'New Agent'
}

const inferRole = (prompt: string): string => {
  const lower = prompt.toLowerCase()
  const entries = Object.entries(ROLE_KEYWORDS)
  const scored = entries.map(
    ([role, kws]) =>
      [role, kws.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0)] as const,
  )
  const winner = scored.reduce((best, current) => (current[1] > best[1] ? current : best), [
    'Developer',
    0,
  ] as const)
  return winner[0]
}

const defaultModel = (): string => {
  const balanced = MODELS.find((m) => m.tier === 'Balanced')
  return balanced?.id ?? MODELS[0]?.id ?? ''
}

const mockGenerate = (prompt: string): AgentDraft => ({
  name: slugifyName(prompt),
  role: inferRole(prompt),
  model: defaultModel(),
  skillIds: [],
  context: [],
  systemPrompt: prompt,
})

export const useAgentGenerator = () => useMockGenerator<AgentDraft>({ generate: mockGenerate })
