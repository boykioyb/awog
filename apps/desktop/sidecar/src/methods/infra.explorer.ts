// `infra.explorer-catalog` — metadata tĩnh của Explorer (task 3.1, 3.8).
//
// MỘT ĐƯỜNG TẢI CHO CẢ HAI VIỆC. UI cần biết: có những view nào (cột, hành động,
// form, có chi tiết hay không) VÀ danh mục Dịch vụ (nhóm, ba mức hỗ trợ, deep
// link Console, ghim sẵn). Tách thành hai RPC nghĩa là hai lần hỏng, hai lần
// loading, và một trạng thái "danh mục có nhưng view chưa" không ai muốn gỡ.
//
// RPC này KHÔNG chạy CLI và KHÔNG đọc đĩa: nó chỉ serialize các hằng số đã khai
// trong `infra/resources/`. Nhờ vậy mở `/infra` không tốn một lời gọi AWS nào
// (đúng luật "không auto-refresh" của spec), và màn Dịch vụ hiện được ngay cả khi
// `aws` chưa cài.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { allDescriptors } from '../infra/resources/registry.js'
import {
  DEFAULT_PINNED,
  KUBERNETES_ENTRY,
  SERVICE_GROUPS,
  catalogFor,
} from '../infra/resources/services-catalog.js'

const Params = z.object({
  /** Region hiện hành để bơm vào deep link Console. Dịch vụ toàn cầu bỏ qua nó. */
  region: z.string().max(64).default(''),
})

register('infra.explorer-catalog', async (raw) => {
  const p = Params.parse(raw)
  return {
    views: allDescriptors(),
    groups: SERVICE_GROUPS,
    services: [...catalogFor(p.region), KUBERNETES_ENTRY],
    defaultPinned: DEFAULT_PINNED,
  }
})
