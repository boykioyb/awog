// `runGated()` — cổng dùng chung của MỌI bề mặt người dùng bấm nút.
//
// Trước file này, chuỗi quyết định (classify → decide → vé duyệt → spawn) chỉ nằm
// trong `methods/infra.run.ts` và không có test nào. Ba thứ phải khoá lại:
//   · `block` KHÔNG spawn (một lệnh bị chặn mà vẫn chạy là lỗi tệ nhất ở đây),
//   · `ask` đòi VÉ do sidecar phát, vé dùng MỘT lần,
//   · `auto` chạy thẳng và nhật ký ghi đúng lý do.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recordInfraAction, runInfra, loadInfraPolicy } = vi.hoisted(() => ({
  recordInfraAction: vi.fn().mockResolvedValue(undefined),
  runInfra: vi.fn(),
  loadInfraPolicy: vi.fn(),
}))

vi.mock('../audit/store.js', () => ({ recordInfraAction }))
vi.mock('../run.js', () => ({ runInfra }))
vi.mock('../policy-store.js', () => ({ loadInfraPolicy }))

import { DEFAULT_MATRIX } from '../policy.js'
import { runGated } from '../gated.js'

const policy = { matrix: DEFAULT_MATRIX, prodAccountIds: [] as readonly string[] }

const ran = {
  ok: true,
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  durationMs: 1,
  truncated: false,
  class: 'read' as const,
}

beforeEach(() => {
  recordInfraAction.mockClear()
  runInfra.mockReset()
  runInfra.mockResolvedValue(ran)
  loadInfraPolicy.mockReset()
  loadInfraPolicy.mockResolvedValue(policy)
})

const base = {
  context: { cluster: 'readonly-context' },
  surface: 'explorer' as const,
  toolName: 'kube_pods',
}

describe('runGated — lệnh phá huỷ (kubectl luôn thuộc cột production)', () => {
  it('KHÔNG spawn, không phát vé, và vẫn để lại nhật ký', async () => {
    const out = await runGated({
      ...base,
      tool: 'kubectl',
      args: ['delete', 'pod', 'app-0'],
    })
    expect(out.blocked).toBe(true)
    if (!out.blocked) throw new Error('unreachable')
    expect(out.requiresApproval).toBe(false)
    expect(out.approvalTicket).toBeUndefined()
    // Dòng nhật ký phân biệt "bị ma trận chặn" với "người dùng từ chối".
    expect(recordInfraAction).toHaveBeenCalledTimes(1)
    expect(recordInfraAction.mock.calls[0]?.[0]).toMatchObject({ decision: 'blocked' })
    expect(runInfra).not.toHaveBeenCalled()
  })
})

describe('runGated — lệnh ghi cần duyệt', () => {
  const restart = { ...base, tool: 'kubectl' as const, args: ['rollout', 'restart', 'deployment/api'] }

  it('lần đầu: trả requiresApproval + vé, KHÔNG spawn', async () => {
    const out = await runGated(restart)
    expect(out.blocked).toBe(true)
    if (!out.blocked) throw new Error('unreachable')
    expect(out.requiresApproval).toBe(true)
    expect(out.approvalTicket).toBeTruthy()
    expect(recordInfraAction.mock.calls[0]?.[0]).toMatchObject({ decision: 'denied' })
    expect(runInfra).not.toHaveBeenCalled()
  })

  it('gọi lại kèm vé ⇒ chạy, nhật ký là `approved`', async () => {
    const first = await runGated(restart)
    if (!first.blocked || !first.approvalTicket) throw new Error('expected a ticket')
    const out = await runGated({ ...restart, approvalTicket: first.approvalTicket })
    expect(out.blocked).toBe(false)
    if (out.blocked) throw new Error('unreachable')
    expect(out.decision).toBe('approved')
    expect(runInfra).toHaveBeenCalledTimes(1)
  })

  it('vé dùng MỘT lần: gọi lại lần nữa bằng vé cũ ⇒ lại bị hỏi', async () => {
    const first = await runGated(restart)
    if (!first.blocked || !first.approvalTicket) throw new Error('expected a ticket')
    await runGated({ ...restart, approvalTicket: first.approvalTicket })
    const again = await runGated({ ...restart, approvalTicket: first.approvalTicket })
    expect(again.blocked).toBe(true)
    expect(runInfra).toHaveBeenCalledTimes(1)
  })

  it('vé của lời gọi KHÁC không dùng được (vân tay khác)', async () => {
    const first = await runGated(restart)
    if (!first.blocked || !first.approvalTicket) throw new Error('expected a ticket')
    const other = await runGated({
      ...base,
      tool: 'kubectl',
      args: ['rollout', 'restart', 'deployment/other'],
      approvalTicket: first.approvalTicket,
    })
    expect(other.blocked).toBe(true)
    expect(runInfra).not.toHaveBeenCalled()
  })
})

describe('runGated — lệnh đọc chạy thẳng', () => {
  it('read ⇒ spawn, nhật ký để `runInfra` tự ghi (đúng một dòng)', async () => {
    const out = await runGated({ ...base, tool: 'kubectl', args: ['get', 'pods', '--no-headers'] })
    expect(out.blocked).toBe(false)
    if (out.blocked) throw new Error('unreachable')
    expect(out.decision).toBe('auto')
    expect(runInfra).toHaveBeenCalledTimes(1)
    // Cổng này KHÔNG tự ghi cho nhánh chạy — task 0.6 đòi ghi tại chỗ chạy.
    expect(recordInfraAction).not.toHaveBeenCalled()
  })
})
