// Nguồn GitHub Actions của màn Triển khai (Mốc 4, task 4.2–4.5).
//
// TẤT CẢ đi qua `github/runner.ts` (ADR 0049): `execFile`, mảng argv, KHÔNG shell,
// token chỉ nằm trong ENV của tiến trình con. Ở đây không có `spawn`, không có
// chuỗi lệnh, không có token trong argv.
//
// ĐỌC THÌ RẺ, GHI THÌ QUA CỔNG. Bảng chỉ tốn MỘT lời gọi (`gh run list`). Chi tiết
// tốn 3–5 lời gọi và chỉ chạy khi người dùng bấm một dòng. LOG là thứ đắt nhất
// (tải cả gói log của job) nên nó là RPC riêng, chỉ chạy khi bấm đúng bước — cùng
// luật "không auto-refresh" của màn Logs.
//
// Hành động (chạy lại · huỷ · kích hoạt · duyệt) đều là GHI: chúng đổi trạng thái
// trên GitHub, nên chúng đi qua cổng quyền ở RPC (`infra.cicd-action`), không phải
// ở file này. File này chỉ biết cách gọi đúng lệnh.
import { z } from 'zod'
import { runGh } from '../../github/runner.js'
import { redactString } from '../../sessions/redact.js'
import { clampForLlm } from '../../runtime/tools/output-budget.js'
import {
  githubStatus,
  spanMs,
  type CicdArtifact,
  type CicdApproval,
  type CicdRun,
  type CicdRunDetail,
  type CicdStep,
} from './types.js'

/**
 * Trường JSON của `gh run list`/`gh run view`. Cố ý KHÔNG có `actor`: `gh` không
 * phơi trường đó ở hai lệnh này (đã kiểm bằng `gh run list --json actor` →
 * `Unknown JSON field`), nên "ai kích hoạt" phải lấy từ REST khi mở chi tiết —
 * xem `githubRunDetail`.
 */
const RUN_FIELDS =
  'databaseId,displayTitle,event,headBranch,headSha,name,number,status,conclusion,createdAt,startedAt,updatedAt,url,workflowName'
const DETAIL_FIELDS = `jobs,${RUN_FIELDS}`

const JsonRun = z
  .object({
    databaseId: z.number(),
    displayTitle: z.string().nullable().optional(),
    event: z.string().nullable().optional(),
    headBranch: z.string().nullable().optional(),
    headSha: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    number: z.number().nullable().optional(),
    status: z.string().nullable().optional(),
    conclusion: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    workflowName: z.string().nullable().optional(),
  })
  .passthrough()

const JsonStep = z
  .object({
    name: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    conclusion: z.string().nullable().optional(),
    number: z.number().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
  })
  .passthrough()

const JsonJob = z
  .object({
    databaseId: z.number().nullable().optional(),
    name: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    conclusion: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    steps: z.array(JsonStep).nullable().optional(),
  })
  .passthrough()

/** `JSON.parse` → lỗi CÓ MÃ (`cicd.badJson`) để UI dịch được, không phải câu của V8. */
function parseJson(out: string): unknown {
  try {
    return JSON.parse(out) as unknown
  } catch {
    throw new Error('cicd.badJson')
  }
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha
}

/**
 * Một lần chạy GitHub → `CicdRun`.
 *
 * `key` là NHÃN dự án hiện trên bảng; `where` là con trỏ để mở lại repo khi người
 * dùng bấm vào dòng (`gh run view` cần cwd). Cả hai đi vào `ref` và quay lại
 * sidecar ở RPC chi tiết — ở đó chúng chỉ được dùng để TRA project id, không bao
 * giờ thành đường dẫn: cwd vẫn là `project.path` do sidecar đọc từ đĩa.
 */
function toRun(
  json: z.infer<typeof JsonRun>,
  key: string,
  where: { projectId: string; repoPath?: string | undefined; account?: string | undefined },
): CicdRun {
  const status = json.status ?? ''
  const conclusion = json.conclusion ?? null
  const started = json.startedAt ?? json.createdAt ?? ''
  return {
    id: `github:${key}:${json.databaseId}`,
    source: 'github',
    project: key,
    title: json.workflowName || json.name || json.displayTitle || 'workflow',
    branch: json.headBranch ?? '',
    commit: shortSha(json.headSha ?? ''),
    status: githubStatus(status, conclusion),
    startedAt: started,
    finishedAt: json.status === 'completed' ? (json.updatedAt ?? null) : null,
    durationMs: spanMs(started, json.status === 'completed' ? (json.updatedAt ?? null) : null),
    // `gh` không trả người kích hoạt ở lệnh list (xem RUN_FIELDS); cột này hiện
    // KIỂU kích hoạt (push / thủ công / PR) — thứ `gh` thật sự có — và tên người
    // kích hoạt chỉ hiện khi mở chi tiết (một lời gọi REST).
    actor: json.event ?? '',
    url: json.url ?? null,
    stepName: null,
    needsApproval: false,
    ref: {
      runId: String(json.databaseId),
      key,
      projectId: where.projectId,
      ...(where.repoPath ? { repoPath: where.repoPath } : {}),
      ...(where.account ? { account: where.account } : {}),
      event: json.event ?? '',
      sha: json.headSha ?? '',
    },
  }
}

