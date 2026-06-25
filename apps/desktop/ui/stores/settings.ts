import { defineStore } from 'pinia'
import type {
  AgentMode,
  AppearanceSettings,
  EndpointApi,
  ProviderAccount,
  ProviderName,
  ThinkingLevel,
} from '~/types'
import { DEFAULT_SYSTEM_PROMPT } from '~/utils/system-prompt'
import { DEFAULT_PASTE_THRESHOLD } from '~/utils/attachment-intake'

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
  // Wire protocol the endpoint speaks (ADR 0029 Phase C3). Drives how the base
  // URL is normalized + how the runtime talks to it.
  api: EndpointApi
  models: string[]
}

export type CustomProviderInput = Omit<CustomProvider, 'id'>

// Patch for editing an existing connection (accounts.update). All fields
// optional; the sidecar enforces which are legal per account kind. `apiKey`
// blank/omitted = keep current key (only a non-empty value rotates it).
export interface AccountUpdateInput {
  label?: string
  apiKey?: string
  baseURL?: string
  api?: EndpointApi
  models?: string[]
}

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
  // Chèn trailer `Co-Authored-By: AWOG <noreply@awog.local>` vào commit AWOG tự
  // tạo. Bật → (1) thêm khối Git Conventions vào system prompt của Session để
  // model commit kèm co-author, (2) auto-commit per-phase của Tasks nối trailer.
  commitCoAuthor: boolean
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
  // Background auto-fetch every 5 min by default so ahead/behind stays fresh.
  // Set to 0 in Settings → Workspace to disable.
  autoFetchIntervalMs: 300_000,
  commitMessageRule: DEFAULT_COMMIT_MESSAGE_RULE,
  commitCoAuthor: true,
}

// Auto-update (ADR 0028). Persisted in localStorage via `useUpdateSettings`
// (same pattern as git/appearance). `enabled` gates the renderer's automatic
// check schedule; manual "Check now" ignores it.
export interface AutoUpdateSettings {
  enabled: boolean
  lastCheckedAt: string | null
}

export const DEFAULT_AUTO_UPDATE_SETTINGS: AutoUpdateSettings = {
  enabled: true,
  lastCheckedAt: null,
}

// Composer behaviour — client-only (no sidecar). `pasteAsFile` converts a large
// plain-text paste into a `.txt` attachment instead of inlining it into the
// input; `pasteThreshold` is the char count above which that kicks in. Persisted
// via `useComposerSettings` (same localStorage pattern as git).
export interface ComposerSettings {
  pasteAsFile: boolean
  pasteThreshold: number
}

export const DEFAULT_COMPOSER_SETTINGS: ComposerSettings = {
  pasteAsFile: true,
  pasteThreshold: DEFAULT_PASTE_THRESHOLD,
}

// Quota warning — proactive alert when a plan rate-limit (Anthropic / OpenAI
// subscription usage) crosses a threshold. `enabled` gates the in-app banner +
// native notification; `threshold` is the utilization percent that trips it;
// `abortSessionsOnThreshold` additionally cancels every running session turn
// when the threshold is hit; `blockNewSessionsOnThreshold` refuses to create a
// new session while over the threshold. Both actions are destructive — opt-in,
// off by default. Persisted via `useQuotaWarningSettings` (same localStorage
// pattern as git/composer).
export interface QuotaWarningSettings {
  enabled: boolean
  threshold: number
  abortSessionsOnThreshold: boolean
  blockNewSessionsOnThreshold: boolean
}

// Clamp range for the threshold. Below 50% the warning is noise; at/above 100%
// the plan already rejects calls, so 99 is the practical ceiling.
export const QUOTA_THRESHOLD_MIN = 50
export const QUOTA_THRESHOLD_MAX = 99

export const DEFAULT_QUOTA_WARNING_SETTINGS: QuotaWarningSettings = {
  enabled: true,
  threshold: 80,
  abortSessionsOnThreshold: false,
  blockNewSessionsOnThreshold: false,
}

// Session launch defaults. Persisted in localStorage via `useSessionDefaults`
// (same pattern as git/appearance) so the user's picks survive a reload.
export const DEFAULT_SESSION_DEFAULTS: SessionDefaults = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  instructions: '',
  provider: 'anthropic',
  modelId: 'claude-opus-4-8',
  mode: 'ask',
  thinkingLevel: 'high',
  timezone: 'Asia/Ho_Chi_Minh',
}

interface SettingsState {
  workspacePath: string
  autoApprove: boolean
  notificationsEnabled: boolean
  // Auto-compact sessions when context is near full (ADR 0047). Default on.
  autoCompact: boolean
  providers: ProviderRecord<ProviderConfig>
  defaults: SessionDefaults
  appearance: AppearanceSettings
  git: GitSettings
  autoUpdate: AutoUpdateSettings
  composer: ComposerSettings
  quotaWarning: QuotaWarningSettings
  // Selected GitHub account login for the Project GitHub tabs (ADR 0049).
  // App-level, not per-project; passed as `account` to gh.list/gh.get. Empty =
  // follow gh's active account. Persisted in settings.json.
  githubAccount: string
  // Auto-refresh interval (ms) for the Project GitHub tabs' Issues/PR list.
  // The list is cached; this is how often a mounted tab silently revalidates.
  // Default 30 min; 0 = manual refresh only. Configurable in Settings.
  githubAutoFetchMs: number
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeFamily: 'awog',
  sansFamily: 'geist',
  monoFamily: 'geist-mono',
  fontSize: 13,
  fontWeight: 400,
  accent: 'emerald',
  accentCustom: '#a3a3a3',
  themeColor: 'emerald',
  themeColorCustom: '#a3a3a3',
  themeColorStrength: 14,
  surfaceDepth: 'standard',
  liquidGlass: false,
  assistantBubble: true,
  locale: 'en',
  composerSendKey: 'enter',
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
    workspacePath: '~/.awog/workspaces/home',
    autoApprove: false,
    notificationsEnabled: true,
    autoCompact: true,
    providers: {
      anthropic: { accounts: [], activeAccountId: null },
      openai: { accounts: [], activeAccountId: null },
      google: { accounts: [], activeAccountId: null },
    },
    defaults: { ...DEFAULT_SESSION_DEFAULTS },
    appearance: { ...DEFAULT_APPEARANCE },
    git: { ...DEFAULT_GIT_SETTINGS },
    autoUpdate: { ...DEFAULT_AUTO_UPDATE_SETTINGS },
    composer: { ...DEFAULT_COMPOSER_SETTINGS },
    quotaWarning: { ...DEFAULT_QUOTA_WARNING_SETTINGS },
    githubAccount: '',
    githubAutoFetchMs: 1_800_000,
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

