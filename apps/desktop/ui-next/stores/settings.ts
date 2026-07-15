import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { DEFAULT_SYSTEM_PROMPT } from '~/utils/system-prompt'

// Settings store (ui-next) — ports apps/desktop/ui/stores/settings.ts to the
// rebuild. Two kinds of state:
//   1. providers/accounts — sidecar truth (NOT persisted). Hydrated via
//      `hydrateFromSidecar` on the Settings page mount; mutated through the
//      account/auth IPC actions. The API key never reaches the renderer — only
//      the safe view (fingerprint, label, models, baseURL).
//   2. local preference slices — defaults/git/sessions/composer/quota/autoUpdate/
//      appearance/workspacePath. Persisted to a single localStorage key.
// Theme mode + accent + font-size live in `useTheme()` (DOM-applied + persisted
// separately); locale lives in `useI18n()`. The appearance slice here holds only
// the extra prefs those two don't own (font family/weight, surface depth, glass…).
// SoC: orchestrates IPC + persistence only; no DOM / no SDK imports.

export type ProviderName = 'anthropic' | 'openai' | 'google'
export type AuthMode = 'oauth' | 'apikey'
export type AccountStatus = 'connected' | 'expired' | 'disconnected'
// Wire protocol a custom endpoint speaks. 'anthropic-messages' = Anthropic
// Messages API; 'openai-completions' = OpenAI Chat Completions (Ollama/vLLM/…).
export type EndpointApi = 'anthropic-messages' | 'openai-completions'

// Safe account view returned by the sidecar (key stripped — fingerprint only).
export interface ProviderAccount {
  id: string
  label: string
  authMode: AuthMode
  fingerprint: string
  status: AccountStatus
  expiresAt?: number
  baseURL?: string
  api?: EndpointApi
  models?: string[]
  organization?: { uuid: string; name: string }
  account?: { uuid: string; email: string }
  version: number
  createdAt: string
}

export interface ProviderConfig {
  accounts: ProviderAccount[]
  activeAccountId: string | null
}

// Patch for accounts.update — all optional; the sidecar enforces which fields are
// legal per account kind. Blank/omitted `apiKey` = keep the current key.
export interface AccountUpdateInput {
  label?: string
  apiKey?: string
  baseURL?: string
  api?: EndpointApi
  models?: string[]
}

export type AgentMode = 'ask' | 'accept-edits' | 'plan' | 'execute'
// Defined locally (not exported) to avoid an auto-import name clash with the
// canonical `ThinkingLevel` exported from composables/useSessionsData.ts — both
// are the identical union. Consumers import the type from useSessionsData.
type ThinkingLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'max'

export interface SessionDefaults {
  systemPrompt: string
  instructions: string
  provider: ProviderName
  modelId: string
  mode: AgentMode
  thinkingLevel: ThinkingLevel
}

export type AutoCommitScope = 'workspace' | 'artifacts-only'
export type DirtyTaskPolicy = 'warn' | 'auto-stash'

export interface GitSettings {
  autoCommitPerPhase: boolean
  commitCoAuthor: boolean
  autoCommitMessageTemplate: string
  autoCommitScope: AutoCommitScope
  autoStashDirtyBeforeTask: boolean
  dirtyTaskPolicy: DirtyTaskPolicy
  autoFetchIntervalMs: number
  commitMessageRule: string
}

// Session + composer behaviour. autoApprove/notifications/autoCompact are the
// functional engine prefs; the rest are renderer UX prefs (bubble/typewriter/…).
export interface SessionSettings {
  autoApprove: boolean
  notificationsEnabled: boolean
  autoCompact: boolean
  assistantBubble: boolean
  typewriter: boolean
  reducedMotion: boolean
  refeedImages: boolean
  pasteAsFile: boolean
  pasteThreshold: number
}

export interface QuotaWarningSettings {
  enabled: boolean
  threshold: number
  abortSessionsOnThreshold: boolean
  blockNewSessionsOnThreshold: boolean
}

export interface AutoUpdateSettings {
  enabled: boolean
  lastCheckedAt: string | null
}

// Where the Session workspace panel docks, configured PER VIEW (Diff/Files/…).
// 'right' = column to the right of the chat (default); 'bottom' = full-width row
// below the chat. Resize sizes are kept per orientation so switching dock keeps a
// sensible width / height for each.
export type WorkspaceDockSide = 'left' | 'right' | 'bottom'
export type WorkspaceDock = Record<string, WorkspaceDockSide>

