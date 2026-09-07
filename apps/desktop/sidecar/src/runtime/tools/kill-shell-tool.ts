// `KillShell` AgentTool (ADR 0066) — dừng một background shell đã khởi động bằng
// `Bash({ run_in_background: true })`.
//
// Vì sao có: model được huấn luyện trên Claude Code luôn coi bộ ba
// Bash(run_in_background) → BashOutput → KillShell là có sẵn, và UI của AWOG cũng
// đã liệt kê `KillShell` trong danh sách tool bật/tắt của session
// (SessionConfigPopover.vue). Nhưng runtime Pi mới chỉ có RPC
// `sessions.background-kill` cho NGƯỜI DÙNG bấm nút — model không có cách nào tự
// dừng một dev-server nó lỡ bật. Tool này lấp đúng khoảng trống đó bằng cách gọi
// vào chính hàm kill mà nút UI dùng (sessions/bg-registry.ts).
//
// Tên tham số là `shell_id` — khớp tool thật của Claude Code và khớp `BashOutput`
// bên cạnh, nên model không phải học một quy ước riêng của AWOG.
//
// Bảo mật: chỉ giết tiến trình do CHÍNH session này khởi động (registry khoá theo
// sessionId), không nhận pid từ model. Vòng đời tương đương lệnh đã được duyệt ở
// beforeToolCall lúc chạy, nên dừng nó lại không cần một cửa quyền mới.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { killBackground } from '../../sessions/bg-registry.js'

const Params = Type.Object({
  shell_id: Type.String({
    description: 'The shellId returned by a prior Bash({ run_in_background: true }) call.',
  }),
})

interface KillShellDetails {
  shellId: string
  killed: boolean
  // tool-error.ts: shellId không tồn tại ⇒ không có gì bị dừng, đừng render như
  // một bước thành công.
  isError?: true
}

export function createKillShellTool(sessionId: string): AgentTool<typeof Params, KillShellDetails> {
  return {
    name: 'KillShell',
    label: 'Kill shell',
    description:
      'Stop a background shell started with Bash(run_in_background:true), given its shell_id. ' +
      'Use it when a long-running command is no longer needed — a dev server you started to check something, a watch process, a run that is clearly stuck. ' +
      'Killing an already-finished shell is harmless. This does not affect the terminals the user opened themselves.',
    parameters: Params,
    async execute(_id, params): Promise<AgentToolResult<KillShellDetails>> {
      const killed = killBackground(sessionId, params.shell_id)
      if (!killed) {
        return {
          content: [
            {
              type: 'text',
              text: `No background shell with id "${params.shell_id}" in this session — nothing was killed.`,
            },
          ],
          details: { shellId: params.shell_id, killed: false, isError: true },
        }
      }
      return {
        content: [{ type: 'text', text: `Killed background shell ${params.shell_id}.` }],
        details: { shellId: params.shell_id, killed: true },
      }
    },
  }
}
