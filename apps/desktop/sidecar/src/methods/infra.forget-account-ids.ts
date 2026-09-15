// `infra.forget-account-ids` — quên account id đã nhớ (audit #2).
//
// Đường LÙI của A8. `infra.resolve-account-ids` sửa được một id sai bằng cách
// phân giải lại, nhưng chỉ khi STS còn gọi được; khi token hết hạn hoặc profile
// mất quyền `sts:GetCallerIdentity` thì không còn cách nào gỡ một giá trị sai ra
// khỏi cache trước khi nó hết hạn. Method này là cách đó.
//
// GHI đĩa ⇒ có một dòng nhật ký (`forgetAccountIds` tự gọi `recordInfraAction`).
// Không gọi mạng. Bề mặt của CON NGƯỜI — không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { forgetAccountIds } from '../infra/aws/account-ids.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'

// `names` VẮNG ⇒ quên SẠCH, cố ý: nút "xoá hết" là một lời gọi không tham số,
// còn `names: []` nghĩa là "không quên gì cả" — hai ý đó không được trùng hình
// dạng. Trần 200 để một payload lạ không thành một vòng lặp dài trong sidecar.
const Params = z
  .object({
    names: z.array(z.string().min(1).max(128)).max(200).optional(),
    surface: z.enum(INFRA_SURFACES).default('settings'),
  })
  .default({})

register('infra.forget-account-ids', async (raw) => {
  const params = Params.parse(raw)
  try {
    return await forgetAccountIds({
      ...(params.names !== undefined ? { names: params.names } : {}),
      surface: params.surface,
    })
  } catch (err) {
    throwProfileRpcError(err)
  }
})
