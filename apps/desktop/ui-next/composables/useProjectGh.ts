// Project GitHub controller (port of the old UI useProjectGh, ADR 0049). Owns one
// tab's state — Issues OR Pull Requests, discriminated by `kind`. Talks ONLY to
// the sidecar via gh.* RPC (no fs/child_process/SDK in the UI). Components stay
// thin and bind the refs/handlers this returns.
//
// Translation is per-segment: each translatable block (title / body / a comment
// by index) keys its own cache entry so toggling never re-fetches; default view
// is ALWAYS the original — nothing auto-translates on open.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'

export type GhKind = 'issue' | 'pr'
export type GhListState = 'open' | 'closed' | 'merged' | 'all'

// Wire shapes returned by gh.list / gh.get (sidecar github/thread.ts).
export type GhThreadState = 'OPEN' | 'CLOSED' | 'MERGED'
export interface GhThreadLabel {
  name: string
  color: string
}
export interface GhThreadComment {
  author: { login: string }
  body: string
  createdAt: string
}
export interface GhThreadSummary {
  kind: GhKind
  number: number
  title: string
  state: GhThreadState
  author: { login: string }
  assignees: { login: string }[]
  labels: GhThreadLabel[]
  createdAt: string
  updatedAt: string
  isDraft?: boolean
  baseRefName?: string
  headRefName?: string
}
export interface GhThreadFile {
  path: string
  additions: number
  deletions: number
}
// PR-only: a threaded inline review-comment conversation (root + replies).
export interface GhReviewThreadComment {
  author: { login: string }
  body: string
  createdAt: string
}
export interface GhReviewThread {
  path: string
  line: number | null
  // Unified-diff snippet around the commented line (GitHub's diff_hunk).
  diffHunk: string
  comments: GhReviewThreadComment[]
}
// PR-only: a submitted review (timeline entry) with its nested inline threads.
export interface GhReview {
  author: { login: string }
  state: string
  body: string
  createdAt: string
  threads: GhReviewThread[]
}
export interface GhThread extends GhThreadSummary {
  body: string
  url: string
  comments: GhThreadComment[]
  // PR-only (absent / empty for issues).
  files?: GhThreadFile[]
  reviews?: GhReview[]
}

export interface GhAccount {
  login: string
  active: boolean
  scopes: string
}

// Per-segment translation cache entry — one per (segment, language).
export interface GhSegmentState {
  translated?: string
  loading: boolean
  error?: boolean
}
// Comments come before PR reviews; a review segment is keyed `r<index>` so its
// cache never collides with a comment at the same index.
export type GhSegmentId = 'title' | 'body' | number | `r${number}`
// Translation targets, ordered by priority (vi, en, ja). LANG_LABEL maps each to
// the language NAME the gh.translate / gh.* RPC expects.
export type TranslateLang = 'vi' | 'en' | 'ja'
const LANG_LABEL: Record<TranslateLang, string> = {
  vi: 'Vietnamese',
  en: 'English',
  ja: 'Japanese',
}
export type ViewLang = 'orig' | TranslateLang

// A parsed per-file section of a raw unified diff (split on `diff --git`). `patch`
// keeps only the hunks (the `@@ … @@` ranges + their lines), header lines dropped.
export interface GhDiffFile {
  path: string
  patch: string
}

// One PR commit (gh.commits). `sha` is the full oid (the UI shortens for display).
export interface GhCommit {
  sha: string
  message: string
  author: string
  date: string
}

const segmentKey = (id: GhSegmentId, lang: TranslateLang): string =>
  `${typeof id === 'number' ? `c${id}` : id}|${lang}`

