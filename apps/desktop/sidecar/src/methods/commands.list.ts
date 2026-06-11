import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listCommands } from '../commands/store.js'

const Params = z.object({
  projectIds: z.array(z.string()).optional(),
})

register('commands.list', async (raw) => {
  const params = Params.parse(raw ?? {})
  const { commands, reports } = await listCommands(params.projectIds ?? [])
  return { commands, reports }
})
