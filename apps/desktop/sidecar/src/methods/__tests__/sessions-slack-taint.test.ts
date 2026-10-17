// Chốt của sessions.sendMessage cho phiên đã nhiễm nội dung Slack (ADR 0107 D-4):
// MỌI lượt bỏ autoApprove, kẹp `execute`/`accept-edits` về `ask`, SSH `auto` về
// `prompt`. Kiểm ở args truyền vào runStream — điểm chung của cả ba runtime.
//
// Mock cùng khuôn sessions-cli-gates.test.ts; chỉ soi settings đi vào runtime.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch } from '../../transport/rpc.js'
import type { Session } from '../../types/shared.js'

type RunArgs = { settings: { mode: string; sshApprovalMode?: string }; autoApprove?: boolean }

const h = vi.hoisted(() => ({
  tainted: false,
  session: undefined as Session | undefined,
  runArgs: [] as RunArgs[],
}))

vi.mock('../../slack/taint.js', () => ({ isSessionSlackTainted: async () => h.tainted }))

vi.mock('../../sessions/store.js', () => ({
  loadSession: async (id: string) => (h.session && h.session.id === id ? h.session : null),
  appendMessage: async () => {},
  updateSessionMetadata: async () => {},
  truncateSession: async () => {},
  compactSession: async () => {},
  deleteSession: async () => {},
}))

vi.mock('../../sessions/runner.js', () => ({
  activeSessionIds: () => [],
  hasCustomEndpoint: async () => false,
  runStream: async (args: RunArgs) => {
    h.runArgs.push(args)
    throw new Error('RUNSTREAM_REACHED')
  },
  registerAborter: () => {},
  unregisterAborter: () => {},
  abortSession: () => 0,
}))

vi.mock('../../sessions/cli-registry.js', () => ({
  openCliLink: async () => ({}),
  isCliAttached: () => false,
  cliLinkFor: () => undefined,
  cliLastLinkFor: () => undefined,
  assertCliDetachedForDelete: () => {},
}))

vi.mock('../../projects/store.js', () => ({ loadProject: async () => null }))
vi.mock('../../transport/stdio.js', () => ({ emit: () => {} }))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

await import('../sessions.send-message.js')

let home: string
let originalHome: string | undefined

const send = (mode: string, extra: Record<string, unknown> = {}) => ({
  sessionId: 'ses-slack',
  messageId: 'msg_bbbbbbbb',
  text: 'hello',
  settings: { provider: 'anthropic', modelId: 'm', level: 'medium', mode, sshApprovalMode: 'auto' },
  ...extra,
})

async function runOnce(payload: unknown): Promise<RunArgs> {
  await expect(dispatch('sessions.sendMessage', payload)).rejects.toMatchObject({ code: -32603 })
  const args = h.runArgs.at(-1)
  if (!args) throw new Error('runStream not reached')
  return args
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-slacktaint-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  h.session = {
    id: 'ses-slack',
    messages: [],
    settings: { provider: 'anthropic', modelId: 'm', level: 'medium', mode: 'ask' },
  } as unknown as Session
  h.runArgs = []
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('sessions.sendMessage — phiên nhiễm Slack', () => {
  it('kẹp execute / accept-edits về ask, tắt autoApprove và SSH auto', async () => {
    h.tainted = true
    for (const mode of ['execute', 'accept-edits']) {
      const args = await runOnce(send(mode, { autoApprove: true }))
      expect(args.settings.mode).toBe('ask')
      expect(args.settings.sshApprovalMode).toBe('prompt')
      expect(args.autoApprove).toBeUndefined()
    }
    // plan vẫn là plan (chặt hơn ask).
    expect((await runOnce(send('plan'))).settings.mode).toBe('plan')
  })

  it('phiên sạch giữ nguyên mode + autoApprove người dùng chọn', async () => {
    h.tainted = false
    const args = await runOnce(send('execute', { autoApprove: true }))
    expect(args.settings.mode).toBe('execute')
    expect(args.settings.sshApprovalMode).toBe('auto')
    expect(args.autoApprove).toBe(true)
  })
})
