// `infra.sso-login` — ghi block `[sso-session x]` rồi chạy `aws sso login`
// (Mốc 1 A5). Lệnh mở trình duyệt và chờ người dùng duyệt, nên timeout rộng.
//
// Không token nào đi qua AWOG ở bước này: AWS CLI tự ghi `~/.aws/sso/cache`.
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { ssoLogin } from '../infra/aws/sso.js'

const Params = z.object({
  sessionName: z.string().min(1).max(128),
  startUrl: z.string().min(1).max(2048),
  ssoRegion: z.string().min(1).max(64),
})

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message` (`TARGET_REQUIRED: …`).
// `throwProfileRpcError` bóc mã đó ra `data.code` và giữ nguyên message; không
// có lớp này thì transport gói mọi thứ thành "Internal error" và UI mất sạch
// đường phân nhánh theo mã — đo được qua smoke test: trước khi có nó,
// `friendlyExportError()` của AwsProfileExport.vue không bao giờ khớp một mã nào.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.sso-login', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await ssoLogin(p)
  } catch (err) {
    throwProfileRpcError(err)
  }
})