// Split a raw unified diff into per-file sections. Each `diff --git a/… b/…` block
// becomes one entry; the path is taken from the `+++ b/<path>` header (falling back
// to the `diff --git` line for adds/deletes), and only the hunk lines (`@@ …`
// onward) are kept for display.
function parseUnifiedDiff(patch: string): GhDiffFile[] {
  const out: GhDiffFile[] = []
  // Split keeping the `diff --git` marker on each chunk.
  const chunks = patch.split(/^(?=diff --git )/m)
  for (const chunk of chunks) {
    if (!chunk.startsWith('diff --git ')) continue
    const lines = chunk.split('\n')
    let path = ''
    let hunkStart = -1
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i] ?? ''
      if (ln.startsWith('+++ ')) {
        path = ln.slice(4).replace(/^b\//, '').trim()
      } else if (ln.startsWith('@@')) {
        hunkStart = i
        break
      }
    }
    if (!path) {
      // No `+++` (e.g. a pure rename / mode change) → derive from the git line.
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(lines[0] ?? '')
      path = (m?.[2] ?? m?.[1] ?? '').trim()
    }
    const body = hunkStart >= 0 ? lines.slice(hunkStart).join('\n').replace(/\n+$/, '') : ''
    if (path) out.push({ path, patch: body })
  }
  return out
}

// The sidecar gh.* surface throws RpcError(code, message, { ghCode }) — the stable
// dispatch key lives in data.ghCode, not the message.
const GH_CODES = ['GH_NOT_FOUND', 'GH_NOT_AUTH', 'GH_NO_REPO'] as const
const ghCodeOf = (err: unknown): string => {
  const data = (err as { data?: unknown } | null)?.data
  if (data && typeof data === 'object' && 'ghCode' in data) {
    const code = (data as { ghCode?: unknown }).ghCode
    if (typeof code === 'string' && (GH_CODES as readonly string[]).includes(code)) return code
  }
  return 'UNKNOWN'
}

// Process-wide gh response cache (shared across instances + survives tab remounts):
// the list + each thread/diff/commits are fetched once and reused for up to an hour,
// so re-opening an issue/PR — or re-entering the GH tab — doesn't re-hit gh. The
// manual Refresh forces a re-fetch; posting a comment / approving invalidates the
// affected thread. Cleared on app reload (in-memory) — the "first time" each session.
const GH_TTL_MS = 60 * 60 * 1000
type GhCacheEntry = { data: unknown; at: number }
const ghCache = new Map<string, GhCacheEntry>()
function ghCacheRead<T>(key: string): T | null {
  const e = ghCache.get(key)
  if (!e) return null
  if (Date.now() - e.at > GH_TTL_MS) {
    ghCache.delete(key)
    return null
  }
  return e.data as T
}
function ghCacheWrite(key: string, data: unknown): void {
  ghCache.set(key, { data, at: Date.now() })
}

