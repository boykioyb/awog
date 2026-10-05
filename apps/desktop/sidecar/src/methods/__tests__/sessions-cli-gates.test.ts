// Tests cho cổng RPC của "Open in CLI":
//   - sessions.openCli — định tuyến provider→runtime (anthropic→claude,
//     openai-không-custom-endpoint→codex, Pi runtime → từ chối), cổng BẬN
//     (turn in flight), ghép kind (native vs devin), idempotent alreadyOpen.
//   - sessions.sendMessage — cổng gắn CLI: PTY agent còn sống thì từ chối TRƯỚC
//     khi persist bất kỳ message nào (fork ~/.claude transcript chung).
//
// Toàn bộ spawn/registry/store/runner đều mock — test này chỉ xác minh LOGIC
// CỔNG, không phải PTY/importer (đã có cli-registry.test.ts + cli-import*.test.ts).
//
// Run: `npx vitest run src/methods/__tests__/sessions-cli-gates.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch } from '../../transport/rpc.js'
import type { Session } from '../../types/shared.js'

// ─── Mock surface ────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  session: undefined as Session | undefined,
  active: [] as string[],
  customEndpoint: false,
  attached: false,
  openCliLink: vi.fn(
    async (args: { sessionId: string; kind: string }) => ({
      terminalId: 'term-1',
      kind: args.kind,
      linked: args.kind !== 'devin',
    }),
  ),
  appendMessage: vi.fn(async () => {}),
  updateSessionMetadata: vi.fn(async () => {}),
  truncateSession: vi.fn(async () => {}),
  compactSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  runStream: vi.fn(async () => {
    throw new Error('RUNSTREAM_REACHED')
  }),
  registerAborter: vi.fn(),
  unregisterAborter: vi.fn(),
  emitted: [] as Array<{ type: string; payload: unknown }>,
}))

vi.mock('../../sessions/store.js', () => ({
  loadSession: async (id: string) => (h.session && h.session.id === id ? h.session : null),
  appendMessage: h.appendMessage,
  updateSessionMetadata: h.updateSessionMetadata,
  truncateSession: h.truncateSession,
  compactSession: h.compactSession,
  deleteSession: h.deleteSession,
}))

vi.mock('../../sessions/runner.js', () => ({
  activeSessionIds: () => h.active,
  hasCustomEndpoint: async () => h.customEndpoint,
  runStream: h.runStream,
  registerAborter: h.registerAborter,
  unregisterAborter: h.unregisterAborter,
  abortSession: () => 0,
}))

vi.mock('../../sessions/cli-registry.js', async () => {
  const { RpcError } = await import('../../transport/rpc.js')
  return {
    openCliLink: h.openCliLink,
    isCliAttached: () => h.attached,
    cliLinkFor: () => undefined,
    cliLastLinkFor: () => undefined,
    // Mirror hợp đồng thật của registry: link sống → -32021. Hành vi stale-link
    // đã được phủ trong cli-registry.test.ts (registry thật).
    assertCliDetachedForDelete: () => {
      if (h.attached) {
        throw new RpcError(
          -32021,
          'A CLI is still attached to this session — close it before deleting the session',
        )
      }
    },
  }
})

// Dependencies của bốn mutator — mock phẳng để test chỉ soi LOGIC CỔNG.
vi.mock('../../projects/store.js', () => ({ loadProject: async () => null }))
vi.mock('../../runtime/claude-sdk/store.js', () => ({ removeSdkSession: async () => {} }))
vi.mock('../../sessions/snapshots.js', () => ({
  restoreSnapshot: async () => ({ ok: false }),
  deleteSnapshots: async () => {},
}))
vi.mock('../../sessions/permissions.js', () => ({ clearSessionPermissions: () => {} }))
vi.mock('../../runtime/tools/mcp-tools.js', () => ({ releaseSessionMcp: () => {} }))
vi.mock('../../sessions/bg-registry.js', () => ({ cleanupSessionBackground: () => {} }))

vi.mock('../../transport/stdio.js', () => ({
  emit: (type: string, payload: unknown) => {
    h.emitted.push({ type, payload })
  },
}))

vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

