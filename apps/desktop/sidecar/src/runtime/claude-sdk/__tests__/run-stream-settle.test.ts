// Lượt chat nhánh Claude SDK phải tự kết thúc sau `result` kể cả khi CLI không bao
// giờ gửi `session_state_changed: idle`.
//
// Lỗi thật (docs/features/claude-sdk-idle-settle-prompt-suggestion.md): bật
// `promptSuggestions` làm CLI phát `prompt_suggestion` SAU `result`. Vòng `for await`
// coi MỌI message là "model vừa bị đánh thức" và huỷ `idleTimer`; CLI không gửi
// `idle` ⇒ không còn gì đóng stdin ⇒ lượt treo tới khi người dùng bấm Stop (và bị
// lưu canceled dù reply đã đủ). S1/S2 tái hiện đúng lỗi đó và ĐỎ trên code cũ.
//
// Test đi qua vòng lặp THẬT của `runStreamClaude`: `query()` được thay bằng một CLI
// giả mà luồng output kết thúc khi — và chỉ khi — stdin (prompt generator) đóng,
// đúng như tiến trình CLI thật. Timer giả chỉ cài SAU khi setup xong (setup chạy
// trên I/O thật trong một HOME tạm rỗng).
//
// Run: `npx vitest run src/runtime/claude-sdk/__tests__/run-stream-settle.test.ts`
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Mock, MockInstance } from 'vitest'
import type { RunNonStreamArgs, RunStreamResult, StreamCallbacks } from '../../../sessions/runner.js'
import type { SessionQuestionReply } from '../../../types/shared.js'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// CLI giả. Hai bất biến mà test dựa vào:
//   - output kết thúc đúng lúc stdin đóng (`inputClosed`), như tiến trình CLI thật;
//   - `emit` chỉ trả về khi consumer gọi `next()` LẦN KẾ TIẾP, tức thân vòng lặp
//     cho message đó đã chạy xong — không đoán số microtask.
class FakeCli {
  options: Options | undefined
  inputClosed = false
  closed = false
  // Các user message đã được đẩy vào stdin (đúng thứ tự), dạng text.
  readonly userMessages: string[] = []
  readonly interrupt = vi.fn(async () => undefined)
  readonly stopTask = vi.fn(async () => {})
  // Live reconfiguration (LiveClaude.reconfigure) — each resolves like the real CLI.
  readonly setModel = vi.fn(async (_model?: string) => undefined)
  readonly setMaxThinkingTokens = vi.fn(async (_n: number | null, _display?: unknown) => undefined)
  readonly applyFlagSettings = vi.fn(async (_flags: Record<string, unknown>) => undefined)
  readonly setMcpServers = vi.fn(async (_servers: Record<string, unknown>) => ({
    added: [] as string[],
    removed: [] as string[],
    errors: {} as Record<string, string>,
  }))
  private ended = false
  private readonly startedSignal = deferred<void>()
  readonly started = this.startedSignal.promise
  private parked: ((r: IteratorResult<SDKMessage>) => void) | undefined
  private pullWaiters: (() => void)[] = []
  private hasStarted = false

  start(input: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }): unknown {
    this.options = input.options
    void (async () => {
      for await (const m of input.prompt) {
        const content = m.message.content
        this.userMessages.push(
          typeof content === 'string' ? content : content.map((b) => ('text' in b ? String(b.text) : '')).join(''),
        )
      }
      this.inputClosed = true
      this.end()
    })()
    const next = (): Promise<IteratorResult<SDKMessage>> => {
      if (!this.hasStarted) {
        this.hasStarted = true
        this.startedSignal.resolve()
      }
      const waiters = this.pullWaiters
      this.pullWaiters = []
      for (const w of waiters) w()
      if (this.ended) return Promise.resolve({ value: undefined, done: true })
      return new Promise((resolve) => {
        this.parked = resolve
      })
    }
    const iterator = {
      next,
      return: async (): Promise<IteratorResult<SDKMessage>> => ({ value: undefined, done: true }),
      [Symbol.asyncIterator]() {
        return iterator
      },
      stopTask: this.stopTask,
      interrupt: this.interrupt,
      setModel: this.setModel,
      setMaxThinkingTokens: this.setMaxThinkingTokens,
      applyFlagSettings: this.applyFlagSettings,
      setMcpServers: this.setMcpServers,
      close: () => {
        this.closed = true
        this.end()
      },
    }
    return iterator
  }

  end(): void {
    this.ended = true
    this.parked?.({ value: undefined, done: true })
    this.parked = undefined
  }

  async emit(msg: SDKMessage): Promise<void> {
    const deliver = this.parked
    if (!deliver) throw new Error('fake CLI: pump is not waiting for a message')
    this.parked = undefined
    const pulled = new Promise<void>((r) => this.pullWaiters.push(r))
    deliver({ value: msg, done: false })
    await pulled
  }
}

// Mỗi `query()` lấy một CLI từ hàng đợi — test nhiều lượt cần biết process nào là process nào.
const harness: { queue: FakeCli[]; spawned: FakeCli[] } = {
  queue: [],
  spawned: [],
}

// Giữ export thật: ~12 builder `build*SdkServer` gọi `createSdkMcpServer`/`tool` thật lúc
// dựng options (in-process, không spawn gì).
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: (input: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => {
    const cli = harness.queue.shift()
    if (!cli) throw new Error('fake CLI not installed')
    harness.spawned.push(cli)
    return cli.start(input)
  },
}))

// Không đụng keychain / OAuth thật.
vi.mock('../../../credentials/credential-resolver.js', () => ({
  FROZEN_TOKEN_MIN_LIFETIME_MS: 0,
  resolveCredential: async () => ({
    account: { id: 'acc-1', provider: 'anthropic' },
    cred: { kind: 'oauth', accessToken: 'test-token' },
  }),
}))

// Module thật `emit` ra stdout của transport.
vi.mock('../../../sessions/bg-registry.js', () => ({
  noteExternalOutputFile: vi.fn(),
  registerExternalBackground: vi.fn(),
  settleExternalBackground: vi.fn(),
  settleAllExternalBackground: vi.fn(),
  setExternalKiller: vi.fn(),
  clearExternalKiller: vi.fn(),
  notifyExternalWake: vi.fn(),
}))

// HOME tạm đặt TRƯỚC khi nạp run-stream, phòng module nào tính đường dẫn lúc load.
const originalHome = process.env.HOME
const tempHome = await mkdtemp(join(tmpdir(), 'awog-settle-'))
process.env.HOME = tempHome

