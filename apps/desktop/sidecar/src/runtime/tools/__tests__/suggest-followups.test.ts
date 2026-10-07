// Tests cho `suggest_followups` sau bản vá thứ tự (ADR 0096, spec #34 — AC-FU-6..9).
//
// Lỗi gốc: model viết câu trả lời → gọi tool → viết lại TOÀN BỘ câu trả lời. Hai
// chuỗi model đọc (mô tả tool + kết quả tool) là biến số duy nhất AWOG điều khiển
// được, nên test khoá chúng bằng danh sách cụm CẤM / BẮT BUỘC của ADR 0096 (mục
// "Việc cần làm tiếp" → T3), KHÔNG chụp snapshot nguyên văn: đổi câu chữ sau này
// (ADR mới supersede D1) chỉ phải sửa test khi đổi đúng điều ADR cấm.
//
// Nhánh Claude SDK được kiểm mà không dựng SDK thật: `tool()` / `createSdkMcpServer`
// được thay bằng bản ghi lại tham số, còn handler vẫn là closure thật của
// surface-sdk-server.ts (gọi `finish` + `runSuggestFollowups` thật).
//
// Run: `env -u ENABLE_TOOL_SEARCH npx vitest run src/runtime/tools/__tests__/suggest-followups.test.ts`
import { describe, expect, it, vi } from 'vitest'

type SdkToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type CapturedSdkTool = {
  name: string
  description: string
  handler: (args: Record<string, unknown>) => Promise<SdkToolResult>
}

const { captured } = vi.hoisted(() => ({ captured: [] as CapturedSdkTool[] }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (
    name: string,
    description: string,
    _schema: unknown,
    handler: CapturedSdkTool['handler'],
  ): CapturedSdkTool => {
    const t = { name, description, handler }
    captured.push(t)
    return t
  },
  createSdkMcpServer: (opts: { name: string; tools: CapturedSdkTool[] }) => ({
    type: 'sdk',
    name: opts.name,
    instance: opts,
  }),
}))

import {
  SURFACE_TOOL_TEXT,
  createSurfaceTools,
  createSurfaceTurnCounters,
  runSuggestFollowups,
} from '../surface-tools.js'
import { buildSurfaceToolsSdkServer } from '../../claude-sdk/surface-sdk-server.js'
import { stepFromToolResult, stepFromToolUse } from '../../../sessions/step-mapper.js'

// ADR 0096 → "Việc cần làm tiếp" → T3. So khớp không phân biệt hoa thường.
const RECORDED_FORBIDDEN = [
  'under',
  'below',
  'shown',
  'chip',
  'suggest',
  'follow-up',
  'option',
  'rewrite',
  'repeat',
  'restate',
  'summar',
] as const
const DESCRIPTION_FORBIDDEN = [
  'LAST tool call',
  'after your answer',
  'under your answer',
  'below',
  'shown',
] as const

const REFUSED_TWICE = 'Rejected: follow-up suggestions were already offered in this reply.'
const REFUSED_EMPTY = 'Rejected: no follow-up text was given.'

function lower(s: string): string {
  return s.toLowerCase()
}

function piFollowupsTool(sessionId = 'ses-fu-pi') {
  const tool = createSurfaceTools('/tmp', { sessionId }).find((t) => t.name === 'suggest_followups')
  expect(tool).toBeDefined()
  return tool!
}

function sdkFollowupsTool(sessionId = 'ses-fu-sdk'): CapturedSdkTool {
  captured.length = 0
  buildSurfaceToolsSdkServer(sessionId, '/tmp')
  const tool = captured.find((t) => t.name === 'suggest_followups')
  expect(tool).toBeDefined()
  return tool!
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const first = result.content[0]
  expect(first?.type).toBe('text')
  return first?.text ?? ''
}

describe('suggest_followups — mô tả tool (AC-FU-6)', () => {
  const d = SURFACE_TOOL_TEXT.suggestFollowups.description

  it.each(DESCRIPTION_FORBIDDEN)('không chứa cụm cấm %j', (phrase) => {
    expect(lower(d)).not.toContain(lower(phrase))
  })

  it('bảo gọi NGAY TRƯỚC câu trả lời cuối, khi đã biết sẽ kết luận gì', () => {
    expect(d).toContain('BEFORE you write your final answer')
    expect(d).toContain('you know what you will conclude')
    expect(d).toContain('never after it')
  })

  it('giữ ngân sách một lần mỗi lượt và lệnh cấm nhắc tới gợi ý trong text', () => {
    expect(d).toContain('AT MOST ONCE')
    expect(d).toContain('never mention, list or point to them')
  })
})

