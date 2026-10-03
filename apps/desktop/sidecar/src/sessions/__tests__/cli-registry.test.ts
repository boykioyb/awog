// Tests cho "Open in CLI" spawn registry (sessions/cli-registry.ts) — tầng quyết
// định argv/env/link mà cli-import.test.ts không với tới (nó mock registry).
// PTY được mock ngay tại terminalManager.spawnProcess: bắt được file/args/env/
// cwd/onExit mà không spawn process thật, đồng thời cho phép bắn onExit tay để
// kiểm lifecycle link (live → exit → lastLink giữ lại cho importer).
//
// Run: `npx vitest run src/sessions/__tests__/cli-registry.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '../../types/shared.js'

// ─── Mock surface ────────────────────────────────────────────────────────────

interface SpawnParams {
  file: string
  args: string[]
  env: Record<string, string>
  cwd: string
  cols: number
  rows: number
  sessionId: string
  onExit?: (exitCode: number, signal?: number) => void
}

const h = vi.hoisted(() => ({
  calls: [] as SpawnParams[],
  counter: 0,
  // Record PTY "còn sống" trong manager giả — groupKeyFor/list đọc từ đây để
  // test stale-link + remote-style lookup. spawnProcess tự đăng ký, kill tự gỡ.
  liveTerminals: new Map<string, string>(),
  killed: [] as string[],
  imported: [] as Array<{ sessionId: string; kind: string }>,
  // Patch qua updateSessionMetadata — bằng chứng spawn persist (cliImport).
  metadataPatches: [] as Array<Record<string, unknown>>,
  codexHomeCalls: [] as Array<{ accountId: string; secret: string; kind: string }>,
  session: undefined as Session | undefined,
  project: undefined as { path: string } | null | undefined,
  claudeBin: '/fake/bin/claude' as string | undefined,
  codexBin: '/fake/bin/codex' as string | undefined,
  sdkEnv: { SDK_MARKER: '1' } as Record<string, string>,
  credentialFails: false,
  accountId: 'acc-1',
  accountAuthMode: 'apikey' as 'apikey' | 'oauth',
  codexHomeFails: false,
  // activeSessionIds() của runner — TOCTOU test bật phiên vào giữa chừng.
  active: [] as string[],
}))

vi.mock('../../terminal/manager.js', () => ({
  terminalManager: {
    spawnProcess: async (params: SpawnParams) => {
      h.calls.push(params)
      h.counter += 1
      const terminalId = `term-${h.counter}`
      h.liveTerminals.set(terminalId, params.sessionId)
      return { terminalId }
    },
    kill: (terminalId: string) => {
      h.killed.push(terminalId)
      h.liveTerminals.delete(terminalId)
    },
    groupKeyFor: (terminalId: string) => h.liveTerminals.get(terminalId),
    list: (sessionId?: string) =>
      [...h.liveTerminals]
        .filter(([, s]) => sessionId === undefined || s === sessionId)
        .map(([terminalId, s]) => ({ terminalId, sessionId: s, createdAt: 0 })),
  },
}))

