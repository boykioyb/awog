// `infra.console-login` — đăng nhập Console bằng trình duyệt qua `aws login`
// (bổ sung 2026-09-13). Lệnh mở trình duyệt và chờ người dùng duyệt nên timeout
// rộng; không token nào đi qua AWOG, chỉ `login_session` (định danh) được chép
// từ file tạm vào `~/.aws/config` qua `applyAwsIniEdits`.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này (ADR 0088 §1b luật 4).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { consoleLogin } from '../infra/aws/console-login.js'

const Params = z.object({
  profile: z.string().min(1).max(128),
  region: z.string().min(1).max(64),
})

// Mã lỗi nghiệp vụ nằm ở ĐẦU `message` (`INVALID_NAME: …`,
// `EXISTS_OTHER_STYLE: …`) — `throwProfileRpcError` bóc nó ra `data.code` để UI
// phân nhánh, thay vì transport gói tất cả thành "Internal error".
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát và `catch` ở đây không bao giờ chạy.
register('infra.console-login', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await consoleLogin(p)
  } catch (err) {
    throwProfileRpcError(err)
  }
})
