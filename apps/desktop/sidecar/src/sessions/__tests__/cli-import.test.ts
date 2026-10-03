// Tests cho "Open in CLI" transcript importer (sessions/cli-import.ts).
//
// Vì sao fixture-driven thay vì mock parser: rủi ro thật của importer nằm ở
// VÒNG NGOÀI — tìm file đúng root, cursor byte/step tua đúng chỗ, nửa dòng cuối
// không bị nuốt, dedupe shared-history, adoption sdkSessionId — nên mỗi test
// dựng một transcript THẬT trong $HOME tạm rồi gọi `importCliTranscript` trọn
// vẹn, chỉ mock ba bề mặt không-định-dạng (store in-memory, cli-registry vì nó
// kéo node-pty, emit để bắt `session.cli-synced`).
//
// Run: `npx vitest run src/sessions/__tests__/cli-import.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch } from '../../transport/rpc.js'
import type { Session, SessionCliKind, SessionMessage } from '../../types/shared.js'
import type { CliLink } from '../cli-registry.js'

// ─── Mock surface ────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  appended: [] as SessionMessage[],
  session: undefined as Session | undefined,
  // link "cuối" — cliLinkFor/cliLastLinkFor trả cùng nó trong test.
  link: undefined as CliLink | undefined,
  // activeSessionIds() — syncCli từ chối khi turn đang chạy.
  active: [] as string[],
  emitted: [] as Array<{ type: string; payload: unknown }>,
}))

vi.mock('../store.js', () => ({
  loadSession: async (id: string) => (h.session && h.session.id === id ? h.session : null),
  appendMessage: async (_id: string, m: SessionMessage) => {
    h.appended.push(m)
    h.session?.messages.push(m)
  },
  updateSessionMetadata: async (_id: string, patch: Record<string, unknown>) => {
    Object.assign(h.session ?? {}, patch)
  },
}))

vi.mock('../cli-registry.js', () => ({
  cliLinkFor: (id: string) => (h.link && h.link.sessionId === id ? h.link : undefined),
  cliLastLinkFor: (id: string) => (h.link && h.link.sessionId === id ? h.link : undefined),
  isCliAttached: () => false,
  // Workspace phiên — devin transcript discovery kiểm chứng nội dung file có
  // chứa path này (ATIF không ghi cwd ở metadata).
  resolveCliCwd: async () => '/tmp/ws',
}))

// sync-cli.ts kiểm turn-in-flight qua runner — mock phẳng, điều khiển bằng h.active.
vi.mock('../runner.js', () => ({
  activeSessionIds: () => h.active,
}))

vi.mock('../../transport/stdio.js', () => ({
  emit: (type: string, payload: unknown) => {
    h.emitted.push({ type, payload })
  },
}))

vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

// Đăng ký handler `sessions.syncCli` — import side-effect SAU khi mock.
await import('../../methods/sessions.sync-cli.js')
const { importCliTranscript } = await import('../cli-import.js')

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let home: string
let originalHome: string | undefined
const sessionId = 'ses-cli-import'
const SPAWN = Date.parse('2026-03-03T10:00:00.000Z')

function makeSession(overrides: Record<string, unknown> = {}): Session {
  return {
    id: sessionId,
    messages: [],
    settings: { provider: 'anthropic', accountId: 'acc-1' },
    ...overrides,
  } as unknown as Session
}

function makeLink(kind: SessionCliKind, extra: Record<string, unknown> = {}): CliLink {
  return {
    terminalId: 'term-1',
    sessionId,
    kind,
    cwd: '/tmp/ws',
    spawnedAt: SPAWN,
    linked: kind !== 'devin',
    ...extra,
  }
}

