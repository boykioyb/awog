// Project GitHub controller (ADR 0049) — owns one tab's state (Issues OR Pull
// Requests, discriminated by `kind`). Talks only to the sidecar via gh.* RPC;
// no fs/child_process/SDK in the UI. The page + components stay thin and bind
// the refs/handlers this returns.
//
// Translation is per-segment: each translatable block (title / body / a comment
// by index) keys its own cache entry so toggling one never touches another, and
// re-opening a translated segment is instant. Default view is ALWAYS the
// original — nothing auto-translates on open (AC5).

import type { GhThread, GhThreadKind, GhThreadSummary, ProviderName } from '~/types'

// gh.list state filter, lowercased to the RPC. Issues drop 'merged'.
export type GhListState = 'open' | 'closed' | 'merged' | 'all'

// Per-segment translation cache entry — one per (segment, language). `translated`
// is filled lazily when a language tab is opened; `loading`/`error` drive the
// inline status shown under that segment.
export interface GhSegmentState {
  translated?: string
  loading: boolean
  error?: boolean
}

// Segment ids: the two fixed blocks + each comment by its list index.
export type GhSegmentId = 'title' | 'body' | number

// Translation target. The drawer lets the user flip between Vietnamese and
// English per ADR 0049 follow-up; the label is what the sidecar prompt receives.
export type TranslateLang = 'vi' | 'en'
const LANG_LABEL: Record<TranslateLang, string> = { vi: 'Vietnamese', en: 'English' }

// The drawer shows the thread under a language tab: 'orig' = the original text,
// 'vi'/'en' = lazily-fetched translations of every segment.
export type ViewLang = 'orig' | TranslateLang

// Segment cache key includes the language so a segment can hold a VI and an EN
// translation independently (toggling language never discards the other).
const segmentKey = (id: GhSegmentId, lang: TranslateLang): string =>
  `${typeof id === 'number' ? `c${id}` : id}|${lang}`

interface GhListCacheEntry {
  items: GhThreadSummary[]
  fetchedAt: number
}
// Module-level so a fetched list survives tab/project switches within a session
// (the tab no longer re-fetches on every open). Keyed by the full query so each
// state/assignee/account combination caches separately. Background auto-fetch
// only revalidates entries older than the configured interval.
const listCache = new Map<string, GhListCacheEntry>()

// The sidecar gh.* surface throws RpcError(GH_RPC_CODE, <human message>, { ghCode })
// — the stable dispatch key lives in `data.ghCode`, NOT in the message. Read it
// so the list can pick the right empty-state copy; anything else → 'UNKNOWN'
// (the list renders generic copy for that).
const GH_CODES = ['GH_NOT_FOUND', 'GH_NOT_AUTH', 'GH_NO_REPO'] as const
const ghCodeOf = (err: unknown): string => {
  const data = (err as { data?: unknown } | null)?.data
  if (data && typeof data === 'object' && 'ghCode' in data) {
    const code = (data as { ghCode?: unknown }).ghCode
    if (typeof code === 'string' && (GH_CODES as readonly string[]).includes(code)) return code
  }
  return 'UNKNOWN'
}

