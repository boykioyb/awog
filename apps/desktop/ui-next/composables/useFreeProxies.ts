import { computed, onScopeDispose, ref } from 'vue'
import type { FreeProxy, FreeProxyList, FreeProxyProbed, FreeProxyType } from '~/types'
import { sidecarErrorText, useSidecar } from '~/composables/useSidecar'

// Tìm proxy miễn phí + đo độ trễ thật (sidecar `freeProxies.*`).
//
// Luồng: `freeProxies.list` (catalog gộp 2 nguồn, sidecar cache 10 phút) → chọn ~40 ứng viên
// → `freeProxies.probe` trả `probeId` ngay, kết quả về theo event `freeProxies.probed` từng
// proxy rồi `freeProxies.probeDone`. Bảng điền dần theo event.
//
// Event có thể tới TRƯỚC khi `request('probe')` resolve (probeId chưa biết) ⇒ đệm lại rồi
// xả khi đã có probeId. Mọi lần gọi mạng đều do người dùng bấm — không tự chạy khi mở tab.

export const PROBE_CANDIDATES = 40

export type ProbeState =
  | { state: 'pending' }
  | { state: 'ok'; latencyMs: number; blocked: string[] }
  | { state: 'fail'; error?: string }

export type FreeProxyRow = { proxy: FreeProxy; probe: ProbeState }
export type FreeProxyTypeFilter = 'all' | FreeProxyType

type ProbeEvent = { type: 'probed'; data: FreeProxyProbed } | { type: 'done'; probeId: string }

// Ứng viên ưu tiên: uptime cao, rồi độ trễ nguồn thấp (thiếu số liệu xếp sau).
const byQuality = (a: FreeProxy, b: FreeProxy): number =>
  (b.uptime ?? -1) - (a.uptime ?? -1) ||
  (a.sourceLatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.sourceLatencyMs ?? Number.MAX_SAFE_INTEGER)

export const flagEmoji = (iso2: string): string =>
  /^[A-Z]{2}$/.test(iso2)
    ? String.fromCodePoint(...[...iso2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : '🏳️'

export function useFreeProxies() {
  const sidecar = useSidecar()

  const country = ref('') // '' = tất cả
  const typeFilter = ref<FreeProxyTypeFilter>('all')
  // Sidecar tính số đếm theo loại/ẩn danh nhưng TRƯỚC khi lọc quốc gia ⇒ chọn một nước
  // rồi tìm lại không làm select co lại.
  const countries = ref<FreeProxyList['countries']>([])
  const sources = ref<FreeProxyList['sources']>([])
  const loading = ref(false)
  const probing = ref(false)
  const searched = ref(false)
  const error = ref('')
  const total = ref(0)
  const candidates = ref<FreeProxy[]>([])
  const results = ref<Record<string, ProbeState>>({})

  let probeId = ''
  let awaitingProbeId = false
  let buffer: ProbeEvent[] = []
  let unlisten: (() => void) | null = null

  const apply = (ev: ProbeEvent): void => {
    if (ev.type === 'done') {
      if (ev.probeId === probeId) probing.value = false
      return
    }
    const d = ev.data
    if (d.probeId !== probeId) return
    results.value = {
      ...results.value,
      [d.id]: d.ok
        ? { state: 'ok', latencyMs: d.latencyMs ?? 0, blocked: d.blocked ?? [] }
        : { state: 'fail', ...(d.error ? { error: d.error } : {}) },
    }
  }

  const onEvent = (ev: ProbeEvent): void => {
    if (awaitingProbeId) buffer.push(ev)
    else apply(ev)
  }

  const ensureListener = async (): Promise<void> => {
    if (unlisten) return
    unlisten = await sidecar.onEvent((evt) => {
      const p = evt.payload as Record<string, unknown> | null
      if (!p || typeof p.probeId !== 'string') return
      if (evt.type === 'freeProxies.probed') onEvent({ type: 'probed', data: p as FreeProxyProbed })
      else if (evt.type === 'freeProxies.probeDone') onEvent({ type: 'done', probeId: p.probeId })
    })
  }

  const search = async (refresh = false): Promise<void> => {
    error.value = ''
    loading.value = true
    probing.value = false
    probeId = ''
    candidates.value = []
    results.value = {}
    try {
      await ensureListener()
      const list = await sidecar.request<FreeProxyList>('freeProxies.list', {
        ...(country.value ? { countries: [country.value] } : {}),
        ...(typeFilter.value !== 'all' ? { types: [typeFilter.value] } : {}),
        ...(refresh ? { refresh: true } : {}),
      })
      sources.value = list.sources
      countries.value = list.countries
      total.value = list.items.length
      searched.value = true
      const top = [...list.items].sort(byQuality).slice(0, PROBE_CANDIDATES)
      candidates.value = top
      results.value = Object.fromEntries(top.map((p) => [p.id, { state: 'pending' as const }]))
      if (!top.length) return

      awaitingProbeId = true
      buffer = []
      probing.value = true
      try {
        const res = await sidecar.request<{ probeId: string }>('freeProxies.probe', {
          ids: top.map((p) => p.id),
        })
        probeId = res.probeId
      } finally {
        awaitingProbeId = false
      }
      const pending = buffer
      buffer = []
      pending.forEach(apply)
    } catch (err) {
      probing.value = false
      error.value = sidecarErrorText(err)
    } finally {
      loading.value = false
    }
  }

  // Làm việc xong → thứ tự: chạy được và vào được web mở (độ trễ tăng dần) → chạy được nhưng
  // bị chặn (vd. Google) → đang đo (giữ thứ tự ứng viên) → hỏng.
  const rank = (r: FreeProxyRow): number => {
    if (r.probe.state === 'ok') return r.probe.blocked.length ? 1 : 0
    return r.probe.state === 'pending' ? 2 : 3
  }
  const rows = computed<FreeProxyRow[]>(() =>
    candidates.value
      .map((proxy) => ({ proxy, probe: results.value[proxy.id] ?? { state: 'pending' as const } }))
      .sort((a, b) => {
        const ra = rank(a)
        const rb = rank(b)
        if (ra !== rb) return ra - rb
        if (a.probe.state === 'ok' && b.probe.state === 'ok')
          return a.probe.latencyMs - b.probe.latencyMs
        return 0
      }),
  )
  const okCount = computed(() => rows.value.filter((r) => r.probe.state === 'ok').length)
  const doneCount = computed(() => rows.value.filter((r) => r.probe.state !== 'pending').length)

  onScopeDispose(() => {
    unlisten?.()
    unlisten = null
  })

  return {
    country,
    typeFilter,
    countries,
    sources,
    loading,
    probing,
    searched,
    error,
    total,
    rows,
    okCount,
    doneCount,
    search,
  }
}
