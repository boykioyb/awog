// Trạng thái "sống" của một Pull Request: CI (check run + status context) và
// review. Đây là phần ĐỌC của tính năng theo dõi PR (docs/features/github-notifications.md).
//
// MỘT REQUEST CHO TẤT CẢ. Mỗi PR theo dõi mà gọi `gh pr view` riêng thì N PR = N
// lần spawn + N request mỗi nhịp poll, và nhịp poll thì lặp mãi mãi ⇒ đó là cách
// nhanh nhất để ăn rate limit của GitHub. Nên ở đây dùng đúng khuôn của
// gh.subject-authors.ts: MỘT `gh api graphql` với một alias cho mỗi PR.
//
// BẢO MẬT:
//   • Mọi giá trị do người dùng cung cấp (owner, name, number) đi bằng BIẾN
//     GraphQL, không bao giờ nối vào thân query. Phần duy nhất được sinh ra trong
//     query là chỉ số alias (`a0`, `a1`, …) — caller không chi phối được.
//   • `repo` vẫn được kiểm hình dạng (REPO_RE) để một entry hỏng fail ngay tại
//     biên thay vì tốn một request.
//   • Không có cwd, không có gì giống đường dẫn: đây là bề mặt account-scoped
//     giống gh.notifications, token do runner tiêm vào env và không rời sidecar.
import { z } from 'zod'
import { runGhAccount, runGhAccountAllowPartial } from './runner.js'

// Charset owner/repo của GitHub. Kiểm biên, không phải cuộc thi hình thức.
export const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

// Trần số PR một lần gọi gom lại. Cũng là trần của danh sách theo dõi (store) —
// một người không "theo dõi sát" nổi 20 PR, và mỗi entry là một alias trong query.
export const MAX_WATCHED = 20
// Số context CI lấy về cho mỗi PR. Repo lớn có vài chục job; quá số này thì phần
// đuôi chỉ ảnh hưởng danh sách hiển thị, không ảnh hưởng kết luận pass/fail (kết
// luận lấy từ rollup.state của GitHub).
const MAX_CONTEXTS = 60
// Số review gần nhất đủ để biết "có review mới chưa".
const MAX_REVIEWS = 5
// Số dòng đuôi log lấy về khi một job CI hỏng.
const LOG_TAIL_LINES = 40
// Trần độ dài mỗi dòng log (dòng log CI có thể dài vài nghìn ký tự).
const LOG_LINE_MAX = 400

export type CheckState = 'pass' | 'fail' | 'pending' | 'skipped'
export type CiState = 'pass' | 'fail' | 'pending' | 'none'

export interface PrCheck {
  name: string
  state: CheckState
  url: string
  // Job id của GitHub Actions, bóc từ detailsUrl. null với status context ngoài
  // (Vercel, CircleCI…) — chúng không có log đọc được qua API này.
  jobId: number | null
}

export interface PrReview {
  author: string
  // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED
  state: string
  submittedAt: string
}

export interface PrStatus {
  repo: string
  number: number
  title: string
  url: string
  // OPEN | CLOSED | MERGED
  state: string
  isDraft: boolean
  updatedAt: string
  headRefName: string
  ci: CiState
  checks: PrCheck[]
  // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | '' (chưa yêu cầu review)
  reviewDecision: string
  reviews: PrReview[]
}

export interface PrRef {
  repo: string
  number: number
}

// ─── Schema trả về (khoan dung: thiếu field ⇒ bỏ qua, không ném) ──────────────

const CheckContext = z
  .object({
    __typename: z.string().optional(),
    // CheckRun
    name: z.string().optional(),
    conclusion: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    detailsUrl: z.string().nullable().optional(),
    // StatusContext
    context: z.string().optional(),
    state: z.string().nullable().optional(),
    targetUrl: z.string().nullable().optional(),
  })
  .passthrough()

