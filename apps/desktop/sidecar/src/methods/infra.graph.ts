// Ba RPC của Graph kiến trúc (Mốc 5) — lớp XÁC THỰC payload IPC.
//
// Mọi lời gọi đi qua `infra/graph/build.ts` → `runGated()` → ma trận quyền → nhật
// ký, y như Explorer và tab Kubernetes. Ba việc ở lại file này đúng một việc: chặn
// payload rác TRƯỚC khi nó thành argv, và dịch kết quả ra hình dạng §3 của hợp đồng.
//
// `surface` CỐ Ý không phải tham số: nó là thuộc tính của TÍNH NĂNG, không phải thứ
// renderer khai. Nếu renderer chọn được `surface` thì một lời gọi từ graph có thể tự
// ghi nhật ký là "explorer" và câu "tuần này graph chạy bao nhiêu lệnh" trả lời sai.
//
// Trả về `blocked` kèm `approvalTicket` khi ma trận nói "hỏi": UI mở hộp duyệt rồi
// gọi lại ĐÚNG payload đó kèm vé. Vé gắn vân tay của lời gọi nên không dùng lại được
// cho lệnh khác, và `requiresApproval: false` nghĩa là UI KHÔNG được mời gọi lại.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { expandInfraGraph, listInfraGraphRoots, resolveInfraGraph } from '../infra/graph/build.js'
import { INFRA_GRAPH_MAX_DEPTH } from '../infra/graph/types.js'

/** Id do sidecar sinh ra, nhưng nó đi VÒNG qua renderer rồi quay lại — vẫn là L1. */
const MAX_ID = 512
const MAX_TICKET = 100
const MAX_SESSION_ID = 200

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Approval = {
  approvalTicket: z.string().max(MAX_TICKET).optional(),
  sessionId: z.string().max(MAX_SESSION_ID).optional(),
  messageId: z.string().max(MAX_SESSION_ID).optional(),
}

// `roots` cũng đi qua cổng quyền nên cũng CÓ THỂ bị chặn: `listInfraGraphRoots` trả
// `blockedOf()` khi ma trận nói "hỏi". Thiếu `...Approval` ở đây thì vé sidecar phát ra
// bị zod gỡ lặng lẽ, lượt gọi lại vẫn không có vé ⇒ hộp duyệt hiện mãi không lối ra.
const RootsParams = z.object({ context: Context, ...Approval })

const ResolveParams = z.object({
  context: Context,
  rootId: z.string().min(1).max(MAX_ID),
  // Trần ở ĐÂY chứ không chỉ trong `build.ts`: một trần chỉ có ở tầng dưới là một
  // trần có thể bị bỏ qua ở tầng trên, và độ sâu là thứ quyết định số lệnh chạy.
  depth: z.number().int().min(0).max(INFRA_GRAPH_MAX_DEPTH).optional(),
  ...Approval,
})

const ExpandParams = z.object({
  context: Context,
  nodeId: z.string().min(1).max(MAX_ID),
  ...Approval,
})

register('infra.graph-roots', async (raw) => {
  const p = RootsParams.parse(raw)
  return listInfraGraphRoots(p)
})

register('infra.graph-resolve', async (raw) => {
  const p = ResolveParams.parse(raw)
  return resolveInfraGraph(p)
})

register('infra.graph-expand', async (raw) => {
  const p = ExpandParams.parse(raw)
  return expandInfraGraph(p)
})
