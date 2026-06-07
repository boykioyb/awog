// Agent draft generator. Tries the real LLM via the sidecar
// (`agents.generate` → claude-agent-sdk one-shot call); falls back to a local
// slug-based mock when no sidecar or no active account is available (browser
// dev mode, or before the user has connected an Anthropic account).

import type { Ref } from 'vue'
import type { Agent } from '~/types'
import { STOP_WORDS } from '~/utils/stop-words'

export type AgentDraft = Omit<Agent, 'id'> & { id?: string }

interface AgentGenerator {
  generate: (prompt: string) => Promise<AgentDraft | null>
  // Revise an existing agent: LLM is given the current agent as context plus
  // the user's edit instruction. Mock fallback: tweaks systemPrompt by
  // appending the edit prompt so the UX is still usable offline.
  edit: (prompt: string, current: Agent) => Promise<AgentDraft | null>
  isGenerating: Ref<boolean>
  error: Ref<string | null>
}

interface GenerateResponse {
  agent: {
    id: string
    name: string
    description: string
    model: string
    systemPrompt: string
    role: string
  }
}

const slugifyName = (prompt: string): string => {
  const firstLine = prompt.split('\n')[0] ?? ''
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 4)
  return words.length ? words.join('-') : 'new-agent'
}

const firstSentence = (prompt: string): string => {
  const m = prompt.match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.slice(0, 140)
}

// Local fallback when no LLM is reachable. Slugifies the prompt and drops the
// raw text into systemPrompt.
const mockDraft = (prompt: string): AgentDraft => ({
  id: slugifyName(prompt),
  source: 'global',
  name: slugifyName(prompt)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase()),
  description: firstSentence(prompt),
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: prompt,
  role: '',
})

export const useAgentGenerator = (): AgentGenerator => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)
  const sidecar = useSidecar()
  const settings = useSettingsStore()

  const generate = async (prompt: string): Promise<AgentDraft | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Prompt cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    try {
      const account = settings.activeAccount('anthropic')
      if (!sidecar.available || !account) {
        await new Promise<void>((r) => {
          setTimeout(r, 350)
        })
        return mockDraft(trimmed)
      }
      try {
        const res = await sidecar.request<GenerateResponse>('agents.generate', {
          prompt: trimmed,
          accountId: account.id,
        })
        return {
          id: res.agent.id,
          source: 'global',
          name: res.agent.name,
          description: res.agent.description,
          provider: 'anthropic',
          model: res.agent.model,
          systemPrompt: res.agent.systemPrompt,
          role: res.agent.role,
        }
      } catch (err) {
        console.warn('[agents] LLM generate failed, falling back to mock', err)
        error.value = err instanceof Error ? err.message : String(err)
        return mockDraft(trimmed)
      }
    } finally {
      isGenerating.value = false
    }
  }

  const edit = async (prompt: string, current: Agent): Promise<AgentDraft | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Edit instruction cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    // Strip source/projectId — those are storage metadata, not content the LLM
    // should reason about.
    const currentAgentPayload = {
      id: current.id,
      name: current.name,
      description: current.description,
      model: current.model,
      systemPrompt: current.systemPrompt,
      role: current.role,
    }
    try {
      const account = settings.activeAccount('anthropic')
      if (!sidecar.available || !account) {
        await new Promise<void>((r) => {
          setTimeout(r, 350)
        })
        return {
          ...current,
          systemPrompt: `${current.systemPrompt}\n\n<!-- Edit requested: ${trimmed} -->`,
        }
      }
      try {
        const res = await sidecar.request<GenerateResponse>('agents.generate', {
          prompt: trimmed,
          accountId: account.id,
          currentAgent: currentAgentPayload,
        })
        return {
          id: res.agent.id,
          source: current.source,
          projectId: current.projectId,
          name: res.agent.name,
          description: res.agent.description,
          provider: current.provider,
          model: res.agent.model,
          systemPrompt: res.agent.systemPrompt,
          role: res.agent.role,
        }
      } catch (err) {
        console.warn('[agents] LLM edit failed', err)
        error.value = err instanceof Error ? err.message : String(err)
        return null
      }
    } finally {
      isGenerating.value = false
    }
  }

  return { generate, edit, isGenerating, error }
}
