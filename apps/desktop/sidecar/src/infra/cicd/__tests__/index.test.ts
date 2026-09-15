// Bộ gộp bốn nguồn (Mốc 4, task 4.2): "hỏng MỘT nguồn không được làm trắng cả
// bảng" là lời hứa của màn Triển khai, và nó chỉ đúng nếu chỗ gộp giữ được ba
// tính chất: cách ly lỗi, thứ tự nguồn ổn định, và vé duyệt đi đúng nguồn.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGh, runGated, loadProject, resolveProjectCwd } = vi.hoisted(() => ({
  runGh: vi.fn(),
  runGated: vi.fn(),
  loadProject: vi.fn(),
  resolveProjectCwd: vi.fn(),
}))

vi.mock('../../../github/runner.js', () => ({ runGh }))
vi.mock('../../gated.js', () => ({ runGated }))
vi.mock('../../../projects/store.js', () => ({ loadProject }))
vi.mock('../../../github/project-cwd.js', () => ({ resolveProjectCwd }))

import { listCicdRuns } from '../index.js'

const base = {
  limit: 10,
  context: { profile: 'dev', region: 'ap-northeast-1' },
  surface: 'pipeline' as const,
}

function awsOk(stdout: unknown): void {
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
      durationMs: 1,
      truncated: false,
      class: 'read',
    },
  })
}

beforeEach(() => {
  runGh.mockReset()
  runGated.mockReset()
  loadProject.mockReset()
  resolveProjectCwd.mockReset()
})

describe('listCicdRuns', () => {
  it('một dự án lỗi không làm mất nguồn AWS; lỗi được NÓI RA ở đúng nguồn', async () => {
    loadProject.mockResolvedValue(null)
    // CodePipeline: 1 lời gọi list + 1 lời gọi execution cho pipeline duy nhất.
    awsOk({ pipelines: [{ name: 'infra' }] })
    awsOk({ pipelineExecutionSummaries: [{ pipelineExecutionId: 'e1', status: 'Succeeded' }] })

    const results = await listCicdRuns({
      ...base,
      sources: ['github', 'codepipeline'],
      projects: [{ projectId: 'p1' }],
    })

    expect(results.map((r) => r.source)).toEqual(['github', 'codepipeline'])
    expect(results[0]?.runs).toEqual([])
    expect(results[0]?.error).toContain('project not found')
    expect(results[1]?.runs).toHaveLength(1)
    expect(results[1]?.error).toBeNull()
  })

  it('dự án GitHub đọc được ⇒ mỗi dòng mang nhãn dự án, sắp mới nhất trước', async () => {
    loadProject.mockResolvedValue({ id: 'p1', name: 'shop-api', path: '/tmp/shop-api' })
    resolveProjectCwd.mockResolvedValue('/tmp/shop-api')
    runGh.mockResolvedValueOnce(
      JSON.stringify([
        { databaseId: 1, name: 'a', status: 'completed', conclusion: 'success', startedAt: '2026-09-14T01:00:00Z' },
        { databaseId: 2, name: 'b', status: 'in_progress', startedAt: '2026-09-14T02:00:00Z' },
      ]),
    )

    const [gh] = await listCicdRuns({
      ...base,
      sources: ['github'],
      projects: [{ projectId: 'p1' }],
    })

    expect(gh?.runs.map((r) => r.id)).toEqual(['github:shop-api:2', 'github:shop-api:1'])
    expect(gh?.runs[0]?.project).toBe('shop-api')
  })

  it('nguồn không được xin thì không tốn lời gọi nào', async () => {
    loadProject.mockResolvedValue({ id: 'p1', name: 'x', path: '/tmp/x' })
    resolveProjectCwd.mockResolvedValue('/tmp/x')
    runGh.mockResolvedValueOnce('[]')

    const results = await listCicdRuns({ ...base, sources: ['github'], projects: [{ projectId: 'p1' }] })
    expect(results.map((r) => r.source)).toEqual(['github'])
    expect(runGated).not.toHaveBeenCalled()
  })

  it('vé duyệt đi ĐÚNG nguồn bị siết, không rò sang nguồn khác', async () => {
    runGated.mockResolvedValue({
      blocked: true,
      requiresApproval: true,
      approvalTicket: 't-codebuild',
      command: 'aws codebuild …',
      class: 'read',
      accountKind: 'production',
      mode: 'ask',
      reason: 'needs approval',
    })

    const results = await listCicdRuns({
      ...base,
      sources: ['codebuild'],
      projects: [],
      tickets: { codebuild: 't-codebuild' },
    })

    expect(results[0]?.blocked?.approvalTicket).toBe('t-codebuild')
    // Vé phải được CHUYỂN XUỐNG cổng, không nằm lại ở tầng gộp.
    expect(runGated.mock.calls[0]?.[0]?.approvalTicket).toBe('t-codebuild')
  })
})
