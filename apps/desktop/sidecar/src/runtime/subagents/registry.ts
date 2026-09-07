// Sổ đăng ký subagent của MỘT lượt cha (ADR 0083 §b + §e).
//
// Vì sao có: nhánh Claude SDK cho subagent chạy NỀN — model spawn xong đi làm
// việc khác, rồi thu kết quả bằng `TaskOutput` ngay trong cùng lượt. Nhánh Pi
// trước đây `await` thẳng trong `execute()` nên mọi lời gọi `Task` đều chặn.
//
// Vòng đời = ĐÚNG BẰNG lượt cha, không dài hơn một mili-giây:
//   • Một session chỉ có 1 lượt tại một thời điểm (invariant sẵn có). Nếu
//     subagent sống qua lượt, nó vẫn gọi tool trong khi không còn lượt nào để
//     hỏi quyền, không còn transcript để ghi step, và lượt sau sẽ đụng nó.
//   • Nên registry là đối tượng THEO LƯỢT: run-stream tạo nó lúc dựng toolset và
//     gọi `abortAll()` ở `finally` của vòng lặp. Hết lượt là hết subagent.
//   • Đây cũng đúng bằng ngữ nghĩa CLI ở nhánh Claude SDK ("what does NOT survive
//     is the END of the turn" — runtime/claude-sdk/shared.ts), nên hai runtime
//     hứa với model cùng một điều.
//
// Trần an toàn (subagent nền chạy không người trực):
//   • `maxBackground` — số subagent nền chạy song song.
//   • `backgroundTimeoutMs` — trần đồng hồ treo cho MỘT subagent nền; hết giờ thì
//     abort, không để một vòng lặp bỏ quên đốt token tới hết lượt.
//   • Trần số tool call / thời gian của cả lượt vẫn do `withTurnBudget` giữ: tool
//     call của subagent đi qua đúng `beforeToolCall` của cha.

import { randomBytes } from 'node:crypto'
import { log } from '../../util/logger.js'

export type SubagentRunStatus = 'running' | 'done' | 'error' | 'stopped'

export interface SubagentSnapshot {
  // Địa chỉ ổn định của subagent trong lượt này (`task_id` với model).
  id: string
  // Tên do model đặt (tuỳ chọn) — địa chỉ dễ nhớ cho `SendMessage`.
  name?: string
  // Agent đứng sau (tên AGENT.md, `general-purpose`, hoặc `fork`).
  label: string
  description: string
  status: SubagentRunStatus
  // Chạy nền hay chạy đồng bộ trong lời gọi tool. Lớp trên lọc theo cờ này để
  // chỉ soi chip cho bản nền — bản đồng bộ sinh/tắt trong cùng một tool call,
  // chip của nó chỉ là nhiễu.
  background: boolean
  // Text cuối của lượt gần nhất; rỗng khi chưa xong.
  text: string
  error?: string
  startedAt: number
}

// Một lượt chạy của subagent. Trả text cuối; ném khi lỗi.
export type SubagentRun = (prompt: string, signal?: AbortSignal) => Promise<string>

export interface StartInput {
  label: string
  description: string
  name?: string
  prompt: string
  run: SubagentRun
  // Chạy nền (không chặn `execute`) hay chạy đồng bộ. Chỉ bản nền mới tính vào
  // `maxBackground` và mới có trần đồng hồ treo.
  background: boolean
  // Signal của lượt cha (pi truyền vào `execute` của tool). Cha bị huỷ ⇒ subagent
  // chết theo ngay, không chờ `abortAll()` — người dùng bấm Stop là phải dừng
  // thật, kể cả subagent đang chạy nền.
  parentSignal?: AbortSignal
}

interface Entry {
  snap: SubagentSnapshot
  background: boolean
  controller: AbortController
  settled: Promise<void>
  timer: ReturnType<typeof setTimeout> | undefined
  run: SubagentRun
  // Đang chạy một lượt (spawn đầu hoặc follow-up) — chặn hai lượt chồng nhau
  // trên cùng một subagent.
  busy: boolean
  // Gỡ listener 'abort' đã gắn lên signal của cha (một lượt spawn tới 25 subagent,
  // để listener tồn đọng là rò rỉ).
  unlinkParent: () => void
}

export interface RegistryOptions {
  maxBackground: number
  backgroundTimeoutMs: number
  // Báo cho lớp trên (chip nền trên UI). Không được ném.
  onStarted?: (snap: SubagentSnapshot) => void
  onSettled?: (snap: SubagentSnapshot) => void
}

