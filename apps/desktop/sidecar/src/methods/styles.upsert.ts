// Tạo / sửa một Output Style của người dùng. Cùng khuôn với rules.upsert:
// validate zod ở biên → kiểm tra tồn tại theo `mode` → ghi atomic.
//
// Body đi thẳng vào system prompt nên cap độ dài ngay tại biên (MAX_STYLE_BODY_CHARS),
// và id bị chặn ở 3 giá trị dành riêng (`auto`/`default`/`normal`) để không đổi
// nghĩa meta-style + sentinel "không style".

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import {
  MAX_STYLE_BODY_CHARS,
  isValidStyleId,
  loadUserStyle,
  saveUserStyle,
  type UserStyle,
} from '../style/store.js'

const Params = z.object({
  style: z.object({
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(''),
    body: z.string().trim().min(1).max(MAX_STYLE_BODY_CHARS),
    source: z.enum(['global', 'project']).optional(),
    projectId: z.string().optional(),
  }),
  mode: z.enum(['create', 'update']),
})

register('styles.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.style
  const source = incoming.source ?? 'global'

  if (!isValidStyleId(incoming.id)) {
    throw new RpcError(
      -32602,
      `Invalid style id: ${incoming.id} (lowercase letters, digits, '.', '-', '_'; 'auto'/'default'/'normal' are reserved)`,
    )
  }
  if (source === 'project' && !incoming.projectId) {
    throw new RpcError(-32602, 'Project style requires a projectId')
  }

  const existing = await loadUserStyle(incoming.id, source, incoming.projectId)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `style id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `style not found: ${incoming.id}`)
  }

  const style: UserStyle = {
    id: incoming.id,
    name: incoming.name,
    description: incoming.description,
    body: incoming.body,
    source,
    ...(incoming.projectId ? { projectId: incoming.projectId } : {}),
  }
  await saveUserStyle(style)
  return { style }
})
