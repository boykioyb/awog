// `infra.profile-delete` — xoá một profile khỏi `~/.aws/{config,credentials}`
// (ADR 0088 §1b, Mốc 1 A3). Bề mặt của CON NGƯỜI: không AgentTool nào được nối
// vào đây.
//
// Xoá là idempotent — profile không tồn tại trả `removedFrom: []` chứ không ném,
// vì UI có thể bấm xoá trên một danh sách vừa cũ đi vài trăm ms. `backups` trả
// về để hộp thoại nói được "khôi phục ở đâu" (spec `aws-profile-manager.md`).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { deleteProfile, throwProfileRpcError } from '../infra/aws/profile-ops.js'

const Params = z.object({
  name: z.string().min(1).max(128),
  surface: z.enum(INFRA_SURFACES).default('settings'),
})

register('infra.profile-delete', async (raw) => {
  const p = Params.parse(raw)
  try {
    const { removedFrom, backups } = await deleteProfile(p.name, p.surface)
    return { ok: true as const, removedFrom, backups }
  } catch (err) {
    throwProfileRpcError(err)
  }
})
