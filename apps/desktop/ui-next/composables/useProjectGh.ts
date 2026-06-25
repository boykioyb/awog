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
export interface GhThread extends GhThreadSummary {
  body: string
  url: string
  comments: GhThreadComment[]
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

export function useProjectGh(getProjectId: () => string, kind: GhKind) {
  const sc = useSidecar()
  const settings = useSettingsStore()
  const projectsStore = useProjectsStore()

  const items = ref<GhThreadSummary[]>([])
  const loading = ref(false)
  const errorCode = ref<string | null>(null)

  const stateFilter = ref<GhListState>('open')
  const assigneeFilter = ref<string>('') // '' = anyone; '@me' or a login otherwise.
  const searchQuery = ref('')

  const selected = ref<GhThread | null>(null)
  const drawerOpen = ref(false)
  const detailLoading = ref(false)
  const segments = ref<Record<string, GhSegmentState>>({})
  const viewLang = ref<ViewLang>('orig')

  // gh account override (empty = follow gh's active account). Sourced from the
  // app-level setting; the GH tab also lets the user pick per-tab.
  const account = ref<string>(settings.githubAccount.trim())

  const knownAssignees = computed<string[]>(() => {
    const set = new Set<string>()
    for (const it of items.value) for (const a of it.assignees) set.add(a.login)
    return [...set].sort((a, b) => a.localeCompare(b))
  })

  const visibleItems = computed<GhThreadSummary[]>(() => {
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return items.value
    return items.value.filter(
      (it) => it.title.toLowerCase().includes(q) || String(it.number).includes(q),
    )
  })

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
      } = { projectId, kind, state: stateFilter.value }
      if (assigneeFilter.value) params.assignee = assigneeFilter.value
      if (account.value) params.account = account.value
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
      const params: { projectId: string; kind: GhKind; number: number; account?: string } = {
        projectId,
        kind,
        number,
      }
      if (account.value) params.account = account.value
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
    void refresh()
  }
  const setAssigneeFilter = (next: string): void => {
    if (next === assigneeFilter.value) return
    assigneeFilter.value = next
    void refresh()
  }
  const setAccount = (login: string): void => {
    if (login === account.value) return
    account.value = login
    void refresh()
  }

  // Re-fetch when the bound project changes.
  watch(getProjectId, () => {
    closeDrawer()
    void refresh()
  })

  onMounted(() => void refresh())
  onBeforeUnmount(() => closeDrawer())

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
  }
}