async function writeClaudeJsonl(dir: string, sdkId: string, lines: unknown[]): Promise<string> {
  const projects = join(home, '.claude', 'projects', dir)
  await mkdir(projects, { recursive: true })
  const file = join(projects, `${sdkId}.jsonl`)
  // Object → JSON + '\n'; string truyền nguyên xi (để fixture tự khống chế cắt
  // dòng — test nửa-dòng-cuối cần vậy).
  await writeFile(
    file,
    lines.map((l) => (typeof l === 'string' ? l : `${JSON.stringify(l)}\n`)).join(''),
  )
  // Importer chỉ nhận file qua insideRoot → con trỏ persist là REALPATH (macOS
  // /var → /private/var). Fixture trả realpath để cursor test khớp.
  return realpath(file)
}

function claudeUserEntry(text: string, ts = '2026-03-03T10:05:00.000Z'): Record<string, unknown> {
  return {
    type: 'user',
    uuid: `u-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: ts,
    message: { role: 'user', content: text },
  }
}

function claudeAssistantEntry(
  content: unknown[],
  ts = '2026-03-03T10:06:00.000Z',
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: `a-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: ts,
    message: {
      role: 'assistant',
      content,
      model: 'claude-opus-4-7',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1,
      },
    },
    ...extra,
  }
}

function lastCursor(kind: SessionCliKind): { file: string; offset: number } | undefined {
  return h.session?.cliImport?.[kind]
}

