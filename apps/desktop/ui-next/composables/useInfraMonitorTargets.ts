// Danh mục TÀI NGUYÊN GIÁM SÁT cho ô chọn của màn Giám sát.
//
// Sidecar (`infra/monitor-targets.ts`) trả về từng nhóm theo LOẠI, và mỗi mục đã
// mang sẵn `dimensions` đúng như CloudWatch muốn — kể cả ca hai dimension của ECS.
// Đây chỉ nạp, nhớ, và gộp lại thành một danh sách phẳng cho ô chọn.
//
// KHÔNG TỰ NẠP LÚC MOUNT. Màn Giám sát cố ý không đi dò tài nguyên mỗi lần mở (mỗi
// lượt dò là một loạt lời gọi AWS), nên lượt nạp này do người dùng bấm.
//
// CACHE THEO (profile, region) CẤP MODULE: đổi tab rồi quay lại không phải dò lại.
// Đổi profile hay region thì là một tài khoản/vùng khác ⇒ khoá khác ⇒ nạp lại,
// đúng như phải thế.
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import {
  MONITOR_KINDS,
  type MonitorTarget,
  type MonitorTargetKind,
} from '~/composables/useInfraMetrics'

export interface MonitorTargetGroup {
  kind: MonitorTargetKind
  items: MonitorTarget[]
  error: string
  truncated: boolean
}

interface Entry {
  loading: boolean
  loaded: boolean
  groups: MonitorTargetGroup[]
  /** Lỗi của CẢ lượt gọi (engine chết, RPC ném). Lỗi từng nhóm nằm trong nhóm. */
  error: string
}

const cache = ref<Record<string, Entry>>({})

function blank(): Entry {
  return { loading: false, loaded: false, groups: [], error: '' }
}

const KIND_SET = new Set<string>(MONITOR_KINDS)

/**
 * Bóc một nhóm từ dây. Payload sidecar là L1 — nhận bừa `kind` lạ sẽ làm
 * `MONITOR_CATALOG[kind]` trả `undefined` và cả màn hỏng ở một chỗ xa đây.
 */
function asGroup(raw: unknown): MonitorTargetGroup | null {
  const bag = (raw ?? {}) as Record<string, unknown>
  if (typeof bag.kind !== 'string' || !KIND_SET.has(bag.kind)) return null
  const kind = bag.kind as MonitorTargetKind
  const items = Array.isArray(bag.items)
    ? bag.items.flatMap((x): MonitorTarget[] => {
        const o = (x ?? {}) as Record<string, unknown>
        if (typeof o.id !== 'string' || !o.id) return []
        if (typeof o.label !== 'string') return []
        const dims = Array.isArray(o.dimensions)
          ? o.dimensions.flatMap((d) => {
              const dd = (d ?? {}) as Record<string, unknown>
              return typeof dd.name === 'string' &&
                typeof dd.value === 'string' &&
                dd.name &&
                dd.value
                ? [{ name: dd.name, value: dd.value }]
                : []
            })
          : []
        // Không có dimension ⇒ truy vấn sẽ không lọc gì và biểu đồ chắc chắn rỗng.
        // Bỏ dòng đó đi thay vì mời người dùng chọn một thứ không chạy được.
        if (dims.length === 0) return []
        return [
          {
            id: o.id,
            kind,
            label: o.label,
            hint: typeof o.hint === 'string' ? o.hint : '',
            dimensions: dims,
          },
        ]
      })
    : []
  return {
    kind,
    items,
    error: typeof bag.error === 'string' ? bag.error : '',
    truncated: bag.truncated === true,
  }
}

