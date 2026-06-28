// Real LLM accounts for the Sessions config surface. Loads `accounts.list` once
// (process-cached, like useWorkspaceData) and flattens the three provider buckets
// into a single reactive list the composer + config popover bind to. Each account
// carries its REAL sidecar id (used for engine settings.accountId) alongside a
// display string ("label · Provider"). When the Electron bridge is absent
// (browser-dev) it falls back to the mock ACCOUNTS strings, synthesising an id
// from the label so the UI stays fully interactive. SoC: orchestrates IPC only.
import { computed, ref } from 'vue'
import {
  MODEL_DISPLAY,
  PROVIDER_DISPLAY,
  modelsForProvider,
  useSessionsData,
  type Provider,
} from './useSessionsData'
import { useSidecar } from './useSidecar'

// A flattened, UI-ready account across all providers.
export type AccountOption = {
  id: string
  label: string
  provider: Provider
  providerDisplay: string
  // "label · Provider" — what the chips/lists render.
  display: string
  // Engine modelIds the account exposes (when the sidecar reports them).
  modelIds?: string[]
}

// Sidecar accounts.list shapes (confirmed — apps/desktop/sidecar/src/methods/
// accounts.list.ts). We only consume id/label/models per provider bucket.
type AccountSafeDto = { id: string; label: string; models?: string[] }
type AccountsListDto = {
  providers: Record<string, { accounts: AccountSafeDto[]; activeAccountId: string | null }>
}

// Process-wide cache so every chip/popover shares one accounts.list round-trip.
let cache: AccountOption[] | null = null
let inflight: Promise<AccountOption[]> | null = null

// Provider iteration order (matches the sidecar bucket order).
const PROVIDER_ORDER = ['anthropic', 'openai', 'google'] as const

function flatten(dto: AccountsListDto): AccountOption[] {
  const out: AccountOption[] = []
  for (const key of PROVIDER_ORDER) {
    const bucket = dto.providers?.[key]
    if (!bucket?.accounts?.length) continue
    const provider = PROVIDER_DISPLAY[key] ?? 'Anthropic'
    for (const a of bucket.accounts) {
      const opt: AccountOption = {
        id: a.id,
        label: a.label,
        provider,
        providerDisplay: provider,
        display: `${a.label} · ${provider}`,
      }
      if (a.models?.length) opt.modelIds = a.models
      out.push(opt)
    }
  }
  return out
}

async function loadAccounts(): Promise<AccountOption[]> {
  const sc = useSidecar()
  if (!sc.available) return []
  if (cache) return cache
  if (!inflight) {
    inflight = sc
      .request<AccountsListDto>('accounts.list')
      .then((res) => {
        cache = flatten(res)
        return cache
      })
      .catch(() => {
        // Sidecar present but list failed — degrade to the empty list (callers
        // then fall back to the mock catalog) rather than throw.
        return []
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useAccounts() {
  const sc = useSidecar()
  const { ACCOUNTS, providerOf } = useSessionsData()

  // Mock fallback (browser-dev): synthesise an option from each seed string. The
  // label doubles as the id (no real sidecar id available off-shell).
  const mockOptions: AccountOption[] = ACCOUNTS.map((display) => {
    const provider = providerOf(display)
    const label = display.split(' · ')[0] ?? display
    return { id: label, label, provider, providerDisplay: provider, display }
  })

  const real = ref<AccountOption[]>([])
  if (sc.available) void loadAccounts().then((list) => (real.value = list))

  // When the bridge is present use the real list (may be empty until loaded, or
  // if the user has no accounts → fall back to the mock so chips still work).
  const accounts = computed<AccountOption[]>(() =>
    sc.available && real.value.length ? real.value : mockOptions,
  )

  const accountById = (id: string): AccountOption | undefined =>
    accounts.value.find((a) => a.id === id)
  const accountByDisplay = (display: string): AccountOption | undefined =>
    accounts.value.find((a) => a.display === display)

  // Models for an account: prefer its explicit engine modelIds (→ display names);
  // else the per-provider display catalog.
  const modelsForAccount = (account: AccountOption | undefined): string[] => {
    if (account?.modelIds?.length) return account.modelIds.map((id) => MODEL_DISPLAY[id] ?? id)
    return modelsForProvider(account?.provider ?? 'Anthropic')
  }

  return { accounts, accountById, accountByDisplay, modelsForAccount }
}
