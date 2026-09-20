// Cảnh báo tài nguyên: nhịp đo chạy nền, bắn thông báo khi một ngưỡng bị vượt.
//
// VÌ SAO TỒN TẠI. Trang `/monitor` chỉ phát hiện khi người dùng MỞ nó ra — mà
// không ai mở trang giám sát khi chưa nghi ngờ gì. Ca thúc đẩy tính năng này là
// một sidecar mồ côi chạy 18 tiếng ở 99% CPU: nó nằm im suốt đêm đúng vì không
// có bề mặt nào tự nói ra.
//
// SINGLETON app-lifetime như useGhInbox/useCicdNotify: `startResourceAlerts()`
// gọi MỘT lần từ layout của cửa sổ chính — cửa sổ popout không được báo lần hai.
//
// KHÁC `useCicdNotify` ở chỗ MẶC ĐỊNH BẬT: một lượt đo là đúng một tiến trình
// `ps` mỗi phút (~15ms), không phải một chùm lệnh `aws`.
//
// SoC: không đụng `ps`, không đụng fs — sidecar giữ hết. Đây chỉ là nhịp, luật
// ngưỡng, khử trùng, và cách hiện.
import { ref, watch } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import { presentNotification } from '~/composables/useAppNotify'
import { useI18n } from '~/composables/useI18n'
import {
  formatCpuLoad,
  formatMem,
  type MonitorProcess,
  type MonitorSnapshot,
} from '~/composables/useMonitorManager'

/** Nhịp đo nền. Chậm hơn nhiều so với 2 giây của trang — đây là canh gác, không phải đồng hồ. */
export const RESOURCE_ALERT_MS = 60_000

/** Trần thông báo mỗi lượt: ba tiến trình cùng vượt ngưỡng không được thành ba toast liên tiếp. */
const MAX_ALERTS_PER_TICK = 2

const started = ref(false)
const lastError = ref<string | null>(null)

let timer: ReturnType<typeof setInterval> | null = null
let polling = false

/**
 * Sự cố ĐANG mở, theo pid (hoặc khoá `mem` cho ngưỡng RAM toàn app).
 *
 * Đây là thứ giữ cho tính năng không thành máy phát thông báo: một tiến trình
 * chạy tít 3 tiếng phải báo MỘT lần, không phải 180 lần. Khoá chỉ được gỡ khi
 * điều kiện thôi đúng — pid biến mất, hoặc số tụt xuống dưới ngưỡng.
 *
 * Cố ý chỉ nằm trong RAM: khởi động lại app là lúc ta MUỐN báo lại (tiến trình
 * mồ côi sống sót qua một lần khởi động lại chính là tin đáng báo nhất).
 */
const firedOrphan = new Set<number>()
const firedCpu = new Set<number>()
/** pid → lúc bắt đầu vượt ngưỡng CPU. Chưa đủ lâu thì chưa báo. */
const cpuSince = new Map<number, number>()
let firedMemory = false

function openMonitor(): void {
  void navigateTo('/monitor')
}

/** Tiến trình mồ côi: báo một lần cho mỗi pid mới thấy. */
function checkOrphans(snap: MonitorSnapshot, t: ReturnType<typeof useI18n>['t']): MonitorProcess[] {
  const alive = new Set(snap.orphans.map((p) => p.pid))
  for (const pid of firedOrphan) if (!alive.has(pid)) firedOrphan.delete(pid)

  const fresh = snap.orphans.filter((p) => !firedOrphan.has(p.pid))
  for (const p of fresh) firedOrphan.add(p.pid)
  if (fresh.length === 0) return []

  // Gộp thành MỘT thông báo: mồ côi hay đi theo chùm (một sidecar chết kéo theo
  // các tiến trình con của nó), và ba toast nói cùng một chuyện là nhiễu.
  const worst = [...fresh].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))[0]
  if (!worst) return []
  presentNotification({
    text:
      fresh.length === 1
        ? t('monitor.alert.orphan.one', {
            label: worst.label,
            cpu: formatCpuLoad(worst.cpuPercent),
          })
        : t('monitor.alert.orphan.many', { n: fresh.length, cpu: formatCpuLoad(worst.cpuPercent) }),
    body: t('monitor.alert.orphan.body'),
    tag: 'awog-monitor-orphan',
    color: 'error',
    icon: 'alert',
    onClick: openMonitor,
  })
  return fresh
}