export function useProjectGh(
  getProjectId: () => string,
  getKind: () => GhKind,
  getRepoPath: () => string | undefined = () => undefined,
) {
  const sc = useSidecar()
  const settings = useSettingsStore()
  const projectsStore = useProjectsStore()

  const items = ref<GhThreadSummary[]>([])
  const loading = ref(false)
  const errorCode = ref<string | null>(null)

  const stateFilter = ref<GhListState>('open')
  const assigneeFilter = ref<string>('') // '' = anyone; '@me' or a login otherwise.
  const searchQuery = ref('')
  // How many rows to request — bumped by loadMore() for the plain (non-search) list.
  const PAGE = 50
  const pageLimit = ref(PAGE)

  const selected = ref<GhThread | null>(null)
  const drawerOpen = ref(false)
  const detailLoading = ref(false)
  const segments = ref<Record<string, GhSegmentState>>({})
  const viewLang = ref<ViewLang>('orig')

  // Comment composer (bottom of the drawer): the draft body + in-flight flags for
  // posting and the LLM enhance pass. Reset whenever a thread opens.
  const commentDraft = ref('')
  const posting = ref(false)
  const enhancing = ref(false)
  // Snapshot stack of the draft before each translate/enhance, so the user can undo
  // an AI rewrite they don't like. Cleared when the thread changes / a comment posts.
  const draftUndo = ref<string[]>([])
  const canUndoDraft = computed(() => draftUndo.value.length > 0)
  const pushDraftUndo = (): void => {
    draftUndo.value = [...draftUndo.value, commentDraft.value]
  }
  const undoDraft = (): void => {
    const stack = draftUndo.value
    if (!stack.length) return
    commentDraft.value = stack[stack.length - 1] ?? ''
    draftUndo.value = stack.slice(0, -1)
  }

  // PR diff cache. `diffFiles` is the parsed per-file sections of the thread's raw
  // unified patch (fetched once via gh.diff per opened PR); `diffLoading` covers the
  // round-trip. Cleared when a thread opens so a new PR re-fetches.
  const diffFiles = ref<GhDiffFile[]>([])
  const diffLoading = ref(false)
  const diffLoaded = ref(false)

  // PR commits cache (Commits tab). Fetched once via gh.commits per opened PR;
  // `commitsLoading` covers the round-trip. Cleared when a thread opens so a new
  // PR re-fetches.
  const commits = ref<GhCommit[]>([])
  const commitsLoading = ref(false)
  const commitsLoaded = ref(false)

  // Per-project gh account OVERRIDE. Three states:
  //   '__inherit' → follow the app-level default (settings.githubAccount)
  //   ''          → explicitly "active gh account"
  //   '<login>'   → explicit account
  // The GH tab picker writes this; loadFilters seeds it (default = inherit).
  const INHERIT = '__inherit'
  const account = ref<string>(INHERIT)

  // The account this project's GH ops resolve to when inheriting: the project's
  // own GitHub-account setting (Project.githubAccount, set in Overview), else the
  // app-level default. '' = active gh account.
  const inheritedAccount = computed<string>(() => {
    const proj = projectsStore.projectById(getProjectId())
    return (proj?.githubAccount ?? settings.githubAccount).trim()
  })
  // The account actually sent to gh: an explicit per-tab override wins; INHERIT
  // resolves to the project setting → app default. '' means "omit the param" so
  // gh uses its active login.
  const effectiveAccount = computed<string>(() =>
    account.value === INHERIT ? inheritedAccount.value : account.value,
  )
  // What the picker's "inherit" row resolves to (project setting → app default).
  const globalAccount = computed<string>(() => inheritedAccount.value)

  // Persisted filters (state / assignee / account) per project+kind so they
  // survive an app restart. localStorage holds a `{ "<projectId>:<kind>": {...} }`
  // map; search is intentionally NOT persisted (transient text query). `account`
  // '' means "follow gh's active account".
  const FILTER_KEY = 'awog.gh.filters'
  type SavedFilter = { state: GhListState; assignee: string; account: string }
  const filterKey = (): string => `${getProjectId()}:${getKind()}`
  const readAllFilters = (): Record<string, SavedFilter> => {
    try {
      const raw = localStorage.getItem(FILTER_KEY)
      return raw ? (JSON.parse(raw) as Record<string, SavedFilter>) : {}
    } catch {
      return {}
    }
  }
  const loadFilters = (): void => {
    const saved = readAllFilters()[filterKey()]
    let state: GhListState = saved?.state ?? 'open'
    // 'merged' is PR-only — never restore it onto the Issues tab.
    if (getKind() !== 'pr' && state === 'merged') state = 'open'
    stateFilter.value = state
    assigneeFilter.value = saved?.assignee ?? ''
    account.value = saved?.account ?? INHERIT
    searchQuery.value = ''
  }
  const saveFilters = (): void => {
    try {
      const all = readAllFilters()
      all[filterKey()] = {
        state: stateFilter.value,
        assignee: assigneeFilter.value,
        account: account.value,
      }
      localStorage.setItem(FILTER_KEY, JSON.stringify(all))
    } catch {
      // localStorage unavailable (private mode / quota) — filters won't persist.
    }
  }
  loadFilters()

  const knownAssignees = computed<string[]>(() => {
    const set = new Set<string>()
    for (const it of items.value) for (const a of it.assignees) set.add(a.login)
    return [...set].sort((a, b) => a.localeCompare(b))
  })

  // Search is now resolved server-side (see refresh) so the loaded rows are
  // already the matches — no client-side narrowing (which only ever saw the
  // current page and broke on `#<number>`).
  const visibleItems = computed<GhThreadSummary[]>(() => items.value)

  // There may be more rows when the plain list came back full to the limit. Hidden
  // while searching (search returns its own scoped set).
  const canLoadMore = computed(
    () => !searchQuery.value.trim() && !loading.value && items.value.length >= pageLimit.value,
  )

  // Cache keys — scoped to project + child repo + account so they never collide.
  const ck = (): string =>
    `${getProjectId()}|${getRepoPath() ?? ''}|${getKind()}|${effectiveAccount.value}`
  const listKey = (): string =>
    `L|${ck()}|${stateFilter.value}|${assigneeFilter.value}|${searchQuery.value.trim()}|${pageLimit.value}`
  const threadKey = (n: number): string => `T|${ck()}|${n}`
  const diffKey = (n: number): string => `D|${ck()}|${n}`
  const commitsKey = (n: number): string => `C|${ck()}|${n}`

  // The real gh.list round-trip. Cache-first unless `force` (the manual Refresh).
  const refresh = async (opts: { force?: boolean } = {}): Promise<void> => {
    if (!sc.available) {
      errorCode.value = 'GH_NOT_FOUND'
      items.value = []
      return
    }
    const projectId = getProjectId()
    if (!projectId) return
    if (!opts.force) {
      const cached = ghCacheRead<GhThreadSummary[]>(listKey())
      if (cached) {
        items.value = cached
        errorCode.value = null
        return
      }
    }
    loading.value = true
    try {
      const params: {
        projectId: string
        kind: GhKind
        state: GhListState
        assignee?: string
        account?: string
        repoPath?: string
        search?: string
        limit?: number
      } = { projectId, kind: getKind(), state: stateFilter.value, limit: pageLimit.value }
      if (assigneeFilter.value) params.assignee = assigneeFilter.value
      if (effectiveAccount.value) params.account = effectiveAccount.value
      const repoPath = getRepoPath()
      if (repoPath) params.repoPath = repoPath
      const q = searchQuery.value.trim()
      if (q) params.search = q
      const res = await sc.request<{ items: GhThreadSummary[] }>('gh.list', params)
      items.value = res.items
      ghCacheWrite(listKey(), res.items)
      errorCode.value = null
    } catch (err) {
      items.value = []
      errorCode.value = ghCodeOf(err)
    } finally {
      loading.value = false
    }
  }

  const open = async (number: number, opts: { force?: boolean } = {}): Promise<void> => {
    drawerOpen.value = true
    detailLoading.value = true
    selected.value = null
    segments.value = {}
    viewLang.value = 'orig'
    commentDraft.value = ''
    draftUndo.value = []
    diffFiles.value = []
    diffLoaded.value = false
    diffLoading.value = false
    commits.value = []
    commitsLoaded.value = false
    commitsLoading.value = false
    reviewed.value = false
    reviewError.value = false
    const projectId = getProjectId()
    if (!sc.available || !projectId) {
      detailLoading.value = false
      return
    }
    if (!opts.force) {
      const cached = ghCacheRead<GhThread>(threadKey(number))
      if (cached) {
        selected.value = cached
        detailLoading.value = false
        return
      }
    }
    try {
      const params: {
        projectId: string
        kind: GhKind
        number: number
        account?: string
        repoPath?: string
      } = {
        projectId,
        kind: getKind(),
        number,
      }
      if (effectiveAccount.value) params.account = effectiveAccount.value
      const repoPath = getRepoPath()
      if (repoPath) params.repoPath = repoPath
      const thread = await sc.request<GhThread>('gh.get', params)
      selected.value = thread
      ghCacheWrite(threadKey(number), thread)
    } catch (err) {
      errorCode.value = ghCodeOf(err)
      drawerOpen.value = false
    } finally {
      detailLoading.value = false
    }
  }

  // Fetch a thread's full detail WITHOUT touching drawer state — used to capture an
  // issue/PR's body as context when spawning a session from it (so the model gets it
  // up front instead of re-fetching). Returns null on failure / browser-dev.
  const fetchThread = async (number: number): Promise<GhThread | null> => {
    const projectId = getProjectId()
    if (!sc.available || !projectId) return null
    const cached = ghCacheRead<GhThread>(threadKey(number))
    if (cached) return cached
    try {
      const params: {
        projectId: string
        kind: GhKind
        number: number
        account?: string
        repoPath?: string
      } = { projectId, kind: getKind(), number }
      if (effectiveAccount.value) params.account = effectiveAccount.value
      const repoPath = getRepoPath()
      if (repoPath) params.repoPath = repoPath
      const thread = await sc.request<GhThread>('gh.get', params)
      ghCacheWrite(threadKey(number), thread)
      return thread
    } catch {
      return null
    }
  }

  const closeDrawer = (): void => {
    drawerOpen.value = false
    selected.value = null
    segments.value = {}
    viewLang.value = 'orig'
    commentDraft.value = ''
    draftUndo.value = []
    diffFiles.value = []
    diffLoaded.value = false
    commits.value = []
    commitsLoaded.value = false
  }

  const segmentTranslation = (id: GhSegmentId): GhSegmentState | null => {
    if (viewLang.value === 'orig') return null
    const key = segmentKey(id, viewLang.value)
    if (!segments.value[key]) segments.value[key] = { loading: false }
    return segments.value[key]!
  }

  // Resolve provider/model/account for gh.translate from the project's LLM
  // defaults (with app-default fallback), mapping the display catalog → engine id.
  const translateSettings = (): {
    provider: 'anthropic' | 'openai' | 'google'
    modelId: string
    accountId?: string
  } => {
    const ld = projectsStore.projectById(getProjectId())?.llmDefaults
    if (ld) {
      return {
        provider: ld.provider,
        modelId: ld.modelId,
        ...(ld.accountId ? { accountId: ld.accountId } : {}),
      }
    }
    return { provider: settings.defaults.provider, modelId: settings.defaults.modelId }
  }

  const translateOne = async (
    id: GhSegmentId,
    text: string,
    lang: TranslateLang,
  ): Promise<void> => {
    const key = segmentKey(id, lang)
    if (!segments.value[key]) segments.value[key] = { loading: false }
    const s = segments.value[key]!
    if (s.translated !== undefined || s.loading) return
    if (!text.trim()) {
      s.translated = text
      return
    }
    s.loading = true
    s.error = false
    try {
      const { provider, modelId, accountId } = translateSettings()
      const res = await sc.request<{ text: string }>('gh.translate', {
        text,
        targetLang: LANG_LABEL[lang],
        provider,
        modelId,
        ...(accountId ? { accountId } : {}),
      })
      s.translated = res.text
    } catch {
      s.error = true
    } finally {
      s.loading = false
    }
  }

  const setViewLang = (lang: ViewLang): void => {
    viewLang.value = lang
    if (lang === 'orig') return
    const thread = selected.value
    if (!thread) return
    void translateOne('title', thread.title, lang)
    void translateOne('body', thread.body || '', lang)
    thread.comments.forEach((c, i) => void translateOne(i, c.body, lang))
    // PR review bodies translate too (keyed `r<index>` to avoid colliding with the
    // comment at the same numeric index).
    ;(thread.reviews ?? []).forEach((r, i) => void translateOne(`r${i}`, r.body, lang))
  }

  // ── PR diff (lazy, cached) ──────────────────────────────────────────────────
  // Fetch the open thread's raw unified patch once and parse it into per-file
  // sections. Idempotent: a second call (or one while already loading) is a no-op,
  // so a file row can call this on first reveal without coordinating with siblings.
  const loadDiff = async (number: number): Promise<void> => {
    if (diffLoaded.value || diffLoading.value) return
    const cached = ghCacheRead<GhDiffFile[]>(diffKey(number))
    if (cached) {
      diffFiles.value = cached
      diffLoaded.value = true
      return
    }
    const projectId = getProjectId()
    if (!sc.available || !projectId) return
    diffLoading.value = true
    try {
      const params: {
        projectId: string
        kind: GhKind
        number: number
        account?: string
        repoPath?: string
      } = { projectId, kind: getKind(), number }
      if (effectiveAccount.value) params.account = effectiveAccount.value
      const repoPath = getRepoPath()
      if (repoPath) params.repoPath = repoPath
      const res = await sc.request<{ patch: string }>('gh.diff', params)
      diffFiles.value = parseUnifiedDiff(res.patch || '')
      diffLoaded.value = true
      ghCacheWrite(diffKey(number), diffFiles.value)
    } catch {
      // Leave diffFiles empty + not-loaded so the UI can show its no-diff state and
      // a later open() can retry.
      diffFiles.value = []
    } finally {
      diffLoading.value = false
    }
  }

  // ── PR commits (lazy, cached) ───────────────────────────────────────────────
  // Fetch the open PR's commit list once (gh.commits) when the Commits tab is
  // first opened. Idempotent: a second call (or one while already loading) is a
  // no-op. Issues return an empty list server-side.
  const loadCommits = async (number: number): Promise<void> => {
    if (commitsLoaded.value || commitsLoading.value) return
    const cached = ghCacheRead<GhCommit[]>(commitsKey(number))
    if (cached) {
      commits.value = cached
      commitsLoaded.value = true
      return
    }
    const projectId = getProjectId()
    if (!sc.available || !projectId) return
    commitsLoading.value = true
    try {
      const params: {
        projectId: string
        kind: GhKind
        number: number
        account?: string
        repoPath?: string
      } = { projectId, kind: getKind(), number }
      if (effectiveAccount.value) params.account = effectiveAccount.value
      const repoPath = getRepoPath()
      if (repoPath) params.repoPath = repoPath
      const res = await sc.request<{ commits: GhCommit[] }>('gh.commits', params)
      commits.value = res.commits
      commitsLoaded.value = true
      ghCacheWrite(commitsKey(number), res.commits)
    } catch {
      // Leave commits empty + not-loaded so the UI can show its empty state and a
      // later open() can retry.
      commits.value = []
    } finally {
      commitsLoading.value = false
    }
  }

  // ── Comment / reply ─────────────────────────────────────────────────────────
  // Post the composer draft as a comment, then refetch the thread so the new
  // comment appears (replies are flat — a reply is just a comment quoting its
  // parent, composed client-side). Clears the draft on success.
  const postComment = async (number: number): Promise<boolean> => {
    const body = commentDraft.value.trim()
    const projectId = getProjectId()
    if (!body || posting.value || !sc.available || !projectId) return false
    posting.value = true
    try {
      const params: {
        projectId: string
        kind: GhKind
        number: number
        body: string
        account?: string
        repoPath?: string
      } = { projectId, kind: getKind(), number, body }
      if (effectiveAccount.value) params.account = effectiveAccount.value
      const repoPath = getRepoPath()
      if (repoPath) params.repoPath = repoPath
      await sc.request<{ url: string }>('gh.comment', params)
      commentDraft.value = ''
      // open() resets posting-adjacent state; run it after we flip posting off.
      posting.value = false
      await open(number, { force: true }) // force: the thread changed, bypass cache
      return true
    } catch {
      posting.value = false
      return false
    }
  }

  // ── Enhance the draft (smooth prose) ────────────────────────────────────────
  // One-shot rewrite of the comment draft via gh.enhance (same provider/model the
  // translation path resolves). Leaves the draft unchanged on failure.
  const enhanceDraft = async (): Promise<void> => {
    const text = commentDraft.value.trim()
    if (!text || enhancing.value || !sc.available) return
    enhancing.value = true
    try {
      const { provider, modelId, accountId } = translateSettings()
      const res = await sc.request<{ text: string }>('gh.enhance', {
        text,
        provider,
        modelId,
        ...(accountId ? { accountId } : {}),
      })
      if (res.text) {
        pushDraftUndo()
        commentDraft.value = res.text
      }
    } catch {
      // Keep the user's draft as-is on a network / model error.
    } finally {
      enhancing.value = false
    }
  }

  // Translate the comment draft in place into a target language (vi/en/ja) before
  // posting. Reuses gh.translate; keeps the draft on failure.
  const translatingDraft = ref(false)
  const translateDraft = async (lang: TranslateLang): Promise<void> => {
    const text = commentDraft.value.trim()
    if (!text || translatingDraft.value || !sc.available) return
    translatingDraft.value = true
    try {
      const { provider, modelId, accountId } = translateSettings()
      const res = await sc.request<{ text: string }>('gh.translate', {
        text,
        targetLang: LANG_LABEL[lang],
        provider,
        modelId,
        ...(accountId ? { accountId } : {}),
      })
      if (res.text) {
        pushDraftUndo()
        commentDraft.value = res.text
      }
    } catch {
      // Keep the draft as-is on a network / model error.
    } finally {
      translatingDraft.value = false
    }
  }

  // Approve the open PR with an "LGTM!" review (gh pr review --approve --body). On
  // success refetch so the approval shows; on failure (own PR / closed / already
  // reviewed) surface a flag the drawer renders inline.
  const reviewing = ref(false)
  const reviewError = ref(false)
  // True once approved this session (reset by open() when a thread loads) — drives
  // hiding the Approve button + showing the "approved" marker.
  const reviewed = ref(false)
  const approvePr = async (): Promise<void> => {
    const number = selected.value?.number
    if (!number || reviewing.value || !sc.available) return
    reviewing.value = true
    reviewError.value = false
    try {
      const params: {
        projectId: string
        number: number
        event: 'approve'
        body: string
        account?: string
        repoPath?: string
      } = { projectId: getProjectId(), number, event: 'approve', body: 'LGTM!' }
      if (effectiveAccount.value) params.account = effectiveAccount.value
      const rp = getRepoPath()
      if (rp) params.repoPath = rp
      await sc.request('gh.review', params)
      await open(number, { force: true }) // refetch (resets reviewed) → then mark below
      reviewed.value = true
    } catch {
      reviewError.value = true
    } finally {
      reviewing.value = false
    }
  }

  // Manual refresh of the open thread (drawer header button) — drop its cached
  // thread + diff + commits, then re-fetch fresh.
  const refreshThread = async (): Promise<void> => {
    const n = selected.value?.number
    if (n == null) return
    ghCache.delete(diffKey(n))
    ghCache.delete(commitsKey(n))
    await open(n, { force: true })
  }

  const setStateFilter = (next: GhListState): void => {
    if (next === stateFilter.value) return
    stateFilter.value = next
    pageLimit.value = PAGE
    saveFilters()
    void refresh()
  }
  const setAssigneeFilter = (next: string): void => {
    if (next === assigneeFilter.value) return
    assigneeFilter.value = next
    pageLimit.value = PAGE
    saveFilters()
    void refresh()
  }
  const setAccount = (login: string): void => {
    if (login === account.value) return
    account.value = login
    pageLimit.value = PAGE
    saveFilters()
    void refresh()
  }

  // Search runs server-side (whole repo, not just the loaded page), so debounce
  // keystrokes into one refetch. NOT persisted (transient query).
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  const setSearch = (q: string): void => {
    searchQuery.value = q
    pageLimit.value = PAGE
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void refresh(), 350)
  }

  // Load the next page of the plain list (bump the limit + refetch).
  const loadMore = (): void => {
    if (!canLoadMore.value) return
    pageLimit.value += PAGE
    void refresh()
  }

  // Re-fetch + reload this project's saved filters when the bound project — or the
  // selected child repo (multi-repo workspace) — changes. Kind does NOT trigger a
  // refetch: Issues / Pull Requests are separate, independently-cached ProjectGh
  // instances (see ProjectDetail), so switching tabs shows already-loaded data —
  // re-pull via the manual fetch button.
  watch([getProjectId, getRepoPath], () => {
    closeDrawer()
    loadFilters()
    pageLimit.value = PAGE
    items.value = []
    void refresh()
  })

  // When the inherited account moves (the app-level default OR this project's own
  // GitHub-account setting changed) and this project is inheriting, the effective
  // account moved → re-fetch (the cache key already keys on it).
  watch(
    () => inheritedAccount.value,
    () => {
      if (account.value === INHERIT) void refresh()
    },
  )

  onMounted(() => void refresh())
  onBeforeUnmount(() => closeDrawer())

  return {
    // state
    items,
    visibleItems,
    canLoadMore,
    knownAssignees,
    loading,
    errorCode,
    stateFilter,
    assigneeFilter,
    searchQuery,
    account,
    globalAccount,
    selected,
    drawerOpen,
    detailLoading,
    viewLang,
    commentDraft,
    translatingDraft,
    posting,
    enhancing,
    diffFiles,
    diffLoading,
    diffLoaded,
    commits,
    commitsLoading,
    commitsLoaded,
    // actions
    refresh,
    open,
    fetchThread,
    closeDrawer,
    segmentTranslation,
    setViewLang,
    setStateFilter,
    setAssigneeFilter,
    setAccount,
    setSearch,
    loadMore,
    loadDiff,
    loadCommits,
    postComment,
    enhanceDraft,
    translateDraft,
    canUndoDraft,
    undoDraft,
    reviewing,
    reviewError,
    reviewed,
    approvePr,
    refreshThread,
  }
}
