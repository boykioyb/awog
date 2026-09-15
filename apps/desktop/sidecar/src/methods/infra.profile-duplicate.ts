// `infra.profile-duplicate` — nhân bản một profile (ADR 0088 §1b, Mốc 1 A3).
//
// VÌ SAO Ở SIDECAR chứ không phải "UI đọc profile rồi gọi profile-save": đường
// đọc của AWOG không bao giờ nạp giá trị secret (invariant #1), nên một bản sao
// dựng ở UI sẽ đẻ ra profile static KHÔNG có khoá. Ở đây section được chép
// nguyên văn từng dòng (`copySection`), giá trị không bị cắt ra thành biến có
// tên và không đi qua IPC lần nào.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { duplicateProfile, throwProfileRpcError } from '../infra/aws/profile-ops.js'

const Params = z.object({
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  overwrite: z.boolean().optional(),
  surface: z.enum(INFRA_SURFACES).default('settings'),
})

register('infra.profile-duplicate', async (raw) => {
  const p = Params.parse(raw)
  try {
    const { profile, backups } = await duplicateProfile({
      from: p.from,
      to: p.to,
      ...(p.overwrite !== undefined ? { overwrite: p.overwrite } : {}),
      surface: p.surface,
    })
    return { ok: true as const, profile, backups }
  } catch (err) {
    throwProfileRpcError(err)
  }
})
