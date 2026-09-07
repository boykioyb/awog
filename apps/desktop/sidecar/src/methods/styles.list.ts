// Danh sách style cho UI: style DỰNG SẴN (kèm directive, để xem trước) + style
// người dùng tự viết ở 2 tier. Hợp nhất do UI làm: cùng id thì bản người dùng
// thắng — đúng thứ tự resolveDirective() dùng khi build prompt.
//
// Directive chảy sidecar → UI ở đây là để XEM TRƯỚC. Chiều ngược lại không đổi:
// lúc chạy, UI vẫn chỉ gửi `styleId` + cờ no-markdown, KHÔNG bao giờ gửi text
// prompt — nên vẫn không có bề mặt prompt-injection từ payload UI.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listUserStyles } from '../style/store.js'
import { AUTO_STYLE_ID, STYLE_DIRECTIVES } from '../style/styles.js'

const Params = z.object({
  projectIds: z.array(z.string()).optional(),
})

register('styles.list', async (raw) => {
  const params = Params.parse(raw ?? {})
  const { styles, reports } = await listUserStyles(params.projectIds ?? [])
  const builtIn = Object.entries(STYLE_DIRECTIVES)
    .map(([id, directive]) => ({ id, directive }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return { builtIn, autoStyleId: AUTO_STYLE_ID, styles, reports }
})
