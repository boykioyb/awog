// Cổng quyền của `Artifact` (parity #35) — gate THEO HÀNH ĐỘNG, và mặc định ĐẢO
// so với browser_tool/dev_server.
//
// Vì sao có file này: `Artifact` publish một trang lên hosting của Anthropic với
// URL CÔNG KHAI, gắn tài khoản Claude của người dùng. Trước bản vá, `isGatedTool()`
// không biết tên tool này nên lời gọi thoát ở nhánh `!builtInGated` — nhánh đó nằm
// TRƯỚC cả nhánh plan mode. Hệ quả cụ thể mà file này khoá lại: một phiên
// `mode: 'plan'` (hợp đồng: read-only) publish được ra internet, trong khi `Write`
// ở đúng phiên đó bị chặn cứng. Và không còn tầng nào phía dưới:
// `permissionMode: 'bypassPermissions'` đã tắt engine quyền của CLI.
//
// Hai nửa đều load-bearing, y như dev-server-gate.test.ts: nửa "phải hỏi" và nửa
// "KHÔNG được hỏi". Một rào chắn hỏi cả khi `list` là rào chắn sẽ bị tắt.
//
// Nửa thứ ba chỉ riêng tool này mới có: hành động LẠ phải bị hỏi. Phần thân tool
// nằm trong CLI của Anthropic, nên danh sách hành động đổi khi người dùng nâng CLI
// chứ không khi ai đó sửa repo này — một danh sách "mutating" sẽ để hành động mới
// chạy ungated cho tới khi có người nhớ ra.
//
// Run: `npx vitest run src/runtime/__tests__/artifact-gate.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeforeToolCallContext } from '@earendil-works/pi-agent-core'
import { makeBeforeToolCall } from '../permission.js'
import type { CanUseTool } from '../permission-types.js'
import {
  ARTIFACT_TOOL_NAME,
  isArtifactToolName,
  isGatedArtifactAction,
} from '../claude-sdk/artifact.js'

// Đúng 11 hành động của `ArtifactInput` trong SDK 0.3.260 (sdk-tools.d.ts), chia
// theo hệ quả. `read_asset` nằm bên GATE dù tên nghe như đọc: nó GHI một file
// xuống `out_dir` (mặc định là thư mục làm việc), tức cùng hạng với `Write`.
const READ_ONLY_ACTIONS = ['list', 'read', 'list_types', 'list_assets', 'status', 'watch', 'unwatch']
const GATED_ACTIONS = ['publish', 'upload_asset', 'read_asset', 'delete_asset']

