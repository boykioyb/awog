// Ma trận quyền hạ tầng: đọc / ghi / bypass tạm thời — ADR 0088 §5, §5b (task 0.7).
//
// Đây là đường DUY NHẤT sửa được chính sách hạ tầng. Chính sách cố tình KHÔNG
// nằm trong `settings.json` (xem đầu `infra/policy-store.ts`): ở đó `settings.set`
// sẽ ghi được ma trận bằng một patch tuỳ ý, tức đổi quyền mà không để lại dấu.
//
// Vì thế mọi handler ghi ở file này đều kết thúc bằng MỘT dòng nhật ký
// (`recordInfraAction`, class `write`, surface `settings`): trả lời được câu "ai
// nới quyền trên máy này, lúc nào" là một nửa lý do ma trận được phép tồn tại.
//
// Validate CHẶT ở biên này, khác hẳn lối đọc file khoan dung của policy-store:
// file trên đĩa có thể do một bản AWOG khác ghi nên ô lạ được sửa im lặng, còn
// payload từ UI mà sai hình dạng là bug — phải đỏ ngay tại chỗ (-32602).

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { recordInfraAction } from '../infra/audit/store.js'
import { vouchBinaryPath } from '../infra/binary.js'
import {
  getInfraPolicySnapshot,
  removeVouchedBinaryPath,
  setInfraBypass,
  setInfraPolicy,
  type InfraPolicySnapshot,
} from '../infra/policy-store.js'
import type { InfraMatrix } from '../infra/policy.js'

const ModeSchema = z.enum(['auto', 'ask', 'block'])
const ColumnSchema = z.object({ normal: ModeSchema, production: ModeSchema })

// Bốn lớp đều BẮT BUỘC: UI gửi cả bảng, và một ô vắng mặt không có nghĩa "giữ
// nguyên" mà chỉ có nghĩa "payload hỏng". Kết quả parse được gán vào một biến
// kiểu `InfraMatrix` ngay trong handler, nên schema lệch khỏi kiểu là lỗi biên
// dịch chứ không phải lỗi lúc chạy.
const MatrixSchema = z.object({
  read: ColumnSchema,
  write: ColumnSchema,
  destructive: ColumnSchema,
  'context-switch': ColumnSchema,
})

const AccountIdsSchema = z.array(z.string().trim().min(1).max(64)).max(200)

const SetSchema = z
  .object({
    matrix: MatrixSchema.optional(),
    prodAccountIds: AccountIdsSchema.optional(),
  })
  .refine((v) => v.matrix !== undefined || v.prodAccountIds !== undefined, {
    message: 'Nothing to set: provide matrix and/or prodAccountIds',
  })

// `minutes: null` = tắt bypass ngay. Ba mốc còn lại là cả danh sách hợp lệ —
// bypass phải hết hạn được (ADR 0088 §5), nên không có đường ghi một mốc tuỳ ý.
const BypassSchema = z.object({
  minutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.null()]),
})

const PathSchema = z.object({ path: z.string().trim().min(1).max(1024) })

function describeMatrix(matrix: InfraMatrix): string {
  return Object.entries(matrix)
    .map(([cls, col]) => `${cls}=${col.normal}/${col.production}`)
    .join(' ')
}

async function auditPolicyChange(argv: string[], summary: string): Promise<void> {
  await recordInfraAction({
    actor: 'human',
    surface: 'settings',
    tool: 'infra_policy',
    argv,
    context: {},
    class: 'write',
    decision: 'approved',
    result: { summary },
  })
}

register('infra.policy.get', async (): Promise<InfraPolicySnapshot> => {
  return getInfraPolicySnapshot()
})

register('infra.policy.set', async (raw): Promise<InfraPolicySnapshot> => {
  const params = SetSchema.parse(raw)
  // Tách ra một biến có kiểu: nếu `MatrixSchema` thiếu một lớp hay một cột so với
  // `InfraMatrix` thì hỏng ở đây, lúc biên dịch.
  const matrix: InfraMatrix | undefined = params.matrix
  const snapshot = await setInfraPolicy({
    ...(matrix !== undefined ? { matrix } : {}),
    ...(params.prodAccountIds !== undefined ? { prodAccountIds: params.prodAccountIds } : {}),
  })
  // Ghi nhật ký SAU khi ghi thành công, và KHÔNG nuốt lỗi: nếu không ghi được
  // dấu vết thì người dùng phải biết, chứ không phải yên tâm nhầm.
  await auditPolicyChange(
    ['policy', 'set'],
    `matrix ${describeMatrix(snapshot.matrix)}; production accounts [${snapshot.prodAccountIds.join(', ')}]`,
  )
  return snapshot
})

register('infra.policy.bypass', async (raw): Promise<InfraPolicySnapshot> => {
  // Ba literal ở `BypassSchema` là cùng một danh sách với `BYPASS_MINUTES`, và
  // `setInfraBypass` chỉ nhận `BypassMinutes` — lệch nhau là lỗi biên dịch.
  const { minutes } = BypassSchema.parse(raw)
  const snapshot = await setInfraBypass(minutes)
  await auditPolicyChange(
    ['policy', 'bypass', minutes === null ? 'off' : `${minutes}m`],
    minutes === null
      ? 'temporary bypass turned off'
      : `temporary bypass until ${snapshot.bypassUntil ?? 'unknown'}`,
  )
  return snapshot
})

// Bảo lãnh một đường dẫn binary ngoài allowlist prefix (task 0.1b). Hành động
// của CON NGƯỜI: không tool nào của agent map tới RPC này. `vouchBinaryPath` tự
// verify (file thường + executable), tự lưu **realpath** và tự ghi nhật ký.
register('infra.policy.vouchBinary', async (raw) => {
  const { path } = PathSchema.parse(raw)
  try {
    const vouched = await vouchBinaryPath(path)
    return { ...vouched, policy: await getInfraPolicySnapshot() }
  } catch (err) {
    if (err instanceof RpcError) throw err
    // Nói thẳng lý do ("Not a regular file", EACCES, ENOENT) thay vì để tầng
    // dispatch bọc thành -32603 "Internal error" — người dùng vừa chọn file bằng
    // tay nên họ sửa được, miễn là biết vì sao.
    throw new RpcError(-32022, err instanceof Error ? err.message : String(err))
  }
})

register('infra.policy.unvouchBinary', async (raw): Promise<InfraPolicySnapshot> => {
  const { path } = PathSchema.parse(raw)
  const snapshot = await removeVouchedBinaryPath(path)
  await auditPolicyChange(['policy', 'unvouch', path], `revoked vouched binary path ${path}`)
  return snapshot
})
