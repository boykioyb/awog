import { computed } from 'vue'
import { CHANGELOG, CURRENT_VERSION } from '~/utils/changelog'

// What's New — flags unseen releases in the top bar and owns the modal open
// state. The changelog is a static bundled file (`utils/changelog.ts`); this
// composable only tracks which version the user last viewed, persisted in
// localStorage. Shared state lives in Nuxt `useState` so the top-bar button and
// the modal stay in sync. Ported from apps/desktop/ui/composables/useWhatsNew.ts.
const STORAGE_KEY = 'awog:whatsnew:last-seen-version'

const readLastSeen = (): string | null => {
  if (!import.meta.client) return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const writeLastSeen = (version: string) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(STORAGE_KEY, version)
  } catch {
    // Storage full or disabled — non-fatal, the dot just reappears next launch.
  }
}

export function useWhatsNew() {
  const open = useState<boolean>('whatsnew:open', () => false)
  const lastSeen = useState<string | null>('whatsnew:last-seen', () => readLastSeen())

  // First launch (no stored version) flags as unseen so users discover the panel.
  const hasUnseen = computed(() => lastSeen.value !== CURRENT_VERSION)

  const markAllSeen = () => {
    lastSeen.value = CURRENT_VERSION
    writeLastSeen(CURRENT_VERSION)
  }
  // Opening implies viewing — clear the dot immediately.
  const openPanel = () => {
    open.value = true
    markAllSeen()
  }
  const closePanel = () => {
    open.value = false
  }

  return { open, hasUnseen, releases: CHANGELOG, openPanel, closePanel, markAllSeen }
}
