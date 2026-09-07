// Theo dõi một PR cụ thể: mỗi nhịp hỏi GitHub trạng thái CI + review, so với thứ
// đã báo lần trước, và khi có biến động ĐÁNG KỂ thì đặt một tin vào hộp thư của
// phiên được gắn (docs/features/github-notifications.md).
//
// KHÔNG TỰ KHỞI ĐỘNG MỘT LƯỢT. Đây là ràng buộc cứng của repo (tiền của người
// dùng) và là cùng mô hình với `pendingWakes` (ADR 0066 P2) lẫn hộp thư giữa các
// phiên: sidecar chỉ phát `session.inbox-message`, renderer xếp vào hàng đợi và
// hiện chip; NGƯỜI DÙNG bấm thì lượt mới chạy. Thêm nữa, phiên đích có thể đang
// chạy dở một lượt và repo giữ bất biến "một phiên chỉ chạy 1 lượt tại một thời
// điểm" — chen ngang chính là đường tới lỗi dual-finalize.
//
// NHỊP. Không có vòng lặp nào ở đây. Renderer gọi `gh.prWatchPoll` ngay trong nhịp
// vốn có của hộp thư thông báo (useGhNotifications, sàn 60s) — dựng thêm một
// timer thứ hai chỉ để nhân đôi lưu lượng tới cùng một API. Sàn 60s vẫn được áp
// LẠI ở đây (MIN_ROUND_MS) vì RPC là bề mặt công khai: một cửa sổ popout hay một
// cú bấm "làm mới" liên tục không được biến thành bão request.
//
// GIÁ MỖI NHỊP. Một `gh api graphql` cho TOÀN BỘ danh sách của một tài khoản
// (pr-status.ts), cộng tối đa MAX_LOG_FETCH lần lấy log khi có job CI vừa hỏng.
// Danh sách bị chặn ở MAX_WATCHED entry.
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { listSessionSummaries } from '../sessions/store.js'
import {
  buildPrUpdateBlock,
  type PrChangeReason,
} from './pr-watch-block.js'
import { fetchFailedJobLogTail, fetchPrStatuses, prKey, type CiState, type PrStatus } from './pr-status.js'
import {
  entryKey,
  loadWatchList,
  saveWatchList,
  unbindSessions,
  type PrWatchEntry,
} from './pr-watch-store.js'

// Sàn giữa hai vòng poll THẬT. Bằng đúng sàn của hộp thư thông báo (tài liệu của
// GitHub khuyến nghị tối thiểu 60s cho polling).
const MIN_ROUND_MS = 60_000
// Số lần lấy log CI tối đa trong một vòng. Log là thứ đắt nhất ở đây (một request
// + vài trăm KB), và khi 5 PR cùng hỏng một lúc thì 5 cái log không giúp gì hơn 2.
const MAX_LOG_FETCH = 2

// Hàng hiển thị cho UI. Không có `checks[]`/`reviews[]`: danh sách trong bell chỉ
// cần biết đỏ hay xanh và ai đang chờ gì — chi tiết thì mở PR ra xem.
export interface PrWatchView {
  id: string
  repo: string
  number: number
  title: string
  url: string
  ci: CiState
  reviewDecision: string
  failingCheck: string | null
  state: string
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
  // Phiên đã nhận tin, hoặc null (không gắn phiên nào / phiên đã biến mất).
  deliveredTo: string | null
}

export interface PrWatchPollResult {
  items: PrWatchView[]
  changed: PrWatchChange[]
  // true = vòng này bị sàn 60s chặn, `items` là ảnh chụp lần trước.
  throttled: boolean
}

function toView(entry: PrWatchEntry): PrWatchView {
  return {
    id: entryKey(entry),
    repo: entry.repo,
    number: entry.number,
    title: entry.title,
    url: entry.url,
    ci: entry.lastCi,
    reviewDecision: entry.lastReviewDecision,
    failingCheck: entry.lastFailingCheck,
    state: entry.lastState,
    sessionId: entry.sessionId,
    projectId: entry.projectId,
    account: entry.account,
    updatedAt: entry.lastUpdatedAt ?? '',
    checkedAt: entry.lastCheckedAt,
  }
}

export async function listWatchViews(): Promise<PrWatchView[]> {
  return (await loadWatchList()).map(toView)
}

// ─── So sánh trạng thái ──────────────────────────────────────────────────────

