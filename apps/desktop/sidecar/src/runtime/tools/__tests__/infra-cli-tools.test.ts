// Ba tool CLI hạ tầng (`aws_cli` · `kubectl_cli` · `tf_cli`) đi qua CÙNG một lõi
// quyết định — P1/P2 (ADR 0088 §4, §5).
//
// Đây là chỗ kiểm hai chiều không đối xứng của luật:
//   · không ghim context ⇒ tool không được advertise (kiểm ở bảng tool, không ở đây);
//   · lớp `read` chạy thẳng, lớp `ask` TRÊN BỀ MẶT KHÔNG CÓ CỔNG phải từ chối thay
//     vì chạy rồi ghi nhật ký `approved` (audit #1 F4);
//   · lớp `destructive` bị ma trận chặn ở production — và với kubectl/terraform thì
//     MỌI lệnh đều ở cột production (không có account id để so).
//
// `runInfra` bị mock: không ca nào spawn tiến trình thật.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runInfra, loadInfraPolicy } = vi.hoisted(() => ({
  runInfra: vi.fn(),
  loadInfraPolicy: vi.fn(),
}))

vi.mock('../../../infra/run.js', () => ({ runInfra }))
vi.mock('../../../infra/policy-store.js', () => ({ loadInfraPolicy }))

import { DEFAULT_MATRIX } from '../../../infra/policy.js'
import { runAwsCli, runKubectlCli, runTfCli } from '../infra-tools.js'

const OK = {
  ok: true,
  exitCode: 0,
  stdout: 'NAME  READY\napi-0  1/1',
  stderr: '',
  durationMs: 5,
  truncated: false,
  class: 'read' as const,
}

beforeEach(() => {
  runInfra.mockReset()
  runInfra.mockResolvedValue(OK)
  loadInfraPolicy.mockReset()
  loadInfraPolicy.mockResolvedValue({ matrix: DEFAULT_MATRIX, prodAccountIds: [] })
})

describe('kubectl_cli', () => {
  it('runs a read verb through runInfra with the pinned context', async () => {
    const res = await runKubectlCli(['get', 'pods'], {
      context: { cluster: 'prod-eks', namespace: 'api' },
      gated: true,
    })
    expect(res.ok).toBe(true)
    expect(runInfra).toHaveBeenCalledTimes(1)
    expect(runInfra.mock.calls[0][0]).toMatchObject({
      tool: 'kubectl',
      args: ['get', 'pods'],
      context: { cluster: 'prod-eks', namespace: 'api' },
      toolName: 'kubectl_cli',
    })
  })

  it('blocks delete/drain outright (no account id ⇒ production)', async () => {
    const res = await runKubectlCli(['delete', 'pod', 'api-0'], {
      context: { cluster: 'prod-eks' },
      gated: true,
    })
    expect(res.ok).toBe(false)
    expect(res.text).toContain('Blocked by the infrastructure permission matrix')
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('refuses an `ask` verb when the surface has no approval gate', async () => {
    const res = await runKubectlCli(['apply', '-f', 'deploy.yaml'], {
      context: { cluster: 'prod-eks' },
    })
    expect(res.ok).toBe(false)
    expect(res.text).toContain('needs a human to approve')
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('lets `kubectl logs` run only through an approval gate (content is sensitive)', async () => {
    const ungated = await runKubectlCli(['logs', 'api-0'], {
      context: { cluster: 'prod-eks' },
    })
    expect(ungated.ok).toBe(false)
    expect(runInfra).not.toHaveBeenCalled()

    const gated = await runKubectlCli(['logs', 'api-0'], {
      context: { cluster: 'prod-eks' },
      gated: true,
    })
    expect(gated.ok).toBe(true)
    expect(runInfra).toHaveBeenCalledTimes(1)
  })

  it('answers an empty argv with a hint instead of spawning kubectl', async () => {
    const res = await runKubectlCli([], { context: { cluster: 'c' } })
    expect(res.ok).toBe(false)
    expect(res.text).toContain('Pass at least one argument')
    expect(runInfra).not.toHaveBeenCalled()
  })
})

describe('tf_cli', () => {
  it('runs a read verb in the pinned directory', async () => {
    const res = await runTfCli(['state', 'list'], {
      context: { workspace: '/repo/infra/prod' },
      gated: true,
    })
    expect(res.ok).toBe(true)
    expect(runInfra.mock.calls[0][0]).toMatchObject({
      tool: 'terraform',
      args: ['state', 'list'],
      context: { workspace: '/repo/infra/prod' },
      toolName: 'tf_cli',
    })
  })

  it('blocks `apply` at the default matrix', async () => {
    const res = await runTfCli(['apply'], {
      context: { workspace: '/repo/infra/prod' },
      gated: true,
    })
    expect(res.ok).toBe(false)
    expect(res.text).toContain('Blocked by the infrastructure permission matrix')
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('refuses `terraform fmt` (it rewrites .tf files) without a gate', async () => {
    const res = await runTfCli(['fmt'], { context: { workspace: '/repo/infra/prod' } })
    expect(res.ok).toBe(false)
    expect(res.text).toContain('needs a human to approve')
    expect(runInfra).not.toHaveBeenCalled()
  })
})

describe('aws_cli vẫn nguyên luật cũ sau khi gom về lõi chung', () => {
  it('passes the pinned account through and keeps the aws tool name', async () => {
    const res = await runAwsCli(['s3api', 'list-buckets'], {
      context: { profile: 'dev', accountId: '111122223333' },
      gated: true,
    })
    expect(res.ok).toBe(true)
    expect(runInfra.mock.calls[0][0]).toMatchObject({
      tool: 'aws',
      toolName: 'aws_cli',
      context: { profile: 'dev' },
    })
  })

  it('rejects an empty argv with the AWS hint', async () => {
    const res = await runAwsCli([], { context: { profile: 'dev' } })
    expect(res.text).toContain('list-buckets')
    expect(runInfra).not.toHaveBeenCalled()
  })
})
