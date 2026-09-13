import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import type { KeymapBlob } from '~/composables/useKeymap'
import type { PetQuipBucket } from '~/utils/pet-quips'
import { DEFAULT_SYSTEM_PROMPT } from '~/utils/system-prompt'
import { INFRA_FIELDS, compactInfraContext } from '~/utils/infra-context'
import type { InfraContext } from '~/types'

// Settings store (ui-next) — ports apps/desktop/ui/stores/settings.ts to the
// rebuild. Three kinds of state:
//   1. providers/accounts — sidecar truth (NOT persisted). Hydrated via
//      `hydrateFromSidecar` on the Settings page mount; mutated through the
//      account/auth IPC actions. The API key never reaches the renderer — only
//      the safe view (fingerprint, label, models, baseURL).
//   2. SYNCED preference slices — defaults/git/sessions/quota/autoUpdate/
//      appearance/pet/github*/notifications/translate/context/keymap.
//      Truth is `~/.awog/settings.json` (sidecar, `settings.*` RPC). localStorage
//      keeps a copy purely as a synchronous boot cache so the first paint doesn't
//      flash defaults while the async read is in flight.
//   3. LOCAL-ONLY view state — workspacePath (re-derived from app:info) and the
//      workspace panel geometry. Per machine, never synced; localStorage is its
//      only home.
// See docs/features/settings.md for the "which tier owns what" criteria.
//
// Layers (docs/features/settings.md): user (~/.awog/settings.json) → project
// ({project}/.awog/settings.json). The store writes the USER tier; the project
// overlay is loaded on demand (`loadLayers`) and exposed read-only through
// `projectSlice` / `originOf` so a UI row can say where its value came from.
//
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

// LLM config the PR detail's "Start review" session starts on. Same shape as a
// project's llmDefaults, minus the MCP whitelist (a review reads a diff; it does
// not need a different tool surface). Absent = inherit project → app defaults.
export interface PrReviewLlm {
  provider: ProviderName
  modelId: string
  // Three states, like the per-project gh-account override:
  //   PR_REVIEW_ACCOUNT_INHERIT → leave the account the session resolved from the
  //                               project / app defaults (only model + effort move)
  //   undefined                 → the chosen provider's active account
  //   '<id>'                    → that account
  accountId?: string
  // undefined = inherit the effort a plain new session would get.
  level?: ThinkingLevel
}

// "Follow the session's own config" for PrReviewLlm.accountId — the account (and
// with it the provider) stays whatever a new session in that project would get.
export const PR_REVIEW_ACCOUNT_INHERIT = '__inherit'

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
  // Prompt the PR detail's "Start review" button sends to the session it opens.
  // Placeholders (utils/pr-review-prompt) are substituted at click time; blank
  // falls back to DEFAULT_PR_REVIEW_PROMPT.
  prReviewPrompt: string
  // Account / model / effort that session runs on. Absent = inherit.
  prReviewLlm?: PrReviewLlm
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
  // Inject the <available_agents> / <available_skills> catalogues into every turn.
  // Default ON (the model is told what it can delegate to / apply). Turning one off
  // does not remove a capability: the Task tool and `@skill:<id>` still work — only
  // the up-front listing is dropped, which is ~1-2k tokens re-read on every request
  // of every turn.
  agentsCatalogEnabled: boolean
  skillsCatalogEnabled: boolean
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
  // Soft-wrap long lines inside rendered-markdown code blocks instead of scrolling them
  // horizontally. Global (not per block) — it is a reading preference, and the transcript
  // rebuilds its code-block subtrees on every streaming frame. Toggled from any block's
  // wrap button as well as from Settings → Appearance.
  codeWrap: boolean
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
  // Let the pet perform its pack's own skill (row `special` of the sheet): dino
  // breathes fire, miku spins, shiba shakes itself off. Packs without that row
  // (girl, chicken) simply never perform.
  tricks: boolean
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
export type PetSprite = 'girl' | 'shiba' | 'dino' | 'chicken' | 'miku'
export const PET_SPRITES: PetSprite[] = ['girl', 'shiba', 'dino', 'chicken', 'miku']

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

