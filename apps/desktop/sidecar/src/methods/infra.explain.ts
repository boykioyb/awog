// infra.explain → diễn giải một lệnh hạ tầng cho hộp duyệt (ADR 0088 §5).
// Vỏ mỏng quanh `runtime/explain-command.ts`; chỗ đó giữ toàn bộ lý do và hàng rào.
//
// Người gọi (thẻ duyệt) tự giải provider/model/account như mọi one-shot khác, nên
// method này không đọc settings — nó đứng ngoài vòng đời phiên và không giữ state.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { explainCommand, type CommandExplanation } from '../runtime/explain-command.js'

const Params = z.object({
  command: z.string().min(1).max(20_000),
  tool: z.string().min(1).max(80),
  commandClass: z.enum(['read', 'write', 'destructive', 'context-switch']),
  profile: z.string().max(200).optional(),
  region: z.string().max(80).optional(),
  context: z.string().max(200).optional(),
  namespace: z.string().max(200).optional(),
  shell: z.boolean().optional(),
  lang: z.string().min(1).max(80),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
})

register('infra.explain', async (raw): Promise<CommandExplanation> => {
  const params = Params.parse(raw)
  return explainCommand(params)
})