function emittedSyncs(): Array<{ type: string; payload: unknown }> {
  return h.emitted.filter((e) => e.type === 'session.cli-synced')
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-cliimport-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  delete process.env.CLAUDE_CONFIG_DIR
  h.appended = []
  h.emitted = []
  h.link = undefined
  h.active = []
  h.session = makeSession()
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

// ─── Claude JSONL ────────────────────────────────────────────────────────────

describe('claude transcript import', () => {
  it('gộp assistant liên tiếp, gập tool_result, cộng dồn usage, lọc meta/sidechain', async () => {
    h.session = makeSession({ sdkSessionId: 'sdk-1' })
    h.link = makeLink('claude')
    const file = await writeClaudeJsonl('-tmp-ws', 'sdk-1', [
      // meta — lọc
      { type: 'user', isMeta: true, timestamp: '2026-03-03T10:04:00.000Z', message: { role: 'user', content: '<local-command-stdout>x</local-command-stdout>' } },
      claudeUserEntry('merge nhánh này đi', '2026-03-03T10:05:00.000Z'),
      // turn 1: hai entry assistant liên tiếp phải gộp thành MỘT agent message
      claudeAssistantEntry(
        [
          { type: 'text', text: 'Để xem diff trước.' },
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'git diff' } },
        ],
        '2026-03-03T10:06:00.000Z',
      ),
      // tool_result nằm trong user-entry — gập vào step, KHÔNG thành user msg
      {
        type: 'user',
        uuid: 'u-tr',
        timestamp: '2026-03-03T10:06:30.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'diff --git a/x b/x' }],
        },
      },
      claudeAssistantEntry([{ type: 'text', text: 'Diff ổn, merge thôi.' }], '2026-03-03T10:07:00.000Z'),
      // sidechain (Task sub-agent) — lọc
      claudeAssistantEntry(
        [{ type: 'text', text: 'subagent nói gì đó' }],
        '2026-03-03T10:07:30.000Z',
        { isSidechain: true },
      ),
      claudeUserEntry('ok merge đi', '2026-03-03T10:08:00.000Z'),
      claudeAssistantEntry([{ type: 'text', text: 'Đã merge.' }], '2026-03-03T10:09:00.000Z'),
    ])

    const r = await importCliTranscript(sessionId, 'claude')

    expect(r.imported).toBe(4) // user, agent(2 entries gộp), user, agent
    const [u1, a1, u2, a2] = h.appended
    expect(u1).toMatchObject({ role: 'user', text: 'merge nhánh này đi', via: 'claude' })
    expect(u1.at).toBe('2026-03-03T10:05:00.000Z')
    expect(a1.role).toBe('agent')
    expect(a1.text).toContain('Để xem diff trước.')
    expect(a1.text).toContain('Diff ổn, merge thôi.')
    // tool_use → step đã được tool_result gập thành 'done' + detail
    const bash = a1.steps?.find((s) => s.id === 'tu_1')
    expect(bash).toMatchObject({ kind: 'tool', tool: 'terminal', status: 'done' })
    // usage cộng dồn 2 entry: input 10+10, output 5+5, cache_read 2+2, create 1+1
    expect(a1.usage).toMatchObject({
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
    })
    expect(a1.modelUsed).toBe('claude-opus-4-7')
    expect(u2).toMatchObject({ role: 'user', text: 'ok merge đi' })
    expect(a2.text).toBe('Đã merge.')
    // cursor = đúng cỡ file (mọi dòng đều hoàn chỉnh)
    const cursor = lastCursor('claude')
    expect(cursor?.file).toBe(file)
    expect(cursor?.offset).toBe((await stat(file)).size)
    // session.cli-synced bắn cả khi có message lẫn không
    expect(emittedSyncs()).toEqual([
      { type: 'session.cli-synced', payload: { sessionId, imported: 4 } },
    ])
  })

  it('nửa dòng JSONL cuối file KHÔNG được consume — để lại cho lần sync sau', async () => {
    h.session = makeSession({ sdkSessionId: 'sdk-partial' })
    const full = JSON.stringify(claudeUserEntry('câu đầu')) + '\n'
    // Cắt một dòng assistant hoàn chỉnh ngang giữa — nửa cuối chưa có '\n'
    const assistant =
      JSON.stringify(claudeAssistantEntry([{ type: 'text', text: 'đã xong' }])) + '\n'
    const cut = Math.floor(assistant.length / 2)
    const file = await writeClaudeJsonl('-tmp-ws', 'sdk-partial', [
      `${full}${assistant.slice(0, cut)}`,
    ])

    const r1 = await importCliTranscript(sessionId, 'claude')
    expect(r1.imported).toBe(1)
    expect(h.appended[0].text).toBe('câu đầu')
    // offset dừng đúng tại newline cuối — nửa dòng còn lại chưa đọc.
    // Cursor là BYTE offset: 'câu đầu' có ký tự multibyte nên dùng byteLength.
    expect(lastCursor('claude')?.offset).toBe(Buffer.byteLength(full))

    // CLI viết nốt dòng đó + thêm một user entry
    await appendFile(
      file,
      assistant.slice(cut) + JSON.stringify(claudeUserEntry('câu hai', '2026-03-03T10:10:00.000Z')) + '\n',
    )
    const r2 = await importCliTranscript(sessionId, 'claude')
    expect(r2.imported).toBe(2)
    expect(h.appended.map((m) => m.role)).toEqual(['user', 'agent', 'user'])
    expect(h.appended[1].text).toBe('đã xong')
    expect(lastCursor('claude')?.offset).toBe((await stat(file)).size)
  })

  it('nhận pendingSdkSessionId: adopt sdkSessionId TRƯỚC khi import', async () => {
    h.session = makeSession() // chưa có sdkSessionId — spawn đã mint --session-id
    h.link = makeLink('claude', { pendingSdkSessionId: 'pend-9' })
    await writeClaudeJsonl('-tmp-ws', 'pend-9', [claudeUserEntry('xin chào từ CLI')])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
    expect(h.session?.sdkSessionId).toBe('pend-9')
    expect(h.appended[0].text).toBe('xin chào từ CLI')
  })

  it('shared-history: entry trùng message AWOG đã có không được import lại', async () => {
    // Phiên đã chạy một lượt AWOG (SDK ghi vào cùng file ~/.claude này) rồi
    // người dùng mở CLI resume và chat thêm.
    const existing: SessionMessage = {
      id: 'msg_u_aaa',
      role: 'user',
      text: 'merge nhánh này đi',
      at: '2026-03-03T09:00:00.000Z',
    }
    h.session = makeSession({ sdkSessionId: 'sdk-dup', messages: [existing] })
    h.link = makeLink('claude')
    await writeClaudeJsonl('-tmp-ws', 'sdk-dup', [
      // lượt AWOG cũ — timestamp TRƯỚC spawn, và text trùng message đã có
      claudeUserEntry('merge nhánh này đi', '2026-03-03T09:00:00.500Z'),
      claudeAssistantEntry([{ type: 'text', text: 'Để xem diff trước.' }], '2026-03-03T09:01:00.000Z'),
      // lượt gõ trong CLI — SAU spawn
      claudeUserEntry('còn phần test chưa chạy', '2026-03-03T10:05:00.000Z'),
      claudeAssistantEntry([{ type: 'text', text: 'Chạy test ngay.' }], '2026-03-03T10:06:00.000Z'),
    ])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(2) // chỉ lượt CLI mới
    expect(h.appended.map((m) => m.text)).toEqual(['còn phần test chưa chạy', 'Chạy test ngay.'])
    // session gốc vẫn chỉ có 1 message cũ + 2 mới — không bản sao
    expect(h.session?.messages).toHaveLength(3)
  })

  it('transcriptFile ngoài root ~/.claude/projects bị từ chối', async () => {
    const stray = join(home, 'stray.jsonl')
    await writeFile(stray, JSON.stringify(claudeUserEntry('nên bị bỏ')) + '\n')
    const r = await importCliTranscript(sessionId, 'claude', { transcriptFile: stray })
    expect(r.imported).toBe(0)
    expect(h.appended).toHaveLength(0)
    expect(emittedSyncs()).toHaveLength(1) // vẫn emit cho UI
  })

  it('file thu nhỏ hơn cursor → đọc lại từ đầu', async () => {
    h.session = makeSession({
      sdkSessionId: 'sdk-rot',
      cliImport: { claude: { file: '', offset: 9999 } },
    })
    const file = await writeClaudeJsonl('-tmp-ws', 'sdk-rot', [claudeUserEntry('sau rotate')])
    // cursor.file khác → offset 0 rồi; để cover nhánh "shrank" thì cho file khớp
    h.session.cliImport = { claude: { file, offset: 99999 } }
    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('sau rotate')
  })
})

