import { reactive } from 'vue'

// App-wide imperative text prompt (mirrors useConfirm's singleton). A single
// TextPromptHost mounted in the layout reads this state, so any call site can do
// `const name = await prompt({ title, value }); if (name) …` without prop-drilling.
// Opening a second prompt while one is pending cancels the first (resolves null).
export type TextPromptOptions = {
  title: string
  value?: string
  placeholder?: string
  submitLabel?: string
}

type TextPromptState = {
  open: boolean
  title: string
  value: string
  placeholder: string
  submitLabel: string
}

const state = reactive<TextPromptState>({
  open: false,
  title: '',
  value: '',
  placeholder: '',
  submitLabel: '',
})

let resolver: ((value: string | null) => void) | null = null

export function useTextPrompt() {
  function prompt(opts: TextPromptOptions): Promise<string | null> {
    if (resolver) {
      resolver(null)
      resolver = null
    }
    state.title = opts.title
    state.value = opts.value ?? ''
    state.placeholder = opts.placeholder ?? ''
    state.submitLabel = opts.submitLabel ?? ''
    state.open = true
    return new Promise<string | null>((res) => {
      resolver = res
    })
  }

  // Called by the host on submit (string) / cancel (null). Settles once.
  function settle(value: string | null) {
    if (!state.open) return
    state.open = false
    const r = resolver
    resolver = null
    r?.(value)
  }

  return { state, prompt, settle }
}
