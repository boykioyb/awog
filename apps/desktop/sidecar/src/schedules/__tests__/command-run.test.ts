// Tests cho job `command` của runner.ts (ADR 0108) — chạy lệnh đã duyệt, từ chối lệnh
// chưa duyệt / bị cấy, báo lỗi kèm output, env không mang token, hết giờ giết cả nhóm.
//
// HOME tạm vì store lịch nằm ở `~/.awog/schedules` (đặt TRƯỚC khi import module, như
// wakeup.test.ts). Keychain giả lập: test không được đụng Keychain thật của máy.
//
// Run: `npx vitest@2 run src/schedules/__tests__/command-run.test.ts`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Schedule, ScheduleJob } from '../schema.js'

const vault = new Map<string, string>()
vi.mock('../../credentials/keychain.js', () => ({
  getKeychainValue: async (service: string, account: string) => vault.get(`${service}/${account}`) ?? null,
  setKeychainValue: async (service: string, account: string, value: string) => {
    vault.set(`${service}/${account}`, value)
  },
}))

type CommandJob = Extract<ScheduleJob, { kind: 'command' }>
let home: string
let store: typeof import('../store.js')
let runner: typeof import('../runner.js')
let approval: typeof import('../command-approval.js')

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-cmd-'))
  process.env.HOME = home
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true) // event frames
  store = await import('../store.js')
  runner = await import('../runner.js')
  approval = await import('../command-approval.js')
})

afterAll(async () => {
  vi.restoreAllMocks()
  await rm(home, { recursive: true, force: true })
})

async function saveCommand(id: string, job: CommandJob, approve: boolean): Promise<void> {
  const at = new Date().toISOString()
  const schedule: Schedule = {
    id,
    name: id,
    enabled: true,
    trigger: { kind: 'interval', everyMinutes: 15 },
    job,
    createdAt: at,
    updatedAt: at,
    nextRunAt: null,
    runs: [],
  }
  await store.saveSchedule(schedule)
  if (approve) await approval.approveCommand(id, job)
}

// Lượt chạy tách rời khỏi runScheduleNow — đợi tới khi dòng lịch sử đóng.
async function settledRun(id: string) {
  for (let i = 0; i < 100; i++) {
    const run = (await store.loadSchedule(id))?.runs[0]
    if (run && run.status !== 'running') return run
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('run never finished')
}

const sh = (script: string): CommandJob => ({ kind: 'command', program: '/bin/sh', args: ['-c', script] })

describe('command job', () => {
  it('runs an approved program and keeps its last output line', async () => {
    await saveCommand('ok', sh('echo first; echo "-- 3 added"'), true)
    await runner.runScheduleNow('ok')
    const run = await settledRun('ok')
    expect(run.status).toBe('ok')
    expect(run.message).toBe('-- 3 added')
  })

  it('keeps a full, redacted log of the run', async () => {
    await saveCommand('logged', sh('echo line-1; echo "key sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"; echo oops >&2'), true)
    await runner.runScheduleNow('logged')
    const run = await settledRun('logged')
    expect(run.hasLog).toBe(true)
    const { readRunLog } = await import('../run-log.js')
    const text = (await readRunLog('logged', run.id)) ?? ''
    expect(text).toContain("$ /bin/sh -c")
    expect(text).toContain('line-1')
    expect(text).toContain('oops')
    expect(text).not.toContain('BBBBBBBBBBBBBBBBBBBB')
  })

  it('refuses a command planted in a schedule file without approval', async () => {
    await saveCommand('planted', sh('echo pwned'), false)
    await runner.runScheduleNow('planted')
    const run = await settledRun('planted')
    expect(run.status).toBe('error')
    expect(run.message).toMatch(/not approved/)
  })

  it('refuses a command whose args were edited after approval', async () => {
    await saveCommand('edited', sh('echo safe'), true)
    await saveCommand('edited', sh('echo pwned'), false)
    await runner.runScheduleNow('edited')
    expect((await settledRun('edited')).status).toBe('error')
  })

  it('reports a failing exit with the error output', async () => {
    await saveCommand('fails', sh('echo boom >&2; exit 3'), true)
    await runner.runScheduleNow('fails')
    const run = await settledRun('fails')
    expect(run.status).toBe('error')
    expect(run.message).toBe('exit 3: boom')
  })

  it('redacts secrets that the command prints (F6)', async () => {
    await saveCommand('leaky', sh('echo "token sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'), true)
    await runner.runScheduleNow('leaky')
    expect((await settledRun('leaky')).message).not.toContain('AAAAAAAAAAAAAAAAAAAA')
  })
})

describe('runProcess', () => {
  it('hands the child no tokens and none of the host runtime flags (F3)', async () => {
    process.env.GH_TOKEN = 'ghp_should_not_leak'
    process.env.ELECTRON_RUN_AS_NODE = '1'
    try {
      const { stdout } = await runner.runProcess('/usr/bin/env', [], 10_000)
      expect(stdout).not.toContain('GH_TOKEN')
      expect(stdout).not.toContain('ELECTRON_RUN_AS_NODE')
      expect(stdout).toContain('PATH=')
    } finally {
      delete process.env.GH_TOKEN
      delete process.env.ELECTRON_RUN_AS_NODE
    }
  })

  it('kills the whole process group on timeout, grandchildren included (F5)', async () => {
    // Thời lượng lạ (47s) để pgrep không vớ nhầm tiến trình khác trên máy.
    const res = await runner.runProcess('/bin/sh', ['-c', 'sleep 47 & sleep 47'], 300)
    expect(res.timedOut).toBe(true)
    // Tiến trình bị giết rồi vẫn cần chút thời gian để launchd thu dọn — hỏi lại tới 3s.
    const pgrep = (): string => {
      try {
        return execFileSync('pgrep', ['-f', 'sleep 47'], { encoding: 'utf8' }).trim()
      } catch {
        return '' // pgrep exits 1 when nothing matches
      }
    }
    let alive = pgrep()
    for (let i = 0; i < 30 && alive; i++) {
      await new Promise((r) => setTimeout(r, 100))
      alive = pgrep()
    }
    expect(alive).toBe('')
  })
})