// ─── Codex rollout ───────────────────────────────────────────────────────────

describe('codex rollout import', () => {
  const THREAD = 'thr-abc-123'

  async function writeRollout(lines: unknown[]): Promise<string> {
    const dir = join(home, '.awog', 'codex', 'acc-1', 'sessions', '2026', '03', '03')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `rollout-2026-03-03T10-19-20-${THREAD}.jsonl`)
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    return realpath(file)
  }

  function env(type: string, payload: unknown, ts = '2026-03-03T10:20:00.000Z') {
    return { timestamp: ts, ordinal: 0, type, payload }
  }

  it('parse phòng thủ: response_item + envelope khác, unknown item đếm rồi bỏ', async () => {
    h.session = makeSession({ codexThreadId: THREAD, settings: { provider: 'openai', accountId: 'acc-1' } })
    h.link = makeLink('codex')
    await writeRollout([
      env('session_meta', { session_id: 'meta-1' }, '2026-03-03T10:19:20.000Z'),
      env('turn_context', { model: 'gpt-5.3-codex' }, '2026-03-03T10:19:21.000Z'),
      env('response_item', {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>cwd=/x</environment_context>' }],
      }),
      env('response_item', {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: 'chạy lệnh ls giùm' }],
      }, '2026-03-03T10:20:00.000Z'),
      env('response_item', {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'User muốn list file' }],
      }, '2026-03-03T10:20:01.000Z'),
      env('response_item', {
        type: 'function_call', name: 'exec_command',
        arguments: JSON.stringify({ command: ['ls', '-la'] }), call_id: 'call_1',
      }, '2026-03-03T10:20:02.000Z'),
      env('response_item', {
        type: 'function_call_output', call_id: 'call_1',
        output: 'Process exited with code 0\nOutput:\ntotal 8',
      }, '2026-03-03T10:20:03.000Z'),
      env('response_item', {
        type: 'custom_tool_call', name: 'apply_patch',
        input: '*** Begin Patch\n*** Update File: /tmp/ws/a.ts\n@@\n-x\n+y\n*** End Patch', call_id: 'call_2',
      }, '2026-03-03T10:20:04.000Z'),
      env('response_item', {
        type: 'custom_tool_call_output', call_id: 'call_2', output: 'File updated',
      }, '2026-03-03T10:20:05.000Z'),
      env('response_item', {
        type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: 'Đã list + vá file.' }],
      }, '2026-03-03T10:20:06.000Z'),
      // unknown item — phải đếm + bỏ, không throw
      env('response_item', { type: 'mystery_box', foo: 1 }),
      env('event_msg', {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 100, output_tokens: 30, cached_input_tokens: 40 } },
      }, '2026-03-03T10:20:07.000Z'),
      'dòng nát không parse được',
      { khongphai: 'envelope' },
    ])

    const r = await importCliTranscript(sessionId, 'codex')
    expect(r.imported).toBe(2) // user + agent turn
    const [u, a] = h.appended
    expect(u).toMatchObject({ role: 'user', text: 'chạy lệnh ls giùm', via: 'codex' })
    // environment_context đã bị lọc khỏi user surface
    expect(h.appended.some((m) => m.text.includes('environment_context'))).toBe(false)
    expect(a.role).toBe('agent')
    expect(a.text).toBe('Đã list + vá file.')
    // thinking + Bash(done) + Edit(apply_patch)
    const kinds = a.steps?.map((s) => s.kind)
    expect(kinds).toContain('thinking')
    const bash = a.steps?.find((s) => s.id === 'call_1')
    expect(bash).toMatchObject({ kind: 'tool', tool: 'terminal', status: 'done' })
    const patch = a.steps?.find((s) => s.id === 'call_2')
    expect(patch).toMatchObject({ kind: 'tool', tool: 'edit', target: '/tmp/ws/a.ts' })
    // token_count gập usage vào turn
    expect(a.usage).toMatchObject({ inputTokens: 100, outputTokens: 30, cacheReadTokens: 40 })
    expect(a.modelUsed).toBe('gpt-5.3-codex')
    // unknown/broken items chỉ bị đếm — không làm sync đổ
    const cursor = lastCursor('codex')
    expect(cursor?.offset).toBeGreaterThan(0)
  })

  it('lần sync thứ hai không entry mới → imported 0, vẫn emit', async () => {
    h.session = makeSession({ codexThreadId: THREAD, settings: { provider: 'openai', accountId: 'acc-1' } })
    await writeRollout([
      env('response_item', {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: 'ping' }],
      }),
    ])
    const r1 = await importCliTranscript(sessionId, 'codex')
    expect(r1.imported).toBe(1)
    const r2 = await importCliTranscript(sessionId, 'codex')
    expect(r2.imported).toBe(0)
    expect(emittedSyncs().map((e) => (e.payload as { imported: number }).imported)).toEqual([1, 0])
  })
})

