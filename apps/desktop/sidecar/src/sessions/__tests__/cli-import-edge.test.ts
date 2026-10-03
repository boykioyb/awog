// Tests bổ sung cho "Open in CLI" transcript importer — các edge case mà
// cli-import.test.ts chưa phủ: sliceJsonlTail (con trỏ byte), sàn spawn-time
// trên file shared, adoption thất bại/nhánh transcriptFile tường minh, resume
// sau restart (cursor persist, registry trống), multiset đếm số lần trùng, entry
// mồ côi/lạ, codex content-scan + bare-item, devin out-of-root/JSON nát/
// rediscovery, và chuỗi serialize của importChains.
//
// Cùng harness fixture-driven với cli-import.test.ts: transcript THẬT trong
// $HOME tạm, store/registry/stdio mock mỏng.
//
// Run: `npx vitest run src/sessions/__tests__/cli-import-edge.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch } from '../../transport/rpc.js'
import type { Session, SessionCliKind, SessionMessage } from '../../types/shared.js'
import type { CliLink } from '../cli-registry.js'

// ─── Mock surface (giống hệt cli-import.test.ts) ─────────────────────────────

const h = vi.hoisted(() => ({
  appended: [] as SessionMessage[],
  session: undefined as Session | undefined,
  link: undefined as CliLink | undefined,
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

await import('../../methods/sessions.sync-cli.js')
const { importCliTranscript, sliceJsonlTail } = await import('../cli-import.js')

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let home: string
let originalHome: string | undefined
const sessionId = 'ses-cli-edge'
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
  await writeFile(
    file,
    lines.map((l) => (typeof l === 'string' ? l : `${JSON.stringify(l)}\n`)).join(''),
  )
  // Cursor persist là realpath (insideRoot) — fixture trả cùng dạng để khớp.
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
): Record<string, unknown> {
  return {
    type: 'assistant',
    uuid: `a-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: ts,
    message: { role: 'assistant', content },
  }
}

function lastCursor(kind: SessionCliKind): { file: string; offset: number } | undefined {
  return h.session?.cliImport?.[kind]
}

function emittedSyncs(): Array<{ type: string; payload: unknown }> {
  return h.emitted.filter((e) => e.type === 'session.cli-synced')
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-cliimp-edge-'))
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

// ─── sliceJsonlTail (con trỏ byte — pure unit) ───────────────────────────────

describe('sliceJsonlTail — con trỏ byte', () => {
  it('offset 0 đọc tới newline cuối; đuôi chưa-newline giữ lại cho lần sau', () => {
    const buf = Buffer.from('{"a":1}\n{"b":2}\n{"c":3')
    const r = sliceJsonlTail(buf, 0)
    expect(r.text).toBe('{"a":1}\n{"b":2}\n')
    // nextOffset = ngay sau newline cuối — phần '{"c":3' chưa consume
    expect(r.nextOffset).toBe('{"a":1}\n{"b":2}\n'.length)
  })

  it('buffer không có newline nào → không consume gì (offset về 0)', () => {
    const buf = Buffer.from('{"a":1')
    const r = sliceJsonlTail(buf, 0)
    expect(r).toEqual({ text: '', nextOffset: 0 })
  })

  it('offset rơi giữa dòng → bỏ phần hỏng tới newline kế, đọc từ dòng sau', () => {
    // offset 3 nằm giữa dòng '{"aa"' — phần 'a":1}' bị coi là đệm hỏng
    const buf = Buffer.from('{"a":1}\n{"b":2}\n')
    const r = sliceJsonlTail(buf, 3)
    expect(r.text).toBe('{"b":2}\n')
    expect(r.nextOffset).toBe(buf.length)
  })

  it('offset giữa dòng mà sau đó không còn newline → nuốt hết đuôi (nextOffset=EOF)', () => {
    const buf = Buffer.from('{"a":1}\n{"b":2')
    const r = sliceJsonlTail(buf, 9)
    expect(r).toEqual({ text: '', nextOffset: buf.length })
  })

  it('offset > size (file bị truncate/rotate) → tua về 0 đọc lại hết', () => {
    const buf = Buffer.from('{"a":1}\n')
    const r = sliceJsonlTail(buf, 9999)
    expect(r.text).toBe('{"a":1}\n')
    expect(r.nextOffset).toBe(buf.length)
  })

  it('offset === size trên file kết bằng newline → rỗng, giữ offset', () => {
    const buf = Buffer.from('{"a":1}\n')
    const r = sliceJsonlTail(buf, buf.length)
    expect(r).toEqual({ text: '', nextOffset: buf.length })
  })

  it('offset âm / NaN → về 0', () => {
    const buf = Buffer.from('{"a":1}\n')
    expect(sliceJsonlTail(buf, -5).text).toBe('{"a":1}\n')
    expect(sliceJsonlTail(buf, Number.NaN).text).toBe('{"a":1}\n')
  })
})

// ─── Claude: sàn spawn-time + adoption ───────────────────────────────────────

describe('claude — spawnFloor trên file shared', () => {
  it('entry TRƯỚC spawn bị lọc dù text không trùng message nào (multiset không cứu được)', async () => {
    // File shared (sdkSessionId khớp) đọc từ offset 0: các lượt AWOG cũ nằm trong
    // đó. Session.messages RỖNG → nếu entry cũ vẫn vào, đó là nhờ floor chứ không
    // phải dedupe.
    h.session = makeSession({ sdkSessionId: 'sdk-floor' })
    h.link = makeLink('claude', { spawnedAt: SPAWN })
    await writeClaudeJsonl('-tmp-ws', 'sdk-floor', [
      claudeUserEntry('tin AWOG rất cũ', '2026-03-03T09:00:00.000Z'),
      claudeAssistantEntry([{ type: 'text', text: 'trả lời cũ' }], '2026-03-03T09:01:00.000Z'),
      // Entry KHÔNG timestamp — không định tuổi được → giữ (đường an toàn)
      { type: 'user', uuid: 'u-nodate', message: { role: 'user', content: 'không ngày' } },
      // Trong grace 5s: vừa trước spawn < 5s → vẫn được giữ (slack)
      claudeUserEntry('sát giờ spawn', '2026-03-03T09:59:58.000Z'),
      claudeUserEntry('gõ trong CLI', '2026-03-03T10:05:00.000Z'),
    ])

    const r = await importCliTranscript(sessionId, 'claude')
    // 'không ngày' + 'sát giờ spawn' + 'gõ trong CLI' (và 1 agent turn 'trả lời
    // cũ'... KHÔNG — agent đó cũng trước floor nên bị lọc)
    const texts = h.appended.map((m) => m.text)
    expect(texts).toEqual(['không ngày', 'sát giờ spawn', 'gõ trong CLI'])
    expect(r.imported).toBe(3)
  })

  it('pending file không tồn tại → KHÔNG adopt sdkSessionId, imported 0 vẫn emit', async () => {
    h.session = makeSession() // chưa sdkSessionId
    h.link = makeLink('claude', { pendingSdkSessionId: 'pend-ghost' })
    // Không tạo file nào — CLI thoát trước khi user gõ gì.

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(0)
    expect(h.session?.sdkSessionId).toBeUndefined() // không treo handle hư
    expect(emittedSyncs()).toHaveLength(1)
  })

  it('transcriptFile tường minh (trong root) trỏ file pending → vẫn ADOPT trước khi import', async () => {
    h.session = makeSession()
    h.link = makeLink('claude', { pendingSdkSessionId: 'pend-manual' })
    const file = await writeClaudeJsonl('-tmp-ws', 'pend-manual', [
      claudeUserEntry('qua file chỉ tay'),
    ])

    const r = await importCliTranscript(sessionId, 'claude', { transcriptFile: file })
    expect(r.imported).toBe(1)
    expect(h.session?.sdkSessionId).toBe('pend-manual')
    expect(h.appended[0].via).toBe('claude')
  })

  it('session đã có sdkSessionId khác (lượt AWOG thắng race) → KHÔNG đè bằng pending', async () => {
    // Race: user gửi lượt AWOG trong khe PTY-exit → sdkSessionId đã mint khác.
    // adoptClaudePending reload + kiểm tra — handle mới hơn phải thắng.
    h.session = makeSession({ sdkSessionId: 'sdk-newer' })
    h.link = makeLink('claude', { pendingSdkSessionId: 'pend-older' })
    // File của pending tồn tại nhưng locate đi theo sdkSessionId trước.
    await writeClaudeJsonl('-tmp-ws', 'pend-older', [claudeUserEntry('từ CLI cũ')])
    await writeClaudeJsonl('-tmp-ws', 'sdk-newer', [claudeUserEntry('từ CLI mới')])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(h.session?.sdkSessionId).toBe('sdk-newer') // không bị đè
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('từ CLI mới')
  })
})

describe('claude — cursor & dedupe edge', () => {
  it('restart-safe: cursor persist + registry TRỐNG (engine mới boot) → chỉ đọc tail', async () => {
    // Sau restart sidecar links/lastLinks rỗng — cursor cliImport trên header là
    // chỗ dựng duy nhất. Kịch bản: phiên đã sync xong entry 1 trước restart.
    const line1 = JSON.stringify(claudeUserEntry('đã sync trước restart')) + '\n'
    const line2 = JSON.stringify(claudeUserEntry('viết trong khi engine chết', '2026-03-03T10:10:00.000Z')) + '\n'
    const file = await writeClaudeJsonl('-tmp-ws', 'sdk-restart', [`${line1}${line2}`])
    h.session = makeSession({
      sdkSessionId: 'sdk-restart',
      cliImport: { claude: { file, offset: Buffer.byteLength(line1) } },
    })
    h.link = undefined // registry trống — engine vừa restart

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('viết trong khi engine chết')
    expect(lastCursor('claude')?.offset).toBe(Buffer.byteLength(line1 + line2))
  })

  it('cursor.file khác file locate được → đọc file mới từ đầu', async () => {
    const file = await writeClaudeJsonl('-tmp-ws', 'sdk-moved', [
      claudeUserEntry('file mới toanh'),
      claudeUserEntry('entry hai'),
    ])
    h.session = makeSession({
      sdkSessionId: 'sdk-moved',
      cliImport: { claude: { file: '/old/rotated.jsonl', offset: 12345 } },
    })
    h.link = makeLink('claude')

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(2)
    expect(lastCursor('claude')?.file).toBe(file)
  })

  it('multiset đếm số lần: 2 entry CLI trùng text, session có 1 bản → import đúng 1', async () => {
    h.session = makeSession({
      sdkSessionId: 'sdk-multi',
      messages: [
        { id: 'm1', role: 'user', text: 'ping', at: '2026-03-03T09:00:00.000Z' } as SessionMessage,
      ],
    })
    h.link = makeLink('claude')
    await writeClaudeJsonl('-tmp-ws', 'sdk-multi', [
      claudeUserEntry('ping', '2026-03-03T10:01:00.000Z'), // bản sao của AWOG turn
      claudeUserEntry('ping', '2026-03-03T10:02:00.000Z'), // user gõ lại trong CLI — TIN MỚI
    ])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('ping')
    expect(h.appended[0].via).toBe('claude')
  })

  it('tool_result mồ côi + user-entry chỉ image + type lạ → đếm skip, không crash', async () => {
    h.session = makeSession({ sdkSessionId: 'sdk-misc' })
    h.link = makeLink('claude')
    await writeClaudeJsonl('-tmp-ws', 'sdk-misc', [
      { type: 'summary', summary: 'Compacted', leafUuid: 'x' },
      { type: 'file-history-snapshot', messageId: 'm', snapshot: {} },
      // tool_result không có tool_use tương ứng (cursor cắt giữa turn)
      {
        type: 'user',
        uuid: 'u-orphan',
        timestamp: '2026-03-03T10:01:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_lost', content: 'out' }],
        },
      },
      // user entry chỉ image — không text → không sinh user message
      {
        type: 'user',
        uuid: 'u-img',
        timestamp: '2026-03-03T10:02:00.000Z',
        message: { role: 'user', content: [{ type: 'image', source: { data: 'b64' } }] },
      },
      claudeUserEntry('tin thật', '2026-03-03T10:05:00.000Z'),
    ])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
    expect(h.appended.map((m) => m.text)).toEqual(['tin thật'])
  })

  it('phiên đã xoá (loadSession null) → imported 0 và KHÔNG emit', async () => {
    h.session = undefined
    const r = await importCliTranscript('ses-deleted', 'claude')
    expect(r.imported).toBe(0)
    expect(emittedSyncs()).toHaveLength(0)
  })

  it('hai import chồng nhau trên cùng phiên serialize — không append đôi', async () => {
    h.session = makeSession({ sdkSessionId: 'sdk-conc' })
    h.link = makeLink('claude')
    await writeClaudeJsonl('-tmp-ws', 'sdk-conc', [
      claudeUserEntry('một'),
      claudeUserEntry('hai'),
      claudeUserEntry('ba'),
    ])

    const [r1, r2] = await Promise.all([
      importCliTranscript(sessionId, 'claude'),
      importCliTranscript(sessionId, 'claude'),
    ])
    // Tổng append đúng 3 — lần sau chạy sau lần trước (importChains) nên thấy
    // cursor đã tua hết → 0. Không quan tâm thứ tự hai promise.
    expect(r1.imported + r2.imported).toBe(3)
    expect(h.appended).toHaveLength(3)
  })
})

// ─── Codex edge ──────────────────────────────────────────────────────────────

describe('codex — edge cases', () => {
  const THREAD = 'thr-edge-1'

  async function writeRolloutNamed(name: string, lines: unknown[]): Promise<string> {
    const dir = join(home, '.awog', 'codex', 'acc-1', 'sessions', '2026', '03', '03')
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    return realpath(file)
  }

  function env(type: string, payload: unknown, ts = '2026-03-03T10:20:00.000Z') {
    return { timestamp: ts, ordinal: 0, type, payload }
  }

  it('tên file KHÔNG chứa threadId → dò nội dung vẫn tìm được rollout', async () => {
    h.session = makeSession({
      codexThreadId: THREAD,
      settings: { provider: 'openai', accountId: 'acc-1' },
    })
    h.link = makeLink('codex')
    await writeRolloutNamed('rollout-renamed-layout.jsonl', [
      // threadId nằm trong payload session_meta — name-scan trượt, content-scan bắt
      env('session_meta', { id: THREAD }, '2026-03-03T10:19:00.000Z'),
      env('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'tìm bằng nội dung' }],
      }),
    ])

    const r = await importCliTranscript(sessionId, 'codex')
    expect(r.imported).toBe(1)
    expect(h.appended[0]).toMatchObject({ role: 'user', text: 'tìm bằng nội dung', via: 'codex' })
  })

  it('bare item KHÔNG phong bì (layout cũ) vẫn parse được', async () => {
    h.session = makeSession({
      codexThreadId: THREAD,
      settings: { provider: 'openai', accountId: 'acc-1' },
    })
    h.link = makeLink('codex')
    await writeRolloutNamed(`rollout-old-${THREAD}.jsonl`, [
      // Dòng trần không envelope {timestamp,type,payload}
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'định dạng cũ' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok cũ' }] },
    ])

    const r = await importCliTranscript(sessionId, 'codex')
    expect(r.imported).toBe(2)
    expect(h.appended[0].role).toBe('user')
    expect(h.appended[1]).toMatchObject({ role: 'agent', text: 'ok cũ' })
  })

  it('output mồ côi + role developer/system → skip, không đổ sync', async () => {
    h.session = makeSession({
      codexThreadId: THREAD,
      settings: { provider: 'openai', accountId: 'acc-1' },
    })
    h.link = makeLink('codex')
    await writeRolloutNamed(`rollout-orphan-${THREAD}.jsonl`, [
      env('response_item', {
        type: 'function_call_output',
        call_id: 'call_khong_co_call',
        output: 'orphan output',
      }),
      env('response_item', {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'internal instruction' }],
      }),
      env('response_item', {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: 'system note' }],
      }),
      env('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'tin thật' }],
      }),
    ])

    const r = await importCliTranscript(sessionId, 'codex')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('tin thật')
  })

  it('không codexThreadId → locate hụt, imported 0 vẫn emit', async () => {
    h.session = makeSession({ settings: { provider: 'openai', accountId: 'acc-1' } })
    h.link = makeLink('codex')
    const r = await importCliTranscript(sessionId, 'codex')
    expect(r.imported).toBe(0)
    expect(emittedSyncs()).toHaveLength(1)
  })
})

// ─── Devin edge ──────────────────────────────────────────────────────────────

describe('devin — edge cases', () => {
  const DIR = () => join(home, '.local', 'share', 'devin', 'cli', 'transcripts')

  async function writeDevin(name: string, doc: unknown): Promise<string> {
    const dir = DIR()
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file, typeof doc === 'string' ? doc : JSON.stringify(doc))
    return realpath(file)
  }

  it('transcriptFile ngoài ~/.local/share/devin/cli/transcripts → từ chối', async () => {
    const stray = join(home, 'devin-ish.json')
    await writeFile(stray, JSON.stringify({ steps: [{ source: 'user', message: 'x' }] }))
    const r = await importCliTranscript(sessionId, 'devin', { transcriptFile: stray })
    expect(r.imported).toBe(0)
    expect(h.appended).toHaveLength(0)
  })

  it('file JSON nát → imported 0, emit, không throw', async () => {
    const file = await writeDevin('broken.json', '{cắt ngang')
    const r = await importCliTranscript(sessionId, 'devin', { transcriptFile: file })
    expect(r.imported).toBe(0)
    expect(emittedSyncs()).toHaveLength(1)
  })

  it('cursor trỏ file đã MẤT → dò lại theo mtime floor, đọc file mới từ step 0', async () => {
    h.link = makeLink('devin', { linked: false })
    const fresh = await writeDevin('rediscovered.json', {
      steps: [
        // Devin discovery đòi file chứa path workspace của phiên (cwd check).
        { step_id: 'env', timestamp: '2026-03-03T10:00:30.000Z', source: 'system', message: '<rule path="/tmp/ws/CLAUDE.md">' },
        { step_id: 'a', timestamp: '2026-03-03T10:01:00.000Z', source: 'user', message: 'một' },
        { step_id: 'b', timestamp: '2026-03-03T10:02:00.000Z', source: 'user', message: 'hai' },
      ],
    })
    h.session = makeSession({
      cliImport: { devin: { file: join(DIR(), 'da-xoa.json'), offset: 7 } },
    })

    const r = await importCliTranscript(sessionId, 'devin')
    expect(r.imported).toBe(2)
    expect(lastCursor('devin')).toMatchObject({ file: fresh, offset: 3 })
  })

  it('agent step rỗng + source lạ không có agent trước → skip gọn', async () => {
    h.link = makeLink('devin', { linked: false })
    const file = await writeDevin('sparse.json', {
      steps: [
        // agent step không message/tool/reasoning → agent:empty
        { step_id: 'e1', timestamp: '2026-03-03T10:01:00.000Z', source: 'agent' },
        // source lạ có message nhưng CHƯA có agent message nào → bỏ
        { step_id: 'e2', timestamp: '2026-03-03T10:01:30.000Z', source: 'tool_daemon', message: 'log' },
        { step_id: 'e3', timestamp: '2026-03-03T10:02:00.000Z', source: 'user', message: 'hi' },
      ],
    })

    const r = await importCliTranscript(sessionId, 'devin', { transcriptFile: file })
    expect(r.imported).toBe(1)
    expect(h.appended[0]).toMatchObject({ role: 'user', text: 'hi', via: 'devin' })
    expect(lastCursor('devin')?.offset).toBe(3) // cursor đi qua CẢ step bị skip
  })

  it('transcript devin thu nhỏ hơn cursor → reset 0 và import lại (dup đã biết — file co là hiếm)', async () => {
    const file = await writeDevin('shrunk.json', {
      steps: [
        { step_id: 'n1', timestamp: '2026-03-03T10:01:00.000Z', source: 'user', message: 'lại từ đầu' },
      ],
    })
    // Cursor cũ chỉ offset 5 trên cùng file — file giờ chỉ còn 1 step
    h.session = makeSession({ cliImport: { devin: { file, offset: 5 } } })

    const r = await importCliTranscript(sessionId, 'devin', { transcriptFile: file })
    // Hành vi hiện tại: start reset về 0 → import lại toàn bộ (devin không có
    // multiset dedupe — file này shared=false). Đây là giới hạn đã biết của
    // devin path, ghi nhận để regression-test nếu sau này thêm dedupe.
    expect(r.imported).toBe(1)
    expect(lastCursor('devin')?.offset).toBe(1)
  })
})

// ─── sessions.syncCli — cổng "không bằng chứng" ──────────────────────────────

describe('sessions.syncCli — không có bằng chứng', () => {
  it('không cursor, không link → imported 0 và KHÔNG emit (không kind nào để chạy)', async () => {
    h.session = makeSession()
    h.link = undefined
    const res = (await dispatch('sessions.syncCli', { sessionId })) as { imported: number }
    expect(res.imported).toBe(0)
    expect(emittedSyncs()).toHaveLength(0)
  })

  it('cli chỉ định nhưng không locate được → vẫn emit 0 (UI refresh "up to date")', async () => {
    h.session = makeSession() // không sdkSessionId → claude locate hụt
    const res = (await dispatch('sessions.syncCli', { sessionId, cli: 'claude' })) as {
      imported: number
    }
    expect(res.imported).toBe(0)
    expect(emittedSyncs()).toEqual([
      { type: 'session.cli-synced', payload: { sessionId, imported: 0 } },
    ])
  })

  it('phiên không tồn tại → -32004', async () => {
    h.session = undefined
    await expect(dispatch('sessions.syncCli', { sessionId: 'x' })).rejects.toMatchObject({
      code: -32004,
    })
  })

  it('turn đang chạy → syncCli -32021, không đụng transcript', async () => {
    h.session = makeSession({ sdkSessionId: 'sdk-busy' })
    h.active = [sessionId]
    await expect(dispatch('sessions.syncCli', { sessionId })).rejects.toMatchObject({
      code: -32021,
      message: expect.stringContaining('turn is in flight'),
    })
    expect(h.appended).toHaveLength(0)
    expect(emittedSyncs()).toHaveLength(0)
  })
})

// ─── Shared-history suffix dedupe (scaffold runtime) ────────────────────────

describe('shared-history — user suffix dedupe', () => {
  it('entry user mang scaffold + text thô → khớp SUFFIX, không gấp đôi', async () => {
    // AWOG persist text thô; file ~/.claude giữ bản runtime prepend scaffold
    // (<current_state>, history prefix…) TRƯỚC chữ thô → suffix-match trên user.
    h.session = makeSession({
      sdkSessionId: 'sdk-scaf',
      messages: [
        { id: 'm1', role: 'user', text: 'merge nhánh này đi', at: '2026-03-03T09:00:00.000Z' } as SessionMessage,
        { id: 'm2', role: 'agent', text: 'Để xem diff trước.', at: '2026-03-03T09:01:00.000Z' } as SessionMessage,
      ],
    })
    h.link = makeLink('claude')
    await writeClaudeJsonl('-tmp-ws', 'sdk-scaf', [
      // Bản scaffold của user-turn AWOG (timestamp sau spawn → qua được floor)
      claudeUserEntry(
        '<current_state>cwd=/tmp/ws</current_state>\nmerge nhánh này đi',
        '2026-03-03T10:01:00.000Z',
      ),
      // Bản assistant của cùng lượt AWOG — EXACT-match như cũ
      claudeAssistantEntry([{ type: 'text', text: 'Để xem diff trước.' }], '2026-03-03T10:02:00.000Z'),
      // Lượt gõ trong CLI — tin mới
      claudeUserEntry('thêm cả test nữa', '2026-03-03T10:05:00.000Z'),
      claudeAssistantEntry([{ type: 'text', text: 'Test đã thêm.' }], '2026-03-03T10:06:00.000Z'),
    ])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(2) // chỉ lượt CLI mới
    expect(h.appended.map((m) => m.text)).toEqual(['thêm cả test nữa', 'Test đã thêm.'])
    expect(h.session?.messages).toHaveLength(4) // 2 cũ + 2 mới — không bản sao
  })

  it('stored user text < 3 ký tự chuẩn hoá → suffix dedupe KHÔNG áp (không nuốt tin thật)', async () => {
    h.session = makeSession({
      sdkSessionId: 'sdk-short',
      messages: [
        { id: 'm1', role: 'user', text: 'ok', at: '2026-03-03T09:00:00.000Z' } as SessionMessage,
      ],
    })
    h.link = makeLink('claude')
    await writeClaudeJsonl('-tmp-ws', 'sdk-short', [
      // Scaffold + 'ok' — chuỗi stored chỉ 2 ký tự → suffix pool bỏ qua → import
      claudeUserEntry('<current_state>x</current_state>\nok', '2026-03-03T10:05:00.000Z'),
    ])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
  })

  it('assistant KHÔNG suffix-match — entry agent trùng đuôi vẫn là tin mới', async () => {
    h.session = makeSession({
      sdkSessionId: 'sdk-asuf',
      messages: [
        { id: 'm1', role: 'agent', text: 'đã xong', at: '2026-03-03T09:00:00.000Z' } as SessionMessage,
      ],
    })
    h.link = makeLink('claude')
    await writeClaudeJsonl('-tmp-ws', 'sdk-asuf', [
      // Text dài hơn nhưng KẾT bằng text đã lưu — assistant chỉ exact-match,
      // không được nuốt (đây có thể là câu trả lời CLI thật).
      claudeAssistantEntry([{ type: 'text', text: 'Tôi vừa kiểm lại, đã xong' }], '2026-03-03T10:05:00.000Z'),
    ])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('Tôi vừa kiểm lại, đã xong')
  })
})

// ─── Restart resilience (cursor persist, registry trống) ─────────────────────

describe('restart-safe — cursor persist', () => {
  it('claude: pendingSdkSessionId chỉ còn trong cursor → vẫn adopt + xoá pending', async () => {
    // Registry maps mất sau restart — bằng chứng duy nhất là cursor persist.
    h.session = makeSession({
      cliImport: { claude: { pendingSdkSessionId: 'pend-rst', spawnedAt: SPAWN } },
    })
    h.link = undefined
    await writeClaudeJsonl('-tmp-ws', 'pend-rst', [claudeUserEntry('viết trong CLI cũ')])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('viết trong CLI cũ')
    // Adopt thành handle chính + pending xoá khỏi cursor (spawnedAt giữ lại)
    expect(h.session?.sdkSessionId).toBe('pend-rst')
    const cursor = lastCursor('claude')
    expect(cursor?.pendingSdkSessionId).toBeUndefined()
    expect(cursor?.spawnedAt).toBe(SPAWN)
    expect(cursor?.offset).toBeGreaterThan(0)
  })

  it('claude: spawnFloor từ spawnedAt persist (không link) — entry trước spawn vẫn lọc', async () => {
    h.session = makeSession({
      sdkSessionId: 'sdk-floor-p',
      cliImport: { claude: { spawnedAt: SPAWN } },
    })
    h.link = undefined // engine vừa restart — registry trống
    await writeClaudeJsonl('-tmp-ws', 'sdk-floor-p', [
      claudeUserEntry('lượt AWOG trước restart', '2026-03-03T09:00:00.000Z'),
      claudeUserEntry('gõ sau restart', '2026-03-03T10:05:00.000Z'),
    ])

    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('gõ sau restart')
  })

  it('devin: spawnedAt persist → vẫn dò transcript chạm từ lúc spawn', async () => {
    h.session = makeSession({
      cliImport: { devin: { spawnedAt: SPAWN } },
    })
    h.link = undefined
    const dir = join(home, '.local', 'share', 'devin', 'cli', 'transcripts')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'post-restart.json'), JSON.stringify({
      steps: [
        { step_id: 'env', timestamp: '2026-03-03T10:00:30.000Z', source: 'system', message: '<rule path="/tmp/ws/CLAUDE.md">' },
        { step_id: 'a', timestamp: '2026-03-03T10:01:00.000Z', source: 'user', message: 'mới' },
      ],
    }))
    const fresh = await realpath(join(dir, 'post-restart.json'))

    const r = await importCliTranscript(sessionId, 'devin')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('mới')
    expect(lastCursor('devin')?.file).toBe(fresh)
  })
})

// ─── Devin: no-evidence + cursor semantics ───────────────────────────────────

describe('devin — evidence & cursor', () => {
  const DIR = () => join(home, '.local', 'share', 'devin', 'cli', 'transcripts')

  async function writeDevin(name: string, doc: unknown): Promise<string> {
    const dir = DIR()
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file, JSON.stringify(doc))
    return realpath(file)
  }

  it('không cursor, không link → KHÔNG dò file mới-nhất (tránh nhặt phiên người khác)', async () => {
    await writeDevin('stray.json', {
      steps: [{ step_id: 'a', source: 'user', message: 'của ai đó' }],
    })
    const r = await importCliTranscript(sessionId, 'devin')
    expect(r.imported).toBe(0)
    expect(h.appended).toHaveLength(0)
    expect(lastCursor('devin')).toBeUndefined()
  })

  it('cursor trỏ file còn tồn tại → giữ file đó, KHÔNG nhảy sang file mới hơn', async () => {
    h.link = makeLink('devin', { linked: false })
    const cur = await writeDevin('current.json', {
      steps: [
        { step_id: 'env', source: 'system', message: '<rule path="/tmp/ws/CLAUDE.md">' },
        { step_id: 'a', source: 'user', message: 'của phiên này' },
      ],
    })
    await writeDevin('newer.json', {
      steps: [{ step_id: 'b', source: 'user', message: 'phiên devin khác' }],
    })
    h.session = makeSession({ cliImport: { devin: { file: cur, offset: 0 } } })

    const r = await importCliTranscript(sessionId, 'devin')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('của phiên này')
  })
})

// ─── Path & id hardening ────────────────────────────────────────────────────

describe('hardening — id charset + symlink containment', () => {
  it('sdkSessionId charset lạ → từ chối quét (id L2 không thành traversal)', async () => {
    h.session = makeSession({ sdkSessionId: '../escape' })
    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(0)
    expect(h.appended).toHaveLength(0)
  })

  it('codex threadId charset lạ → từ chối quét', async () => {
    h.session = makeSession({
      codexThreadId: '../evil',
      settings: { provider: 'openai', accountId: 'acc-1' },
    })
    const r = await importCliTranscript(sessionId, 'codex')
    expect(r.imported).toBe(0)
  })

  it('codex accountId charset lạ → không dùng làm path segment', async () => {
    h.session = makeSession({
      codexThreadId: 'thr-ok-1',
      settings: { provider: 'openai', accountId: '../evil' },
    })
    const r = await importCliTranscript(sessionId, 'codex')
    expect(r.imported).toBe(0)
  })

  it('file .jsonl là SYMLINK trỏ ra ngoài projects root → từ chối', async () => {
    h.session = makeSession({ sdkSessionId: 'sdk-sym' })
    const outside = join(home, 'outside.jsonl')
    await writeFile(outside, JSON.stringify(claudeUserEntry('đừng đọc')) + '\n')
    const projects = join(home, '.claude', 'projects', '-tmp-ws')
    await mkdir(projects, { recursive: true })
    try {
      await symlink(outside, join(projects, 'sdk-sym.jsonl'))
    } catch {
      return // platform không tạo được symlink → bỏ êm
    }
    const r = await importCliTranscript(sessionId, 'claude')
    expect(r.imported).toBe(0)
    expect(h.appended).toHaveLength(0)
  })

  it('transcriptFile là symlink trỏ ngoài root → từ chối như file lạc', async () => {
    const dir = join(home, '.local', 'share', 'devin', 'cli', 'transcripts')
    await mkdir(dir, { recursive: true })
    const outside = join(home, 'devin-outside.json')
    await writeFile(outside, JSON.stringify({ steps: [{ source: 'user', message: 'x' }] }))
    const link = join(dir, 'linked.json')
    try {
      await symlink(outside, link)
    } catch {
      return
    }
    const r = await importCliTranscript(sessionId, 'devin', { transcriptFile: link })
    expect(r.imported).toBe(0)
  })
})

// ─── Codex injected-context tags ─────────────────────────────────────────────

describe('codex — injected tag của runtime', () => {
  const THREAD = 'thr-inj-1'

  function env(type: string, payload: unknown, ts = '2026-03-03T10:20:00.000Z') {
    return { timestamp: ts, ordinal: 0, type, payload }
  }

  it('user item <current_state>/<todo-list>/<conversation_so_far> → lọc, không thành message', async () => {
    h.session = makeSession({
      codexThreadId: THREAD,
      settings: { provider: 'openai', accountId: 'acc-1' },
    })
    h.link = makeLink('codex')
    const dir = join(home, '.awog', 'codex', 'acc-1', 'sessions', '2026', '03', '03')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, `rollout-1-${THREAD}.jsonl`),
      [
        env('response_item', {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<current_state>branch=main</current_state>' }],
        }),
        env('response_item', {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<todo-list>- [] x</todo-list>' }],
        }),
        env('response_item', {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<conversation_so_far>…</conversation_so_far>' }],
        }),
        env('response_item', {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'tin người dùng thật' }],
        }),
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\n',
    )

    const r = await importCliTranscript(sessionId, 'codex')
    expect(r.imported).toBe(1)
    expect(h.appended[0].text).toBe('tin người dùng thật')
  })
})