// Sonnet + medium thinking, not Opus + high: a new session should default to what
// routine work costs least, and the model + thinking level are one click away in the
// composer for the turns that need more. An agentic turn re-reads its whole prompt on
// every tool call, so the model choice multiplies across ~8-20 requests per turn.
const DEFAULT_DEFAULTS: SessionDefaults = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  instructions: '',
  provider: 'anthropic',
  modelId: 'claude-sonnet-5',
  mode: 'ask',
  thinkingLevel: 'medium',
}

// Deliberately plain: it must do something sensible with no setup, and the user's
// own review workflow (a skill, a house checklist, a language) is exactly what the
// setting is for.
export const DEFAULT_PR_REVIEW_PROMPT = 'Review pull request {link-pr}'

const DEFAULT_GIT: GitSettings = {
  autoCommitPerPhase: true,
  commitCoAuthor: true,
  autoCommitMessageTemplate: '[{phaseId}] {agentName}: {summary}',
  autoCommitScope: 'workspace',
  autoStashDirtyBeforeTask: false,
  dirtyTaskPolicy: 'warn',
  autoFetchIntervalMs: 300_000,
  commitMessageRule: DEFAULT_COMMIT_MESSAGE_RULE,
  prReviewPrompt: DEFAULT_PR_REVIEW_PROMPT,
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
  agentsCatalogEnabled: true,
  skillsCatalogEnabled: true,
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
  // Off by default: `pre` semantics (a line is a line) is what most code expects; wrapping
  // is opt-in for the sessions where reading a long JSON line beats keeping its shape.
  codeWrap: false,
}

// Opt-in: a window floating above every other app is not something to turn on for
// someone. Off until the user asks for it in Settings → Appearance.
const DEFAULT_PET: PetSettings = {
  enabled: false,
  scale: 1,
  sprite: 'girl',
  autoPeek: true,
  quips: true,
  tricks: true,
  quipLines: {},
  reminderMinutes: 30,
  pos: null,
}

export const PET_REMINDER_CHOICES = [0, 15, 30, 60] as const

// Off by default: the status bar already ships purpose-built chips, so the custom
// line is opt-in. The seed template shows the four things people ask for first and
// demonstrates the `|` segment separator (a segment whose variables all resolve
// empty is dropped, so no dangling dividers when there is no session).
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

// --- persistence (providers excluded — sidecar is their truth) ---
// localStorage holds BOTH kinds under one key: the local-only view state (its
// only home) and a cache of the synced slices (first-paint seed). settings.json
// holds the synced slices alone.
const STORAGE_KEY = 'awog-settings-v1'
// One-shot marker: flip installs that still carry the old Geist default to System.
const SANS_NATIVE_MIGRATION_KEY = 'awog-sans-native-v1'

// The slices that travel with the user: functional prefs + anything a reinstall
// should keep. Order = write order in settings.json (cosmetic only).
interface SyncedShape {
  defaults: SessionDefaults
  git: GitSettings
  sessions: SessionSettings
  quota: QuotaWarningSettings
  autoUpdate: AutoUpdateSettings
  appearance: AppearanceExtras
  pet: PetSettings
  githubAccount: string
  githubAutoFetchMs: number
  githubNotify: GithubNotifySettings
  notifications: NotificationSettings
  translate: TranslateSettings
  context: ContextSettings
  keymap: KeymapBlob
  // Ngữ cảnh hạ tầng mặc định của TOÀN APP (ADR 0088 §7) — tầng cuối của chuỗi kế
  // thừa phiên → project → app. Ma trận quyền hạ tầng KHÔNG ở đây: nó là quyết định
  // khác (lớp lệnh nào được chạy thẳng), có nhà riêng.
  infra: InfraContext
}

const SYNCED_KEYS: readonly (keyof SyncedShape)[] = [
  'defaults',
  'git',
  'sessions',
  'quota',
  'autoUpdate',
  'appearance',
  'pet',
  'githubAccount',
  'githubAutoFetchMs',
  'githubNotify',
  'notifications',
  'translate',
  'context',
  'keymap',
  'infra',
]