const { log } = await import('../../../util/logger.js')
const bg = await import('../../../sessions/bg-registry.js')
const { runStreamClaude } = await import('../run-stream.js')
const {
  IDLE_SETTLE_MS,
  ABORT_UNWIND_MS,
  LIVE_IDLE_REAP_MS,
  LIVE_MAX_PROCESSES,
  TurnState,
  closeAllLive,
  closeLive,
  liveCount,
  liveFor,
  reapIdleLive,
  isPassiveAfterResult,
} = await import('../live-process.js')

afterAll(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(tempHome, { recursive: true, force: true })
})

// ── Fixture ───────────────────────────────────────────────────────────────────
const msg = (m: Record<string, unknown>): SDKMessage => m as unknown as SDKMessage
const result = msg({
  type: 'result',
  subtype: 'success',
  result: 'done',
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
  session_id: 'sdk-1',
  uuid: 'r1',
})
const interruptedResult = msg({
  type: 'result',
  subtype: 'error_during_execution',
  result: '',
  usage: { input_tokens: 1, output_tokens: 0 },
  session_id: 'sdk-1',
})
const suggestion = msg({
  type: 'prompt_suggestion',
  suggestion: 'Run the tests',
  uuid: 's1',
  session_id: 'sdk-1',
})
const idle = msg({
  type: 'system',
  subtype: 'session_state_changed',
  state: 'idle',
})
const running = msg({
  type: 'system',
  subtype: 'session_state_changed',
  state: 'running',
})
const assistantText = msg({
  type: 'assistant',
  message: { content: [{ type: 'text', text: 'more' }] },
  parent_tool_use_id: null,
  session_id: 'sdk-1',
})
const streamStart = msg({
  type: 'stream_event',
  event: { type: 'message_start', message: {} },
  parent_tool_use_id: null,
  session_id: 'sdk-1',
})
const textDelta = (text: string): SDKMessage =>
  msg({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
    parent_tool_use_id: null,
    session_id: 'sdk-1',
  })
const taskNotification = (taskId: string): SDKMessage =>
  msg({
    type: 'system',
    subtype: 'task_notification',
    task_id: taskId,
    status: 'completed',
    summary: 'done',
  })
const bgChanged = (tasks: Record<string, unknown>[]): SDKMessage =>
  msg({ type: 'system', subtype: 'background_tasks_changed', tasks })
const rateLimit = msg({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed' },
  uuid: 'rl1',
  session_id: 'sdk-1',
})
const bgShell = [
  {
    task_id: 't1',
    task_type: 'local_bash',
    description: 'sleep 20',
    ambient: false,
  },
]

// ── Per-test state ────────────────────────────────────────────────────────────
type TurnHandle = {
  cb: { onChunk: Mock; onStep: Mock }
  abort: AbortController
  run: Promise<RunStreamResult>
}

let cli: FakeCli
let answer: Deferred<SessionQuestionReply>
let infoSpy: MockInstance
let turn1: TurnHandle

const SESSION = 'live-test'
const infoCalls = (line: string): Record<string, unknown>[] =>
  infoSpy.mock.calls
    .filter((c: unknown[]) => c[0] === line)
    .map((c: unknown[]) => (c[1] ?? {}) as Record<string, unknown>)
const SETTLED_LINE = 'claude-sdk turn settled without an idle signal'
const CANCEL_LINE = 'claude-sdk settle cancelled — turn continues'
const CLOSE_LINE = 'claude-sdk closing live process'
const closeReasons = (): unknown[] => infoCalls(CLOSE_LINE).map((m) => m.reason)

// setImmediate KHÔNG bị giả (chỉ setTimeout/clearTimeout), nên đây là cách chắc
// chắn để mọi microtask đi theo một lần close (generator → consumer) chạy xong.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setImmediate(r))
}
const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}
// Chờ một điều kiện mà lượt cần I/O thật (git snapshot…) mới đạt được — `settle()` chỉ
// xả microtask, còn máy đang tải thì I/O thật chậm hơn 5 vòng setImmediate.
const until = async (pred: () => boolean): Promise<void> => {
  for (let i = 0; i < 2000 && !pred(); i += 1) await new Promise<void>((r) => setImmediate(r))
  if (!pred()) throw new Error('until: condition not reached')
}

// Có resolve chưa — không await được một lượt chưa xong.
const isSettled = async (p: Promise<unknown>): Promise<boolean> => {
  let done = false
  void p.then(
    () => (done = true),
    () => (done = true),
  )
  await settle()
  return done
}

function startTurn(over: Record<string, unknown> = {}): TurnHandle {
  const abort = new AbortController()
  const cb = { onChunk: vi.fn(), onStep: vi.fn() }
  const args = {
    sessionId: SESSION,
    pendingText: 'hi',
    history: [],
    settings: { provider: 'anthropic', modelId: 'claude-sonnet-5', level: 'medium' },
    contextConfig: { wikiEnabled: false, memoryEnabled: false },
    abortController: abort,
    askUserQuestion: vi.fn(() => answer.promise),
    ...over,
  } as unknown as RunNonStreamArgs
  // Một lượt bị huỷ giữa chừng reject; test không await mọi lượt, nên đánh dấu đã-xử-lý
  // (người await `run` vẫn thấy lỗi).
  const run = runStreamClaude(args, cb as unknown as StreamCallbacks)
  run.catch(() => {})
  return { cb, abort, run }
}

// Mở một câu hỏi người dùng qua đường thật: elicitation → wrapper askUserQuestion (đếm
// humanParks) → args.askUserQuestion. Không await lúc mở; promise trả về chỉ resolve SAU
// `finally` của wrapper, nơi lượt arm lại nhịp settle.
const openQuestion = (c: FakeCli, signal: AbortSignal): Promise<unknown> => {
  const onElicitation = c.options?.onElicitation
  if (!onElicitation) throw new Error('onElicitation not wired')
  return onElicitation(
    {
      serverName: 'srv',
      mode: 'url',
      url: 'https://example.com/auth',
      message: 'auth',
    },
    { signal, requestId: 'elicit-test' },
  )
}