await import('../sessions.open-cli.js')
await import('../sessions.send-message.js')
await import('../sessions.compact.js')
await import('../sessions.truncate.js')
await import('../sessions.rewind.js')
await import('../sessions.delete.js')

// ─── Helpers ─────────────────────────────────────────────────────────────────

let home: string
let originalHome: string | undefined

function makeSession(overrides: Record<string, unknown> = {}): Session {
  return {
    id: 'ses-gate',
    messages: [],
    settings: { provider: 'anthropic', modelId: 'm', level: 'medium', mode: 'ask' },
    workspaceFolder: '/tmp/ws',
    ...overrides,
  } as unknown as Session
}

const OPEN = { sessionId: 'ses-gate', cols: 80, rows: 24 }
const SEND = {
  sessionId: 'ses-gate',
  messageId: 'msg_aaaaaaaa',
  text: 'hello',
  settings: { provider: 'anthropic', modelId: 'm', level: 'medium', mode: 'ask' },
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-cligates-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  delete process.env.CLAUDE_CONFIG_DIR
  h.session = makeSession()
  h.active = []
  h.customEndpoint = false
  h.attached = false
  h.emitted = []
  h.openCliLink.mockClear()
  h.appendMessage.mockClear()
  h.truncateSession.mockClear()
  h.compactSession.mockClear()
  h.deleteSession.mockClear()
  h.runStream.mockClear()
  h.registerAborter.mockClear()
  h.unregisterAborter.mockClear()
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

// ─── sessions.openCli ────────────────────────────────────────────────────────

describe('sessions.openCli — định tuyến runtime', () => {
  it('anthropic + cli vắng → kind claude (native)', async () => {
    const res = (await dispatch('sessions.openCli', OPEN)) as Record<string, unknown>
    expect(res.cli).toBe('claude')
    expect(res.linked).toBe(true)
    expect(h.openCliLink).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'ses-gate', kind: 'claude' }),
    )
  })

  it('openai không custom endpoint + cli vắng → kind codex', async () => {
    h.session = makeSession({ settings: { provider: 'openai' } })
    const res = (await dispatch('sessions.openCli', OPEN)) as Record<string, unknown>
    expect(res.cli).toBe('codex')
    expect(h.openCliLink).toHaveBeenCalledWith(expect.objectContaining({ kind: 'codex' }))
  })

  it('openai QUA custom endpoint (Pi runtime) → -32021 kể cả khi không chỉ định cli', async () => {
    h.customEndpoint = true
    h.session = makeSession({ settings: { provider: 'openai' } })
    await expect(dispatch('sessions.openCli', OPEN)).rejects.toMatchObject({ code: -32021 })
    expect(h.openCliLink).not.toHaveBeenCalled()
  })

  it('google/Pi runtime → -32021 "not available" — KHÔNG có CLI nào mở được', async () => {
    h.session = makeSession({ settings: { provider: 'google' } })
    await expect(dispatch('sessions.openCli', OPEN)).rejects.toMatchObject({ code: -32021 })
    // Kể cả devin — cổng `!native` ném trước nhánh cho phép devin
    await expect(
      dispatch('sessions.openCli', { ...OPEN, cli: 'devin' }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.openCliLink).not.toHaveBeenCalled()
  })

  it('anthropic + cli=codex → -32021 (không phải runtime của phiên)', async () => {
    await expect(
      dispatch('sessions.openCli', { ...OPEN, cli: 'codex' }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.openCliLink).not.toHaveBeenCalled()
  })

  it('openai + cli=claude → -32021', async () => {
    h.session = makeSession({ settings: { provider: 'openai' } })
    await expect(
      dispatch('sessions.openCli', { ...OPEN, cli: 'claude' }),
    ).rejects.toMatchObject({ code: -32021 })
  })

  it('anthropic + cli=devin → được phép (unlinked option)', async () => {
    const res = (await dispatch('sessions.openCli', { ...OPEN, cli: 'devin' })) as Record<
      string,
      unknown
    >
    expect(res.cli).toBe('devin')
    expect(res.linked).toBe(false)
    expect(h.openCliLink).toHaveBeenCalledWith(expect.objectContaining({ kind: 'devin' }))
  })

  it('alreadyOpen từ registry truyền thẳng ra response', async () => {
    h.openCliLink.mockResolvedValueOnce({
      terminalId: 'term-1',
      kind: 'claude',
      linked: true,
      alreadyOpen: true,
    })
    const res = (await dispatch('sessions.openCli', OPEN)) as Record<string, unknown>
    expect(res.alreadyOpen).toBe(true)
  })
})

