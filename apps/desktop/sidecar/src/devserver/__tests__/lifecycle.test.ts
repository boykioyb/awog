// Tests vòng đời dev server (gói #3). bg-registry bị mock: ở đây chỉ quan tâm
// AWOG ánh xạ tên → background shell thế nào, và có bao giờ spawn trùng không.
//
// Run: `npx vitest run src/devserver/__tests__/lifecycle.test.ts`
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BgShellState, BgShellMeta } from '../../sessions/bg-registry.js'

const listBackground = vi.fn<(sessionId: string) => BgShellState[]>()
const startBackground =
  vi.fn<(input: { sessionId: string; cwd: string; command: string }) => Promise<BgShellMeta>>()
const killBackground = vi.fn<(sessionId: string, shellId: string) => boolean>()
const readBackground = vi.fn()

vi.mock('../../sessions/bg-registry.js', () => ({
  listBackground: (sessionId: string) => listBackground(sessionId),
  startBackground: (input: { sessionId: string; cwd: string; command: string }) =>
    startBackground(input),
  killBackground: (sessionId: string, shellId: string) => killBackground(sessionId, shellId),
  readBackground: (sessionId: string, shellId: string, opts?: unknown) =>
    readBackground(sessionId, shellId, opts),
}))

const { listDevServers, startDevServer, stopDevServer, readDevServerLog, DevServerError } =
  await import('../registry.js')

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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'awog-devserver-life-'))
  await mkdir(join(root, '.awog'), { recursive: true })
  await writeFile(
    join(root, '.awog', 'dev-servers.json'),
    JSON.stringify({
      version: 1,
      servers: [
        { name: 'web', command: 'pnpm', args: ['dev'], port: 3000, description: 'Nuxt' },
        { name: 'api', command: 'node', args: ['api.js'] },
      ],
    }),
  )
  listBackground.mockReset().mockReturnValue([])
  startBackground.mockReset().mockResolvedValue({
    shellId: 'bg_new',
    command: 'AWOG_DEV_SERVER=web pnpm dev',
    pid: 42,
    startedAt: '2026-09-07T11:00:00.000Z',
    sessionId: SID,
  })
  killBackground.mockReset().mockReturnValue(true)
  readBackground.mockReset()
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('listDevServers', () => {
  it('server chưa chạy là stopped, server có shell là running', async () => {
    listBackground.mockReturnValue([shell()])
    const listing = await listDevServers(root, SID)
    expect(listing.servers.map((s) => [s.name, s.status])).toEqual([
      ['web', 'running'],
      ['api', 'stopped'],
    ])
    expect(listing.servers[0]).toMatchObject({ shellId: 'bg_1', port: 3000, description: 'Nuxt' })
    // Nguyên văn lệnh luôn có mặt: đó là thứ người dùng phải đọc trước khi đồng ý.
    expect(listing.servers[0]?.command).toBe('AWOG_DEV_SERVER=web pnpm dev')
  })

  it('marker khớp ĐÚNG tên, không dính tên khác cùng tiền tố', async () => {
    listBackground.mockReturnValue([shell({ command: 'AWOG_DEV_SERVER=website pnpm dev' })])
    const listing = await listDevServers(root, SID)
    expect(listing.servers[0]?.status).toBe('stopped')
  })

  it('shell đã thoát ⇒ exited + exit code, mồ côi ⇒ unknown', async () => {
    listBackground.mockReturnValue([shell({ status: 'exited', exitCode: 1 })])
    expect((await listDevServers(root, SID)).servers[0]).toMatchObject({
      status: 'exited',
      exitCode: 1,
    })
    listBackground.mockReturnValue([shell({ status: 'exited-unknown' })])
    expect((await listDevServers(root, SID)).servers[0]?.status).toBe('unknown')
  })

  it('nhiều lần chạy ⇒ ưu tiên cái ĐANG chạy', async () => {
    listBackground.mockReturnValue([
      shell({ shellId: 'bg_old', status: 'exited', exitCode: 0, startedAt: '2026-09-07T12:00:00.000Z' }),
      shell({ shellId: 'bg_live', startedAt: '2026-09-07T09:00:00.000Z' }),
    ])
    const listing = await listDevServers(root, SID)
    expect(listing.servers[0]).toMatchObject({ status: 'running', shellId: 'bg_live' })
  })
})