export type GithubListInput = {
  cwd: string
  account?: string | undefined
  /** Nhãn dự án hiện trên bảng (tên dự án AWOG). */
  key: string
  /** Id dự án — con trỏ để RPC chi tiết mở lại repo (xem `toRun`). */
  projectId: string
  repoPath?: string | undefined
  limit: number
  branch?: string | undefined
}

/** `gh run list` — MỘT lời gọi cho cả bảng của nguồn này. */
export async function listGithubRuns(input: GithubListInput): Promise<CicdRun[]> {
  const args = ['run', 'list', '--limit', String(input.limit), '--json', RUN_FIELDS]
  if (input.branch) args.push('--branch', input.branch)
  const out = await runGh(args, input.cwd, input.account)
  // JSON méo ⇒ NÉM, không trả rỗng. `cicd/index.ts` bắt lỗi này và biến nó thành
  // `error` của nguồn — trả rỗng thì bảng im lặng nói "không có lần chạy nào",
  // tức câu trả lời sai mà người dùng không có cách nào biết.
  const parsed = z.array(JsonRun).safeParse(parseJson(out))
  if (!parsed.success) throw new Error('cicd.badJson')
  return parsed.data.map((r) =>
    toRun(r, input.key, {
      projectId: input.projectId,
      ...(input.repoPath ? { repoPath: input.repoPath } : {}),
      ...(input.account ? { account: input.account } : {}),
    }),
  )
}

/** Chi tiết một lần chạy: bước · artifact · PR · người kích hoạt · tên biến. */
export async function githubRunDetail(input: {
  cwd: string
  account?: string | undefined
  runId: number
  /** Nhãn dự án hiện trên bảng — lấy từ `ref.key` của dòng đã bấm (không đoán). */
  key?: string | undefined
  where?: { projectId: string; repoPath?: string | undefined; account?: string | undefined } | undefined
}): Promise<CicdRunDetail> {
  const view = await runGh(
    ['run', 'view', String(input.runId), '--json', DETAIL_FIELDS],
    input.cwd,
    input.account,
  )
  const parsed = z
    .object({
      jobs: z.array(JsonJob).nullable().optional(),
    })
    .passthrough()
    .safeParse(parseJson(view))
  const runJson = JsonRun.safeParse(parseJson(view))
  if (!runJson.success) throw new Error('cicd.badJson')
  const run = toRun(runJson.data, input.key ?? 'gh', input.where ?? { projectId: '' })

  const steps: CicdStep[] = []
  if (parsed.success) {
    for (const job of parsed.data.jobs ?? []) {
      const group = job.name ?? ''
      for (const step of job.steps ?? []) {
        steps.push({
          id: `${job.databaseId ?? 0}:${step.number ?? steps.length}`,
          name: step.name ?? '',
          status: githubStatus(step.status ?? '', step.conclusion ?? null),
          startedAt: step.startedAt ?? null,
          durationMs: spanMs(step.startedAt ?? '', step.completedAt ?? null),
          group,
          // Log của GitHub đến từ `gh run view --log` (theo yêu cầu), không phải
          // CloudWatch — nên không có `logRef`/`logUrl` để gieo sang tab khác.
          logRef: null,
          logUrl: null,
        })
      }
    }
  }

  // Ba lời gọi REST, mỗi cái trả về một thứ `gh run view` không có. Hỏng một cái
  // KHÔNG làm hỏng chi tiết: bảng bước vẫn là câu trả lời chính.
  const [meta, artifacts, variables, secrets] = await Promise.all([
    ghApiJson(input, `repos/{owner}/{repo}/actions/runs/${input.runId}`),
    ghApiJson(input, `repos/{owner}/{repo}/actions/runs/${input.runId}/artifacts`),
    ghApiJson(input, 'repos/{owner}/{repo}/actions/variables?per_page=50'),
    ghApiJson(input, 'repos/{owner}/{repo}/actions/secrets?per_page=50'),
  ])

  const runRest = z
    .object({
      actor: z.object({ login: z.string() }).nullable().optional(),
      repository: z.object({ full_name: z.string() }).nullable().optional(),
      pull_requests: z
        .array(
          z
            .object({
              number: z.number(),
              url: z.string(),
            })
            .passthrough(),
        )
        .nullable()
        .optional(),
    })
    .passthrough()
    .safeParse((meta ?? {}) as unknown)

  const fullName = runRest.success ? (runRest.data.repository?.full_name ?? '') : ''
  const pull = runRest.success ? (runRest.data.pull_requests ?? [])[0] : undefined
  const login = runRest.success ? (runRest.data.actor?.login ?? '') : ''

  const artList = z
    .object({
      artifacts: z
        .array(
          z
            .object({
              name: z.string(),
              size_in_bytes: z.number().nullable().optional(),
              archive_download_url: z.string().nullable().optional(),
            })
            .passthrough(),
        )
        .nullable()
        .optional(),
    })
    .safeParse((artifacts ?? {}) as unknown)

  const nameList = (v: unknown): string[] => {
    const s = z
      .object({ variables: z.array(z.object({ name: z.string() })).nullable().optional() })
      .safeParse(v)
    const t = z
      .object({ secrets: z.array(z.object({ name: z.string() })).nullable().optional() })
      .safeParse(v)
    const out: string[] = []
    if (s.success) for (const x of s.data.variables ?? []) out.push(x.name)
    if (t.success) for (const x of t.data.secrets ?? []) out.push(`${x.name} (secret)`)
    return out
  }

  const artifactsList: CicdArtifact[] = artList.success
    ? (artList.data.artifacts ?? []).map((a) => ({
        name: a.name,
        // URL tải artifact cần token nên KHÔNG đưa ra UI; mở trên GitHub thì có.
        url: run.url ? `${run.url}#artifacts` : null,
        sizeBytes: a.size_in_bytes ?? null,
      }))
    : []

  const approvals = await pendingApprovals(input)

  return {
    run: {
      ...run,
      actor: login,
      ref: { ...run.ref, repo: fullName },
    },
    steps,
    artifacts: artifactsList,
    pr:
      pull && fullName
        ? { number: pull.number, title: '', url: pull.url, repo: fullName }
        : null,
    // CHỈ TÊN (task 4.4). `gh` không phơi giá trị của variable/secret, và AWOG
    // cũng không đi tìm chúng.
    envNames: [...nameList(variables), ...nameList(secrets)],
    approvals,
  }
}