vi.mock('../../runtime/claude-sdk/binary.js', () => ({
  resolveClaudeBinary: () => h.claudeBin,
}))
vi.mock('../../runtime/codex/binary.js', () => ({
  resolveCodexBinary: () => {
    if (!h.codexBin) throw new Error('CODEX_UNAVAILABLE: no codex binary')
    return h.codexBin
  },
}))
vi.mock('../../runtime/codex/home.js', () => ({
  codexHomeFor: (accountId: string) => `/codex-home/${accountId}`,
  ensureCodexHome: async (args: { accountId: string; secret: string; kind: string }) => {
    if (h.codexHomeFails) throw new Error('codex login failed')
    h.codexHomeCalls.push(args)
    return `/codex-home/${args.accountId}`
  },
}))
vi.mock('../../runtime/claude-sdk/shared.js', () => ({
  buildSdkEnv: () => ({ ...h.sdkEnv }),
}))
vi.mock('../../credentials/credential-resolver.js', () => ({
  resolveCredential: async () => {
    if (h.credentialFails) throw new Error('no credential configured')
    return { cred: { kind: 'oauth', accessToken: 'tok' }, account: { id: h.accountId } }
  },
  // codexInvocation tra account qua resolveAccount (lookup thuần — không
  // refresh/persist): trả record tối thiểu đủ để nhánh secret/kind chạy.
  resolveAccount: async (_provider: string, accountId?: string) => ({
    id: accountId ?? h.accountId,
    authMode: h.accountAuthMode,
    apiKey: 'api-key-1',
    piOAuth: h.accountAuthMode === 'oauth' ? { access: 'chatgpt-bearer-1' } : undefined,
  }),
}))
vi.mock('../../projects/store.js', () => ({
  loadProject: async () => h.project ?? null,
}))
vi.mock('../store.js', () => ({
  loadSession: async (id: string) => (h.session && h.session.id === id ? h.session : null),
  updateSessionMetadata: async (_id: string, patch: Record<string, unknown>) => {
    h.metadataPatches.push(patch)
    Object.assign(h.session ?? {}, patch)
  },
}))
// runner.js nặng (kéo runtime) — chỉ cần activeSessionIds cho cổng TOCTOU.
vi.mock('../runner.js', () => ({
  activeSessionIds: () => h.active,
}))
vi.mock('../cli-import.js', () => ({
  importCliTranscript: async (sessionId: string, kind: string) => {
    h.imported.push({ sessionId, kind })
    return { imported: 0 }
  },
}))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

const { openCliLink, cliLinkFor, cliLastLinkFor, isCliAttached, assertCliDetachedForDelete } =
  await import('../cli-registry.js')

// ─── Helpers ─────────────────────────────────────────────────────────────────

let ws: string
let binDir: string
let sidCounter = 0
let originalPath: string | undefined
let originalDevinBin: string | undefined

function nextSession(overrides: Record<string, unknown> = {}): Session {
  sidCounter += 1
  return {
    id: `ses-reg-${sidCounter}`,
    messages: [],
    settings: { provider: 'anthropic', accountId: 'acc-1' },
    workspaceFolder: ws,
    ...overrides,
  } as unknown as Session
}

const BASE = { cols: 80, rows: 24 }

function fireExit(callIdx = 0): void {
  h.calls[callIdx].onExit?.(0)
}

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), 'awog-reg-ws-'))
  binDir = await mkdtemp(join(tmpdir(), 'awog-reg-bin-'))
  originalPath = process.env.PATH
  originalDevinBin = process.env.AWOG_DEVIN_BIN
  h.calls = []
  h.counter = 0
  h.liveTerminals = new Map()
  h.killed = []
  h.imported = []
  h.metadataPatches = []
  h.codexHomeCalls = []
  h.session = undefined
  h.project = undefined
  h.claudeBin = '/fake/bin/claude'
  h.codexBin = '/fake/bin/codex'
  h.sdkEnv = { SDK_MARKER: '1' }
  h.credentialFails = false
  h.accountId = 'acc-1'
  h.accountAuthMode = 'apikey'
  h.codexHomeFails = false
  h.active = []
})

afterEach(async () => {
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  if (originalDevinBin === undefined) delete process.env.AWOG_DEVIN_BIN
  else process.env.AWOG_DEVIN_BIN = originalDevinBin
  await rm(ws, { recursive: true, force: true })
  await rm(binDir, { recursive: true, force: true })
})

// ─── Claude spawn ────────────────────────────────────────────────────────────

