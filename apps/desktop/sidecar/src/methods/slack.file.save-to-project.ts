// slack.file.saveToProject → chép file đính kèm vào GỐC thư mục project. Không
// nhận đường dẫn con từ renderer (UI không dùng) — bớt một input L1 đi vào
// filesystem; đích vẫn qua assertInsideWorkspace (invariant #2). Trùng tên thì
// đánh số, không đè.
import { z } from 'zod'
import { FileIdSchema, OpaqueIdSchema, TeamIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { saveFileToProject } from '../slack/files.js'
import { openSlackSessionForTeam } from '../slack/session.js'

const Params = z.object({
  teamId: TeamIdSchema,
  fileId: FileIdSchema,
  projectId: OpaqueIdSchema,
})

registerSlack('slack.file.saveToProject', async (raw): Promise<{ path: string }> => {
  const p = Params.parse(raw)
  const session = await openSlackSessionForTeam(p.teamId)
  return saveFileToProject(session, p.fileId, p.projectId)
})
