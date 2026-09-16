// `infra.kube.exec` — mở một SHELL TƯƠNG TÁC bên trong một pod (`kubectl exec -it`),
// cho tab "Terminal" của một pod trong `/infra → Kubernetes`.
//
// Vì sao là RPC RIÊNG, không phải một `op` của `infra.kube`:
//   · `infra.kube` chạy MỘT-SHOT (`runGated` → `runInfra`, bắt stdout rồi trả về).
//     Một shell là tiến trình SỐNG — nó stream hai chiều qua PTY (`terminal.*`),
//     không có "stdout cuối cùng". Hai hình dạng khác nhau ⇒ hai method.
//   · Nhưng cổng quyền thì KHÔNG được khác: exec vào pod là chạy lệnh tuỳ ý trong
//     cluster (`classify` xếp `exec` là `write` ⇒ "hỏi"), nên nó đi qua ĐÚNG
//     `gateInfraDecision` mà `infra.kube`/`infra.run` dùng — cùng vé duyệt do
//     sidecar phát, cùng ma trận, cùng nhật ký. Khác biệt duy nhất: sau khi được
//     duyệt, ta spawn PTY thay vì `runInfra`.
//
// Ba hàng rào (giống `infra.kube`):
//   · Tên pod/container đến từ OUTPUT của cluster ⇒ qua regex DNS-1123 TRƯỚC khi
//     thành phần tử argv (một tên `--kubeconfig=…` không bao giờ thành cờ).
//   · `--context`/`--namespace` do sidecar chèn qua `withContext`, không do UI ghép.
//   · env qua `infraEnv` (lọc bằng `filteredShellEnv` — không mang OAuth/API token),
//     và nó luồn `AWS_PROFILE` xuống cho exec-plugin `aws eks get-token` của EKS:
//     thiếu bước này thì shell hoặc báo "Unable to locate credentials", hoặc tệ
//     hơn — mở trên account `[default]` của máy trong khi chip nói profile khác.
import { homedir } from 'node:os'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { gateInfraDecision } from '../infra/gated.js'
import { resolveInfraBinary, installHint } from '../infra/binary.js'
import { infraEnv, infraAuditContext } from '../infra/run.js'
import { recordInfraAction } from '../infra/audit/store.js'
import { terminalManager } from '../terminal/manager.js'
import { CONTAINER_RE, NAME_RE, k8s, k8sContext, requireMatch } from './infra.kube.js'

// Thử bash rồi rơi về sh: `-it` đã cấp TTY, `exec` thay tiến trình `sh` bằng shell
// đích nên nó thừa hưởng TTY và tương tác thật. Đây là HẰNG SỐ của sidecar (không
// phải input) nên an toàn để nằm sau `--`.
//
// ⚠ KHÔNG viết `exec bash || exec sh`: trong POSIX sh, `exec` THẤT BẠI (bash không
// có — Alpine/slim/distroless-có-sh) khiến shell THOÁT NGAY với 127, KHÔNG chạy tiếp
// nhánh `||` (đúng lỗi "exit code 127" đo được). Phải TEST bằng `command -v` (không
// exec) trước, rồi mới `exec` cái có thật.
const SHELL_FALLBACK = 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'

const Params = z.object({
  context: k8sContext,
  pod: z.string().max(253),
  container: z.string().max(63).optional(),
  cols: z.number().int().positive().max(1000).optional(),
  rows: z.number().int().positive().max(1000).optional(),
  approvalTicket: z.string().max(100).optional(),
})

/** Env của tiến trình con dưới dạng Record<string,string> (bỏ mọi khoá `undefined`). */
function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v
  return out
}

/** Bị chặn/không chạy được — cùng khuôn với `infra.kube` để UI dùng chung đường xử lý. */
type ExecBlocked = {
  blocked: true
  requiresApproval: boolean
  approvalTicket?: string
  command: string
  reason: string
  class: string
  accountKind: string
}
type ExecOk = { blocked: false; terminalId: string; command: string }
export type InfraKubeExecResult = ExecBlocked | ExecOk

