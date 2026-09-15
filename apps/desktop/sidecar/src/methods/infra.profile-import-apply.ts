// `infra.profile-import-apply` — ghi những profile người dùng đã tick ở màn xem
// trước vào `~/.aws` (Mốc 1 A4).
//
// Đây là một trong hai chỗ secret đi từ UI vào sidecar (chỗ kia là
// `infra.profile-save`). Nó đi đúng MỘT lần ghi qua `applyAwsIniEdits` — không
// lưu lại, không log, không event, không vào nhật ký lệnh (dòng nhật ký chỉ có
// tên profile), không vào context model.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { applyImport } from '../infra/aws/import-export.js'

const MAX_TEXT = 1024 * 1024
const MAX_SELECTIONS = 200

const Params = z.object({
  source: z.enum(['paste', 'file', 'csv']),
  text: z.string().max(MAX_TEXT).optional(),
  path: z.string().max(4096).optional(),
  selections: z
    .array(
      z.object({
        from: z.string().min(1).max(128),
        // Regex tên profile được kiểm LẠI trong `applyImport` — zod ở đây chỉ
        // chặn payload quá khổ; luật tên là tri thức của tầng dưới, một nguồn.
        to: z.string().min(1).max(128),
        overwrite: z.boolean().default(false),
      }),
    )
    .max(MAX_SELECTIONS),
})

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message` (`TARGET_REQUIRED: …`).
// `throwProfileRpcError` bóc mã đó ra `data.code` và giữ nguyên message; không
// có lớp này thì transport gói mọi thứ thành "Internal error" và UI mất sạch
// đường phân nhánh theo mã — đo được qua smoke test: trước khi có nó,
// `friendlyExportError()` của AwsProfileExport.vue không bao giờ khớp một mã nào.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.profile-import-apply', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await applyImport({
      source: p.source,
      ...(p.text !== undefined ? { text: p.text } : {}),
      ...(p.path !== undefined ? { path: p.path } : {}),
      selections: p.selections,
    })
  } catch (err) {
    throwProfileRpcError(err)
  }
})
