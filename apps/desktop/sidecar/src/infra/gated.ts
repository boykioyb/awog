// Cổng duyệt dùng CHUNG cho mọi bề mặt người dùng bấm nút (Explorer, Logs, tab
// Kubernetes, Settings).
//
// Vì sao phải là một hàm chứ không phải logic nằm trong từng RPC: cổng này là chỗ
// quyết định một lệnh hạ tầng có được chạy hay không, và nó gồm bốn bước KHÔNG
// được phép lệch nhau giữa các bề mặt —
//   1. `classify()` lấy lớp lệnh,
//   2. `decide()` hỏi ma trận quyền (kèm `accountId` + mức siết của phiên),
//   3. `block` ⇒ không spawn, `ask` ⇒ đòi VÉ do chính sidecar phát,
//   4. `runInfra()` (cổng CLI duy nhất) mới thật sự spawn và ghi nhật ký.
// Hai bản sao của chuỗi này là hai chỗ để một bản quên bước 2 — tức một đường
// chạy lệnh không ai duyệt. Vì thế `methods/infra.run.ts` và `methods/infra.kube.ts`
// cùng gọi hàm này thay vì tự viết lại.
//
// VÉ DUYỆT: `approvalTicket` do CHÍNH sidecar phát ở lượt gọi trước và gắn vân tay
// của đúng lời gọi đó; nó thay cho cờ `approved: boolean` do renderer tự khai
// (infosec audit #1 — payload IPC là L1, lời khai "người dùng đã duyệt" từ bên gọi
// không chứng minh được gì).
//
// `actor: 'human'` là hằng số ở đây, có chủ đích: hàm này phục vụ ĐƯỜNG NGƯỜI
// DÙNG BẤM. Agent đi đường khác (`runtime/tools/infra-tools.ts`) và tự chịu cổng
// quyền của nó; trộn hai đường vào nhau là cách để nhật ký mất khả năng phân biệt
// "agent tự chạy" với "người dùng bấm".
import { classify } from './classify.js'
import { decide } from './policy.js'
import { loadInfraPolicy } from './policy-store.js'
import { runInfra } from './run.js'
import { callFingerprint, consumeApproval, issueApproval } from './approvals.js'
import { recordInfraAction } from './audit/store.js'
import { describeInfraCommand } from '../runtime/permission.js'
import type { InfraDecision, InfraSurface } from './audit/store.js'
import type { InfraAccountKind, InfraMode } from './policy.js'
import type { InfraContext, InfraRunResult } from './run.js'
import type { InfraCommandClass, InfraTool } from './types.js'

export type InfraGateInput = {
  tool: InfraTool
  args: readonly string[]
  context: InfraContext
  surface: InfraSurface
  /** Tên tool AWOG cho nhật ký (`infra_view`, `kube_pods`…), KHÔNG phải tên binary. */
  toolName: string
  approvalTicket?: string | undefined
  sessionFloor?: 'auto' | 'ask' | 'block' | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
  timeoutMs?: number | undefined
}

export type InfraGatedBlocked = {
  blocked: true
  /** UI mở hộp duyệt rồi gọi lại kèm `approvalTicket`; `false` = ma trận chặn hẳn. */
  requiresApproval: boolean
  /** Chỉ có mặt khi `requiresApproval` — vé để gọi lại sau khi người dùng bấm. */
  approvalTicket?: string
  command: string
  class: InfraCommandClass
  accountKind: InfraAccountKind
  mode: InfraMode
  reason: string
}

export type InfraGatedRan = {
  blocked: false
  command: string
  class: InfraCommandClass
  accountKind: InfraAccountKind
  decision: InfraDecision
  result: InfraRunResult
}

export type InfraGatedResult = InfraGatedBlocked | InfraGatedRan

export async function runGated(p: InfraGateInput): Promise<InfraGatedResult> {
  const cls = classify(p.tool, p.args)
  const policy = await loadInfraPolicy()
  const verdict = decide({
    policy,
    class: cls,
    ...(p.context.accountId !== undefined ? { accountId: p.context.accountId } : {}),
    ...(p.sessionFloor !== undefined ? { sessionFloor: p.sessionFloor } : {}),
  })
  const command = describeInfraCommand(p.tool, p.args, p.context)
  const fingerprint = callFingerprint(p.tool, p.args, p.context)

  // Nhật ký cho hai nhánh KHÔNG chạy. Nhánh chạy để `runInfra` tự ghi — task 0.6
  // đòi đúng một dòng, ghi tại chỗ chạy chứ không phải tại call site.
  const refuse = async (requiresApproval: boolean, reason: string): Promise<InfraGatedBlocked> => {
    await recordInfraAction({
      actor: 'human',
      ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
      ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
      surface: p.surface,
      tool: p.toolName,
      argv: [...p.args],
      context: p.context,
      class: cls,
      decision: requiresApproval ? 'denied' : 'blocked',
      result: { summary: reason },
    })
    return {
      blocked: true,
      requiresApproval,
      ...(requiresApproval ? { approvalTicket: issueApproval(fingerprint) } : {}),
      command,
      class: cls,
      accountKind: verdict.accountKind,
      mode: verdict.mode,
      reason,
    }
  }

  if (verdict.mode === 'block') {
    const where = verdict.accountKind === 'production' ? 'a PRODUCTION account' : 'this account'
    return refuse(
      false,
      `AWOG không chạy lệnh này — the infrastructure policy blocks ${cls} commands on ${where}. Run it yourself if you mean to: ${command}. Change this in Settings → Infrastructure.`,
    )
  }
  if (verdict.mode === 'ask' && !consumeApproval(p.approvalTicket, fingerprint)) {
    return refuse(true, `This ${cls} command needs your approval before it can run: ${command}`)
  }

  // Ô ma trận nói `auto` VÌ bypass tạm thời thì nhật ký phải nói ra điều đó —
  // đó là cả lý do `bypass-temp` tồn tại bên cạnh `auto` trong lược đồ nhật ký.
  const decision: InfraDecision =
    verdict.mode === 'auto' ? (verdict.reason === 'bypass' ? 'bypass-temp' : 'auto') : 'approved'

  const result = await runInfra({
    tool: p.tool,
    args: p.args,
    context: p.context,
    actor: 'human',
    surface: p.surface,
    toolName: p.toolName,
    decision,
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
    ...(p.timeoutMs !== undefined ? { timeoutMs: p.timeoutMs } : {}),
  })

  return { blocked: false, command, class: cls, accountKind: verdict.accountKind, decision, result }
}
