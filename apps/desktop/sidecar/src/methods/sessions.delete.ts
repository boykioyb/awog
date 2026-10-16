import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteSessionCascade } from '../sessions/delete-cascade.js'
import { loadSession } from '../sessions/store.js'
import { detachSessionFromIssue } from '../boards/session-issue.js'

// Session ids are slugs: legacy `ses-<n>` and the current
// `YYMMDD-adjective-noun-tail`. Bounded here as well as in `sanitizeChild`,
// because this id addresses a directory that gets removed recursively.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
})

register('sessions.delete', async (raw) => {
  const params = Params.parse(raw)
  // Chụp header TRƯỚC khi xoá — issue của phiên sống tiếp (lịch sử việc dài hơn
  // phiên đã làm nó), chỉ gỡ assignee + ghi vạch "session deleted". Sau cascade
  // để một CLI còn sống chặn xoá (-32021) không để lại vạch giả.
  // (loadSession, không phải summary: cascade bên dưới cũng nạp phiên này để gỡ
  // artefact SDK, nên bản ấm đã có sẵn.)
  const header = await loadSession(params.id)
  await deleteSessionCascade(params.id)
  if (header) await detachSessionFromIssue(header, 'deleted')
  return { ok: true }
})
