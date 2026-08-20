import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import type { PetQuipBucket } from '~/utils/pet-quips'
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
// Fixed provider order for deterministic cross-provider account resolution.
const PROVIDER_ORDER = ['anthropic', 'openai', 'google'] as const satisfies readonly ProviderName[]
// Outcome classification for resolveCreatorAccount — data shape of this store, not a
// shared UI type (stays out of types/index.ts). The UI maps `kind` → wording.
export type CreatorAccountKind =
  | 'active'
  | 'fallback-provider-first'
  | 'fallback-cross-provider'
  | 'none'
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
  autoCompact: boolean
  assistantBubble: boolean
  typewriter: boolean
  reducedMotion: boolean
  refeedImages: boolean
  pasteAsFile: boolean
  pasteThreshold: number
  // Reactive wake (ADR 0066 P2): when a Bash(run_in_background) command finishes
  // and the session is idle, auto-start a turn so the model continues. Default OFF
  // = notify-only (a "Continue" card; the user clicks to resume).
  autoContinueOnBackground: boolean
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

// GitHub notification polling (docs/features/github-notifications.md). Opt-in PER
// PROJECT: the inbox spans every repo the account can see, but only notifications
// belonging to `projectIds` are surfaced — an empty list means nothing fires, even
// with `enabled` on.
export interface GithubNotifySettings {
  enabled: boolean
  intervalMs: number
  projectIds: string[]
}

// ── Notifications (Settings → Notifications) ────────────────────────────────
// HOW notifications reach the user, owned in one place; the feature panels only
// own WHAT generates them (Git: poll GitHub; Sessions: turn settle / attention).
//   'toast'  — in-app toast only; never touches the OS
//   'native' — OS notification only, even with the app focused
//   'both'   — toast always + OS notification when the window isn't focused
export type NotifyDelivery = 'toast' | 'native' | 'both'

// Screen corner (or edge centre) the app-lifetime toasts stack in.
export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface NotificationSettings {
  delivery: NotifyDelivery
  toastPosition: ToastPosition
  // Session turn-settle / needs-attention notifications (was sessions.
  // notificationsEnabled). Session events only ever fire on an unfocused window
  // — the open session already shows them live.
  sessionEvents: boolean
}

// LLM used by the selection-to-translate feature (docs/features/selection-translate.md).
// `followAppDefault` true → resolve like a session (project llmDefaults → app
// defaults); false → use the pinned provider/account/model below. accountId
// undefined = the provider's active account.
// Wiki + AI-memory context switches (ADR 0073). Functional settings: they travel
// with every turn as `contextConfig` (sessions.sendMessage), NOT localStorage-only
// — a switch the engine never sees would be a lie in the UI.
export interface ContextSettings {
  // Inject the wiki table of contents into each turn.
  wikiEnabled: boolean
  // Character budget for that index; over it, the index degrades to space level.
  wikiBudgetChars: number
  // Let the agent create/update/delete wiki pages. Default OFF: the wiki is
  // curated content and the global tier has no version history. Each call is still
  // approved through the normal permission gate.
  wikiAutoWrite: boolean
  // Inject the memory index into each turn.
  memoryEnabled: boolean
  // Let the agent WRITE memory itself (memory_remember / memory_forget). Default
  // OFF: an agent silently accumulating facts about the user is opt-in.
  memoryAutoWrite: boolean
  memoryBudgetChars: number
}

export interface TranslateSettings {
  followAppDefault: boolean
  provider: ProviderName
  accountId?: string
  modelId: string
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

// 'cute' = the mint/off-white "cute AI command center" theme
// (assets/css/theme-cute.css). 'awog' stays the default look.
export type ThemeFamily = 'awog' | 'shadcn' | 'cute'
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

// Desktop pet (docs/features/desktop-pet.md). Lives here because it is a pure UI
// preference, but it is FUNCTIONAL in the main process (it creates/destroys a
// window), so usePetStatus pushes it over IPC on every change.
export interface PetSettings {
  enabled: boolean
  scale: PetScale
  // Which built-in spritesheet (public/pet/<sprite>.png).
  sprite: PetSprite
  autoPeek: boolean
  // Occasional speech bubbles.
  quips: boolean
  // User-edited lines per bucket (Settings → Pet). An empty/missing bucket falls back
  // to the localised defaults — so an untouched install follows the app language, and
  // an edited one is the user's own text.
  quipLines: Partial<Record<PetQuipBucket, string[]>>
  // Minutes between "drink water / stretch / rest your eyes" nudges. 0 = off.
  reminderMinutes: number
  // Last resting position in screen coordinates; null = default corner.
  pos: { x: number; y: number } | null
}
export type PetScale = 1 | 1.25 | 1.5
export const PET_SCALES: PetScale[] = [1, 1.25, 1.5]
export type PetSprite = 'girl' | 'shiba' | 'bichon' | 'dino' | 'chicken' | 'miku'
export const PET_SPRITES: PetSprite[] = ['girl', 'shiba', 'bichon', 'dino', 'chicken', 'miku']

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
  modelId: 'claude-opus-5',
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
  autoCompact: true,
  assistantBubble: true,
  // Default OFF = craft-style streaming (full text, 300ms chunky re-parse + buffer gate,
  // ADR 0061). Turn ON to restore AWOG's smooth char-by-char typewriter reveal.
  typewriter: false,
  reducedMotion: false,
  refeedImages: true,
  pasteAsFile: true,
  pasteThreshold: 2000,
  autoContinueOnBackground: false,
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

// Default to following the session default; when a user pins a custom model, seed
// a cheap one (translation is short + high-volume).
// 60s = GitHub's documented minimum poll interval for the notifications API.
const DEFAULT_GITHUB_NOTIFY: GithubNotifySettings = {
  enabled: true,
  intervalMs: 60_000,
  projectIds: [],
}

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  delivery: 'both',
  // Bottom-right: out of the way of the composer and the centre of the app, and
  // where desktop notifications usually live.
  toastPosition: 'bottom-right',
  sessionEvents: true,
}

