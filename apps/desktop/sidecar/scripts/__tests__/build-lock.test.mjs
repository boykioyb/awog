// Test cho khoá build (`scripts/build-lock.mjs`).
//
// Chạy build thật mất cả phút, nên phần logic khoá được tách hẳn ra module
// thuần và test ở đây: nhận/nhả, thu hồi khoá chết, KHÔNG thu hồi khoá của tiến
// trình còn sống, và nhả trên mọi đường thoát (ném lỗi, tín hiệu).
//
// Đồng hồ + `sleep` + `isAlive` đều tiêm được, nên toàn bộ file chạy trong vài
// mili-giây và không phụ thuộc PID thật của máy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BuildLockTimeoutError,
  DEFAULT_STALE_AFTER_MS,
  MALFORMED_GRACE_MS,
  acquireBuildLock,
  processIsAlive,
  withBuildLock,
} from '../build-lock.mjs'

const HOST = 'test-host'

let dir
let lockPath
let clock
let logs

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-build-lock-'))
  lockPath = join(dir, '.build.lock')
  // Đồng hồ giả neo vào giờ thật: nhánh "lock file hỏng" lấy tuổi từ mtime của
  // filesystem, nên một đồng hồ bịa ra sẽ so lệch cả chục nghìn năm.
  clock = Date.now()
  logs = []
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

// Tiến trình giả: đủ để kiểm chứng việc đăng ký/gỡ handler và mã thoát.
function fakeProc() {
  const listeners = new Map()
  return {
    exits: [],
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, [])
      listeners.get(evt).push(fn)
    },
    removeListener(evt, fn) {
      const arr = listeners.get(evt) ?? []
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    emit(evt, ...args) {
      for (const fn of [...(listeners.get(evt) ?? [])]) fn(...args)
    },
    exit(code) {
      this.exits.push(code)
    },
    count(evt) {
      return (listeners.get(evt) ?? []).length
    },
  }
}

function opts(extra = {}) {
  return {
    lockPath,
    host: HOST,
    now: () => clock,
    // `sleep` giả đẩy đồng hồ thay vì chờ thật.
    sleep: async (ms) => {
      clock += ms
    },
    log: (msg) => logs.push(msg),
    isAlive: () => true,
    installExitHandlers: false,
    ...extra,
  }
}

async function writeHolder(record) {
  await writeFile(lockPath, `${JSON.stringify(record)}\n`)
}

async function holderPid() {
  return JSON.parse(await readFile(lockPath, 'utf8')).pid
}

describe('acquire + release', () => {
  it('ghi PID, host và mốc thời gian vào khoá', async () => {
    const lock = await acquireBuildLock(opts({ pid: 4242 }))
    const record = JSON.parse(await readFile(lockPath, 'utf8'))
    expect(record).toEqual({ pid: 4242, host: HOST, startedAt: clock })
    expect(lock.record.pid).toBe(4242)
  })

  it('release xoá khoá và idempotent', async () => {
    const lock = await acquireBuildLock(opts({ pid: 1 }))
    lock.release()
    expect(existsSync(lockPath), 'lock file survived release()').toBe(false)
    expect(() => lock.release()).not.toThrow()
  })

  it('cho tiến trình sau nhận khoá sau khi tiến trình trước nhả', async () => {
    const first = await acquireBuildLock(opts({ pid: 1 }))
    first.release()
    const second = await acquireBuildLock(opts({ pid: 2 }))
    expect(await holderPid()).toBe(2)
    second.release()
  })

  it('không ngủ khi khoá đang rảnh', async () => {
    const sleep = vi.fn()
    const lock = await acquireBuildLock(opts({ pid: 1, sleep }))
    expect(sleep).not.toHaveBeenCalled()
    lock.release()
  })
})

