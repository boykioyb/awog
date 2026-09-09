import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteProject } from '../projects/store.js'
import { forgetProjectPath } from '../sessions/permission-rules.js'

const Params = z.object({
  id: z.string().min(1),
})

// Logical delete only: removes ~/.awog/projects/<id>.json. The codebase folder
// on disk (project.path) is never touched — that is the user's data.
register('projects.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteProject(params.id)
  // Xoá luôn bản cache đường dẫn của cổng quyền: một project mới trùng id (id do
  // UI đặt) mà đọc lại path cũ thì luật neo vào thư mục của project đã xoá.
  forgetProjectPath(params.id)
  return { ok: true }
})