describe('sessions.openCli — cổng chặn', () => {
  it('session không tồn tại → -32004', async () => {
    h.session = undefined
    await expect(dispatch('sessions.openCli', OPEN)).rejects.toMatchObject({ code: -32004 })
  })

  it('turn đang chạy → -32021, không spawn', async () => {
    h.active = ['ses-gate']
    await expect(dispatch('sessions.openCli', OPEN)).rejects.toMatchObject({
      code: -32021,
      message: expect.stringContaining('turn in flight'),
    })
    expect(h.openCliLink).not.toHaveBeenCalled()
  })

  it('busy check đứng TRƯỚC runtime check (busy + google → busy error)', async () => {
    h.active = ['ses-gate']
    h.session = makeSession({ settings: { provider: 'google' } })
    await expect(dispatch('sessions.openCli', OPEN)).rejects.toMatchObject({
      code: -32021,
      message: expect.stringContaining('turn in flight'),
    })
  })

  it('params thiếu cols/rows → -32602 (zod)', async () => {
    await expect(
      dispatch('sessions.openCli', { sessionId: 'ses-gate' }),
    ).rejects.toMatchObject({ code: -32602 })
    await expect(
      dispatch('sessions.openCli', { ...OPEN, cols: 0 }),
    ).rejects.toMatchObject({ code: -32602 })
    await expect(
      dispatch('sessions.openCli', { ...OPEN, cli: 'gemini' }),
    ).rejects.toMatchObject({ code: -32602 })
  })
})

// ─── sessions.sendMessage — cổng gắn CLI ─────────────────────────────────────

describe('sessions.sendMessage — cổng CLI attached', () => {
  it('PTY CLI còn sống → -32021 TRƯỚC khi persist message nào', async () => {
    h.attached = true
    await expect(dispatch('sessions.sendMessage', SEND)).rejects.toMatchObject({
      code: -32021,
      message: expect.stringContaining('attached to a CLI'),
    })
    // Cổng ném trước appendMessage — không message user nào được ghi
    expect(h.appendMessage).not.toHaveBeenCalled()
    expect(h.runStream).not.toHaveBeenCalled()
  })

  it('không attach → cổng qua được, turn đi tiếp (append user msg rồi runStream)', async () => {
    h.attached = false
    // runStream mock ném marker — đủ để chứng minh flow đã qua cổng
    await expect(dispatch('sessions.sendMessage', SEND)).rejects.toMatchObject({
      code: -32603, // marker Error → internal
    })
    expect(h.appendMessage).toHaveBeenCalled()
    expect(h.runStream).toHaveBeenCalled()
  })

  it('params vẫn validate trước cổng (text rỗng + attached → -32602 không phải -32021)', async () => {
    h.attached = true
    await expect(
      dispatch('sessions.sendMessage', { ...SEND, text: '' }),
    ).rejects.toMatchObject({ code: -32602 })
  })

  it('CLI gắn vào trong khe registerAborter→persist (TOCTOU) → -32021, aborter gỡ + abort', async () => {
    // Cổng đầu hàm thấy attached=false và qua; khi aborter đăng ký xong, link
    // vừa được gắn (spawn resolve đúng khe) — re-check phải bắt được.
    h.registerAborter.mockImplementationOnce(() => {
      h.attached = true
    })
    await expect(dispatch('sessions.sendMessage', SEND)).rejects.toMatchObject({
      code: -32021,
      message: expect.stringContaining('attached to a CLI'),
    })
    // Aborter được gỡ đúng messageId — không để turn "ma" chặn abort/sau này
    expect(h.unregisterAborter).toHaveBeenCalledWith('msg_aaaaaaaa')
    // Không persist message nào, không chạy runtime
    expect(h.appendMessage).not.toHaveBeenCalled()
    expect(h.runStream).not.toHaveBeenCalled()
  })
})

