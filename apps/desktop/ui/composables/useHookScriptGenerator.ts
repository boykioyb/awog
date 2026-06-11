// Hook SCRIPT generator — writes/revises the raw code of the file a hook runs
// (e.g. format-after-edit.sh) via `hooks.generate-script`. Falls back to a
// no-op-ish local edit when no sidecar / account.

import type { Ref } from 'vue'

interface HookScriptGenerator {
  // Returns the new script content, or null on empty prompt.
  generate: (
    prompt: string,
    opts: { command?: string; currentScript?: string },
  ) => Promise<string | null>
  isGenerating: Ref<boolean>
  error: Ref<string | null>
}

interface GenerateResponse {
  content: string
}

export const useHookScriptGenerator = (): HookScriptGenerator => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)
  const sidecar = useSidecar()
  const settings = useSettingsStore()

  const generate = async (
    prompt: string,
    opts: { command?: string; currentScript?: string },
  ): Promise<string | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Instruction cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    try {
      const account = settings.activeAccount('anthropic')
      if (!sidecar.available || !account) {
        await new Promise<void>((r) => setTimeout(r, 350))
        const base = opts.currentScript ?? ''
        return `${base}${base ? '\n' : ''}# TODO (no LLM available): ${trimmed}\n`
      }
      try {
        const params: Record<string, unknown> = { prompt: trimmed, accountId: account.id }
        if (opts.command) params.command = opts.command
        if (opts.currentScript) params.currentScript = opts.currentScript
        const res = await sidecar.request<GenerateResponse>('hooks.generate-script', params)
        return res.content
      } catch (err) {
        console.warn('[hooks] LLM script generate failed', err)
        error.value = err instanceof Error ? err.message : String(err)
        return null
      }
    } finally {
      isGenerating.value = false
    }
  }

  return { generate, isGenerating, error }
}