// Chỉ các describe chạy qua vòng lặp thật mới dựng harness — U1 là test thuần.
function useRunHarness(): void {
  beforeEach(async () => {
    cli = new FakeCli()
    harness.queue = [cli]
    harness.spawned = []
    answer = deferred<SessionQuestionReply>()
    infoSpy = vi.spyOn(log, 'info')
    turn1 = startTurn()
    // Lỗi setup phải hiện ra ngay thay vì treo ở `started`.
    await Promise.race([cli.started, turn1.run.then(() => undefined)])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(async () => {
    // Abort trước, rồi mới await: một lượt treo phải đỏ ở assert chứ không treo tới timeout.
    turn1.abort.abort()
    answer.resolve({ answers: [] })
    closeAllLive('test end')
    await turn1.run.catch(() => {})
    vi.useRealTimers()
    infoSpy.mockRestore()
    harness.queue = []
    vi.mocked(bg.notifyExternalWake).mockClear()
    vi.mocked(bg.settleAllExternalBackground).mockClear()
  })
}

// ── Kết thúc lượt ─────────────────────────────────────────────────────────────
describe('runStreamClaude — kết thúc lượt, process KHÔNG đóng', () => {
  useRunHarness()

  it('S1: result → prompt_suggestion, không idle ⇒ lượt kết thúc đúng IDLE_SETTLE_MS sau result, process sống (AC-1/3/4)', async () => {
    await cli.emit(result)
    await advance(1000)
    await cli.emit(suggestion)
    await advance(IDLE_SETTLE_MS - 1000 - 1)
    expect(await isSettled(turn1.run)).toBe(false)

    await advance(1)
    const res = await turn1.run
    expect(infoCalls(SETTLED_LINE)).toHaveLength(1)
    expect(res.usage.input_tokens).toBe(10)
    expect(res.stopReason).not.toBe('error')
    expect(cli.inputClosed).toBe(false)
    expect(cli.closed).toBe(false)
    expect(liveFor(SESSION)).toBeDefined()
    expect(turn1.cb.onStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'suggest-s1' }))
  })

  it('S2: trả lời câu hỏi sau result → prompt_suggestion ⇒ lượt kết thúc đúng IDLE_SETTLE_MS sau lúc trả lời (AC-10)', async () => {
    const question = openQuestion(cli, turn1.abort.signal)
    await settle()
    await cli.emit(result)
    await advance(10_000)
    expect(await isSettled(turn1.run)).toBe(false)

    answer.resolve({ answers: [] })
    await question
    await cli.emit(suggestion)
    await advance(IDLE_SETTLE_MS - 1)
    expect(await isSettled(turn1.run)).toBe(false)

    await advance(1)
    await turn1.run
    expect(infoCalls(SETTLED_LINE)).toHaveLength(1)
    expect(cli.closed).toBe(false)
  })

  it.each([
    ['assistant', assistantText, undefined],
    ['stream_event', streamStart, undefined],
    ['system', taskNotification('orphan'), 'task_notification'],
  ])(
    'S3: result → %s (model bị đánh thức) ⇒ huỷ settle, log D-5, lượt chạy tiếp (AC-5)',
    async (type, wake, subtype) => {
      await cli.emit(result)
      await advance(1000)
      await cli.emit(wake)
      await advance(10_000)
      expect(await isSettled(turn1.run)).toBe(false)
      expect(infoCalls(CANCEL_LINE)).toEqual([expect.objectContaining({ sessionId: SESSION, type, subtype })])

      await cli.emit(assistantText)
      await cli.emit(result)
      await advance(IDLE_SETTLE_MS - 1)
      expect(await isSettled(turn1.run)).toBe(false)
      await advance(1)
      await turn1.run
      expect(infoCalls(SETTLED_LINE)).toHaveLength(1)
    },
  )

  it('S4: result → prompt_suggestion → assistant ⇒ huỷ settle, chỉ kết thúc sau result kế (AC-6)', async () => {
    await cli.emit(result)
    await cli.emit(suggestion)
    await cli.emit(assistantText)
    await advance(10_000)
    expect(await isSettled(turn1.run)).toBe(false)

    await cli.emit(result)
    await advance(IDLE_SETTLE_MS - 1)
    expect(await isSettled(turn1.run)).toBe(false)
    await advance(1)
    await turn1.run
  })

  it.each([
    ['result → idle', [result, idle]],
    ['result → prompt_suggestion → idle', [result, suggestion, idle]],
  ])('S5: %s ⇒ lượt kết thúc NGAY, không log D-5, process sống (AC-7)', async (_label, seq) => {
    for (const m of seq) await cli.emit(m)
    await settle()
    await turn1.run
    expect(infoCalls(CANCEL_LINE)).toEqual([])
    expect(infoCalls(SETTLED_LINE)).toEqual([])
    expect(cli.closed).toBe(false)
    expect(liveFor(SESSION)).toBeDefined()
  })

  // Đảo ngược có chủ đích của bản giữ-lượt-mở: `idle` 1ms sau `result` là "không đang sinh
  // chữ", KHÔNG phải "việc nền xong" — nhưng việc nền giờ thuộc về process, không còn là lý
  // do để giữ lượt (và khoá phiên) tới 30 phút.
  it('S6: còn background task đang chạy ⇒ lượt VẪN kết thúc ở idle; task + process sống tiếp', async () => {
    await cli.emit(bgChanged(bgShell))
    await cli.emit(result)
    await cli.emit(suggestion)
    await cli.emit(idle)
    await settle()
    await turn1.run

    expect(cli.closed).toBe(false)
    expect(vi.mocked(bg.registerExternalBackground)).toHaveBeenCalledWith(
      expect.objectContaining({ shellId: 't1', command: 'sleep 20' }),
    )
    // Lượt hết ≠ task chết: sổ đăng ký không bị quét.
    expect(vi.mocked(bg.settleAllExternalBackground)).not.toHaveBeenCalled()
    await advance(60 * 60_000)
    expect(cli.closed).toBe(false)
  })

  it('S7: câu hỏi còn mở ⇒ không hạn nào kết thúc lượt (AC-9)', async () => {
    void openQuestion(cli, turn1.abort.signal)
    await settle()
    await cli.emit(result)
    await cli.emit(suggestion)
    await cli.emit(idle)
    await advance(600_000)
    expect(await isSettled(turn1.run)).toBe(false)
    expect(infoCalls(SETTLED_LINE)).toEqual([])
  })
})

describe('isPassiveAfterResult (U1)', () => {
  it.each(['prompt_suggestion', 'rate_limit_event'])('%s là thụ động', (type) => {
    expect(isPassiveAfterResult(msg({ type }))).toBe(true)
  })

  // Chiều an toàn của D-1: loại lạ và mọi `system/*` vẫn là hoạt động.
  it.each([
    msg({ type: 'assistant' }),
    msg({ type: 'stream_event' }),
    msg({ type: 'user' }),
    msg({ type: 'result' }),
    msg({ type: 'system', subtype: 'session_state_changed', state: 'idle' }),
    msg({ type: 'system', subtype: 'session_state_changed', state: 'running' }),
    msg({ type: 'system', subtype: 'task_notification' }),
    msg({ type: 'future_message' }),
  ])('%o KHÔNG thụ động', (m) => {
    expect(isPassiveAfterResult(m)).toBe(false)
  })
})

