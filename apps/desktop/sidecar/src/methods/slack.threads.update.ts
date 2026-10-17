// slack.threads.update → sửa phần người dùng quản lý của thread.
//
// Pick ĐÚNG hai field (title, projectId). Còn lại không cho renderer ghi:
// lastReplyTs/replyCount/error là số liệu đồng bộ từ Slack (UI cũ sẽ đè lùi trạng
// thái poll); sessionId/sessionSyncedTs chỉ slack/session-link.ts quản (dưới khoá
// theo thread) — renderer tự ghi thì mốc "đã giao tới đâu" lệch với thực tế.
import { z } from 'zod'
import { OpaqueIdSchema, ThreadIdSchema } from '../slack/params.js'
import { emitSlackChanged, registerSlack } from '../slack/rpc.js'
import { mutateThread } from '../slack/store.js'
import type { SlackThread } from '../slack/types.js'

const Params = z.object({
  threadId: ThreadIdSchema,
  title: z.string().max(200).nullable().optional(),
  projectId: OpaqueIdSchema.nullable().optional(),
})

registerSlack('slack.threads.update', async (raw): Promise<{ thread: SlackThread }> => {
  const p = Params.parse(raw)
  let changed = false
  const thread = await mutateThread(p.threadId, (t) => {
    const next = { ...t }
    // Tiêu đề rỗng = bỏ tiêu đề, quay về dòng đầu tin gốc.
    if (p.title !== undefined) next.title = p.title?.trim() ? p.title.trim() : null
    if (p.projectId !== undefined) next.projectId = p.projectId
    changed = JSON.stringify(next) !== JSON.stringify(t)
    return changed ? next : null
  })
  if (changed) emitSlackChanged([thread.id])
  return { thread }
})
