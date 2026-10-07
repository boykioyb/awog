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
import type { RunNonStreamArgs, StreamCallbacks } from '../../../sessions/runner.js'
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
  // CLI thật có thể còn xả vài message sau khi stdin đóng (E-5). Bật cờ này thì
  // output KHÔNG tự kết thúc lúc stdin đóng; test tự gọi `end()`.
  holdOutputOnClose = false
  private ended = false
  private readonly startedSignal = deferred<void>()
  readonly started = this.startedSignal.promise
  private parked: ((r: IteratorResult<SDKMessage>) => void) | undefined
  private pullWaiters: (() => void)[] = []
  private hasStarted = false

  start(input: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }): unknown {
    this.options = input.options
    void (async () => {
      for await (const _ of input.prompt) {
        // CLI chỉ cần biết stdin còn mở hay không.
      }
      this.inputClosed = true
      if (!this.holdOutputOnClose) this.end()
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
      stopTask: vi.fn(async () => {}),
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
    if (!deliver) throw new Error('fake CLI: consumer is not waiting for a message')
    this.parked = undefined
    const pulled = new Promise<void>((r) => this.pullWaiters.push(r))
    deliver({ value: msg, done: false })
    await pulled
  }
}

const harness: { cli: FakeCli | undefined } = { cli: undefined }

// Giữ export thật: ~12 builder `build*SdkServer` gọi `createSdkMcpServer`/`tool`
// thật lúc dựng options (in-process, không spawn gì).
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: (input: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => {
    if (!harness.cli) throw new Error('fake CLI not installed')
    return harness.cli.start(input)
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
}))

// HOME tạm đặt TRƯỚC khi nạp run-stream, phòng module nào tính đường dẫn lúc load.
const originalHome = process.env.HOME
const tempHome = await mkdtemp(join(tmpdir(), 'awog-settle-'))
process.env.HOME = tempHome

const { log } = await import('../../../util/logger.js')
const { runStreamClaude, isPassiveAfterResult, IDLE_SETTLE_MS, BACKGROUND_GRACE_MS } =
  await import('../run-stream.js')

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
const suggestion = msg({
  type: 'prompt_suggestion',
  suggestion: 'Run the tests',
  uuid: 's1',
  session_id: 'sdk-1',
})
const idle = msg({ type: 'system', subtype: 'session_state_changed', state: 'idle' })
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
const running = msg({ type: 'system', subtype: 'session_state_changed', state: 'running' })
const assistantToolUse = msg({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] },
  parent_tool_use_id: null,
  session_id: 'sdk-1',
})
const toolResult = msg({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
  parent_tool_use_id: null,
  session_id: 'sdk-1',
})

// ── Per-test state ────────────────────────────────────────────────────────────
let cli: FakeCli
let abortController: AbortController
let answer: Deferred<SessionQuestionReply>
let cb: { onChunk: ReturnType<typeof vi.fn>; onStep: ReturnType<typeof vi.fn> }
let infoSpy: ReturnType<typeof vi.spyOn>
let run: Promise<Awaited<ReturnType<typeof runStreamClaude>>>

const CLOSE_LINE = 'claude-sdk closing input'
const CANCEL_LINE = 'claude-sdk settle cancelled — turn continues'

const infoCalls = (line: string): Record<string, unknown>[] =>
  infoSpy.mock.calls
    .filter((c: unknown[]) => c[0] === line)
    .map((c: unknown[]) => (c[1] ?? {}) as Record<string, unknown>)
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

// Mở một câu hỏi người dùng qua đường thật: elicitation → wrapper askUserQuestion
// (đếm humanParks) → args.askUserQuestion. Không await lúc mở; promise trả về chỉ
// resolve SAU `finally` của wrapper, nơi `armIdleSettle()` chạy.
const openQuestion = (): Promise<unknown> => {
  const onElicitation = cli.options?.onElicitation
  if (!onElicitation) throw new Error('onElicitation not wired')
  return onElicitation(
    { serverName: 'srv', mode: 'url', url: 'https://example.com/auth', message: 'auth' },
    { signal: abortController.signal, requestId: 'elicit-test' },
  )
}