// Machine-local view state — never written to settings.json (a panel width from a
// 32" monitor is meaningless on a laptop, and workspacePath is re-derived from
// app:info on every boot).
interface LocalShape {
  workspacePath: string
  workspacePanel: WorkspacePanelLayout
}

type PersistShape = SyncedShape & LocalShape

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// True when this install already had a localStorage blob — the signal that a
// first hydrate finding an empty settings.json is a MIGRATION, not a fresh install.
let hadLocalBlob = false

function loadPersisted(): Partial<PersistShape> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    hadLocalBlob = true
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

// Debounce for the settings.json write: long enough that dragging a slider or a
// panel edge collapses into one IPC round-trip, short enough to land before the
// user can close the window.
const PUSH_DEBOUNCE_MS = 500

// Precedence, low → high. 'default' (UI built-in) is not a stored tier, so it is
// only ever returned by `originOf`.
export type LayerScope = 'user' | 'project'

interface ResolveSettingsResponse {
  user: Record<string, unknown>
  project: Record<string, unknown> | null
  effective: Record<string, unknown>
  origin: Record<string, string>
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
  // Không có mặc định xuất xưởng: "chưa chọn gì" là trạng thái đúng cho một máy chưa
  // cấu hình AWS/kubectl. compact() để một blob cũ mang khoá lạ không lọt vào slice.
  const infra = reactive<InfraContext>(compactInfraContext(persisted.infra))
  // Opaque here on purpose: useKeymap owns the combo schema + its validation, this
  // store only carries the blob to and from disk (SoC — no key-binding logic here).
  const keymap = ref<KeymapBlob>({ ...persisted.keymap })

  // Bumped whenever a persisted slice is saved (see the watch below). Lets the
  // Settings modal render a debounced "saved" toast without re-declaring the
  // slice list. Not itself watched/persisted, so bumping never re-triggers the
  // persist. Only increments on real changes (the watch has no `immediate`, so
  // the initial hydrate from localStorage doesn't tick it).
  const savedTick = ref(0)

  // Snapshot of the slices that belong in settings.json (plain objects — the
  // reactive proxies would otherwise reach IPC and fail to serialize).
  const syncedSnapshot = (): SyncedShape => ({
    defaults: { ...defaults },
    git: { ...git },
    sessions: { ...sessions },
    quota: { ...quota },
    autoUpdate: { ...autoUpdate },
    appearance: { ...appearance },
    pet: { ...pet, quipLines: { ...pet.quipLines } },
    githubAccount: githubAccount.value,
    githubAutoFetchMs: githubAutoFetchMs.value,
    githubNotify: { ...githubNotify, projectIds: [...githubNotify.projectIds] },
    notifications: { ...notifications },
    translate: { ...translate },
    context: { ...context },
    keymap: { ...keymap.value },
    infra: { ...infra },
  })

  // --- settings.json sync (user tier) ---------------------------------------
  // Disk is the truth; the store only pushes AFTER it has read disk once, so a
  // boot-time cache value can never overwrite a newer file. `lastPushed` keeps
  // the debounced writer idempotent (the deep watch fires on every drag frame).
  let hydratedSettings = false
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  let lastPushed = ''

  async function pushSynced(): Promise<void> {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    const patch = syncedSnapshot()
    const json = JSON.stringify(patch)
    if (json === lastPushed) return
    lastPushed = json
    try {
      await sidecar.request('settings.set', { patch })
    } catch (err) {
      // Non-fatal: the localStorage copy still holds the change for this machine.
      lastPushed = ''
      console.warn('[settings] settings.set failed', err)
    }
  }

