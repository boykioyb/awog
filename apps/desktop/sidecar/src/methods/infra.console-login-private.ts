// `infra.console-login-private` — mở URL uỷ quyền của `aws login` trong cửa sổ
// ẩn danh/riêng tư.
//
// Vì sao cần RPC riêng thay vì để UI tự `openExternal`: `shell.openExternal`
// (Electron) luôn dùng trình duyệt mặc định và KHÔNG truyền được cờ nào, nên nó
// mở lại đúng cái cửa sổ đang dính cookie cũ — tức đúng cái đang trả 400. Việc
// chọn trình duyệt + dựng argv nằm ở `infra/aws/open-private.ts` (thuần, có
// test); ở đây chỉ là cửa vào.
//
// Bề mặt của CON NGƯỜI: không AgentTool nào gọi method này. Nó không đọc/ghi
// credential và không chạm `~/.aws`, nên không có bản ghi audit.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { openInPrivateWindow } from '../infra/aws/open-private.js'

// Trần độ dài khớp hàng rào trong `isAuthorizeUrl`: URL uỷ quyền thật dài
// ~600–900 ký tự, nên 4096 là rộng rãi mà vẫn chặn payload lạ.
const Params = z.object({ url: z.string().min(1).max(4096) })

register('infra.console-login-private', async (raw) => {
  const p = Params.parse(raw)
  return await openInPrivateWindow(p.url)
})