const DEFAULT_CONTEXT: ContextSettings = {
  wikiEnabled: true,
  wikiBudgetChars: 4000,
  wikiAutoWrite: false,
  memoryEnabled: true,
  memoryAutoWrite: false,
  memoryBudgetChars: 4000,
}

const DEFAULT_TRANSLATE: TranslateSettings = {
  followAppDefault: true,
  provider: 'anthropic',
  modelId: 'claude-haiku-4-5',
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

// Opt-in: a window floating above every other app is not something to turn on for
// someone. Off until the user asks for it in Settings → Appearance.
const DEFAULT_PET: PetSettings = {
  enabled: false,
  scale: 1,
  sprite: 'girl',
  autoPeek: true,
  quips: true,
  quipLines: {},
  reminderMinutes: 30,
  pos: null,
}

export const PET_REMINDER_CHOICES = [0, 15, 30, 60] as const

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

// No baked-in default: the real root is os.homedir()/.awog, which only the shell
// knows. `hydrateAppPaths()` fills it from app:info; until then it stays empty and
// the (single, read-only) consumer shows a placeholder instead of another user's
// home directory.
const DEFAULT_WORKSPACE_PATH = ''

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
  pet: PetSettings
  workspacePanel: WorkspacePanelLayout
  githubAccount: string
  githubAutoFetchMs: number
  githubNotify: GithubNotifySettings
  notifications: NotificationSettings
  translate: TranslateSettings
  context: ContextSettings
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
  const pet = reactive<PetSettings>({ ...DEFAULT_PET, ...persisted.pet })
  // A pack can be dropped between releases; a persisted name that no longer ships
  // would render an empty sprite (the CSS class simply wouldn't exist). Clamp once,
  // here, so every consumer — pet window and Settings gallery — agrees.
  if (!PET_SPRITES.includes(pet.sprite)) pet.sprite = PET_SPRITES[0]!
  // Merge dock map field-by-field so a newly-added view inherits its default side
  // even when an older persisted blob only listed the original views.
  const workspacePanel = reactive<WorkspacePanelLayout>({
    ...DEFAULT_WORKSPACE_PANEL,
    ...persisted.workspacePanel,
    dock: { ...DEFAULT_WORKSPACE_PANEL.dock, ...persisted.workspacePanel?.dock },
  })
  const githubAccount = ref(persisted.githubAccount ?? '')
  const githubAutoFetchMs = ref(persisted.githubAutoFetchMs ?? 1_800_000)
  const githubNotify = reactive<GithubNotifySettings>({
    ...DEFAULT_GITHUB_NOTIFY,
    ...persisted.githubNotify,
  })
  // Delivery/position/session-events used to live in three different slices
  // (githubNotify.delivery, appearance.toastPosition, sessions.notificationsEnabled).
  // Seed from those once so an existing install keeps its choices.
  const legacy = persisted as Partial<PersistShape> & {
    githubNotify?: { delivery?: NotifyDelivery }
    appearance?: { toastPosition?: ToastPosition }
    sessions?: { notificationsEnabled?: boolean }
  }
  const notifications = reactive<NotificationSettings>({
    ...DEFAULT_NOTIFICATIONS,
    ...(legacy.githubNotify?.delivery ? { delivery: legacy.githubNotify.delivery } : {}),
    ...(legacy.appearance?.toastPosition ? { toastPosition: legacy.appearance.toastPosition } : {}),
    ...(legacy.sessions?.notificationsEnabled !== undefined
      ? { sessionEvents: legacy.sessions.notificationsEnabled }
      : {}),
    ...persisted.notifications,
  })
  const translate = reactive<TranslateSettings>({ ...DEFAULT_TRANSLATE, ...persisted.translate })
  const context = reactive<ContextSettings>({ ...DEFAULT_CONTEXT, ...persisted.context })

  // Bumped whenever a persisted slice is saved (see the watch below). Lets the
  // Settings modal render a debounced "saved" toast without re-declaring the
  // slice list. Not itself watched/persisted, so bumping never re-triggers the
  // persist. Only increments on real changes (the watch has no `immediate`, so
  // the initial hydrate from localStorage doesn't tick it).
  const savedTick = ref(0)

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
      pet,
      workspacePanel,
      githubAccount,
      githubAutoFetchMs,
      githubNotify,
      notifications,
      translate,
      context,
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
        pet,
        workspacePanel,
        githubAccount: githubAccount.value,
        githubAutoFetchMs: githubAutoFetchMs.value,
        githubNotify,
        notifications,
        translate,
        context,
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob))
      } catch {
        // Quota/availability errors are non-fatal — settings stay in memory.
      }
      savedTick.value += 1
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

  // Resolve the account a chat-driven creator (Skills/Agents/Commands/… "create by
  // chat") should use. Provider-agnostic: mirrors Sessions' defaultsForNewSession
  // (sessions.ts) minus the project-pinned branch, since creator libraries have no
  // project context. `kind` classifies the outcome so the UI can pick wording; the
  // store stays out of the presentation layer (SoC — no message strings here).
  const resolveCreatorAccount = (): {
    accountId: string | null
    provider: ProviderName
    kind: CreatorAccountKind
  } => {
    const p = defaults.provider
    // 1. active account of the default provider (matches Sessions' isActive branch).
    const active = activeAccount(p)
    if (active) return { accountId: active.id, provider: p, kind: 'active' }
    // 2. first connected account of the default provider (Sessions' inProvider[0]).
    const first = providers[p].accounts[0]
    if (first) return { accountId: first.id, provider: p, kind: 'fallback-provider-first' }
    // 3. cross-provider fallback — first provider (fixed order) with any account,
    //    preferring its active account. Deterministic vs Sessions' flat accounts[0].
    for (const q of PROVIDER_ORDER) {
      const acct = activeAccount(q) ?? providers[q].accounts[0]
      if (acct) return { accountId: acct.id, provider: q, kind: 'fallback-cross-provider' }
    }
    // 4. nothing connected anywhere.
    return { accountId: null, provider: p, kind: 'none' }
  }

  // --- account/auth IPC actions ---
  // Dedup concurrent hydrations: boot fire-and-forget (default.vue) + the lazy guard
  // in usePromptCreator.send() can race. Reuse the in-flight promise while running,
  // then reset — never memo the result, so later calls re-fetch newly connected
  // accounts. The idempotent merge below keeps repeated calls safe.
  let inFlight: Promise<void> | null = null
  async function hydrateFromSidecar(): Promise<void> {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    if (inFlight) return inFlight
    inFlight = (async () => {
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
      } finally {
        inFlight = null
      }
    })()
    return inFlight
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
  const updatePet = (patch: Partial<PetSettings>) => Object.assign(pet, patch)
  const updateTranslate = (patch: Partial<TranslateSettings>) => Object.assign(translate, patch)
  const updateContext = (patch: Partial<ContextSettings>) => Object.assign(context, patch)

  // The per-turn payload sessions.sendMessage carries (ADR 0073 D-12). Only the
  // NON-default fields are included so the engine keeps its own defaults for
  // anything this UI build does not know about.
  const contextConfig = (): Record<string, boolean | number> => {
    const out: Record<string, boolean | number> = {}
    if (!context.wikiEnabled) out.wikiEnabled = false
    if (context.wikiBudgetChars !== DEFAULT_CONTEXT.wikiBudgetChars) {
      out.wikiBudgetChars = context.wikiBudgetChars
    }
    if (context.wikiAutoWrite) out.wikiAutoWrite = true
    if (!context.memoryEnabled) out.memoryEnabled = false
    if (context.memoryAutoWrite) out.memoryAutoWrite = true
    if (context.memoryBudgetChars !== DEFAULT_CONTEXT.memoryBudgetChars) {
      out.memoryBudgetChars = context.memoryBudgetChars
    }
    return out
  }
  const setWorkspacePath = (path: string) => {
    workspacePath.value = path
  }
  // Adopt the shell's real config root (app:info → os.homedir()/.awog). Always
  // overwrites: the sidecar's root is authoritative, so a value persisted on
  // another machine (or from an older build with a baked-in path) must not win.
  const hydrateAppPaths = async (): Promise<void> => {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    try {
      const info = await sidecar.getAppInfo()
      if (info.awogHome) workspacePath.value = info.awogHome
    } catch (err) {
      console.warn('[settings] hydrateAppPaths failed', err)
    }
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
    pet,
    workspacePanel,
    githubAccount,
    githubAutoFetchMs,
    githubNotify,
    notifications,
    translate,
    context,
    savedTick,
    // getters
    activeAccount,
    resolveCreatorAccount,
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
    updatePet,
    updateTranslate,
    updateContext,
    contextConfig,
    setWorkspacePath,
    hydrateAppPaths,
    setGithubAccount,
    setWorkspaceDock,
    setWorkspaceLeftWidth,
    setWorkspaceRightWidth,
    setWorkspaceBottomHeight,
  }
})
