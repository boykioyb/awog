// Liệt kê ngữ cảnh hạ tầng khả dụng (ADR 0088 §1, §7). Hiện chỉ có nhánh AWS:
// đọc metadata profile từ `~/.aws/{config,credentials}`.
//
// Payload trả về KHÔNG bao giờ chứa giá trị secret — `infra/aws/ini.ts` vứt chúng
// ngay trong vòng lặp parse, ở đây chỉ còn `hasStaticKeys` / `hasSessionToken`
// dạng boolean (invariant #1).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listAwsProfiles } from '../infra/aws/profiles.js'

const Params = z
  .object({
    tool: z.enum(['aws', 'terraform', 'kubectl']).default('aws'),
  })
  .default({ tool: 'aws' })

register('infra.contexts', async (raw) => {
  const p = Params.parse(raw ?? {})
  // terraform/kubectl có nhà riêng cho ngữ cảnh (thư mục `.tf`, `~/.kube/config`)
  // — sẽ nối ở Mốc 8. Trả mảng rỗng thay vì ném, để UI hiện trạng thái rỗng có
  // hướng dẫn chứ không phải một thông báo lỗi.
  if (p.tool !== 'aws') return { tool: p.tool, contexts: [] }
  return { tool: 'aws', contexts: await listAwsProfiles() }
})
