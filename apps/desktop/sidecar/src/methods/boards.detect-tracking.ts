// boards.detectTracking — nút "Tự nhận diện" ở sidebar issue
// (docs/features/session-issue-tracking.md §3.6): tìm link GitHub issue/PR trong các
// phiên đã làm issue (+ link/mô tả sẵn có của item), rồi đọc sprint / milestone /
// ngày của issue GitHub đó. KHÔNG ghi gì — trả gợi ý cho form, người dùng bấm Lưu.
//
// Nguồn link được chấm điểm: link đã gắn trên item và phiên mở từ GitHub
// (`aboutGhUrl`) mạnh nhất, rồi title phiên, mô tả, tin của người dùng, cuối cùng
// là tin của agent — để issue "chính" là cái người dùng đang làm, không phải một link
// agent tình cờ nhắc tới.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { getBoardItem } from '../boards/store.js'
import { issueExecutorSessions } from '../boards/session-issue.js'
import { MESSAGE_ID_RE } from '../sessions/ids.js'
import { isValidGhLogin } from '../github/runner.js'
import { fetchGhTracking, GH_REF_RE, refUrl, type GhRef, type GhTracking } from '../github/issue-tracking.js'

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/
const MAX_REFS = 8
const MAX_SESSIONS = 5

const Params = z.object({
  projectId: z.string().min(3).max(64).regex(PROJECT_ID_RE),
  itemId: z.string().min(1).max(64).regex(MESSAGE_ID_RE),
  // Account gh hiệu dụng của project (UI tính: project → mặc định app). '' / vắng =
  // account đang active của gh.
  account: z
    .string()
    .max(39)
    .refine((v) => v === '' || isValidGhLogin(v), 'Invalid GitHub login')
    .optional(),
})

export type DetectTrackingResult = {
  issueLinks: string[]
  prLinks: string[]
  sprint?: string
  milestone?: string
  startDate?: string
  dueDate?: string
  // URL issue/PR mà sprint/milestone được đọc từ đó.
  source?: string
  // Token gh thiếu scope read:project ⇒ không đọc được sprint (field Projects).
  missingProjectScope: boolean
}

type Scored = { ref: GhRef; score: number; order: number }

function collect(text: string | undefined, weight: number, into: Map<string, Scored>): void {
  if (!text) return
  for (const m of text.matchAll(GH_REF_RE)) {
    const ref: GhRef = { owner: m[1]!, name: m[2]!, kind: m[3] as GhRef['kind'], number: Number(m[4]) }
    const key = refUrl(ref)
    const cur = into.get(key)
    if (cur) cur.score += weight
    else into.set(key, { ref, score: weight, order: into.size })
  }
}

const isoDay = (s: string): string => s.slice(0, 10)

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Iteration "sprint": ưu tiên field tên Sprint/Iteration; nhiều giá trị ⇒ cái đang
// chứa hôm nay, không có thì cái bắt đầu muộn nhất.
function pickIteration(t: GhTracking): GhTracking['iterations'][number] | undefined {
  const named = t.iterations.filter((i) => /sprint|iteration/i.test(i.field))
  const pool = named.length ? named : t.iterations
  const today = new Date().toISOString().slice(0, 10)
  const current = pool.find((i) => i.startDate <= today && today <= addDays(i.startDate, Math.max(0, i.duration - 1)))
  return current ?? [...pool].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0]
}

register('boards.detectTracking', async (raw): Promise<DetectTrackingResult> => {
  const params = Params.parse(raw)
  const item = await getBoardItem(params.projectId, params.itemId)
  if (!item) throw new RpcError(-32004, 'Board item not found')

  const found = new Map<string, Scored>()
  for (const url of [...(item.issueLinks ?? []), ...(item.prLinks ?? [])]) collect(url, 10, found)
  const sessions = await issueExecutorSessions(item, MAX_SESSIONS)
  for (const s of sessions) {
    collect(s.aboutGhUrl, 10, found)
    collect(s.title, 4, found)
  }
  collect(item.desc, 3, found)
  for (const s of sessions) {
    for (const m of s.messages) collect(m.text, m.role === 'user' ? 2 : 1, found)
  }

  const ranked = [...found.values()].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, MAX_REFS)
  const result: DetectTrackingResult = {
    issueLinks: ranked.filter((r) => r.ref.kind === 'issues').map((r) => refUrl(r.ref)),
    prLinks: ranked.filter((r) => r.ref.kind === 'pull').map((r) => refUrl(r.ref)),
    missingProjectScope: false,
  }
  if (!ranked.length) return result

  const first = await fetchGhTracking(
    ranked.map((r) => r.ref),
    params.account || undefined,
  )
  let tracked = first.items
  let missingProjectScope = first.missingProjectScope
  // PR không mang sprint/milestone thì issue nó đóng thường mang — đọc thêm MỘT lượt.
  const known = new Set(tracked.map((t) => refUrl(t.ref)))
  const closing: GhRef[] = []
  for (const t of tracked) {
    for (const m of t.closingIssues.join(' ').matchAll(GH_REF_RE)) {
      const ref: GhRef = { owner: m[1]!, name: m[2]!, kind: 'issues', number: Number(m[4]) }
      if (!known.has(refUrl(ref))) {
        known.add(refUrl(ref))
        closing.push(ref)
      }
    }
  }
  if (closing.length) {
    const more = await fetchGhTracking(closing.slice(0, 5), params.account || undefined)
    tracked = [...tracked, ...more.items]
    missingProjectScope ||= more.missingProjectScope
    for (const t of more.items) result.issueLinks.push(refUrl(t.ref))
  }
  result.missingProjectScope = missingProjectScope

  // Nguồn chính: theo thứ hạng, ISSUE trước PR, và phải mang được thông tin kế hoạch.
  const hasPlan = (t: GhTracking): boolean => !!t.milestone || t.iterations.length > 0 || t.dates.length > 0
  const primary =
    tracked.find((t) => t.ref.kind === 'issues' && hasPlan(t)) ?? tracked.find((t) => hasPlan(t))
  if (!primary) return result
  result.source = primary.url

  const it = pickIteration(primary)
  if (it) result.sprint = it.title
  if (primary.milestone) result.milestone = primary.milestone.title

  const startField = primary.dates.find((d) => /start|begin|bắt đầu/i.test(d.field))
  const dueField = primary.dates.find((d) => /target|due|deadline|end|hạn/i.test(d.field))
  const start = startField?.date ?? it?.startDate
  const due =
    dueField?.date ??
    (it && it.duration > 0 ? addDays(it.startDate, it.duration - 1) : undefined) ??
    (primary.milestone?.dueOn ? isoDay(primary.milestone.dueOn) : undefined)
  if (start) result.startDate = isoDay(start)
  if (due && (!result.startDate || isoDay(due) >= result.startDate)) result.dueDate = isoDay(due)
  return result
})
