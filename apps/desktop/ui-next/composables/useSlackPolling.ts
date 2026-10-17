import { onBeforeUnmount, onMounted, ref } from 'vue'

// Nhịp làm mới của Slack threads (docs/features/slack-threads.md): thread đang mở 20s,
// các thread còn lại 60s — CHỈ khi bề mặt Slack đang hiện (`active`, do bên gọi bật/tắt:
// modal đang mở / trang cửa sổ riêng đang activate) và cửa sổ không bị ẩn.
//
// Ở đây chỉ có đồng hồ; mỗi nhịp làm gì là việc của bên gọi (`onFast` / `onSlow`).

const FAST_POLL_MS = 20_000
const SLOW_POLL_MS = 60_000

type Options = {
  // Nhịp nhanh — thread đang mở.
  onFast: () => void
  // Nhịp chậm — các thread còn lại.
  onSlow: () => void
  // Cửa sổ vừa hiện lại (đang active): làm tươi ngay, không chờ hết nhịp.
  onVisible: () => void
  // Có được chạy không (vd sidecar chưa sẵn sàng).
  canRun: () => boolean
}

export function useSlackPolling(opts: Options) {
  const active = ref(false)
  const visible = ref(typeof document === 'undefined' || document.visibilityState === 'visible')

  let fastTimer: ReturnType<typeof setInterval> | null = null
  let slowTimer: ReturnType<typeof setInterval> | null = null

  function stop(): void {
    if (fastTimer) clearInterval(fastTimer)
    if (slowTimer) clearInterval(slowTimer)
    fastTimer = null
    slowTimer = null
  }
  function restart(): void {
    stop()
    if (!active.value || !visible.value || !opts.canRun()) return
    fastTimer = setInterval(opts.onFast, FAST_POLL_MS)
    slowTimer = setInterval(opts.onSlow, SLOW_POLL_MS)
  }

  function onVisibility(): void {
    visible.value = document.visibilityState === 'visible'
    if (visible.value && active.value) opts.onVisible()
    restart()
  }

  /** Bật nhịp; trả false nếu đã bật sẵn. */
  function activate(): boolean {
    if (active.value) return false
    active.value = true
    restart()
    return true
  }
  function deactivate(): void {
    active.value = false
    stop()
  }

  onMounted(() => document.addEventListener('visibilitychange', onVisibility))
  onBeforeUnmount(() => {
    deactivate()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { active, visible, activate, deactivate }
}
