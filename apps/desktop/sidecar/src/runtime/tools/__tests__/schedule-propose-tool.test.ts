// Tests cho propose_schedule (ADR 0108) — agent chỉ đề xuất được lịch TẮT, người dùng
// duyệt mới chạy; ghi thẳng file lịch/hook thì bị permission gate chặn.
//
// HOME tạm vì store lịch nằm ở `~/.awog/schedules` (đặt TRƯỚC khi import module, như
// schedules/__tests__/wakeup.test.ts). Phiên giả lập: tool chỉ cần settings + projectId.
//
// Run: `npx vitest@2 run src/runtime/tools/__tests__/schedule-propose-tool.test.ts`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keychain giả lập: test không được đọc/ghi Keychain thật của máy (sổ duyệt lệnh).
const vault = new Map<string, string>()
vi.mock('../../../credentials/keychain.js', () => ({
  getKeychainValue: async (service: string, account: string) => vault.get(`${service}/${account}`) ?? null,
  setKeychainValue: async (service: string, account: string, value: string) => {
    vault.set(`${service}/${account}`, value)
  },
}))

vi.mock('../../../sessions/store.js', async (orig) => ({
  ...(await orig<typeof import('../../../sessions/store.js')>()),
  loadSession: async (id: string) =>
    id === 'ses-1'
      ? {
          id,
          projectId: 'awog',
          settings: { provider: 'anthropic', modelId: 'claude-x', level: 'medium', mode: 'execute', accountId: 'acc-1' },
        }
      : null,
}))

let home: string
let tool: typeof import('../schedule-propose-tool.js')
let store: typeof import('../../../schedules/store.js')
let runner: typeof import('../../../schedules/runner.js')
let permission: typeof import('../../permission.js')

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-propose-'))
  process.env.HOME = home
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true) // event frames
  tool = await import('../schedule-propose-tool.js')
  store = await import('../../../schedules/store.js')
  runner = await import('../../../schedules/runner.js')
  permission = await import('../../permission.js')
})

afterAll(async () => {
  vi.restoreAllMocks()
  await rm(home, { recursive: true, force: true })
})

describe('propose_schedule', () => {
  it('creates a session-prompt proposal that is OFF, in plan mode, with this session settings', async () => {
    const run = tool.createScheduleProposeRunner('ses-1')
    const r = await run({ name: 'Quét tag mỗi sáng', at: '08:30', prompt: 'Quét tag của tôi' })
    expect(r.isError).toBeUndefined()
    const s = await store.loadSchedule(r.scheduleId!)
    expect(s?.enabled).toBe(false)
    expect(s?.proposedBy?.sessionId).toBe('ses-1')
    expect(s?.trigger).toEqual({ kind: 'daily', time: '08:30' })
    expect(s?.job).toMatchObject({
      kind: 'session-prompt',
      projectId: 'awog',
      settings: { provider: 'anthropic', modelId: 'claude-x', mode: 'plan', accountId: 'acc-1' },
    })
  })

  it('creates a command proposal and never approves it', async () => {
    const run = tool.createScheduleProposeRunner('ses-1')
    const r = await run({ name: 'sync', every_minutes: 15, program: '/bin/echo', args: ['hi'] })
    const s = await store.loadSchedule(r.scheduleId!)
    expect(s?.job).toEqual({ kind: 'command', program: '/bin/echo', args: ['hi'] })
    const { isCommandApproved } = await import('../../../schedules/command-approval.js')
    expect(await isCommandApproved(s!.id, s!.job as never)).toBe(false)
  })

  it('refuses ambiguous or unsafe input with a reason', async () => {
    const run = tool.createScheduleProposeRunner('ses-1')
    expect((await run({ name: 'x', at: '09:00' })).text).toMatch(/exactly one job/)
    expect((await run({ name: 'x', at: '09:00', prompt: 'p', program: '/bin/echo' })).text).toMatch(/exactly one job/)
    expect((await run({ name: 'x', prompt: 'p' })).text).toMatch(/Missing timing/)
    expect((await run({ name: 'x', every_minutes: 5, at: '09:00', prompt: 'p' })).text).toMatch(/not both/)
    expect((await run({ name: 'x', at: '09:00', program: 'python3' })).text).toMatch(/absolute path/)
    expect((await run({ name: 'x', at: '25:00', prompt: 'p' })).isError).toBe(true)
  })

  it('caps proposals per turn', async () => {
    const run = tool.createScheduleProposeRunner('ses-1')
    for (let i = 0; i < tool.MAX_PROPOSALS_PER_TURN; i++) {
      expect((await run({ name: `n${i}`, every_minutes: 30, prompt: 'p' })).isError).toBeUndefined()
    }
    expect((await run({ name: 'one more', every_minutes: 30, prompt: 'p' })).text).toMatch(/limit/)
  })

  it('a proposal never runs — not on demand, not even if its file says enabled', async () => {
    const r = await tool.createScheduleProposeRunner('ses-1')({ name: 'p', every_minutes: 1, prompt: 'p' })
    await expect(runner.runScheduleNow(r.scheduleId!)).rejects.toThrow(/proposed by an agent/)
    const s = (await store.loadSchedule(r.scheduleId!))!
    await store.saveSchedule({ ...s, enabled: true, nextRunAt: new Date(0).toISOString() })
    const tick = await runner.tickSchedules()
    expect(tick.fired).not.toContain(r.scheduleId)
  })
})

describe('agents cannot write schedules or hooks directly', () => {
  it('blocks Write/Edit/Bash that touch .awog/schedules or .awog/hooks', () => {
    const t = permission.touchesAwogAutomation
    expect(t('Write', { file_path: '/Users/x/.awog/schedules/evil.json' })).toBe(true)
    expect(t('Edit', { file_path: '/Users/x/.awog/hooks/h.json' })).toBe(true)
    expect(t('Bash', { command: 'echo {} > ~/.awog/schedules/x.json' })).toBe(true)
    expect(t('Write', { file_path: '/Users/x/proj/src/schedules/a.ts' })).toBe(false)
    expect(t('Read', { file_path: '/Users/x/.awog/schedules/a.json' })).toBe(false)
  })
})
