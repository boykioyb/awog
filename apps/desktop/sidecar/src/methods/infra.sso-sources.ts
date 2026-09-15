// `infra.sso-sources` — những nguồn SSO mà máy này đã biết (Mốc 1 A7).
//
// CHỈ ĐỌC: không chạy lệnh nào, không chạm mạng, không ghi gì ⇒ không
// `recordInfraAction` (nhật ký ghi HÀNH ĐỘNG, và ở đây không có hành động nào).
// Chính vì thế method này an toàn để UI gọi lúc mở wizard.
//
// ⚠ Đường này ĐỌC thư mục `~/.aws/sso/cache`, nơi có access token còn sống.
// Kết quả trả về CHỈ mang metadata (`startUrl`, `ssoRegion`) và cờ
// `hasLiveToken` — xem khối invariant ở đầu `infra/aws/sso-sources.ts`.
//
// Không có nguồn nào ⇒ `{ sources: [] }`, đó là trạng thái hợp lệ của một máy
// chưa từng dùng SSO, không phải lỗi.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSsoSources } from '../infra/aws/sso-sources.js'

const Params = z.object({}).default({})

register('infra.sso-sources', async (raw) => {
  Params.parse(raw ?? {})
  return { sources: await listSsoSources() }
})
