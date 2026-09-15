// `infra.profile-import-preview` — xem trước một luồng NHẬP profile trước khi có
// gì chạm đĩa (Mốc 1 A4, spec `aws-profile-manager.md` §Nhập).
//
// Bề mặt của CON NGƯỜI: người dùng dán một khối, chọn một file, hoặc chọn CSV
// của IAM console. Không AgentTool nào gọi method này (ADR 0088 §1b luật 4).
//
// Payload trả về KHÔNG chứa giá trị secret — `previewImport` đi qua `parseAwsIni`,
// parser vứt secret ngay trong vòng lặp, nên phần secret chỉ còn hai boolean.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import { previewImport } from '../infra/aws/import-export.js'

// Trần của `text`: payload IPC là L1. 1 MiB là trần của chính module nhập; đặt
// lại ở đây để một payload khổng lồ bị chặn TRƯỚC khi đi vào bộ nhớ handler.
const MAX_TEXT = 1024 * 1024

const Params = z.object({
  source: z.enum(['paste', 'file', 'csv']),
  text: z.string().max(MAX_TEXT).optional(),
  path: z.string().max(4096).optional(),
})

// Mã lỗi của tầng nghiệp vụ nằm ở ĐẦU `message` (`TARGET_REQUIRED: …`).
// `throwProfileRpcError` bóc mã đó ra `data.code` và giữ nguyên message; không
// có lớp này thì transport gói mọi thứ thành "Internal error" và UI mất sạch
// đường phân nhánh theo mã — đo được qua smoke test: trước khi có nó,
// `friendlyExportError()` của AwsProfileExport.vue không bao giờ khớp một mã nào.
//
// `return await` chứ KHÔNG `return`: không await thì promise bị từ chối sau khi
// `try` đã thoát, và `catch` ở đây không bao giờ chạy.
register('infra.profile-import-preview', async (raw) => {
  const p = Params.parse(raw)
  try {
    return await previewImport({
      source: p.source,
      ...(p.text !== undefined ? { text: p.text } : {}),
      ...(p.path !== undefined ? { path: p.path } : {}),
    })
  } catch (err) {
    throwProfileRpcError(err)
  }
})
