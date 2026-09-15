// `infra.sso-list` — liệt kê account + role của một sso-session (Mốc 1 A5).
//
// ⚠ Đường này đọc access token SSO từ `~/.aws/sso/cache` và truyền nó cho AWS CLI
// qua argv. Token KHÔNG BAO GIỜ nằm trong params hay trong kết quả của RPC này —
// xem phần đánh đổi ghi ở đầu `infra/aws/sso.ts`, hạng mục cần infosec chốt.
//
// Token hết hạn / chưa đăng nhập ⇒ `{ ok:false, needsLogin:true }` chứ không ném:
// đó là trạng thái bình thường của luồng, UI hiện nút đăng nhập.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { ssoListAccounts } from '../infra/aws/sso.js'

const Params = z.object({ sessionName: z.string().min(1).max(128) })

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message` (`TARGET_REQUIRED: …`).
// `throwProfileRpcError` bóc mã đó ra `data.code` và giữ nguyên message; không
// có lớp này thì transport gói mọi thứ thành "Internal error" và UI mất sạch
// đường phân nhánh theo mã — đo được qua smoke test: trước khi có nó,
// `friendlyExportError()` của AwsProfileExport.vue không bao giờ khớp một mã nào.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.sso-list', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await ssoListAccounts(p)
  } catch (err) {
    throwProfileRpcError(err)
  }
})
