// Rule draft generator. Tries the real LLM via the sidecar (`rules.generate` →
// Pi one-shot); falls back to a local mock when no sidecar / no active account
// (browser dev or before account connect). Mirrors useSkillGenerator.

import type { Ref } from 'vue'
import type { Rule } from '~/types'
import { STOP_WORDS } from '~/utils/stop-words'

export type RuleDraft = { name: string; description: string; body: string }

interface RuleGenerator {
  generate: (prompt: string) => Promise<RuleDraft | null>
  edit: (prompt: string, current: Rule) => Promise<RuleDraft | null>
  isGenerating: Ref<boolean>
  error: Ref<string | null>
}

interface GenerateResponse {
  rule: { name: string; description: string; body: string }
}

const slugifyName = (prompt: string): string => {
  const words = (prompt.split('\n')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 4)
  return words.length ? words.join(' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'New rule'
}

export const useRuleGenerator = (): RuleGenerator => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)
  const sidecar = useSidecar()
  const settings = useSettingsStore()

  const run = async (
    prompt: string,
    current: Rule | null,
    emptyMsg: string,
  ): Promise<RuleDraft | null> => {
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
        // Mock: for create, drop prompt into body; for edit, append a note.
        return current
          ? {
              name: current.name,
              description: current.description,
              body: `${current.body}\n\n<!-- Edit requested: ${trimmed} -->`,
            }
          : { name: slugifyName(trimmed), description: '', body: trimmed }
      }
      try {
        const params: Record<string, unknown> = { prompt: trimmed, accountId: account.id }
        if (current) {
          params.currentRule = {
            name: current.name,
            description: current.description,
            body: current.body,
          }
        }
        const res = await sidecar.request<GenerateResponse>('rules.generate', params)
        return { name: res.rule.name, description: res.rule.description, body: res.rule.body }
      } catch (err) {
        console.warn('[rules] LLM generate failed, falling back to mock', err)
        error.value = err instanceof Error ? err.message : String(err)
        return current
          ? {
              name: current.name,
              description: current.description,
              body: `${current.body}\n\n<!-- Edit requested: ${trimmed} -->`,
            }
          : { name: slugifyName(trimmed), description: '', body: trimmed }
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
