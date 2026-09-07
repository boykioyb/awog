// Tests cho phần THUẦN của subagent nhánh Pi (ADR 0083): resolve model tier,
// cắt lịch sử cho fork, và vòng đời của sổ đăng ký subagent.
//
// Run với vitest: `npx vitest run src/runtime/__tests__/subagents.test.ts`
// (vitest chưa nằm trong devDeps của sidecar — xem git/__tests__/discover.test.ts).
import { describe, expect, it } from 'vitest'
import {
  isSubagentModelTier,
  resolveSubagentModel,
  SUBAGENT_MODEL_TIERS,
} from '../subagents/model-tier.js'
import { trimForkHistory } from '../subagents/fork-history.js'
import { SubagentRegistry } from '../subagents/registry.js'
import type { SessionMessage } from '../../types/shared.js'

function msg(id: string, text: string): SessionMessage {
  return { id, role: 'user', text, at: new Date().toISOString() }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('resolveSubagentModel', () => {
  it('nhận đúng 5 tier, không nhận model id tự do', () => {
    for (const tier of SUBAGENT_MODEL_TIERS) expect(isSubagentModelTier(tier)).toBe(true)
    expect(isSubagentModelTier('claude-opus-5')).toBe(false)
    expect(isSubagentModelTier('gpt-5.5')).toBe(false)
    expect(isSubagentModelTier('')).toBe(false)
  })

  it('inherit giữ nguyên model thừa kế', () => {
    const r = resolveSubagentModel('inherit', 'claude-sonnet-5', 'anthropic', {})
    expect(r.modelId).toBe('claude-sonnet-5')
    expect(r.note).toBeUndefined()
  })

  it('anthropic built-in: tier map sang model id thật trong catalog', () => {
    expect(resolveSubagentModel('haiku', 'claude-sonnet-5', 'anthropic', {}).modelId).toBe(
      'claude-haiku-4-5',
    )
    expect(resolveSubagentModel('opus', 'claude-sonnet-5', 'anthropic', {}).modelId).toBe(
      'claude-opus-5',
    )
    expect(resolveSubagentModel('fable', 'claude-sonnet-5', 'anthropic', {}).modelId).toBe(
      'claude-fable-5',
    )
  })

  it('provider khác: giữ model cha và nói rõ lý do, KHÔNG bịa id', () => {
    const r = resolveSubagentModel('opus', 'gpt-5.5', 'openai', {})
    expect(r.modelId).toBe('gpt-5.5')
    expect(r.note).toContain('openai')
  })

  it('custom endpoint: chỉ nhận tier khi chính account khai model khớp', () => {
    const account = { baseURL: 'https://llm.internal/v1', models: ['qwen3-72b', 'qwen3-haiku'] }
    expect(resolveSubagentModel('haiku', 'qwen3-72b', 'openai', account).modelId).toBe(
      'qwen3-haiku',
    )
    const miss = resolveSubagentModel('opus', 'qwen3-72b', 'openai', account)
    expect(miss.modelId).toBe('qwen3-72b')
    expect(miss.note).toContain('custom endpoint')
  })
})

describe('trimForkHistory', () => {
  it('giữ phần CUỐI trong ngân sách, đúng thứ tự', () => {
    const history = [msg('a', 'x'.repeat(40)), msg('b', 'y'.repeat(40)), msg('c', 'z'.repeat(40))]
    const kept = trimForkHistory(history, 100)
    expect(kept.map((m) => m.id)).toEqual(['b', 'c'])
  })

  it('luôn giữ ít nhất một message dù nó vượt trần', () => {
    const kept = trimForkHistory([msg('a', 'x'.repeat(500))], 10)
    expect(kept.map((m) => m.id)).toEqual(['a'])
  })

  it('lịch sử rỗng → rỗng', () => {
    expect(trimForkHistory([], 100)).toEqual([])
  })
})

describe('SubagentRegistry', () => {
  const makeRegistry = (): SubagentRegistry =>
    new SubagentRegistry({ maxBackground: 2, backgroundTimeoutMs: 0 })

  it('chạy nền: start trả về ngay, waitFor thu kết quả', async () => {
    const registry = makeRegistry()
    const snap = registry.start({
      label: 'reviewer',
      description: 'review the diff',
      name: 'rev',
      prompt: 'go',
      background: true,
      run: async () => {
        await sleep(10)
        return 'looks good'
      },
    })
    expect(snap.status).toBe('running')
    expect(registry.countRunningBackground()).toBe(1)

    const done = await registry.waitFor('rev', 1_000)
    expect(done?.status).toBe('done')
    expect(done?.text).toBe('looks good')
    expect(registry.countRunningBackground()).toBe(0)
  })

  it('waitFor hết giờ trả snapshot running, không huỷ subagent', async () => {
    const registry = makeRegistry()
    const snap = registry.start({
      label: 'slow',
      description: 'slow job',
      prompt: 'go',
      background: true,
      run: async () => {
        await sleep(60)
        return 'eventually'
      },
    })
    const pending = await registry.waitFor(snap.id, 5)
    expect(pending?.status).toBe('running')
    const settled = await registry.settle(snap.id)
    expect(settled?.status).toBe('done')
    expect(settled?.text).toBe('eventually')
  })

  it('lỗi của subagent nằm trong snapshot, không ném ra ngoài', async () => {
    const registry = makeRegistry()
    const snap = registry.start({
      label: 'boom',
      description: 'fails',
      prompt: 'go',
      background: false,
      run: async () => {
        throw new Error('provider exploded')
      },
    })
    const settled = await registry.settle(snap.id)
    expect(settled?.status).toBe('error')
    expect(settled?.error).toBe('provider exploded')
  })

  it('stop huỷ signal và đánh dấu stopped', async () => {
    const registry = makeRegistry()
    const snap = registry.start({
      label: 'long',
      description: 'long job',
      prompt: 'go',
      background: true,
      run: (_prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
    })
    expect(registry.stop(snap.id)).toBe(true)
    const settled = await registry.settle(snap.id)
    expect(settled?.status).toBe('stopped')
  })

  it('abortAll dừng mọi subagent còn chạy — hết lượt là hết subagent', async () => {
    const registry = makeRegistry()
    const forever = (_prompt: string, signal?: AbortSignal): Promise<string> =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    const a = registry.start({
      label: 'a',
      description: 'a',
      prompt: 'go',
      background: true,
      run: forever,
    })
    const b = registry.start({
      label: 'b',
      description: 'b',
      prompt: 'go',
      background: true,
      run: forever,
    })
    registry.abortAll()
    expect((await registry.settle(a.id))?.status).toBe('stopped')
    expect((await registry.settle(b.id))?.status).toBe('stopped')
    expect(registry.countRunningBackground()).toBe(0)
  })

  it('huỷ lượt cha kéo theo subagent nền', async () => {
    const registry = makeRegistry()
    const parent = new AbortController()
    const snap = registry.start({
      label: 'child',
      description: 'child',
      prompt: 'go',
      background: true,
      parentSignal: parent.signal,
      run: (_prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
    })
    parent.abort()
    const settled = await registry.settle(snap.id)
    expect(settled?.status).toBe('stopped')
    expect(settled?.error).toContain('cancelled')
  })

  it('trần đồng hồ treo dừng subagent nền bị bỏ quên', async () => {
    const registry = new SubagentRegistry({ maxBackground: 2, backgroundTimeoutMs: 15 })
    const snap = registry.start({
      label: 'runaway',
      description: 'never ends',
      prompt: 'go',
      background: true,
      run: (_prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
    })
    const settled = await registry.settle(snap.id)
    expect(settled?.status).toBe('stopped')
    expect(settled?.error).toContain('cap')
  })

  it('sendMessage nối vào ĐÚNG subagent cũ, và từ chối khi nó đang chạy', async () => {
    const registry = makeRegistry()
    const seen: string[] = []
    const snap = registry.start({
      label: 'writer',
      description: 'writes',
      name: 'w',
      prompt: 'first',
      background: true,
      run: async (prompt) => {
        seen.push(prompt)
        await sleep(10)
        return `answer:${prompt}`
      },
    })

    // Đang chạy ⇒ phải bảo model thu kết quả trước, không được chen lượt.
    const busy = await registry.sendMessage('w', 'second')
    expect(busy).toEqual({ ok: false, reason: 'running' })

    await registry.settle(snap.id)
    const follow = await registry.sendMessage('w', 'second')
    expect(follow.ok).toBe(true)
    if (follow.ok) expect(follow.snap.text).toBe('answer:second')
    // Cùng một runner ⇒ context của subagent được nối tiếp, không dựng lại.
    expect(seen).toEqual(['first', 'second'])
  })

  it('sendMessage tới subagent lạ / đã chết thì từ chối có lý do', async () => {
    const registry = makeRegistry()
    expect(await registry.sendMessage('nobody', 'hi')).toEqual({ ok: false, reason: 'unknown' })

    const snap = registry.start({
      label: 'dead',
      description: 'dead',
      prompt: 'go',
      background: false,
      run: async () => {
        throw new Error('nope')
      },
    })
    await registry.settle(snap.id)
    expect(await registry.sendMessage(snap.id, 'hi')).toEqual({ ok: false, reason: 'error' })
  })

  it('tra được theo cả id lẫn tên', async () => {
    const registry = makeRegistry()
    const snap = registry.start({
      label: 'named',
      description: 'named',
      name: 'Scout',
      prompt: 'go',
      background: false,
      run: async () => 'ok',
    })
    await registry.settle(snap.id)
    expect(registry.get('scout')?.id).toBe(snap.id)
    expect(registry.has(snap.id)).toBe(true)
    expect(registry.has('missing')).toBe(false)
  })
})
