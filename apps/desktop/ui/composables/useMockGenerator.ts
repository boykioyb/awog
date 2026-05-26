/**
 * Generic mock generator composable — wraps the boilerplate shared by the 6
 * entity generators (Agent / Skill / Command / Hook / Mcp / Workflow). Each
 * caller passes a pure `generate(prompt) => Draft` function; this composable
 * adds: empty-prompt guard, 400ms latency simulation, `isGenerating` flag,
 * and `error` state.
 *
 * NOTE: pure UI mock for now. When the sidecar is wired, callers may swap
 * the synchronous `generate` for an IPC call returning a Promise<Draft>.
 *
 * @example
 *   const { generate, isGenerating, error } = useMockGenerator<AgentDraft>({
 *     generate: (prompt) => ({ name: slugify(prompt), ... }),
 *   })
 */

type MockGenerateFn<T> = (prompt: string) => T

type MockGeneratorConfig<T> = {
  generate: MockGenerateFn<T>
  // Latency in ms before the draft resolves; default 400ms matches legacy UX.
  latencyMs?: number
}

const DEFAULT_LATENCY_MS = 400

export const useMockGenerator = <T>(config: MockGeneratorConfig<T>) => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)

  const generate = async (prompt: string): Promise<T | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Prompt cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    try {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, config.latencyMs ?? DEFAULT_LATENCY_MS)
      })
      return config.generate(trimmed)
    } finally {
      isGenerating.value = false
    }
  }

  return { generate, isGenerating, error }
}
