import type { Ref } from 'vue'

/**
 * Wraps the shared state + event handlers used by the 6 `{Entity}PromptCreator`
 * wrappers around [PromptCreatorPanel](../components/PromptCreatorPanel.vue).
 *
 * Each wrapper still owns its own `<template #preview>` (entity-specific) and
 * action buttons; this composable centralises the boilerplate:
 *  - `draft` ref + clear-on-success-save
 *  - `onSubmit(prompt)` → call generator → populate draft
 *  - `onRegenerate()` → reset draft so the prompt textarea re-enables
 *
 * @example
 *   const generator = useAgentGenerator()
 *   const { draft, isGenerating, error, onSubmit, onRegenerate } =
 *     usePromptCreator<AgentDraft>(generator)
 */
type GeneratorLike<TDraft> = {
  generate: (prompt: string) => Promise<TDraft | null>
  isGenerating: Ref<boolean>
  error: Ref<string | null>
}

export const usePromptCreator = <TDraft>(generator: GeneratorLike<TDraft>) => {
  const draft = ref<TDraft | null>(null) as Ref<TDraft | null>

  const onSubmit = async (prompt: string): Promise<void> => {
    const result = await generator.generate(prompt)
    if (result) draft.value = result
  }

  const onRegenerate = (): void => {
    draft.value = null
  }

  return {
    draft,
    isGenerating: generator.isGenerating,
    error: generator.error,
    onSubmit,
    onRegenerate,
  }
}
