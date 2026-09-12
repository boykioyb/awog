// Bắc cầu tool AWOG sang `dynamicTools` của Codex (ADR 0087).
//
// Ba thứ ở đây đều là BẪY ĐÃ DÍNH THẬT, không phải phòng xa:
//
//   1. `mcp__` là tiền tố DÀNH RIÊNG của app-server. Gửi nguyên tên thì
//      `thread/start` hỏng NGUYÊN LƯỢT với "dynamic tool name is reserved" —
//      nghĩa là mọi phiên có Source/MCP đính kèm đều không mở được thread. Đo
//      trên codex-cli 0.154.0.
//   2. Content item trả về là `inputText`, KHÔNG phải `text`. Sai shape thì
//      server KHÔNG ném lỗi — nó đưa chuỗi "dynamic tool response was invalid"
//      cho model làm kết quả tool (ADR 0087 F1, spike mất một lượt vì đúng cái này).
//   3. Tên phải quay về dạng AWOG TRƯỚC khi qua cổng quyền: luật của người dùng,
//      nhãn transcript và phạm vi per-source đều viết theo `mcp__<id>__<tool>`.
//
// Run: `npx vitest run src/runtime/codex/__tests__/dynamic-tools.test.ts`
import { describe, expect, it } from 'vitest'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  createToolDispatch,
  fromCodexToolName,
  isCodexNativeTool,
  toCodexToolName,
  toDynamicToolSpecs,
  toolSetSignature,
} from '../dynamic-tools.js'

function tool(name: string, execute?: AgentTool['execute']): AgentTool {
  return {
    name,
    label: name,
    description: `${name} description`,
    parameters: { type: 'object', properties: { q: { type: 'string' } } } as never,
    execute:
      execute ??
      (async () => ({ content: [{ type: 'text' as const, text: `${name} ran` }], details: {} })),
  }
}

