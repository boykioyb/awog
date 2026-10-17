// slack.file.fetch → tải file gốc về cache `~/.awog/slack/files/` (trần 200 MB)
// và trả đường dẫn tuyệt đối để xem trước (`media://`) / mở bằng app mặc định.
// Đã có trong cache thì trả ngay và chạm mtime (mốc dọn 30 ngày).
import { z } from 'zod'
import { FileIdSchema, TeamIdSchema } from '../slack/params.js'
import { registerSlack } from '../slack/rpc.js'
import { fetchFile, type FetchedFile } from '../slack/files.js'
import { openSlackSessionForTeam } from '../slack/session.js'

const Params = z.object({ teamId: TeamIdSchema, fileId: FileIdSchema })

registerSlack('slack.file.fetch', async (raw): Promise<FetchedFile> => {
  const p = Params.parse(raw)
  const session = await openSlackSessionForTeam(p.teamId)
  return fetchFile(session, p.fileId)
})
