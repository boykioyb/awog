// Page-controller của cửa sổ Network Capture (docs/features/network-capture.md).
//
// Dữ liệu capture chỉ sống ở main (bộ nhớ) + renderer của cửa sổ này; mọi thứ đi qua
// `window.awog.browser.capture` — KHÔNG có đường nào sang sidecar/agent. Danh sách chỉ
// giữ CaptureSummary (nhẹ); CaptureEntry đầy đủ (header/body) lấy theo yêu cầu và cache
// theo danh tính của summary, nên một lần upsert (pending→done) tự làm cache cũ hết hạn.
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
} from 'vue'
import type {
  CaptureEntry,
  HeaderPair,
  CaptureState,
  CaptureSummary,
  ReplayResult,
} from '~/types/network-capture'
import {
  buildTextMatcher,
  matchesStructure,
  registrableHost,
  sortSummaries,
  summaryHaystack,
  type CaptureFilter,
  type CaptureSortKey,
  type CaptureSortState,
  type StatusChip,
  type TypeChip,
} from '~/utils/capture-filter'
import { analyzeAll, type CaptureFinding } from '~/utils/capture-findings'
import type { ScanFinding } from '~/utils/capture-scan'
import {
  parseRawRequest,
  toCurl,
  toFetch,
  toRawRequest,
  toRawResponse,
} from '~/utils/capture-export'

export type CaptureView = 'requests' | 'repeater' | 'findings' | 'security'
export type CopyKind = 'url' | 'curl' | 'curlCmd' | 'fetch' | 'rawRequest' | 'rawResponse'

export type RepeaterSend = {
  n: number
  at: number
  method: string
  url: string
  raw: string
  result: ReplayResult
}

const HISTORY_CAP = 50
const FETCH_CONCURRENCY = 6

const first = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Chuỗi để tìm trong nội dung của một entry: header + body dạng text (bỏ body nhị phân). */
function entryHaystack(e: CaptureEntry): string {
  const parts: string[] = []
  for (const [k, v] of e.requestHeaders) parts.push(`${k}: ${v}`)
  for (const [k, v] of e.responseHeaders) parts.push(`${k}: ${v}`)
  if (e.requestBody && !e.requestBody.base64) parts.push(e.requestBody.text)
  if (e.responseBody && !e.responseBody.base64) parts.push(e.responseBody.text)
  for (const f of e.wsFrames ?? []) parts.push(f.payload)
  return parts.join('\n')
}