describe('suggest_followups — kết quả khi gọi hợp lệ (AC-FU-7)', () => {
  const recorded = SURFACE_TOOL_TEXT.suggestFollowups.recorded

  it('runSuggestFollowups trả đúng hằng `recorded` kèm surface followups', () => {
    const res = runSuggestFollowups(
      { options: ['Run the tests', 'Show me the diff'] },
      createSurfaceTurnCounters(),
    )
    expect(res.text).toBe(recorded)
    expect(res.surface).toEqual({
      kind: 'followups',
      options: ['Run the tests', 'Show me the diff'],
    })
  })

  it.each(RECORDED_FORBIDDEN)('chuỗi kết quả không chứa từ cấm %j', (word) => {
    expect(lower(recorded)).not.toContain(word)
  })

  it('(c) bảo model viết câu trả lời cuối', () => {
    expect(lower(recorded)).toContain('final answer')
  })

  it('phương án (c) của ADR 0096 D1: cấm viết lần hai NHƯNG bắt kết bằng một câu ngắn', () => {
    // Thiếu vế đầu ⇒ ca thói quen cũ đọc như lời mời viết lại (M1); thiếu vế sau ⇒
    // lượt rỗng sau tool, CLI chèn "no visible output" (M3).
    expect(recorded).toContain('do not write it a second time')
    expect(recorded).toContain('one short closing sentence')
  })

  it('không còn đếm số option: 1, 2 hay 3 option ra cùng một chuỗi, không có chữ số', () => {
    const texts = [['a'], ['a', 'b'], ['a', 'b', 'c']].map(
      (options) => runSuggestFollowups({ options }, createSurfaceTurnCounters()).text,
    )
    expect(new Set(texts).size).toBe(1)
    expect(texts[0]).not.toMatch(/\d/)
  })
})

describe('suggest_followups — từ chối giữ nguyên (AC-FU-9)', () => {
  it('gọi lần 2 trong cùng lượt ⇒ từ chối, không sinh surface thứ hai', () => {
    const turn = createSurfaceTurnCounters()
    const first = runSuggestFollowups({ options: ['Run the tests'] }, turn)
    expect(first.surface).toBeDefined()
    const second = runSuggestFollowups({ options: ['Something else'] }, turn)
    expect(second.text).toBe(REFUSED_TWICE)
    expect(second.surface).toBeUndefined()
    expect(turn.followups).toBe(1)
  })

  it.each([
    ['mảng rỗng', { options: [] }],
    ['chỉ khoảng trắng', { options: ['   ', ''] }],
    ['không phải mảng', { options: 'Run the tests' }],
    ['thiếu tham số', {}],
  ])('options %s ⇒ từ chối "no follow-up text"', (_label, args) => {
    const turn = createSurfaceTurnCounters()
    const res = runSuggestFollowups(args, turn)
    expect(res.text).toBe(REFUSED_EMPTY)
    expect(res.surface).toBeUndefined()
    expect(turn.followups).toBe(0)
  })

  it('lời gọi rỗng bị từ chối không tiêu ngân sách của lượt', () => {
    const turn = createSurfaceTurnCounters()
    runSuggestFollowups({ options: [] }, turn)
    expect(runSuggestFollowups({ options: ['Run the tests'] }, turn).surface).toBeDefined()
  })

  it('lượt mới (bộ đếm mới) được gọi lại', () => {
    const turn1 = createSurfaceTurnCounters()
    runSuggestFollowups({ options: ['a'] }, turn1)
    const turn2 = createSurfaceTurnCounters()
    expect(runSuggestFollowups({ options: ['b'] }, turn2).surface).toBeDefined()
  })

  it('cắt còn tối đa 3 option', () => {
    const res = runSuggestFollowups({ options: ['a', 'b', 'c', 'd'] }, createSurfaceTurnCounters())
    expect(res.surface).toEqual({ kind: 'followups', options: ['a', 'b', 'c'] })
  })
})