// Chỉ các describe chạy qua vòng lặp thật mới dựng harness — U1 là test thuần.
function useRunHarness(): void {
beforeEach(async () => {
  cli = new FakeCli()
  harness.cli = cli
  abortController = new AbortController()
  answer = deferred<SessionQuestionReply>()
  cb = { onChunk: vi.fn(), onStep: vi.fn() }
  infoSpy = vi.spyOn(log, 'info')
  const args = {
    sessionId: 'settle-test',
    pendingText: 'hi',
    history: [],
    settings: { provider: 'anthropic', modelId: 'claude-sonnet-5', level: 'medium' },
    contextConfig: { wikiEnabled: false, memoryEnabled: false },
    abortController,
    askUserQuestion: vi.fn(() => answer.promise),
  } as unknown as RunNonStreamArgs
  run = runStreamClaude(args, cb as unknown as StreamCallbacks)
  // Lỗi setup phải hiện ra ngay thay vì treo ở `started`.
  await Promise.race([cli.started, run.then(() => undefined)])
  expect(cli.inputClosed).toBe(false)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
  // Abort trước, rồi mới await: trên code cũ lượt treo, và test phải đỏ ở assert
  // chứ không treo tới timeout.
  abortController.abort()
  answer.resolve({ answers: [] })
  // `holdOutputOnClose` (E-5): abort không kết thúc output đang bị giữ — tự kết thúc
  // để assert hỏng giữa chừng không biến thành hook timeout.
  cli.end()
  await run.catch(() => {})
  vi.useRealTimers()
  infoSpy.mockRestore()
  harness.cli = undefined
})
}