  function schedulePush(): void {
    if (!hydratedSettings) return
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      pushTimer = null
      void pushSynced()
    }, PUSH_DEBOUNCE_MS)
  }

  // Apply a settings.json blob over the in-memory slices. Every slice is checked
  // for shape first — the file is user-editable, so it is L1 input.
  function applySynced(blob: Record<string, unknown>): void {
    if (isObj(blob.defaults)) Object.assign(defaults, blob.defaults)
    if (!defaults.systemPrompt) defaults.systemPrompt = DEFAULT_SYSTEM_PROMPT
    if (isObj(blob.git)) Object.assign(git, blob.git)
    if (isObj(blob.sessions)) Object.assign(sessions, blob.sessions)
    if (isObj(blob.quota)) Object.assign(quota, blob.quota)
    if (isObj(blob.autoUpdate)) Object.assign(autoUpdate, blob.autoUpdate)
    if (isObj(blob.appearance)) Object.assign(appearance, blob.appearance)
    if (isObj(blob.pet)) Object.assign(pet, blob.pet)
    if (!PET_SPRITES.includes(pet.sprite)) pet.sprite = PET_SPRITES[0]!
    if (typeof blob.githubAccount === 'string') githubAccount.value = blob.githubAccount
    if (typeof blob.githubAutoFetchMs === 'number') githubAutoFetchMs.value = blob.githubAutoFetchMs
    if (isObj(blob.githubNotify)) Object.assign(githubNotify, blob.githubNotify)
    if (isObj(blob.notifications)) Object.assign(notifications, blob.notifications)
    if (isObj(blob.translate)) Object.assign(translate, blob.translate)
    if (isObj(blob.context)) Object.assign(context, blob.context)
    if (isObj(blob.keymap)) keymap.value = { ...blob.keymap }
    // Thay TRỌN cụm chứ không Object.assign: bỏ ghim một field = XOÁ khoá đó khỏi
    // file, nên merge sẽ giữ lại giá trị cũ và hoàn tác đúng thao tác vừa làm.
    if (isObj(blob.infra)) applyInfra(blob.infra as InfraContext)
  }

  // Ghi đè toàn bộ cụm `infra` trên một object reactive (không thay được tham chiếu
  // vì các component đã bind vào nó): xoá khoá không còn, gán khoá còn lại.
  function applyInfra(next: InfraContext): void {
    const clean = compactInfraContext(next)
    for (const field of INFRA_FIELDS) {
      const value = clean[field]
      if (value === undefined) delete infra[field]
      else infra[field] = value
    }
  }

  // Read the user tier once per app session, then push the merged snapshot back so
  // settings.json ends up complete. That single push IS the one-way migration for
  // installs whose prefs only ever lived in localStorage: nothing is deleted from
  // localStorage, so a rollback still finds its config.
  async function hydrateSettings(): Promise<void> {
    if (hydratedSettings) return
    const sidecar = useSidecar()
    if (!sidecar.available) {
      // Browser-dev: localStorage stays the only store; allow pushes to no-op.
      hydratedSettings = true
      return
    }
    try {
      const blob = await sidecar.request<Record<string, unknown>>('settings.get')
      const known = isObj(blob) ? SYNCED_KEYS.filter((k) => k in blob) : []
      if (known.length > 0) applySynced(blob)
      else if (hadLocalBlob) {
        console.warn('[settings] migrating preferences from localStorage → settings.json')
      }
    } catch (err) {
      console.warn('[settings] settings.get failed', err)
    } finally {
      hydratedSettings = true
    }
    // Not debounced: the first write should land before the user can change
    // anything, and it is a no-op when the file already matches.
    await pushSynced()
  }

  // Persist all preference slices as one blob whenever any of them change:
  // localStorage synchronously (boot cache + local-only state) and settings.json
  // debounced over IPC (the synced slices).
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
      keymap,
      infra,
    ],
    () => {
      if (typeof window === 'undefined') return
      const blob: PersistShape = {
        ...syncedSnapshot(),
        workspacePath: workspacePath.value,
        workspacePanel,
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob))
      } catch {
        // Quota/availability errors are non-fatal — settings stay in memory.
      }
      schedulePush()
      savedTick.value += 1
    },
    { deep: true },
  )

  // --- project tier (read-only overlay) --------------------------------------
  // Loaded on demand for ONE project at a time — the layer a settings row needs to
  // answer "where does this value come from?". Writes go through
  // setProjectOverride / clearProjectOverride, never through the slices above.
  const layerProjectId = ref<string | null>(null)
  const projectLayer = ref<Record<string, unknown>>({})
  const layerOrigin = ref<Record<string, LayerScope>>({})

  async function loadLayers(projectId: string | null): Promise<void> {
    const sidecar = useSidecar()
    layerProjectId.value = projectId
    if (!sidecar.available || !projectId) {
      projectLayer.value = {}
      layerOrigin.value = {}
      return
    }
    try {
      const res = await sidecar.request<ResolveSettingsResponse>('settings.resolve', { projectId })
      projectLayer.value = isObj(res.project) ? res.project : {}
      layerOrigin.value = isObj(res.origin) ? (res.origin as Record<string, LayerScope>) : {}
    } catch (err) {
      // A project without a repo/dir still resolves; anything else degrades to
      // "no overrides" rather than blocking the pane.
      projectLayer.value = {}
      layerOrigin.value = {}
      console.warn('[settings] settings.resolve failed', err)
    }
  }

  // Which tier a value comes from. 'default' = neither tier declares it, so the
  // value on screen is the UI's built-in default.
  const originOf = (path: string): LayerScope | 'default' => layerOrigin.value[path] ?? 'default'

  // A single field of the loaded project overlay (undefined = not overridden).
  function projectValue<T>(slice: keyof SyncedShape, field: string): T | undefined {
    const s = projectLayer.value[slice]
    if (!isObj(s)) return undefined
    const v = s[field]
    return v === undefined ? undefined : (v as T)
  }

  async function setProjectOverride(
    projectId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    await sidecar.request('settings.set', { patch, scope: 'project', projectId })
    await loadLayers(projectId)
  }

  async function clearProjectOverride(projectId: string, paths: string[]): Promise<void> {
    const sidecar = useSidecar()
    if (!sidecar.available || paths.length === 0) return
    await sidecar.request('settings.unset', { paths, scope: 'project', projectId })
    await loadLayers(projectId)
  }

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
      // Settings.json comes along for the ride: this is the one call every window
      // already makes at app lifetime (layouts/default.vue), and hydrateSettings
      // guards itself to run once.
      void hydrateSettings()
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
  // Whole-blob replace: useKeymap owns the schema and always hands over the full
  // binding set, so a field merge would keep stale ids alive after a reset.
  const setKeymap = (blob: KeymapBlob) => {
    keymap.value = { ...blob }
  }

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
    if (!context.agentsCatalogEnabled) out.agentsCatalogEnabled = false
    if (!context.skillsCatalogEnabled) out.skillsCatalogEnabled = false
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

  // Ngữ cảnh hạ tầng mặc định của toàn app (ADR 0088 §7). Nhận TRỌN cụm: field
  // vắng mặt nghĩa là bỏ ghim (khoá bị xoá), field '' nghĩa là "cố ý không ghim" —
  // ở tầng cuối hai cái cho ra cùng kết quả, nhưng vẫn giữ đúng '' vì tầng trên
  // (phiên/project) đọc nó theo ngữ nghĩa "dừng kế thừa".
  const setInfra = (next: InfraContext) => {
    applyInfra(next)
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
    keymap,
    infra,
    savedTick,
    layerProjectId,
    projectLayer,
    // getters
    activeAccount,
    resolveCreatorAccount,
    isProviderConnected,
    keyFingerprint,
    workspaceDockOf,
    originOf,
    projectValue,
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
    setKeymap,
    contextConfig,
    // layered settings (user ← project)
    hydrateSettings,
    loadLayers,
    setProjectOverride,
    clearProjectOverride,
    setWorkspacePath,
    hydrateAppPaths,
    setGithubAccount,
    setInfra,
    setWorkspaceDock,
    setWorkspaceLeftWidth,
    setWorkspaceRightWidth,
    setWorkspaceBottomHeight,
  }
})
