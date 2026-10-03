// `sessions.openCli` — mở một CLI agent THẬT trong PTY gắn với phiên ("Open in
// CLI"). Terminal thực ra là một PTY của terminalManager gom dưới khoá
// `cli:<sessionId>`; registry ở sessions/cli-registry.ts giữ link để
// sessions.sendMessage từ chối một lượt chat trong khi CLI còn gắn.
//
// CLI nào được phép mở do RUNTIME của phiên quyết (cùng định tuyến provider→
// runtime với runStream trong sessions/runner.ts): anthropic → `claude`,
// openai không custom endpoint → `codex`. `devin` được phép NHƯ MỘT LỰA CHỌN
// UNLINKED thứ hai — nhưng CHỈ trên các phiên có CLI native (anthropic/openai):
// AWOG không có devin runtime, nên nó mở một session độc lập trong cùng
// workspace và transcript chỉ được kéo về để XEM. Phiên chạy Pi runtime
// (google, openai qua custom endpoint, …) không có handle CLI nào → lỗi trước
// khi nhánh kind tới được devin.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import { activeSessionIds, hasCustomEndpoint } from '../sessions/runner.js'
import { openCliLink } from '../sessions/cli-registry.js'
import type { SessionCliKind } from '../types/shared.js'

const Params = z.object({
  sessionId: z.string().min(1),
  // Vắng mặt → CLI native của phiên. 'devin' là lựa chọn ngoài-native duy nhất.
  cli: z.enum(['claude', 'codex', 'devin']).optional(),
  cols: z.number().int().positive().max(1000),
  rows: z.number().int().positive().max(1000),
})

register('sessions.openCli', async (raw) => {
  const params = Params.parse(raw)
  const session = await loadSession(params.sessionId)
  if (!session) throw new RpcError(-32004, 'Session not found')

  // Cổng BẬN: một lượt đang chạy + một CLI tương tác resume cùng một transcript
  // sẽ fork/lệch nó (claude lặng lẽ tạo một bản sao khi session id đã được gắn
  // ở nơi khác). Từ chối thay vì để hỏng transcript.
  if (activeSessionIds().includes(params.sessionId)) {
    throw new RpcError(
      -32021,
      'This session has a turn in flight — wait for it or stop it before opening a CLI',
    )
  }

  const settings = session.settings
  let native: SessionCliKind | undefined
  if (settings.provider === 'anthropic') {
    native = 'claude'
  } else if (settings.provider === 'openai' && !(await hasCustomEndpoint(settings))) {
    // openai qua custom endpoint (Ollama/LM Studio/router) chạy Pi — codex CLI
    // không nói được với endpoint đó, nên native là undefined → lỗi dưới.
    native = 'codex'
  }
  if (!native) {
    throw new RpcError(-32021, 'CLI mode is not available for this session runtime')
  }

  const kind: SessionCliKind = params.cli ?? native
  if (kind !== native && kind !== 'devin') {
    throw new RpcError(-32021, `That CLI is not this session's runtime`)
  }

  const link = await openCliLink({
    sessionId: params.sessionId,
    kind,
    cols: params.cols,
    rows: params.rows,
  })
  return {
    terminalId: link.terminalId,
    cli: kind,
    linked: link.linked,
    ...(link.alreadyOpen ? { alreadyOpen: true } : {}),
  }
})