export interface WorkspacePanelLayout {
  dock: WorkspaceDock
  leftWidth: number
  rightWidth: number
  bottomHeight: number
}

export type ThemeFamily = 'awog' | 'shadcn'
export type SurfaceDepth = 'flat' | 'standard' | 'deep'
export type SansFamily = 'geist' | 'inter' | 'system'
export type FontWeight = 300 | 400 | 500
export type ComposerSendKey = 'enter' | 'shift-enter'

// Appearance prefs NOT owned by useTheme (mode/accent/fontSize) or useI18n
// (locale). Persisted here; applied to the DOM by the Appearance section.
export interface AppearanceExtras {
  themeFamily: ThemeFamily
  sansFamily: SansFamily
  fontWeight: FontWeight
  surfaceDepth: SurfaceDepth
  liquidGlass: boolean
  composerSendKey: ComposerSendKey
}

export const QUOTA_THRESHOLD_MIN = 50
export const QUOTA_THRESHOLD_MAX = 99

export const PASTE_THRESHOLD_MIN = 200
export const PASTE_THRESHOLD_MAX = 100000

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
- scope: one short lowercase word, inferred from the changed paths. Omit when cross-cutting.
- subject: imperative mood, English, ≤ 72 chars, no trailing period, lowercase.
- body (optional): explain the "why" and summarize the meaningful changes.
- Describe only changes observable in the diff. Do not invent intent beyond the evidence.
`

const DEFAULT_DEFAULTS: SessionDefaults = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  instructions: '',
  provider: 'anthropic',
  modelId: 'claude-opus-4-8',
  mode: 'ask',
  thinkingLevel: 'high',
}

const DEFAULT_GIT: GitSettings = {
  autoCommitPerPhase: true,
  commitCoAuthor: true,
  autoCommitMessageTemplate: '[{phaseId}] {agentName}: {summary}',
  autoCommitScope: 'workspace',
  autoStashDirtyBeforeTask: false,
  dirtyTaskPolicy: 'warn',
  autoFetchIntervalMs: 300_000,
  commitMessageRule: DEFAULT_COMMIT_MESSAGE_RULE,
}

const DEFAULT_SESSIONS: SessionSettings = {
  autoApprove: false,
  notificationsEnabled: true,
  autoCompact: true,
  assistantBubble: true,
  // Default OFF = craft-style streaming (full text, 300ms chunky re-parse + buffer gate,
  // ADR 0061). Turn ON to restore AWOG's smooth char-by-char typewriter reveal.
  typewriter: false,
  reducedMotion: false,
  refeedImages: true,
  pasteAsFile: true,
  pasteThreshold: 2000,
}

const DEFAULT_QUOTA: QuotaWarningSettings = {
  enabled: true,
  threshold: 80,
  abortSessionsOnThreshold: false,
  blockNewSessionsOnThreshold: false,
}

const DEFAULT_AUTO_UPDATE: AutoUpdateSettings = {
  enabled: true,
  lastCheckedAt: null,
}

const DEFAULT_APPEARANCE: AppearanceExtras = {
  themeFamily: 'awog',
  // System stack (SF Pro / Segoe UI) by default so the desktop app renders in the
  // OS UI font and reads as native. Geist / Inter stay opt-in in Appearance.
  sansFamily: 'system',
  fontWeight: 400,
  surfaceDepth: 'standard',
  liquidGlass: false,
  composerSendKey: 'enter',
}

// Workspace panel: per-view dock side. Default every view to the right column;
// Terminal docks at the bottom (full-width under the chat) by default.
const DEFAULT_WORKSPACE_PANEL: WorkspacePanelLayout = {
  dock: {
    Diff: 'right',
    Files: 'right',
    Terminal: 'bottom',
    Plan: 'right',
    Tasks: 'right',
    Preview: 'right',
    Cost: 'right',
  },
  leftWidth: 322,
  rightWidth: 322,
  bottomHeight: 260,
}

const DEFAULT_WORKSPACE_PATH = '/Users/kyro/.awog'

// --- persistence (single key; providers excluded — sidecar is their truth) ---
const STORAGE_KEY = 'awog-settings-v1'
// One-shot marker: flip installs that still carry the old Geist default to System.
const SANS_NATIVE_MIGRATION_KEY = 'awog-sans-native-v1'

interface PersistShape {
  workspacePath: string
  defaults: SessionDefaults
  git: GitSettings
  sessions: SessionSettings
  quota: QuotaWarningSettings
  autoUpdate: AutoUpdateSettings
  appearance: AppearanceExtras
  workspacePanel: WorkspacePanelLayout
  githubAccount: string
  githubAutoFetchMs: number
}

function loadPersisted(): Partial<PersistShape> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const blob = parsed as Partial<PersistShape>
    // One-time migration: the app shipped with Geist as the default UI font, which
    // reads as a web app rather than a native desktop one. Flip persisted installs
    // that still carry that old default to the System stack (SF Pro / Segoe UI)
    // once. A user who re-picks Geist afterwards keeps it — the marker stops this
    // from re-flipping on every load.
    if (
      !window.localStorage.getItem(SANS_NATIVE_MIGRATION_KEY) &&
      blob.appearance?.sansFamily === 'geist'
    ) {
      blob.appearance = { ...blob.appearance, sansFamily: 'system' }
      window.localStorage.setItem(SANS_NATIVE_MIGRATION_KEY, '1')
    }
    return blob
  } catch {
    return {}
  }
}

interface AccountsListResponse {
  providers: Record<ProviderName, { accounts: ProviderAccount[]; activeAccountId: string | null }>
}
interface OAuthStartResponse {
  state: string
  authUrl: string
}
export interface AccountTestResponse {
  ok: boolean
  expiresAt?: number
  error?: { code: string; message: string }
}

export const useSettingsStore = defineStore('settings', () => {
  const persisted = loadPersisted()

  // Sidecar truth — not persisted.
  const providers = reactive<Record<ProviderName, ProviderConfig>>({
    anthropic: { accounts: [], activeAccountId: null },
    openai: { accounts: [], activeAccountId: null },
    google: { accounts: [], activeAccountId: null },
  })

  // Persisted preference slices (merge over defaults so new fields appear).
  const workspacePath = ref(persisted.workspacePath ?? DEFAULT_WORKSPACE_PATH)
  const defaults = reactive<SessionDefaults>({ ...DEFAULT_DEFAULTS, ...persisted.defaults })
  // Seed the default system prompt when the persisted value is empty/missing — an
  // earlier build defaulted it to '' and may have saved that blank. (A user who
  // truly wants it empty can clear it; it only re-seeds when blank.)
  if (!defaults.systemPrompt) defaults.systemPrompt = DEFAULT_SYSTEM_PROMPT
  const git = reactive<GitSettings>({ ...DEFAULT_GIT, ...persisted.git })
  const sessions = reactive<SessionSettings>({ ...DEFAULT_SESSIONS, ...persisted.sessions })
  const quota = reactive<QuotaWarningSettings>({ ...DEFAULT_QUOTA, ...persisted.quota })
  const autoUpdate = reactive<AutoUpdateSettings>({
    ...DEFAULT_AUTO_UPDATE,
    ...persisted.autoUpdate,
  })
  const appearance = reactive<AppearanceExtras>({ ...DEFAULT_APPEARANCE, ...persisted.appearance })
  // Merge dock map field-by-field so a newly-added view inherits its default side
  // even when an older persisted blob only listed the original views.
  const workspacePanel = reactive<WorkspacePanelLayout>({
    ...DEFAULT_WORKSPACE_PANEL,
    ...persisted.workspacePanel,
    dock: { ...DEFAULT_WORKSPACE_PANEL.dock, ...persisted.workspacePanel?.dock },
  })
  const githubAccount = ref(persisted.githubAccount ?? '')
  const githubAutoFetchMs = ref(persisted.githubAutoFetchMs ?? 1_800_000)

  // Persist all preference slices as one blob whenever any of them change.
  watch(
    [
      workspacePath,
      defaults,
      git,
      sessions,
      quota,
      autoUpdate,
      appearance,
      workspacePanel,
      githubAccount,
      githubAutoFetchMs,
    ],
    () => {
      if (typeof window === 'undefined') return
      const blob: PersistShape = {
        workspacePath: workspacePath.value,
        defaults,
        git,
        sessions,
        quota,
        autoUpdate,
        appearance,
        workspacePanel,
        githubAccount: githubAccount.value,
        githubAutoFetchMs: githubAutoFetchMs.value,
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob))
      } catch {
        // Quota/availability errors are non-fatal — settings stay in memory.
      }
    },
    { deep: true },
  )

  // --- getters ---
  const activeAccount = (provider: ProviderName): ProviderAccount | null => {
    const cfg = providers[provider]
    if (!cfg.activeAccountId) return null
    return cfg.accounts.find((a) => a.id === cfg.activeAccountId) ?? null
  }
  const isProviderConnected = (provider: ProviderName): boolean => {
    const a = activeAccount(provider)
    return !!a && a.status === 'connected'
  }
  const keyFingerprint = (provider: ProviderName): string =>
    activeAccount(provider)?.fingerprint ?? ''

  // --- account/auth IPC actions ---
  async function hydrateFromSidecar(): Promise<void> {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    try {
      const res = await sidecar.request<AccountsListResponse>('accounts.list')
      ;(Object.keys(providers) as ProviderName[]).forEach((p) => {
        const incoming = res.providers?.[p]
        if (!incoming) return
        providers[p].accounts = Array.isArray(incoming.accounts) ? incoming.accounts : []
        providers[p].activeAccountId =
          typeof incoming.activeAccountId === 'string' ? incoming.activeAccountId : null
      })
    } catch (err) {
      console.warn('[settings] hydrateFromSidecar failed', err)
    }
  }

  function mergeAccount(provider: ProviderName, account: ProviderAccount, makeActive: boolean) {
    const cfg = providers[provider]
    const idx = cfg.accounts.findIndex((a) => a.id === account.id)
    if (idx >= 0) cfg.accounts[idx] = account
    else cfg.accounts.push(account)
    if (makeActive && !cfg.activeAccountId) cfg.activeAccountId = account.id
  }

  async function connectAnthropicOAuth(): Promise<OAuthStartResponse> {
    return useSidecar().request<OAuthStartResponse>('auth.startOAuth', { provider: 'anthropic' })
  }
  async function completeAnthropicOAuth(
    state: string,
    code: string,
    label?: string,
    // When set, the sidecar replaces this account's credentials in place (re-auth)
    // instead of adding a new account — keeps the id + active selection stable.
    replaceAccountId?: string,
  ): Promise<ProviderAccount> {
    const account = await useSidecar().request<ProviderAccount>('auth.completeOAuth', {
      state,
      code,
      label,
      replaceAccountId,
    })
    mergeAccount('anthropic', account, true)
    return account
  }
  // Long-lived: resolves only after the user authorizes in their browser. The
  // sidecar emits an `auth.oauth-url` event meanwhile (dialog subscribes + opens).
  async function connectOpenAiCodex(flowId: string, label?: string): Promise<ProviderAccount> {
    const account = await useSidecar().request<ProviderAccount>('auth.startOAuthCodex', {
      flowId,
      label,
    })
    mergeAccount('openai', account, true)
    return account
  }
  async function cancelOAuth(flowId: string): Promise<void> {
    await useSidecar().request('auth.cancelOAuth', { flowId })
  }
  async function addApiKeyAccount(input: {
    apiKey: string
    provider?: ProviderName
    label?: string
    baseURL?: string
    api?: EndpointApi
    models?: string[]
  }): Promise<ProviderAccount> {
    const provider = input.provider ?? 'anthropic'
    const account = await useSidecar().request<ProviderAccount>('accounts.addApiKey', {
      provider,
      apiKey: input.apiKey,
      label: input.label,
      baseURL: input.baseURL,
      api: input.api,
      models: input.models,
    })
    mergeAccount(provider, account, true)
    return account
  }
  async function updateAccount(
    provider: ProviderName,
    accountId: string,
    patch: AccountUpdateInput,
  ): Promise<ProviderAccount> {
    const account = await useSidecar().request<ProviderAccount>('accounts.update', {
      provider,
      accountId,
      patch,
    })
    mergeAccount(provider, account, false)
    return account
  }
  async function disconnectAccount(provider: ProviderName, accountId: string): Promise<void> {
    await useSidecar().request('accounts.remove', { provider, accountId })
    const cfg = providers[provider]
    cfg.accounts = cfg.accounts.filter((a) => a.id !== accountId)
    if (cfg.activeAccountId === accountId) cfg.activeAccountId = cfg.accounts[0]?.id ?? null
  }
  async function setActiveAccount(provider: ProviderName, accountId: string | null): Promise<void> {
    await useSidecar().request('accounts.setActive', { provider, accountId })
    const cfg = providers[provider]
    if (accountId !== null && !cfg.accounts.some((a) => a.id === accountId)) return
    cfg.activeAccountId = accountId
  }
  async function testAccount(
    provider: ProviderName,
    accountId: string,
  ): Promise<AccountTestResponse> {
    const result = await useSidecar().request<AccountTestResponse>('accounts.test', {
      provider,
      accountId,
    })
    const account = providers[provider].accounts.find((a) => a.id === accountId)
    if (account) {
      if (result.ok) {
        account.status = 'connected'
        if (typeof result.expiresAt === 'number') account.expiresAt = result.expiresAt
      } else if (result.error?.code === 'TOKEN_EXPIRED' || result.error?.code === 'AUTH_EXPIRED') {
        // Recoverable via re-authentication — keep it 'expired' (amber), not
        // 'disconnected'. The sidecar returns AUTH_EXPIRED when an OAuth refresh
        // token is revoked; TOKEN_EXPIRED for a lapsed access token.
        account.status = 'expired'
      } else {
        account.status = 'disconnected'
      }
    }
    return result
  }

  // --- local preference update actions (patch-merge) ---
  const updateDefaults = (patch: Partial<SessionDefaults>) => Object.assign(defaults, patch)
  const resetDefaults = () => Object.assign(defaults, DEFAULT_DEFAULTS)
  const updateGit = (patch: Partial<GitSettings>) => Object.assign(git, patch)
  const resetGitCommitRule = () => {
    git.commitMessageRule = DEFAULT_COMMIT_MESSAGE_RULE
  }
  const updateSessions = (patch: Partial<SessionSettings>) => Object.assign(sessions, patch)
  const updateQuota = (patch: Partial<QuotaWarningSettings>) => Object.assign(quota, patch)
  const updateAutoUpdate = (patch: Partial<AutoUpdateSettings>) => Object.assign(autoUpdate, patch)
  const updateAppearance = (patch: Partial<AppearanceExtras>) => Object.assign(appearance, patch)
  const setWorkspacePath = (path: string) => {
    workspacePath.value = path
  }
  // App-level default GitHub (gh CLI) account login. '' = follow gh's active
  // account. Per-project pickers inherit this unless they set an override.
  const setGithubAccount = (login: string) => {
    githubAccount.value = login.trim()
  }

  // Resolve the dock side for a view, falling back to 'right' for unknown views.
  const workspaceDockOf = (view: string): WorkspaceDockSide => workspacePanel.dock[view] ?? 'right'
  const setWorkspaceDock = (view: string, side: WorkspaceDockSide) => {
    workspacePanel.dock[view] = side
  }
  const setWorkspaceLeftWidth = (width: number) => {
    workspacePanel.leftWidth = width
  }
  const setWorkspaceRightWidth = (width: number) => {
    workspacePanel.rightWidth = width
  }
  const setWorkspaceBottomHeight = (height: number) => {
    workspacePanel.bottomHeight = height
  }

  return {
    // state
    providers,
    workspacePath,
    defaults,
    git,
    sessions,
    quota,
    autoUpdate,
    appearance,
    workspacePanel,
    githubAccount,
    githubAutoFetchMs,
    // getters
    activeAccount,
    isProviderConnected,
    keyFingerprint,
    workspaceDockOf,
    // account/auth actions
    hydrateFromSidecar,
    connectAnthropicOAuth,
    completeAnthropicOAuth,
    connectOpenAiCodex,
    cancelOAuth,
    addApiKeyAccount,
    updateAccount,
    disconnectAccount,
    setActiveAccount,
    testAccount,
    // preference actions
    updateDefaults,
    resetDefaults,
    updateGit,
    resetGitCommitRule,
    updateSessions,
    updateQuota,
    updateAutoUpdate,
    updateAppearance,
    setWorkspacePath,
    setGithubAccount,
    setWorkspaceDock,
    setWorkspaceLeftWidth,
    setWorkspaceRightWidth,
    setWorkspaceBottomHeight,
  }
})
