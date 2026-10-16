// Shim gh theo tài khoản ghim của project (runtime/tools/gh-shim.ts).
//
// Test với một `gh` GIẢ trên PATH (in ra token nó nhận) — không chạm keyring / mạng
// thật. Kiểm: PATH có shim đứng đầu, shim gọi đúng `--user <login>`, shell của agent
// KHÔNG mang GH_TOKEN, git credential trỏ vào shim, login lạ / rỗng thì không ghim.
//
// Run: `npx vitest run src/runtime/tools/__tests__/gh-shim.test.ts`
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

let home: string
let fakeBin: string
let originalHome: string | undefined

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'awog-gh-shim-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  fakeBin = join(home, 'bin')
  mkdirSync(fakeBin)
  // gh giả: `auth token --user X` in "tok-X"; lệnh khác in token nó thấy trong env.
  writeFileSync(
    join(fakeBin, 'gh'),
    `#!/bin/sh
if [ "$1 $2" = "auth token" ]; then echo "tok-$4"; exit 0; fi
echo "args=$* token=$GH_TOKEN"
`,
  )
  chmodSync(join(fakeBin, 'gh'), 0o755)
})

afterAll(() => {
  process.env.HOME = originalHome
  rmSync(home, { recursive: true, force: true })
})

const { ghShimEnv } = await import('../gh-shim.js')

const run = (env: Record<string, string>, cmd: string): string =>
  execFileSync('/bin/sh', ['-c', cmd], { env, encoding: 'utf8' }).trim()

describe.skipIf(process.platform === 'win32')('ghShimEnv', () => {
  it('ghim login: shim đứng đầu PATH, gh chạy bằng token của đúng người, shell không cầm token', () => {
    const env = ghShimEnv('kyro96', `${fakeBin}:/usr/bin:/bin`)
    expect(env.PATH?.startsWith(join(home, '.awog', 'gh-shims', 'kyro96'))).toBe(true)
    expect(run(env, 'gh api user')).toBe('args=api user token=tok-kyro96')
    expect(run(env, 'printf %s "${GH_TOKEN:-none}"')).toBe('none')
    // Script chỉ chủ nhân đọc/chạy được.
    expect(statSync(join(home, '.awog', 'gh-shims', 'kyro96', 'gh')).mode & 0o777).toBe(0o700)
  })

  it('git credential của github.com trỏ vào shim (helper toàn cục bị xoá trước)', () => {
    const env = ghShimEnv('kyro96', `${fakeBin}:/usr/bin:/bin`)
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
    })
    expect(env.GIT_CONFIG_VALUE_1).toContain(join('gh-shims', 'kyro96', 'gh'))
    expect(env.GIT_CONFIG_VALUE_1).toContain('auth git-credential')
  })

  it('GH_TOKEN người dùng tự đặt thì shim tôn trọng; lệnh auth switch không bị ép token', () => {
    const env = ghShimEnv('kyro96', `${fakeBin}:/usr/bin:/bin`)
    expect(run({ ...env, GH_TOKEN: 'mine' }, 'gh api user')).toBe('args=api user token=mine')
    expect(run(env, 'gh auth switch -u x')).toBe('args=auth switch -u x token=')
  })

  it('login rỗng / sai charset → không ghim', () => {
    expect(ghShimEnv('', '/usr/bin')).toEqual({})
    expect(ghShimEnv(undefined, '/usr/bin')).toEqual({})
    expect(ghShimEnv("x'; rm -rf /", '/usr/bin')).toEqual({})
  })
})
