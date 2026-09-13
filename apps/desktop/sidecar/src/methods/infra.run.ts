// `infra.run` — chạy một lệnh hạ tầng TỪ BỀ MẶT CỦA NGƯỜI DÙNG, có cổng
// (ADR 0088 §3, §5; task 0.9).
//
// Khác `runInfra()` ở chỗ nào: `infra/run.ts` là cái CHÂN (spawn, chèn ngữ cảnh,
// từ chối cờ ghi đè, ghi nhật ký) và nó nhận sẵn `decision` — nó không tự quyết
// được phép chạy hay không. RPC này là cái ĐẦU: nó hỏi ma trận quyền trước, rồi
// mới gọi chân.
//
// Ba nhánh, đúng ba mức của ma trận:
//   block → KHÔNG spawn. Trả dòng lệnh về để người dùng tự chạy nếu họ muốn, và
//           vẫn để lại một dòng nhật ký — "AWOG đã từ chối lệnh gì" cũng là thứ
//           phải tra lại được.
//   ask   → RPC này chỉ phục vụ lời gọi ĐÃ được người dùng duyệt ở UI, nên nó đòi
//           `approved: true`. Thiếu ⇒ từ chối (kèm cờ `requiresApproval` để UI
//           biết phải mở hộp xác nhận), không phải im lặng chạy.
//   auto  → chạy thẳng; `decision` ghi vào nhật ký phân biệt `auto` (ô ma trận)
//           với `bypass-temp` (van xả tạm thời) — hai thứ này mà lẫn vào nhau thì
//           câu "vì sao lệnh đó chạy mà không ai hỏi tôi" không trả lời được.
//
// `actor: 'human'`: bề mặt gọi RPC này là Explorer/Logs/Settings — tức người
// dùng bấm nút. Agent KHÔNG đi qua đây; nó gọi tool `aws_cli` (task 0.12) và tool
// đó gọi thẳng `runInfra()` với actor `agent:<tên>`.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { classify } from '../infra/classify.js'
import { decide } from '../infra/policy.js'
import { loadInfraPolicy } from '../infra/policy-store.js'
import { runInfra } from '../infra/run.js'
import { callFingerprint, consumeApproval, issueApproval } from '../infra/approvals.js'
import { recordInfraAction, INFRA_SURFACES } from '../infra/audit/store.js'
import { describeInfraCommand } from '../runtime/permission.js'
import type { InfraDecision } from '../infra/audit/store.js'
import type { InfraAccountKind, InfraMode } from '../infra/policy.js'
import type { InfraRunResult } from '../infra/run.js'
import type { InfraCommandClass } from '../infra/types.js'

// Trần của `args`: đây là L1 (payload IPC). 200 phần tử × 4096 ký tự là thừa sức
// cho mọi lệnh CLI thật, và chặn một payload phình to đi thẳng vào `execFile`.
const MAX_ARGS = 200
const MAX_ARG_CHARS = 4096

const ContextSchema = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
    cluster: z.string().max(200).optional(),
    namespace: z.string().max(200).optional(),
    // 500 là trần của `InfraAuditContextSchema`: nhật ký dùng `.parse()` nên một
    // giá trị dài hơn sẽ làm lượt ghi nhật ký NÉM, tức mất cả lệnh lẫn dấu vết.
    workspace: z.string().max(500).optional(),
  })
  .default({})

const Params = z.object({
  tool: z.enum(['aws', 'terraform', 'kubectl']),
  args: z.array(z.string().max(MAX_ARG_CHARS)).max(MAX_ARGS),
  context: ContextSchema,
  surface: z.enum(INFRA_SURFACES),
  /** Tên tool AWOG cho nhật ký (`infra_view`, `logs_query`…), KHÔNG phải tên binary. */
  toolName: z.string().min(1).max(120),
  /**
   * Vé duyệt một-lần do CHÍNH sidecar phát ở lượt gọi trước (xem infra/approvals.ts).
   * ⚠ Thay cho cờ `approved: boolean` của bản đầu: cờ đó do renderer tự khai, mà
   * payload IPC là L1 — "người dùng đã duyệt" lấy từ chính bên gọi thì không
   * chứng minh được gì (infosec audit #1). Khoá `approved` nếu còn được gửi lên
   * sẽ bị zod lược bỏ và KHÔNG có tác dụng nào.
   */
  approvalTicket: z.string().max(100).optional(),
  /**
   * Trần phiên tự siết (ADR 0088 §5b). Chỉ siết được: `decide()` lấy cái chặt hơn
   * giữa ma trận và giá trị này, nên một payload UI không nới quyền được bằng nó.
   */
  sessionFloor: z.enum(['auto', 'ask', 'block']).optional(),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
})

type Blocked = {
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

type Ran = {
  blocked: false
  command: string
  class: InfraCommandClass
  accountKind: InfraAccountKind
  decision: InfraDecision
  result: InfraRunResult
}

register('infra.run', async (raw): Promise<Blocked | Ran> => {
  const p = Params.parse(raw)
  const cls = classify(p.tool, p.args)
  const policy = await loadInfraPolicy()
  const verdict = decide({
    policy,
    class: cls,
    ...(p.context.accountId !== undefined ? { accountId: p.context.accountId } : {}),
    ...(p.sessionFloor !== undefined ? { sessionFloor: p.sessionFloor } : {}),
  })
  const command = describeInfraCommand(p.tool, p.args, p.context)

  // Nhật ký cho hai nhánh KHÔNG chạy. Nhánh chạy để `runInfra` tự ghi — task 0.6
  // đòi đúng một dòng, ghi tại chỗ chạy chứ không phải tại call site.
  const fingerprint = callFingerprint(p.tool, p.args, p.context)

  const refuse = async (requiresApproval: boolean, reason: string): Promise<Blocked> => {
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
})