        console.warn('[settings] hydrateFromSidecar failed', err)
      }
    },
    async connectAnthropicOAuth(): Promise<OAuthStartResponse> {
      const sidecar = useSidecar()
      return sidecar.request<OAuthStartResponse>('auth.startOAuth', { provider: 'anthropic' })
    },
    // Connect a ChatGPT Plus/Pro subscription via the OpenAI Codex browser
    // (loopback) OAuth flow (ADR 0029). LONG-LIVED: the promise resolves only
    // after the user authorizes in their browser (the sidecar emits an
    // `auth.oauth-url` event in the meantime — the dialog subscribes for it and
    // opens the URL). On success it merges the returned oauth account into the
    // openai bucket. The dialog passes a flowId so it can cancel via cancelOAuth.
    async connectOpenAiCodex(flowId: string, label?: string): Promise<ProviderAccount> {
      const sidecar = useSidecar()
      const account = await sidecar.request<ProviderAccount>('auth.startOAuthCodex', {
        flowId,
        label,
      })
      const config = this.providers.openai
      const idx = config.accounts.findIndex((a: ProviderAccount) => a.id === account.id)
      if (idx >= 0) config.accounts[idx] = account
      else config.accounts.push(account)
      if (!config.activeAccountId) config.activeAccountId = account.id
      return account
    },
    // Cancel an in-flight OAuth login (aborts the long-lived connectOpenAiCodex
    // on the sidecar). Idempotent; safe to call on a stale id.
    async cancelOAuth(flowId: string): Promise<void> {
      const sidecar = useSidecar()
      await sidecar.request('auth.cancelOAuth', { flowId })
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
    // Add an API-key account (ADR 0026 / ADR 0029 Phase C3). `provider` selects
    // the bucket (defaults to anthropic). Without baseURL = a plain provider API
    // key; with baseURL = a custom endpoint, where `api` picks the wire protocol
    // (anthropic-messages | openai-completions). The sidecar owns the key; we
    // only store the returned safe view (key stripped, baseURL/api/models
    // surfaced for the picker).
    async addApiKeyAccount(input: {
      apiKey: string
      provider?: ProviderName
      label?: string
      baseURL?: string
      api?: EndpointApi
      models?: string[]
    }): Promise<ProviderAccount> {
      const sidecar = useSidecar()
      const provider = input.provider ?? 'anthropic'
      const account = await sidecar.request<ProviderAccount>('accounts.addApiKey', {
        provider,
        apiKey: input.apiKey,
        label: input.label,
        baseURL: input.baseURL,
        api: input.api,
        models: input.models,
      })
      const config = this.providers[provider]
      const idx = config.accounts.findIndex((a: ProviderAccount) => a.id === account.id)
      if (idx >= 0) config.accounts[idx] = account
      else config.accounts.push(account)
      if (!config.activeAccountId) config.activeAccountId = account.id
      return account
    },
    // Edit an existing connection (accounts.update). The sidecar decides which
    // patch fields are legal for the account's kind and returns the updated safe
    // view (key stripped, fingerprint/models refreshed); we merge it by id.
    async updateAccount(
      provider: ProviderName,
      accountId: string,
      patch: AccountUpdateInput,
    ): Promise<ProviderAccount> {
      const sidecar = useSidecar()
      const account = await sidecar.request<ProviderAccount>('accounts.update', {
        provider,
        accountId,
        patch,
      })
      const config = this.providers[provider]
      const idx = config.accounts.findIndex((a: ProviderAccount) => a.id === account.id)
      if (idx >= 0) config.accounts[idx] = account
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
    updateDefaults(patch: Partial<SessionDefaults>) {
      this.defaults = { ...this.defaults, ...patch }
    },
    resetDefaults() {
      this.defaults = { ...DEFAULT_SESSION_DEFAULTS }
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
    updateAutoUpdate(patch: Partial<AutoUpdateSettings>) {
      this.autoUpdate = { ...this.autoUpdate, ...patch }
    },
    updateComposer(patch: Partial<ComposerSettings>) {
      this.composer = { ...this.composer, ...patch }
    },
    updateQuotaWarning(patch: Partial<QuotaWarningSettings>) {
      this.quotaWarning = { ...this.quotaWarning, ...patch }
    },
    // Select the GitHub account (login) the Project GitHub tabs run gh as.
    // Empty string = follow gh's active account.
    setGithubAccount(login: string) {
      this.githubAccount = login
    },
    // Auto-refresh interval (ms) for the Project GitHub Issues/PR lists. Clamp
    // negatives to 0 (manual only).
    setGithubAutoFetchMs(ms: number) {
      this.githubAutoFetchMs = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0
    },
  },
})