describe('openCliLink — claude', () => {
  it('có sdkSessionId → argv `--resume <id>`, linked, env từ buildSdkEnv', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-live' })
    const res = await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })

    expect(res).toMatchObject({ kind: 'claude', linked: true })
    const call = h.calls[0]
    expect(call.file).toBe('/fake/bin/claude')
    expect(call.args).toEqual(['--resume', 'sdk-live'])
    expect(call.env).toEqual({ SDK_MARKER: '1' }) // env PTY = buildSdkEnv nguyên xi
    expect(call.cwd).toBe(ws)
    // Khoá gom nhóm tách khỏi shell thường của phiên
    expect(call.sessionId).toBe(`cli:${h.session.id}`)
    expect(isCliAttached(h.session.id)).toBe(true)
    // resume → KHÔNG có pending id
    expect(cliLastLinkFor(h.session.id)?.pendingSdkSessionId).toBeUndefined()
  })

  it('chưa có sdkSessionId → `--session-id <uuid mới>` + link giữ pendingSdkSessionId', async () => {
    h.session = nextSession()
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })

    const call = h.calls[0]
    expect(call.args[0]).toBe('--session-id')
    expect(call.args[1]).toMatch(/^[0-9a-f-]{36}$/)
    // uuid phải trùng cái registry giữ — importer nhận nuôi bằng nó
    expect(cliLastLinkFor(h.session.id)?.pendingSdkSessionId).toBe(call.args[1])
  })

  it('không resolve được credential → vẫn spawn, env = base đã lọc secret', async () => {
    process.env.QA_CLIREG_TOKEN = 'should-not-leak'
    process.env.QA_CLIREG_KEY = 'should-not-leak'
    process.env.ELECTRON_RUN_AS_NODE = '1'
    try {
      h.credentialFails = true
      h.session = nextSession()
      await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })

      const env = h.calls[0].env
      expect(env.SDK_MARKER).toBeUndefined() // không qua buildSdkEnv
      expect(env.QA_CLIREG_TOKEN).toBeUndefined()
      expect(env.QA_CLIREG_KEY).toBeUndefined()
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
      expect(env.TERM_PROGRAM).toBe('AWOG')
    } finally {
      delete process.env.QA_CLIREG_TOKEN
      delete process.env.QA_CLIREG_KEY
      delete process.env.ELECTRON_RUN_AS_NODE
    }
  })

  it('thiếu binary claude (resolve hụt + PATH trống) → -32021', async () => {
    h.claudeBin = undefined
    process.env.PATH = ''
    h.session = nextSession()
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.calls).toHaveLength(0)
  })
})

// ─── Idempotency / link lifecycle ────────────────────────────────────────────

describe('openCliLink — link lifecycle', () => {
  it('openCli lần hai CÙNG kind → alreadyOpen, KHÔNG spawn PTY thứ hai', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x' })
    const r1 = await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    const r2 = await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })

    expect(r2.alreadyOpen).toBe(true)
    expect(r2.terminalId).toBe(r1.terminalId)
    expect(h.calls).toHaveLength(1)
  })

  it('đang gắn kind khác → -32021 (hai PTY cùng resume một transcript = fork)', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x' })
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })

    process.env.AWOG_DEVIN_BIN = join(binDir, 'devin')
    await writeFile(process.env.AWOG_DEVIN_BIN, '')
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'devin', ...BASE }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.calls).toHaveLength(1)
  })

  it('onExit → gỡ live link + GIỮ lastLink (importer cần pending) + bắn import', async () => {
    h.session = nextSession() // pending path
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    const link = cliLinkFor(h.session.id)
    expect(link?.pendingSdkSessionId).toBeTruthy()

    fireExit(0)
    // Cho micro-task của void importCliTranscript chạy
    await Promise.resolve()
    expect(isCliAttached(h.session.id)).toBe(false)
    expect(cliLinkFor(h.session.id)).toBeUndefined()
    // lastLink giữ pending — nhánh adoption của importer vẫn đọc được
    expect(cliLastLinkFor(h.session.id)?.pendingSdkSessionId).toBe(
      link?.pendingSdkSessionId,
    )
    expect(h.imported).toEqual([{ sessionId: h.session.id, kind: 'claude' }])
  })

  it('spawn xong mới đăng ký link — spawn fail không để lại link rỗng', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x' })
    h.claudeBin = undefined
    process.env.PATH = ''
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(isCliAttached(h.session.id)).toBe(false)
    expect(cliLastLinkFor(h.session.id)).toBeUndefined()
  })
})

