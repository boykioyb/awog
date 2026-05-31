import { defineStore } from 'pinia'
import type {
  AgentMode,
  AppearanceSettings,
  ProviderAccount,
  ProviderName,
  ThinkingLevel,
} from '~/types'
import { DEFAULT_SYSTEM_PROMPT } from '~/utils/system-prompt'

export type { ProviderAccount } from '~/types'

interface ProviderConfig {
  accounts: ProviderAccount[]
  activeAccountId: string | null
}

type ProviderRecord<T> = Record<ProviderName, T>

export interface SessionDefaults {
  systemPrompt: string
  instructions: string
  provider: ProviderName
  modelId: string
  mode: AgentMode
  thinkingLevel: ThinkingLevel
  timezone: string
}

export interface CustomProvider {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  models: string[]
}

export type CustomProviderInput = Omit<CustomProvider, 'id'>

// Git Manager — auto-commit per phase + workspace dirty policy (ADR 0017 / Git
// Manager spec M6). Persisted in localStorage alongside the rest of the
// settings shape; sidecar reads the same fields via `settings.get` when wired
// into the Task Execution Engine (deferred — engine has no phase lifecycle
// anchor today).
export type AutoCommitScope = 'workspace' | 'artifacts-only'
export type DirtyTaskPolicy = 'warn' | 'auto-stash'

export interface GitSettings {
  autoCommitPerPhase: boolean
  autoCommitMessageTemplate: string
  autoCommitScope: AutoCommitScope
  autoStashDirtyBeforeTask: boolean
  dirtyTaskPolicy: DirtyTaskPolicy
  autoFetchIntervalMs: number
  // System prompt feed vào Claude khi user click "Generate AI" trong commit
  // panel. User-editable nên team có thể chốt convention riêng (Conventional
  // Commits, Vietnamese tone, custom scopes…) mà không phải sửa code.
  commitMessageRule: string
}

export const DEFAULT_COMMIT_MESSAGE_RULE = `You write git commit messages following Conventional Commits.

Input:
- Staged diff (output of \`git diff --cached\`).
- List of staged file paths.

Output: a single commit message. NO markdown, NO code fence, NO explanation.

Format:
  <type>(<scope>): <subject>

  <body — optional, wrap at 72 cols>

Rules:
- type: feat | fix | docs | refactor | chore | test | perf | style | build | ci.
- scope: one short lowercase word, inferred from the changed paths (e.g. \`git\`, \`auth\`, \`ui\`). Omit when the change is cross-cutting.
- subject: imperative mood, English, ≤ 72 chars, no trailing period, lowercase.
- body (optional): explain the "why" and summarize the meaningful changes. Add it only when the diff is non-trivial.
- Describe only changes observable in the diff. Do not invent intent beyond the evidence.
- If the diff bundles unrelated changes, focus on the largest one and suggest splitting in the body.
`

export const DEFAULT_GIT_SETTINGS: GitSettings = {
  autoCommitPerPhase: true,
  autoCommitMessageTemplate: '[{phaseId}] {agentName}: {summary}',
  autoCommitScope: 'workspace',
  autoStashDirtyBeforeTask: false,
  dirtyTaskPolicy: 'warn',
  autoFetchIntervalMs: 0,
  commitMessageRule: DEFAULT_COMMIT_MESSAGE_RULE,
}

interface SettingsState {
  workspacePath: string
  autoApprove: boolean
  notificationsEnabled: boolean
  providers: ProviderRecord<ProviderConfig>
  customProviders: CustomProvider[]
  defaults: SessionDefaults
  appearance: AppearanceSettings
  git: GitSettings
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  sansFamily: 'system',
  monoFamily: 'jetbrains-mono',
  fontSize: 14,
  fontWeight: 400,
  accent: 'mono',
  themeColor: 'mono',
  themeColorCustom: '#a3a3a3',
  surfaceDepth: 'flat',
  locale: 'en',
}

interface AccountsListResponse {
  providers: ProviderRecord<{
    accounts: ProviderAccount[]
    activeAccountId: string | null
  }>
}

interface OAuthStartResponse {
  state: string
  authUrl: string
}

