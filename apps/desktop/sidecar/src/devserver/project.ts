// Giải `projectId` → gốc dự án, cho các RPC `devserver.*`.
//
// Vì sao không nhận thẳng đường dẫn từ payload: một đường dẫn tuỳ ý sẽ cho phép
// đọc `dev-servers.json` ở BẤT KỲ đâu trên máy (kể cả thư mục vừa tải về) rồi khởi
// động lệnh khai trong đó. Gốc dự án luôn do sidecar giải từ store của chính nó.

import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'

export async function resolveProjectRoot(projectId: string): Promise<string> {
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return project.path
}