// ─── Codex spawn ─────────────────────────────────────────────────────────────

describe('openCliLink — codex', () => {
  it('thiếu codexThreadId → -32021 "send one message first"', async () => {
    h.session = nextSession({ settings: { provider: 'openai', accountId: 'acc-1' } })
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'codex', ...BASE }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.calls).toHaveLength(0)
  })

  it('có threadId → argv `resume <id>`, env sạch + CODEX_HOME theo account.id', async () => {
    h.accountId = 'acc-9'
    h.session = nextSession({
      settings: { provider: 'openai', accountId: 'acc-9' },
      codexThreadId: 'thr-42',
    })
    process.env.QA_CLIREG_TOKEN = 'no-leak'
    try {
      const res = await openCliLink({ sessionId: h.session.id, kind: 'codex', ...BASE })
      expect(res).toMatchObject({ kind: 'codex', linked: true })
      const call = h.calls[0]
      expect(call.file).toBe('/fake/bin/codex')
      expect(call.args).toEqual(['resume', 'thr-42'])
      expect(call.env.CODEX_HOME).toBe('/codex-home/acc-9') // home theo account
      expect(call.env.QA_CLIREG_TOKEN).toBeUndefined() // env sạch
      expect(call.env.SDK_MARKER).toBeUndefined() // không qua buildSdkEnv
      expect(call.env.TERM_PROGRAM).toBe('AWOG')
    } finally {
      delete process.env.QA_CLIREG_TOKEN
    }
  })

  it('thiếu codex binary → -32021', async () => {
    h.codexBin = undefined
    h.session = nextSession({
      settings: { provider: 'openai', accountId: 'acc-1' },
      codexThreadId: 'thr-1',
    })
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'codex', ...BASE }),
    ).rejects.toMatchObject({ code: -32021 })
  })

  it('account apikey → ensureCodexHome kind api-key, secret = apiKey', async () => {
    h.session = nextSession({
      settings: { provider: 'openai', accountId: 'acc-k' },
      codexThreadId: 'thr-1',
    })
    await openCliLink({ sessionId: h.session.id, kind: 'codex', ...BASE })
    expect(h.codexHomeCalls).toEqual([
      { accountId: 'acc-k', secret: 'api-key-1', kind: 'api-key' },
    ])
    expect(h.calls[0].env.CODEX_HOME).toBe('/codex-home/acc-k')
  })

  it('account oauth (ChatGPT subscription) → kind access-token, secret = piOAuth.access', async () => {
    h.accountAuthMode = 'oauth'
    h.session = nextSession({
      settings: { provider: 'openai', accountId: 'acc-sub' },
      codexThreadId: 'thr-1',
    })
    await openCliLink({ sessionId: h.session.id, kind: 'codex', ...BASE })
    expect(h.codexHomeCalls).toEqual([
      { accountId: 'acc-sub', secret: 'chatgpt-bearer-1', kind: 'access-token' },
    ])
    expect(h.calls[0].env.CODEX_HOME).toBe('/codex-home/acc-sub')
  })

  it('provision codex home thất bại → -32021, KHÔNG spawn PTY', async () => {
    h.codexHomeFails = true
    h.session = nextSession({
      settings: { provider: 'openai', accountId: 'acc-1' },
      codexThreadId: 'thr-1',
    })
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'codex', ...BASE }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.calls).toHaveLength(0)
  })
})

// ─── Devin spawn ─────────────────────────────────────────────────────────────

