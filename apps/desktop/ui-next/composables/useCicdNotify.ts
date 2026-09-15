// Thông báo triển khai (Mốc 4, task 4.5): pipeline hỏng / đang chờ duyệt đi vào
// CHÍNH hộp bell đã có (cạnh hộp thư GitHub và danh sách PR đang theo dõi) và đi
// theo đúng cài đặt kênh gửi ở Settings → Thông báo.
//
// SINGLETON app-lifetime như useGhInbox/usePrWatch: bell và vòng poll đọc cùng một
// mảng. `startCicdNotifications()` gọi MỘT lần từ layout của cửa sổ chính — cửa sổ
// popout không được toast lần thứ hai.
//
// VÌ SAO MẶC ĐỊNH TẮT. Một lượt nạp bảng là nhiều tiến trình `aws` cộng một
// `gh run list` cho MỖI dự án (`useInfraCicd` luật 1: "KHÔNG tự chạy"). Vòng poll
// này chạy nền nên nó phải là lựa chọn của người dùng, không phải mặc định —
// `notifications.cicdEvents` mới bật được nó, và nhịp bị chặn sàn 5 phút.
//
// SoC: không `aws`, không `gh`, không fs — sidecar giữ CLI. Đây chỉ là nhịp, khử
// trùng và cách hiện.
import { computed, ref, watch } from 'vue'
import { useInfraContext } from '~/composables/useInfraContext'
import { useInfraCicdApi } from '~/composables/useInfraCicdApi'
import { CICD_SOURCES, githubProjectsFor } from '~/composables/useInfraCicd'
import { ensureNotificationPermission } from '~/composables/useGhNotifications'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import { useProjectsStore } from '~/stores/projects'
import { useSettingsStore } from '~/stores/settings'
import type { CicdRun } from '~/composables/useInfraCicdApi'

/** Nhịp poll — SÀN 5 phút; xem "vì sao mặc định tắt" ở đầu file. */
export const CICD_NOTIFY_MS = 300_000

/** Trần dòng giữ cho hộp bell. Nhiều hơn thì hộp bell thành một trang log. */
const MAX_ROWS = 20
/** Trần mỗi nguồn xin từ sidecar: đây là hàng đợi thông báo, không phải bảng. */
const LIMIT_PER_SOURCE = 5
/** Nhiều lần chạy hỏng cùng lúc thì gộp phần dư thành MỘT dòng. */
const MAX_TOASTS = 3
/** Đã báo cho lần chạy nào rồi: khoá → mốc, phủ cả lần khởi động lại. */
const SEEN_KEY = 'awog.cicd.notify.seen'
const SEEN_CAP = 300
/** Máy này đã bao giờ poll chưa — quyết định lượt đầu là MỐC IM LẶNG. */
const POLLED_KEY = 'awog.cicd.notify.polledAt'

const runs = ref<CicdRun[]>([])
const lastError = ref<string | null>(null)
const started = ref(false)

let seenCache: Map<string, string> | null = null
let seeded = false
let timer: ReturnType<typeof setInterval> | null = null
let polling = false

/** Lần chạy ĐÁNG làm gián đoạn: hỏng, hoặc đang chờ chính người dùng bấm duyệt. */
function isAttention(run: CicdRun): boolean {
  return run.status === 'failed' || (run.status === 'waiting' && run.needsApproval)
}

/**
 * Khoá khử trùng: `id` ổn định giữa các lượt poll, còn `startedAt` đổi khi CÙNG
 * một workflow được chạy lại (id mới ở GitHub, nhưng CodePipeline giữ nguyên tên).
 * Ghép cả hai thì "chạy lại và hỏng lần nữa" vẫn là một sự kiện mới.
 */
const runKey = (run: CicdRun): string => `${run.source}|${run.id}|${run.startedAt}`

function readSeen(): Map<string, string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as [string, string][]
    return Array.isArray(arr) ? new Map(arr) : new Map()
  } catch {
    return new Map()
  }
}

function seen(): Map<string, string> {
  if (!seenCache) {
    seenCache = readSeen()
    seeded = localStorage.getItem(POLLED_KEY) !== null || seenCache.size > 0
  }
  return seenCache
}

function writeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen().entries()].slice(-SEEN_CAP)))
  } catch {
    // localStorage không có — khử trùng trong phiên này vẫn chạy.
  }
}

function osDeliverable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  )
}

function toastText(run: CicdRun, t: (k: string, p?: Record<string, string>) => string): string {
  const params = { project: run.project, title: run.title }
  if (run.status === 'waiting') return t('infra.cicd.notify.waiting', params)
  return run.stepName
    ? t('infra.cicd.notify.failedAt', { ...params, step: run.stepName })
    : t('infra.cicd.notify.failed', params)
}

/** Mở lần chạy ở nguồn của nó — không dựng đường dẫn thứ hai trong app. */
function openRun(run: CicdRun): void {
  if (run.url) void useLinkOpen().openLink(run.url)
}