describe('suggest_followups — một nguồn text cho hai runtime (AC-FU-8)', () => {
  it('nhánh Pi: AgentTool dùng đúng mô tả + kết quả chung, lần 2 cờ isError', async () => {
    const tool = piFollowupsTool()
    expect(tool.description).toBe(SURFACE_TOOL_TEXT.suggestFollowups.description)

    const ok = await tool.execute('call-1', { options: ['Run the tests'] })
    expect(textOf(ok)).toBe(SURFACE_TOOL_TEXT.suggestFollowups.recorded)
    expect(ok.details).toEqual({ surface: { kind: 'followups', options: ['Run the tests'] } })

    const again = await tool.execute('call-2', { options: ['Run the tests again'] })
    expect(textOf(again)).toBe(REFUSED_TWICE)
    expect(again.details).toEqual({ isError: true })
  })

  it('nhánh Pi: options rỗng ⇒ isError', async () => {
    const res = await piFollowupsTool('ses-fu-pi-empty').execute('call-1', { options: [] })
    expect(textOf(res)).toBe(REFUSED_EMPTY)
    expect(res.details).toEqual({ isError: true })
  })

  it('nhánh Claude SDK: server dùng đúng mô tả + kết quả chung, lần 2 isError', async () => {
    const tool = sdkFollowupsTool()
    expect(tool.description).toBe(SURFACE_TOOL_TEXT.suggestFollowups.description)

    const ok = await tool.handler({ options: ['Run the tests'] })
    expect(textOf(ok)).toBe(SURFACE_TOOL_TEXT.suggestFollowups.recorded)
    expect(ok.isError).toBeUndefined()

    const again = await tool.handler({ options: ['Run the tests again'] })
    expect(textOf(again)).toBe(REFUSED_TWICE)
    expect(again.isError).toBe(true)
  })

  it('nhánh Claude SDK: options rỗng ⇒ isError', async () => {
    const res = await sdkFollowupsTool('ses-fu-sdk-empty').handler({ options: [] })
    expect(textOf(res)).toBe(REFUSED_EMPTY)
    expect(res.isError).toBe(true)
  })

  it('Pi và SDK giống từng byte: mô tả, kết quả hợp lệ, kết quả từ chối', async () => {
    const pi = piFollowupsTool('ses-fu-byte-pi')
    const sdk = sdkFollowupsTool('ses-fu-byte-sdk')
    expect(pi.description).toBe(sdk.description)

    const args = { options: ['Run the tests', 'Show me the diff'] }
    expect(textOf(await pi.execute('c1', args))).toBe(textOf(await sdk.handler(args)))
    expect(textOf(await pi.execute('c2', args))).toBe(textOf(await sdk.handler(args)))
  })
})

// Nửa sidecar của AC-FU-9: lời gọi bị từ chối KHÔNG phải surface ⇒ step `tool` lỗi,
// nên UI (displayBlockOrder chỉ dời block `followups`) để nó đứng yên tại chỗ.
describe('suggest_followups — step-mapper (AC-FU-9: hàng bị từ chối là tool row lỗi)', () => {
  it.each(['suggest_followups', 'mcp__awogsurfaces__suggest_followups'])(
    '%s bị từ chối ⇒ kind tool, status error, không mang surface',
    (name) => {
      const input = { options: ['Run the tests again'] }
      const step = stepFromToolResult({
        toolUseId: 'tu-2',
        toolName: name,
        toolInput: input,
        content: [{ type: 'text', text: REFUSED_TWICE }],
        details: { isError: true },
        isError: true,
      })
      expect(step.kind).toBe('tool')
      expect(step.status).toBe('error')
      expect(step.surface).toBeUndefined()
    },
  )

  it.each(['suggest_followups', 'mcp__awogsurfaces__suggest_followups'])(
    '%s hợp lệ ⇒ surface followups (lúc bắt đầu: running, lúc kết thúc: done)',
    (name) => {
      const input = { options: ['Run the tests'] }
      const start = stepFromToolUse({ id: 'tu-1', name, input })
      expect(start).toMatchObject({ kind: 'surface', status: 'running' })
      expect(start.surface).toEqual({ kind: 'followups', options: ['Run the tests'] })

      const end = stepFromToolResult({
        toolUseId: 'tu-1',
        toolName: name,
        toolInput: input,
        content: [{ type: 'text', text: SURFACE_TOOL_TEXT.suggestFollowups.recorded }],
        details: { surface: { kind: 'followups', options: ['Run the tests'] } },
        isError: false,
      })
      expect(end).toMatchObject({ kind: 'surface', status: 'done' })
      expect(end.surface).toEqual({ kind: 'followups', options: ['Run the tests'] })
    },
  )
})
