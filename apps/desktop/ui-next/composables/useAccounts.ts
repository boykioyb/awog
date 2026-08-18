// Real LLM accounts for the Sessions config surface. DERIVED from the settings
// store's provider buckets — stores/settings.ts owns the `accounts.list` round-trip
// and keeps those buckets current on every connect/remove/update/set-active — and
// flattened into a single reactive list the composer + config popover bind to.
// Deriving instead of keeping a private module cache is what makes a freshly
// connected account appear in the session chips immediately; the previous
// module-level cache was written once per process, so a new account only showed up
// after an app restart. Each account carries its REAL sidecar id (used for engine
// settings.accountId) alongside a display string ("label · Provider"). With no
// Electron bridge the list is simply EMPTY — never a sample account, which the UI
// would present as one of the user's own connections. SoC: orchestrates IPC only.
import { computed } from 'vue'
import {
  PROVIDER_DISPLAY,
  modelDisplayName,
  modelsForProvider,
  type Provider,
} from './useSessionsData'
import { useSidecar } from './useSidecar'
import { useSettingsStore, type ProviderConfig, type ProviderName } from '~/stores/settings'

// A flattened, UI-ready account across all providers.
export type AccountOption = {
  id: string
  label: string
  provider: Provider
  providerDisplay: string
  // "label · Provider" — what the chips/lists render.
  display: string
  // Engine modelIds the account exposes (when the sidecar reports them). Honoured
  // for CUSTOM endpoints + ChatGPT subscriptions — every other built-in account
  // shares one per-provider catalog (see modelsForAccount), so its curated list
  // no longer restricts the picker for anthropic/openai/google.
  modelIds?: string[]
  // Custom endpoint (has its own baseURL). Such an account exposes models the
  // provider catalog doesn't know, so its `modelIds` stay authoritative.
  custom?: boolean
  // ChatGPT subscription (openai + OAuth = the Codex path). Its usable model set
  // is subscription-gated, i.e. a subset of the pay-as-you-go openai catalog, so
  // like a custom endpoint it keeps its own `modelIds` — that list is what the
  // connection editor curates (Settings → Connections → Edit).
  codex?: boolean
  // True when this is the active account of its provider bucket (sidecar
  // `activeAccountId`). Drives the default pick for a NEW session so it honours
  // the user's "Set active" choice instead of the first account in the bucket —
  // which may be a custom endpoint that merely shares the provider's protocol.
  isActive?: boolean
}

// Provider iteration order (matches the sidecar bucket order).
const PROVIDER_ORDER = ['anthropic', 'openai', 'google'] as const satisfies readonly ProviderName[]

function flatten(providers: Record<ProviderName, ProviderConfig>): AccountOption[] {
  const out: AccountOption[] = []
  for (const key of PROVIDER_ORDER) {
    const bucket = providers[key]
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
      if (a.baseURL) opt.custom = true
      if (key === 'openai' && a.authMode === 'oauth') opt.codex = true
      if (a.id === bucket.activeAccountId) opt.isActive = true
      out.push(opt)
    }
  }
  return out
}

export function useAccounts() {
  const sc = useSidecar()
  const settings = useSettingsStore()

  // Fire-and-forget: the store dedups concurrent hydrations and merges
  // idempotently, so every call site can ask without coordinating.
  if (sc.available) void settings.hydrateFromSidecar()

  // The store IS the truth — including "no accounts yet" on a fresh install, which
  // surfaces as an explicit "no connection" state rather than a stand-in account.
  const accounts = computed<AccountOption[]>(() => flatten(settings.providers))

  const accountById = (id: string): AccountOption | undefined =>
    accounts.value.find((a) => a.id === id)
  const accountByDisplay = (display: string): AccountOption | undefined =>
    accounts.value.find((a) => a.display === display)

  // Models for an account. Models belong to the PROVIDER, not the account: every
  // built-in account of a provider shares one per-provider catalog. Two kinds keep
  // their curated `modelIds` because the provider catalog can't represent them —
  // a CUSTOM endpoint (its own baseURL, models the catalog doesn't know) and a
  // ChatGPT subscription (a subscription-gated subset). Those two are exactly the
  // kinds whose list the connection editor lets the user curate, so the picker and
  // the editor stay in agreement.
  const modelsForAccount = (account: AccountOption | undefined): string[] => {
    if ((account?.custom || account?.codex) && account.modelIds?.length) {
      return account.modelIds.map((id) => modelDisplayName(id))
    }
    return modelsForProvider(account?.provider ?? 'Anthropic')
  }

  return { accounts, accountById, accountByDisplay, modelsForAccount }
}