register('infra.kube.exec', async (raw): Promise<InfraKubeExecResult> => {
  const p = Params.parse(raw ?? {})
  const ctx = k8s(p.context)
  const args = [
    'exec',
    '-i',
    '-t',
    requireMatch(p.pod, NAME_RE, 'Tên pod'),
    ...(p.container !== undefined
      ? ['-c', requireMatch(p.container, CONTAINER_RE, 'Tên container')]
      : []),
    '--',
    'sh',
    '-c',
    SHELL_FALLBACK,
  ]

  const gate = await gateInfraDecision({
    tool: 'kubectl',
    args,
    context: ctx,
    surface: 'terminal',
    toolName: 'kube_exec',
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
  })
  if (gate.blocked) {
    return {
      blocked: true,
      requiresApproval: gate.requiresApproval,
      ...(gate.approvalTicket !== undefined ? { approvalTicket: gate.approvalTicket } : {}),
      command: gate.command,
      reason: gate.reason,
      class: gate.class,
      accountKind: gate.accountKind,
    }
  }

  // Đã duyệt. Từ đây là đường spawn PTY — nó KHÔNG đi qua `runInfra`, nên hai từ
  // chối cứng của `runInfra` (thiếu binary) phải tự kiểm ở đây; cờ ghi đè thì không
  // thể có vì argv do sidecar dựng hết.
  const bin = await resolveInfraBinary('kubectl')
  if (!bin) {
    // requiresApproval:false + không vé ⇒ UI hiện lý do, không có nút chạy.
    return {
      blocked: true,
      requiresApproval: false,
      command: gate.command,
      reason: `Không tìm thấy kubectl trên máy. ${installHint('kubectl')}`,
      class: gate.class,
      accountKind: gate.accountKind,
    }
  }

  // Cờ ngữ cảnh của kubectl là cờ TOÀN CỤC — phải đứng TRƯỚC `--` (mọi thứ SAU
  // `--` là lệnh chạy trong container). `withContext` chèn vào CUỐI argv nên KHÔNG
  // dùng được ở đây: nó sẽ rơi sau `--` và biến `--context`/`--namespace` thành
  // tham số của `sh` — kubectl khi đó dùng context/namespace HIỆN HÀNH của kubeconfig
  // chứ không phải cái phiên đang ghim (mở nhầm cluster/namespace). Chèn ngay sau
  // `exec` thay vì thế. `args[0]` luôn là `'exec'`.
  const ctxFlags: string[] = []
  if (ctx.cluster) ctxFlags.push('--context', ctx.cluster)
  if (ctx.namespace) ctxFlags.push('--namespace', ctx.namespace)
  const finalArgs = ['exec', ...ctxFlags, ...args.slice(1)]
  let spawned: { terminalId: string }
  try {
    spawned = await terminalManager.spawnProcess({
      file: bin,
      args: finalArgs,
      env: stringEnv(infraEnv('kubectl', ctx)),
      cwd: homedir(),
      cols: p.cols ?? 80,
      rows: p.rows ?? 24,
      // Khoá gom nhóm PTY: một shell/tổ hợp cluster-namespace. Chỉ dùng cho
      // list/giới hạn số terminal, không phải ranh giới bảo mật.
      sessionId: `kube-exec:${ctx.cluster ?? ''}/${ctx.namespace ?? ''}`,
    })
  } catch (err) {
    throw new RpcError(-32603, err instanceof Error ? err.message : 'Không mở được shell')
  }

  // Một shell mở = một dòng nhật ký (đường một-shot để `runInfra` ghi; đường này tự
  // ghi vì đã bỏ qua `runInfra`). Không ghi output — nó là phiên sống, không phải
  // một lệnh có "kết quả".
  await recordInfraAction({
    actor: 'human',
    surface: 'terminal',
    tool: 'kube_exec',
    argv: [...args],
    context: infraAuditContext(ctx),
    class: gate.class,
    decision: gate.decision,
    result: { summary: 'interactive shell opened' },
  })

  return { blocked: false, terminalId: spawned.terminalId, command: gate.command }
})
