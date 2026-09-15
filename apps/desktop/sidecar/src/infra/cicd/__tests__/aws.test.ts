// Nguồn AWS của màn Triển khai (Mốc 4, task 4.6).
//
// Bốn thứ được khoá ở đây, và cả bốn đều là loại lỗi im lặng:
//   · ánh xạ JSON của ba API AWS → `CicdRun` (sai thì bảng nói sai về trạng thái),
//   · cắt bớt phải NÓI RA (`note`), không được im lặng coi trang đầu là tất cả,
//   · một nguồn hỏng không được làm trắng ba nguồn kia,
//   · argv của hành động GHI không bao giờ được ghép từ chuỗi chưa kiểm.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGated } = vi.hoisted(() => ({ runGated: vi.fn() }))
vi.mock('../../gated.js', () => ({ runGated }))

import {
  amplifyRunDetail,
  awsRunAction,
  codebuildRunDetail,
  listAmplifyRuns,
  listCodebuildRuns,
  listPipelineRuns,
  pipelineRunDetail,
  safeToken,
} from '../aws.js'
import { pipelineStatus } from '../types.js'

const ctx = { profile: 'dev', region: 'ap-northeast-1', accountId: '111122223333' }
const base = { context: ctx, surface: 'pipeline' as const }

/** `runGated` chạy được: stdout là JSON của AWS. */
function ran(stdout: unknown): void {
  runGated.mockResolvedValueOnce({
    blocked: false,
    command: 'aws …',
    class: 'read',
    accountKind: 'normal',
    decision: 'auto',
    result: {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify(stdout),
      stderr: '',
      durationMs: 5,
      truncated: false,
      class: 'read',
    },
  })
}

/** `runGated` trả lệnh hỏng (thiếu quyền, sai region…). */
function failed(stderr: string): void {
  runGated.mockResolvedValueOnce({
    blocked: false,
    command: 'aws …',
    class: 'read',
    accountKind: 'normal',
    decision: 'auto',
    result: {
      ok: false,
      exitCode: 254,
      stdout: '',
      stderr,
      durationMs: 5,
      truncated: false,
      class: 'read',
    },
  })
}

/** `runGated` bị cổng quyền chặn và phát vé. */
function blocked(): void {
  runGated.mockResolvedValueOnce({
    blocked: true,
    requiresApproval: true,
    approvalTicket: 'ticket-1',
    command: 'aws codebuild batch-get-builds …',
    class: 'read',
    accountKind: 'production',
    mode: 'ask',
    reason: 'needs approval',
  })
}

beforeEach(() => {
  runGated.mockReset()
})

describe('listPipelineRuns', () => {
  it('mỗi pipeline một dòng, lấy execution mới nhất + commit từ sourceRevisions', async () => {
    ran({ pipelines: [{ name: 'shop-api' }, { name: 'infra' }] })
    ran({
      pipelineExecutionSummaries: [
        {
          pipelineExecutionId: 'exec-1',
          status: 'Failed',
          startTime: '2026-09-14T00:00:00Z',
          lastUpdateTime: '2026-09-14T00:04:12Z',
          sourceRevisions: [
            {
              revisionId: 'a3f91c0deadbeef',
              revisionUrl: 'https://github.com/acme/shop-api/commit/a3f91c0',
            },
          ],
        },
      ],
    })
    ran({ pipelineExecutionSummaries: [] })

    const result = await listPipelineRuns({ ...base, limit: 10 })

    expect(result.source).toBe('codepipeline')
    expect(result.error).toBeNull()
    expect(result.blocked).toBeNull()
    // Pipeline thứ hai chưa có execution nào ⇒ không có dòng nào cho nó.
    expect(result.runs).toHaveLength(1)
    const first = result.runs[0]
    expect(first?.id).toBe('codepipeline:shop-api:exec-1')
    expect(first?.project).toBe('shop-api')
    expect(first?.status).toBe('failed')
    expect(first?.commit).toBe('a3f91c0')
    expect(first?.durationMs).toBe(252_000)
    expect(first?.ref).toEqual({ pipelineName: 'shop-api', executionId: 'exec-1' })
  })

  it('cắt bớt thì `note` phải nói ra (không coi trang đầu là tất cả)', async () => {
    ran({ pipelines: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })
    ran({ pipelineExecutionSummaries: [] })

    const result = await listPipelineRuns({ ...base, limit: 1 })
    expect(result.note).toBe('cicd.note.pipelinesTruncated|1|3')
  })

  it('lệnh đầu hỏng ⇒ nguồn có `error`, không có dòng nào (không giả vờ rỗng)', async () => {
    failed('An error occurred (AccessDeniedException)')
    const result = await listPipelineRuns({ ...base, limit: 10 })
    expect(result.runs).toHaveLength(0)
    expect(result.error).toContain('AccessDeniedException')
  })

  it('một pipeline phụ hỏng thì các pipeline khác vẫn lên bảng', async () => {
    ran({ pipelines: [{ name: 'ok' }, { name: 'denied' }] })
    ran({ pipelineExecutionSummaries: [{ pipelineExecutionId: 'e1', status: 'Succeeded' }] })
    failed('AccessDeniedException')

    const result = await listPipelineRuns({ ...base, limit: 10 })
    expect(result.runs.map((r) => r.project)).toEqual(['ok'])
    expect(result.error).toBeNull()
  })

  it('cổng quyền chặn giữa đường ⇒ cả nguồn là `blocked` + vé (không nửa vời)', async () => {
    ran({ pipelines: [{ name: 'a' }, { name: 'b' }] })
    blocked()

    const result = await listPipelineRuns({ ...base, limit: 10 })
    expect(result.runs).toHaveLength(0)
    expect(result.blocked?.approvalTicket).toBe('ticket-1')
    expect(result.blocked?.accountKind).toBe('production')
  })
})

