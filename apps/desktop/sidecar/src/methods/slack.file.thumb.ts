// slack.file.thumb → thumbnail của file đính kèm dạng data URI. Renderer chỉ
// gửi `teamId + fileId`; URL thumbnail do sidecar tự tra (slack/files.ts).
import { z } from 'zod'
import { FileIdSchema, TeamIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { fileThumb } from '../slack/files.js'
import { openSlackSessionForTeam } from '../slack/session.js'

const Params = z.object({
  teamId: TeamIdSchema,
  fileId: FileIdSchema,
  size: z.union([z.literal(360), z.literal(720)]),
})

registerSlack('slack.file.thumb', async (raw): Promise<{ dataUrl: string }> => {
  const p = Params.parse(raw)
  const session = await openSlackSessionForTeam(p.teamId)
  return { dataUrl: await fileThumb(session, p.fileId, p.size) }
})