// ── Kịch bản ──────────────────────────────────────────────────────────────────
describe('runStreamClaude — settle sau `result`', () => {
  useRunHarness()

  it('S1: result → prompt_suggestion, không idle ⇒ tự đóng đúng IDLE_SETTLE_MS sau result (AC-1/3/4)', async () => {
    await cli.emit(result)
    await advance(1000)
    await cli.emit(suggestion)
    await advance(IDLE_SETTLE_MS - 1000 - 1)
    expect(cli.inputClosed).toBe(false)
    expect(closeReasons()).toEqual([])

    await advance(1)
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()[0]).toBe('result, no idle signal')

    const res = await run
    expect(res.usage.input_tokens).toBe(10)
    expect(res.stopReason).not.toBe('error')
    expect(cb.onStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'suggest-s1' }))
  })

  it('S2: trả lời câu hỏi sau result → prompt_suggestion ⇒ đóng đúng IDLE_SETTLE_MS sau lúc trả lời (AC-10)', async () => {
    const question = openQuestion()
    await settle()
    await cli.emit(result)
    await advance(10_000)
    expect(cli.inputClosed).toBe(false)

    answer.resolve({ answers: [] })
    await question
    await cli.emit(suggestion)
    await advance(IDLE_SETTLE_MS - 1)
    expect(cli.inputClosed).toBe(false)

    await advance(1)
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()[0]).toBe('result, no idle signal')
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
      expect(cli.inputClosed).toBe(false)
      expect(infoCalls(CANCEL_LINE)).toEqual([
        expect.objectContaining({ sessionId: 'settle-test', type, subtype }),
      ])

      await cli.emit(assistantText)
      await cli.emit(result)
      await advance(IDLE_SETTLE_MS - 1)
      expect(cli.inputClosed).toBe(false)
      await advance(1)
      expect(cli.inputClosed).toBe(true)
      expect(closeReasons()[0]).toBe('result, no idle signal')
    },
  )

  it('S4: result → prompt_suggestion → assistant ⇒ huỷ settle, chỉ đóng sau result kế (AC-6)', async () => {
    await cli.emit(result)
    await cli.emit(suggestion)
    await cli.emit(assistantText)
    await advance(10_000)
    expect(cli.inputClosed).toBe(false)

    await cli.emit(result)
    await advance(IDLE_SETTLE_MS - 1)
    expect(cli.inputClosed).toBe(false)
    await advance(1)
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()[0]).toBe('result, no idle signal')
  })

  it.each([
    ['result → idle', [result, idle]],
    ['result → prompt_suggestion → idle', [result, suggestion, idle]],
  ])('S5: %s ⇒ đóng NGAY, không log D-5 (AC-7)', async (_label, seq) => {
    for (const m of seq) await cli.emit(m)
    await settle()
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()[0]).toBe('session idle')
    expect(infoCalls(CANCEL_LINE)).toEqual([])
  })

  it('S6: parked trên background task ⇒ chờ task xong, grace KHÔNG bị prompt_suggestion đếm lại (AC-8, D-4)', async () => {
    await cli.emit(bgChanged([{ task_id: 't1', task_type: 'local_bash', ambient: false }]))
    await cli.emit(result)
    await cli.emit(suggestion)
    await cli.emit(idle)
    await advance(60_000)
    expect(cli.inputClosed).toBe(false)

    await cli.emit(taskNotification('t1'))
    await cli.emit(bgChanged([]))
    await advance(20_000)
    await cli.emit(suggestion)
    await advance(BACKGROUND_GRACE_MS - 20_000 - 1)
    expect(cli.inputClosed).toBe(false)

    await advance(1)
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()[0]).toBe('background settled, no continuation')
  })

  it('S7: câu hỏi còn mở ⇒ không hạn nào đóng input (AC-9)', async () => {
    void openQuestion()
    await settle()
    await cli.emit(result)
    await cli.emit(suggestion)
    await cli.emit(idle)
    await advance(600_000)
    expect(cli.inputClosed).toBe(false)
    expect(closeReasons()).toEqual([])
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
describe('runStreamClaude — settle sau `result`: edge case bổ sung (QA)', () => {
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
    expect(cli.inputClosed).toBe(false)
    await advance(1)
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()).toEqual(['result, no idle signal'])
    expect(infoCalls(CANCEL_LINE)).toEqual([])
  })

  it('rate_limit_event trước result (giữa lượt) rồi result → không idle ⇒ đóng đúng IDLE_SETTLE_MS sau result', async () => {
    await cli.emit(rateLimit)
    await cli.emit(assistantText)
    await advance(10_000)
    await cli.emit(rateLimit)
    expect(cli.inputClosed).toBe(false)
    await cli.emit(result)
    await cli.emit(rateLimit)
    await advance(IDLE_SETTLE_MS - 1)
    expect(cli.inputClosed).toBe(false)
    await advance(1)
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()).toEqual(['result, no idle signal'])
  })

  it('result → suggestion → session_state_changed: running ⇒ huỷ settle (đánh thức thật), log D-5; đóng sau result kế', async () => {
    await cli.emit(result)
    await cli.emit(suggestion)
    await cli.emit(running)
    await advance(10_000)
    expect(cli.inputClosed).toBe(false)
    expect(infoCalls(CANCEL_LINE)).toEqual([
      expect.objectContaining({ type: 'system', subtype: 'session_state_changed' }),
    ])

    await cli.emit(assistantText)
    await cli.emit(result)
    await cli.emit(suggestion)
    await advance(IDLE_SETTLE_MS - 1)
    expect(cli.inputClosed).toBe(false)
    await advance(1)
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()).toEqual(['result, no idle signal'])
  })

  it.each([
    ['suggestion rỗng', msg({ type: 'prompt_suggestion', suggestion: '   ', uuid: 'se' })],
    ['suggestion không phải string', msg({ type: 'prompt_suggestion', suggestion: 42, uuid: 'sn' })],
  ])('E-8: %s ⇒ không chip, hạn đóng vẫn giữ', async (_label, bad) => {
    await cli.emit(result)
    await cli.emit(bad)
    await advance(IDLE_SETTLE_MS - 1)
    expect(cli.inputClosed).toBe(false)
    await advance(1)
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()).toEqual(['result, no idle signal'])
    const stepIds = cb.onStep.mock.calls.map((c: unknown[]) => (c[0] as { id?: string }).id)
    expect(stepIds.filter((id) => String(id).startsWith('suggest-'))).toEqual([])
  })

  it('E-5: idle đóng input, CLI còn xả prompt_suggestion SAU khi đóng ⇒ không đóng lần hai, không timer mới, lượt resolve', async () => {
    cli.holdOutputOnClose = true
    await cli.emit(result)
    await cli.emit(idle)
    await settle()
    expect(cli.inputClosed).toBe(true)

    await cli.emit(suggestion)
    await cli.emit(rateLimit)
    await advance(60_000)
    expect(closeReasons()).toEqual(['session idle'])
    expect(infoCalls(CANCEL_LINE)).toEqual([])
    expect(vi.getTimerCount()).toBe(0)

    cli.end()
    const res = await run
    expect(res.usage.input_tokens).toBe(10)
    // Chip vẫn được render nếu message kịp tới adapter (spec: không bắt buộc, nhưng không được ném).
    expect(cb.onStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'suggest-s1' }))
  })

  it('E-10: settle bắn khi còn tool in-flight ⇒ defer; suggestion không phá defer; đóng khi tool trả lời', async () => {
    await cli.emit(assistantToolUse)
    await cli.emit(result)
    await cli.emit(suggestion)
    await advance(IDLE_SETTLE_MS)
    expect(cli.inputClosed).toBe(false)
    expect(infoCalls('claude-sdk deferring close until tool calls answer')).toEqual([
      expect.objectContaining({ reason: 'result, no idle signal', inFlight: 1 }),
    ])

    await cli.emit(msg({ type: 'prompt_suggestion', suggestion: 'Again', uuid: 's2' }))
    await advance(10_000)
    expect(cli.inputClosed).toBe(false)

    await cli.emit(toolResult)
    await settle()
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()).toEqual(['result, no idle signal (tools settled)'])
    // Settle đã bắn (close chỉ bị defer) ⇒ tool_result không phải "lượt chạy tiếp".
    expect(infoCalls('claude-sdk settle cancelled — turn continues')).toEqual([])
  })

  it('E-13: Stop trong cửa sổ settle (sau suggestion) ⇒ đóng "aborted", lượt ném CANCELED', async () => {
    await cli.emit(result)
    await cli.emit(suggestion)
    await advance(2000)
    abortController.abort()
    await settle()
    expect(cli.inputClosed).toBe(true)
    expect(closeReasons()).toEqual(['aborted'])
    await expect(run).rejects.toThrow('CANCELED')
  })
})
