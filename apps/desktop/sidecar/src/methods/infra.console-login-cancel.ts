// `infra.console-login-cancel` — huỷ CỨNG phiên `aws login` đang chờ.
//
// Vì sao cần một RPC riêng: `infra.console-login` chỉ trả về khi tiến trình kết
// thúc (tối đa 300s), nên không có cách nào "rút lại" nó qua chính lời gọi đó.
// Không có đường huỷ thật thì nút Huỷ chỉ bỏ CHỜ ở UI trong khi `aws login` vẫn
// sống: nếu người dùng đăng nhập nốt trong trình duyệt, sidecar vẫn ghi
// `login_session` và profile tự dưng xuất hiện (nợ N7 của Mốc 2).
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này: nó chỉ bỏ một tiến
// trình đang chờ, không đọc/ghi credential.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { cancelConsoleLogin } from '../infra/aws/console-login.js'

register('infra.console-login-cancel', async (raw) => {
  z.object({}).parse(raw ?? {})
  return { cancelled: cancelConsoleLogin() }
})
