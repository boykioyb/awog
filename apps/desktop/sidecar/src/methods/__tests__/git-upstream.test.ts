// Pull / push tự gắn upstream CÙNG TÊN (git/upstream.ts) — chạy git THẬT trên một
// remote bare + hai bản clone trong thư mục tạm.
//
// Ca chính: branch vừa tạo ở local không có tracking → pull báo NO_UPSTREAM (remote
// chưa có branch), push trơn tự `-u origin <cùng tên>`, và clone thứ hai checkout
// branch đó không tracking → pull kéo được + tự gắn tracking. Không bao giờ gắn vào
// branch khác tên (main).
//
// Run: `npx vitest run src/methods/__tests__/git-upstream.test.ts`
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../transport/stdio.js', () => ({ emit: () => {} }))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

const { dispatch } = await import('../../transport/rpc.js')
await import('../git.pull.js')
await import('../git.push.js')

let root: string
let remote: string
let a: string
let b: string

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim()

const upstreamOf = (cwd: string): string =>
  git(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'awog-git-upstream-'))
  remote = join(root, 'remote.git')
  a = join(root, 'a')
  b = join(root, 'b')
  git(root, 'init', '--bare', '-b', 'main', remote)
  git(root, 'clone', remote, a)
  git(a, 'checkout', '-b', 'main')
  writeFileSync(join(a, 'f.txt'), '1')
  git(a, 'add', '.')
  git(a, 'commit', '-m', 'init')
  git(a, 'push', '-u', 'origin', 'main')
  git(root, 'clone', remote, b)
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('git.pull / git.push — upstream tự gắn cùng tên', () => {
  it('branch mới chỉ có ở local: pull báo NO_UPSTREAM (không gắn bừa vào main)', async () => {
    git(a, 'switch', '-c', 'chore/dev-db-gui-access', '--no-track')
    await expect(dispatch('git.pull', { workspaceRoot: a, strategy: 'ff-only' })).rejects.toMatchObject({
      data: { gitCode: 'NO_UPSTREAM' },
    })
    expect(() => upstreamOf(a)).toThrow()
  })

  it('push trơn từ branch chưa có upstream: tự `push -u origin <cùng tên>`', async () => {
    writeFileSync(join(a, 'g.txt'), '2')
    git(a, 'add', '.')
    git(a, 'commit', '-m', 'feat')
    const res = (await dispatch('git.push', { workspaceRoot: a })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(upstreamOf(a)).toBe('origin/chore/dev-db-gui-access')
  })

  it('clone khác checkout branch không tracking: pull kéo được + tự gắn tracking cùng tên', async () => {
    git(b, 'fetch', 'origin')
    git(b, 'branch', '--no-track', 'chore/dev-db-gui-access', 'origin/main')
    git(b, 'switch', 'chore/dev-db-gui-access')
    expect(() => upstreamOf(b)).toThrow()
    const res = (await dispatch('git.pull', { workspaceRoot: b, strategy: 'ff-only' })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(upstreamOf(b)).toBe('origin/chore/dev-db-gui-access')
    expect(git(b, 'log', '-1', '--format=%s')).toBe('feat')
  })
})
