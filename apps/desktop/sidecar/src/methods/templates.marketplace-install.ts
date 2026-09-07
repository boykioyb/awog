// Cài một template từ danh mục (gói #37) — ghi bundle vào ~/.awog/templates/.
//
// `token` là bằng chứng đã qua màn hình đồng ý: nó băm kế hoạch mà
// `templates.marketplaceInspect` vừa trả (entity + từng file + blob sha). Engine
// lập lại kế hoạch rồi so; lệch ⇒ KHÔNG ghi gì và trả `status: 'changed'` kèm bản
// kiểm tra mới để UI hỏi lại. Bước đồng ý vì thế là ràng buộc của ENGINE, không
// phải quy ước vẽ trên giao diện.
//
// Cài xong KHÔNG có entity nào vào project và KHÔNG có hook nào chạy: bundle chỉ
// nằm trong thư viện template. Đưa vào project là bước riêng (`templates.install`
// → tier project ⇒ hook untrusted, ADR 0032 D-8).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { installEntry } from '../templates/marketplace.js'

const Params = z.object({
  id: z.string().min(1).max(120),
  token: z.string().min(1).max(128),
  overwrite: z.boolean().optional(),
})

register('templates.marketplaceInstall', async (raw) => {
  const p = Params.parse(raw)
  const result = await installEntry(p.id, p.token, p.overwrite ?? false)
  return { result }
})