/** Một lời gọi REST qua `gh api`, trả `null` khi hỏng (không làm hỏng chi tiết). */
async function ghApiJson(
  input: { cwd: string; account?: string | undefined },
  path: string,
): Promise<unknown | null> {
  try {
    const out = await runGh(['api', path], input.cwd, input.account)
    return JSON.parse(out) as unknown
  } catch {
    return null
  }
}

/** Việc đang chờ người duyệt: environment protection rule của GitHub. */
async function pendingApprovals(input: {
  cwd: string
  account?: string | undefined
  runId: number
}): Promise<CicdApproval[]> {
  const raw = await ghApiJson(
    input,
    `repos/{owner}/{repo}/actions/runs/${input.runId}/pending_deployments`,
  )
  const parsed = z
    .array(
      z
        .object({
          environment: z
            .object({ id: z.number(), name: z.string().nullable().optional() })
            .nullable()
            .optional(),
        })
        .passthrough(),
    )
    .safeParse(raw)
  if (!parsed.success) return []
  const out: CicdApproval[] = []
  for (const p of parsed.data) {
    const env = p.environment
    if (!env) continue
    out.push({ id: String(env.id), label: env.name ?? String(env.id) })
  }
  return out
}

// ─── Log của một bước ────────────────────────────────────────────────────────

const LOG_MAX_LINES = 2000

export type GithubLogResult = {
  lines: string[]
  command: string
  totalLines: number
  truncated: boolean
}

/**
 * Log của MỘT job (và lọc tiếp theo tên bước nếu có).
 *
 * ĐỊNH DẠNG: `gh run view --log` in mỗi dòng thành ba cột TAB —
 * `<tên job>\t<tên bước>\t<timestamp> <nội dung>`. Dòng nằm ngoài mọi bước mang
 * nhãn `UNKNOWN STEP`, nên lọc theo tên bước là phép cắt đúng, không phải đoán.
 *
 * LOG BUILD LÀ DỮ LIỆU L1: `redactString` chạy TRƯỚC khi clamp (cắt trước thì một
 * token bị cắt đôi sẽ không còn khớp mẫu nào để mà che).
 */
