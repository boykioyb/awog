// `infra.resolve-account-ids` — hỏi AWS "profile này thuộc account nào" rồi nhớ
// lại (Mốc 1 A8).
//
// ⚠ ĐÂY LÀ ĐƯỜNG CÓ GỌI MẠNG. Nó chạy `sts get-caller-identity` cho từng profile
// chưa biết id — credential và tiền của người dùng — nên chỉ được gọi từ một nút
// người dùng vừa bấm. KHÔNG gọi lúc mở trang, lúc watcher bắn, hay "nền cho tiện".
//
// KHÔNG NÉM khi một profile hỏng: đó là kết quả hợp lệ, nó nằm trong `failures[]`
// để UI hiện từng dòng. Chỉ ném khi chính lời gọi sai (tên không hợp lệ, quá trần).
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { resolveAccountIds } from '../infra/aws/account-ids.js'

// Trần ở đây rộng hơn trần nghiệp vụ (50) một chút và chỉ để chặn payload rác;
// con số thật cùng thông báo của nó nằm trong `account-ids.ts`, để UI luôn nhận
// được mã `TOO_MANY` thay vì một lỗi zod không đọc được.
const Params = z.object({
  names: z.array(z.string().min(1).max(128)).max(500),
  surface: z.enum(INFRA_SURFACES).default('settings'),
})

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message`; `throwProfileRpcError` bóc nó
// ra `data.code`.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.resolve-account-ids', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await resolveAccountIds({ names: p.names, surface: p.surface })
  } catch (err) {
    throwProfileRpcError(err)
  }
})
