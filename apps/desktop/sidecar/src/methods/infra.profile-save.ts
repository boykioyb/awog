// `infra.profile-save` — tạo/sửa một profile AWS (ADR 0088 §1b, Mốc 1 A3).
//
// BỀ MẶT CỦA CON NGƯỜI. Không có AgentTool nào map tới method này và không được
// phép tạo ra một cái: CRUD credential là việc người dùng bấm nút, không phải
// việc model gọi tool (ADR 0088 §1b luật 4).
//
// INVARIANT #1/#3: `secrets` là lần DUY NHẤT giá trị khoá đi từ UI vào sidecar.
// Chúng đi thẳng vào `saveProfile()` rồi ra đĩa — không lưu lại, không log,
// không vào event, không vào nhật ký, không vào giá trị trả về (payload chỉ có
// `AwsProfile`, kiểu đó chỉ mang metadata + hai boolean).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { saveProfile, throwProfileRpcError } from '../infra/aws/profile-ops.js'

// Trần độ dài là hàng rào L1 cho payload IPC, không phải validate ngữ nghĩa —
// đúng/sai của từng khoá do `profile-ops.ts` quyết. Session token của SSO/SAML
// dài tới vài KB nên nới riêng cho nó.
const Secrets = z.object({
  accessKeyId: z.string().max(512).optional(),
  secretAccessKey: z.string().max(512).optional(),
  sessionToken: z.string().max(16_384).optional(),
})

const Params = z.object({
  name: z.string().min(1).max(128),
  previousName: z.string().min(1).max(128).optional(),
  // `login` nằm trong enum vì form Sửa của profile `aws login` gửi được TÊN và
  // REGION qua chính RPC này; ruột của nó (`login_session`) do `console-login.ts`
  // ghi và `assertLoginEdit` từ chối mọi payload mang khoá đó.
  kind: z.enum(['static', 'sso', 'assume-role', 'login']),
  config: z.record(z.string().max(2048)).default({}),
  secrets: Secrets.optional(),
  overwrite: z.boolean().optional(),
  surface: z.enum(INFRA_SURFACES).default('settings'),
})

register('infra.profile-save', async (raw) => {
  const p = Params.parse(raw)
  try {
    const { profile, backups } = await saveProfile({
      name: p.name,
      ...(p.previousName !== undefined ? { previousName: p.previousName } : {}),
      kind: p.kind,
      config: p.config,
      ...(p.secrets !== undefined ? { secrets: p.secrets } : {}),
      ...(p.overwrite !== undefined ? { overwrite: p.overwrite } : {}),
      surface: p.surface,
    })
    return { ok: true as const, profile, backups }
  } catch (err) {
    throwProfileRpcError(err)
  }
})
