// `infra.profile-export` — xuất cấu hình profile ra INI (Mốc 1 A6).
//
// Hai chế độ, mặc định là chế độ an toàn:
//   · `includeSecrets: false` (mặc định) — KHÔNG mở `~/.aws/credentials` một lần
//     nào. Đây là thứ chia sẻ được cho đồng đội.
//   · `includeSecrets: true` — đòi `confirmName` khớp đúng một tên trong `names`,
//     ghi nhật ký, và file ra đĩa `chmod 600`.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này — nếu có, nó sẽ là
// đúng cái đường vòng qua invariant #1 mà cả họ tính năng này dựng lên để chặn.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { exportProfiles } from '../infra/aws/import-export.js'

const MAX_NAMES = 200

const Params = z.object({
  names: z.array(z.string().min(1).max(128)).min(1).max(MAX_NAMES),
  includeSecrets: z.boolean().default(false),
  confirmName: z.string().max(128).optional(),
  targetPath: z.string().max(4096).optional(),
})

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message` (`TARGET_REQUIRED: …`).
// `throwProfileRpcError` bóc mã đó ra `data.code` và giữ nguyên message; không
// có lớp này thì transport gói mọi thứ thành "Internal error" và UI mất sạch
// đường phân nhánh theo mã — đo được qua smoke test: trước khi có nó,
// `friendlyExportError()` của AwsProfileExport.vue không bao giờ khớp một mã nào.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.profile-export', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await exportProfiles({
      names: p.names,
      includeSecrets: p.includeSecrets,
      ...(p.confirmName !== undefined ? { confirmName: p.confirmName } : {}),
      ...(p.targetPath !== undefined ? { targetPath: p.targetPath } : {}),
    })
  } catch (err) {
    throwProfileRpcError(err)
  }
})