describe('pipelineRunDetail', () => {
  it('bước = stage/action, stage hỏng được nêu tên, chờ duyệt có `token`', async () => {
    ran({
      stageStates: [
        {
          stageName: 'Build',
          actionStates: [
            { actionName: 'Compile', latestExecution: { status: 'Succeeded' } },
            { actionName: 'Test', latestExecution: { status: 'Failed' } },
          ],
        },
        {
          stageName: 'Deploy production',
          actionStates: [
            {
              actionName: 'Approve',
              latestExecution: { status: 'InProgress', token: 'tok-1' },
            },
          ],
        },
      ],
    })

    const res = await pipelineRunDetail({
      ...base,
      pipelineName: 'infra',
      executionId: 'exec-1',
      key: 'infra',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.detail.steps.map((s) => s.name)).toEqual(['Compile', 'Test', 'Approve'])
    expect(res.detail.steps[1]?.status).toBe('failed')
    expect(res.detail.run.stepName).toBe('Build')
    expect(res.detail.run.needsApproval).toBe(true)
    expect(res.detail.approvals).toEqual([{ id: 'Deploy production:Approve', label: 'Deploy production' }])
    // Token duyệt KHÔNG được đi ra UI: hàm duyệt tự đọc lại state.
    expect(JSON.stringify(res.detail)).not.toContain('tok-1')
  })

  it('chưa lấy được `token` thì InProgress không phải "đang chờ duyệt"', async () => {
    ran({
      stageStates: [
        { stageName: 'Build', actionStates: [{ actionName: 'Compile', latestExecution: { status: 'InProgress' } }] },
      ],
    })
    const res = await pipelineRunDetail({ ...base, pipelineName: 'x', executionId: 'e', key: 'x' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.detail.approvals).toEqual([])
    expect(res.detail.steps[0]?.status).toBe('running')
  })
})

describe('listCodebuildRuns', () => {
  it('gom id build của các project rồi hỏi chi tiết MỘT lô', async () => {
    ran({ projects: ['shop-api'] })
    ran({ ids: ['arn:aws:codebuild:ap-northeast-1:1:build/shop-api:abc'] })
    ran({
      builds: [
        {
          id: 'arn:aws:codebuild:ap-northeast-1:1:build/shop-api:abc',
          projectName: 'shop-api',
          buildNumber: 12,
          buildStatus: 'FAILED',
          startTime: '2026-09-14T00:00:00Z',
          endTime: '2026-09-14T00:01:00Z',
          phases: [{ phaseType: 'BUILD', phaseStatus: 'FAILED' }],
        },
      ],
    })

    const result = await listCodebuildRuns({ ...base, limit: 5 })
    expect(result.source).toBe('codebuild')
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]?.title).toBe('shop-api #12')
    expect(result.runs[0]?.status).toBe('failed')
    // "hỏng ở bước nào" do sidecar suy, không để UI tự đoán từ log.
    expect(result.runs[0]?.stepName).toBe('BUILD')
    // Bước hỏng KHÔNG đi vào `ref` (ref là con trỏ mở chi tiết, không phải trạng thái).
    expect(result.runs[0]?.ref).toEqual({
      buildId: 'arn:aws:codebuild:ap-northeast-1:1:build/shop-api:abc',
      projectName: 'shop-api',
    })
  })
})

