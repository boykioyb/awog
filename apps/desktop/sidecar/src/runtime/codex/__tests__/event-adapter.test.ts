// Notification của Codex app-server → callback stream của AWOG (ADR 0087).
//
// Bốn bất biến file này khoá lại, mỗi cái đều là một cách hỏng ĐÃ thấy ở runtime khác:
//
//   1. Chữ chỉ cộng dồn từ DELTA. `item/completed` mang lại TOÀN BỘ message; cộng
//      thêm lần nữa là nhân đôi phần người dùng vừa đọc, và làm lệch `textOffset`
//      của mọi step (xem project_step_text_offset_invariant).
//   2. …nhưng một message KHÔNG có delta nào thì vẫn phải tới được người dùng,
//      nếu không lượt đó im lặng.
//   3. `error` có `willRetry` là server báo NÓ đang xử lý — kết thúc lượt ở đó là
//      cắt một lượt tự hồi phục được.
//   4. Daemon chết giữa lượt phải kết thúc lượt. ADR 0087 F8 ghi đây là chưa đo;
//      nếu không có nhánh này thì lượt treo mãi chờ `turn/completed` không bao giờ tới.
//
// Run: `npx vitest run src/runtime/codex/__tests__/event-adapter.test.ts`
import { describe, expect, it, vi } from 'vitest'
import type { SessionStep } from '../../../types/shared.js'
import { createCodexEventAdapter, type CodexTurnOutcome } from '../event-adapter.js'

function harness() {
  const chunks: string[] = []
  const steps: SessionStep[] = []
  const outcomes: CodexTurnOutcome[] = []
  const adapter = createCodexEventAdapter({
    onChunk: (d) => chunks.push(d),
    onStep: (s) => steps.push(s),
    onTurnEnd: (o) => outcomes.push(o),
  })
  return { adapter, chunks, steps, outcomes }
}

