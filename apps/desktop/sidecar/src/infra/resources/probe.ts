// Dò quyền ghi lúc mở màn (task 3.3).
//
// VẤN ĐỀ. `infra-explorer.md`: "Dò quyền lúc mở màn ⇒ ẩn nút ghi thay vì để bấm
// rồi nhận `AccessDenied`". Bấm Start rồi nhận lỗi quyền là trải nghiệm tệ, và tệ
// hơn: nó dạy người dùng rằng cổng duyệt của AWOG là thứ để bấm qua, chứ không
// phải một câu trả lời.
//
// CÁCH DÒ. `sts get-caller-identity` (đã nằm trong allowlist `read` từ Mốc 0) cho
// ARN của chính mình, rồi `iam simulate-principal-policy` hỏi AWS "ARN này có được
// làm các action sau không". Cả hai đều là ĐỌC: không đổi tài nguyên, không tốn
// tiền.
//
// BA KẾT CỤC, VÀ CÁI THỨ BA MỚI QUAN TRỌNG. `allowed` / `denied` / **`unknown`**.
// `unknown` xảy ra khi chính `simulate-principal-policy` bị từ chối — rất thường
// gặp, vì `iam:SimulatePrincipalPolicy` không nằm trong các policy thông dụng.
// Khi đó UI **vẫn hiện** nút ghi kèm hộp duyệt, tức thoái hoá về hành vi cũ chứ
// không giấu nút đi. Hai chiều sai không đối xứng: giấu một nút người dùng thật sự
// có quyền là chặn việc của họ, còn hiện một nút rồi báo `AccessDenied` chỉ là một
// lần bấm thừa.
//
// VÌ SAO KHÔNG DÒ BẰNG CÁCH CHẠY THỬ. Chạy thử `--dry-run` chỉ có ở vài API EC2 và
// bản thân nó vẫn là một lời gọi thay đổi trạng thái ở một số dịch vụ. Không có
// đường nào rẻ hơn `simulate` mà vẫn thật.

import { runGated } from '../gated.js'
import { asArray, asObj, str } from './spec.js'
import type { InfraSurface } from '../audit/store.js'
import type { InfraContext } from '../run.js'

export type ProbeVerdict = 'allowed' | 'denied' | 'unknown'

/** Kết quả THUẦN của một lần đọc `simulate-principal-policy` (dễ test). */
export function interpretSimulation(json: unknown): ProbeVerdict {
  const results = asArray(asObj(json)['EvaluationResults'])
  if (results.length === 0) return 'unknown'
  for (const r of results) {
    const d = str(asObj(r)['EvalDecision'])
    // `allowed` là DUY NHẤT được coi là cho phép; `implicitDeny` cũng là từ chối
    // (thiếu quyền là thiếu quyền, dù không có deny tường minh).
    if (d !== 'allowed') return 'denied'
  }
  return 'allowed'
}

export type ProbeResult = {
  verdict: ProbeVerdict
  /** Action nào bị chặn — UI dùng để nói VÌ SAO nút bị ẩn. */
  deniedActions: string[]
}

export type ProbeInput = {
  actions: readonly string[]
  context: InfraContext
  surface: InfraSurface
}

export async function probePermissions(input: ProbeInput): Promise<ProbeResult> {
  if (input.actions.length === 0) return { verdict: 'unknown', deniedActions: [] }

  const who = await runGated({
    tool: 'aws',
    args: ['sts', 'get-caller-identity'],
    context: input.context,
    surface: input.surface,
    toolName: 'infra_view',
  })
  if (who.blocked || !who.result.ok) return { verdict: 'unknown', deniedActions: [] }

  let arn = ''
  try {
    arn = str(asObj(JSON.parse(who.result.stdout) as unknown)['Arn'])
  } catch {
    return { verdict: 'unknown', deniedActions: [] }
  }
  if (!arn) return { verdict: 'unknown', deniedActions: [] }

  const sim = await runGated({
    tool: 'aws',
    args: [
      'iam',
      'simulate-principal-policy',
      '--policy-source-arn',
      arn,
      '--action-names',
      ...input.actions,
    ],
    context: input.context,
    surface: input.surface,
    toolName: 'infra_view',
  })
  if (sim.blocked || !sim.result.ok) return { verdict: 'unknown', deniedActions: [] }

  let json: unknown
  try {
    json = JSON.parse(sim.result.stdout) as unknown
  } catch {
    return { verdict: 'unknown', deniedActions: [] }
  }

  const denied = asArray(asObj(json)['EvaluationResults'])
    .filter((r) => str(asObj(r)['EvalDecision']) !== 'allowed')
    .map((r) => str(asObj(r)['EvalActionName']))
    .filter((a) => a !== '')

  const verdict = interpretSimulation(json)
  return { verdict, deniedActions: verdict === 'denied' ? denied : [] }
}
