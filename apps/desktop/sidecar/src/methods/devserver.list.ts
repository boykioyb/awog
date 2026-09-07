import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listDevServers } from '../devserver/registry.js'
import { resolveProjectRoot } from '../devserver/project.js'

// Danh sách dev server đã khai của một dự án + trạng thái chạy hiện tại
// (docs/features/dev-server.md).
//
// Nhận `projectId` chứ KHÔNG nhận đường dẫn: đường dẫn từ payload sẽ cho phép đọc
// `dev-servers.json` ở bất kỳ đâu trên máy rồi khởi động lệnh trong đó. Gốc dự án
// luôn do sidecar giải từ store.
const Params = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
})

register('devserver.list', async (raw) => {
  const { projectId, sessionId } = Params.parse(raw)
  return listDevServers(await resolveProjectRoot(projectId), sessionId)
})