interface AccountTestResponse {
  ok: boolean
  expiresAt?: number
  error?: { code: string; message: string }
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    workspacePath: '',
    autoApprove: false,
    notificationsEnabled: true,
    providers: {
      anthropic: { accounts: [], activeAccountId: null },
      openai: { accounts: [], activeAccountId: null },
      google: { accounts: [], activeAccountId: null },
    },
    customProviders: [],
    defaults: {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      instructions: '',
      provider: 'anthropic',
      modelId: 'claude-opus-4-8',
      mode: 'ask',
      thinkingLevel: 'high',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    appearance: { ...DEFAULT_APPEARANCE },
    git: { ...DEFAULT_GIT_SETTINGS },
  }),
  getters: {
    activeAccount(state): (provider: ProviderName) => ProviderAccount | null {
      return (provider) => {
        const config = state.providers[provider]
        if (!config.activeAccountId) return null
        return config.accounts.find((a: ProviderAccount) => a.id === config.activeAccountId) ?? null
      }
    },
    isProviderConnected(): (provider: ProviderName) => boolean {
      return (provider) => {
        const account = this.activeAccount(provider)
        return !!account && account.status === 'connected'
      }
    },
    keyFingerprint(): (provider: ProviderName) => string {
      return (provider) => this.activeAccount(provider)?.fingerprint ?? ''
    },
  },
  actions: {
    async hydrateFromSidecar(): Promise<void> {
      const sidecar = useSidecar()
      try {
        const res = await sidecar.request<AccountsListResponse>('accounts.list')
        // Replace state with sidecar truth. Re-validate at boundary (L1 input).
        const next = { ...this.providers }
        ;(Object.keys(next) as ProviderName[]).forEach((p: ProviderName) => {
          const incoming = res.providers?.[p]
          if (!incoming) return
          next[p] = {
            accounts: Array.isArray(incoming.accounts) ? incoming.accounts : [],
            activeAccountId:
              typeof incoming.activeAccountId === 'string' ? incoming.activeAccountId : null,
          }
        })
        this.providers = next
      } catch (err) {
        // Sidecar unavailable in dev browser, or backend error. Keep empty state.
        // eslint-disable-next-line no-console
        console.warn('[settings] hydrateFromSidecar failed', err)
      }
    },
    async connectAnthropicOAuth(): Promise<OAuthStartResponse> {
      const sidecar = useSidecar()
      return sidecar.request<OAuthStartResponse>('auth.startOAuth', { provider: 'anthropic' })
    },
    async completeAnthropicOAuth(
      state: string,
      code: string,
      label?: string,
    ): Promise<ProviderAccount> {
      const sidecar = useSidecar()
      const account = await sidecar.request<ProviderAccount>('auth.completeOAuth', {
        state,
        code,
        label,
      })
      const config = this.providers.anthropic
      // Replace if exists (by id), else append.
      const idx = config.accounts.findIndex((a: ProviderAccount) => a.id === account.id)
      if (idx >= 0) config.accounts[idx] = account
      else config.accounts.push(account)
      if (!config.activeAccountId) config.activeAccountId = account.id
      return account
    },
    async disconnectAccount(provider: ProviderName, accountId: string): Promise<void> {
      const sidecar = useSidecar()
      await sidecar.request('accounts.remove', { provider, accountId })
      const config = this.providers[provider]
      config.accounts = config.accounts.filter((a: ProviderAccount) => a.id !== accountId)
      if (config.activeAccountId === accountId) {
        config.activeAccountId = config.accounts[0]?.id ?? null
      }
    },
    async setActiveAccount(provider: ProviderName, accountId: string | null): Promise<void> {
      const sidecar = useSidecar()
      await sidecar.request('accounts.setActive', { provider, accountId })
      const config = this.providers[provider]
      if (accountId !== null && !config.accounts.some((a: ProviderAccount) => a.id === accountId))
        return
      config.activeAccountId = accountId
    },
    async testAccount(provider: ProviderName, accountId: string): Promise<AccountTestResponse> {
      const sidecar = useSidecar()
      const result = await sidecar.request<AccountTestResponse>('accounts.test', {
        provider,
        accountId,
      })
      // Reflect test outcome locally so UI status dots update without extra round-trip.
      const account = this.providers[provider].accounts.find(
        (a: ProviderAccount) => a.id === accountId,
      )
      if (account) {
        if (result.ok) {
          account.status = 'connected'
          if (typeof result.expiresAt === 'number') account.expiresAt = result.expiresAt
        } else if (result.error?.code === 'TOKEN_EXPIRED') {
          account.status = 'expired'
        } else {
          account.status = 'disconnected'
        }
      }
      return result
    },
    addCustomProvider(input: CustomProviderInput): CustomProvider {
      const provider: CustomProvider = { ...input, id: `cp${Date.now()}` }
      this.customProviders.push(provider)
      return provider
    },
    updateCustomProvider(id: string, patch: Partial<CustomProviderInput>) {
      const idx = this.customProviders.findIndex((p: CustomProvider) => p.id === id)
      if (idx < 0) return
      this.customProviders[idx] = { ...this.customProviders[idx]!, ...patch }
    },
    removeCustomProvider(id: string) {
      this.customProviders = this.customProviders.filter((p: CustomProvider) => p.id !== id)
    },
    updateDefaults(patch: Partial<SessionDefaults>) {
      this.defaults = { ...this.defaults, ...patch }
    },
    updateAppearance(patch: Partial<AppearanceSettings>) {
      this.appearance = { ...this.appearance, ...patch }
    },
    resetAppearance() {
      this.appearance = { ...DEFAULT_APPEARANCE }
    },
    updateGit(patch: Partial<GitSettings>) {
      this.git = { ...this.git, ...patch }
    },
    resetGit() {
      this.git = { ...DEFAULT_GIT_SETTINGS }
    },
  },
})