export function useInfraMonitorTargets(profile: () => string, region: () => string) {
  const sc = useSidecar()

  const key = computed(() => `${profile()}::${region()}`)
  const entry = computed<Entry>(() => cache.value[key.value] ?? blank())

  /** `force` = người dùng bấm nạp lại sau khi vừa tạo tài nguyên ở nơi khác. */
  async function load(force = false): Promise<void> {
    const k = key.value
    const current = cache.value[k]
    if (current && (current.loading || (current.loaded && !force))) return
    if (!profile()) return

    cache.value = { ...cache.value, [k]: { ...(current ?? blank()), loading: true, error: '' } }

    try {
      if (!sc.available) throw new Error('ENGINE_UNAVAILABLE')
      const res = await sc.request<unknown>('infra.monitor-targets', {
        ...(profile() ? { profile: profile() } : {}),
        ...(region() ? { region: region() } : {}),
        surface: 'explorer',
      })
      const bag = (res ?? {}) as Record<string, unknown>

      // "KHÔNG HIỂU CÂU TRẢ LỜI" KHÁC HẲN "TÀI KHOẢN RỖNG", và gộp chúng là để UI
      // đưa ra một khẳng định về hạ tầng của người dùng mà nó không có cơ sở nào.
      //
      // ⚠ LỖI THẬT, 2026-09-17. Engine đang chạy là bản CŨ (nó còn trả
      // `{ loadBalancers, instances }` của hợp đồng trước), nên `bag.groups` là
      // `undefined`, danh sách ra rỗng, `loaded` vẫn bật, và ô chọn thông báo "Tài
      // khoản này chưa có tài nguyên nào giám sát được" — một câu về AWS của người
      // dùng, trong khi sự thật là renderer và engine đang nói hai thứ tiếng. Người
      // dùng sẽ đi tìm lỗi ở AWS. Sidecar hot-reload KHÔNG theo UI (xem
      // `docs/` + luật rebuild dist), nên đây là trạng thái thường gặp khi đang phát
      // triển, không phải ca hiếm.
      if (!Array.isArray(bag.groups)) {
        cache.value = {
          ...cache.value,
          [k]: { ...blank(), loaded: true, error: 'ENGINE_CONTRACT_MISMATCH' },
        }
        return
      }

      const groups = bag.groups.flatMap((g) => {
        const parsed = asGroup(g)
        return parsed ? [parsed] : []
      })
      cache.value = { ...cache.value, [k]: { loading: false, loaded: true, groups, error: '' } }
    } catch (err) {
      cache.value = {
        ...cache.value,
        [k]: { ...blank(), loaded: true, error: err instanceof Error ? err.message : String(err) },
      }
    }
  }

  /** Nhóm có ít nhất một mục — nhóm rỗng KHÔNG hiện, nó chỉ làm dài ô chọn. */
  const groups = computed<MonitorTargetGroup[]>(() =>
    entry.value.groups.filter((g) => g.items.length > 0),
  )

  /** Tổng số tài nguyên chọn được — dùng để phân biệt "chưa nạp" với "không có gì". */
  const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))

  /**
   * Lỗi của các nhóm, gộp theo NỘI DUNG. Nhiều nguồn hỏng cùng một lý do (token hết
   * hạn) là ca thường gặp nhất, và in năm lần cùng một câu chỉ tổ dài — nhưng hỏng
   * khác lý do thì phải thấy cả hai.
   */
  const groupError = computed<string>(() => {
    const errs = entry.value.groups.map((g) => g.error).filter((e) => e !== '')
    return [...new Set(errs)].join(' · ')
  })

  /**
   * Những action IAM bị từ chối, rút khỏi các câu lỗi.
   *
   * ⚠ LỖI THẬT 2026-09-17: bốn câu `AccessDenied` nối nhau bằng ' · ' ra gần một
   * nghìn ký tự, lặp lại CÙNG một ARN role bốn lần, và thứ duy nhất khác nhau giữa
   * chúng là tên action. Người dùng phải tự đọc dò ra điều đó. UI nay dựng một câu
   * từ danh sách này thay vì in cả bốn.
   *
   * Rỗng ⇒ lỗi KHÔNG phải chuyện quyền (token hết hạn, region sai, CLI chưa cài), và
   * lúc đó câu lỗi gốc mới là thứ đáng đọc.
   */
  const deniedActions = computed<string[]>(() => {
    const out = new Set<string>()
    for (const g of entry.value.groups) {
      const hit = /not authorized to perform:?\s*([A-Za-z0-9_-]+:[A-Za-z0-9_*-]+)/.exec(g.error)
      if (hit?.[1]) out.add(hit[1])
    }
    return [...out]
  })

  function byId(id: string): MonitorTarget | null {
    for (const g of entry.value.groups) {
      const hit = g.items.find((i) => i.id === id)
      if (hit) return hit
    }
    return null
  }

  return {
    loading: computed(() => entry.value.loading),
    loaded: computed(() => entry.value.loaded),
    error: computed(() => entry.value.error),
    groupError,
    deniedActions,
    groups,
    total,
    byId,
    load,
  }
}