describe('codebuildRunDetail — chỉ TÊN biến môi trường', () => {
  it('giá trị của biến PLAINTEXT không xuất hiện ở bất kỳ trường nào', async () => {
    ran({
      builds: [
        {
          id: 'arn:aws:codebuild:ap-northeast-1:1:build/shop-api:abc',
          projectName: 'shop-api',
          buildStatus: 'SUCCEEDED',
          logs: { groupName: '/aws/codebuild/shop-api', streamName: 'abc' },
          environment: {
            environmentVariables: [
              { name: 'DATABASE_URL', value: 'postgres://user:SUPER-SECRET@host/db', type: 'PLAINTEXT' },
            ],
          },
          phases: [{ phaseType: 'BUILD', phaseStatus: 'SUCCEEDED' }],
        },
      ],
    })

    const res = await codebuildRunDetail({ ...base, buildId: 'x', key: 'shop-api' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.detail.envNames).toEqual(['DATABASE_URL (codebuild)'])
    expect(JSON.stringify(res.detail)).not.toContain('SUPER-SECRET')
    // Bước mang `logRef` để UI gieo sang tab Logs đã có, không dựng viewer thứ hai.
    expect(res.detail.steps[0]?.logRef).toEqual({
      group: '/aws/codebuild/shop-api',
      stream: 'abc',
    })
  })
})

describe('listAmplifyRuns / amplifyRunDetail', () => {
  it('mỗi app đọc MỘT nhánh (ưu tiên main), job mới nhất thành một dòng', async () => {
    ran({ apps: [{ appId: 'd1', name: 'shop-web' }] })
    ran({ branches: [{ branchName: 'dev' }, { branchName: 'main' }] })
    ran({
      jobSummaries: [
        { jobId: '9', jobType: 'RELEASE', status: 'SUCCEED', startTime: '2026-09-14T00:00:00Z', endTime: '2026-09-14T00:02:00Z' },
      ],
    })

    const result = await listAmplifyRuns({ ...base, limit: 5 })
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]?.branch).toBe('main')
    expect(result.runs[0]?.title).toBe('shop-web · main')
  })

  it('chi tiết trả bước + link log của từng bước', async () => {
    ran({
      job: {
        summary: { jobId: '9', status: 'FAILED', startTime: '2026-09-14T00:00:00Z' },
        steps: [{ stepName: 'Build', status: 'FAILED', logUrl: 'https://console.aws.amazon.com/x' }],
      },
    })
    const res = await amplifyRunDetail({ ...base, appId: 'd1', branchName: 'main', jobId: '9', key: 'shop-web' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.detail.steps[0]?.logUrl).toBe('https://console.aws.amazon.com/x')
    expect(res.detail.steps[0]?.status).toBe('failed')
  })
})

describe('safeToken — giá trị đi vào argv', () => {
  it('từ chối chuỗi rỗng, chuỗi bắt đầu bằng `-`, và ký tự điều khiển', () => {
    expect(safeToken('shop-api')).toBe('shop-api')
    expect(safeToken('arn:aws:codebuild:ap-northeast-1:1:build/x:y')).not.toBeNull()
    // Khoảng trắng ĐƯỢC PHÉP: argv là mảng, một giá trị có dấu cách vẫn là MỘT
    // đối số — cấm nó chỉ làm hỏng tên stage hợp lệ của CodePipeline.
    expect(safeToken('Deploy production')).toBe('Deploy production')
    expect(safeToken('')).toBeNull()
    expect(safeToken('--profile')).toBeNull()
    expect(safeToken('-x')).toBeNull()
    expect(safeToken(' leading')).toBeNull()
    expect(safeToken('a\nb')).toBeNull()
  })
})

