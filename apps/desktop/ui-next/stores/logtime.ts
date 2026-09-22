import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Logtime store (ADR 0091) — giờ công soạn ở AWOG rồi đẩy lên PMS qua MCP.
//
// Trần giờ được cưỡng chế TẠI ĐÂY (D-6), không ở component: mọi đường thêm dòng
// (form nhanh, chép ngày trước, gợi ý, AI sau này) đều đi qua `addEntry`, nên
// không có cách nào vượt mức bằng cách bấm nhiều lần.

export type LogtimeStatus = 'draft' | 'posted' | 'locked'

export type LogtimeTaskRef = {
  id?: string
  issue?: number
  title?: string
}

export type LogtimeEntry = {
  id: string
  projectKey: string
  note: string
  hours: number
  task?: LogtimeTaskRef
  status: LogtimeStatus
  worklogId?: string
  lockedAt?: string
  /** refId của gợi ý đã sinh ra dòng này — để panel nhận ra "đã khai" dù note đã
   *  bị AI viết lại khác tiêu đề gốc. Không tham gia lời gọi PMS. */
  sourceRefId?: string
  updatedAt: number
}

/**
 * Một việc AWOG TỰ ĐO ĐƯỢC là đã xảy ra trong ngày — phiên chat có hoạt động, hoặc
 * task tạo mới. Gương của `LogtimeSuggestion` bên sidecar (`types/shared.ts`); sửa
 * một bên thì sửa cả hai.
 *
 * ⚠ KHÔNG có trường `hours`. AWOG không đo được người dùng bỏ bao lâu cho một phiên,
 * và một con số suy diễn ở đây đi thẳng lên PMS như giờ công thật.
 */
export type LogtimeSuggestion = {
  kind: 'session' | 'task'
  /** id phiên / id task — dùng làm `:key` và để biết gợi ý nào đã khai. */
  refId: string
  /** `projectKey` của logtime, tức `Project.id`. */
  projectKey: string
  title: string
  /** ISO — phiên là lần hoạt động cuối, task là lúc tạo. */
  at: string
  issue?: number | undefined
  /** Số PR nếu phiên mở từ link /pull/<n> — chỉ để model nhắc trong note, KHÔNG
   *  auto-link (API worklog chỉ nhận issue). */
  pr?: number | undefined
}

/**
 * Một dòng công do model SOẠN ("Soạn bằng AI"). Gương của `LogtimeComposeLine` bên
 * sidecar. KHÁC `LogtimeSuggestion`: đây là hành động người dùng chủ động gọi và
 * duyệt, nên model ĐƯỢC đề xuất `hours` — dòng nhận về vẫn là nháp qua cổng `addEntry`,
 * đẩy PMS vẫn là bước riêng có xác nhận.
 */
export type LogtimeComposeLine = {
  projectKey: string
  note: string
  hours: number
  issue?: number
}

export type LogtimeLink = {
  projectKey: string
  label?: string
  sourceId: string
  pmsProjectId: string
  pmsProjectName?: string
  githubRepo?: string
  color?: string
}

export type LogtimeSettings = {
  dailyHours: number
  roundStep: number
  remindAt: string
  remindEnabled: boolean
  /** Nguồn MCP mà Logtime được phép dùng — người dùng chọn ở tab Thiết lập. */
  sourceIds: string[]
  links: LogtimeLink[]
}

/** Nguồn MCP đang bật, chỉ để gợi ý khi bấm "Thêm nguồn". */
export type McpSourceOption = {
  id: string
  name: string
  url?: string
}

export type LogtimeSourceCapability = {
  sourceId: string
  name: string
  url?: string
  tools: string[]
  missing: string[]
  canPush: boolean
  canListTasks: boolean
  canPull: boolean
  error?: string
}

export type LogtimePushResult = {
  entryId: string
  ok: boolean
  worklogId?: string
  error?: string
}

export type PmsOption = { label: string; value: string }

