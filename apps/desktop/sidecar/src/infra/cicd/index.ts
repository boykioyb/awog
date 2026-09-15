// Màn Triển khai (Mốc 4): một chỗ gọi cho bốn nguồn CI/CD.
//
// VÌ SAO CÓ FILE NÀY. Ba RPC (`infra.cicd-runs`, `-run`, `-log`, `-action`) chia
// sẻ đúng một việc: đọc `ref` do UI gửi lên, TRA ra ngữ cảnh thật (project path,
// pipeline name, build id), rồi giao cho nguồn tương ứng. Viết việc đó bốn lần là
// bốn chỗ để một bản quên một phép kiểm — nên nó nằm ở đây, và RPC chỉ còn là lớp
// xác thực payload IPC.
//
// RENDERER KHÔNG KHAI ĐƯỢC ĐƯỜNG DẪN. `ref` chỉ chứa id (projectId, pipelineName,
// buildId…) — `cwd` của `gh` vẫn là `project.path` do sidecar đọc từ đĩa, và argv
// của `aws` vẫn ghép trong `aws.ts` sau `safeToken`.
//
// GHIT NHẬT KÝ. Lệnh AWS đi qua `runGated()` (nhật ký do `runInfra` ghi). Hành động
// trên GitHub thì KHÔNG đi qua ma trận hạ tầng — chúng không chạm tài khoản AWS,
// nên cột `production` của ma trận không có nghĩa ở đó — nhưng chúng VẪN được ghi
// vào cùng nhật ký (task 4.4: "ai duyệt deploy production lúc mấy giờ" phải trả lời
// được). `decision: 'auto'` ở đây là đúng nghĩa đen: không ai được hỏi.
import { loadProject } from '../../projects/store.js'
import { resolveProjectCwd } from '../../github/project-cwd.js'
import { recordInfraAction } from '../audit/store.js'
import {
  githubApprove,
  githubCancel,
  githubDispatch,
  githubRerun,
  githubRunDetail,
  githubStepLog,
  listGithubRuns,
  listWorkflows as ghListWorkflows,
  inputKeyOk,
  workflowRefOk,
} from './github.js'
import {
  amplifyRunDetail,
  awsRunAction,
  codebuildRunDetail,
  listAmplifyRuns,
  listCodebuildRuns,
  listPipelineRuns,
  pipelineRunDetail,
} from './aws.js'
import { CICD_SOURCES } from './types.js'

// RPC cần chính danh sách này để validate `source`; xuất lại thay vì để mỗi file
// RPC tự nhập từ `types.js` (một nguồn sự thật cho cả hai tầng).
export { CICD_SOURCES, CICD_STATUSES, CICD_LIVE } from './types.js'
export type { CicdRun, CicdRunDetail, CicdSource, CicdSourceResult, CicdStep } from './types.js'
import type {
  CicdRun,
  CicdRunDetail,
  CicdSource,
  CicdSourceBlocked,
  CicdSourceResult,
} from './types.js'
import type { InfraContext } from '../run.js'
import type { InfraSurface } from '../audit/store.js'

/** Trần số dự án GitHub quét mỗi lượt — quá trần thì nói ra ở `note`. */
export const MAX_GH_PROJECTS = 12
/** Trần số dòng mỗi nguồn trả về (người gọi có thể xin ít hơn). */
export const MAX_LIMIT = 50

export type CicdProjectRef = {
  projectId: string
  repoPath?: string | undefined
  account?: string | undefined
}

export type CicdRunsInput = {
  sources: readonly CicdSource[]
  projects: readonly CicdProjectRef[]
  branch?: string | undefined
  limit: number
  context: InfraContext
  surface: InfraSurface
  /** Vé duyệt theo TỪNG nguồn (nguồn nào bị siết nhịp đọc thì có vé riêng). */
  tickets?: Partial<Record<CicdSource, string>> | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
}

/** Kết quả của một lượt gọi đã qua cổng quyền. */
export type CicdOk<T> = { ok: true; value: T }
export type CicdBlocked = CicdSourceBlocked & { blocked: true }
export type CicdOutcome<T> = CicdOk<T> | CicdBlocked | { ok: false; blocked: false; error: string }