// Hook chỉ đọc toolCall.name / toolCall.id / args.
function toolCtx(args: Record<string, unknown>, name = ARTIFACT_TOOL_NAME): BeforeToolCallContext {
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
  home = await mkdtemp(join(tmpdir(), 'awog-artifact-gate-'))
  originalHome = process.env.HOME
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('isArtifactToolName', () => {
  it('khớp đúng tên trần — tool built-in của CLI không bắc cầu qua MCP', () => {
    expect(isArtifactToolName(ARTIFACT_TOOL_NAME)).toBe(true)
    expect(isArtifactToolName('mcp__x__Artifact')).toBe(false)
    expect(isArtifactToolName('artifact')).toBe(false)
    expect(isArtifactToolName('ArtifactViewer')).toBe(false)
    expect(isArtifactToolName('')).toBe(false)
  })
})

describe('isGatedArtifactAction', () => {
  it('thiếu `action` ⇒ GATE — publish là giá trị rơi mặc định của schema', () => {
    expect(isGatedArtifactAction({ file_path: '/tmp/report.html' })).toBe(true)
    expect(isGatedArtifactAction({})).toBe(true)
    expect(isGatedArtifactAction(null)).toBe(true)
    expect(isGatedArtifactAction(undefined)).toBe(true)
  })

  it('hành động có hệ quả đều gate', () => {
    for (const action of GATED_ACTIONS) expect(isGatedArtifactAction({ action })).toBe(true)
  })

  it('hành động chỉ đọc thì không', () => {
    for (const action of READ_ONLY_ACTIONS) expect(isGatedArtifactAction({ action })).toBe(false)
  })

  it('hành động LẠ ⇒ GATE — CLI thêm hành động, repo này không biết trước', () => {
    // Đã thấy trên CLI mới hơn bản đang ghim; chưa đọc được hợp đồng của chúng nên
    // không miễn trừ theo cái tên.
    for (const action of ['write_db', 'read_db', 'reply', 'resolve', 'comments']) {
      expect(isGatedArtifactAction({ action })).toBe(true)
    }
  })

  it('args dị dạng ⇒ GATE, không lọt vì đọc không ra', () => {
    expect(isGatedArtifactAction({ action: 42 })).toBe(true)
    expect(isGatedArtifactAction({ action: null })).toBe(true)
    expect(isGatedArtifactAction({ action: ['list'] })).toBe(true)
    expect(isGatedArtifactAction('list')).toBe(true)
  })
})

describe('ask mode', () => {
  it('publish phải đi qua cổng quyền — kể cả khi thiếu `action`', async () => {
    for (const args of [{ file_path: '/tmp/report.html' }, { action: 'publish' }]) {
      const { asked, canUseTool } = recordingGate('allow')
      const hook = makeBeforeToolCall(canUseTool, 'ask')
      await expect(hook(toolCtx(args))).resolves.toBeUndefined()
      expect(asked).toEqual([ARTIFACT_TOOL_NAME])
    }
  })

  it('người dùng từ chối ⇒ lời gọi bị chặn', async () => {
    const { canUseTool } = recordingGate('deny')
    const hook = makeBeforeToolCall(canUseTool, 'ask')
    await expect(hook(toolCtx({ file_path: '/tmp/report.html' }))).resolves.toMatchObject({
      block: true,
    })
  })

  it('mọi hành động có hệ quả đều hỏi', async () => {
    const { asked, canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'ask')
    for (const action of GATED_ACTIONS) await hook(toolCtx({ action, url: 'u', asset_id: 'a' }))
    expect(asked).toEqual(GATED_ACTIONS.map(() => ARTIFACT_TOOL_NAME))
  })

  it('`list`/`read` KHÔNG hỏi — bắt duyệt cả việc đọc là cách nhanh nhất để rào chắn bị tắt', async () => {
    const { asked, canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'ask')
    for (const action of READ_ONLY_ACTIONS) {
      await expect(hook(toolCtx({ action, url: 'https://claude.ai/x' }))).resolves.toBeUndefined()
    }
    expect(asked).toEqual([])
  })
})

describe('plan mode', () => {
  // Đây là finding gốc: plan mode hứa read-only, `Write` bị chặn cứng, mà publish
  // một trang lên internet thì lọt.
  it('chặn publish — plan mode không được để lại dấu vết ra ngoài', async () => {
    const { asked, canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'plan')
    for (const args of [{ file_path: '/tmp/report.html' }, { action: 'publish' }]) {
      await expect(hook(toolCtx(args))).resolves.toMatchObject({ block: true })
    }
    expect(asked).toEqual([])
  })

  it('chặn cả upload_asset / read_asset / delete_asset', async () => {
    const { canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'plan')
    for (const action of ['upload_asset', 'read_asset', 'delete_asset']) {
      await expect(hook(toolCtx({ action, url: 'u', asset_id: 'a' }))).resolves.toMatchObject({
        block: true,
      })
    }
  })

  it('vẫn cho `list`/`read` — điều tra là đúng việc của plan mode', async () => {
    const { canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'plan')
    await expect(hook(toolCtx({ action: 'list' }))).resolves.toBeUndefined()
    await expect(
      hook(toolCtx({ action: 'read', url: 'https://claude.ai/public/artifacts/x' })),
    ).resolves.toBeUndefined()
  })
})

describe('execute mode', () => {
  it('không hỏi gì cả — người dùng đã chọn toàn quyền', async () => {
    const { asked, canUseTool } = recordingGate('allow')
    const hook = makeBeforeToolCall(canUseTool, 'execute')
    await expect(hook(toolCtx({ file_path: '/tmp/report.html' }))).resolves.toBeUndefined()
    expect(asked).toEqual([])
  })
})