// Ai vừa ghi: 'user' = chính màn này · 'agent' = một phiên chat dùng tool logtime_*
// · 'push'/'pull' = đồng bộ với PMS. Đi kèm sự kiện `logtime.changed`.
export type LogtimeChangeSource = 'user' | 'agent' | 'push' | 'pull'

export type LogtimeChangedEvent = {
  date: string
  month: string
  source: LogtimeChangeSource
}

export type AddOutcome = {
  added: number
  cut: boolean
  reason: 'ok' | 'full' | 'duplicate' | 'invalid'
}

export const DEFAULT_SETTINGS: LogtimeSettings = {
  dailyHours: 8,
  roundStep: 0.5,
  remindAt: '17:30',
  remindEnabled: true,
  sourceIds: [],
  links: [],
}

export const todayKey = (): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const monthOfDate = (date: string): string => date.slice(0, 7)

export const useLogtimeStore = defineStore('logtime', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const settings = ref<LogtimeSettings>({ ...DEFAULT_SETTINGS })
  // key = YYYY-MM-DD. Chỉ giữ tháng đang mở — một tháng là một file ở sidecar.
  const days = ref<Record<string, LogtimeEntry[]>>({})
  const month = ref(monthOfDate(todayKey()))
  const capabilities = ref<LogtimeSourceCapability[]>([])
  const availableSources = ref<McpSourceOption[]>([])
  const loaded = ref(false)
  const busy = ref(false)
  const lastError = ref('')
  // Lần ghi gần nhất KHÔNG do màn này gây ra — UI đọc để hiện "vừa được cập nhật".
  const lastRemoteChange = ref<LogtimeChangedEvent | null>(null)
  // Việc AWOG đo được trong ngày đang mở. Chỉ giữ của NGÀY HIỆN TẠI — panel không
  // có nhu cầu so sánh nhiều ngày, và giữ theo ngày thì phải nghĩ tới chuyện dọn.
  const suggestions = ref<LogtimeSuggestion[]>([])
  const suggestionsSkipped = ref(0)
  // Việc đo được nhưng dự án CHƯA nối PMS — sidecar đã lọc ra khỏi `suggestions`, chỉ
  // trả về con số để panel nói "còn N việc ở dự án chưa nối". Tách khỏi
  // `suggestionsSkipped` (việc không thuộc dự án nào) vì hai câu nhắc khác nhau.
  const suggestionsUntracked = ref(0)
  const suggestionsLoaded = ref(false)
  // Lỗi RIÊNG của lần nạp gợi ý. Không dùng `lastError` chung: panel hiện câu này
  // ngay trong khối gợi ý, mà `lastError` có thể đang mang lỗi của việc khác.
  const suggestionsError = ref('')
  // Soạn bằng AI: đề xuất do model trả (chưa ghi gì), khối context đã chèn, và trạng
  // thái lượt gọi. Modal đọc trực tiếp; nhận thì đi qua `addEntry` như mọi dòng khác.
  const composeLines = ref<LogtimeComposeLine[]>([])
  const composeContext = ref('')
  const composeBudget = ref(0)
  const composeBusy = ref(false)
  const composeError = ref('')
  let unlisten: UnlistenFn | null = null

  const entriesOf = (date: string): LogtimeEntry[] => days.value[date] ?? []
  const totalOf = (date: string): number => entriesOf(date).reduce((sum, e) => sum + e.hours, 0)
  const remainingOf = (date: string): number =>
    Math.max(0, settings.value.dailyHours - totalOf(date))
  const draftsOf = (date: string): LogtimeEntry[] =>
    entriesOf(date).filter((e) => e.status === 'draft')

  const linkOf = (projectKey: string): LogtimeLink | undefined =>
    settings.value.links.find((l) => l.projectKey === projectKey)

  // Đẩy được = đã nối dự án PMS VÀ nguồn có `worklog_create`. Thiếu dò năng lực
  // (chưa bấm dò) thì coi như đẩy được — UI sẽ báo lỗi thật lúc đẩy chứ không
  // chặn trước bằng một suy đoán.
  const canPush = (projectKey: string): boolean => {
    const link = linkOf(projectKey)
    if (!link?.pmsProjectId) return false
    const cap = capabilities.value.find((c) => c.sourceId === link.sourceId)
    return cap ? cap.canPush : true
  }

  /** Làm tròn LÊN bậc cấu hình — đúng như câu mô tả ở Thiết lập. */
  const roundUp = (hours: number): number => {
    const step = settings.value.roundStep || 0.5
    return Math.ceil(hours / step - 1e-9) * step
  }

  function fail(err: unknown): null {
    lastError.value = err instanceof Error ? err.message : String(err)
    return null
  }

  async function loadMonth(target?: string): Promise<void> {
    const m = target ?? month.value
    month.value = m
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{
        month: { days: Record<string, { entries: LogtimeEntry[] }> }
        settings: LogtimeSettings
      }>('logtime.month', { month: m })
      const next: Record<string, LogtimeEntry[]> = {}
      for (const [date, day] of Object.entries(res.month?.days ?? {})) {
        next[date] = Array.isArray(day?.entries) ? day.entries : []
      }
      days.value = next
      settings.value = { ...DEFAULT_SETTINGS, ...res.settings }
      lastError.value = ''
    } catch (err) {
      fail(err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Đọc một tháng KHÔNG đụng `days.value` — cho màn tuần khi tuần bắc cầu sang tháng
  // lân cận (store chỉ giữ MỘT tháng trong bộ nhớ cho màn ngày). Trả map thô; lỗi/không
  // engine ⇒ map rỗng, màn tuần hiện ngày đó trống chứ không vỡ.
  async function fetchMonthDays(m: string): Promise<Record<string, LogtimeEntry[]>> {
    if (!available.value) return {}
    try {
      const res = await sc.request<{
        month: { days: Record<string, { entries: LogtimeEntry[] }> }
      }>('logtime.month', { month: m })
      const out: Record<string, LogtimeEntry[]> = {}
      for (const [date, day] of Object.entries(res.month?.days ?? {})) {
        out[date] = Array.isArray(day?.entries) ? day.entries : []
      }
      return out
    } catch {
      return {}
    }
  }

  // Sidecar phát `logtime.changed` sau MỌI lần ghi — kể cả lần do một phiên chat
  // gây ra (tool `logtime_add`). Không có chỗ này thì agent ghi xong mà trang đang
  // mở vẫn hiện số cũ cho tới khi người dùng bấm reload.
  //
  // Bỏ qua sự kiện của tháng khác: mỗi lần chỉ giữ một tháng trong bộ nhớ.
  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'logtime.changed') return
        const payload = evt.payload as LogtimeChangedEvent | undefined
        if (!payload?.month || payload.month !== month.value) return
        if (payload.source !== 'user') lastRemoteChange.value = payload
        void loadMonth(payload.month)
      })
    } catch {
      unlisten = null
    }
  }

  async function persistDay(date: string): Promise<void> {
    if (!available.value) return
    try {
      const res = await sc.request<{ date: string; entries: LogtimeEntry[] }>('logtime.save-day', {
        date,
        entries: entriesOf(date),
      })
      // Sidecar cấp id cho dòng mới — nhận lại để lần lưu sau không đẻ id khác.
      days.value[date] = res.entries
      lastError.value = ''
    } catch (err) {
      fail(err)
    }
  }

  // Việc AWOG đo được trong một ngày — nguồn cho panel "Hôm nay bạn đã làm".
  //
  // Không lọc ở đây: việc ẩn những gợi ý ĐÃ KHAI là của UI, nơi giữ danh sách dòng
  // của ngày một cách reactive. Lọc ở tầng này thì bảng không tự đổi khi người dùng
  // vừa thêm một dòng — mà đó đúng là lúc nó cần đổi.
  async function loadSuggestions(target: string): Promise<void> {
    if (!available.value) {
      suggestionsLoaded.value = true
      return
    }
    suggestionsError.value = ''
    try {
      const res = await sc.request<{
        suggestions: LogtimeSuggestion[]
        skippedNoProject: number
        skippedUntracked: number
      }>('logtime.suggestions', { date: target })
      suggestions.value = Array.isArray(res?.suggestions) ? res.suggestions : []
      suggestionsSkipped.value = res?.skippedNoProject ?? 0
      suggestionsUntracked.value = res?.skippedUntracked ?? 0
    } catch (err) {
      // Xoá danh sách cũ: giữ lại thì dưới ngày mới sẽ là gợi ý của ngày TRƯỚC, và
      // người dùng bấm vào đó là khai công cho một việc không thuộc ngày này.
      suggestions.value = []
      suggestionsSkipped.value = 0
      suggestionsUntracked.value = 0
      suggestionsError.value = err instanceof Error ? err.message : String(err)
    } finally {
      suggestionsLoaded.value = true
    }
  }

  // Tóm tắt MỘT gợi ý thành note tiếng Việt (bấm "Đưa vào form"). Không engine ⇒ trả
  // null để caller lùi về tiêu đề gốc, không để trống form. Lỗi cũng trả null — một
  // câu note không tóm tắt được thì dùng tiêu đề thô còn hơn chặn cả thao tác.
  async function composeLine(input: {
    title: string
    projectLabel?: string
    issue?: number
    pr?: number
    kind: 'session' | 'task'
    refId?: string
    seed?: string
  }): Promise<string | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<{ note: string }>('logtime.composeLine', input)
      return typeof res?.note === 'string' && res.note ? res.note : null
    } catch {
      return null
    }
  }

  // Gọi model soạn dòng công nháp cho một ngày. KHÔNG ghi gì — chỉ nạp đề xuất vào
  // state để modal hiện; nhận thì UI gọi `addEntry` từng dòng. Không engine ⇒ báo lỗi
  // rõ (khác gợi ý im lặng): compose là hành động chủ động, người dùng đang chờ kết quả.
  async function compose(target: string): Promise<boolean> {
    if (!available.value) {
      composeError.value = 'engine-unavailable'
      return false
    }
    composeBusy.value = true
    composeError.value = ''
    try {
      const res = await sc.request<{
        context: string
        lines: LogtimeComposeLine[]
        budget: number
      }>('logtime.compose', { date: target })
      composeLines.value = Array.isArray(res?.lines) ? res.lines : []
      composeContext.value = typeof res?.context === 'string' ? res.context : ''
      composeBudget.value = res?.budget ?? 0
      return true
    } catch (err) {
      composeLines.value = []
      composeContext.value = ''
      composeError.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      composeBusy.value = false
    }
  }

  const sameEntry = (date: string, projectKey: string, note: string): boolean =>
    entriesOf(date).some((e) => e.projectKey === projectKey && e.note === note)

  // Ngày này đã có dòng SINH RA TỪ gợi ý `refId` chưa — so theo nguồn thay vì so chữ,
  // vì note có thể đã bị AI viết lại khác tiêu đề gốc của gợi ý.
  const sameEntrySource = (date: string, refId: string): boolean =>
    entriesOf(date).some((e) => e.sourceRefId === refId)

  /**
   * CỔNG DUY NHẤT để thêm một dòng công (ADR 0091 D-6).
   * - ngày đã đủ mức → từ chối
   * - còn chỗ nhưng không đủ → cắt cho vừa (`cut: true`)
   * - trùng dự án + note trong cùng ngày → bỏ qua
   */
  async function addEntry(
    date: string,
    input: {
      projectKey: string
      note: string
      hours: number
      task?: LogtimeTaskRef
      sourceRefId?: string
    },
  ): Promise<AddOutcome> {
    const note = input.note.trim()
    if (!input.projectKey || !note || !(input.hours > 0)) {
      return { added: 0, cut: false, reason: 'invalid' }
    }
    if (sameEntry(date, input.projectKey, note)) {
      return { added: 0, cut: false, reason: 'duplicate' }
    }
    const left = remainingOf(date)
    if (left <= 0) return { added: 0, cut: false, reason: 'full' }
    const hours = Math.min(input.hours, left)
    const entry: LogtimeEntry = {
      id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectKey: input.projectKey,
      note,
      hours,
      ...(input.task ? { task: input.task } : {}),
      status: 'draft',
      ...(input.sourceRefId ? { sourceRefId: input.sourceRefId } : {}),
      updatedAt: Date.now(),
    }
    days.value[date] = [...entriesOf(date), entry]
    await persistDay(date)
    return { added: hours, cut: hours < input.hours, reason: 'ok' }
  }

  async function updateEntry(
    date: string,
    id: string,
    patch: { note?: string; hours?: number; projectKey?: string },
  ): Promise<boolean> {
    const list = entriesOf(date)
    const entry = list.find((e) => e.id === id)
    if (!entry || entry.status === 'locked') return false
    if (patch.hours !== undefined) {
      const others = list.reduce((s, e) => (e.id === id ? s : s + e.hours), 0)
      const max = Math.max(0.25, settings.value.dailyHours - others)
      entry.hours = Math.min(Math.max(0.25, patch.hours), max)
    }
    if (patch.note !== undefined) entry.note = patch.note.trim()
    if (patch.projectKey !== undefined) entry.projectKey = patch.projectKey
    entry.updatedAt = Date.now()
    await persistDay(date)
    return true
  }

  async function removeEntry(date: string, id: string): Promise<void> {
    days.value[date] = entriesOf(date).filter((e) => e.id !== id)
    await persistDay(date)
  }

  /** Chép dòng của một ngày khác sang ngày này — vẫn đi qua cổng `addEntry`. */
  async function copyFrom(
    date: string,
    fromDate: string,
  ): Promise<{ added: number; dup: number; full: number; cut: number }> {
    const out = { added: 0, dup: 0, full: 0, cut: 0 }
    for (const source of entriesOf(fromDate)) {
      const r = await addEntry(date, {
        projectKey: source.projectKey,
        note: source.note,
        hours: source.hours,
        ...(source.task ? { task: source.task } : {}),
      })
      if (r.reason === 'duplicate') out.dup += 1
      else if (r.reason === 'full') out.full += 1
      else if (r.added > 0) {
        out.added += 1
        if (r.cut) out.cut += 1
      }
    }
    return out
  }

  async function pushDay(date: string): Promise<LogtimePushResult[]> {
    if (!available.value) return []
    busy.value = true
    try {
      const res = await sc.request<{ results: LogtimePushResult[]; entries: LogtimeEntry[] }>(
        'logtime.push',
        { date },
      )
      days.value[date] = res.entries
      lastError.value = ''
      return res.results
    } catch (err) {
      fail(err)
      return []
    } finally {
      busy.value = false
    }
  }

  async function pull(from: string, to: string): Promise<number> {
    if (!available.value) return 0
    busy.value = true
    try {
      const res = await sc.request<{
        days: { date: string; entries: LogtimeEntry[] }[]
        errors: { sourceId: string; error: string }[]
        pulled: number
      }>('logtime.pull', { from, to })
      for (const day of res.days) days.value[day.date] = day.entries
      if (res.errors.length > 0) lastError.value = res.errors[0]?.error ?? ''
      else lastError.value = ''
      return res.pulled
    } catch (err) {
      fail(err)
      return 0
    } finally {
      busy.value = false
    }
  }

  async function loadCapabilities(): Promise<void> {
    if (!available.value) return
    busy.value = true
    try {
      const res = await sc.request<{
        sources: LogtimeSourceCapability[]
        available: McpSourceOption[]
      }>('logtime.capabilities')
      capabilities.value = res.sources ?? []
      availableSources.value = res.available ?? []
      lastError.value = ''
    } catch (err) {
      fail(err)
    } finally {
      busy.value = false
    }
  }

  /** Thêm một nguồn vào phạm vi Logtime rồi dò năng lực của riêng nó. */
  async function addSource(sourceId: string): Promise<boolean> {
    if (!sourceId || settings.value.sourceIds.includes(sourceId)) return false
    const ok = await saveSettings({ sourceIds: [...settings.value.sourceIds, sourceId] })
    await loadCapabilities()
    return ok
  }

  /**
   * Bỏ một nguồn khỏi Logtime. Kèm dọn `links` trỏ tới nguồn đó — để lại thì mỗi
   * dòng công của dự án ấy thành "chưa nối PMS" mà người dùng không hiểu vì sao.
   */
  async function removeSource(sourceId: string): Promise<boolean> {
    const links = settings.value.links.filter((l) => l.sourceId !== sourceId)
    const ok = await saveSettings({
      sourceIds: settings.value.sourceIds.filter((s) => s !== sourceId),
      links,
    })
    capabilities.value = capabilities.value.filter((c) => c.sourceId !== sourceId)
    return ok
  }

  // `null` = gọi hỏng (lý do nằm ở `lastError`), `[]` = PMS trả về rỗng thật. Trước
  // đây cả hai đều trả `[]` nên "PMS sập / sai token" trông y hệt "PMS chưa có dự án
  // nào", và caller không có cách nào phân biệt để mà báo.
  async function listProjects(sourceId: string): Promise<PmsOption[] | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<{ projects: PmsOption[] }>('logtime.projects', { sourceId })
      return res.projects ?? []
    } catch (err) {
      fail(err)
      return null
    }
  }

  async function listTasks(
    sourceId: string,
    projectId: string,
    q?: string,
  ): Promise<PmsOption[] | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<{ tasks: PmsOption[] }>('logtime.tasks', {
        sourceId,
        projectId,
        ...(q ? { q } : {}),
      })
      return res.tasks ?? []
    } catch (err) {
      fail(err)
      return null
    }
  }

  // Trả `true` khi ĐÃ ghi xuống đĩa (qua engine). `false` = lỗi RPC, hoặc không có
  // engine (browser-dev — chỉ đổi state trong RAM, chưa lưu). Component đọc để toast.
  async function saveSettings(patch: Partial<LogtimeSettings>): Promise<boolean> {
    settings.value = { ...settings.value, ...patch }
    if (!available.value) return false
    try {
      const res = await sc.request<{ settings: LogtimeSettings }>('logtime.settings-set', patch)
      settings.value = { ...DEFAULT_SETTINGS, ...res.settings }
      lastError.value = ''
      return true
    } catch (err) {
      fail(err)
      return false
    }
  }

  async function saveLink(link: LogtimeLink): Promise<boolean> {
    const links = settings.value.links.filter((l) => l.projectKey !== link.projectKey)
    links.push(link)
    return saveSettings({ links })
  }

  async function removeLink(projectKey: string): Promise<boolean> {
    return saveSettings({ links: settings.value.links.filter((l) => l.projectKey !== projectKey) })
  }

  return {
    // state
    lastRemoteChange,
    settings,
    days,
    month,
    capabilities,
    availableSources,
    loaded,
    busy,
    lastError,
    available,
    suggestions,
    suggestionsSkipped,
    suggestionsUntracked,
    suggestionsLoaded,
    suggestionsError,
    composeLines,
    composeContext,
    composeBudget,
    composeBusy,
    composeError,
    // getters
    entriesOf,
    totalOf,
    remainingOf,
    draftsOf,
    linkOf,
    canPush,
    roundUp,
    // Luật "dòng này đã khai rồi" — `addEntry` từ chối bằng chính hàm này. Panel gợi ý
    // export ra để hỏi CÙNG một câu hỏi; tự chép lại luật thì hai bản sẽ lệch nhau và
    // panel mời thêm một dòng mà cổng kia lặng lẽ bỏ qua.
    sameEntry,
    sameEntrySource,
    // actions
    loadMonth,
    fetchMonthDays,
    loadSuggestions,
    compose,
    composeLine,
    addEntry,
    updateEntry,
    removeEntry,
    copyFrom,
    pushDay,
    pull,
    loadCapabilities,
    addSource,
    removeSource,
    listProjects,
    listTasks,
    saveSettings,
    saveLink,
    removeLink,
  }
})
