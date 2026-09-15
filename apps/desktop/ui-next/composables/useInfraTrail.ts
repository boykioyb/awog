// CloudTrail cho màn Nhật ký (Mốc 7, việc 7.6).
//
// TRẠNG THÁI Ở MỨC MODULE vì khối này sống trong màn Nhật ký, mà màn đó nằm dưới
// `<NuxtPage keepalive />` — kết quả một lượt tra phải sống qua lần đổi tab. Các
// composable cần app instance vẫn gọi TRONG thân hàm.
//
// KHÔNG TỰ CHẠY. Màn Nhật ký tự nạp lúc mở vì nó chỉ đọc một file cục bộ; khối này thì
// KHÁC HẲN — nó spawn `aws cloudtrail lookup-events`, một lời gọi mạng thật, trên một
// API mà AWS giới hạn 2 request/giây. Nên nó có nút riêng và không bao giờ tự nạp theo
// màn cha.
//
// NHÃN `origin` LÀ SUY ĐOÁN, và UI phải hiện `matchedAt` kèm theo. Xem đầu
// `sidecar/infra/audit/trail.ts` để biết phép ghép sai ở đâu.
import { computed, ref } from 'vue'
import { useInfraContext } from '~/composables/useInfraContext'
import { useSidecar } from '~/composables/useSidecar'

export type TrailOrigin = 'awog' | 'external'

export type TrailEvent = {
  id: string
  at: string
  name: string
  source: string
  username: string
  resources: string[]
  origin: TrailOrigin
  matchedAt?: string
  errorCode?: string
}

export type TrailReport = {
  events: TrailEvent[]
  hasMore: boolean
  awogCount: number
  externalCount: number
}

type TrailWire =
  | { ok: true; report: TrailReport; limits: { maxDays: number; matchWindowMs: number } }
  | { ok: false; error: string }

/** Khoảng thời gian tra. Trần cứng của API là 90 ngày — xem `TRAIL_MAX_DAYS`. */
export const TRAIL_RANGES = ['1h', '24h', '7d', '30d'] as const
export type TrailRange = (typeof TRAIL_RANGES)[number]

const RANGE_MS: Record<TrailRange, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
}

const report = ref<TrailReport | null>(null)
const loading = ref(false)
const error = ref('')
const range = ref<TrailRange>('24h')
const loadedAt = ref<number | null>(null)
const limits = ref<{ maxDays: number; matchWindowMs: number } | null>(null)
/** Chỉ hiện sự kiện KHÔNG do AWOG gây ra — câu hỏi thường gặp nhất của màn này. */
const externalOnly = ref(false)
/** Tài nguyên đang xem lịch sử. Rỗng = tra cả tài khoản. */
const resourceName = ref('')

export function useInfraTrail() {
  const sc = useSidecar()
  const infraContext = useInfraContext({ sessionId: null })

  const context = computed(() => {
    const e = infraContext.effective.value
    return {
      ...(e.profile ? { profile: e.profile } : {}),
      ...(e.region ? { region: e.region } : {}),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    }
  })
  const hasAccount = computed(() => Boolean(context.value.profile))
  const sidecarAvailable = computed(() => sc.available)

  async function lookup(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = ''
    try {
      const res = await sc.request<TrailWire>('infra.trail-lookup', {
        context: context.value,
        since: new Date(Date.now() - RANGE_MS[range.value]).toISOString(),
        ...(resourceName.value.trim() ? { resourceName: resourceName.value.trim() } : {}),
        surface: 'audit',
      })
      if (!res.ok) {
        error.value = res.error
        return
      }
      report.value = res.report
      limits.value = res.limits
      loadedAt.value = Date.now()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  /** Mở khối và tra lịch sử của ĐÚNG một tài nguyên — đường của "Lịch sử thay đổi". */
  function lookupResource(name: string): Promise<void> {
    resourceName.value = name
    return lookup()
  }

  const visible = computed(() => {
    const all = report.value?.events ?? []
    return externalOnly.value ? all.filter((e) => e.origin === 'external') : all
  })

  return {
    context,
    hasAccount,
    sidecarAvailable,
    report,
    visible,
    loading,
    error,
    range,
    ranges: TRAIL_RANGES,
    loadedAt,
    limits,
    externalOnly,
    resourceName,
    lookup,
    lookupResource,
  }
}
