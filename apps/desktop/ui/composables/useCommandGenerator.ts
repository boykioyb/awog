// Slash-command draft generator. Tries the real LLM via the sidecar
// (`commands.generate` → Pi one-shot); falls back to a local mock when no
// sidecar / no active account (browser dev or before account connect). Mirrors
// useRuleGenerator.

import type { Ref } from 'vue'
import type { Command } from '~/types'
import { STOP_WORDS } from '~/utils/stop-words'

export type CommandDraft = {
  name: string
  description: string
  argumentHint: string
  body: string
}

interface CommandGenerator {
  generate: (prompt: string) => Promise<CommandDraft | null>
  edit: (prompt: string, current: Command) => Promise<CommandDraft | null>
  isGenerating: Ref<boolean>
  error: Ref<string | null>
}

interface GenerateResponse {
  command: { name: string; description: string; argumentHint?: string; body: string }
}

const slugifyName = (prompt: string): string => {
  const words = (prompt.split('\n')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 3)
  return words.length ? words.join('-') : 'new-command'
}

export const useCommandGenerator = (): CommandGenerator => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)
  const sidecar = useSidecar()
  const settings = useSettingsStore()

  const mockDraft = (prompt: string, current: Command | null): CommandDraft =>
    current
      ? {
          name: current.name,
          description: current.description,
          argumentHint: current.argumentHint ?? '',
          body: `${current.body}\n\n<!-- Edit requested: ${prompt} -->`,
        }
      : {
          name: slugifyName(prompt),
          description: prompt.split('\n')[0]?.slice(0, 140) ?? '',
          argumentHint: '',
          body: prompt,
        }

  const run = async (
    prompt: string,
    current: Command | null,
    emptyMsg: string,
  ): Promise<CommandDraft | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = emptyMsg
      return null
    }
    isGenerating.value = true
    error.value = null
    try {
      const account = settings.activeAccount('anthropic')
      if (!sidecar.available || !account) {
        await new Promise<void>((r) => setTimeout(r, 350))
        return mockDraft(trimmed, current)
      }
      try {
        const params: Record<string, unknown> = { prompt: trimmed, accountId: account.id }
        if (current) {
          params.currentCommand = {
            name: current.name,
            description: current.description,
            argumentHint: current.argumentHint ?? '',
            body: current.body,
          }
        }
        const res = await sidecar.request<GenerateResponse>('commands.generate', params)
        return {
          name: res.command.name,
          description: res.command.description,
          argumentHint: res.command.argumentHint ?? '',
          body: res.command.body,
        }
      } catch (err) {
        console.warn('[commands] LLM generate failed, falling back to mock', err)
        error.value = err instanceof Error ? err.message : String(err)
        return mockDraft(trimmed, current)
      }
    } finally {
      isGenerating.value = false
    }
  }

  return {
    generate: (prompt) => run(prompt, null, 'Prompt cannot be empty'),
    edit: (prompt, current) => run(prompt, current, 'Edit instruction cannot be empty'),
    isGenerating,
    error,
  }
}
