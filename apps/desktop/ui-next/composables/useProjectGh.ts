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
export interface GhThreadReview {
  author: { login: string }
  body: string
  state: string
  createdAt: string
}
export interface GhThread extends GhThreadSummary {
  body: string
  url: string
  comments: GhThreadComment[]
  // PR-only (absent / empty for issues).
  files?: GhThreadFile[]
  reviews?: GhThreadReview[]
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
export type GhSegmentId = 'title' | 'body' | number
export type TranslateLang = 'vi' | 'en'
const LANG_LABEL: Record<TranslateLang, string> = { vi: 'Vietnamese', en: 'English' }
export type ViewLang = 'orig' | TranslateLang

const segmentKey = (id: GhSegmentId, lang: TranslateLang): string =>
  `${typeof id === 'number' ? `c${id}` : id}|${lang}`

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

  // gh account override (empty = follow gh's active account). Sourced from the
  // app-level setting; the GH tab also lets the user pick per-tab.
  const account = ref<string>(settings.githubAccount.trim())

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
    account.value = saved?.account ?? settings.githubAccount.trim()
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

  // The real gh.list round-trip.
  const refresh = async (): Promise<void> => {
    if (!sc.available) {
      errorCode.value = 'GH_NOT_FOUND'
      items.value = []
      return
    }
    const projectId = getProjectId()
    if (!projectId) return
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
      if (account.value) params.account = account.value
      const repoPath = getRepoPath()
      if (repoPath) params.repoPath = repoPath
      const q = searchQuery.value.trim()
      if (q) params.search = q
      const res = await sc.request<{ items: GhThreadSummary[] }>('gh.list', params)
      items.value = res.items
      errorCode.value = null
    } catch (err) {
      items.value = []
      errorCode.value = ghCodeOf(err)
    } finally {
      loading.value = false
    }
  }

  const open = async (number: number): Promise<void> => {
    drawerOpen.value = true
    detailLoading.value = true
    selected.value = null
    segments.value = {}
    viewLang.value = 'orig'
    const projectId = getProjectId()
    if (!sc.available || !projectId) {
      detailLoading.value = false
      return
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
      if (account.value) params.account = account.value
      const repoPath = getRepoPath()
      if (repoPath) params.repoPath = repoPath
      selected.value = await sc.request<GhThread>('gh.get', params)
    } catch (err) {
      errorCode.value = ghCodeOf(err)
      drawerOpen.value = false
    } finally {
      detailLoading.value = false
    }
  }

  const closeDrawer = (): void => {
    drawerOpen.value = false
    selected.value = null
    segments.value = {}
    viewLang.value = 'orig'
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
    selected,
    drawerOpen,
    detailLoading,
    viewLang,
    // actions
    refresh,
    open,
    closeDrawer,
    segmentTranslation,
    setViewLang,
    setStateFilter,
    setAssigneeFilter,
    setAccount,
    setSearch,
    loadMore,
  }
}
