import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { setHookTrust } from '../hooks/store.js'
import { invalidateHookCache } from '../hooks/dispatcher.js'

// Grant trust to project-tier hooks (ADR 0032 D-8). Global hooks need no entry.
//
// Payload là L1 không tin và cố ý KHÔNG mang đường dẫn: chỉ `projectId`, còn
// sidecar tự giải ra `project.path` qua `loadProject` (invariant #2/#3 —
// `.claude/rules/security.md`). Nhờ vậy một payload dựng tay không chỉ được nơi
// ghi bản ghi trust, và cũng không chọn được project nào ngoài những project
// người dùng đã thêm.
//
// Giới hạn độ dài: danh sách này được ghi thẳng vào AWOG home, nên một payload
// dựng tay không được phép làm phình file trust.
const MAX_HOOK_IDS = 500
const MAX_ID_LEN = 200

const Params = z.object({
  projectId: z.string().min(1).max(MAX_ID_LEN),
  hookIds: z.array(z.string().min(1).max(MAX_ID_LEN)).max(MAX_HOOK_IDS),
})

register('hooks.trust', async (raw) => {
  const params = Params.parse(raw)
  await setHookTrust(params.projectId, params.hookIds)
  invalidateHookCache()
  return { trusted: params.hookIds }
})