export class SubagentRegistry {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly opts: RegistryOptions) {}

  get maxBackground(): number {
    return this.opts.maxBackground
  }

  get backgroundTimeoutMs(): number {
    return this.opts.backgroundTimeoutMs
  }

  countRunningBackground(): number {
    let n = 0
    for (const e of this.entries.values()) {
      if (e.background && e.snap.status === 'running') n += 1
    }
    return n
  }

  // Tra theo id, rồi theo tên (case-insensitive) — model nhớ tên nó tự đặt dễ
  // hơn nhớ id sinh ngẫu nhiên.
  private lookup(ref: string): Entry | undefined {
    const needle = ref.trim()
    const byId = this.entries.get(needle)
    if (byId) return byId
    const lower = needle.toLowerCase()
    for (const e of this.entries.values()) {
      if (e.snap.name && e.snap.name.toLowerCase() === lower) return e
    }
    return undefined
  }

  has(ref: string): boolean {
    return this.lookup(ref) !== undefined
  }

  get(ref: string): SubagentSnapshot | undefined {
    const e = this.lookup(ref)
    return e ? { ...e.snap } : undefined
  }

  list(): SubagentSnapshot[] {
    return [...this.entries.values()].map((e) => ({ ...e.snap }))
  }

  // Khởi động một subagent. Trả về ngay lập tức: bản nền chạy tiếp ở background,
  // bản đồng bộ thì caller `await settle(id)`.
  start(input: StartInput): SubagentSnapshot {
    const id = `sub_${randomBytes(4).toString('hex')}`
    const controller = new AbortController()
    const entry: Entry = {
      snap: {
        id,
        ...(input.name ? { name: input.name } : {}),
        label: input.label,
        description: input.description,
        status: 'running',
        background: input.background,
        text: '',
        startedAt: Date.now(),
      },
      background: input.background,
      controller,
      settled: Promise.resolve(),
      timer: undefined,
      run: input.run,
      busy: true,
      unlinkParent: () => undefined,
    }
    this.entries.set(id, entry)

    const parent = input.parentSignal
    if (parent) {
      if (parent.aborted) {
        entry.snap.error = 'The parent turn was cancelled.'
        controller.abort()
      } else {
        const onParentAbort = (): void => {
          entry.snap.error = entry.snap.error ?? 'The parent turn was cancelled.'
          controller.abort()
        }
        parent.addEventListener('abort', onParentAbort, { once: true })
        entry.unlinkParent = () => parent.removeEventListener('abort', onParentAbort)
      }
    }

    if (input.background && this.opts.backgroundTimeoutMs > 0) {
      entry.timer = setTimeout(() => {
        if (entry.snap.status !== 'running') return
        entry.snap.error = `Background subagent exceeded the ${Math.round(
          this.opts.backgroundTimeoutMs / 60_000,
        )}-minute cap and was stopped.`
        controller.abort()
      }, this.opts.backgroundTimeoutMs)
      // Trần này không được giữ event loop sống thêm nếu tiến trình muốn thoát.
      entry.timer.unref?.()
    }

    entry.settled = this.execute(entry, input.prompt, controller.signal)
    this.opts.onStarted?.({ ...entry.snap })
    return { ...entry.snap }
  }

  // Chạy một lượt và ghi kết quả vào snapshot. Không bao giờ ném — trạng thái
  // lỗi nằm trong snapshot để caller đọc.
  private async execute(entry: Entry, prompt: string, signal?: AbortSignal): Promise<void> {
    try {
      const text = await entry.run(prompt, signal)
      entry.snap.text = text
      entry.snap.status = 'done'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Abort chủ động (stop / hết trần / huỷ lượt) không phải lỗi của subagent.
      if (entry.controller.signal.aborted) {
        entry.snap.status = 'stopped'
        entry.snap.error = entry.snap.error ?? 'Stopped before it finished.'
      } else {
        entry.snap.status = 'error'
        entry.snap.error = message
      }
      log.warn('subagent run failed (pi)', {
        subagent: entry.snap.label,
        id: entry.snap.id,
        status: entry.snap.status,
        err: message,
      })
    } finally {
      entry.busy = false
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = undefined
      entry.unlinkParent()
      entry.unlinkParent = () => undefined
      this.opts.onSettled?.({ ...entry.snap })
    }
  }

  // Chờ subagent xong hẳn (dùng cho lời gọi Task đồng bộ).
  async settle(ref: string): Promise<SubagentSnapshot | undefined> {
    const e = this.lookup(ref)
    if (!e) return undefined
    await e.settled
    return { ...e.snap }
  }

  // Chờ có giới hạn (dùng cho `TaskOutput({ block: true, timeout })`). Hết giờ mà
  // subagent còn chạy ⇒ trả snapshot 'running', không huỷ gì cả.
  async waitFor(ref: string, timeoutMs: number): Promise<SubagentSnapshot | undefined> {
    const e = this.lookup(ref)
    if (!e) return undefined
    if (e.snap.status !== 'running') return { ...e.snap }
    if (timeoutMs <= 0) return { ...e.snap }
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
      timer.unref?.()
    })
    try {
      await Promise.race([e.settled, expired])
    } finally {
      if (timer) clearTimeout(timer)
    }
    return { ...e.snap }
  }

  // Nhắn tiếp cho một subagent (ADR 0083 §e). Chỉ chấp nhận khi nó đã xong sạch:
  // context của nó còn nguyên trong bộ nhớ nên lượt mới nối đúng vào hội thoại cũ.
  // Trả snapshot sau lượt mới, hoặc lý do từ chối.
  async sendMessage(
    ref: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<{ ok: true; snap: SubagentSnapshot } | { ok: false; reason: string }> {
    const e = this.lookup(ref)
    if (!e) return { ok: false, reason: 'unknown' }
    if (e.busy || e.snap.status === 'running') return { ok: false, reason: 'running' }
    if (e.snap.status !== 'done') return { ok: false, reason: e.snap.status }
    e.busy = true
    e.snap.status = 'running'
    e.snap.text = ''
    e.settled = this.execute(e, prompt, signal)
    await e.settled
    return { ok: true, snap: { ...e.snap } }
  }

  // Dừng một subagent (`TaskStop`, hoặc nút chip trên UI).
  stop(ref: string): boolean {
    const e = this.lookup(ref)
    if (!e) return false
    if (e.snap.status !== 'running') return true
    e.snap.error = e.snap.error ?? 'Stopped on request.'
    e.controller.abort()
    return true
  }

  // Hết lượt cha ⇒ không còn gì của lượt này được phép sống.
  abortAll(): void {
    for (const e of this.entries.values()) {
      if (e.snap.status !== 'running') continue
      e.snap.error = e.snap.error ?? 'The parent turn ended before this subagent finished.'
      e.controller.abort()
      if (e.timer) clearTimeout(e.timer)
      e.timer = undefined
    }
  }
}