describe('openCliLink — devin', () => {
  it('binary qua AWOG_DEVIN_BIN → argv rỗng, linked=false, env sạch', async () => {
    const bin = join(binDir, 'devin')
    await writeFile(bin, '#!/bin/sh\n')
    process.env.AWOG_DEVIN_BIN = bin
    h.session = nextSession()

    const res = await openCliLink({ sessionId: h.session.id, kind: 'devin', ...BASE })
    expect(res).toMatchObject({ kind: 'devin', linked: false })
    const call = h.calls[0]
    expect(call.file).toBe(bin)
    expect(call.args).toEqual([])
    expect(call.env.TERM_PROGRAM).toBe('AWOG')
    // spawnedAt phải có — importer devin dùng nó làm mtime floor
    expect(cliLastLinkFor(h.session.id)?.spawnedAt).toBeGreaterThan(0)
  })

  it('không có binary (PATH trống + override rỗng) → -32021', async () => {
    delete process.env.AWOG_DEVIN_BIN
    process.env.PATH = ''
    h.session = nextSession()
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'devin', ...BASE }),
    ).rejects.toMatchObject({ code: -32021 })
  })
})

// ─── cwd resolution ──────────────────────────────────────────────────────────

describe('openCliLink — cwd', () => {
  it('workspaceFolder hợp lệ → cwd = workspaceFolder', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x' })
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    expect(h.calls[0].cwd).toBe(ws)
  })

  it('workspaceFolder đã bị xoá → fallback project.path', async () => {
    h.session = nextSession({
      sdkSessionId: 'sdk-x',
      workspaceFolder: join(ws, 'khong-con'),
      projectId: 'proj-1',
    })
    h.project = { path: ws }
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    expect(h.calls[0].cwd).toBe(ws)
  })

  it('không workspaceFolder, không project → -32021 "no workspace"', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x', workspaceFolder: undefined })
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE }),
    ).rejects.toMatchObject({ code: -32021, message: expect.stringContaining('workspace') })
    expect(h.calls).toHaveLength(0)
  })

  it('session không tồn tại → -32004', async () => {
    h.session = undefined
    await expect(
      openCliLink({ sessionId: 'ses-mất', kind: 'claude', ...BASE }),
    ).rejects.toMatchObject({ code: -32004 })
  })
})

// ─── TOCTOU + spawn-evidence + stale link (review fixes) ─────────────────────

describe('openCliLink — TOCTOU sau spawn', () => {
  it('turn xuất hiện trong khe spawn→links.set → giết PTY mới, -32021, không link', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x' })
    h.active = [h.session.id] // lượt AWOG thắng đúng khe spawn→link
    await expect(
      openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE }),
    ).rejects.toMatchObject({ code: -32021 })
    expect(h.calls).toHaveLength(1) // spawn ĐÃ đi qua — PTY thật đã tồn tại
    expect(h.killed).toEqual(['term-1']) // …và bị giết ngay
    expect(isCliAttached(h.session.id)).toBe(false)
    // lastLink cũng không được set — transcript chưa ai dùng
    expect(cliLastLinkFor(h.session.id)).toBeUndefined()
  })
})

describe('persistCliSpawnEvidence', () => {
  // persistCliSpawnEvidence là fire-and-forget (void) — flush 2 nhịp microtask
  // (loadSession → updateSessionMetadata) trước khi assert.
  async function flushPersist(): Promise<void> {
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
  }

  function cliImportCursor(): Record<string, Record<string, unknown>> | undefined {
    const patch = h.metadataPatches.find((p) => 'cliImport' in p)
    return patch?.cliImport as Record<string, Record<string, unknown>> | undefined
  }

  it('claude pending → ghi spawnedAt + pendingSdkSessionId, giữ cursor kind khác', async () => {
    h.session = nextSession({
      cliImport: { devin: { file: '/d.json', offset: 3 } },
    })
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    await flushPersist()

    const cursor = cliImportCursor()
    expect(cursor?.claude?.spawnedAt).toBeGreaterThan(0)
    expect(cursor?.claude?.pendingSdkSessionId).toBe(
      cliLastLinkFor(h.session.id)?.pendingSdkSessionId,
    )
    expect(cursor?.devin).toMatchObject({ file: '/d.json', offset: 3 })
  })

  it('merge trên cursor cũ — file/offset của lần sync trước KHÔNG bị đè', async () => {
    h.session = nextSession({
      sdkSessionId: 'sdk-x',
      cliImport: { claude: { file: '/old.jsonl', offset: 42 } },
    })
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    await flushPersist()

    const claude = cliImportCursor()?.claude
    expect(claude).toMatchObject({ file: '/old.jsonl', offset: 42 })
    expect(claude?.spawnedAt).toBeGreaterThan(0)
  })

  it('resume-spawn XOÁ pendingSdkSessionId cũ khỏi cursor (không để dead weight)', async () => {
    h.session = nextSession({
      sdkSessionId: 'sdk-x',
      cliImport: { claude: { pendingSdkSessionId: 'pend-cũ', spawnedAt: 1 } },
    })
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    await flushPersist()

    const claude = cliImportCursor()?.claude
    expect('pendingSdkSessionId' in (claude ?? {})).toBe(false)
    expect(claude?.spawnedAt).toBeGreaterThan(1)
  })

})