// Khoá của review mới nhất. Một review mới luôn có submittedAt mới, nên bộ ba này
// đủ để phân biệt "vẫn review cũ" với "vừa có người review".
function reviewKey(status: PrStatus): string {
  const last = status.reviews[status.reviews.length - 1]
  return last ? `${last.author}|${last.state}|${last.submittedAt}` : ''
}

function failingCheckName(status: PrStatus): string | null {
  return status.checks.find((c) => c.state === 'fail')?.name ?? null
}

// Dấu vân tay của TOÀN BỘ trạng thái đáng quan tâm. Dùng để chốt "đã báo rồi" —
// kể cả với biến động không đáng báo (CI quay lại pending sau một cú push), nhờ
// vậy khi nó đổi tiếp thì so sánh vẫn đúng.
function fingerprint(status: PrStatus): string {
  const failing = status.checks
    .filter((c) => c.state === 'fail')
    .map((c) => c.name)
    .sort()
    .join(',')
  return [status.state, status.ci, failing, status.reviewDecision, reviewKey(status)].join('|')
}

// Cái gì đã đổi, và có đáng làm phiền không.
//
// CỐ Ý BỎ QUA: mọi lần CI chuyển sang `pending`. Mỗi lần push là một lần như thế,
// nên báo nó đồng nghĩa với việc biến tính năng này thành nguồn ồn. Chỉ kết quả
// (pass/fail) và review mới là thứ người ta chờ.
export function diffStatus(entry: PrWatchEntry, status: PrStatus): PrChangeReason[] {
  // Lần quan sát đầu tiên là NỀN, im lặng — giống hệt lần seed của hộp thư thông
  // báo: không ai muốn mở app lên và nhận báo cáo về CI đã chạy xong từ hôm qua.
  if (entry.lastFingerprint === null) return []
  const reasons: PrChangeReason[] = []
  if (status.state !== entry.lastState) {
    if (status.state === 'MERGED') reasons.push('merged')
    else if (status.state === 'CLOSED') reasons.push('closed')
  }
  if (status.ci !== entry.lastCi) {
    if (status.ci === 'fail') reasons.push('ci-failed')
    else if (status.ci === 'pass') reasons.push('ci-passed')
  }
  if (status.reviewDecision !== entry.lastReviewDecision) {
    if (status.reviewDecision === 'CHANGES_REQUESTED') reasons.push('review-changes-requested')
    else if (status.reviewDecision === 'APPROVED') reasons.push('review-approved')
  }
  const key = reviewKey(status)
  // Review mới mà không đổi kết luận (một COMMENTED review chẳng hạn) vẫn là thứ
  // đáng biết — nhưng đừng nói hai lần khi kết luận cũng vừa đổi.
  if (key !== entry.lastReviewKey && key !== '' && reasons.length === 0) {
    reasons.push('review-new')
  }
  return reasons
}

// ─── Một vòng poll ───────────────────────────────────────────────────────────

let lastRoundAt = 0
let inFlight: Promise<PrWatchPollResult> | null = null

// Gom theo tài khoản gh: mỗi tài khoản một request GraphQL. Gần như luôn là 1.
function groupByAccount(entries: readonly PrWatchEntry[]): Map<string, PrWatchEntry[]> {
  const out = new Map<string, PrWatchEntry[]>()
  for (const e of entries) {
    const list = out.get(e.account)
    if (list) list.push(e)
    else out.set(e.account, [e])
  }
  return out
}

// Phát tin vào hộp thư của phiên đích. Payload trùng khuôn với sessions/inbox.ts
// để renderer không phải học thêm một hình dạng sự kiện thứ hai; `fromSessionId`
// là null vì tin KHÔNG đến từ phiên nào — nguồn nằm ngay trong preview và trong
// lời dẫn của khối.
function deliver(entry: PrWatchEntry, status: PrStatus, reasons: PrChangeReason[], logTail: string): void {
  if (!entry.sessionId) return
  const at = new Date().toISOString()
  const { block, preview } = buildPrUpdateBlock({ status, reasons, logTail, at })
  emit('session.inbox-message', {
    sessionId: entry.sessionId,
    messageId: `prw-${entryKey(entry)}-${Date.now()}`,
    // `external`: nội dung do người ngoài viết (tiêu đề PR, review, log CI). KHÔNG
    // phải 'user' — `fromSessionId: null` một mình sẽ bị đọc thành "bạn chuyển tiếp".
    origin: 'external',
    fromSessionId: null,
    fromTitle: `GitHub · ${entry.repo}#${entry.number}`,
    at,
    preview,
    block,
  })
  log.info('pr-watch: update queued for session', {
    pr: entryKey(entry),
    reasons: reasons.join(','),
  })
}