describe('startDevServer', () => {
  it('chưa chạy ⇒ spawn đúng một lần, cwd là gốc dự án do sidecar dựng', async () => {
    const res = await startDevServer({ projectRoot: root, sessionId: SID, name: 'web', confirmCommand: 'AWOG_DEV_SERVER=web pnpm dev' })
    expect(res.outcome).toBe('started')
    expect(res.server).toMatchObject({ status: 'running', shellId: 'bg_new' })
    expect(startBackground).toHaveBeenCalledTimes(1)
    expect(startBackground).toHaveBeenCalledWith({
      sessionId: SID,
      cwd: root,
      command: 'AWOG_DEV_SERVER=web pnpm dev',
    })
  })

  it('ĐANG chạy ⇒ KHÔNG spawn thêm, trả về cái đang chạy', async () => {
    listBackground.mockReturnValue([shell()])
    const res = await startDevServer({ projectRoot: root, sessionId: SID, name: 'web', confirmCommand: 'AWOG_DEV_SERVER=web pnpm dev' })
    expect(res.outcome).toBe('already-running')
    expect(res.server.shellId).toBe('bg_1')
    expect(startBackground).not.toHaveBeenCalled()
  })

  it('confirmCommand lệch ⇒ từ chối (file đổi giữa lúc hiện và lúc đồng ý)', async () => {
    await expect(
      startDevServer({
        projectRoot: root,
        sessionId: SID,
        name: 'web',
        confirmCommand: 'AWOG_DEV_SERVER=web pnpm dev --host',
      }),
    ).rejects.toMatchObject({ code: 'command-changed' })
    expect(startBackground).not.toHaveBeenCalled()
  })

  it('confirmCommand đúng ⇒ chạy', async () => {
    await startDevServer({
      projectRoot: root,
      sessionId: SID,
      name: 'web',
      confirmCommand: 'AWOG_DEV_SERVER=web pnpm dev',
    })
    expect(startBackground).toHaveBeenCalledTimes(1)
  })

  it('tên không khai ⇒ not-found, không spawn gì', async () => {
    await expect(
      startDevServer({ projectRoot: root, sessionId: SID, name: 'ghost', confirmCommand: 'x' }),
    ).rejects.toBeInstanceOf(DevServerError)
    expect(startBackground).not.toHaveBeenCalled()
  })
})

describe('stopDevServer', () => {
  it('dừng theo tên ⇒ giết đúng shell của nó', async () => {
    listBackground.mockReturnValue([shell()])
    const view = await stopDevServer({ projectRoot: root, sessionId: SID, name: 'web' })
    expect(killBackground).toHaveBeenCalledWith(SID, 'bg_1')
    expect(view.status).toBe('unknown')
  })

  it('không chạy ⇒ not-running, không giết gì', async () => {
    await expect(
      stopDevServer({ projectRoot: root, sessionId: SID, name: 'web' }),
    ).rejects.toMatchObject({ code: 'not-running' })
    expect(killBackground).not.toHaveBeenCalled()
  })
})

describe('readDevServerLog', () => {
  const ESC = String.fromCharCode(27)
  const LOG = [
    'ready in 300ms',
    'GET /favicon.ico 200',
    `${ESC}[31mERROR${ESC}[0m TypeError: x is not a function`,
    'warn: deprecated option',
    'GET / 200',
  ].join('\n')

  beforeEach(() => {
    listBackground.mockReturnValue([shell()])
    readBackground.mockReturnValue({
      shellId: 'bg_1',
      status: 'running',
      exitCode: null,
      output: LOG,
      truncated: false,
      droppedBytes: 0,
      external: false,
    })
  })

  it('lọc theo mức lỗi, tước ANSI, đếm đúng bao nhiêu trên bao nhiêu', async () => {
    const res = await readDevServerLog({
      projectRoot: root,
      sessionId: SID,
      name: 'web',
      filter: { level: 'error' },
    })
    expect(res.log.text).toBe('ERROR TypeError: x is not a function')
    expect(res.log.matched).toBe(1)
    expect(res.log.total).toBe(5)
    expect(res.log.filtered).toBe(true)
    // Đọc log là xem tiến độ, không phải "đã nhận kết quả" của lệnh nền.
    expect(readBackground).toHaveBeenCalledWith(SID, 'bg_1', { markRead: false, raw: true })
  })

  it("level 'warn' lấy cả warn lẫn error", async () => {
    const res = await readDevServerLog({
      projectRoot: root,
      sessionId: SID,
      name: 'web',
      filter: { level: 'warn' },
    })
    expect(res.log.matched).toBe(2)
  })

  it('lọc theo chuỗi con, không phải regex', async () => {
    const res = await readDevServerLog({
      projectRoot: root,
      sessionId: SID,
      name: 'web',
      filter: { contains: 'get /' },
    })
    expect(res.log.matched).toBe(2)
    const dotted = await readDevServerLog({
      projectRoot: root,
      sessionId: SID,
      name: 'web',
      filter: { contains: 'GET . 200' },
    })
    expect(dotted.log.matched).toBe(0)
  })

  it('cắt còn N dòng cuối và báo là đã cắt', async () => {
    const res = await readDevServerLog({
      projectRoot: root,
      sessionId: SID,
      name: 'web',
      filter: { lines: 2 },
    })
    expect(res.log.text.split('\n')).toHaveLength(2)
    expect(res.log.clipped).toBe(true)
  })

  it('chưa từng chạy ⇒ nói rõ là chưa có log', async () => {
    listBackground.mockReturnValue([])
    await expect(
      readDevServerLog({ projectRoot: root, sessionId: SID, name: 'web' }),
    ).rejects.toMatchObject({ code: 'not-running' })
  })
})
