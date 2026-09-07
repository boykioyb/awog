// Theo dõi CI + review của một PR cụ thể, và đẩy biến động vào phiên đang mở
// (docs/features/github-notifications.md).
//
// SINGLETON app-lifetime, giống useGhInbox: bell, danh sách theo dõi và cái poller
// cùng đọc một mảng.
//
// NHỊP: KHÔNG có timer ở đây. `pollPrWatch()` được gọi trong đúng nhịp của hộp thư
// thông báo (useGhNotifications) — dựng thêm một vòng lặp thứ hai chỉ để nhân đôi
// lưu lượng tới cùng một API. Sidecar còn áp lại sàn 60s của riêng nó, nên gọi
// thừa cũng không thành bão request (nó trả `throttled: true`).
//
// ĐẨY VÀO PHIÊN: renderer KHÔNG làm gì cả. Khi một PR có biến động, sidecar phát
// `session.inbox-message` cho phiên được gắn; store `sessions` xếp vào hàng đợi và
// hiện chip để NGƯỜI DÙNG bấm giao — không lượt LLM nào tự chạy (tiền của họ), và
// phiên đích có thể đang bận. Ở đây chỉ còn phần hiển thị + toast.
//
// SoC: không `gh`, không fs — sidecar giữ CLI. Module này lo state + trình bày.
import { computed, ref } from 'vue'
import { pushActionToast } from '~/composables/useActionToasts'
import { useSidecar } from '~/composables/useSidecar'

export type PrCiState = 'pass' | 'fail' | 'pending' | 'none'

// Lý do biến động — khớp `PrChangeReason` của sidecar (github/pr-watch-block.ts).
export const PR_CHANGE_REASONS = [
  'ci-failed',
  'ci-passed',
  'review-changes-requested',
  'review-approved',
  'review-new',
  'merged',
  'closed',
] as const
export type PrChangeReason = (typeof PR_CHANGE_REASONS)[number]

export interface PrWatchItem {
  // "owner/repo#12" (repo lowercase) — khoá ổn định do sidecar cấp.
  id: string
  repo: string
  number: number
  title: string
  url: string
  ci: PrCiState
  // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | ''
  reviewDecision: string
  failingCheck: string | null
  // OPEN | MERGED | CLOSED | '' (chưa poll lần nào)
  state: string
  // Phiên (engine id) sẽ nhận tin, hoặc null = chỉ hiện ở đây.
  sessionId: string | null
  projectId: string | null
  account: string
  updatedAt: string
  checkedAt: string | null
}

export interface PrWatchChange {
  id: string
  repo: string
  number: number
  title: string
  reasons: PrChangeReason[]
  deliveredTo: string | null
}

interface ListResult {
  items: PrWatchItem[]
}
interface PollResult {
  items: PrWatchItem[]
  changed: PrWatchChange[]
  throttled: boolean
}

const items = ref<PrWatchItem[]>([])
const loading = ref(false)
const lastError = ref<string | null>(null)

// Đã toast cho biến động nào rồi: id → khoá lý do. Sidecar đã chặn báo lại (nó giữ
// mốc so sánh trên đĩa), đây là lớp thứ hai cho trường hợp hai cửa sổ cùng gọi
// poll trong một khoảnh khắc — cùng cặp (id, lý do) thì chỉ nói một lần.
const toasted = new Map<string, string>()

const prWatchKey = (repo: string, number: number): string => `${repo.toLowerCase()}#${number}`

export function isPrWatched(repo: string, number: number): boolean {
  const key = prWatchKey(repo, number)
  return items.value.some((i) => i.id === key)
}

export function watchedPrFor(repo: string, number: number): PrWatchItem | null {
  const key = prWatchKey(repo, number)
  return items.value.find((i) => i.id === key) ?? null
}

function fail(err: unknown, fallback: string): void {
  lastError.value = err instanceof Error ? err.message : fallback
}

export async function refreshPrWatch(): Promise<void> {
  const sc = useSidecar()
  if (!sc.available) return
  loading.value = true
  try {
    const res = await sc.request<ListResult>('gh.prWatchList', {})
    items.value = res.items
    lastError.value = null
  } catch (err) {
    fail(err, 'gh.prWatchList failed')
  } finally {
    loading.value = false
  }
}

export interface TogglePrWatchInput {
  repo: string
  number: number
  watch: boolean
  title?: string
  url?: string
  account?: string
  projectId?: string | null
  // Phiên nhận tin. Truyền engineId của phiên đang mở để biến động rơi thẳng vào
  // hàng đợi của nó; null = chỉ theo dõi trên UI.
  sessionId?: string | null
}

// Bật/tắt theo dõi. Ném lỗi ra ngoài để UI nói được vì sao (vượt trần chẳng hạn) —
// khác với poll vốn im lặng.
export async function togglePrWatch(input: TogglePrWatchInput): Promise<void> {
  const sc = useSidecar()
  if (!sc.available) return
  loading.value = true
  try {
    const res = await sc.request<ListResult>('gh.prWatchSet', input)
    items.value = res.items
    lastError.value = null
  } finally {
    loading.value = false
  }
}

// Lý do biến động → tiếng người. Dùng chung cho toast và cho hàng trong bell, để
// hai chỗ không bao giờ gọi cùng một sự kiện bằng hai cái tên khác nhau.
export function prReasonLabel(reason: PrChangeReason): string {
  const { t } = useI18n()
  return t(`ghWatch.reason.${reason}`)
}

// Nhãn toast: "acme/app #12 · CI đang hỏng".
function changeText(change: PrWatchChange): string {
  const what = change.reasons.map(prReasonLabel).join(' · ')
  return `${change.repo} #${change.number} · ${what}`.replace(/\s+/g, ' ').trim()
}

// Một vòng poll. Im lặng khi hỏng (gh chưa cài / chưa đăng nhập / mất mạng): một
// toast lỗi mỗi phút còn tệ hơn tính năng bị thiếu — bell surface `lastError`.
export async function pollPrWatch(): Promise<void> {
  const sc = useSidecar()
  if (!sc.available) return
  try {
    const res = await sc.request<PollResult>('gh.prWatchPoll', {})
    items.value = res.items
    lastError.value = null
    for (const change of res.changed) {
      const key = change.reasons.join(',')
      if (toasted.get(change.id) === key) continue
      toasted.set(change.id, key)
      const bad =
        change.reasons.includes('ci-failed') || change.reasons.includes('review-changes-requested')
      pushActionToast(changeText(change), bad ? 'error' : 'info', {
        icon: 'fork',
        action: () => {
          const item = items.value.find((i) => i.id === change.id)
          if (item?.url) void sc.openExternal(item.url)
        },
      })
    }
  } catch (err) {
    fail(err, 'gh.prWatchPoll failed')
  }
}

// Read-only view cho bell.
export function useWatchedPrs() {
  return {
    items: computed(() => items.value),
    loading: computed(() => loading.value),
    lastError: computed(() => lastError.value),
    // PR đã gắn phiên: con số này là câu trả lời cho "có ai đang nghe không?".
    boundCount: computed(() => items.value.filter((i) => i.sessionId !== null).length),
  }
}