/**
 * Thông báo hệ điều hành. `delivery` quyết định KHI NÀO, y hệt useGhNotifications:
 * 'native' bắn luôn (toast đã bị bỏ nên phải có gì đó hiện), 'both' chỉ khi cửa sổ
 * không ở trước mặt. Không tự xin quyền ở đây — chỗ xin là Settings.
 */
function nativeNotify(run: CicdRun, text: string): void {
  const delivery = useSettingsStore().notifications.delivery
  if (delivery === 'toast') return
  if (delivery === 'both' && !document.hidden && document.hasFocus()) return
  if (!osDeliverable()) return
  try {
    const body = [run.branch, run.commit].filter(Boolean).join(' · ') || undefined
    const note = new Notification(text, { body, tag: `awog-cicd-${run.id}` })
    note.onclick = () => {
      try {
        window.focus()
      } catch {
        /* hệ điều hành có thể từ chối; đường mở bên dưới vẫn chạy */
      }
      openRun(run)
    }
  } catch {
    // Webview khoá cứng có thể ném khi dựng Notification.
  }
}

function present(run: CicdRun): void {
  const { t } = useI18n()
  const text = toastText(run, t)
  const nativeOnly = useSettingsStore().notifications.delivery === 'native' && osDeliverable()
  if (!nativeOnly) {
    useToast().add({
      title: text,
      color: run.status === 'failed' ? 'error' : 'info',
      icon: run.status === 'failed' ? 'alert' : 'zap',
      onClick: () => openRun(run),
    })
  }
  nativeNotify(run, text)
}

// Một vòng poll. Im lặng khi hỏng (chưa cấu hình AWS, gh chưa đăng nhập, mất
// mạng): một toast lỗi mỗi 5 phút còn tệ hơn tính năng bị thiếu — bell và
// Settings surface lỗi cuối cùng.
async function poll(): Promise<void> {
  if (polling) return
  const settings = useSettingsStore()
  if (!settings.notifications.cicdEvents) return
  if (!useSidecar().available) return
  polling = true
  try {
    const { t } = useI18n()
    const context = useInfraContext({ sessionId: null }).effective.value
    const stored = seen()
    const res = await useInfraCicdApi().list({
      sources: [...CICD_SOURCES],
      projects: githubProjectsFor(),
      context,
      limit: LIMIT_PER_SOURCE,
    })
    lastError.value = null

    const attention = res.results
      .flatMap((r) => r.runs)
      .filter(isAttention)
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
      .slice(0, MAX_ROWS)
    runs.value = attention

    // Đánh dấu TRƯỚC khi hiện: một toast ném lỗi không được làm lượt sau coi những
    // lần chạy này là mốc im lặng lần nữa.
    const fresh = attention.filter((r) => !stored.has(runKey(r)))
    for (const r of fresh) stored.set(runKey(r), r.startedAt)
    writeSeen()
    try {
      localStorage.setItem(POLLED_KEY, new Date().toISOString().replace(/\.\d+Z$/, 'Z'))
    } catch {
      // Không có mốc thì lần khởi động sau chỉ im lặng thêm một lượt; `seen` vẫn khử trùng.
    }

    // Lượt poll ĐẦU TIÊN trên máy này chỉ dựng mốc: không toast một loạt lần chạy
    // đã hỏng từ trước khi người dùng bật tính năng.
    if (!seeded) {
      seeded = true
      return
    }

    for (const r of fresh.slice(0, MAX_TOASTS)) present(r)
    const overflow = fresh.length - MAX_TOASTS
    if (overflow > 0) {
      useToast().add({ title: t('infra.cicd.notify.more', { n: overflow }), color: 'info' })
    }
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'infra.cicd-runs failed'
  } finally {
    polling = false
  }
}

function schedule(): void {
  if (timer) clearInterval(timer)
  timer = null
  if (!useSettingsStore().notifications.cicdEvents) return
  timer = setInterval(() => void poll(), CICD_NOTIFY_MS)
  void poll()
}

/**
 * Gọi MỘT lần từ layout cửa sổ chính. Tắt tính năng thì vòng poll dừng và danh
 * sách cũ bị xoá — một hộp bell còn hàng của lượt poll trước là hộp bell nói dối
 * về hiện tại.
 */
export function startCicdNotifications(): void {
  if (started.value) return
  started.value = true
  const settings = useSettingsStore()
  const projects = useProjectsStore()

  watch(
    () => [
      settings.notifications.cicdEvents,
      settings.githubAccount,
      projects.projects.length,
      // Ngữ cảnh AWS đổi thì `gh`/`aws` tiếp theo hỏi tài khoản khác.
      settings.infra.profile ?? '',
      settings.infra.region ?? '',
      settings.infra.accountId ?? '',
    ],
    () => {
      if (!settings.notifications.cicdEvents) runs.value = []
      schedule()
    },
    { immediate: true },
  )
}

// Lượt xin quyền OS đang bay — Settings gọi khi người dùng chọn kênh gửi.
export { ensureNotificationPermission }

// Read-only view cho hộp bell.
export function useCicdNotifyStatus() {
  return {
    started,
    lastError,
    runs: computed(() => runs.value),
  }
}
