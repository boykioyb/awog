// Nguồn AWS của màn Triển khai (Mốc 4, task 4.6): CodePipeline · CodeBuild · Amplify.
//
// MỌI lời gọi ở đây đi qua `runGated()` — cùng cổng quyền, cùng dòng nhật ký, cùng
// ma trận của Explorer (task 4.4: "tất cả đi qua ma trận quyền như mọi lệnh khác").
// File này KHÔNG tự spawn `aws`: nó khai argv rồi để cổng quyết định.
//
// BA NGUỒN, MỘT HÌNH DẠNG. CodePipeline nói `status` của execution, CodeBuild nói
// `buildStatus`, Amplify nói `jobSummary.status` — chúng được dịch về `CicdRun`
// ngay tại đây (xem `types.ts`), nên bảng và thông báo chỉ phải hiểu một thang.
//
// CHỈ TÊN, KHÔNG GIÁ TRỊ. `batch-get-builds` trả về `environment.environmentVariables`
// kèm VALUE của biến loại PLAINTEXT. Đó là lý do op này nằm trong
// `AWS_SENSITIVE_READ_OPS` (production ⇒ phải có người duyệt) và là lý do hàm
// `envNamesOf()` dưới đây CHỈ lấy `.name` — giá trị không được map vào bất kỳ
// trường nào của `CicdRunDetail`, không vào nhật ký, không lên UI.
//
// TRẦN SỐ LỜI GỌI. CodePipeline/CodeBuild/Amplify đều không có API "mọi lần chạy
// của tài khoản", nên bảng phải quét N tài nguyên đầu rồi hỏi chi tiết từng cái.
// Trần đó (`limit`) do người gọi đặt và mỗi nguồn trả về `note` nói rõ đã cắt — im
// lặng cắt là nói dối về độ phủ.

import { z } from 'zod'
import { runGated } from '../gated.js'
import { amplifyStatus, codebuildStatus, pipelineStatus, spanMs } from './types.js'
import type {
  CicdApproval,
  CicdArtifact,
  CicdRun,
  CicdRunDetail,
  CicdSourceBlocked,
  CicdSourceResult,
  CicdStep,
} from './types.js'
import type { InfraContext } from '../run.js'
import type { InfraSurface } from '../audit/store.js'
import type { InfraGatedResult } from '../gated.js'

/** Ngữ cảnh chung của mọi lời gọi AWS của màn Triển khai. */
export type AwsCicdBase = {
  context: InfraContext
  surface: InfraSurface
  /** Vé duyệt của lượt gọi trước (chỉ dùng khi ma trận siết nhịp ĐỌC). */
  ticket?: string | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
}

export type AwsJsonOutcome =
  | { ok: true; json: unknown; command: string }
  | { ok: false; gate: CicdSourceBlocked }
  | { ok: false; error: string }

/**
 * Chạy MỘT lệnh `read` qua cổng quyền rồi trả JSON đã parse.
 *
 * Lệnh hỏng KHÔNG phải sự cố RPC: câu của AWS ("not authorized", "does not exist")
 * là câu trả lời hợp lệ và UI phải hiện được nó.
 */
