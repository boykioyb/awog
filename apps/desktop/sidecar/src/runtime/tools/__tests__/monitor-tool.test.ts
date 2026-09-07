// Tests cho tool `monitor` (gói #6). Registry background shell bị mock: ở đây chỉ
// quan tâm ĐIỀU KIỆN DỪNG và cái tool nói lại với model, không quan tâm việc đọc
// file log thật (đã có bg-registry lo).
//
// Run với vitest: `npx vitest run src/runtime/tools/__tests__/monitor-tool.test.ts`
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundReadResult } from '../../../sessions/bg-registry.js'

const readBackground = vi.fn<(sessionId: string, shellId: string) => BackgroundReadResult | null>()

vi.mock('../../../sessions/bg-registry.js', () => ({
  readBackground: (sessionId: string, shellId: string) => readBackground(sessionId, shellId),
}))

const { createMonitorTool } = await import('../monitor-tool.js')

function snapshot(over: Partial<BackgroundReadResult> = {}): BackgroundReadResult {
  return {
    shellId: 'bg-1',
    status: 'running',
    exitCode: null,
    output: '',
    truncated: false,
    droppedBytes: 0,
    external: false,
    ...over,
  }
}

// Gọi tool + trả về `details` đã ép kiểu (AgentToolResult<T> giữ generic ở
// details, nên không cần narrow thủ công).
async function run(params: Record<string, unknown>, signal?: AbortSignal) {
  const tool = createMonitorTool('ses-test')
  // Pi validate params theo schema trước khi execute; ở test ta gọi thẳng.
  return tool.execute('call-1', params as never, signal)
}

describe('monitor', () => {
  beforeEach(() => {
    readBackground.mockReset()
  })

  it('dừng ngay khi output chứa chuỗi cần chờ', async () => {
    readBackground.mockReturnValue(snapshot({ output: 'vite v7\nListening on http://localhost:3000' }))
    const res = await run({ shell_id: 'bg-1', until_output_contains: 'listening on' })
    expect(res.details.outcome).toBe('matched')
    expect(res.details.attempts).toBe(1)
    expect(res.details.isError).toBe(false)
    // Model phải nhận luôn phần đuôi output, khỏi gọi thêm BashOutput.
    expect(res.content[0]).toMatchObject({ type: 'text' })
    expect(String((res.content[0] as { text: string }).text)).toContain('Listening on')
  })

  it('so khớp không phân biệt hoa thường và KHÔNG coi chuỗi là regex', async () => {
    readBackground.mockReturnValue(snapshot({ output: 'build failed: a.b.c' }))
    // `a.b.c` dạng regex sẽ khớp cả "axbxc"; dạng chuỗi con thì không.
    expect((await run({ shell_id: 'bg-1', until_output_contains: 'A.B.C' })).details.outcome).toBe(
      'matched',
    )
    readBackground.mockReturnValue(snapshot({ output: 'build failed: axbxc' }))
    const res = await run({ shell_id: 'bg-1', until_output_contains: 'a.b.c', timeout_ms: 1_000 })
    expect(res.details.outcome).toBe('timeout')
  })

  it('trả về sớm khi lệnh tự kết thúc, kèm exit code', async () => {
    readBackground.mockReturnValue(snapshot({ status: 'exited', exitCode: 1, output: 'boom' }))
    const res = await run({ shell_id: 'bg-1', until_output_contains: 'never' })
    expect(res.details.outcome).toBe('exited')
    expect(res.details.exitCode).toBe(1)
    // Lệnh thoát (kể cả khác 0) là THÔNG TIN, không phải lỗi của lần chờ.
    expect(res.details.isError).toBe(false)
  })

  it('hết giờ thì báo rõ là hết giờ và đánh dấu lỗi', async () => {
    readBackground.mockReturnValue(snapshot({ output: 'still building…' }))
    const res = await run({ shell_id: 'bg-1', until_output_contains: 'done', timeout_ms: 1_000 })
    expect(res.details.outcome).toBe('timeout')
    expect(res.details.isError).toBe(true)
    expect(res.details.waitedMs).toBeGreaterThanOrEqual(900)
    // Trần khoảng nghỉ tối thiểu 1s ⇒ 1s chờ không thể quét quá vài lần.
    expect(res.details.attempts).toBeLessThanOrEqual(2)
    expect(String((res.content[0] as { text: string }).text)).toContain('Timed out')
  })

  it('shellId lạ ⇒ lỗi tường minh, không chờ vòng nào', async () => {
    readBackground.mockReturnValue(null)
    const res = await run({ shell_id: 'nope', timeout_ms: 600_000 })
    expect(res.details.outcome).toBe('unknown_shell')
    expect(res.details.isError).toBe(true)
    expect(res.details.attempts).toBe(1)
  })

  it('huỷ lượt ⇒ ném ngay, không giữ lượt lại', async () => {
    readBackground.mockReturnValue(snapshot())
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(run({ shell_id: 'bg-1', timeout_ms: 600_000 }, ctrl.signal)).rejects.toThrow(
      /aborted/i,
    )
  })

  it('không nhận tham số `command` — monitor không phải cửa chạy lệnh', async () => {
    // Khẳng định trên SCHEMA: nếu ai đó thêm `command` vào đây thì tool trở thành
    // đường chạy lệnh không qua gate của Bash (monitor không nằm trong EXEC_TOOLS).
    const tool = createMonitorTool('ses-test')
    const keys = Object.keys(tool.parameters.properties as Record<string, unknown>)
    expect(keys).not.toContain('command')
    expect(keys).toContain('shell_id')
  })
})
