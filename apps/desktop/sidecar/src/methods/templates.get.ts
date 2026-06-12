import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { getTemplate } from '../templates/store.js'

const Params = z.object({ id: z.string().min(1).max(120) })

register('templates.get', async (raw) => {
  const { id } = Params.parse(raw)
  const template = await getTemplate(id)
  if (!template) throw new RpcError(-32602, `Template not found: ${id}`)
  return { template }
})
