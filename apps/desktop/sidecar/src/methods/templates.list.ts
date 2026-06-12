import { register } from '../transport/rpc.js'
import { listTemplates } from '../templates/store.js'

register('templates.list', async () => {
  const templates = await listTemplates()
  return { templates }
})