export async function awsJson(
  input: AwsCicdBase & { args: readonly string[]; toolName: string },
): Promise<AwsJsonOutcome> {
  const gated = await runGated({
    tool: 'aws',
    args: input.args,
    context: input.context,
    surface: input.surface,
    toolName: input.toolName,
    ...(input.ticket !== undefined ? { approvalTicket: input.ticket } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
  })
  if (gated.blocked) return { ok: false, gate: gateOf(gated) }
  if (!gated.result.ok) return { ok: false, error: errorText(gated.result) }
  try {
    return { ok: true, json: JSON.parse(gated.result.stdout) as unknown, command: gated.command }
  } catch {
    return { ok: false, error: 'cicd.badJson' }
  }
}

/** Cổng quyền đã chặn — dạng UI cần để mở hộp duyệt rồi gọi lại kèm vé. */
export function gateOf(gated: Extract<InfraGatedResult, { blocked: true }>): CicdSourceBlocked {
  return {
    requiresApproval: gated.requiresApproval,
    ...(gated.approvalTicket !== undefined ? { approvalTicket: gated.approvalTicket } : {}),
    command: gated.command,
    reason: gated.reason,
    class: gated.class,
    accountKind: gated.accountKind,
    mode: gated.mode,
  }
}

function errorText(result: { stderr: string; stdout: string }): string {
  const err = result.stderr.trim()
  if (err) return err.slice(0, 2000)
  return result.stdout.trim().slice(0, 2000) || 'cicd.cli'
}

// ─── Giá trị đi vào argv ────────────────────────────────────────────────────
// Tên pipeline/project/app của AWS có bảng chữ cái hẹp. Kiểm ở ĐÂY (không chỉ ở
// RPC) vì các giá trị này quay lại từ `ref` do UI gửi lên — chuỗi rỗng hoặc bắt
// đầu bằng `-` phải bị chặn trước khi thành argv.

// Một TOKEN argv hợp lệ: không rỗng, không bắt đầu bằng `-` (argparse sẽ đọc nó
// thành cờ, không thành giá trị), không chứa ký tự điều khiển. Khoảng trắng được
// phép vì argv là MẢNG — một giá trị có dấu cách vẫn là MỘT đối số.
const TOKEN_RE = /^[^\s-][^\u0000-\u001f\u007f]{0,255}$/

export function safeToken(v: string): string | null {
  return TOKEN_RE.test(v) ? v : null
}

/** `id` để mở chi tiết: ngắn, ổn định, và không chứa giá trị người dùng tự do. */
function shortId(v: string): string {
  return v.length > 64 ? `${v.slice(0, 61)}…` : v
}

/**
 * Cột `commit` của bảng: SHA đầy đủ bị rút còn 7 ký tự cho khớp hàng GitHub (một
 * cột commit mà mỗi nguồn dài một kiểu là cột không đọc được). Giá trị KHÔNG phải
 * SHA (Amplify có thể trả id lạ) thì giữ nguyên — cắt bừa là làm mất thông tin.
 */
function shortCommit(v: string): string {
  return /^[0-9a-f]{7,40}$/i.test(v) ? v.slice(0, 7) : shortId(v)
}

// ─── CodePipeline ───────────────────────────────────────────────────────────

const JsonPipelineList = z
  .object({
    pipelines: z
      .array(z.object({ name: z.string() }).passthrough())
      .nullable()
      .optional(),
  })
  .passthrough()

const JsonExecutions = z
  .object({
    pipelineExecutionSummaries: z
      .array(
        z
          .object({
            pipelineExecutionId: z.string(),
            status: z.string().nullable().optional(),
            startTime: z.string().nullable().optional(),
            lastUpdateTime: z.string().nullable().optional(),
            sourceRevisions: z
              .array(
                z
                  .object({
                    actionName: z.string().nullable().optional(),
                    revisionId: z.string().nullable().optional(),
                    revisionSummary: z.string().nullable().optional(),
                    revisionUrl: z.string().nullable().optional(),
                  })
                  .passthrough(),
              )
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough()

type PipelineExecution = z.infer<typeof JsonExecutions>['pipelineExecutionSummaries'] extends
  | (infer T)[]
  | null
  | undefined
  ? T
  : never

function pipelineRun(name: string, ex: PipelineExecution): CicdRun {
  const rev = ex.sourceRevisions?.[0]
  const sha = rev?.revisionId ?? ''
  const started = ex.startTime ?? ''
  return {
    id: `codepipeline:${name}:${ex.pipelineExecutionId}`,
    source: 'codepipeline',
    project: name,
    title: name,
    // CodePipeline không phơi NHÁNH: `sourceRevisions` có commit/summary/url nhưng
    // không nói nhánh. Bịa ra một nhánh từ summary là nói dối — để trống.
    branch: '',
    commit: shortCommit(sha),
    status: pipelineStatus(ex.status ?? ''),
    startedAt: started,
    finishedAt: ex.lastUpdateTime ?? null,
    durationMs: spanMs(started, ex.lastUpdateTime ?? null),
    actor: 'codepipeline',
    url: rev?.revisionUrl ?? null,
    stepName: null,
    needsApproval: false,
    ref: { pipelineName: name, executionId: ex.pipelineExecutionId },
  }
}

/** Các pipeline đọc được, tối đa `limit` — kèm câu nói rõ nếu bị cắt. */
export async function listPipelineRuns(
  input: AwsCicdBase & { limit: number },
): Promise<CicdSourceResult> {
  const head = await awsJson({
    ...input,
    args: ['codepipeline', 'list-pipelines'],
    toolName: 'infra_pipeline',
  })
  if (!head.ok) return emptySource('codepipeline', head)

  const names = (JsonPipelineList.safeParse(head.json).data?.pipelines ?? [])
    .map((p) => p.name)
    .filter((n) => safeToken(n) !== null)
  const scanned = names.slice(0, input.limit)

  const runs: CicdRun[] = []
  for (const name of scanned) {
    const exec = await awsJson({
      ...input,
      args: [
        'codepipeline',
        'list-pipeline-executions',
        '--pipeline-name',
        name,
        '--max-items',
        '1',
      ],
      toolName: 'infra_pipeline',
    })
    // Một pipeline hỏng (thiếu quyền, đã xoá) không được làm trắng cả nguồn.
    // Nhưng một pipeline BỊ CỔNG CHẶN thì phải dừng cả nguồn: bảng đọc được một
    // nửa mà không nói ra là bảng nói dối về độ phủ.
    if (!exec.ok) {
      if ('gate' in exec) return emptySource('codepipeline', exec)
      continue
    }
    const latest = JsonExecutions.safeParse(exec.json).data?.pipelineExecutionSummaries?.[0]
    if (latest) runs.push(pipelineRun(name, latest))
  }

  return {
    source: 'codepipeline',
    runs,
    error: null,
    note:
      names.length > scanned.length
        ? `cicd.note.pipelinesTruncated|${scanned.length}|${names.length}`
        : null,
    blocked: null,
  }
}

const JsonPipelineState = z
  .object({
    pipelineName: z.string().nullable().optional(),
    stageStates: z
      .array(
        z
          .object({
            stageName: z.string().nullable().optional(),
            actionStates: z
              .array(
                z
                  .object({
                    actionName: z.string().nullable().optional(),
                    currentRevision: z
                      .object({
                        revisionId: z.string().nullable().optional(),
                        revisionUrl: z.string().nullable().optional(),
                      })
                      .passthrough()
                      .nullable()
                      .optional(),
                    latestExecution: z
                      .object({
                        status: z.string().nullable().optional(),
                        summary: z.string().nullable().optional(),
                        token: z.string().nullable().optional(),
                        externalExecutionUrl: z.string().nullable().optional(),
                        errorDetails: z
                          .object({
                            code: z.string().nullable().optional(),
                            message: z.string().nullable().optional(),
                          })
                          .passthrough()
                          .nullable()
                          .optional(),
                      })
                      .passthrough()
                      .nullable()
                      .optional(),
                  })
                  .passthrough(),
              )
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough()

/** Chi tiết MỘT pipeline: bước theo stage/action + việc đang chờ duyệt. */
export async function pipelineRunDetail(
  input: AwsCicdBase & { pipelineName: string; executionId: string; key: string },
): Promise<
  | { ok: true; detail: CicdRunDetail }
  | { ok: false; gate: CicdSourceBlocked }
  | { ok: false; error: string }
> {
  const res = await awsJson({
    ...input,
    args: ['codepipeline', 'get-pipeline-state', '--name', input.pipelineName],
    toolName: 'infra_pipeline',
  })
  if (!res.ok) return res

  const state = JsonPipelineState.safeParse(res.json)
  const steps: CicdStep[] = []
  const approvals: CicdApproval[] = []
  let commit = ''
  let url: string | null = null
  let failedStage: string | null = null

  if (state.success) {
    for (const stage of state.data.stageStates ?? []) {
      const stageName = stage.stageName ?? ''
      for (const action of stage.actionStates ?? []) {
        const ex = action.latestExecution
        const status = pipelineActionStatus(ex?.status ?? '')
        steps.push({
          id: `${stageName}:${action.actionName ?? ''}`,
          name: action.actionName ?? '',
          status,
          startedAt: null,
          durationMs: null,
          group: stageName,
          // CodePipeline không có API log cho action ở tầng này: mở trên console
          // (link của chính action) chứ AWOG không tự đi tìm log của CodeBuild
          // đứng sau — đó là một lời gọi nữa mà người dùng không hỏi.
          logRef: null,
          logUrl: ex?.externalExecutionUrl ?? null,
        })
        if (!commit && action.currentRevision?.revisionId) commit = action.currentRevision.revisionId
        if (!url && action.currentRevision?.revisionUrl) url = action.currentRevision.revisionUrl
        if (status === 'failed' && !failedStage) failedStage = stageName
        // Chờ duyệt = action đang InProgress VÀ có token: `token` là thứ
        // `put-approval-result` cần, và nó chỉ có mặt khi thật sự đang chờ người.
        if (ex?.status === 'InProgress' && ex.token) {
          approvals.push({
            id: `${stageName}:${action.actionName ?? ''}`,
            label: stageName || (action.actionName ?? ''),
          })
        }
      }
    }
  }

  const run: CicdRun = {
    id: `codepipeline:${input.pipelineName}:${input.executionId}`,
    source: 'codepipeline',
    project: input.key,
    title: input.pipelineName,
    branch: '',
    commit: shortCommit(commit),
    status: failedStage ? 'failed' : approvals.length > 0 ? 'waiting' : 'unknown',
    startedAt: '',
    finishedAt: null,
    durationMs: null,
    actor: 'codepipeline',
    url,
    stepName: failedStage,
    needsApproval: approvals.length > 0,
    ref: { pipelineName: input.pipelineName, executionId: input.executionId },
  }

  return {
    ok: true,
    detail: { run, steps, artifacts: [] as CicdArtifact[], pr: null, envNames: [], approvals },
  }
}

function pipelineActionStatus(status: string): CicdRun['status'] {
  switch (status) {
    case 'Succeeded':
      return 'success'
    case 'Failed':
    case 'Abandoned':
      return 'failed'
    case 'InProgress':
      return 'running'
    default:
      return 'unknown'
  }
}

// ─── CodeBuild ──────────────────────────────────────────────────────────────

const JsonProjects = z
  .object({ projects: z.array(z.string()).nullable().optional() })
  .passthrough()

const JsonBuildIds = z.object({ ids: z.array(z.string()).nullable().optional() }).passthrough()

const JsonBuild = z
  .object({
    id: z.string(),
    projectName: z.string().nullable().optional(),
    buildNumber: z.number().nullable().optional(),
    buildStatus: z.string().nullable().optional(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    initiator: z.string().nullable().optional(),
    sourceVersion: z.string().nullable().optional(),
    currentPhase: z.string().nullable().optional(),
    logs: z
      .object({
        groupName: z.string().nullable().optional(),
        streamName: z.string().nullable().optional(),
        deepLink: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    phases: z
      .array(
        z
          .object({
            phaseType: z.string().nullable().optional(),
            phaseStatus: z.string().nullable().optional(),
            startTime: z.string().nullable().optional(),
            endTime: z.string().nullable().optional(),
            contexts: z
              .array(z.object({ message: z.string().nullable().optional() }).passthrough())
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
    environment: z
      .object({
        environmentVariables: z
          .array(
            z
              .object({
                name: z.string().nullable().optional(),
                type: z.string().nullable().optional(),
              })
              .passthrough(),
          )
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

const JsonBuilds = z
  .object({ builds: z.array(JsonBuild).nullable().optional() })
  .passthrough()

export type CodebuildBuild = z.infer<typeof JsonBuild>

/** `buildStatus` + pha đang chạy/hỏng → một dòng bảng. */
function codebuildRun(build: CodebuildBuild): CicdRun {
  const project = build.projectName ?? ''
  const status = codebuildStatus(build.buildStatus ?? '')
  const failedPhase =
    status === 'failed'
      ? (build.phases ?? []).find((p) => p.phaseStatus === 'FAILED')?.phaseType ?? null
      : null
  return {
    id: `codebuild:${project}:${build.id}`,
    source: 'codebuild',
    project,
    title: `${project} #${build.buildNumber ?? ''}`.trim(),
    branch: '',
    commit: shortCommit(build.sourceVersion ?? ''),
    status,
    startedAt: build.startTime ?? '',
    finishedAt: build.endTime ?? null,
    durationMs: spanMs(build.startTime ?? '', build.endTime ?? null),
    actor: build.initiator ?? '',
    url: null,
    stepName: failedPhase ?? (status === 'running' ? (build.currentPhase ?? null) : null),
    needsApproval: false,
    ref: { buildId: build.id, projectName: project },
  }
}

/** CodeBuild: quét N project đầu, gom id build rồi hỏi chi tiết MỘT lô. */
export async function listCodebuildRuns(
  input: AwsCicdBase & { limit: number },
): Promise<CicdSourceResult> {
  const head = await awsJson({
    ...input,
    args: ['codebuild', 'list-projects'],
    toolName: 'infra_pipeline',
  })
  if (!head.ok) return emptySource('codebuild', head)

  const projects = (JsonProjects.safeParse(head.json).data?.projects ?? []).filter(
    (p) => safeToken(p) !== null,
  )
  const scanned = projects.slice(0, input.limit)

  const ids: string[] = []
  for (const project of scanned) {
    const res = await awsJson({
      ...input,
      args: [
        'codebuild',
        'list-builds-for-project',
        '--project-name',
        project,
        '--max-items',
        '2',
      ],
      toolName: 'infra_pipeline',
    })
    if (!res.ok) {
      if ('gate' in res) return emptySource('codebuild', res)
      continue
    }
    for (const id of JsonBuildIds.safeParse(res.json).data?.ids ?? []) {
      if (safeToken(id) !== null) ids.push(id)
    }
  }
  if (ids.length === 0) {
    return { source: 'codebuild', runs: [], error: null, note: null, blocked: null }
  }

  // `--ids` nhận nhiều token; trần 100 của API là lý do chặn ở 40 (20 build × 2).
  const batch = await awsJson({
    ...input,
    args: ['codebuild', 'batch-get-builds', '--ids', ...ids.slice(0, 40)],
    toolName: 'infra_pipeline',
  })
  if (!batch.ok) return emptySource('codebuild', batch)

  const builds = JsonBuilds.safeParse(batch.json).data?.builds ?? []
  return {
    source: 'codebuild',
    runs: builds.map(codebuildRun).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    error: null,
    note:
      projects.length > scanned.length
        ? `cicd.note.projectsTruncated|${scanned.length}|${projects.length}`
        : null,
    blocked: null,
  }
}

export async function codebuildRunDetail(
  input: AwsCicdBase & { buildId: string; key: string },
): Promise<
  | { ok: true; detail: CicdRunDetail }
  | { ok: false; gate: CicdSourceBlocked }
  | { ok: false; error: string }
> {
  const res = await awsJson({
    ...input,
    args: ['codebuild', 'batch-get-builds', '--ids', input.buildId],
    toolName: 'infra_pipeline',
  })
  if (!res.ok) return res

  const build = JsonBuilds.safeParse(res.json).data?.builds?.[0]
  if (!build) return { ok: false, error: 'cicd.notFound' }

  // Mọi pha của MỘT build ghi vào CÙNG một log stream — nên `logRef` giống nhau
  // ở từng bước, và nó chỉ là GỢI Ý để gieo sang tab Logs (`/aws/codebuild/<project>`).
  const group = build.logs?.groupName ?? ''
  const stream = build.logs?.streamName ?? null
  const logRef = group ? { group, stream } : null
  const steps: CicdStep[] = (build.phases ?? []).map((p) => ({
    id: p.phaseType ?? '',
    name: p.phaseType ?? '',
    status: codebuildStatus(p.phaseStatus ?? ''),
    startedAt: p.startTime ?? null,
    durationMs: spanMs(p.startTime ?? '', p.endTime ?? null),
    group: '',
    logRef,
    logUrl: build.logs?.deepLink ?? null,
  }))

  const envNames = (build.environment?.environmentVariables ?? [])
    .map((v) => v.name ?? '')
    .filter((n) => n !== '')
    .map((n) => `${n} (codebuild)`)

  return {
    ok: true,
    detail: {
      run: { ...codebuildRun(build), project: input.key },
      steps,
      artifacts: [],
      pr: null,
      envNames,
      approvals: [],
    },
  }
}

// ─── Amplify Hosting ────────────────────────────────────────────────────────

const JsonApps = z
  .object({
    apps: z
      .array(z.object({ appId: z.string(), name: z.string().nullable().optional() }).passthrough())
      .nullable()
      .optional(),
  })
  .passthrough()

const JsonBranches = z
  .object({
    branches: z
      .array(z.object({ branchName: z.string(), stage: z.string().nullable().optional() }).passthrough())
      .nullable()
      .optional(),
  })
  .passthrough()

const JsonJobSummary = z
  .object({
    jobId: z.string(),
    jobType: z.string().nullable().optional(),
    jobName: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    commitId: z.string().nullable().optional(),
    commitMessage: z.string().nullable().optional(),
  })
  .passthrough()

const JsonJobs = z
  .object({ jobSummaries: z.array(JsonJobSummary).nullable().optional() })
  .passthrough()

const JsonJob = z
  .object({
    job: z
      .object({
        summary: JsonJobSummary.nullable().optional(),
        steps: z
          .array(
            z
              .object({
                stepName: z.string().nullable().optional(),
                status: z.string().nullable().optional(),
                startTime: z.string().nullable().optional(),
                endTime: z.string().nullable().optional(),
                logUrl: z.string().nullable().optional(),
              })
              .passthrough(),
          )
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

function amplifyRun(appId: string, appName: string, branch: string, job: z.infer<typeof JsonJobSummary>): CicdRun {
  const status = amplifyStatus(job.status ?? '')
  return {
    id: `amplify:${appId}:${branch}:${job.jobId}`,
    source: 'amplify',
    project: appName || appId,
    title: `${appName || appId} · ${branch}`,
    branch,
    commit: shortCommit(job.commitId ?? ''),
    status,
    startedAt: job.startTime ?? '',
    finishedAt: job.endTime ?? null,
    durationMs: spanMs(job.startTime ?? '', job.endTime ?? null),
    actor: job.jobType ?? 'amplify',
    url: null,
    stepName: null,
    needsApproval: false,
    ref: { appId, branchName: branch, jobId: job.jobId },
  }
}

/**
 * Amplify: mỗi app đọc MỘT nhánh (nhánh `main` nếu có, không thì nhánh đầu) —
 * Amplify không có API "mọi job của app", nên số lời gọi là (1 + 2 × số app).
 * Giới hạn này được nói ra ở `note` chứ không im lặng.
 */
export async function listAmplifyRuns(
  input: AwsCicdBase & { limit: number },
): Promise<CicdSourceResult> {
  const head = await awsJson({
    ...input,
    args: ['amplify', 'list-apps'],
    toolName: 'infra_pipeline',
  })
  if (!head.ok) return emptySource('amplify', head)

  const apps = (JsonApps.safeParse(head.json).data?.apps ?? []).filter(
    (a) => safeToken(a.appId) !== null,
  )
  const scanned = apps.slice(0, input.limit)

  const runs: CicdRun[] = []
  for (const app of scanned) {
    const br = await awsJson({
      ...input,
      args: ['amplify', 'list-branches', '--app-id', app.appId],
      toolName: 'infra_pipeline',
    })
    if (!br.ok) {
      if ('gate' in br) return emptySource('amplify', br)
      continue
    }
    const branches = (JsonBranches.safeParse(br.json).data?.branches ?? []).filter(
      (b) => safeToken(b.branchName) !== null,
    )
    const branch = branches.find((b) => b.branchName === 'main') ?? branches[0]
    if (!branch) continue

    const jobs = await awsJson({
      ...input,
      args: [
        'amplify',
        'list-jobs',
        '--app-id',
        app.appId,
        '--branch-name',
        branch.branchName,
        '--max-items',
        '1',
      ],
      toolName: 'infra_pipeline',
    })
    if (!jobs.ok) {
      if ('gate' in jobs) return emptySource('amplify', jobs)
      continue
    }
    const latest = JsonJobs.safeParse(jobs.json).data?.jobSummaries?.[0]
    if (latest) {
      runs.push(amplifyRun(app.appId, app.name ?? '', branch.branchName, latest))
    }
  }

  // Chỉ MỘT nhánh mỗi app được đọc — nói ra, vì "app có 5 nhánh" là chuyện thường.
  const note =
    apps.length > scanned.length
      ? `cicd.note.appsTruncated|${scanned.length}|${apps.length}`
      : scanned.length > 0 && runs.length === 0
        ? 'cicd.note.amplifyMainBranch'
        : null

  return { source: 'amplify', runs, error: null, note, blocked: null }
}

export async function amplifyRunDetail(
  input: AwsCicdBase & { appId: string; branchName: string; jobId: string; key: string },
): Promise<
  | { ok: true; detail: CicdRunDetail }
  | { ok: false; gate: CicdSourceBlocked }
  | { ok: false; error: string }
> {
  const res = await awsJson({
    ...input,
    args: [
      'amplify',
      'get-job',
      '--app-id',
      input.appId,
      '--branch-name',
      input.branchName,
      '--job-id',
      input.jobId,
    ],
    toolName: 'infra_pipeline',
  })
  if (!res.ok) return res

  const parsed = JsonJob.safeParse(res.json)
  if (!parsed.success || !parsed.data.job) return { ok: false, error: 'cicd.notFound' }
  const job = parsed.data.job

  const steps: CicdStep[] = (job.steps ?? []).map((s, i) => ({
    id: `${i}:${s.stepName ?? ''}`,
    name: s.stepName ?? '',
    status: amplifyStatus(s.status ?? ''),
    startedAt: s.startTime ?? null,
    durationMs: spanMs(s.startTime ?? '', s.endTime ?? null),
    group: '',
    // Amplify trả link log của từng bước — mở bằng trình duyệt (log nằm ở
    // CloudWatch nhưng qua console của Amplify, không có tên group/stream ở đây).
    logRef: null,
    logUrl: s.logUrl ?? null,
  }))

  const summary = job.summary
  const run: CicdRun = summary
    ? { ...amplifyRun(input.appId, input.key, input.branchName, summary), project: input.key }
    : {
        id: `amplify:${input.appId}:${input.branchName}:${input.jobId}`,
        source: 'amplify',
        project: input.key,
        title: `${input.key} · ${input.branchName}`,
        branch: input.branchName,
        commit: '',
        status: 'unknown',
        startedAt: '',
        finishedAt: null,
        durationMs: null,
        actor: 'amplify',
        url: null,
        stepName: null,
        needsApproval: false,
        ref: { appId: input.appId, branchName: input.branchName, jobId: input.jobId },
      }

  return {
    ok: true,
    detail: { run, steps, artifacts: [], pr: null, envNames: [], approvals: [] },
  }
}

// ─── Dùng chung ─────────────────────────────────────────────────────────────

/** Nguồn không đọc được → `runs` rỗng + câu lỗi (hoặc cổng quyền đã chặn). */
export function emptySource(
  source: CicdSourceResult['source'],
  outcome: Extract<AwsJsonOutcome, { ok: false }>,
): CicdSourceResult {
  if ('gate' in outcome) {
    return { source, runs: [], error: null, note: null, blocked: outcome.gate }
  }
  return { source, runs: [], error: outcome.error, note: null, blocked: null }
}

// ─── Hành động (đều là GHI — cổng quyền hỏi ở RPC, nhật ký ghi ở `runInfra`) ──

export type CicdActionKind = 'rerun' | 'cancel' | 'dispatch' | 'approve'

export type AwsActionOutcome =
  | { ok: true; command: string }
  | { ok: false; gate: CicdSourceBlocked }
  | { ok: false; error: string }

const BAD_REF: AwsActionOutcome = { ok: false, error: 'cicd.action.badRef' }

/** Chạy một lệnh GHI qua cổng quyền; không trả stdout (lệnh ghi không có gì để đọc). */
async function gatedRun(
  input: AwsCicdBase & { args: readonly string[] },
): Promise<AwsActionOutcome> {
  const gated = await runGated({
    tool: 'aws',
    args: input.args,
    context: input.context,
    surface: input.surface,
    toolName: 'infra_pipeline_action',
    ...(input.ticket !== undefined ? { approvalTicket: input.ticket } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
  })
  if (gated.blocked) return { ok: false, gate: gateOf(gated) }
  if (!gated.result.ok) return { ok: false, error: errorText(gated.result) }
  return { ok: true, command: gated.command }
}

/** Một giá trị của `ref` đã qua `safeToken`, hoặc `null` (⇒ từ chối cả hành động). */
function tok(v: string | undefined): string | null {
  return v === undefined ? null : safeToken(v)
}

/**
 * `put-approval-result` cần TOKEN do `get-pipeline-state` phát. Token đó KHÔNG đi
 * qua UI: hàm này đọc state ngay trước khi duyệt rồi ghép argv — nhờ vậy renderer
 * không giữ được thứ dùng để duyệt hộ, và vé duyệt vẫn là của sidecar.
 *
 * Cùng lý do, "chạy lại" trên CodePipeline cũng TỰ TÌM stage hỏng ở đây thay vì
 * nhận tên stage từ renderer: tên stage là argv, và argv không đến từ UI.
 */
async function codepipelineState(
  input: AwsCicdBase & { pipelineName: string },
): Promise<
  | { ok: true; state: z.infer<typeof JsonPipelineState> }
  | { ok: false; error: string }
  | { ok: false; gate: CicdSourceBlocked }
> {
  const res = await awsJson({
    ...input,
    args: ['codepipeline', 'get-pipeline-state', '--name', input.pipelineName],
    toolName: 'infra_pipeline',
  })
  if (!res.ok) return res
  const parsed = JsonPipelineState.safeParse(res.json)
  if (!parsed.success) return { ok: false, error: 'cicd.badJson' }
  return { ok: true, state: parsed.data }
}

/** Stage HỎNG đầu tiên theo `get-pipeline-state` — `null` khi không có stage nào hỏng. */
function failedStageOf(state: z.infer<typeof JsonPipelineState>): string | null {
  for (const stage of state.stageStates ?? []) {
    for (const action of stage.actionStates ?? []) {
      const st = action.latestExecution?.status
      if (st === 'Failed' || st === 'Abandoned') return stage.stageName ?? null
    }
  }
  return null
}

/** `retry-stage-execution` trên stage hỏng đầu tiên (sidecar tự tìm, UI không khai). */
async function codepipelineRerun(
  input: AwsCicdBase & { pipelineName: string; executionId: string },
): Promise<AwsActionOutcome> {
  const found = await codepipelineState(input)
  if (!found.ok) return found
  const stage = failedStageOf(found.state)
  if (stage === null || safeToken(stage) === null) {
    return { ok: false, error: 'cicd.retry.noFailedStage' }
  }
  return gatedRun({
    ...input,
    args: [
      'codepipeline',
      'retry-stage-execution',
      '--pipeline-name',
      input.pipelineName,
      '--stage-name',
      stage,
      '--pipeline-execution-id',
      input.executionId,
      '--retry-mode',
      'FAILED_ACTIONS',
    ],
  })
}

async function codepipelineApprove(
  input: AwsCicdBase & {
    pipelineName: string
    /** `stage:action` — hai nửa đều qua `safeToken` trước khi thành argv. */
    approvalId: string
    approve: boolean
    summary: string
  },
): Promise<AwsActionOutcome> {
  const cut = input.approvalId.indexOf(':')
  if (cut <= 0) return BAD_REF
  const stageName = safeToken(input.approvalId.slice(0, cut))
  const actionName = safeToken(input.approvalId.slice(cut + 1))
  if (stageName === null || actionName === null) return BAD_REF

  const found = await codepipelineState(input)
  if (!found.ok) return found
  const action = (found.state.stageStates ?? []).find((s) => s.stageName === stageName)
  const token = (action?.actionStates ?? []).find(
    (a) => a.actionName === actionName,
  )?.latestExecution?.token
  if (!token) return { ok: false, error: 'cicd.approval.gone' }

  // Thân JSON luôn bắt đầu bằng `{` nên không thể bị đọc thành cờ; lời nhắn của
  // người dùng được `JSON.stringify` bọc lại nên dấu ngoặc/ký tự lạ không thoát ra.
  const result = JSON.stringify({
    summary: input.summary.slice(0, 500) || 'AWOG',
    status: input.approve ? 'Approved' : 'Rejected',
  })
  return gatedRun({
    ...input,
    args: [
      'codepipeline',
      'put-approval-result',
      '--pipeline-name',
      input.pipelineName,
      '--stage-name',
      stageName,
      '--action-name',
      actionName,
      '--result',
      result,
      '--token',
      token,
    ],
  })
}

export type AwsActionInput = AwsCicdBase & {
  kind: CicdActionKind
  ref: Readonly<Record<string, string>>
  /** `approve`: lời nhắn kèm quyết định. */
  summary?: string | undefined
  approve?: boolean | undefined
}

/**
 * Một hành động của nguồn AWS. `ref` là con trỏ của dòng (đã kiểm ở RPC); ở đây
 * kiểm LẠI từng giá trị bằng `safeToken` — argv không bao giờ được ghép từ chuỗi
 * chưa kiểm, kể cả khi lớp trên đã kiểm.
 */
export async function awsRunAction(input: AwsActionInput): Promise<AwsActionOutcome> {
  const pipelineName = tok(input.ref['pipelineName'])
  const executionId = tok(input.ref['executionId'])
  const buildId = tok(input.ref['buildId'])
  const projectName = tok(input.ref['projectName'])
  const appId = tok(input.ref['appId'])
  const branchName = tok(input.ref['branchName'])
  const jobId = tok(input.ref['jobId'])

  switch (input.kind) {
    case 'rerun': {
      if (pipelineName !== null) {
        if (executionId === null) return BAD_REF
        return codepipelineRerun({ ...input, pipelineName, executionId })
      }
      if (buildId !== null) {
        return gatedRun({ ...input, args: ['codebuild', 'retry-build', '--id', buildId] })
      }
      if (appId !== null && branchName !== null) {
        return gatedRun({
          ...input,
          args: [
            'amplify',
            'start-job',
            '--app-id',
            appId,
            '--branch-name',
            branchName,
            '--job-type',
            'RELEASE',
          ],
        })
      }
      return BAD_REF
    }

    case 'cancel': {
      if (pipelineName !== null) {
        if (executionId === null) return BAD_REF
        return gatedRun({
          ...input,
          args: [
            'codepipeline',
            'stop-pipeline-execution',
            '--pipeline-name',
            pipelineName,
            '--pipeline-execution-id',
            executionId,
          ],
        })
      }
      if (buildId !== null) {
        return gatedRun({ ...input, args: ['codebuild', 'stop-build', '--id', buildId] })
      }
      if (appId !== null && branchName !== null && jobId !== null) {
        return gatedRun({
          ...input,
          args: [
            'amplify',
            'stop-job',
            '--app-id',
            appId,
            '--branch-name',
            branchName,
            '--job-id',
            jobId,
          ],
        })
      }
      return BAD_REF
    }

    case 'dispatch': {
      if (pipelineName !== null) {
        return gatedRun({
          ...input,
          args: ['codepipeline', 'start-pipeline-execution', '--name', pipelineName],
        })
      }
      if (projectName !== null) {
        return gatedRun({
          ...input,
          args: ['codebuild', 'start-build', '--project-name', projectName],
        })
      }
      if (appId !== null && branchName !== null) {
        return gatedRun({
          ...input,
          args: [
            'amplify',
            'start-job',
            '--app-id',
            appId,
            '--branch-name',
            branchName,
            '--job-type',
            'RELEASE',
          ],
        })
      }
      return BAD_REF
    }

    case 'approve': {
      if (pipelineName === null) return BAD_REF
      return codepipelineApprove({
        ...input,
        pipelineName,
        approvalId: input.ref['approvalId'] ?? '',
        approve: input.approve !== false,
        summary: input.summary ?? '',
      })
    }
  }
}
