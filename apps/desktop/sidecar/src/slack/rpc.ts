// Đăng ký RPC `slack.*` với cách dịch lỗi thống nhất.
//
// Lỗi Slack đi ra renderer thành RpcError mã SLACK_RPC_CODE, `data.slackCode`
// là mã Slack nguyên gốc (`missing_scope`, `not_in_channel`, `not_connected`,
// `thread_not_tracked`…) để UI rẽ nhánh (banner "Kết nối lại", "Bật scope…")
// mà không phải đoán qua câu chữ. Không qua đây thì dispatch gộp mọi lỗi thành
// "Internal error" và UI mất thông tin đó.
import { ZodError } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import { SlackApiError } from './client.js'
import { ThreadNotFoundError } from './store.js'
import { SLACK_CHANGED_EVENT, type SlackChangedEvent } from './types.js'

export const SLACK_RPC_CODE = -32040

export function toSlackRpcError(err: unknown): unknown {
  if (err instanceof RpcError || err instanceof ZodError) return err
  if (err instanceof SlackApiError) {
    return new RpcError(SLACK_RPC_CODE, err.message, {
      slackCode: err.code,
      ...(err.needed ? { needed: err.needed } : {}),
    })
  }
  if (err instanceof ThreadNotFoundError) {
    return new RpcError(SLACK_RPC_CODE, err.message, { slackCode: 'thread_not_tracked' })
  }
  return err
}

export function registerSlack(method: string, handler: (raw: unknown) => Promise<unknown>): void {
  register(method, async (raw) => {
    try {
      return await handler(raw)
    } catch (err) {
      throw toSlackRpcError(err)
    }
  })
}

// Báo mọi cửa sổ (app chính + cửa sổ Slack riêng) rằng các thread này đổi,
// để store bên renderer đọc lại thay vì lệch nhau.
export function emitSlackChanged(threadIds: readonly string[]): void {
  if (threadIds.length === 0) return
  const payload: SlackChangedEvent = { threadIds: [...threadIds] }
  emit(SLACK_CHANGED_EVENT, payload)
}
