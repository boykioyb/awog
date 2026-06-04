// What's New — flags unseen releases in the NavRail and owns the modal open
// state. The changelog content is a static bundled file (`utils/changelog.ts`);
// this composable only tracks which version the user has already viewed,
// persisted in localStorage (same lightweight pattern as `useAppearance`).
// Shared state lives in `useState` so the NavRail button and the modal stay in
// sync without prop threading.

import { CHANGELOG, CURRENT_VERSION } from '~/utils/changelog'

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

export const useWhatsNew = () => {
  const open = useState<boolean>('whatsnew:open', () => false)
  const lastSeen = useState<string | null>('whatsnew:last-seen', () => readLastSeen())

  // First launch (no stored version) still flags as unseen so users discover
  // the panel; CURRENT_VERSION is empty-string-safe via the changelog fallback.
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