// Edge case bổ sung (QA) — các chuỗi message mà S1–S7 chưa phủ.
describe('runStreamClaude — kết thúc lượt: edge case bổ sung (QA)', () => {
  useRunHarness()

  it('E-11: nhiều message thụ động liên tiếp (suggestion, rate_limit, suggestion) không đẩy lùi hạn', async () => {
    await cli.emit(assistantText)
    await cli.emit(result)
    await advance(1000)
    await cli.emit(suggestion)
    await advance(1000)
    await cli.emit(rateLimit)
    await advance(1000)
    await cli.emit(msg({ type: 'prompt_suggestion', suggestion: 'Again', uuid: 's2' }))
    await advance(IDLE_SETTLE_MS - 3000 - 1)
    expect(await isSettled(turn1.run)).toBe(false)
    await advance(1)
    await turn1.run
    expect(infoCalls(SETTLED_LINE)).toHaveLength(1)
    expect(infoCalls(CANCEL_LINE)).toEqual([])
  })

  it('result → suggestion → session_state_changed: running ⇒ huỷ settle (đánh thức thật), log D-5; kết thúc sau result kế', async () => {
    await cli.emit(result)
    await cli.emit(suggestion)
    await cli.emit(running)
    await advance(10_000)
    expect(await isSettled(turn1.run)).toBe(false)
    expect(infoCalls(CANCEL_LINE)).toEqual([
      expect.objectContaining({
        type: 'system',
        subtype: 'session_state_changed',
      }),
    ])

    await cli.emit(assistantText)
    await cli.emit(result)
    await cli.emit(suggestion)
    await advance(IDLE_SETTLE_MS - 1)
    expect(await isSettled(turn1.run)).toBe(false)
    await advance(1)
    await turn1.run
  })

  it.each([
    ['suggestion rỗng', msg({ type: 'prompt_suggestion', suggestion: '   ', uuid: 'se' })],
    ['suggestion không phải string', msg({ type: 'prompt_suggestion', suggestion: 42, uuid: 'sn' })],
  ])('E-8: %s ⇒ không chip, hạn settle vẫn giữ', async (_label, bad) => {
    await cli.emit(result)
    await cli.emit(bad)
    await advance(IDLE_SETTLE_MS - 1)
    expect(await isSettled(turn1.run)).toBe(false)
    await advance(1)
    await turn1.run
    const stepIds = turn1.cb.onStep.mock.calls.map((c: unknown[]) => (c[0] as { id?: string }).id)
    expect(stepIds.filter((id) => String(id).startsWith('suggest-'))).toEqual([])
  })

  it('E-5: CLI còn xả prompt_suggestion SAU khi lượt đã kết thúc ⇒ không ném, không timer mới, không đánh thức giả', async () => {
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    await turn1.run

    await cli.emit(suggestion)
    await cli.emit(rateLimit)
    await advance(60_000)
    expect(vi.getTimerCount()).toBe(0)
    expect(vi.mocked(bg.notifyExternalWake)).not.toHaveBeenCalled()
    expect(cli.closed).toBe(false)
  })
})

// ── Cancel: dừng sinh, KHÔNG giết process ─────────────────────────────────────
describe('runStreamClaude — Stop interrupt, giữ process và việc nền', () => {
  useRunHarness()

  it('E-13: Stop giữa lượt ⇒ interrupt() (không close), lượt ném CANCELED khi CLI trả result + idle; process + task sống', async () => {
    await cli.emit(bgChanged(bgShell))
    await cli.emit(assistantText)
    turn1.abort.abort()
    await settle()
    expect(cli.interrupt).toHaveBeenCalledTimes(1)
    expect(cli.closed).toBe(false)

    // CLI trả lời interrupt đúng như đã đo: result(error_during_execution) rồi idle.
    await cli.emit(interruptedResult)
    await cli.emit(idle)
    await settle()
    await expect(turn1.run).rejects.toThrow('CANCELED')
    expect(cli.closed).toBe(false)
    expect(liveFor(SESSION)).toBeDefined()
    expect(vi.mocked(bg.settleAllExternalBackground)).not.toHaveBeenCalled()
  })

  it('CLI treo không trả lời interrupt ⇒ sau ABORT_UNWIND_MS process bị đóng (Stop luôn mở khoá phiên)', async () => {
    await cli.emit(assistantText)
    turn1.abort.abort()
    await settle()
    await advance(ABORT_UNWIND_MS - 1)
    expect(cli.closed).toBe(false)
    await advance(1)
    expect(cli.closed).toBe(true)
    expect(closeReasons()).toContain('interrupt did not unwind')
    await expect(turn1.run).rejects.toThrow('CANCELED')
  })
})