describe('assertCliDetachedForDelete', () => {
  it('link SỐNG (record PTY còn, đúng group cli:) → -32021', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x' })
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    expect(() => assertCliDetachedForDelete(h.session!.id)).toThrowError(
      expect.objectContaining({ code: -32021 }),
    )
    expect(isCliAttached(h.session.id)).toBe(true) // link không bị gỡ
  })

  it('record PTY đã reap (link stale) → gỡ live link, GIỮ lastLink, cho xoá', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x' })
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    h.liveTerminals.delete('term-1') // manager đã reap record trước đó
    expect(() => assertCliDetachedForDelete(h.session!.id)).not.toThrow()
    expect(isCliAttached(h.session.id)).toBe(false)
    // lastLink vẫn còn — importer cần pendingSdkSessionId/spawnedAt của nó
    expect(cliLastLinkFor(h.session.id)?.terminalId).toBe('term-1')
  })

  it('record còn nhưng KHÔNG thuộc group cli: của phiên → coi như stale, cho xoá', async () => {
    h.session = nextSession({ sdkSessionId: 'sdk-x' })
    await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
    h.liveTerminals.set('term-1', `ses:${h.session.id}`) // record bị đổi group
    expect(() => assertCliDetachedForDelete(h.session!.id)).not.toThrow()
    expect(isCliAttached(h.session.id)).toBe(false)
  })

  it('không có link → no-op', () => {
    expect(() => assertCliDetachedForDelete('ses-mới')).not.toThrow()
  })
})

describe('openCliLink — import sau exit defer theo turn', () => {
  it('turn đang chạy lúc PTY-exit → import đợi poll ~2s tới khi turn xong', async () => {
    vi.useFakeTimers()
    try {
      h.session = nextSession({ sdkSessionId: 'sdk-x' })
      await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
      h.active = [h.session.id] // turn AWOG bắt đầu SAU khi CLI đã mở
      fireExit(0)
      // Poll đầu ở ~2s: turn vẫn chạy → chưa import
      await vi.advanceTimersByTimeAsync(2_100)
      expect(h.imported).toHaveLength(0)
      h.active = []
      await vi.advanceTimersByTimeAsync(2_100)
      expect(h.imported).toEqual([{ sessionId: h.session.id, kind: 'claude' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('turn kéo dài quá ~60s sau PTY-exit → bỏ lượt import (syncCli thủ công nhặt sau)', async () => {
    vi.useFakeTimers()
    try {
      h.session = nextSession({ sdkSessionId: 'sdk-x' })
      await openCliLink({ sessionId: h.session.id, kind: 'claude', ...BASE })
      h.active = [h.session.id]
      fireExit(0)
      await vi.advanceTimersByTimeAsync(65_000)
      expect(h.imported).toHaveLength(0)
      // Turn xong sau deadline — importer đã return, không ai đánh thức nữa
      h.active = []
      await vi.advanceTimersByTimeAsync(5_000)
      expect(h.imported).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