export function useNetworkCapture() {
  const { t } = useI18n()
  const route = useRoute()

  const tabId = computed(() => first(route.query.tabId))
  const scope = computed(() => first(route.query.scope) || undefined)
  const api = () => (typeof window === 'undefined' ? null : (window.awog?.browser?.capture ?? null))
  const available = computed(() => import.meta.client && api() !== null && tabId.value !== '')

  const capState = ref<CaptureState | null>(null)
  const recording = computed(() => capState.value?.recording ?? false)

  // ── Danh sách ─────────────────────────────────────────────────────────────
  // Map + bộ đếm phiên bản thay vì ref<mảng>: 5000 dòng không cần proxy sâu.
  const byId = new Map<string, CaptureSummary>()
  const version = ref(0)
  const bump = (): void => {
    version.value += 1
  }
  const all = computed(() => {
    void version.value
    return [...byId.values()]
  })

  const view = ref<CaptureView>('requests')

  // ── Bộ lọc ────────────────────────────────────────────────────────────────
  const filterText = ref('')
  const searchBodies = ref(false)
  const typeSel = ref<TypeChip[]>([])
  const statusSel = ref<StatusChip[]>([])
  const method = ref('')
  const onlySite = ref(false)
  const sort = ref<CaptureSortState>({ key: 'seq', dir: 'asc' })

  const toggleIn = <T>(list: { value: T[] }, v: T): void => {
    list.value = list.value.includes(v) ? list.value.filter((x) => x !== v) : [...list.value, v]
  }
  const toggleType = (c: TypeChip): void => toggleIn(typeSel, c)
  const toggleStatus = (c: StatusChip): void => toggleIn(statusSel, c)
  const clearTypes = (): void => {
    typeSel.value = []
  }

  const setSort = (key: CaptureSortKey): void => {
    const cur = sort.value
    sort.value =
      cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
  }

  const tabHost = ref('')
  // Host của trang đang xem: request điều hướng mới nhất đã bắt, lùi về URL của tab
  // lúc mở cửa sổ. Dùng cho "chỉ site này" và tiêu đề cửa sổ.
  const pageHost = computed(() => {
    let nav: CaptureSummary | null = null
    for (const s of all.value) if (s.isNavigation && (!nav || s.seq > nav.seq)) nav = s
    return nav?.host ?? tabHost.value
  })
  const siteHost = computed(() => (onlySite.value ? registrableHost(pageHost.value) : ''))

  const methods = computed(() => {
    const set = new Set<string>()
    for (const s of all.value) set.add(s.method)
    return [...set].sort()
  })

  const matcherState = computed(() => buildTextMatcher(filterText.value))
  const regexInvalid = computed(() => matcherState.value.error)

  const structFilter = computed<CaptureFilter>(() => ({
    text: filterText.value,
    types: new Set(typeSel.value),
    statuses: new Set(statusSel.value),
    method: method.value,
    siteHost: siteHost.value,
  }))

  // ── Cache entry đầy đủ ────────────────────────────────────────────────────
  const entryCache = new Map<string, { summary: CaptureSummary; entry: CaptureEntry }>()

  async function getEntry(id: string): Promise<CaptureEntry | null> {
    const summary = byId.get(id)
    if (!summary) return null
    const hit = entryCache.get(id)
    if (hit && hit.summary === summary) return hit.entry
    const a = api()
    if (!a) return null
    const entry = await a.get(tabId.value, id, scope.value)
    // Summary có thể đã được upsert trong lúc chờ — vẫn cache theo bản đã chụp: lần sau
    // `hit.summary !== byId.get(id)` sẽ buộc tải lại.
    if (entry) entryCache.set(id, { summary, entry })
    return entry
  }

  async function mapLimit<T>(items: T[], run: (item: T) => Promise<void>, alive: () => boolean) {
    let next = 0
    const worker = async (): Promise<void> => {
      while (alive() && next < items.length) {
        const item = items[next++]
        if (item !== undefined) await run(item)
      }
    }
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, worker))
  }

  // ── Tìm trong body (lười, có thể huỷ) ─────────────────────────────────────
  const bodyHits = shallowRef<ReadonlySet<string> | null>(null)
  const searching = ref(false)
  let searchToken = 0
  let searchTimer: number | undefined

  async function runBodySearch(): Promise<void> {
    const token = ++searchToken
    const { matcher } = matcherState.value
    if (!searchBodies.value || !matcher) {
      bodyHits.value = null
      searching.value = false
      return
    }
    searching.value = true
    const candidates = all.value.filter(
      (s) => matchesStructure(s, structFilter.value) && !matcher.test(summaryHaystack(s)),
    )
    const hits = new Set<string>()
    await mapLimit(
      candidates,
      async (s) => {
        const e = await getEntry(s.id)
        if (e && matcher.test(entryHaystack(e))) hits.add(s.id)
      },
      () => token === searchToken,
    )
    if (token !== searchToken) return
    bodyHits.value = hits
    searching.value = false
  }

  const scheduleBodySearch = (): void => {
    clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => void runBodySearch(), 300)
  }

  watch([filterText, searchBodies, typeSel, statusSel, method, onlySite], scheduleBodySearch)
  watch(version, () => {
    if (searchBodies.value && matcherState.value.matcher) scheduleBodySearch()
  })

  // ── Danh sách hiển thị ────────────────────────────────────────────────────
  const rows = computed<CaptureSummary[]>(() => {
    const f = structFilter.value
    const { matcher } = matcherState.value
    const hits = bodyHits.value
    const out = all.value.filter((s) => {
      if (!matchesStructure(s, f)) return false
      if (!matcher) return true
      return matcher.test(summaryHaystack(s)) || (hits?.has(s.id) ?? false)
    })
    return sortSummaries(out, sort.value)
  })

  // ── Chọn dòng + chi tiết ──────────────────────────────────────────────────
  const selectedId = ref<string | null>(null)
  const selectedSummary = computed(() => {
    void version.value
    return selectedId.value ? (byId.get(selectedId.value) ?? null) : null
  })
  const selectedEntry = shallowRef<CaptureEntry | null>(null)
  const detailLoading = ref(false)

  watch(selectedSummary, async (s) => {
    if (!s) {
      selectedEntry.value = null
      return
    }
    detailLoading.value = true
    const id = s.id
    const e = await getEntry(id)
    if (selectedId.value === id) selectedEntry.value = e
    detailLoading.value = false
  })

  const select = (id: string | null): void => {
    selectedId.value = id
  }

  function moveSelection(delta: number): void {
    const list = rows.value
    if (list.length === 0) return
    const cur = selectedId.value ? list.findIndex((r) => r.id === selectedId.value) : -1
    let next = delta > 0 ? 0 : list.length - 1
    if (cur >= 0) next = Math.min(list.length - 1, Math.max(0, cur + delta))
    selectedId.value = list[next]?.id ?? null
  }

  // ── Điều khiển ghi ────────────────────────────────────────────────────────
  const busy = ref(false)

  async function setRecording(on: boolean): Promise<void> {
    const a = api()
    if (!a) return
    busy.value = true
    try {
      capState.value = on
        ? await a.start(tabId.value, scope.value)
        : await a.stop(tabId.value, scope.value)
    } finally {
      busy.value = false
    }
  }
  const toggleRecording = (): Promise<void> => setRecording(!recording.value)

  function resetLocal(): void {
    byId.clear()
    entryCache.clear()
    selectedId.value = null
    selectedEntry.value = null
    bodyHits.value = null
    findings.value = []
    secEntries.value = []
    bump()
  }

  async function clearAll(): Promise<void> {
    const a = api()
    if (!a) return
    capState.value = await a.clear(tabId.value, scope.value)
    resetLocal()
  }

  // ── Copy ──────────────────────────────────────────────────────────────────
  // Văn bản của một kiểu copy — ghi clipboard + phản hồi nằm ở `useCopyFeedback`.
  function entryText(kind: CopyKind, e: CaptureEntry): string {
    return kind === 'url'
      ? e.url
      : kind === 'curl'
        ? toCurl(e, { shell: 'bash' })
        : kind === 'curlCmd'
          ? toCurl(e, { shell: 'cmd' })
          : kind === 'fetch'
            ? toFetch(e)
            : kind === 'rawRequest'
              ? toRawRequest(e)
              : toRawResponse(e)
  }

  // ── Xuất HAR ──────────────────────────────────────────────────────────────
  async function exportHar(filteredOnly: boolean): Promise<void> {
    const a = api()
    if (!a) return
    try {
      const ids = filteredOnly ? rows.value.map((r) => r.id) : undefined
      const res = await a.exportHar(tabId.value, scope.value, ids)
      if ('path' in res) {
        useToast().add({ title: t('capture.toast.exported', { path: res.path }), color: 'success' })
      }
    } catch (err) {
      useToast().add({
        title: t('capture.toast.exportFailed', {
          message: err instanceof Error ? err.message : String(err),
        }),
        color: 'error',
      })
    }
  }

  // ── Findings + bảo mật ────────────────────────────────────────────────────
  // Entry đầy đủ đã tải để phân tích — view Bảo mật tái sử dụng để fingerprint
  // (không tải lại lần hai).
  const findings = shallowRef<CaptureFinding[]>([])
  const analyzing = ref(false)
  const secEntries = shallowRef<CaptureEntry[]>([])
  const repeaterDraft = ref('')

  // Quét chủ động (view Bảo mật — nút do người dùng bấm, confirm trước): engine
  // gửi probe qua kênh replay sẵn có. Singleton của trang để mọi view đọc report.
  const scan = useCaptureScanner()

  let analysisToken = 0
  let analysisTimer: number | undefined

  async function runAnalysis(): Promise<void> {
    const token = ++analysisToken
    analyzing.value = true
    const entries: CaptureEntry[] = []
    await mapLimit(
      all.value,
      async (s) => {
        const e = await getEntry(s.id)
        if (e) entries.push(e)
      },
      () => token === analysisToken,
    )
    if (token !== analysisToken) return
    entries.sort((a, b) => a.seq - b.seq)
    findings.value = analyzeAll(entries)
    secEntries.value = entries
    analyzing.value = false
  }

  const scheduleAnalysis = (): void => {
    clearTimeout(analysisTimer)
    analysisTimer = window.setTimeout(() => void runAnalysis(), 1200)
  }

  watch(view, (v) => {
    if (v === 'findings' || v === 'security') void runAnalysis()
  })
  watch(version, () => {
    if (view.value === 'findings' || view.value === 'security') scheduleAnalysis()
  })

  function showFinding(f: CaptureFinding): void {
    if (!byId.has(f.entryId)) return
    selectedId.value = f.entryId
    view.value = 'requests'
  }

  // Mở một request trên view "Request" (evidence của view Bảo mật mà không gắn
  // finding vẫn nhảy được tới entry).
  function showEntry(id: string): void {
    if (!byId.has(id)) return
    selectedId.value = id
    view.value = 'requests'
  }

  // Đẩy findings (thụ động + kết quả quét) sang một phiên chat mới để agent phân
  // tích. Chạy được trong cửa sổ inspector vì bridge + sidecar là chung; phiên
  // được mở ra cửa sổ popout riêng (inspector giữ nguyên).
  async function sendToAgent(scanFindings: ScanFinding[] = []): Promise<void> {
    const host = pageHost.value || 'the inspected site'
    const passive = findings.value
    const lines: string[] = [
      `Analyze these security findings from a network capture of ${host}. Identify true positives, deduplicate, prioritize by exploitability, and suggest concrete verification steps.`,
      '',
      `PASSIVE FINDINGS (${passive.length}) — static analysis of captured traffic:`,
    ]
    for (const f of passive.slice(0, 30)) {
      lines.push(
        `- [${f.severity}] ${f.id} — ${t(f.title, f.params)}` +
          (f.evidence ? ` — evidence: ${f.evidence.slice(0, 160)}` : ''),
      )
    }
    if (passive.length > 30) lines.push(`- …and ${passive.length - 30} more`)
    if (scanFindings.length) {
      lines.push(
        '',
        `ACTIVE SCAN FINDINGS (${scanFindings.length}) — user-initiated probe replays:`,
      )
      for (const f of scanFindings.slice(0, 30)) {
        lines.push(
          `- [${f.severity}] ${f.owasp} ${f.scenarioId} — ${f.location} ${f.param} ← ${f.payload}` +
            ` — evidence: ${f.evidence.slice(0, 160)} — url: ${f.url}` +
            (f.deltaMs ? ` (+${Math.round(f.deltaMs)}ms)` : ''),
        )
      }
      if (scanFindings.length > 30) lines.push(`- …and ${scanFindings.length - 30} more`)
    }
    const store = useSessionsStore()
    const id = store.create()
    if (id === null) {
      useToast().add({ title: t('capture.sec.agent.failed', { message: 'quota' }), color: 'error' })
      return
    }
    try {
      await store.sendMessage(id, lines.join('\n'))
    } catch (err) {
      useToast().add({
        title: t('capture.sec.agent.failed', {
          message: err instanceof Error ? err.message : String(err),
        }),
        color: 'error',
      })
      return
    }
    const engineId = store.sessions.find((s) => s.id === id)?.engineId
    if (engineId) {
      await window.awog
        ?.openSessionWindow?.(engineId, t('capture.sec.agent.sessionTitle'))
        .catch(() => {})
    }
    useToast().add({ title: t('capture.sec.agent.sent'), color: 'success' })
  }

  const repeaterBase = ref<{ scheme: string; host: string }>({ scheme: 'https', host: '' })
  const repeaterFollow = ref(false)
  const repeaterSending = ref(false)
  const repeaterResult = shallowRef<ReplayResult | null>(null)
  const repeaterHistory = ref<RepeaterSend[]>([])
  let sendN = 0

  function sendToRepeater(e: CaptureEntry): void {
    repeaterDraft.value = toRawRequest(e)
    repeaterBase.value = { scheme: e.scheme, host: e.host }
    repeaterResult.value = null
    view.value = 'repeater'
  }

  async function sendRepeater(): Promise<void> {
    const a = api()
    if (!a || repeaterSending.value) return
    const raw = repeaterDraft.value
    let parsed: { method: string; url: string; headers: HeaderPair[]; body: string }
    try {
      parsed = parseRawRequest(raw, repeaterBase.value)
    } catch (err) {
      repeaterResult.value = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
      return
    }
    repeaterSending.value = true
    try {
      const hasBody = parsed.body !== '' && !['GET', 'HEAD'].includes(parsed.method.toUpperCase())
      const result = await a.replay(
        tabId.value,
        {
          method: parsed.method,
          url: parsed.url,
          headers: parsed.headers,
          ...(hasBody ? { body: parsed.body, bodyBase64: false } : {}),
          followRedirects: repeaterFollow.value,
        },
        scope.value,
      )
      repeaterResult.value = result
      repeaterHistory.value = [
        { n: ++sendN, at: Date.now(), method: parsed.method, url: parsed.url, raw, result },
        ...repeaterHistory.value,
      ].slice(0, HISTORY_CAP)
    } catch (err) {
      repeaterResult.value = { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      repeaterSending.value = false
    }
  }

  function loadHistory(h: RepeaterSend): void {
    repeaterDraft.value = h.raw
    repeaterResult.value = h.result
  }

  // ── Vòng đời ──────────────────────────────────────────────────────────────
  let unsubscribe: (() => void) | null = null

  async function loadInitial(): Promise<void> {
    const a = api()
    if (!a) return
    const res = await a.list(tabId.value, scope.value)
    capState.value = res.state
    for (const s of res.entries) byId.set(s.id, s)
    bump()
  }

  onMounted(async () => {
    const a = api()
    if (!a || !tabId.value) return
    unsubscribe = a.onEvent((ev) => {
      if (ev.tabId !== tabId.value) return
      if (ev.kind === 'upsert') {
        for (const s of ev.entries) byId.set(s.id, s)
        bump()
      } else if (ev.kind === 'state') {
        capState.value = ev.state
      } else {
        resetLocal()
      }
    })
    await loadInitial()
    try {
      const list = await window.awog?.browser.tabs(scope.value)
      const url = list?.tabs.find((x) => x.tabId === tabId.value)?.url
      if (url) tabHost.value = new URL(url).hostname
    } catch {
      // Tab đã đóng hoặc URL không phải http(s) — bộ lọc "chỉ site này" dựa vào entry.
    }
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    clearTimeout(searchTimer)
    clearTimeout(analysisTimer)
    searchToken++
    analysisToken++
  })

  return {
    // nguồn
    tabId,
    pageHost,
    available,
    capState,
    recording,
    busy,
    view,
    // danh sách
    rows,
    total: computed(() => all.value.length),
    methods,
    // lọc
    filterText,
    searchBodies,
    typeSel,
    statusSel,
    method,
    onlySite,
    sort,
    regexInvalid,
    searching,
    toggleType,
    toggleStatus,
    clearTypes,
    setSort,
    // chọn
    selectedId,
    selectedSummary,
    selectedEntry,
    detailLoading,
    select,
    moveSelection,
    // hành động
    setRecording,
    toggleRecording,
    clearAll,
    exportHar,
    entryText,
    // findings
    findings,
    analyzing,
    runAnalysis,
    showFinding,
    showEntry,
    secEntries,
    // quét chủ động + agent
    scan,
    sendToAgent,
    getEntry,
    // repeater
    repeaterDraft,
    repeaterBase,
    repeaterFollow,
    repeaterSending,
    repeaterResult,
    repeaterHistory,
    sendToRepeater,
    sendRepeater,
    loadHistory,
  }
}

/** Hợp đồng của page-controller — tên hoá tại nơi sở hữu để component con import. */
export type NetworkCapture = ReturnType<typeof useNetworkCapture>

export const NETWORK_CAPTURE_KEY: InjectionKey<NetworkCapture> = Symbol('network-capture')

/** Component con của trang inspector lấy controller do `pages/network-capture.vue` cấp. */
export function useNetworkCaptureContext(): NetworkCapture {
  const cap = inject(NETWORK_CAPTURE_KEY)
  if (!cap) throw new Error('useNetworkCaptureContext() gọi ngoài trang network-capture')
  return cap
}
