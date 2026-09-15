// `infra.profile-export-commands` — các dòng `aws configure set …` tương đương
// một profile, cho người muốn tự chạy thay vì để AWOG ghi file (Mốc 1 A6).
//
// Dòng khoá luôn là placeholder: đường đọc của AWOG không bao giờ thấy giá trị
// secret, nên hàm sinh lệnh KHÔNG CÓ CÁCH NÀO biết chúng (invariant #1).
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { exportCommands } from '../infra/aws/import-export.js'

const Params = z.object({ name: z.string().min(1).max(128) })

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message` (`TARGET_REQUIRED: …`).
// `throwProfileRpcError` bóc mã đó ra `data.code` và giữ nguyên message; không
// có lớp này thì transport gói mọi thứ thành "Internal error" và UI mất sạch
// đường phân nhánh theo mã — đo được qua smoke test: trước khi có nó,
// `friendlyExportError()` của AwsProfileExport.vue không bao giờ khớp một mã nào.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.profile-export-commands', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await exportCommands(p.name)
  } catch (err) {
    throwProfileRpcError(err)
  }
})