// Một vòng: hỏi trạng thái, so, báo, ghi lại mốc.
async function runRound(): Promise<PrWatchPollResult> {
  const entries = await loadWatchList()
  if (entries.length === 0) return { items: [], changed: [], throttled: false }

  // Phiên đã bị xoá/lưu trữ thì gỡ liên kết: giữ một sessionId chết chỉ để phát
  // sự kiện vào hư không.
  const alive = new Set(
    (await listSessionSummaries()).filter((s) => !s.archived).map((s) => s.id),
  )
  const dead = new Set(
    entries.map((e) => e.sessionId).filter((id): id is string => id !== null && !alive.has(id)),
  )
  if (dead.size > 0) await unbindSessions(dead)

  const current = await loadWatchList()
  // PR đã merge/đóng thì không hỏi nữa: câu trả lời không bao giờ đổi, mà mỗi lần
  // hỏi vẫn tốn một alias trong query. Entry KHÔNG bị tự xoá — nó ở lại danh sách
  // với trạng thái cuối để người dùng tự bỏ theo dõi; một dòng tự biến mất là
  // kiểu "app tự dọn đồ của tôi" mà không ai yêu cầu.
  const pollable = current.filter((e) => e.lastState !== 'MERGED' && e.lastState !== 'CLOSED')
  const statuses = new Map<string, PrStatus>()
  for (const [account, group] of groupByAccount(pollable)) {
    try {
      const got = await fetchPrStatuses(
        group.map((e) => ({ repo: e.repo, number: e.number })),
        account || undefined,
      )
      for (const [key, status] of got) statuses.set(key, status)
    } catch (err) {
      // gh không có / chưa đăng nhập / mất mạng: giữ nguyên trạng thái cũ và để
      // caller thấy lỗi qua RPC. Một tài khoản hỏng không được kéo theo các tài
      // khoản còn lại.
      log.warn('pr-watch: status fetch failed', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const now = new Date().toISOString()
  const changed: PrWatchChange[] = []
  const next: PrWatchEntry[] = []
  let logBudget = MAX_LOG_FETCH

  for (const entry of current) {
    const status = statuses.get(prKey(entry.repo, entry.number))
    if (!status) {
      next.push(entry)
      continue
    }
    const reasons = diffStatus(entry, status)
    if (reasons.length > 0 && entry.sessionId) {
      // Log chỉ lấy khi CI VỪA hỏng và còn ngân sách — và chỉ khi có phiên để
      // đọc nó (log không phải thứ hiển thị trên chip).
      let logTail = ''
      if (reasons.includes('ci-failed') && logBudget > 0) {
        const job = status.checks.find((c) => c.state === 'fail' && c.jobId !== null)
        if (job?.jobId) {
          logBudget -= 1
          logTail = await fetchFailedJobLogTail(entry.repo, job.jobId, entry.account || undefined)
        }
      }
      deliver(entry, status, reasons, logTail)
    }
    if (reasons.length > 0) {
      changed.push({
        id: entryKey(entry),
        repo: entry.repo,
        number: entry.number,
        title: status.title,
        reasons,
        deliveredTo: entry.sessionId,
      })
    }
    next.push({
      ...entry,
      title: status.title || entry.title,
      url: status.url || entry.url,
      lastFingerprint: fingerprint(status),
      lastUpdatedAt: status.updatedAt,
      lastCheckedAt: now,
      lastCi: status.ci,
      lastReviewDecision: status.reviewDecision,
      lastFailingCheck: failingCheckName(status),
      lastReviewKey: reviewKey(status),
      lastState: status.state,
    })
  }

  await saveWatchList(next)
  return { items: next.map(toView), changed, throttled: false }
}

// Poll một vòng, tôn trọng sàn 60s và gộp các lời gọi chồng nhau. `force` bỏ qua
// sàn — dành cho hành động rõ ràng của người dùng (vừa bấm theo dõi một PR mới).
export async function pollPrWatch(force = false): Promise<PrWatchPollResult> {
  if (inFlight) return inFlight
  const since = Date.now() - lastRoundAt
  if (!force && since < MIN_ROUND_MS) {
    return { items: await listWatchViews(), changed: [], throttled: true }
  }
  lastRoundAt = Date.now()
  inFlight = runRound().finally(() => {
    inFlight = null
  })
  return inFlight
}