// ── Process sống qua lượt ─────────────────────────────────────────────────────
describe('runStreamClaude — một process CLI cho cả phiên (ADR 0099)', () => {
  useRunHarness()

  // Hoàn tất lượt 1 bằng đường idle, trả về CLI.
  const finishTurn1 = async (): Promise<void> => {
    await cli.emit(textDelta('one'))
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    await turn1.run
  }

  it('L1: cấu hình không đổi ⇒ lượt 2 dùng LẠI process: không query() thứ hai, message đi vào cùng stdin, callback của từng lượt tách bạch', async () => {
    await finishTurn1()
    const turn2 = startTurn({ pendingText: 'second', sdkSessionId: 'sdk-1' })
    await settle()
    expect(harness.spawned).toHaveLength(1)
    expect(cli.userMessages).toHaveLength(2)
    expect(cli.userMessages[1]).toContain('second')

    await cli.emit(running)
    await cli.emit(textDelta('two'))
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    const res2 = await turn2.run
    expect(res2.text).toBe('two')
    expect(turn2.cb.onChunk).toHaveBeenCalledWith('two')
    // Chữ của lượt 1 không rò sang bubble lượt 2 và ngược lại.
    expect(turn1.cb.onChunk.mock.calls.flat()).toEqual(['one'])
    expect(cli.closed).toBe(false)
    // Nothing changed ⇒ nothing is applied to the live process.
    expect(cli.setModel).not.toHaveBeenCalled()
    expect(cli.setMaxThinkingTokens).not.toHaveBeenCalled()
    expect(cli.applyFlagSettings).not.toHaveBeenCalled()
    expect(cli.setMcpServers).not.toHaveBeenCalled()
    turn2.abort.abort()
  })

  it('L2: đổi cấu hình CỨNG (tool allow-list) ⇒ đóng process cũ, spawn process mới (query lần hai) với resume đúng handle', async () => {
    await finishTurn1()
    const cli2 = new FakeCli()
    harness.queue.push(cli2)
    const turn2 = startTurn({ sdkSessionId: 'sdk-1', allowedTools: ['Read'] })
    await until(() => harness.spawned.length === 2)
    expect(cli.closed).toBe(true)
    expect(closeReasons()).toContain('spawn config changed')
    expect(harness.spawned).toHaveLength(2)
    expect(cli2.options?.resume).toBe('sdk-1')
    expect(cli2.options?.model).toBeDefined()
    // Lượt đầu mang sessionId do AWOG đặt, không phải resume.
    expect(cli.options?.resume).toBeUndefined()
    expect(cli.options?.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    turn2.abort.abort()
    cli2.end()
    await turn2.run.catch(() => {})
  })

  // Cả bốn thứ đổi cùng lúc: model, thinking (level 'low' = tắt), effort, bộ MCP server
  // (plan mode bỏ server dev). Process và việc nền của nó phải sống.
  it('L2c: đổi model/effort/thinking/MCP ⇒ dùng LẠI process, gọi đúng API trên Query, không spawn', async () => {
    await cli.emit(bgChanged(bgShell))
    await finishTurn1()
    const turn2 = startTurn({
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        level: 'low',
        mode: 'plan',
      },
    })
    await until(() => cli.userMessages.length === 2)
    expect(harness.spawned).toHaveLength(1)
    expect(cli.closed).toBe(false)
    expect(closeReasons()).not.toContain('spawn config changed')
    expect(cli.setModel).toHaveBeenCalledExactlyOnceWith('claude-haiku-4-5')
    expect(cli.setMaxThinkingTokens).toHaveBeenCalledExactlyOnceWith(0)
    expect(cli.applyFlagSettings).toHaveBeenCalledExactlyOnceWith({
      effortLevel: 'low',
    })
    expect(cli.setMcpServers).toHaveBeenCalledTimes(1)
    const servers = cli.setMcpServers.mock.calls[0]?.[0] ?? {}
    expect(Object.keys(servers)).not.toContain('awogdev')
    expect(Object.keys(servers)).toContain('awogsurfaces')
    // Việc nền vẫn nằm trong process.
    expect(liveFor(SESSION)?.waitingCount()).toBe(1)
    expect(cli.userMessages[1]).toContain('hi')
    turn2.abort.abort()
  })

  it('L2d: ultracode bật/tắt ⇒ applyFlagSettings gửi CẢ HAI khoá; tắt về thì gửi ultracode:false', async () => {
    await finishTurn1()
    const on = startTurn({
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'medium',
        ultracode: true,
      },
    })
    await until(() => cli.userMessages.length === 2)
    expect(cli.applyFlagSettings).toHaveBeenLastCalledWith({
      effortLevel: 'xhigh',
      ultracode: true,
    })
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    await on.run
    const off = startTurn({
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'medium',
        ultracode: false,
      },
    })
    await until(() => cli.userMessages.length === 3)
    expect(cli.applyFlagSettings).toHaveBeenLastCalledWith({
      effortLevel: 'medium',
      ultracode: false,
    })
    expect(cli.applyFlagSettings).toHaveBeenCalledTimes(2)
    expect(harness.spawned).toHaveLength(1)
    expect(cli.closed).toBe(false)
    off.abort.abort()
  })

  it('L2e: bật lại thinking ⇒ setMaxThinkingTokens(31_999, "summarized")', async () => {
    // Lượt 1 đã là adaptive; hạ xuống rồi nâng lại.
    await finishTurn1()
    const low = startTurn({
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'low',
      },
    })
    await until(() => cli.userMessages.length === 2)
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    await low.run
    const high = startTurn({ sdkSessionId: 'sdk-1' })
    await until(() => cli.userMessages.length === 3)
    expect(cli.setMaxThinkingTokens).toHaveBeenNthCalledWith(1, 0)
    expect(cli.setMaxThinkingTokens).toHaveBeenNthCalledWith(2, 31_999, 'summarized')
    expect(harness.spawned).toHaveLength(1)
    high.abort.abort()
  })

  it('L2f: apply trên process sống ném lỗi ⇒ đóng process và spawn thay thế qua resume (như trước đây)', async () => {
    await cli.emit(bgChanged(bgShell))
    await finishTurn1()
    cli.setModel.mockRejectedValueOnce(new Error('model validation failed'))
    const cli2 = new FakeCli()
    harness.queue.push(cli2)
    const warnSpy = vi.spyOn(log, 'warn')
    const turn2 = startTurn({
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        level: 'medium',
      },
    })
    await until(() => harness.spawned.length === 2)
    expect(cli.closed).toBe(true)
    expect(closeReasons()).toContain('live reconfigure failed')
    expect(warnSpy).toHaveBeenCalledWith(
      'claude-sdk: live reconfigure failed — replacing the process',
      expect.objectContaining({ err: 'model validation failed' }),
    )
    expect(harness.spawned).toHaveLength(2)
    expect(cli2.options?.resume).toBe('sdk-1')
    expect(cli2.options?.model).toBe('claude-haiku-4-5')
    warnSpy.mockRestore()
    turn2.abort.abort()
    cli2.end()
    await turn2.run.catch(() => {})
  })

  it('L2g: MCP server nào kết nối lỗi ⇒ coi như apply hỏng ⇒ thay process', async () => {
    await finishTurn1()
    cli.setMcpServers.mockResolvedValueOnce({
      added: [],
      removed: [],
      errors: { awogdev: 'spawn failed' },
    })
    const cli2 = new FakeCli()
    harness.queue.push(cli2)
    const turn2 = startTurn({
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'medium',
        mode: 'plan',
      },
    })
    await until(() => harness.spawned.length === 2)
    expect(cli.closed).toBe(true)
    expect(closeReasons()).toContain('live reconfigure failed')
    expect(harness.spawned).toHaveLength(2)
    turn2.abort.abort()
    cli2.end()
    await turn2.run.catch(() => {})
  })

  // Một Source đã sửa (đổi arg / URL / secret xoay) vẫn giữ NGUYÊN TÊN server, mà CLI so theo
  // tên: một lệnh setMcpServers sẽ giữ kết nối cũ (đo trên CLI thật với server in-process;
  // stdio thì tự thay). Phải gỡ rồi thêm lại, cùng process.
  describe('server MCP đã sửa cấu hình cùng tên', () => {
    // Chạy một lượt TRỌN VẸN trên process hiện có rồi trả về số message đã đẩy.
    const runTurn = async (over: Record<string, unknown>): Promise<void> => {
      const sent = cli.userMessages.length
      const t = startTurn({ sdkSessionId: 'sdk-1', ...over })
      await until(() => cli.userMessages.length === sent + 1)
      await cli.emit(result)
      await cli.emit(idle)
      await settle()
      await t.run
    }
    const stdio = (word: string): Record<string, unknown> => ({
      mcpServers: {
        words: { type: 'stdio', command: 'node', args: ['mcp.js', word] },
      },
    })

    it('stdio: đổi args ⇒ gỡ rồi thêm lại (2 lệnh), không đổi ⇒ không lệnh nào, cùng process', async () => {
      await finishTurn1()
      await runTurn(stdio('ALPHA'))
      // Server mới: một lệnh duy nhất, không gỡ gì.
      expect(cli.setMcpServers).toHaveBeenCalledTimes(1)
      await runTurn(stdio('ALPHA'))
      expect(cli.setMcpServers).toHaveBeenCalledTimes(1)

      await runTurn(stdio('BETA'))
      expect(cli.setMcpServers).toHaveBeenCalledTimes(3)
      const [, removal, readd] = cli.setMcpServers.mock.calls.map((c) => c[0])
      expect(Object.keys(removal ?? {})).not.toContain('words')
      expect(Object.keys(removal ?? {})).toContain('awogsurfaces')
      expect(readd?.words).toMatchObject({ args: ['mcp.js', 'BETA'] })
      expect(harness.spawned).toHaveLength(1)
      expect(cli.closed).toBe(false)
    })

    const apiSource = (baseUrl: string): Record<string, unknown> => ({
      apiSources: [
        {
          id: 'crm_ab12',
          slug: 'crm',
          name: 'CRM',
          type: 'api',
          provider: 'custom',
          enabled: true,
          timeoutMs: 1000,
          trust: 'auto',
          api: { baseUrl, authType: 'none' },
        },
      ],
    })

    it('api source (in-process): sửa baseUrl ⇒ gỡ rồi thêm lại server cùng tên', async () => {
      await finishTurn1()
      await runTurn(apiSource('https://a.example'))
      expect(cli.setMcpServers).toHaveBeenCalledTimes(1)
      await runTurn(apiSource('https://a.example'))
      expect(cli.setMcpServers).toHaveBeenCalledTimes(1)

      await runTurn(apiSource('https://b.example'))
      expect(cli.setMcpServers).toHaveBeenCalledTimes(3)
      const [, removal, readd] = cli.setMcpServers.mock.calls.map((c) => c[0])
      expect(Object.keys(removal ?? {})).not.toContain('crm_ab12')
      expect(Object.keys(readd ?? {})).toContain('crm_ab12')
      expect(harness.spawned).toHaveLength(1)
    })
  })

  it('L2h: lệnh native (/compact) KHÔNG áp cấu hình tối giản của nó lên process sống', async () => {
    await finishTurn1()
    const turn2 = startTurn({
      pendingText: '/compact',
      nativeCommand: true,
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        level: 'low',
        mode: 'ask',
      },
    })
    await until(() => cli.userMessages.length === 2)
    expect(cli.setModel).not.toHaveBeenCalled()
    expect(cli.setMcpServers).not.toHaveBeenCalled()
    turn2.abort.abort()
  })

  // Smoke thật bắt được: `sessions.compact` dựng cấu hình tối giản (mode ask, level low,
  // không MCP/agent) nên dấu vân tay lệch lượt chat ⇒ mỗi /compact spawn lại CLI hai lần
  // và giết task nền đang chạy. Lệnh native đọc trạng thái của chính CLI ⇒ dùng lại process.
  it('L2b: lệnh native (/compact) với cấu hình khác ⇒ vẫn dùng LẠI process, không spawn', async () => {
    await finishTurn1()
    const turn2 = startTurn({
      pendingText: '/compact',
      nativeCommand: true,
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        level: 'low',
        mode: 'ask',
      },
    })
    await settle()
    expect(harness.spawned).toHaveLength(1)
    expect(cli.closed).toBe(false)
    expect(cli.userMessages[1]).toBe('/compact')
    turn2.abort.abort()
  })

  it('L3: handle resume khác cái process đang giữ (truncate/rewind/lượt đầu lỗi) ⇒ thay process', async () => {
    await finishTurn1()
    const cli2 = new FakeCli()
    harness.queue.push(cli2)
    const turn2 = startTurn({ sdkSessionId: 'some-other-session' })
    await settle()
    expect(cli.closed).toBe(true)
    expect(closeReasons()).toContain('resume handle changed')
    expect(cli2.options?.resume).toBe('some-other-session')
    turn2.abort.abort()
    cli2.end()
    await turn2.run.catch(() => {})
  })

  it('L4: hook PreToolUse của process đọc cổng của LƯỢT HIỆN TẠI, không phải lượt đã spawn nó', async () => {
    const hook = (): ((i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<unknown>) =>
      cli.options?.hooks?.PreToolUse?.[0]?.hooks?.[0] as never
    const denyAll = vi.fn(async () => ({ behavior: 'deny', message: 'no' }))
    // Lượt 1 spawn với canUseTool = deny; mode 'ask' ⇒ Write phải hỏi.
    turn1.abort.abort()
    await cli.emit(interruptedResult)
    await cli.emit(idle)
    await turn1.run.catch(() => {})
    closeAllLive('reset')
    vi.useRealTimers()
    const cliA = new FakeCli()
    harness.queue = [cliA]
    const a = startTurn({
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'medium',
        mode: 'ask',
      },
      canUseTool: denyAll,
    })
    await cliA.started
    cli = cliA
    const callHook = async (): Promise<{
      hookSpecificOutput?: { permissionDecision?: string }
    }> =>
      (await hook()(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/x', content: '' },
          tool_use_id: 'tu-1',
        },
        undefined,
        { signal: new AbortController().signal },
      )) as { hookSpecificOutput?: { permissionDecision?: string } }
    const first = await callHook()
    expect(denyAll).toHaveBeenCalledTimes(1)
    expect(first.hookSpecificOutput?.permissionDecision).toBe('deny')

    await cliA.emit(result)
    await cliA.emit(idle)
    await settle()
    await a.run
    // Lượt 2, CÙNG process, cổng mới cho phép.
    const allow = vi.fn(async (_n: string, input: Record<string, unknown>) => ({
      behavior: 'allow',
      updatedInput: input,
    }))
    const b = startTurn({
      sdkSessionId: 'sdk-1',
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'medium',
        mode: 'ask',
      },
      canUseTool: allow,
    })
    await settle()
    // cli (lượt dò đầu, đã đóng) + cliA — lượt b KHÔNG sinh process thứ ba.
    expect(harness.spawned).toHaveLength(2)
    const second = await callHook()
    expect(allow).toHaveBeenCalledTimes(1)
    expect(denyAll).toHaveBeenCalledTimes(1)
    expect(second.hookSpecificOutput?.permissionDecision).toBe('allow')
    b.abort.abort()
    await cliA.emit(interruptedResult)
    await cliA.emit(idle)
    await b.run.catch(() => {})
  })

  it('L5: đóng process giữa lượt (xoá/archive) ⇒ lượt ném lỗi, không trả reply rỗng như thành công', async () => {
    await cli.emit(textDelta('partial'))
    const rejected = expect(turn1.run).rejects.toThrow(/ended before the reply finished/)
    closeLive(SESSION, 'session deleted')
    await settle()
    await rejected
    expect(liveFor(SESSION)).toBeUndefined()
  })

  it('L6: reaper đóng process yên tĩnh quá 5 phút, nhưng KHÔNG đóng process còn việc nền', async () => {
    expect(LIVE_IDLE_REAP_MS).toBe(5 * 60_000)
    await cli.emit(bgChanged(bgShell))
    await finishTurn1()
    reapIdleLive(Date.now() + LIVE_IDLE_REAP_MS + 1)
    expect(cli.closed).toBe(false)

    await cli.emit(taskNotification('t1'))
    await cli.emit(bgChanged([]))
    await settle()
    reapIdleLive(Date.now() + LIVE_IDLE_REAP_MS - 1000)
    expect(cli.closed).toBe(false)
    reapIdleLive(Date.now() + LIVE_IDLE_REAP_MS + 1)
    expect(cli.closed).toBe(true)
    expect(closeReasons()).toContain('idle reaper')
  })

  it('L7: process đóng thì việc nền được quét khỏi sổ đăng ký (không chip "running" mồ côi)', async () => {
    await cli.emit(bgChanged(bgShell))
    await finishTurn1()
    closeLive(SESSION, 'test')
    await settle()
    expect(vi.mocked(bg.settleAllExternalBackground)).toHaveBeenCalledWith(SESSION)
    expect(vi.mocked(bg.clearExternalKiller)).toHaveBeenCalledWith(SESSION)
  })
})