const usage = (last: Partial<Record<string, number>>) => ({
  tokenUsage: {
    total: {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    last: {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      ...last,
    },
    modelContextWindow: 400_000,
  },
})

describe('text accumulation', () => {
  it('streams deltas and does NOT re-append the completed message', () => {
    const { adapter, chunks } = harness()
    adapter.handle('item/agentMessage/delta', { itemId: 'm1', delta: 'Hello ' })
    adapter.handle('item/agentMessage/delta', { itemId: 'm1', delta: 'world' })
    adapter.handle('item/completed', {
      item: { type: 'agentMessage', id: 'm1', text: 'Hello world' },
    })
    expect(chunks.join('')).toBe('Hello world')
    expect(adapter.acc.text).toBe('Hello world')
  })

  it('delivers a completed message that never produced a delta', () => {
    const { adapter, chunks } = harness()
    adapter.handle('item/completed', {
      item: { type: 'agentMessage', id: 'm2', text: 'one shot' },
    })
    expect(chunks.join('')).toBe('one shot')
  })
})

describe('items → steps', () => {
  it('renders a Codex shell command as the same terminal step a Bash call makes', () => {
    const { adapter, steps } = harness()
    adapter.handle('item/started', {
      item: { type: 'commandExecution', id: 'c1', command: 'git status', status: 'inProgress' },
    })
    adapter.handle('item/completed', {
      item: {
        type: 'commandExecution',
        id: 'c1',
        command: 'git status',
        status: 'completed',
        aggregatedOutput: 'nothing to commit',
        exitCode: 0,
      },
    })
    expect(steps).toHaveLength(2)
    // Same id on both so the UI upserts one row running → done.
    expect(steps[0]?.id).toBe('c1')
    expect(steps[1]?.id).toBe('c1')
    expect(steps[0]?.status).toBe('running')
    expect(steps[1]?.status).toBe('done')
  })

  it('flags a non-zero exit as an error step', () => {
    const { adapter, steps } = harness()
    adapter.handle('item/completed', {
      item: {
        type: 'commandExecution',
        id: 'c2',
        command: 'false',
        status: 'completed',
        exitCode: 1,
      },
    })
    expect(steps[0]?.status).toBe('error')
  })

  it('restores the AWOG name of a bridged MCP tool before mapping the step', () => {
    const { adapter, steps } = harness()
    adapter.handle('item/started', {
      item: {
        type: 'dynamicToolCall',
        id: 'd1',
        tool: 'awogmcp__github__create_issue',
        namespace: null,
        arguments: {},
        status: 'inProgress',
      },
    })
    // The transcript labels MCP rows by the `mcp__` prefix, so the wire name
    // must not leak into it.
    expect(steps[0]?.label).not.toContain('awogmcp__')
  })

  it('grows one thinking row from reasoning deltas instead of one row per delta', () => {
    const { adapter, steps } = harness()
    adapter.handle('item/reasoning/summaryTextDelta', { itemId: 'r1', delta: 'Chec' })
    adapter.handle('item/reasoning/summaryTextDelta', { itemId: 'r1', delta: 'king' })
    expect(steps).toHaveLength(2)
    expect(steps[0]?.id).toBe('r1')
    expect(steps[1]?.id).toBe('r1')
    expect(steps[1]?.detail).toEqual({ kind: 'text', content: 'Checking' })
  })
})

describe('usage', () => {
  it('sums `last` across the turn and keeps first/newest prompt sizes', () => {
    const { adapter } = harness()
    adapter.handle('thread/tokenUsage/updated', usage({ inputTokens: 1000, outputTokens: 20 }))
    adapter.handle('thread/tokenUsage/updated', usage({ inputTokens: 1500, outputTokens: 30 }))
    // `total` on the payload is the THREAD's running total and would re-report
    // every earlier turn, so the turn total comes from summing `last`.
    expect(adapter.acc.inputTokens).toBe(2500)
    expect(adapter.acc.outputTokens).toBe(50)
    // Standing cost = first request; occupancy = newest.
    expect(adapter.acc.baseTokens).toBe(1000)
    expect(adapter.acc.contextTokens).toBe(1500)
  })
})

describe('turn end', () => {
  it('does not end the turn on a retryable error', () => {
    const { adapter, outcomes } = harness()
    adapter.handle('error', { error: { message: 'transient' }, willRetry: true })
    expect(outcomes).toEqual([])
  })

  it('ends the turn on a non-retryable error', () => {
    const { adapter, outcomes } = harness()
    adapter.handle('error', { error: { message: 'model refused' }, willRetry: false })
    expect(outcomes).toEqual([{ status: 'failed', errorMessage: 'model refused' }])
  })

  it('ends the turn when the daemon dies mid-turn', () => {
    const { adapter, outcomes } = harness()
    adapter.handle('awog/daemonExited', { message: 'codex app-server exited (code=1)' })
    expect(outcomes[0]?.status).toBe('failed')
    expect(outcomes[0]?.errorMessage).toContain('exited')
  })

  it('settles exactly once', () => {
    const { adapter, outcomes } = harness()
    adapter.handle('turn/completed', { turn: { id: 't1', status: 'completed' } })
    adapter.handle('turn/completed', { turn: { id: 't1', status: 'completed' } })
    adapter.handle('awog/daemonExited', { message: 'later' })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.status).toBe('completed')
  })

  it('carries a failed turn error through', () => {
    const { adapter, outcomes } = harness()
    adapter.handle('turn/completed', {
      turn: { id: 't2', status: 'failed', error: { message: 'context length exceeded' } },
    })
    expect(outcomes[0]).toEqual({ status: 'failed', errorMessage: 'context length exceeded' })
  })

  it('ignores notifications it has no mapping for', () => {
    const { adapter, steps, chunks } = harness()
    const spy = vi.fn()
    adapter.handle('thread/status/changed', { activeFlags: ['waitingOnApproval'] })
    adapter.handle('item/started', { item: { type: 'enteredReviewMode', id: 'x' } })
    expect(steps).toEqual([])
    expect(chunks).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})
