// `infra.sso-create-profiles` — sinh profile SSO hàng loạt từ các account/role
// người dùng đã tick (Mốc 1 A5).
//
// Chỉ ghi `~/.aws/config`: profile SSO không sinh ra secret dài hạn nào.
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { ssoCreateProfiles } from '../infra/aws/sso.js'

const MAX_PICKS = 500

const Params = z.object({
  sessionName: z.string().min(1).max(128),
  ssoRegion: z.string().min(1).max(64),
  startUrl: z.string().min(1).max(2048),
  region: z.string().min(1).max(64).optional(),
  picks: z
    .array(
      z.object({
        accountId: z.string().min(1).max(32),
        roleName: z.string().min(1).max(64),
        profileName: z.string().min(1).max(128),
      }),
    )
    .max(MAX_PICKS),
  overwrite: z.boolean().optional(),
})

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message` (`TARGET_REQUIRED: …`).
// `throwProfileRpcError` bóc mã đó ra `data.code` và giữ nguyên message; không
// có lớp này thì transport gói mọi thứ thành "Internal error" và UI mất sạch
// đường phân nhánh theo mã — đo được qua smoke test: trước khi có nó,
// `friendlyExportError()` của AwsProfileExport.vue không bao giờ khớp một mã nào.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.sso-create-profiles', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await ssoCreateProfiles(p)
  } catch (err) {
    throwProfileRpcError(err)
  }
})