function blockedOf(gate: CicdSourceBlocked): CicdBlocked {
  return { blocked: true, ...gate }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ─── Bảng xuyên nguồn ───────────────────────────────────────────────────────

/**
 * Nạp bảng: mỗi nguồn là một lời gọi ĐỘC LẬP, và một nguồn hỏng KHÔNG được làm
 * trắng ba nguồn còn lại (task 4.2). Vì thế kết quả là `CicdSourceResult[]` —
 * hình dạng nói thẳng "nguồn này đọc được gì, hỏng vì sao, có bị cắt không".
 */
export async function listCicdRuns(input: CicdRunsInput): Promise<CicdSourceResult[]> {
  const want = new Set(input.sources)
  const limit = Math.max(1, Math.min(input.limit, MAX_LIMIT))
  const tasks: Promise<CicdSourceResult>[] = []

  if (want.has('github')) tasks.push(githubSource(input, limit))
  if (want.has('codepipeline')) {
    tasks.push(
      listPipelineRuns({
        context: input.context,
        surface: input.surface,
        limit,
        ...(input.tickets?.codepipeline !== undefined ? { ticket: input.tickets.codepipeline } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
      }),
    )
  }
  if (want.has('codebuild')) {
    tasks.push(
      listCodebuildRuns({
        context: input.context,
        surface: input.surface,
        limit,
        ...(input.tickets?.codebuild !== undefined ? { ticket: input.tickets.codebuild } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
      }),
    )
  }
  if (want.has('amplify')) {
    tasks.push(
      listAmplifyRuns({
        context: input.context,
        surface: input.surface,
        limit,
        ...(input.tickets?.amplify !== undefined ? { ticket: input.tickets.amplify } : {}),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
      }),
    )
  }

  const results = await Promise.all(tasks)
  // Thứ tự nguồn là HẰNG SỐ, không phải thứ tự Promise hoàn thành: hàng của bảng
  // không được nhảy chỗ giữa hai lần làm mới.
  return CICD_SOURCES.filter((s) => results.some((r) => r.source === s)).map(
    (s) => results.find((r) => r.source === s) as CicdSourceResult,
  )
}

/** GitHub: mỗi dự án là một lời gọi, gộp vào MỘT nguồn (cột "dự án" mới phân biệt). */
async function githubSource(input: CicdRunsInput, limit: number): Promise<CicdSourceResult> {
  const runs: CicdRun[] = []
  const errors: string[] = []
  const projects = input.projects.slice(0, MAX_GH_PROJECTS)

  for (const p of projects) {
    try {
      const project = await loadProject(p.projectId)
      if (!project) {
        errors.push(`${p.projectId}: project not found`)
        continue
      }
      const cwd = await resolveProjectCwd(p.projectId, p.repoPath)
      runs.push(
        ...(await listGithubRuns({
          cwd,
          key: project.name,
          projectId: p.projectId,
          ...(p.repoPath ? { repoPath: p.repoPath } : {}),
          ...(p.account ? { account: p.account } : {}),
          limit,
          ...(input.branch ? { branch: input.branch } : {}),
        })),
      )
    } catch (err) {
      // Một repo chưa có remote / chưa `gh auth` không được làm trắng cả nguồn.
      errors.push(`${p.projectId}: ${messageOf(err)}`)
    }
  }

  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const notes: string[] = []
  if (input.projects.length > projects.length) {
    notes.push(`cicd.note.projectsTruncated|${projects.length}|${input.projects.length}`)
  }
  return {
    source: 'github',
    runs,
    error: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
    note: notes.length > 0 ? notes.join(' ') : null,
    blocked: null,
  }
}

// ─── Chi tiết một lần chạy ──────────────────────────────────────────────────

export type CicdRef = Readonly<Record<string, string>>

export type CicdRefInput = {
  source: CicdSource
  ref: CicdRef
  context: InfraContext
  surface: InfraSurface
  ticket?: string | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
}

/** `ref.runId` là SỐ do `gh` phát; chuỗi lạ bị chặn trước khi thành argv. */
function intOf(v: string | undefined): number | null {
  if (v === undefined || !/^\d{1,18}$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

async function githubCwd(ref: CicdRef): Promise<string> {
  return resolveProjectCwd(ref['projectId'] ?? '', ref['repoPath'])
}

export async function cicdRunDetail(input: CicdRefInput): Promise<CicdOutcome<CicdRunDetail>> {
  const ref = input.ref
  switch (input.source) {
    case 'github': {
      const runId = intOf(ref['runId'])
      if (runId === null) return { ok: false, blocked: false, error: 'cicd.action.badRef' }
      try {
        const detail = await githubRunDetail({
          cwd: await githubCwd(ref),
          ...(ref['account'] ? { account: ref['account'] } : {}),
          runId,
          ...(ref['key'] ? { key: ref['key'] } : {}),
          where: {
            projectId: ref['projectId'] ?? '',
            ...(ref['repoPath'] ? { repoPath: ref['repoPath'] } : {}),
            ...(ref['account'] ? { account: ref['account'] } : {}),
          },
        })
        return { ok: true, value: detail }
      } catch (err) {
        return { ok: false, blocked: false, error: messageOf(err) }
      }
    }
    case 'codepipeline': {
      const name = ref['pipelineName']
      if (!name) return { ok: false, blocked: false, error: 'cicd.action.badRef' }
      const res = await pipelineRunDetail({ ...baseOf(input), pipelineName: name, executionId: ref['executionId'] ?? '', key: ref['key'] ?? name })
      return res.ok
        ? { ok: true, value: res.detail }
        : 'gate' in res
          ? blockedOf(res.gate)
          : { ok: false, blocked: false, error: res.error }
    }
    case 'codebuild': {
      const buildId = ref['buildId']
      if (!buildId) return { ok: false, blocked: false, error: 'cicd.action.badRef' }
      const res = await codebuildRunDetail({ ...baseOf(input), buildId, key: ref['key'] ?? ref['projectName'] ?? '' })
      return res.ok
        ? { ok: true, value: res.detail }
        : 'gate' in res
          ? blockedOf(res.gate)
          : { ok: false, blocked: false, error: res.error }
    }
    case 'amplify': {
      const appId = ref['appId']
      const branchName = ref['branchName']
      const jobId = ref['jobId']
      if (!appId || !branchName || !jobId) {
        return { ok: false, blocked: false, error: 'cicd.action.badRef' }
      }
      const res = await amplifyRunDetail({
        ...baseOf(input),
        appId,
        branchName,
        jobId,
        key: ref['key'] ?? appId,
      })
      return res.ok
        ? { ok: true, value: res.detail }
        : 'gate' in res
          ? blockedOf(res.gate)
          : { ok: false, blocked: false, error: res.error }
    }
  }
}

function baseOf(input: CicdRefInput): {
  context: InfraContext
  surface: InfraSurface
  ticket?: string
  sessionId?: string
  messageId?: string
} {
  return {
    context: input.context,
    surface: input.surface,
    ...(input.ticket !== undefined ? { ticket: input.ticket } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
  }
}

// ─── Log của một bước ───────────────────────────────────────────────────────

export type CicdLogValue = {
  lines: readonly string[]
  command: string
  totalLines: number
  truncated: boolean
}

/**
 * Log của MỘT bước. Chỉ GitHub có đường này ở v1: log build của CodeBuild nằm ở
 * CloudWatch Logs, và chỗ đọc nó ĐÃ có — bước của CodeBuild mang `logRef` để UI
 * gieo sang tab Logs, thay vì AWOG dựng một viewer thứ hai (spec 4.3).
 */
export async function cicdStepLog(
  input: CicdRefInput & { stepId: string },
): Promise<CicdOutcome<CicdLogValue>> {
  if (input.source !== 'github') {
    return { ok: false, blocked: false, error: 'cicd.log.notGithub' }
  }
  const ref = input.ref
  const runId = intOf(ref['runId'])
  // `stepId` = `<jobDatabaseId>:<stepNumber>` — hai số nguyên, không có chữ.
  const jobId = intOf(input.stepId.split(':')[0])
  if (runId === null || jobId === null) {
    return { ok: false, blocked: false, error: 'cicd.action.badRef' }
  }
  try {
    const log = await githubStepLog({
      cwd: await githubCwd(ref),
      ...(ref['account'] ? { account: ref['account'] } : {}),
      runId,
      jobId,
      step: ref['step'] ?? undefined,
    })
    return { ok: true, value: log }
  } catch (err) {
    return { ok: false, blocked: false, error: messageOf(err) }
  }
}

// ─── Hành động ──────────────────────────────────────────────────────────────

export type CicdActionInput = CicdRefInput & {
  kind: 'rerun' | 'cancel' | 'dispatch' | 'approve'
  /** `rerun`: chỉ bước hỏng. */
  failedOnly?: boolean | undefined
  /** `dispatch`: workflow file + git ref + input. */
  workflow?: string | undefined
  gitRef?: string | undefined
  inputs?: readonly { key: string; value: string }[] | undefined
  /** `approve`: đồng ý hay từ chối, kèm lời nhắn. */
  approve?: boolean | undefined
  summary?: string | undefined
}

export async function cicdAction(input: CicdActionInput): Promise<CicdOutcome<string>> {
  if (input.source !== 'github') {
    const res = await awsRunAction({
      ...baseOf(input),
      kind: input.kind,
      ref: input.ref,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.approve !== undefined ? { approve: input.approve } : {}),
    })
    if (res.ok) return { ok: true, value: res.command }
    return 'gate' in res ? blockedOf(res.gate) : { ok: false, blocked: false, error: res.error }
  }

  // GitHub: không có ma trận hạ tầng (xem đầu file) nhưng vẫn ghi nhật ký.
  try {
    const command = await githubAction(input)
    await recordInfraAction({
      actor: 'human',
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
      surface: input.surface,
      tool: 'github_pipeline_action',
      argv: command.split(' ').slice(0, 40),
      context: {},
      class: 'write',
      decision: 'auto',
      result: { summary: 'GitHub Actions — GitHub ghi nhật ký phía nó; dòng này để AWOG trả lời "ai làm gì lúc nào"' },
    })
    return { ok: true, value: command }
  } catch (err) {
    return { ok: false, blocked: false, error: messageOf(err) }
  }
}

async function githubAction(input: CicdActionInput): Promise<string> {
  const ref = input.ref
  const cwd = await githubCwd(ref)
  const account = ref['account'] || undefined
  switch (input.kind) {
    case 'rerun': {
      const runId = intOf(ref['runId'])
      if (runId === null) throw new Error('cicd.action.badRef')
      return githubRerun({ cwd, ...(account ? { account } : {}), runId, failedOnly: input.failedOnly === true })
    }
    case 'cancel': {
      const runId = intOf(ref['runId'])
      if (runId === null) throw new Error('cicd.action.badRef')
      return githubCancel({ cwd, ...(account ? { account } : {}), runId })
    }
    case 'dispatch': {
      const workflow = input.workflow ?? ''
      const gitRef = input.gitRef ?? ''
      if (!workflowRefOk(workflow, gitRef)) throw new Error('cicd.action.badWorkflow')
      for (const pair of input.inputs ?? []) {
        if (!inputKeyOk(pair.key)) throw new Error('cicd.action.badInput')
      }
      return githubDispatch({
        cwd,
        ...(account ? { account } : {}),
        workflow,
        ref: gitRef,
        ...(input.inputs ? { inputs: input.inputs } : {}),
      })
    }
    case 'approve': {
      const runId = intOf(ref['runId'])
      const envId = intOf(ref['approvalId'])
      if (runId === null || envId === null) throw new Error('cicd.action.badRef')
      return githubApprove({
        cwd,
        ...(account ? { account } : {}),
        runId,
        environmentIds: [envId],
        approve: input.approve !== false,
        ...(input.summary !== undefined ? { comment: input.summary } : {}),
      })
    }
  }
}

/** Danh sách workflow của một dự án — cho form "kích hoạt chạy mới". */
export async function listGithubWorkflows(input: CicdProjectRef): Promise<
  CicdOutcome<readonly { name: string; path: string; state: string }[]>
> {
  try {
    const cwd = await resolveProjectCwd(input.projectId, input.repoPath)
    const out = await ghListWorkflows({ cwd, ...(input.account ? { account: input.account } : {}) })
    return { ok: true, value: out }
  } catch (err) {
    return { ok: false, blocked: false, error: messageOf(err) }
  }
}