// ── Trần số process + LRU ─────────────────────────────────────────────────────
describe('live process cap — LRU eviction (ADR 0099)', () => {
  useRunHarness()

  let clock = 0
  let nowSpy: MockInstance
  type Extra = { id: string; cli: FakeCli; turn: TurnHandle }

  beforeEach(() => {
    clock = Date.now() + 10_000
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
  })
  afterEach(() => nowSpy.mockRestore())

  const finish = async (c: FakeCli, t: TurnHandle): Promise<void> => {
    await c.emit(result)
    await c.emit(idle)
    await settle()
    await t.run
  }
  // A new session on its own process; `finished: false` leaves its turn RUNNING.
  const spawnSession = async (id: string, opts: { finished?: boolean; bg?: boolean } = {}): Promise<Extra> => {
    clock += 1000
    const c = new FakeCli()
    harness.queue.push(c)
    const t = startTurn({ sessionId: id })
    t.run.catch(() => {})
    await c.started
    if (opts.bg) await c.emit(bgChanged(bgShell))
    if (opts.finished !== false) await finish(c, t)
    return { id, cli: c, turn: t }
  }
  const first = async (): Promise<void> => {
    // The harness's own session: finished, quiet, the OLDEST of all.
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    await turn1.run
  }

  it('đủ 4 process, spawn thứ 5 ⇒ đóng process dùng LÂU NHẤT (lru evicted), số process giữ ở 4', async () => {
    await first()
    const b = await spawnSession('s-b')
    const c = await spawnSession('s-c')
    const d = await spawnSession('s-d')
    expect(liveCount()).toBe(LIVE_MAX_PROCESSES)
    const e = await spawnSession('s-e')
    expect(cli.closed).toBe(true)
    expect(closeReasons()).toEqual(['lru evicted'])
    expect([b, c, d, e].some((x) => x.cli.closed)).toBe(false)
    expect(liveCount()).toBe(LIVE_MAX_PROCESSES)
    expect(liveFor(SESSION)).toBeUndefined()
  })

  it('lượt mới trên một process làm nó "mới dùng" ⇒ LRU chọn process khác', async () => {
    await first()
    const b = await spawnSession('s-b')
    const c = await spawnSession('s-c')
    const d = await spawnSession('s-d')
    // SESSION is touched by a fresh turn, so b becomes the oldest.
    clock += 1000
    const again = startTurn({ sdkSessionId: 'sdk-1' })
    again.run.catch(() => {})
    await until(() => cli.userMessages.length === 2)
    await finish(cli, again)
    await spawnSession('s-e')
    expect(b.cli.closed).toBe(true)
    expect(cli.closed).toBe(false)
    expect(c.cli.closed).toBe(false)
    expect(d.cli.closed).toBe(false)
  })

  it('KHÔNG đóng process còn việc nền hoặc đang chạy lượt, dù nó cũ nhất', async () => {
    // SESSION owns a background shell and is the oldest; s-b has a turn still running.
    await cli.emit(bgChanged(bgShell))
    await first()
    const b = await spawnSession('s-b', { finished: false })
    const c = await spawnSession('s-c')
    const d = await spawnSession('s-d')
    await spawnSession('s-e')
    expect(cli.closed).toBe(false)
    expect(b.cli.closed).toBe(false)
    expect(c.cli.closed).toBe(true)
    expect(d.cli.closed).toBe(false)
    expect(liveCount()).toBe(LIVE_MAX_PROCESSES)
  })

  it('mọi process đều được bảo vệ ⇒ vượt trần (không giết gì) và ghi warn', async () => {
    await cli.emit(bgChanged(bgShell))
    await first()
    const others = [
      await spawnSession('s-b', { bg: true }),
      await spawnSession('s-c', { finished: false }),
      await spawnSession('s-d', { bg: true }),
    ]
    const warnSpy = vi.spyOn(log, 'warn')
    await spawnSession('s-e', { finished: false })
    expect(cli.closed).toBe(false)
    expect(others.some((x) => x.cli.closed)).toBe(false)
    expect(liveCount()).toBe(LIVE_MAX_PROCESSES + 1)
    expect(warnSpy).toHaveBeenCalledWith(
      'claude-sdk: live process cap exceeded — every process owns work or a turn',
      expect.objectContaining({ sessionId: 's-e', cap: LIVE_MAX_PROCESSES }),
    )
    warnSpy.mockRestore()
  })

  it('đóng một process ở nhánh khác ⇒ còn chỗ, không ai bị evict', async () => {
    await first()
    const b = await spawnSession('s-b')
    closeLive('s-b', 'test')
    await settle()
    const c = await spawnSession('s-c')
    const d = await spawnSession('s-d')
    const e = await spawnSession('s-e')
    expect(liveCount()).toBe(LIVE_MAX_PROCESSES)
    expect(cli.closed).toBe(false)
    expect([c, d, e].some((x) => x.cli.closed)).toBe(false)
    expect(b.cli.closed).toBe(true)
    expect(closeReasons()).toEqual(['test'])
  })
})

