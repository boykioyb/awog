// Danh sách ALB + EC2 cho hai ô lọc của màn Giám sát / Bảng điều khiển.
//
// Hai ô đó trước là ô CHỮ TRẦN: người dùng phải tự biết CloudWatch muốn gì rồi gõ
// tay. Với EC2 còn đoán được (`i-…`); với ALB thì không, vì dimension
// `LoadBalancer` nhận PHẦN ĐUÔI ARN (`app/<tên>/<mã>`) chứ không nhận tên. Phép
// cắt đó nằm ở sidecar (`infra/monitor-targets.ts`) — đây chỉ nạp và nhớ.
//
// KHÔNG TỰ NẠP LÚC MOUNT. Màn Giám sát cố ý không đi dò tài nguyên mỗi lần mở
// (mỗi lượt dò là thêm lời gọi AWS), nên lượt nạp này do người dùng bấm.
//
// CACHE THEO (profile, region) CẤP MODULE: đổi tab rồi quay lại, hoặc mở màn Bảng
// điều khiển sau màn Giám sát, không phải dò lại. Đổi profile hay region thì là
// một tài khoản/vùng khác ⇒ khoá khác ⇒ nạp lại, đúng như phải thế.
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

export interface MonitorTarget {
  value: string
  label: string
}

interface TargetGroup {
  items: MonitorTarget[]
  error: string
}

interface Entry {
  loading: boolean
  loaded: boolean
  loadBalancers: TargetGroup
  instances: TargetGroup
  /** Lỗi của CẢ lượt gọi (engine chết, RPC ném). Lỗi từng nhóm nằm trong nhóm. */
  error: string
}

const EMPTY_GROUP: TargetGroup = { items: [], error: '' }

const cache = ref<Record<string, Entry>>({})

function blank(): Entry {
  return {
    loading: false,
    loaded: false,
    loadBalancers: { ...EMPTY_GROUP },
    instances: { ...EMPTY_GROUP },
    error: '',
  }
}

function asGroup(raw: unknown): TargetGroup {
  const bag = (raw ?? {}) as Record<string, unknown>
  const items = Array.isArray(bag.items)
    ? bag.items.flatMap((x) => {
        const o = (x ?? {}) as Record<string, unknown>
        return typeof o.value === 'string' && o.value && typeof o.label === 'string'
          ? [{ value: o.value, label: o.label }]
          : []
      })
    : []
  return { items, error: typeof bag.error === 'string' ? bag.error : '' }
}

export function useInfraMonitorTargets(
  profile: () => string,
  region: () => string,
  surface: 'explorer' | 'dashboards',
) {
  const sc = useSidecar()

  const key = computed(() => `${profile()}::${region()}`)
  const entry = computed<Entry>(() => cache.value[key.value] ?? blank())

  /** `force` = người dùng bấm nạp lại sau khi vừa tạo tài nguyên ở nơi khác. */
  async function load(force = false): Promise<void> {
    const k = key.value
    const current = cache.value[k]
    if (current && (current.loading || (current.loaded && !force))) return
    if (!profile()) return

    const next = { ...(current ?? blank()), loading: true, error: '' }
    cache.value = { ...cache.value, [k]: next }

    try {
      if (!sc.available) throw new Error('ENGINE_UNAVAILABLE')
      const res = await sc.request<unknown>('infra.monitor-targets', {
        ...(profile() ? { profile: profile() } : {}),
        ...(region() ? { region: region() } : {}),
        surface,
      })
      const bag = (res ?? {}) as Record<string, unknown>
      cache.value = {
        ...cache.value,
        [k]: {
          loading: false,
          loaded: true,
          loadBalancers: asGroup(bag.loadBalancers),
          instances: asGroup(bag.instances),
          error: '',
        },
      }
    } catch (err) {
      cache.value = {
        ...cache.value,
        [k]: {
          ...blank(),
          loaded: true,
          error: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  return {
    loading: computed(() => entry.value.loading),
    loaded: computed(() => entry.value.loaded),
    error: computed(() => entry.value.error),
    loadBalancers: computed(() => entry.value.loadBalancers),
    instances: computed(() => entry.value.instances),
    load,
  }
}