const PullRequestJson = z
  .object({
    number: z.number(),
    title: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    isDraft: z.boolean().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    headRefName: z.string().nullable().optional(),
    reviewDecision: z.string().nullable().optional(),
    reviews: z
      .object({
        nodes: z
          .array(
            z
              .object({
                state: z.string().nullable().optional(),
                submittedAt: z.string().nullable().optional(),
                author: z.object({ login: z.string() }).nullable().optional(),
              })
              .nullable(),
          )
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    commits: z
      .object({
        nodes: z
          .array(
            z
              .object({
                commit: z
                  .object({
                    statusCheckRollup: z
                      .object({
                        state: z.string().nullable().optional(),
                        contexts: z
                          .object({ nodes: z.array(CheckContext.nullable()).nullable().optional() })
                          .nullable()
                          .optional(),
                      })
                      .nullable()
                      .optional(),
                  })
                  .nullable()
                  .optional(),
              })
              .nullable(),
          )
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough()

const GraphqlJson = z
  .object({
    data: z
      .record(z.object({ pullRequest: PullRequestJson.nullable().optional() }).nullable())
      .nullable()
      .optional(),
  })
  .passthrough()

const PR_FIELDS =
  'number title url state isDraft updatedAt headRefName reviewDecision ' +
  `reviews(last:${MAX_REVIEWS}){nodes{state submittedAt author{login}}} ` +
  'commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:' +
  `${MAX_CONTEXTS})` +
  '{nodes{__typename ... on CheckRun{name conclusion status detailsUrl} ' +
  '... on StatusContext{context state targetUrl}}}}}}}'

// ─── Chuẩn hoá ───────────────────────────────────────────────────────────────

// Một CheckRun chưa COMPLETED thì kết luận của nó chưa có nghĩa gì — đang chạy.
function checkRunState(status: string | null | undefined, conclusion: string | null | undefined): CheckState {
  if ((status ?? '').toUpperCase() !== 'COMPLETED') return 'pending'
  switch ((conclusion ?? '').toUpperCase()) {
    case 'SUCCESS':
    case 'NEUTRAL':
      return 'pass'
    case 'SKIPPED':
    case 'CANCELLED':
      return 'skipped'
    default:
      return 'fail'
  }
}

function statusContextState(state: string | null | undefined): CheckState {
  switch ((state ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'pass'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'fail'
  }
}

// Kết luận tổng lấy từ rollup của GitHub, KHÔNG tự tổng hợp lại từ danh sách
// context: contexts bị cắt ở MAX_CONTEXTS, còn rollup thì nhìn thấy tất cả.
function rollupState(state: string | null | undefined): CiState {
  switch ((state ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'pass'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    case 'FAILURE':
    case 'ERROR':
      return 'fail'
    default:
      return 'none'
  }
}

// detailsUrl của một check GitHub Actions có dạng
// https://github.com/o/r/actions/runs/<runId>/job/<jobId>. Bóc jobId để lấy được
// log khi job hỏng. Không khớp (Vercel, CircleCI…) ⇒ null, không đoán.
const JOB_URL_RE = /\/actions\/runs\/\d+\/jobs?\/(\d+)(?:[/?#]|$)/

export function jobIdFromDetailsUrl(url: string | null | undefined): number | null {
  const m = JOB_URL_RE.exec(url ?? '')
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function toChecks(pr: z.infer<typeof PullRequestJson>): PrCheck[] {
  const nodes = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []
  const checks: PrCheck[] = []
  for (const node of nodes) {
    if (!node) continue
    if (node.__typename === 'CheckRun') {
      checks.push({
        name: node.name ?? 'check',
        state: checkRunState(node.status, node.conclusion),
        url: node.detailsUrl ?? '',
        jobId: jobIdFromDetailsUrl(node.detailsUrl),
      })
      continue
    }
    checks.push({
      name: node.context ?? 'status',
      state: statusContextState(node.state),
      url: node.targetUrl ?? '',
      jobId: null,
    })
  }
  // Cái hỏng lên trước: đó là thứ người đọc cần thấy đầu tiên, và cũng là thứ
  // được chọn để lấy log.
  return checks.sort((a, b) => Number(b.state === 'fail') - Number(a.state === 'fail'))
}

function toStatus(repo: string, pr: z.infer<typeof PullRequestJson>): PrStatus {
  return {
    repo,
    number: pr.number,
    title: pr.title ?? '',
    url: pr.url ?? '',
    state: (pr.state ?? 'OPEN').toUpperCase(),
    isDraft: pr.isDraft ?? false,
    updatedAt: pr.updatedAt ?? '',
    headRefName: pr.headRefName ?? '',
    ci: rollupState(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
    checks: toChecks(pr),
    reviewDecision: (pr.reviewDecision ?? '').toUpperCase(),
    reviews: (pr.reviews?.nodes ?? [])
      .filter((r): r is NonNullable<typeof r> => r !== null && r !== undefined)
      .map((r) => ({
        author: r.author?.login ?? '',
        state: (r.state ?? '').toUpperCase(),
        submittedAt: r.submittedAt ?? '',
      })),
  }
}

// Khoá tra cứu ổn định cho một PR ("owner/repo#12", repo lowercase).
export function prKey(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`
}

// Lấy trạng thái của nhiều PR trong MỘT request. PR không đọc được (mất quyền,
// repo đã xoá) đơn giản là vắng mặt trong Map — caller giữ nguyên trạng thái cũ
// thay vì báo động giả.
export async function fetchPrStatuses(
  items: readonly PrRef[],
  account?: string,
): Promise<Map<string, PrStatus>> {
  const out = new Map<string, PrStatus>()
  const valid = items.filter((i) => REPO_RE.test(i.repo) && Number.isSafeInteger(i.number))
  if (valid.length === 0) return out

  const fields: string[] = []
  const selections = valid.map((item, i) => {
    const [owner, name] = item.repo.split('/')
    fields.push('-f', `o${i}=${owner}`, '-f', `n${i}=${name}`, '-F', `num${i}=${item.number}`)
    return `a${i}: repository(owner:$o${i},name:$n${i}){pullRequest(number:$num${i}){${PR_FIELDS}}}`
  })
  const varDefs = valid.map((_, i) => `$o${i}:String!,$n${i}:String!,$num${i}:Int!`).join(',')
  const query = `query(${varDefs}){${selections.join(' ')}}`

  // Khoan dung với thành công MỘT PHẦN: GraphQL trả "19 PR này, kèm lỗi cho cái
  // repo bạn vừa mất quyền" và gh thoát 1 vì thế. Mất cả 19 vì 1 là đánh đổi sai.
  const stdout = await runGhAccountAllowPartial(
    ['api', 'graphql', '-f', `query=${query}`, ...fields],
    account,
  )
  const parsed = GraphqlJson.parse(JSON.parse(stdout))
  valid.forEach((item, i) => {
    const pr = parsed.data?.[`a${i}`]?.pullRequest
    if (!pr) return
    out.set(prKey(item.repo, item.number), toStatus(item.repo, pr))
  })
  return out
}

// Đuôi log của MỘT job CI hỏng. Gọi rất tiết kiệm (xem pr-watch.ts): chỉ khi một
// PR vừa CHUYỂN sang fail, và tối đa vài lần mỗi nhịp.
//
// BẢO MẬT: `repo` đã qua REPO_RE và `jobId` là số nguyên, nên đường dẫn REST được
// dựng từ giá trị đã kiểm — không có gì tự do đi vào tham số. Nội dung trả về là
// L1 (log của người khác viết) và có thể chứa bí mật ⇒ caller BẮT BUỘC cho nó qua
// redactString trước khi đưa vào prompt.
export async function fetchFailedJobLogTail(
  repo: string,
  jobId: number,
  account?: string,
): Promise<string> {
  if (!REPO_RE.test(repo) || !Number.isSafeInteger(jobId) || jobId <= 0) return ''
  try {
    const raw = await runGhAccount(['api', `repos/${repo}/actions/jobs/${jobId}/logs`], account)
    return raw
      .split('\n')
      .slice(-LOG_TAIL_LINES)
      .map((line) => {
        const flat = line.replace(/\r/g, '').trimEnd()
        return flat.length > LOG_LINE_MAX ? `${flat.slice(0, LOG_LINE_MAX)}…` : flat
      })
      .join('\n')
      .trim()
  } catch {
    // Log hết hạn / không có quyền / job không phải Actions — thiếu log không phải
    // lý do để bỏ luôn cái tin báo CI hỏng.
    return ''
  }
}
