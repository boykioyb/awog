// Cổng quyền của `dev_server` — gate THEO HÀNH ĐỘNG, không theo tên tool.
//
// Vì sao có file này: `dev_server({ action: 'stop' })` giết một tiến trình mà người
// dùng đã phải duyệt lúc khởi động (`start` cố ý không tự spawn — nó trả lệnh về để
// model chạy qua `Bash`). Trước bản vá này, `stop` không nằm trong `isGatedTool` nên
// nó chạy thẳng: không hỏi ở ask mode, không bị chặn ở plan mode.
//
// Nhưng gate cả tool cũng sai: `list`/`logs`/`start` không đổi gì ở ngoài, và một
// rào chắn hỏi cả khi đọc log là rào chắn sẽ bị tắt. Nên hai nửa của file này đều
// load-bearing — nửa "phải hỏi" và nửa "không được hỏi".
//
// Và cả hai phải đúng trên CẢ HAI runtime: nhánh Claude SDK gọi cùng tool dưới tên
// `mcp__awogdev__dev_server` (ADR 0058). Lớp bug "tool bắc cầu đổi tên nên lọt cổng"
// đã xảy ra bảy lần trong repo này.
//
// Run: `npx vitest run src/runtime/__tests__/dev-server-gate.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeforeToolCallContext } from '@earendil-works/pi-agent-core'
import { makeBeforeToolCall } from '../permission.js'
import type { CanUseTool } from '../permission-types.js'
import {
  DEV_SERVER_MCP_SERVER,
  DEV_SERVER_TOOL_NAME,
  isDevServerToolName,
  isMutatingDevServerAction,
} from '../tools/dev-server-tool.js'

const BRIDGED = `mcp__${DEV_SERVER_MCP_SERVER}__${DEV_SERVER_TOOL_NAME}`

// Hook chỉ đọc toolCall.name / toolCall.id / args.
function toolCtx(name: string, args: Record<string, unknown>): BeforeToolCallContext {
  return {
    toolCall: { id: 'tc-1', name, arguments: args },
    args,
  } as unknown as BeforeToolCallContext
}

// Cổng UI giả: ghi lại từng lần được HỎI rồi trả lời theo `behavior`.
function recordingGate(behavior: 'allow' | 'deny' = 'allow') {
  const asked: string[] = []
  const canUseTool: CanUseTool = async (toolName) => {
    asked.push(toolName)
    return behavior === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'Denied by user.' }
  }
  return { asked, canUseTool }
}

// $HOME tạm: luật quyền của người chạy test không được lọt vào kết quả.
let home: string
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-devserver-gate-'))
  originalHome = process.env.HOME
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('isDevServerToolName / isMutatingDevServerAction', () => {
  it('khớp tên trần của nhánh Pi và tên bắc cầu của nhánh Claude SDK', () => {
    expect(isDevServerToolName(DEV_SERVER_TOOL_NAME)).toBe(true)
    expect(isDevServerToolName(BRIDGED)).toBe(true)
    // Server có thể được đặt lại tên; hậu tố mới là thứ nhận diện.
    expect(isDevServerToolName(`mcp__somethingelse__${DEV_SERVER_TOOL_NAME}`)).toBe(true)
  })

  it('KHÔNG khớp tool khác chỉ vì tên chứa chuỗi con', () => {
    expect(isDevServerToolName('dev_server_helper')).toBe(false)
    expect(isDevServerToolName('mcp__x__dev_server_helper')).toBe(false)
    expect(isDevServerToolName('my_dev_server')).toBe(false)
    expect(isDevServerToolName('')).toBe(false)
  })

  it('chỉ `stop` là hành động có hệ quả', () => {
    expect(isMutatingDevServerAction({ action: 'stop' })).toBe(true)
    for (const action of ['list', 'start', 'logs']) {
      expect(isMutatingDevServerAction({ action })).toBe(false)
    }
  })

  it('args dị dạng không được coi là mutating', () => {
    expect(isMutatingDevServerAction(null)).toBe(false)
    expect(isMutatingDevServerAction(undefined)).toBe(false)
    expect(isMutatingDevServerAction({})).toBe(false)
    expect(isMutatingDevServerAction({ action: 42 })).toBe(false)
    expect(isMutatingDevServerAction('stop')).toBe(false)
  })
})

describe('ask mode', () => {
  it('`stop` phải đi qua cổng quyền — trên CẢ HAI cách gọi tên', async () => {
    for (const name of [DEV_SERVER_TOOL_NAME, BRIDGED]) {
      const { asked, canUseTool } = recordingGate('allow')
      const hook = makeBeforeToolCall(canUseTool, 'ask')
      await expect(hook(toolCtx(name, { action: 'stop', name: 'web' }))).resolves.toBeUndefined()
      expect(asked).toEqual([name])
    }
  })

  it('người dùng từ chối ⇒ lời gọi bị chặn', async () => {
    const { canUseTool } = recordingGate('deny')
    const hook = makeBeforeToolCall(canUseTool, 'ask')
    await expect(
      hook(toolCtx(DEV_SERVER_TOOL_NAME, { action: 'stop', name: 'web' })),
    ).resolves.toMatchObject({ block: true })
  })

  it('`list`/`start`/`logs` KHÔNG hỏi — kể cả dạng bắc cầu', async () => {
    const { asked, canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'ask')
    for (const name of [DEV_SERVER_TOOL_NAME, BRIDGED]) {
      for (const action of ['list', 'start', 'logs']) {
        await expect(hook(toolCtx(name, { action, name: 'web' }))).resolves.toBeUndefined()
      }
    }
    expect(asked).toEqual([])
  })
})

describe('plan mode', () => {
  it('chặn `stop` — dừng một tiến trình không phải việc read-only', async () => {
    const { asked, canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'plan')
    for (const name of [DEV_SERVER_TOOL_NAME, BRIDGED]) {
      await expect(hook(toolCtx(name, { action: 'stop', name: 'web' }))).resolves.toMatchObject({
        block: true,
      })
    }
    expect(asked).toEqual([])
  })

  it('vẫn cho `list`/`logs` — điều tra là đúng việc của plan mode', async () => {
    const { canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'plan')
    await expect(hook(toolCtx(BRIDGED, { action: 'list' }))).resolves.toBeUndefined()
    await expect(hook(toolCtx(BRIDGED, { action: 'logs', name: 'web' }))).resolves.toBeUndefined()
  })
})

describe('execute mode', () => {
  it('không hỏi gì cả — người dùng đã chọn toàn quyền', async () => {
    const { asked, canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'execute')
    await expect(hook(toolCtx(BRIDGED, { action: 'stop', name: 'web' }))).resolves.toBeUndefined()
    expect(asked).toEqual([])
  })
})
