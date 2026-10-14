import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { formatMem, type MonitorSnapshot } from '~/composables/useMonitorManager'

// CPU + RAM thu gọn cho status bar của Workbench (chip "CPU · RAM").
//
// Khác `useMonitorManager`: bản đó là page-controller của /monitor (bảng
// tiến trình, sort, kill, 3 phạm vi) — quá nặng cho một chip 26px. Ở đây chỉ
// poll `monitor.sample` scope 'awog' rồi đọc `totals`. CPU là hiệu 2 nhịp ở
// sidecar nên chip PHẢI poll (nhịp đầu `warmingUp` — hiện "…" thay vì 0%).
// Nhịp chậm hơn trang (4s): chip là tin glanceable, không phải bảng đo.
const POLL_MS = 4000

export function useWorkbenchMonitor() {
  const sc = useSidecar()
  const snapshot = ref<MonitorSnapshot | null>(null)

  const cpuLabel = computed(() => {
    const p = snapshot.value?.totals.cpuPercent
    return p == null ? '…' : `${Math.round(p)}%`
  })
  const ramLabel = computed(() => {
    const kb = snapshot.value?.totals.rssKb
    return kb ? formatMem(kb) : '…'
  })

  async function poll() {
    try {
      snapshot.value = await sc.request<MonitorSnapshot>('monitor.sample', { scope: 'awog' })
    } catch {
      // Engine chưa sẵn sàng / browser-dev — chip giữ "…" thay vì ném lỗi.
      snapshot.value = null
    }
  }
  // Timer của môi trường này là `NodeJS.Timeout` (vue-tsc gộp @types/node) —
  // `clearInterval` nhận thẳng giá trị đó nên không cần guard hay cast.
  let timer: NodeJS.Timeout | undefined
  function start() {
    if (timer || !sc.available) return
    void poll()
    timer = setInterval(() => void poll(), POLL_MS)
  }
  function stop() {
    clearInterval(timer)
    timer = undefined
  }
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(stop)
  // Trang có thể mount ở trạng thái đã active (lần đầu, chưa qua KeepAlive).
  start()

  return { cpuLabel, ramLabel }
}
