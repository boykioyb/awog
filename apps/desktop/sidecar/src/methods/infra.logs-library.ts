// `infra.logs-library` — mẫu sẵn · câu đã lưu · lịch sử (Mốc 2 việc 2.4).
//
// MỘT RPC, BỐN HÀNH ĐỘNG, phân nhánh bằng `action` — thay vì bốn method gần giống
// nhau. Lý do: cả bốn đọc/ghi CÙNG một file (`~/.awog/infra/logs/queries.json`), và
// tách ra thành bốn method thì bốn chỗ đó có bốn cơ hội để quên `chmod`/`rename`
// nguyên tử.
//
// `action: 'list'` là đường ĐỌC, an toàn để gọi lúc mở màn. Ba hành động còn lại
// đều là NGƯỜI DÙNG vừa bấm (Lưu / Xoá / Dọn lịch sử) và ghi đĩa.
//
// Bề mặt của CON NGƯỜI. Không AgentTool nào gọi method này — agent không được ghi
// vào thư viện của người dùng.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { throwProfileRpcError } from '../infra/aws/profile-ops.js'
import {
  LOG_QUERY_TEMPLATES,
  clearHistory,
  deleteSavedQuery,
  readLibrary,
  saveQuery,
} from '../infra/logs/library.js'

const Params = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({
    action: z.literal('save'),
    name: z.string().min(1).max(120),
    query: z.string().min(1).max(4096),
    logGroups: z.array(z.string().min(1).max(512)).max(25),
    windowSeconds: z.number().int().positive().max(30 * 24 * 3600),
    id: z.string().min(1).max(64).optional(),
  }),
  z.object({ action: z.literal('delete'), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal('clear-history') }),
])

register('infra.logs-library', async (raw) => {
  const p = Params.parse(raw)
  try {
    switch (p.action) {
      case 'list': {
        const library = await readLibrary()
        // Mẫu sẵn đi kèm MỌI lượt `list`: chúng là hằng số trong code, không phải
        // dữ liệu trên đĩa, nên không có lý do gì để UI phải biết hai nguồn.
        return { ok: true as const, templates: LOG_QUERY_TEMPLATES, ...library }
      }
      case 'save': {
        const entry = await saveQuery({
          name: p.name,
          query: p.query,
          logGroups: p.logGroups,
          windowSeconds: p.windowSeconds,
          ...(p.id !== undefined ? { id: p.id } : {}),
        })
        return { ok: true as const, saved: entry }
      }
      case 'delete':
        return { ok: true as const, ...(await deleteSavedQuery(p.id)) }
      case 'clear-history':
        return { ok: true as const, ...(await clearHistory()) }
    }
  } catch (err) {
    // Mã lỗi nghiệp vụ (`TOO_MANY_SAVED: …`) nằm ở đầu `message`; helper này bóc
    // nó ra `data.code` để UI hiện câu đã dịch thay vì nguyên văn tiếng Anh.
    throwProfileRpcError(err)
  }
})