// ─── Mutator gates — CLI attached ────────────────────────────────────────────

describe('mutator gates — CLI attached', () => {
  const SES_WITH_MSG = () =>
    makeSession({
      messages: [{ id: 'msg_1', role: 'user', text: 'hi', at: '2026-01-01T00:00:00.000Z' }],
    })

  it('sessions.compact → -32021 khi CLI attached (compact chạy được khi detached)', async () => {
    h.session = SES_WITH_MSG()
    h.attached = true
    await expect(
      dispatch('sessions.compact', {
        sessionId: 'ses-gate',
        messageId: 'msg_cp_1',
        provider: 'anthropic',
        modelId: 'm',
      }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.compactSession).not.toHaveBeenCalled()
    expect(h.runStream).not.toHaveBeenCalled()

    // Detached: cổng qua — compact chạy tới runStream (mock ném marker → -32603? không:
    // compact nuốt lỗi runStream thành {ok:false,reason:'error'} — đủ chứng minh đã qua cổng)
    h.attached = false
    const res = (await dispatch('sessions.compact', {
      sessionId: 'ses-gate',
      messageId: 'msg_cp_2',
      provider: 'anthropic',
      modelId: 'm',
    })) as { ok: boolean }
    expect(res.ok).toBe(false) // runStream ném → reason 'error', không phải cổng chặn
    expect(h.runStream).toHaveBeenCalled()
  })

  it('sessions.truncate → -32021 khi CLI attached, không đụng transcript', async () => {
    h.session = SES_WITH_MSG()
    h.attached = true
    await expect(
      dispatch('sessions.truncate', { sessionId: 'ses-gate', keepThroughId: null }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.truncateSession).not.toHaveBeenCalled()

    h.attached = false
    const res = (await dispatch('sessions.truncate', {
      sessionId: 'ses-gate',
      keepThroughId: null,
    })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(h.truncateSession).toHaveBeenCalledWith('ses-gate', null)
  })

  it('sessions.rewind → -32021 khi CLI attached', async () => {
    h.session = SES_WITH_MSG()
    h.attached = true
    await expect(
      dispatch('sessions.rewind', { sessionId: 'ses-gate', messageId: 'msg_1' }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.truncateSession).not.toHaveBeenCalled()

    h.attached = false
    const res = (await dispatch('sessions.rewind', {
      sessionId: 'ses-gate',
      messageId: 'msg_1',
    })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(h.truncateSession).toHaveBeenCalledWith('ses-gate', 'msg_1')
  })

  it('sessions.delete → -32021 khi CLI link còn sống (gate của registry)', async () => {
    h.session = SES_WITH_MSG()
    h.attached = true
    await expect(
      dispatch('sessions.delete', { id: 'ses-gate' }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.deleteSession).not.toHaveBeenCalled()

    h.attached = false // link đã detach (hoặc stale đã được registry gỡ)
    const res = (await dispatch('sessions.delete', { id: 'ses-gate' })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(h.deleteSession).toHaveBeenCalledWith('ses-gate')
  })
})

// ─── sendMessage — tự cứu khi tràn ngữ cảnh ──────────────────────────────────
// "Prompt is too long" giết phiên điều phối vĩnh viễn (không ai bấm /compact):
// mọi wake sau đập vào cùng bức tường. sendMessage bắt đúng lỗi overflow →
// chạy runStream slashCommand 'compact' → persist checkpoint → retry ĐÚNG một
// lần với [summary + kept turns] (resume handles bị fold xoá).
describe('sendMessage — tự cứu khi tràn ngữ cảnh', () => {
  const SES_CTX = () =>
    makeSession({
      sdkSessionId: 'sdk-1',
      messages: [{ id: 'msg_1', role: 'user', text: 'hi', at: '2026-01-01T00:00:00.000Z' }],
    })
  const COMPACTION = {
    summary: 'bản tóm tắt',
    firstKeptMessageId: 'msg_1',
    tokensBefore: 180_000,
    at: '2026-01-01T00:00:01.000Z',
  }
  const USAGE = { input_tokens: 0, output_tokens: 0 }
  const OVERFLOW = {
    text: '',
    stopReason: 'error',
    errorMessage: 'Claude Code returned an error result: Prompt is too long',
    usage: USAGE,
  }

  it('lượt overflow → auto-compact + retry: reply về đúng, retry re-seed (gỡ sdkSessionId, mang compaction)', async () => {
    h.session = SES_CTX()
    const calls: Array<Record<string, unknown>> = []
    h.runStream.mockImplementation(async (args: Record<string, unknown>) => {
      calls.push(args)
      if (args.slashCommand === 'compact') return { compaction: COMPACTION }
      if (calls.filter((c) => c.slashCommand !== 'compact').length === 1) return OVERFLOW
      return { text: 'trả lời sau khi nén', stopReason: 'end_turn', modelUsed: 'm', usage: USAGE }
    })
    const res = (await dispatch('sessions.sendMessage', SEND)) as { text?: string }
    expect(res.text).toBe('trả lời sau khi nén')
    expect(h.runStream).toHaveBeenCalledTimes(3)
    expect(calls[1]?.slashCommand).toBe('compact')
    expect(h.compactSession).toHaveBeenCalledWith('ses-gate', COMPACTION)
    // Lượt đầu resume phiên SDK cũ; lượt retry re-seed — không resume handle.
    expect(calls[0]?.sdkSessionId).toBe('sdk-1')
    expect(calls[2]?.sdkSessionId).toBeUndefined()
    expect(calls[2]?.compaction).toMatchObject(COMPACTION)
  })

  it('compact không ra checkpoint → giữ nguyên lỗi, không retry', async () => {
    h.session = SES_CTX()
    h.runStream.mockImplementation(async (args: Record<string, unknown>) =>
      args.slashCommand === 'compact' ? {} : OVERFLOW,
    )
    const res = (await dispatch('sessions.sendMessage', SEND)) as {
      errorMessage?: string
    }
    expect(res.errorMessage).toContain('Prompt is too long')
    expect(h.runStream).toHaveBeenCalledTimes(2)
    expect(h.compactSession).not.toHaveBeenCalled()
  })

  it('CLI gắn giữa lượt → KHÔNG tự cứu (compact lệch transcript của CLI — cùng cổng sessions.compact)', async () => {
    h.session = SES_CTX()
    h.runStream.mockImplementation(async () => {
      h.attached = true // CLI gắn SAU cổng đầu + re-check registerAborter
      return OVERFLOW
    })
    const res = (await dispatch('sessions.sendMessage', SEND)) as {
      errorMessage?: string
    }
    expect(res.errorMessage).toContain('Prompt is too long')
    expect(h.runStream).toHaveBeenCalledTimes(1)
    expect(h.compactSession).not.toHaveBeenCalled()
  })

  it('lỗi khác (không phải overflow) → không compact, không retry', async () => {
    h.session = SES_CTX()
    h.runStream.mockImplementation(async () => ({
      text: '',
      stopReason: 'error',
      errorMessage: 'Claude Code returned an error result: API rate limit reached',
      usage: USAGE,
    }))
    const res = (await dispatch('sessions.sendMessage', SEND)) as {
      errorMessage?: string
    }
    expect(res.errorMessage).toContain('rate limit')
    expect(h.runStream).toHaveBeenCalledTimes(1)
    expect(h.compactSession).not.toHaveBeenCalled()
  })

  it('retry vẫn overflow → chết, KHÔNG lặp vô hạn (đúng 1 lần cứu)', async () => {
    h.session = SES_CTX()
    h.runStream.mockImplementation(async (args: Record<string, unknown>) =>
      args.slashCommand === 'compact' ? { compaction: COMPACTION } : OVERFLOW,
    )
    const res = (await dispatch('sessions.sendMessage', SEND)) as {
      errorMessage?: string
    }
    expect(res.errorMessage).toContain('Prompt is too long')
    // turn → compact → retry: đúng 3 lần gọi, không lần thứ 4.
    expect(h.runStream).toHaveBeenCalledTimes(3)
    expect(h.compactSession).toHaveBeenCalledTimes(1)
  })
})