// ─── Devin ATIF ──────────────────────────────────────────────────────────────

describe('devin transcript import', () => {
  const DIR = () => join(home, '.local', 'share', 'devin', 'cli', 'transcripts')

  async function writeDevin(name: string, doc: unknown): Promise<string> {
    const dir = DIR()
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file, JSON.stringify(doc))
    return realpath(file)
  }

  it('cursor = số step; map user/agent/system/source lạ', async () => {
    h.session = makeSession()
    h.link = makeLink('devin', { linked: false })
    const file = await writeDevin('devin-1.json', {
      schema_version: 1,
      session_id: 'devin-ses-1',
      agent: 'devin',
      steps: [
        { step_id: 's1', timestamp: '2026-03-03T10:01:00.000Z', source: 'system', message: 'boot' },
        { step_id: 's2', timestamp: '2026-03-03T10:02:00.000Z', source: 'user', message: 'fix review' },
        {
          step_id: 's3',
          timestamp: '2026-03-03T10:03:00.000Z',
          source: 'agent',
          message: 'Đã vá xong.',
          reasoning_content: 'cần sửa file a',
          model_name: 'devin-model-x',
          tool_calls: [
            { tool_call_id: 'dcall1', function_name: 'exec', arguments: { command: 'pnpm test' } },
          ],
          observation: { results: [{ source_call_id: 'dcall1', content: 'all tests pass' }] },
          metrics: { prompt_tokens: 50, completion_tokens: 12, cached_tokens: 8 },
        },
        { step_id: 's4', timestamp: '2026-03-03T10:04:00.000Z', source: 'ci', message: 'build green' },
      ],
    })

    const r = await importCliTranscript(sessionId, 'devin', { transcriptFile: file })
    expect(r.imported).toBe(2) // user + agent; system lọc; 'ci' gập vào step
    const [u, a] = h.appended
    expect(u).toMatchObject({ role: 'user', text: 'fix review', via: 'devin' })
    expect(a.role).toBe('agent')
    expect(a.text).toBe('Đã vá xong.')
    expect(a.modelUsed).toBe('devin-model-x')
    expect(a.usage).toMatchObject({ inputTokens: 50, outputTokens: 12, cacheReadTokens: 8 })
    const kinds = a.steps?.map((s) => s.kind)
    expect(kinds).toContain('thinking')
    expect(kinds).toContain('tool')
    // observation.result gập vào tool step; source lạ 'ci' thành step 'done'
    expect(a.steps?.some((s) => s.label === 'ci' && s.status === 'done')).toBe(true)
    // cursor devin = SỐ STEP, không phải byte
    expect(lastCursor('devin')).toMatchObject({ file, offset: 4 })
  })

  it('offset step-count: chỉ đọc phần steps sau cursor', async () => {
    const file = await writeDevin('devin-2.json', {
      steps: [
        { step_id: 's1', timestamp: '2026-03-03T10:02:00.000Z', source: 'user', message: 'đã đọc rồi' },
        { step_id: 's2', timestamp: '2026-03-03T10:03:00.000Z', source: 'user', message: 'cái mới' },
      ],
    })
    h.session = makeSession({ cliImport: { devin: { file, offset: 1 } } })
    const r = await importCliTranscript(sessionId, 'devin', { transcriptFile: file })
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('cái mới')
    expect(lastCursor('devin')?.offset).toBe(2)
  })

  it('không có cursor → chọn transcript .json mới-nhất chạm từ lúc spawn', async () => {
    h.link = makeLink('devin', { linked: false })
    const old = await writeDevin('old.json', {
      steps: [{ step_id: 'a', timestamp: '2026-03-03T09:00:00.000Z', source: 'user', message: 'cũ' }],
    })
    const fresh = await writeDevin('fresh.json', {
      steps: [
        // Devin discovery giờ đòi nội dung chứng minh file chạy trong workspace
        // của phiên (resolveCliCwd mock → '/tmp/ws'); system step bị lọc khỏi
        // messages nên không đổi số import.
        { step_id: 'env', timestamp: '2026-03-03T10:00:30.000Z', source: 'system', message: '<rule path="/tmp/ws/CLAUDE.md">' },
        { step_id: 'b', timestamp: '2026-03-03T10:05:00.000Z', source: 'user', message: 'mới' },
      ],
    })
    // ép mtime 'old' về quá khứ để khỏi phụ thuộc thứ tự ghi file
    const { utimes } = await import('node:fs/promises')
    await utimes(old, new Date('2020-01-01'), new Date('2020-01-01'))
    const r = await importCliTranscript(sessionId, 'devin')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('mới')
    expect(lastCursor('devin')?.file).toBe(fresh)
  })

  it('file mới-nhất thuộc project KHÁC → bỏ qua, chọn file cùng workspace', async () => {
    h.link = makeLink('devin', { linked: false })
    const good = await writeDevin('same-ws.json', {
      steps: [
        { step_id: 'e', timestamp: '2026-03-03T10:00:30.000Z', source: 'system', message: '<rule path="/tmp/ws/CLAUDE.md">' },
        { step_id: 'b', timestamp: '2026-03-03T10:05:00.000Z', source: 'user', message: 'đúng phiên' },
      ],
    })
    // Nội dung chỉ nhắc path project khác — dù mtime MỚI NHẤT cũng phải bị loại.
    const foreign = await writeDevin('foreign.json', {
      steps: [
        { step_id: 'f', timestamp: '2026-03-03T10:00:30.000Z', source: 'system', message: '<rule path="/other/project/CLAUDE.md">' },
        { step_id: 'g', timestamp: '2026-03-03T10:05:00.000Z', source: 'user', message: 'của project khác' },
      ],
    })
    const { utimes } = await import('node:fs/promises')
    const now = Date.now()
    await utimes(good, new Date(now), new Date(now - 1000))
    await utimes(foreign, new Date(now), new Date(now))

    const r = await importCliTranscript(sessionId, 'devin')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('đúng phiên')
    expect(lastCursor('devin')?.file).toBe(good)
  })

  it('cursor trỏ transcript NGOẠI → gỡ file/offset khỏi cursor, discovery tìm file cùng workspace', async () => {
    h.link = makeLink('devin', { linked: false })
    const foreign = await writeDevin('poisoned.json', {
      steps: [{ step_id: 'f', source: 'user', message: 'project khác /other/ws' }],
    })
    const good = await writeDevin('own.json', {
      steps: [
        { step_id: 'e', source: 'system', message: '<env>/tmp/ws</env>' },
        { step_id: 'g', source: 'user', message: 'của phiên này' },
      ],
    })
    // Cursor bị nhiễm từ trước khi có cwd-check — spawnedAt ở link làm evidence.
    h.session = makeSession({ cliImport: { devin: { file: foreign, offset: 3 } } })

    const r = await importCliTranscript(sessionId, 'devin')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('của phiên này')
    expect(lastCursor('devin')?.file).toBe(good)
  })

  it('chỉ có transcript ngoại → KHÔNG import gì (miss > misimport)', async () => {
    h.link = makeLink('devin', { linked: false })
    await writeDevin('foreign-only.json', {
      steps: [{ step_id: 'f', source: 'user', message: 'toàn path /somewhere/else' }],
    })
    const r = await importCliTranscript(sessionId, 'devin')
    expect(r.imported).toBe(0)
    expect(h.appended).toHaveLength(0)
  })
})