describe('khoá của tiến trình còn sống thì KHÔNG bị cướp', () => {
  it('chờ hết trần rồi ném BuildLockTimeoutError nêu đích danh chủ khoá', async () => {
    await writeHolder({ pid: 777, host: HOST, startedAt: clock - 30_000 })
    const err = await acquireBuildLock(opts({ pid: 2, timeoutMs: 5_000 })).catch((e) => e)
    expect(err).toBeInstanceOf(BuildLockTimeoutError)
    expect(err.message).toContain('pid 777')
    expect(err.message).toContain(lockPath)
    // Khoá của chủ cũ còn nguyên — không cướp.
    expect(await holderPid()).toBe(777)
  })

  it('nói ra là đang chờ, kèm chủ khoá và trần thời gian', async () => {
    await writeHolder({ pid: 777, host: HOST, startedAt: clock - 30_000 })
    await acquireBuildLock(opts({ pid: 2, timeoutMs: 5_000 })).catch(() => {})
    expect(logs[0]).toContain('build lock is held')
    expect(logs[0]).toContain('pid 777')
    expect(logs[0]).toContain('waiting up to')
  })

  it('timeoutMs=0 là fail-ngay cho CI', async () => {
    await writeHolder({ pid: 777, host: HOST, startedAt: clock })
    const before = clock
    const err = await acquireBuildLock(opts({ pid: 2, timeoutMs: 0 })).catch((e) => e)
    expect(err).toBeInstanceOf(BuildLockTimeoutError)
    expect(clock).toBe(before)
  })

  it('nhận được khoá ngay khi chủ cũ nhả giữa lúc đang chờ', async () => {
    await writeHolder({ pid: 777, host: HOST, startedAt: clock })
    let slept = 0
    const lock = await acquireBuildLock(
      opts({
        pid: 2,
        timeoutMs: 60_000,
        sleep: async (ms) => {
          clock += ms
          slept += 1
          if (slept === 2) await rm(lockPath, { force: true })
        },
      }),
    )
    expect(slept).toBe(2)
    expect(await holderPid()).toBe(2)
    lock.release()
  })

  it('khoá từ host khác chưa quá tuổi thì không bị cướp dù kiểm PID vô nghĩa', async () => {
    await writeHolder({ pid: 777, host: 'other-host', startedAt: clock })
    const err = await acquireBuildLock(
      opts({ pid: 2, timeoutMs: 5_000, isAlive: () => false }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(BuildLockTimeoutError)
    expect(await holderPid()).toBe(777)
  })

  it('khoá vừa thu hồi từ tiến trình chết được bảo vệ như khoá thường', async () => {
    await writeHolder({ pid: 777, host: HOST, startedAt: clock - 1_000 })
    const onlyDeadIs777 = (pid) => pid !== 777
    const winner = await acquireBuildLock(opts({ pid: 11, isAlive: onlyDeadIs777 }))
    const err = await acquireBuildLock(
      opts({ pid: 22, timeoutMs: 5_000, isAlive: onlyDeadIs777 }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(BuildLockTimeoutError)
    expect(err.message).toContain('pid 11')
    expect(await holderPid()).toBe(11)
    winner.release()
    expect(existsSync(lockPath)).toBe(false)
  })
})

describe('khoá chết bị thu hồi — không wedge vĩnh viễn', () => {
  it('thu hồi khi tiến trình giữ khoá không còn sống', async () => {
    await writeHolder({ pid: 777, host: HOST, startedAt: clock - 1_000 })
    const lock = await acquireBuildLock(opts({ pid: 2, isAlive: () => false }))
    expect(await holderPid()).toBe(2)
    expect(logs.join('\n')).toContain('pid 777 is gone')
    lock.release()
  })

  it('thu hồi khi khoá quá trần tuổi dù tiến trình vẫn sống', async () => {
    await writeHolder({ pid: 777, host: HOST, startedAt: clock - DEFAULT_STALE_AFTER_MS - 1 })
    const lock = await acquireBuildLock(opts({ pid: 2, isAlive: () => true }))
    expect(await holderPid()).toBe(2)
    expect(logs.join('\n')).toContain('past the')
    lock.release()
  })

  it('thu hồi lock file hỏng khi đã quá thời gian ân hạn', async () => {
    await writeFile(lockPath, '{ broken')
    clock += MALFORMED_GRACE_MS + 1
    const lock = await acquireBuildLock(opts({ pid: 2 }))
    expect(await holderPid()).toBe(2)
    expect(logs.join('\n')).toContain('unreadable')
    lock.release()
  })

  it('lock file hỏng nhưng còn mới thì chờ (khe ghi của người vừa tạo)', async () => {
    await writeFile(lockPath, '')
    const err = await acquireBuildLock(opts({ pid: 2, timeoutMs: 1_000 })).catch((e) => e)
    expect(err).toBeInstanceOf(BuildLockTimeoutError)
    expect(err.message).toContain('unreadable')
  })

  it('processIsAlive: true cho chính mình, false cho PID không tồn tại', () => {
    expect(processIsAlive(process.pid)).toBe(true)
    expect(processIsAlive(2 ** 30)).toBe(false)
    expect(processIsAlive(0)).toBe(false)
  })
})

describe('nhả khoá trên mọi đường thoát', () => {
  it('withBuildLock nhả khoá khi fn chạy xong', async () => {
    const out = await withBuildLock(async () => 'ok', opts({ pid: 1 }))
    expect(out).toBe('ok')
    expect(existsSync(lockPath), 'lock leaked after fn returned').toBe(false)
  })

  it('withBuildLock nhả khoá khi fn NÉM, và ném tiếp lỗi gốc', async () => {
    const boom = new Error('build blew up')
    await expect(
      withBuildLock(
        async () => {
          throw boom
        },
        opts({ pid: 1 }),
      ),
    ).rejects.toBe(boom)
    expect(existsSync(lockPath), 'lock leaked on the throwing path').toBe(false)
  })

  it('SIGINT nhả khoá rồi thoát 130', async () => {
    const proc = fakeProc()
    await acquireBuildLock(opts({ pid: 1, proc, installExitHandlers: true }))
    expect(existsSync(lockPath)).toBe(true)
    proc.emit('SIGINT')
    expect(existsSync(lockPath), 'lock leaked on SIGINT').toBe(false)
    expect(proc.exits).toEqual([130])
  })

  it('SIGTERM nhả khoá rồi thoát 143', async () => {
    const proc = fakeProc()
    await acquireBuildLock(opts({ pid: 1, proc, installExitHandlers: true }))
    proc.emit('SIGTERM')
    expect(existsSync(lockPath), 'lock leaked on SIGTERM').toBe(false)
    expect(proc.exits).toEqual([143])
  })

  it("handler 'exit' nhả khoá (bắt cả process.exit ở nhánh lỗi)", async () => {
    const proc = fakeProc()
    await acquireBuildLock(opts({ pid: 1, proc, installExitHandlers: true }))
    proc.emit('exit', 1)
    expect(existsSync(lockPath), "lock leaked on 'exit'").toBe(false)
  })

  it('gỡ hết handler sau khi nhả — không rò listener', async () => {
    const proc = fakeProc()
    const lock = await acquireBuildLock(opts({ pid: 1, proc, installExitHandlers: true }))
    expect(proc.count('exit'), "no 'exit' handler installed").toBe(1)
    expect(proc.count('SIGTERM'), 'no SIGTERM handler installed').toBe(1)
    lock.release()
    expect(proc.count('exit')).toBe(0)
    expect(proc.count('SIGTERM')).toBe(0)
  })

  it('không xoá khoá đã bị người khác thu hồi và chiếm chỗ', async () => {
    const lock = await acquireBuildLock(opts({ pid: 1 }))
    await writeHolder({ pid: 999, host: HOST, startedAt: clock + 1 })
    lock.release()
    expect(await holderPid()).toBe(999)
    expect(logs.join('\n')).toContain('taken over by pid 999')
  })
})