describe('toDynamicToolSpecs', () => {
  it('leaves the families Codex provides natively to Codex', () => {
    const specs = toDynamicToolSpecs([
      tool('Read'),
      tool('Write'),
      tool('Edit'),
      tool('MultiEdit'),
      tool('Bash'),
      tool('BashOutput'),
      tool('KillShell'),
      tool('Grep'),
      tool('Glob'),
      tool('wiki_search'),
    ])
    expect(specs.map((s) => s.name)).toEqual(['wiki_search'])
  })

  it('renames the reserved mcp__ prefix instead of dropping the tool', () => {
    const specs = toDynamicToolSpecs([tool('mcp__github__create_issue')])
    // Dropping it would silently cost the user their MCP tools; sending it
    // verbatim fails thread/start for the WHOLE session.
    expect(specs).toHaveLength(1)
    expect(specs[0]?.name).toBe('awogmcp__github__create_issue')
    expect(specs[0]?.name.startsWith('mcp__')).toBe(false)
  })

  it('round-trips a bridged name', () => {
    const original = 'mcp__srv__do_thing'
    expect(fromCodexToolName(toCodexToolName(original))).toBe(original)
    // A plain name is untouched in both directions.
    expect(toCodexToolName('wiki_search')).toBe('wiki_search')
    expect(fromCodexToolName('wiki_search')).toBe('wiki_search')
  })

  it('skips a name the protocol would reject rather than failing thread/start', () => {
    // A Source id comes from user input, so a tool name can carry anything.
    const specs = toDynamicToolSpecs([tool('mcp__my server!__x'), tool('wiki_read')])
    expect(specs.map((s) => s.name)).toEqual(['wiki_read'])
  })

  it('signs the tool SET so a changed set can be detected on resume', () => {
    const a = toolSetSignature(toDynamicToolSpecs([tool('wiki_read'), tool('memory_read')]))
    const b = toolSetSignature(toDynamicToolSpecs([tool('memory_read'), tool('wiki_read')]))
    const c = toolSetSignature(toDynamicToolSpecs([tool('wiki_read')]))
    // Order must not matter (the toolset is rebuilt per turn), content must.
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('knows which names are native', () => {
    expect(isCodexNativeTool('Bash')).toBe(true)
    expect(isCodexNativeTool('wiki_search')).toBe(false)
  })
})

describe('createToolDispatch', () => {
  const signal = new AbortController().signal

  it('returns inputText content items, not text ones', async () => {
    const dispatch = createToolDispatch({
      tools: [tool('wiki_search')],
      gate: async () => undefined,
      signal,
    })
    const res = await dispatch.call({ callId: 'c1', tool: 'wiki_search', arguments: { q: 'x' } })
    expect(res.success).toBe(true)
    expect(res.contentItems).toEqual([{ type: 'inputText', text: 'wiki_search ran' }])
  })

  it('resolves a bridged wire name back to the AWOG tool', async () => {
    const dispatch = createToolDispatch({
      tools: [tool('mcp__github__create_issue')],
      gate: async () => undefined,
      signal,
    })
    const res = await dispatch.call({
      callId: 'c2',
      tool: 'awogmcp__github__create_issue',
      arguments: {},
    })
    expect(res.success).toBe(true)
  })

  it('asks the gate under the ORIGINAL name', async () => {
    const seen: string[] = []
    const dispatch = createToolDispatch({
      tools: [tool('mcp__github__create_issue')],
      gate: async (ctx) => {
        seen.push(ctx.toolCall.name)
        return undefined
      },
      signal,
    })
    await dispatch.call({ callId: 'c3', tool: 'awogmcp__github__create_issue', arguments: {} })
    // A user rule reads `mcp__github__create_issue`; the wire name must never
    // reach the permission layer or every such rule silently stops matching.
    expect(seen).toEqual(['mcp__github__create_issue'])
  })

  it('turns a blocked call into a failed result carrying the reason', async () => {
    const dispatch = createToolDispatch({
      tools: [tool('wiki_write')],
      gate: async () => ({ block: true, reason: 'Denied by rule Write(*)' }),
      signal,
    })
    const res = await dispatch.call({ callId: 'c4', tool: 'wiki_write', arguments: {} })
    expect(res.success).toBe(false)
    expect(res.contentItems[0]).toEqual({
      type: 'inputText',
      text: 'Denied by rule Write(*)',
    })
  })

  it('reports an unknown tool instead of pretending it ran', async () => {
    // A resumed thread carries the tool set it was STARTED with, so it can ask
    // for something this turn no longer builds.
    const dispatch = createToolDispatch({ tools: [], gate: async () => undefined, signal })
    const res = await dispatch.call({ callId: 'c5', tool: 'ghost_tool', arguments: {} })
    expect(res.success).toBe(false)
    expect(String(res.contentItems[0]?.type)).toBe('inputText')
  })

  it('turns a thrown tool into a failed result, not a dead turn', async () => {
    const dispatch = createToolDispatch({
      tools: [
        tool('wiki_read', async () => {
          throw new Error('page not found')
        }),
      ],
      gate: async () => undefined,
      signal,
    })
    const res = await dispatch.call({ callId: 'c6', tool: 'wiki_read', arguments: {} })
    expect(res.success).toBe(false)
    expect(res.contentItems).toEqual([{ type: 'inputText', text: 'page not found' }])
  })

  it('never returns an empty content array', async () => {
    const dispatch = createToolDispatch({
      tools: [tool('quiet_tool', async () => ({ content: [], details: {} }))],
      gate: async () => undefined,
      signal,
    })
    const res = await dispatch.call({ callId: 'c7', tool: 'quiet_tool', arguments: {} })
    // An empty array reads to the model as a tool that did not run at all.
    expect(res.contentItems).toEqual([{ type: 'inputText', text: '(no output)' }])
  })
})

// Thang suy luận: map SAI ở đây không hỏng lượt một cách ồn ào, nó lặng lẽ đổi
// việc model làm. Đo trên codex-cli 0.154.0: `xhigh` và `max` là effort hạng
// nhất (không phải bí danh của `high`), còn `ultra` server mô tả là "maximum
// reasoning with automatic task delegation" — tức bật hành vi multi-agent. Gập
// `max` của AWOG vào `ultra` là đổi HÀNH VI, không phải đổi độ sâu suy nghĩ.
describe('effortFrom', () => {
  it('maps each AWOG level to its own Codex rung', async () => {
    const { effortFrom } = await import('../run-stream.js')
    expect(effortFrom('low')).toBe('low')
    expect(effortFrom('medium')).toBe('medium')
    expect(effortFrom('high')).toBe('high')
    expect(effortFrom('extra-high')).toBe('xhigh')
    expect(effortFrom('max')).toBe('max')
    // Never `ultra`: it is a different behaviour, not a higher one.
    expect(effortFrom('max')).not.toBe('ultra')
  })
})