describe('awsRunAction — argv của lệnh GHI', () => {
  /** argv của lời gọi CUỐI (lượt chạy lại có một lời gọi ĐỌC trước nó). */
  function wrote(): string[] {
    const calls = runGated.mock.calls
    return calls[calls.length - 1]?.[0]?.args as string[]
  }
  beforeEach(() => {
    runGated.mockResolvedValue({
      blocked: false,
      command: 'aws …',
      class: 'write',
      accountKind: 'normal',
      decision: 'approved',
      result: { ok: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, truncated: false, class: 'write' },
    })
  })

  it('CodeBuild: huỷ dùng `stop-build --id`, chạy lại dùng `retry-build --id`', async () => {
    await awsRunAction({ ...base, kind: 'cancel', ref: { buildId: 'arn:aws:codebuild:r:1:build/p:1' } })
    expect(wrote()).toEqual(['codebuild', 'stop-build', '--id', 'arn:aws:codebuild:r:1:build/p:1'])

    runGated.mockClear()
    await awsRunAction({ ...base, kind: 'rerun', ref: { buildId: 'arn:aws:codebuild:r:1:build/p:1' } })
    expect(wrote()).toEqual(['codebuild', 'retry-build', '--id', 'arn:aws:codebuild:r:1:build/p:1'])
  })

  it('CodePipeline: huỷ theo execution id; chạy lại TỰ TÌM stage hỏng', async () => {
    await awsRunAction({
      ...base,
      kind: 'cancel',
      ref: { pipelineName: 'infra', executionId: 'exec-1' },
    })
    expect(wrote()).toEqual([
      'codepipeline',
      'stop-pipeline-execution',
      '--pipeline-name',
      'infra',
      '--pipeline-execution-id',
      'exec-1',
    ])

    runGated.mockClear()
    // 1) đọc state để tìm stage hỏng, 2) retry đúng stage đó.
    ran({ stageStates: [{ stageName: 'Build', actionStates: [{ actionName: 'x', latestExecution: { status: 'Failed' } }] }] })
    await awsRunAction({
      ...base,
      kind: 'rerun',
      ref: { pipelineName: 'infra', executionId: 'exec-1' },
    })
    expect(wrote()).toEqual([
      'codepipeline',
      'retry-stage-execution',
      '--pipeline-name',
      'infra',
      '--stage-name',
      'Build',
      '--pipeline-execution-id',
      'exec-1',
      '--retry-mode',
      'FAILED_ACTIONS',
    ])
  })

  it('không có stage nào hỏng ⇒ từ chối, không chạy lệnh mơ hồ', async () => {
    ran({ stageStates: [{ stageName: 'Build', actionStates: [{ actionName: 'x', latestExecution: { status: 'Succeeded' } }] }] })
    const res = await awsRunAction({
      ...base,
      kind: 'rerun',
      ref: { pipelineName: 'infra', executionId: 'exec-1' },
    })
    expect(res).toEqual({ ok: false, error: 'cicd.retry.noFailedStage' })
  })

  it('Amplify: kích hoạt = `start-job --job-type RELEASE`', async () => {
    await awsRunAction({ ...base, kind: 'dispatch', ref: { appId: 'd1', branchName: 'main' } })
    expect(wrote()).toEqual([
      'amplify',
      'start-job',
      '--app-id',
      'd1',
      '--branch-name',
      'main',
      '--job-type',
      'RELEASE',
    ])
  })

  it('duyệt: tự đọc `token` rồi gửi kết quả — token không đến từ UI', async () => {
    ran({
      stageStates: [
        {
          stageName: 'Deploy production',
          actionStates: [{ actionName: 'Approve', latestExecution: { status: 'InProgress', token: 'tok-9' } }],
        },
      ],
    })
    await awsRunAction({
      ...base,
      kind: 'approve',
      ref: { pipelineName: 'infra', approvalId: 'Deploy production:Approve' },
      approve: true,
      summary: 'Ship it',
    })
    const args = wrote()
    expect(args.slice(0, 7)).toEqual([
      'codepipeline',
      'put-approval-result',
      '--pipeline-name',
      'infra',
      '--stage-name',
      'Deploy production',
      '--action-name',
    ])
    expect(args).toContain('tok-9')
    expect(JSON.parse(args[args.indexOf('--result') + 1] as string)).toEqual({
      summary: 'Ship it',
      status: 'Approved',
    })
  })

  it('token đã biến mất (người khác duyệt rồi) ⇒ từ chối', async () => {
    ran({ stageStates: [{ stageName: 'Deploy production', actionStates: [{ actionName: 'Approve', latestExecution: { status: 'Succeeded' } }] }] })
    const res = await awsRunAction({
      ...base,
      kind: 'approve',
      ref: { pipelineName: 'infra', approvalId: 'Deploy production:Approve' },
      approve: true,
    })
    expect(res).toEqual({ ok: false, error: 'cicd.approval.gone' })
  })

  it('`ref` méo (thiếu id, tên bắt đầu bằng `-`) ⇒ từ chối TRƯỚC khi spawn', async () => {
    expect(await awsRunAction({ ...base, kind: 'cancel', ref: {} })).toEqual({
      ok: false,
      error: 'cicd.action.badRef',
    })
    expect(
      await awsRunAction({ ...base, kind: 'cancel', ref: { buildId: '-x' } }),
    ).toEqual({ ok: false, error: 'cicd.action.badRef' })
    expect(runGated).not.toHaveBeenCalled()
  })

  it('cổng quyền chặn lệnh ghi ⇒ trả `gate` để UI mở hộp duyệt', async () => {
    runGated.mockReset()
    blocked()
    const res = await awsRunAction({
      ...base,
      kind: 'cancel',
      ref: { buildId: 'arn:aws:codebuild:r:1:build/p:1' },
    })
    expect(res.ok).toBe(false)
    if (res.ok || !('gate' in res)) throw new Error('expected gate')
    expect(res.gate.requiresApproval).toBe(true)
    expect(res.gate.approvalTicket).toBe('ticket-1')
  })
})

describe('thang trạng thái dùng chung vẫn khớp ở tầng nguồn', () => {
  it('CodePipeline `Superseded` là huỷ, không phải hỏng', () => {
    expect(pipelineStatus('Superseded')).toBe('cancelled')
  })
})