export async function githubStepLog(input: {
  cwd: string
  account?: string | undefined
  runId: number
  jobId: number
  step?: string | undefined
}): Promise<GithubLogResult> {
  const out = await runGh(
    ['run', 'view', String(input.runId), '--log', '--job', String(input.jobId)],
    input.cwd,
    input.account,
    { timeoutMs: 180_000 },
  )
  const all = out.split('\n')
  const wanted = input.step ?? ''
  const lines: string[] = []
  for (const raw of all) {
    if (raw === '') continue
    const first = raw.indexOf('\t')
    const second = first >= 0 ? raw.indexOf('\t', first + 1) : -1
    const stepName = second >= 0 ? raw.slice(first + 1, second) : ''
    const body = second >= 0 ? raw.slice(second + 1) : raw
    if (wanted !== '' && stepName !== wanted) continue
    // Bỏ BOM + mốc thời gian của runner; giữ nguyên phần còn lại của dòng log.
    const clean = body.replace(/^\uFEFF/, '').replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '')
    lines.push(redactString(clean))
  }
  const clamped = clampForLlm(lines, {
    maxLines: LOG_MAX_LINES,
    maxLineChars: 4000,
    maxTotalChars: 256 * 1024,
  })
  const kept = clamped.text === '' ? [] : clamped.text.split('\n')
  return {
    lines: clamped.truncated
      ? [...kept, `… (${lines.length - clamped.keptLines} dòng nữa)`]
      : kept,
    command: `gh run view ${input.runId} --log --job ${input.jobId}`,
    totalLines: lines.length,
    truncated: clamped.truncated,
  }
}

// ─── Hành động (đều là GHI — cổng quyền nằm ở RPC) ───────────────────────────

export async function githubRerun(input: {
  cwd: string
  account?: string | undefined
  runId: number
  failedOnly: boolean
}): Promise<string> {
  const args = ['run', 'rerun', String(input.runId)]
  if (input.failedOnly) args.push('--failed')
  await runGh(args, input.cwd, input.account)
  return `gh ${args.join(' ')}`
}

export async function githubCancel(input: {
  cwd: string
  account?: string | undefined
  runId: number
}): Promise<string> {
  await runGh(['run', 'cancel', String(input.runId)], input.cwd, input.account)
  return `gh run cancel ${input.runId}`
}

const WORKFLOW_RE = /^[A-Za-z0-9._/-]{1,120}$/
const REF_RE = /^[^\s-][^\s]{0,199}$/
const INPUT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const INPUT_VALUE_MAX = 1000

export function workflowRefOk(workflow: string, ref: string): boolean {
  return WORKFLOW_RE.test(workflow) && REF_RE.test(ref)
}

export function inputKeyOk(key: string): boolean {
  return INPUT_KEY_RE.test(key)
}

export async function githubDispatch(input: {
  cwd: string
  account?: string | undefined
  workflow: string
  ref: string
  inputs?: readonly { key: string; value: string }[]
}): Promise<string> {
  const args = ['workflow', 'run', input.workflow, '--ref', input.ref]
  for (const pair of input.inputs ?? []) {
    // Một token `-f k=v`: không shell nên dấu `=` (và cả khoảng trắng trong giá
    // trị) không thể tách thành hai đối số.
    args.push('-f', `${pair.key}=${pair.value.slice(0, INPUT_VALUE_MAX)}`)
  }
  await runGh(args, input.cwd, input.account)
  return `gh workflow run ${input.workflow} --ref ${input.ref}`
}

/**
 * Duyệt / từ chối một lần triển khai đang chờ ở môi trường được bảo vệ.
 *
 * Vì sao KHÔNG dùng `gh api -f`: endpoint này bắt thân JSON có MẢNG
 * (`environment_ids`), mà `-f` chỉ gửi form-encoded. Thân request đi bằng stdin
 * (`--input -`) nên không có giá trị nào của người dùng lọt vào argv.
 */
export async function githubApprove(input: {
  cwd: string
  account?: string | undefined
  runId: number
  environmentIds: readonly number[]
  approve: boolean
  comment?: string | undefined
}): Promise<string> {
  const body = JSON.stringify({
    environment_ids: [...input.environmentIds],
    state: input.approve ? 'approved' : 'rejected',
    comment: (input.comment ?? '').slice(0, 500),
  })
  await runGh(
    [
      'api',
      '--method',
      'POST',
      `repos/{owner}/{repo}/actions/runs/${input.runId}/pending_deployments`,
      '--input',
      '-',
    ],
    input.cwd,
    input.account,
    { stdin: body },
  )
  return `gh api --method POST repos/{owner}/{repo}/actions/runs/${input.runId}/pending_deployments`
}

const JsonWorkflow = z
  .object({ name: z.string(), path: z.string(), state: z.string().nullable().optional() })
  .passthrough()

/** `gh workflow list` — nguồn cho dropdown của form "kích hoạt chạy mới". */
export async function listWorkflows(input: {
  cwd: string
  account?: string | undefined
}): Promise<{ name: string; path: string; state: string }[]> {
  const out = await runGh(
    ['workflow', 'list', '--json', 'name,path,state', '--limit', '50'],
    input.cwd,
    input.account,
  )
  const parsed = z.array(JsonWorkflow).safeParse(parseJson(out))
  if (!parsed.success) return []
  return parsed.data.map((w) => ({ name: w.name, path: w.path, state: w.state ?? '' }))
}
