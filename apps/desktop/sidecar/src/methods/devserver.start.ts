import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { DevServerError, startDevServer } from '../devserver/registry.js'
import { resolveProjectRoot } from '../devserver/project.js'

// Khởi động một dev server đã khai, theo tên. ĐÂY là đường của CON NGƯỜI: nó chỉ
// chạy khi người dùng bấm nút trên UI, sau khi đã đọc nguyên văn lệnh (`command`
// trả về từ `devserver.list`). Model KHÔNG đi đường này — tool `dev_server` trả về
// lệnh và bắt model chạy qua `Bash`, tức qua cổng quyền thật.
//
// `confirmCommand` là nguyên văn chuỗi UI đã hiện. Sidecar so lại với chuỗi vừa
// dựng từ file cấu hình; lệch ⇒ từ chối. Nó đóng cửa TOCTOU: file trong repo đổi
// (hoặc `git pull`) giữa lúc người dùng đọc và lúc họ đồng ý.
//
// Đang chạy ⇒ không spawn thêm, trả về cái đang chạy (`outcome: 'already-running'`).
const Params = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  name: z.string().min(1).max(64),
  confirmCommand: z.string().max(4096).optional(),
})

register('devserver.start', async (raw) => {
  const { projectId, sessionId, name, confirmCommand } = Params.parse(raw)
  const projectRoot = await resolveProjectRoot(projectId)
  try {
    return await startDevServer({ projectRoot, sessionId, name, confirmCommand })
  } catch (err) {
    if (err instanceof DevServerError) throw new RpcError(-32602, err.message)
    throw err
  }
})
