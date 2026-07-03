// Shared, cached list of gh CLI accounts (login + active flag) for the account
// pickers (project GitHub-account setting, Settings → Git). Fetched once per app
// session via gh.accounts; the refs are module-level so every caller shares one
// list. `load()` is idempotent; pass force to re-fetch after a `gh auth login`.
import { ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

export interface GhAccountInfo {
  login: string
  active: boolean
  scopes: string
}

const accounts = ref<GhAccountInfo[]>([])
const loaded = ref(false)
let inflight: Promise<void> | null = null

export function useGhAccounts() {
  const sc = useSidecar()

  const load = async (force = false): Promise<void> => {
    if (!sc.available) return
    if (!force && (loaded.value || inflight)) return inflight ?? undefined
    inflight = (async () => {
      try {
        const res = await sc.request<{ accounts: GhAccountInfo[] }>('gh.accounts', {})
        accounts.value = res.accounts
        loaded.value = true
      } catch {
        // gh missing / not authed — leave the list empty; pickers still show
        // the inherit + active rows.
        accounts.value = []
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  return { accounts, loaded, load }
}
