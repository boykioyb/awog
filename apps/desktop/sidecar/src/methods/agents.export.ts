// agents.export — đọc RAW AGENT.md của các agent được chọn, trả về danh sách
// {name, content} để UI zip + lưu qua hộp thoại OS (fs.writeFileBase64). Không
// serialize lại từ Agent object — file gốc giữ nguyên comment/format người
// viết, và re-import vào .awog/agents là y nguyên.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { readAgentRaw } from '../agents/store.js'

const AgentRef = z.object({
  id: z.string().min(1).max(64),
  source: z.enum(['global', 'project']).default('global'),
  projectId: z.string().min(1).max(64).optional(),
})

const Params = z.object({
  agents: z.array(AgentRef).min(1).max(256),
})

register('agents.export', async (raw) => {
  const params = Params.parse(raw)
  const files: { name: string; content: string }[] = []
  const used = new Set<string>()
  for (const ref of params.agents) {
    const content = await readAgentRaw(ref.id, ref.source, ref.projectId)
    if (content === null) continue // agent đã bị xoá giữa lúc chọn → bỏ qua
    // Tên file trong zip luôn là <id>.md; id trùng nhau giữa các tier (global
    // vs project) thì hậu tố -2, -3… giữ đủ cả hai.
    let name = `${ref.id}.md`
    for (let i = 2; used.has(name); i++) name = `${ref.id}-${i}.md`
    used.add(name)
    files.push({ name, content })
  }
  if (!files.length) throw new RpcError(-32021, 'agents.export: no agents found')
  return { files }
})
