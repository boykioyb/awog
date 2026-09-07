// Tests cho tool `dev_server` (gói #3). Trọng tâm là hai lời hứa bảo mật:
//   1. `start` KHÔNG BAO GIỜ spawn — nó chỉ trả về nguyên văn lệnh để model chạy
//      qua `Bash`, tức qua cổng quyền thật.
//   2. Log trả cho model đã khử bí mật và nằm trong hàng rào mang nonce.
//
// Run: `npx vitest run src/devserver/__tests__/tool.test.ts`
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BgShellState } from '../../sessions/bg-registry.js'

const listBackground = vi.fn<(sessionId: string) => BgShellState[]>()
const startBackground = vi.fn()
const killBackground = vi.fn<(sessionId: string, shellId: string) => boolean>()
const readBackground = vi.fn()

vi.mock('../../sessions/bg-registry.js', () => ({
  listBackground: (sessionId: string) => listBackground(sessionId),
  startBackground: (input: unknown) => startBackground(input),
  killBackground: (sessionId: string, shellId: string) => killBackground(sessionId, shellId),
  readBackground: (sessionId: string, shellId: string, opts?: unknown) =>
    readBackground(sessionId, shellId, opts),
}))

const { createDevServerTool } = await import('../../runtime/tools/dev-server-tool.js')

const SID = 'ses-1'
let root: string

function shell(over: Partial<BgShellState> = {}): BgShellState {
  return {
    shellId: 'bg_1',
    command: 'AWOG_DEV_SERVER=web pnpm dev',
    startedAt: '2026-09-07T10:00:00.000Z',
    status: 'running',
    exitCode: null,
    read: false,
    ...over,
  }
}

async function call(params: Record<string, unknown>) {
  const tool = createDevServerTool(root, SID)
  const res = await tool.execute('call-1', params as never, undefined)
  const first = res.content[0] as { text: string } | undefined
  return { details: res.details, text: first?.text ?? '' }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'awog-devserver-tool-'))
  await mkdir(join(root, '.awog'), { recursive: true })
  await writeFile(
    join(root, '.awog', 'dev-servers.json'),
    JSON.stringify({ servers: [{ name: 'web', command: 'pnpm', args: ['dev'], port: 3000 }] }),
  )
  listBackground.mockReset().mockReturnValue([])
  startBackground.mockReset()
  killBackground.mockReset().mockReturnValue(true)
  readBackground.mockReset()
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('dev_server', () => {
  it('list nêu tên, trạng thái và NGUYÊN VĂN lệnh', async () => {
    const { text } = await call({ action: 'list' })
    expect(text).toContain('web: stopped')
    expect(text).toContain('AWOG_DEV_SERVER=web pnpm dev')
  })

  it('chưa có file cấu hình ⇒ chỉ chỗ tạo + mẫu, không báo lỗi', async () => {
    await rm(join(root, '.awog', 'dev-servers.json'))
    const { text, details } = await call({ action: 'list' })
    expect(details.isError).toBeUndefined()
    expect(text).toContain('dev-servers.json')
    expect(text).toContain('"servers"')
  })

  it('start KHÔNG spawn — nó đưa lệnh để model chạy qua Bash (cổng quyền)', async () => {
    const { text, details } = await call({ action: 'start', name: 'web' })
    expect(startBackground).not.toHaveBeenCalled()
    expect(details.status).toBe('not-running')
    expect(text).toContain('run_in_background')
    expect(text).toContain('"AWOG_DEV_SERVER=web pnpm dev"')
  })

  it('đang chạy ⇒ start nói rõ đừng bật cái thứ hai, và không đưa lệnh nào', async () => {
    listBackground.mockReturnValue([shell()])
    const { text, details } = await call({ action: 'start', name: 'web' })
    expect(details.status).toBe('already-running')
    expect(text).toContain('ALREADY RUNNING')
    expect(text).not.toContain('run_in_background')
    expect(startBackground).not.toHaveBeenCalled()
  })

  it('tên không khai ⇒ bước LỖI kèm danh sách tên hợp lệ', async () => {
    const { text, details } = await call({ action: 'start', name: 'ghost' })
    expect(details.isError).toBe(true)
    expect(text).toContain('web')
  })

  it('thiếu name ⇒ lỗi, không đoán bừa server nào', async () => {
    expect((await call({ action: 'logs' })).details.isError).toBe(true)
  })

  it('logs: khử bí mật + bọc hàng rào nonce mới mỗi lần gọi', async () => {
    listBackground.mockReturnValue([shell()])
    readBackground.mockReturnValue({
      shellId: 'bg_1',
      status: 'running',
      exitCode: null,
      output: 'listening on 3000\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      truncated: false,
      droppedBytes: 0,
      external: false,
    })
    const first = await call({ action: 'logs', name: 'web' })
    expect(first.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(first.text).toContain('[redacted]')
    const tag = /<(dev-server-log-[0-9a-f]{12})>/.exec(first.text)?.[1]
    expect(tag).toBeTruthy()
    expect(first.text).toContain(`</${tag}>`)
    const second = await call({ action: 'logs', name: 'web' })
    expect(second.text).not.toContain(`<${tag}>`)
  })

  it('stop gọi đúng shell của server đó', async () => {
    listBackground.mockReturnValue([shell()])
    const { details } = await call({ action: 'stop', name: 'web' })
    expect(killBackground).toHaveBeenCalledWith(SID, 'bg_1')
    expect(details.status).toBe('stopped')
  })
})