/** CPU cao LIÊN TỤC: phải vượt ngưỡng đủ lâu mới báo, để một cú build không kích hoạt. */
function checkCpu(
  snap: MonitorSnapshot,
  t: ReturnType<typeof useI18n>['t'],
  limitPercent: number,
  minMinutes: number,
): void {
  const now = snap.at
  const all = [...snap.processes, ...snap.orphans]
  const alive = new Set(all.map((p) => p.pid))
  for (const pid of cpuSince.keys()) if (!alive.has(pid)) cpuSince.delete(pid)
  for (const pid of firedCpu) if (!alive.has(pid)) firedCpu.delete(pid)

  const hot: MonitorProcess[] = []
  for (const p of all) {
    // `null` = nhịp đầu, chưa có hiệu để tính. Không được coi là "mát".
    if (p.cpuPercent === null) continue
    if (p.cpuPercent < limitPercent) {
      cpuSince.delete(p.pid)
      firedCpu.delete(p.pid)
      continue
    }
    const since = cpuSince.get(p.pid) ?? now
    if (!cpuSince.has(p.pid)) cpuSince.set(p.pid, now)
    if (now - since < minMinutes * 60_000) continue
    if (firedCpu.has(p.pid)) continue
    hot.push(p)
  }

  // Tiến trình mồ côi đã có thông báo riêng nói đúng vấn đề của nó; đừng báo hai lần.
  const fresh = hot.filter((p) => p.orphan !== true)
  for (const p of hot) firedCpu.add(p.pid)

  for (const p of fresh.slice(0, MAX_ALERTS_PER_TICK)) {
    presentNotification({
      text: t('monitor.alert.cpu.title', {
        label: p.label,
        cpu: formatCpuLoad(p.cpuPercent),
        minutes: minMinutes,
      }),
      body: p.command,
      tag: `awog-monitor-cpu-${p.pid}`,
      color: 'warning',
      icon: 'zap',
      onClick: openMonitor,
    })
  }
}

/** RAM toàn app vượt ngưỡng. Trễ 10% khi hạ để một con số dao động quanh ngưỡng không nhấp nháy. */
function checkMemory(
  snap: MonitorSnapshot,
  t: ReturnType<typeof useI18n>['t'],
  limitGb: number,
): void {
  const limitKb = limitGb * 1024 * 1024
  if (snap.totals.rssKb < limitKb * 0.9) firedMemory = false
  if (snap.totals.rssKb < limitKb || firedMemory) return
  firedMemory = true
  presentNotification({
    text: t('monitor.alert.memory.title', { mem: formatMem(snap.totals.rssKb), limit: limitGb }),
    body: t('monitor.alert.memory.body', { count: snap.totals.processCount }),
    tag: 'awog-monitor-memory',
    color: 'warning',
    icon: 'alert',
    onClick: openMonitor,
  })
}

async function poll(): Promise<void> {
  if (polling) return
  const cfg = useSettingsStore().notifications.resources
  if (!cfg.enabled) return
  if (!useSidecar().available) return
  polling = true
  try {
    const snap = await useSidecar().request<MonitorSnapshot>('monitor.sample')
    lastError.value = null
    // Nhịp đầu không có hiệu CPU nên mọi luật dựa trên CPU đều vô nghĩa — nhưng
    // tiến trình mồ côi thì KHÔNG cần hiệu để nhận ra, và đó chính là thứ đáng
    // báo ngay lúc mở app.
    const { t } = useI18n()
    if (cfg.orphans) checkOrphans(snap, t)
    if (snap.warmingUp) return
    if (cfg.highCpu) checkCpu(snap, t, cfg.cpuPercent, cfg.cpuMinutes)
    if (cfg.highMemory) checkMemory(snap, t, cfg.memoryGb)
  } catch (err) {
    // Im lặng khi hỏng: một toast lỗi mỗi phút còn tệ hơn tính năng bị thiếu.
    lastError.value = err instanceof Error ? err.message : 'monitor.sample failed'
  } finally {
    polling = false
  }
}

function schedule(): void {
  if (timer) clearInterval(timer)
  timer = null
  if (!useSettingsStore().notifications.resources.enabled) return
  timer = setInterval(() => void poll(), RESOURCE_ALERT_MS)
  void poll()
}

/**
 * Gọi MỘT lần từ layout cửa sổ chính. Tắt tính năng thì vòng đo dừng và mọi khoá
 * sự cố bị xoá — bật lại sau đó phải được coi là một khởi đầu sạch.
 */
export function startResourceAlerts(): void {
  if (started.value) return
  started.value = true
  const settings = useSettingsStore()
  watch(
    () => [
      settings.notifications.resources.enabled,
      settings.notifications.resources.cpuPercent,
      settings.notifications.resources.cpuMinutes,
      settings.notifications.resources.memoryGb,
    ],
    () => {
      firedOrphan.clear()
      firedCpu.clear()
      cpuSince.clear()
      firedMemory = false
      schedule()
    },
    { immediate: true },
  )
}

/** Read-only, cho Settings hiện lỗi cuối cùng. */
export function useResourceAlertStatus() {
  return { started, lastError }
}
