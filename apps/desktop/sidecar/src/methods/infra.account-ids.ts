// `infra.account-ids` — account id đã biết của mọi profile (Mốc 1 A8).
//
// CHỈ ĐỌC: `~/.aws` + cache trên đĩa. **Không gọi mạng**, nên UI gọi được lúc
// mở trang mà không tiêu một lượt STS nào của người dùng. Muốn phân giải thật
// thì có `infra.resolve-account-ids`, và nó phải do một nút người dùng bấm.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { listAccountIds } from '../infra/aws/account-ids.js'

// Params rỗng, nhưng vẫn parse: `{}` và `undefined` đều phải đi qua cùng một
// cửa, và một payload lạ không được lặng lẽ bị bỏ qua.
const Params = z.object({}).optional()

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message`; `throwProfileRpcError` bóc nó
// ra `data.code` để UI phân nhánh theo MÃ chứ không so chuỗi tiếng Anh.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.account-ids', async (raw) => {
  Params.parse(raw)
  try {
    return { entries: await listAccountIds() }
  } catch (err) {
    throwProfileRpcError(err)
  }
})
