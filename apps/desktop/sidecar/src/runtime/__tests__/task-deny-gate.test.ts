// Cổng CHỈ-DENY của nhánh task phải đối xứng giữa HAI runtime.
//
// Vì sao có file này: runtime được chọn THEO PROVIDER (ADR 0058). Nhánh Pi có
// `makeTaskToolGate` từ ADR 0080 F5, nhánh Claude SDK thì không — nên đổi provider
// của một agent sang `anthropic` làm luật `deny` của người dùng lặng lẽ hết hiệu
// lực, cùng một task, cùng một file luật. Test này khoá phần bắc cầu: hook của
// nhánh SDK phải TIÊU THỤ kết quả của cổng, và phải tiêu thụ trên args ĐÃ ghi đè.
//
// Bản thân luật đã có 129 test ở permission-rules.test.ts; ở đây chỉ kiểm đường dây.
import { describe, expect, it } from 'vitest'
import { makeForegroundOnlyHook } from '../claude-sdk/shared.js'
import type { BeforeToolCall } from '../permission.js'

type HookOut = Awaited<ReturnType<ReturnType<typeof makeForegroundOnlyHook>>>

function preToolUse(name: string, input: Record<string, unknown>) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: name,
    tool_use_id: 'tu-1',
    tool_input: input,
  } as unknown as Parameters<ReturnType<typeof makeForegroundOnlyHook>>[0]
}

function run(hook: ReturnType<typeof makeForegroundOnlyHook>, name: string, input = {}) {
  return hook(preToolUse(name, input), undefined, {
    signal: new AbortController().signal,
  }) as Promise<HookOut>
}

function specific(out: HookOut): Record<string, unknown> {
  return (out as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {}
}

describe('nhánh task Claude SDK — cổng chỉ-DENY', () => {
  it('cổng chặn ⇒ hook trả deny kèm lý do', async () => {
    const gate: BeforeToolCall = async () => ({ block: true, reason: 'Bị chặn bởi luật.' })
    const out = await run(makeForegroundOnlyHook(gate), 'Bash', { command: 'rm -rf /data' })
    expect(specific(out).permissionDecision).toBe('deny')
    expect(specific(out).permissionDecisionReason).toBe('Bị chặn bởi luật.')
  })

  it('cổng không chặn ⇒ allow, và input ghi đè vẫn được chuyển tiếp', async () => {
    const gate: BeforeToolCall = async () => undefined
    const out = await run(makeForegroundOnlyHook(gate), 'Task', { subagent_type: 'developer' })
    expect(specific(out).permissionDecision).toBe('allow')
    // forceForegroundSubagent vẫn phải chạy: đó là lý do hook này tồn tại ban đầu.
    expect(specific(out).updatedInput).toBeDefined()
  })

  it('cổng đọc args ĐÃ ghi đè, không phải args gốc', async () => {
    // Luật phải xét đúng thứ SẼ chạy. Nếu cổng đọc bản gốc, một tool bị hook viết
    // lại sẽ được duyệt theo hình dạng không bao giờ thực thi.
    let seen: Record<string, unknown> | null = null
    const gate: BeforeToolCall = async (ctx) => {
      seen = ctx.args as Record<string, unknown>
      return undefined
    }
    await run(makeForegroundOnlyHook(gate), 'Task', {
      subagent_type: 'developer',
      run_in_background: true,
    })
    expect(seen).not.toBeNull()
    // Hook ép subagent về đồng bộ trên đường task (one-shot không sống sót được).
    expect((seen as unknown as Record<string, unknown>).run_in_background).toBe(false)
  })

  it('không cấp cổng ⇒ giữ nguyên hành vi cũ (chỉ ghi đè input, luôn allow)', async () => {
    const out = await run(makeForegroundOnlyHook(), 'Bash', { command: 'rm -rf /data' })
    expect(specific(out).permissionDecision).toBe('allow')
  })

  it('sự kiện khác PreToolUse thì không đụng tới', async () => {
    const gate: BeforeToolCall = async () => ({ block: true, reason: 'x' })
    const hook = makeForegroundOnlyHook(gate)
    const out = (await hook(
      { hook_event_name: 'PostToolUse' } as unknown as Parameters<typeof hook>[0],
      undefined,
      { signal: new AbortController().signal },
    )) as HookOut
    expect((out as { continue?: boolean }).continue).toBe(true)
  })
})
