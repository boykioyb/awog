import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { listSessionSummaries } from '../sessions/store.js'
import { memberDiff } from '../tasks/worktree.js'

// `sessions.memberDiff` — diff stat + bounded diff của một member trong nhóm
// (Session Teams, docs/features/session-teams.md §5/§7). Đây là đường UI
// (chip "±n files" trên roster + popover review); model có tool `member_diff`
// đọc cùng một nguồn (runtime/tools/member-tools.ts).
//
// `id` là L1 (IPC từ UI) đi vào sink đường dẫn gián tiếp qua store phiên nên
// siết cùng charset với sessions.delete / sessions.setGroup.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({ id: z.string().min(1).regex(SESSION_ID_RE) })

register('sessions.memberDiff', async (raw) => {
  const params = Params.parse(raw)
  const session = (await listSessionSummaries()).find((s) => s.id === params.id)
  if (!session) throw new RpcError(-32004, 'Session not found')
  // worktree vắng (member trên cây chung / phiên lẻ) hoặc diff không đọc
  // được ⇒ 404: từ phía UI hai trường hợp này giống nhau — không có gì để hiện.
  const result = await memberDiff(session)
  if (!result) {
    throw new RpcError(-32004, 'That member works on the shared tree — there is no branch to diff')
  }
  return result
})