// ── TurnState.forwardTo ───────────────────────────────────────────────────────
describe('TurnState.forwardTo — server dựng ở lượt tái dùng đọc state của process sống', () => {
  it('chia sẻ ctx / humanParks / memo với đích, và trả về state riêng khi gỡ', () => {
    const live = new TurnState()
    const discarded = new TurnState()
    discarded.forwardTo(live)
    const ctx = { gate: vi.fn(), cb: { onChunk: vi.fn() } } as never
    live.begin(ctx)
    expect(discarded.ctx).toBe(live.ctx)
    discarded.humanParks += 1
    expect(live.humanParks).toBe(1)
    let made = 0
    expect(discarded.once('k', () => ++made)).toBe(1)
    expect(live.once('k', () => ++made)).toBe(1)
    discarded.forwardTo(undefined)
    expect(discarded.ctx).toBeUndefined()
    expect(discarded.humanParks).toBe(0)
  })
})

// ── Việc nền xong SAU khi lượt đã hết ─────────────────────────────────────────
describe('runStreamClaude — CLI tự đánh thức model sau khi lượt hết (wake)', () => {
  useRunHarness()

  const finishWithBackground = async (): Promise<void> => {
    await cli.emit(bgChanged(bgShell))
    await cli.emit(textDelta('STARTED'))
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    await turn1.run
  }
  // Đúng chuỗi đã đo trên CLI thật khi shell nền xong sau lượt.
  const emitWakeTurn = async (text: string): Promise<void> => {
    await cli.emit(msg({ type: 'system', subtype: 'task_updated', task_id: 't1' }))
    await cli.emit(taskNotification('t1'))
    await cli.emit(bgChanged([]))
    await cli.emit(running)
    await cli.emit(textDelta(text))
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
  }

  it('W1: wake ⇒ phát native wake MỘT lần (đủ thông tin task); lượt attachWake nhận đúng reply, KHÔNG gửi message thứ hai vào CLI', async () => {
    await finishWithBackground()
    await emitWakeTurn('the build finished')

    expect(vi.mocked(bg.notifyExternalWake)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(bg.notifyExternalWake)).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION,
        shellId: 't1',
        command: 'sleep 20',
        status: 'exited',
        exitCode: 0,
      }),
    )
    // Chip của task đã được settle (wake:false) ở edge notification, TRƯỚC khi model chạy.
    expect(vi.mocked(bg.settleExternalBackground)).toHaveBeenCalledWith(
      expect.objectContaining({ shellId: 't1', exitCode: 0 }),
    )

    const wake = startTurn({
      pendingText: '[background task finished]',
      attachWake: true,
      sdkSessionId: 'sdk-1',
    })
    const res = await wake.run
    expect(res.text).toBe('the build finished')
    expect(wake.cb.onChunk).toHaveBeenCalledWith('the build finished')
    // Không lượt thứ hai: chỉ có prompt gốc của lượt 1 trong stdin.
    expect(cli.userMessages).toHaveLength(1)
    expect(harness.spawned).toHaveLength(1)
    wake.abort.abort()
  })

  it('W2: attachWake khi không còn gì để nhận (process đã đóng/thay) ⇒ lùi về gửi prompt như user message thường', async () => {
    await finishWithBackground()
    const cli2 = new FakeCli()
    harness.queue.push(cli2)
    closeLive(SESSION, 'reaped')
    const wake = startTurn({
      pendingText: '[background task finished] fallback',
      attachWake: true,
      sdkSessionId: 'sdk-1',
    })
    await settle()
    expect(harness.spawned).toHaveLength(2)
    expect(cli2.userMessages.join('')).toContain('[background task finished] fallback')
    wake.abort.abort()
    cli2.end()
    await wake.run.catch(() => {})
  })

  it('W3: lượt user đến khi lượt wake CHƯA hết ⇒ interrupt nó, message chỉ vào stdin SAU khi nó hết', async () => {
    await finishWithBackground()
    // Wake đang chạy (chưa result).
    await cli.emit(taskNotification('t1'))
    await cli.emit(bgChanged([]))
    await cli.emit(running)
    await cli.emit(textDelta('working…'))
    expect(vi.mocked(bg.notifyExternalWake)).toHaveBeenCalledTimes(1)

    const user = startTurn({
      pendingText: 'actually, stop',
      sdkSessionId: 'sdk-1',
    })
    await settle()
    expect(cli.interrupt).toHaveBeenCalledTimes(1)
    expect(cli.userMessages).toHaveLength(1)

    await cli.emit(interruptedResult)
    await cli.emit(idle)
    await settle()
    expect(cli.userMessages).toHaveLength(2)
    expect(cli.userMessages[1]).toContain('actually, stop')

    await cli.emit(running)
    await cli.emit(textDelta('ok'))
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    const res = await user.run
    // Chữ của lượt wake bị bỏ không rò vào reply của lượt user.
    expect(res.text).toBe('ok')
    user.abort.abort()
  })

  it('W4: lượt user (không attach) khi có wake đã xong mà không ai nhận ⇒ bỏ wake đó, lượt user chạy bình thường', async () => {
    await finishWithBackground()
    await emitWakeTurn('result nobody adopted')
    const user = startTurn({ pendingText: 'moving on', sdkSessionId: 'sdk-1' })
    await settle()
    expect(cli.userMessages).toHaveLength(2)
    await cli.emit(running)
    await cli.emit(textDelta('fine'))
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    expect((await user.run).text).toBe('fine')
    expect(infoCalls('claude-sdk: dropping unadopted wake turn(s) — the user moved on')).toHaveLength(1)
    user.abort.abort()
  })
})