// ─── sessions.syncCli RPC ────────────────────────────────────────────────────

describe('sessions.syncCli RPC', () => {
  it('cli vắng → sync mọi kind có bằng chứng; session không tồn tại → RpcError', async () => {
    h.session = undefined
    await expect(dispatch('sessions.syncCli', { sessionId: 'khong-co' })).rejects.toMatchObject({
      code: -32004,
    })

    h.session = makeSession({ sdkSessionId: 'sdk-rpc' })
    h.link = makeLink('claude')
    await writeClaudeJsonl('-tmp-ws', 'sdk-rpc', [claudeUserEntry('qua RPC')])
    const res = (await dispatch('sessions.syncCli', { sessionId })) as { imported: number }
    expect(res.imported).toBe(1)
    expect(h.appended[0].via).toBe('claude')
  })

  it('cli có chỉ định → chỉ sync kind đó', async () => {
    h.session = makeSession()
    h.link = makeLink('devin', { linked: false })
    // link.kind='devin' nhưng chưa có transcript → imported 0, không chạm claude
    const res = (await dispatch('sessions.syncCli', { sessionId, cli: 'devin' })) as {
      imported: number
    }
    expect(res.imported).toBe(0)
    expect(emittedSyncs()).toEqual([
      { type: 'session.cli-synced', payload: { sessionId, imported: 0 } },
    ])
  })
})
