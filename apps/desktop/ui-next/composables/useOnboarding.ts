import type { ProviderName } from '~/stores/settings'
import { useSettingsStore } from '~/stores/settings'

// First-run onboarding wizard — owns the wizard's open/step state + the
// "completed" flag persisted in localStorage. Mirrors the useWhatsNew pattern:
// localStorage helper + Nuxt `useState` so any component shares one source of
// truth. The wizard only orchestrates existing flows (account connect / project
// link / appearance); the API key never touches this state (invariant #1).
const KEY_COMPLETED = 'awog:onboarding:completed'

const readCompleted = (): boolean => {
  if (!import.meta.client) return false
  try {
    return window.localStorage.getItem(KEY_COMPLETED) === '1'
  } catch {
    return false
  }
}

const writeCompleted = (done: boolean) => {
  if (!import.meta.client) return
  try {
    if (done) window.localStorage.setItem(KEY_COMPLETED, '1')
    else window.localStorage.removeItem(KEY_COMPLETED)
  } catch {
    // Storage full/disabled — non-fatal; the wizard just re-appears next launch.
  }
}

const PROVIDERS: readonly ProviderName[] = ['anthropic', 'openai', 'google']

export function useOnboarding() {
  const wizardOpen = useState<boolean>('onboarding:wizard-open', () => false)
  const completed = useState<boolean>('onboarding:completed', () => readCompleted())
  // Wizard cursor lives here so the host stays a thin view; reset to 0 on open.
  const stepIndex = useState<number>('onboarding:step', () => 0)

  const openWizard = () => {
    stepIndex.value = 0
    wizardOpen.value = true
  }
  const closeWizard = () => {
    wizardOpen.value = false
  }
  // Mark onboarding done + close. Called on finish OR skip — either way we never
  // nag again (AC-3 / AC-8).
  const complete = () => {
    completed.value = true
    writeCompleted(true)
    wizardOpen.value = false
  }
  // Replay entry (⌘K / Settings) — clear the flag and re-open at step 0.
  const reset = () => {
    completed.value = false
    writeCompleted(false)
    openWizard()
  }

  // Decide whether to show the wizard at boot. Skip silently for users who are
  // already set up (≥1 LLM account) so upgrades never see it. Workspace path is
  // fixed to ~/.awog so it can't signal "new user" — account presence does.
  const maybeStart = async (): Promise<void> => {
    if (!import.meta.client || completed.value) return
    const settings = useSettingsStore()
    try {
      await settings.hydrateFromSidecar()
    } catch {
      // If hydration fails we can't prove they're set up — fall through to show
      // the wizard (the welcome step is harmless even when offline).
    }
    const hasAccount = PROVIDERS.some((p) => settings.providers[p].accounts.length > 0)
    if (hasAccount) {
      complete()
      return
    }
    openWizard()
  }

  return { wizardOpen, completed, stepIndex, openWizard, closeWizard, complete, reset, maybeStart }
}
