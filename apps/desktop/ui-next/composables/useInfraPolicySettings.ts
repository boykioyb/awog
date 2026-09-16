// Ma trận quyền hạ tầng, phía UI — nguồn duy nhất cho màn Settings → Hạ tầng.
//
// VÌ SAO MÀN NÀY TỒN TẠI. `infra.policy.set` có từ task 0.7 nhưng tới 2026-09-16
// KHÔNG màn nào gọi nó: UI chỉ đọc (`infra.policy.get` ở Tổng quan và ở chip
// phiên) và bảo lãnh binary. Hệ quả cụ thể: người dùng thấy chip PRODUCTION đỏ
// trên chính tài khoản cá nhân của họ (vì `accountKindOf` coi account chưa biết
// là production) và không có đường nào đổi — kể cả câu gợi ý trong hộp duyệt
// cũng từng chỉ sang một màn Settings không tồn tại.
//
// KHÔNG DÙNG PINIA. Chính sách cố ý nằm ngoài `settings.json` (xem đầu
// `infra/policy-store.ts`): gộp vào store settings là mở lại đúng cái cửa mà
// sidecar vừa đóng — một `settings.set` tuỳ ý ghi được ma trận. Ở đây mọi lượt
// ghi đi qua RPC riêng, và sidecar ghi một dòng nhật ký cho từng lượt.
//
// SNAPSHOT LÀ SỰ THẬT. Mọi hàm ghi đều lấy snapshot RPC trả về làm state mới chứ
// không tự sửa state tại chỗ: ghi hỏng thì màn hình phải quay lại đúng thứ đang
// nằm trên đĩa, không được hiển thị một quyền mà máy không thật sự có.
//
// BA KIỂU CỦA MA TRẬN KHÔNG KHAI Ở ĐÂY. `InfraMode`/`InfraCommandClass` là bản
// mirror của sidecar, nhà của chúng là `~/types`; `InfraAccountKind` là của
// `useConfirm` (hộp duyệt đã dùng để tô chip đỏ). Khai lại trong một composable
// là dựng thêm một cái tên trùng trong vùng auto-import của Nuxt — nó chỉ giữ
// được một, nên nơi gọi bốc phải định nghĩa nào là do thứ tự quét quyết định.
import { computed, onBeforeUnmount, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import type { InfraAccountKind } from '~/composables/useConfirm'
import type { InfraCommandClass, InfraMode } from '~/types'

export type InfraMatrix = Record<InfraCommandClass, Record<InfraAccountKind, InfraMode>>

export interface InfraPolicySnapshot {
  matrix: InfraMatrix
  prodAccountIds: string[]
  bypassUntil: string | null
  bypassSecondsLeft: number
  vouchedBinaryPaths: string[]
}

/** Thứ tự hiển thị = thứ tự siết dần, để đọc bảng từ trên xuống là thấy mức tăng. */
export const INFRA_CLASSES: readonly InfraCommandClass[] = [
  'read',
  'write',
  'context-switch',
  'destructive',
]
export const INFRA_KINDS: readonly InfraAccountKind[] = ['normal', 'production']
export const INFRA_MODES: readonly InfraMode[] = ['auto', 'ask', 'block']
/** Cùng danh sách với `BypassSchema` ở sidecar — mốc khác sẽ bị từ chối. */
export const BYPASS_MINUTES: readonly (15 | 30 | 60)[] = [15, 30, 60]

const DEFAULT_MATRIX: InfraMatrix = {
  read: { normal: 'auto', production: 'auto' },
  write: { normal: 'ask', production: 'ask' },
  destructive: { normal: 'ask', production: 'block' },
  'context-switch': { normal: 'auto', production: 'ask' },
}

function isMode(v: unknown): v is InfraMode {
  return v === 'auto' || v === 'ask' || v === 'block'
}

/**
 * Đọc khoan dung: ô nào không hiểu thì lấy mặc định của đúng ô đó, không vứt cả
 * bảng. Cùng luật với `coerceMatrix` ở sidecar, và vì cùng luật nên một bản AWOG
 * cũ mở file của bản mới sẽ thấy bảng gần đúng thay vì một màn hình trống.
 */
function parseMatrix(raw: unknown): InfraMatrix {
  const bag = (raw ?? {}) as Record<string, unknown>
  const out = {} as InfraMatrix
  for (const cls of INFRA_CLASSES) {
    const col = (bag[cls] ?? {}) as Record<string, unknown>
    out[cls] = {
      normal: isMode(col.normal) ? col.normal : DEFAULT_MATRIX[cls].normal,
      production: isMode(col.production) ? col.production : DEFAULT_MATRIX[cls].production,
    }
  }
  return out
}

function parseSnapshot(raw: unknown): InfraPolicySnapshot {
  const bag = (raw ?? {}) as Record<string, unknown>
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return {
    matrix: parseMatrix(bag.matrix),
    prodAccountIds: strings(bag.prodAccountIds),
    bypassUntil: typeof bag.bypassUntil === 'string' ? bag.bypassUntil : null,
    bypassSecondsLeft: typeof bag.bypassSecondsLeft === 'number' ? bag.bypassSecondsLeft : 0,
    vouchedBinaryPaths: strings(bag.vouchedBinaryPaths),
  }
}

export function useInfraPolicySettings() {
  const sc = useSidecar()

  const snapshot = ref<InfraPolicySnapshot | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  /**
   * Giây còn lại, đếm TẠI CHỖ. Sidecar chỉ trả một con số ở thời điểm gọi, nên
   * không có đồng hồ này thì "còn 14 phút" sẽ đứng nguyên tới lần nạp sau — và
   * một cửa nới quyền trông như vĩnh viễn là đúng thứ không được phép.
   */
  const secondsLeft = ref(0)
  let ticker: ReturnType<typeof setInterval> | null = null

  function startTicker(): void {
    if (ticker) return
    ticker = setInterval(() => {
      if (secondsLeft.value <= 0) return
      secondsLeft.value -= 1
    }, 1000)
  }

  onBeforeUnmount(() => {
    if (ticker) clearInterval(ticker)
    ticker = null
  })

  function apply(raw: unknown): void {
    const snap = parseSnapshot(raw)
    snapshot.value = snap
    secondsLeft.value = snap.bypassSecondsLeft
    if (snap.bypassSecondsLeft > 0) startTicker()
  }

  async function load(): Promise<void> {
    if (!sc.available) {
      error.value = 'ENGINE_UNAVAILABLE'
      return
    }
    loading.value = true
    error.value = ''
    try {
      apply(await sc.request<unknown>('infra.policy.get'))
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  /** Bọc một lượt ghi: cờ `saving`, nuốt-rồi-hiện lỗi, và luôn nhận snapshot mới. */
  async function write(method: string, params?: unknown): Promise<boolean> {
    if (!sc.available) {
      error.value = 'ENGINE_UNAVAILABLE'
      return false
    }
    saving.value = true
    error.value = ''
    try {
      apply(await sc.request<unknown>(method, params))
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      // Kéo lại sự thật trên đĩa: một lượt ghi hỏng không được để màn hình giữ ô
      // người dùng vừa bấm.
      await load()
      return false
    } finally {
      saving.value = false
    }
  }

  /**
   * Đổi MỘT ô. Gửi cả bảng vì `infra.policy.set` nhận cả bảng (một ô vắng mặt ở
   * đó có nghĩa "payload hỏng", không phải "giữ nguyên").
   */
  async function setCell(
    cls: InfraCommandClass,
    kind: InfraAccountKind,
    mode: InfraMode,
  ): Promise<boolean> {
    const snap = snapshot.value
    if (!snap || snap.matrix[cls][kind] === mode) return false
    const matrix: InfraMatrix = {
      ...snap.matrix,
      [cls]: { ...snap.matrix[cls], [kind]: mode },
    }
    return write('infra.policy.set', { matrix })
  }

  async function resetMatrix(): Promise<boolean> {
    return write('infra.policy.set', { matrix: DEFAULT_MATRIX })
  }

  async function addProdAccount(id: string): Promise<boolean> {
    const snap = snapshot.value
    const clean = id.trim()
    if (!snap || !clean || snap.prodAccountIds.includes(clean)) return false
    return write('infra.policy.set', { prodAccountIds: [...snap.prodAccountIds, clean] })
  }

  async function removeProdAccount(id: string): Promise<boolean> {
    const snap = snapshot.value
    if (!snap) return false
    return write('infra.policy.set', {
      prodAccountIds: snap.prodAccountIds.filter((x) => x !== id),
    })
  }

  async function setBypass(minutes: 15 | 30 | 60 | null): Promise<boolean> {
    return write('infra.policy.bypass', { minutes })
  }

  async function unvouchBinary(path: string): Promise<boolean> {
    return write('infra.policy.unvouchBinary', { path })
  }

  const matrix = computed<InfraMatrix>(() => snapshot.value?.matrix ?? DEFAULT_MATRIX)
  const isDefaultMatrix = computed<boolean>(() =>
    INFRA_CLASSES.every((cls) =>
      INFRA_KINDS.every((kind) => matrix.value[cls][kind] === DEFAULT_MATRIX[cls][kind]),
    ),
  )
  const bypassActive = computed<boolean>(() => secondsLeft.value > 0)

  /** `mm:ss` — phút thôi thì không thấy nó đang chạy, giây thôi thì khó đọc. */
  const bypassLeftLabel = computed<string>(() => {
    const s = Math.max(0, secondsLeft.value)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  })

  return {
    snapshot,
    matrix,
    isDefaultMatrix,
    loading,
    saving,
    error,
    bypassActive,
    bypassLeftLabel,
    load,
    setCell,
    resetMatrix,
    addProdAccount,
    removeProdAccount,
    setBypass,
    unvouchBinary,
  }
}