export function useProjectGh(projectId: string, kind: GhThreadKind) {
  const sidecar = useSidecar()
  const sessionsStore = useSessionsStore()
  const settingsStore = useSettingsStore()

  const items = ref<GhThreadSummary[]>([])
  const loading = ref(false)
  // Stable RpcError code (GH_NOT_FOUND / GH_NOT_AUTH / GH_NO_REPO / generic) or
  // null when the last fetch succeeded.
  const errorCode = ref<string | null>(null)

  const stateFilter = ref<GhListState>('open')
  // '' = Anyone (omit the flag), '@me' or a login otherwise.
  const assigneeFilter = ref<string>('')
  const searchQuery = ref('')

  const selected = ref<GhThread | null>(null)
  const drawerOpen = ref(false)
  const detailLoading = ref(false)

  // Per-segment translation state for the currently-open thread. Reset on open.
  const segments = ref<Record<string, GhSegmentState>>({})

  // Account passed to gh.list/gh.get comes from the app-level setting; empty =
  // follow gh's active account (sidecar omits the override).
  const account = computed(() => settingsStore.githubAccount.trim())

  // Active language tab for the open thread. Default 'orig' (always show the
  // original first — AC5). Reset per thread in open()/closeDrawer().
  const viewLang = ref<ViewLang>('orig')

  // Distinct assignees seen across the fetched rows, for the assignee dropdown.
  const knownAssignees = computed<string[]>(() => {
    const set = new Set<string>()
    for (const it of items.value) for (const a of it.assignees) set.add(a.login)
    return [...set].sort((a, b) => a.localeCompare(b))
  })

  // Client-side title/number search over the already-fetched (state + assignee
  // filtered) list.
  const visibleItems = computed<GhThreadSummary[]>(() => {
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return items.value
    return items.value.filter(
      (it) => it.title.toLowerCase().includes(q) || String(it.number).includes(q),
    )
  })

  const intervalMs = computed(() => settingsStore.githubAutoFetchMs)
  const cacheKey = (): string =>
    `${projectId}|${kind}|${stateFilter.value}|${assigneeFilter.value}|${account.value}`

  // The actual gh.list round-trip. `silent` keeps the current list + errorCode on
  // failure — used by background auto-fetch / focus revalidation so a transient
  // blip never blanks a populated list.
  const fetchList = async (key: string, silent: boolean): Promise<void> => {
    if (!silent) loading.value = true
    try {
      const params: {
        projectId: string
        kind: GhThreadKind
        state: GhListState
        assignee?: string
        account?: string
      } = { projectId, kind, state: stateFilter.value }
      if (assigneeFilter.value) params.assignee = assigneeFilter.value
      if (account.value) params.account = account.value
      const res = await sidecar.request<{ items: GhThreadSummary[] }>('gh.list', params)
      items.value = res.items
      errorCode.value = null
      listCache.set(key, { items: res.items, fetchedAt: Date.now() })
    } catch (err) {
      if (!silent) {
        items.value = []
        errorCode.value = ghCodeOf(err)
      }
    } finally {
      if (!silent) loading.value = false
    }
  }

  // Show cache instantly; hit the network only when forced (manual refresh) or
  // for a new query with no cache. A cached-but-stale entry (older than the
  // auto-fetch interval) is revalidated silently with the cache shown meanwhile.
  const refresh = async (opts: { force?: boolean } = {}): Promise<void> => {
    if (!sidecar.available) {
      errorCode.value = 'GH_NOT_FOUND'
      return
    }
    const key = cacheKey()
    const cached = listCache.get(key)
    if (cached && !opts.force) {
      items.value = cached.items
      errorCode.value = null
      if (Date.now() - cached.fetchedAt < intervalMs.value) return
      await fetchList(key, true)
      return
    }
    await fetchList(key, false)
  }

  // Force a silent re-fetch of the current query regardless of freshness — the
  // background interval tick.
  const revalidate = (): void => {
    if (sidecar.available) void fetchList(cacheKey(), true)
  }

  const open = async (number: number): Promise<void> => {
    drawerOpen.value = true
    detailLoading.value = true
    selected.value = null
    segments.value = {}
    viewLang.value = 'orig'
    try {
      const params: { projectId: string; kind: GhThreadKind; number: number; account?: string } = {
        projectId,
        kind,
        number,
      }
      if (account.value) params.account = account.value
      selected.value = await sidecar.request<GhThread>('gh.get', params)
    } catch (err) {
      // Surface as the same error-state mechanism; close the drawer so the list
      // empty/error state explains it.
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

  // Translation cache entry for `id` under the ACTIVE view language. null on the
  // 'orig' tab. Always returns the reactive proxy (read back from the record) so
  // writes in translateOne re-render the bound component.
  const segmentTranslation = (id: GhSegmentId): GhSegmentState | null => {
    if (viewLang.value === 'orig') return null
    const key = segmentKey(id, viewLang.value)
    if (!segments.value[key]) segments.value[key] = { loading: false }
    return segments.value[key]!
  }

  // Resolve provider/model/account exactly like Sessions enhancePrompt: read the
  // project's session LLM defaults (with app-default fallback) via the sessions
  // store, then forward provider/modelId/accountId to gh.translate.
  const translateSettings = (): { provider: ProviderName; modelId: string; accountId?: string } => {
    const s = sessionsStore.settingsForProject(projectId)
    return {
      provider: s.provider,
      modelId: s.modelId,
      ...(s.accountId ? { accountId: s.accountId } : {}),
    }
  }

  // Translate one segment into `lang` once, caching on its (segment, lang) entry.
  // No-ops if already translated or in flight. Failures set `error` (shown inline)
  // instead of throwing, so one bad segment never aborts the rest of the tab.
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
      const res = await sidecar.request<{ text: string }>('gh.translate', {
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

  // Switch the drawer's language tab. 'orig' just flips the view; a language tab
  // lazily translates every segment of the open thread into that language (each
  // cached + with its own loading/error state, shown progressively).
  const setViewLang = (lang: ViewLang): void => {
    viewLang.value = lang
    if (lang === 'orig') return
    const thread = selected.value
    if (!thread) return
    void translateOne('title', thread.title, lang)
    void translateOne('body', thread.body || '', lang)
    thread.comments.forEach((c, i) => void translateOne(i, c.body, lang))
  }

  // Accepts the raw <option> value (a string) from the AppSelect; lowercased to
  // the RPC enum. Unknown values are ignored.
  const setStateFilter = (next: string): void => {
    const v = next.toLowerCase()
    if (v !== 'open' && v !== 'closed' && v !== 'merged' && v !== 'all') return
    if (v === stateFilter.value) return
    stateFilter.value = v
    void refresh()
  }

  const setAssigneeFilter = (next: string): void => {
    if (next === assigneeFilter.value) return
    assigneeFilter.value = next
    void refresh()
  }

  // Background auto-fetch: silently revalidate the current query every
  // `intervalMs` (default 30 min; 0 = off) while the tab is mounted, plus on
  // window focus when the cache has gone stale. Manual refresh + filter/account
  // changes stay immediate.
  let timer: ReturnType<typeof setInterval> | null = null
  const stopTimer = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  const startTimer = (): void => {
    stopTimer()
    const ms = intervalMs.value
    if (ms > 0) timer = setInterval(revalidate, ms)
  }
  const onWindowFocus = (): void => void refresh()

  onMounted(() => {
    startTimer()
    if (import.meta.client) window.addEventListener('focus', onWindowFocus)
  })
  onBeforeUnmount(() => {
    stopTimer()
    if (import.meta.client) window.removeEventListener('focus', onWindowFocus)
  })
  watch(intervalMs, startTimer)

  return {
    // state
    items,
    visibleItems,
    knownAssignees,
    loading,
    errorCode,
    stateFilter,
    assigneeFilter,
    searchQuery,
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
  }
}
