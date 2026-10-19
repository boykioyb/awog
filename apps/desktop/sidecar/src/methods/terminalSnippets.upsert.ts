import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  MAX_SNIPPET_COMMAND_LEN,
  MAX_SNIPPET_NAME_LEN,
  SNIPPET_ID_RE,
  upsertSnippet,
} from '../terminal/snippets.js'

// Pick đúng field cho phép (không spread payload IPC vào store).
const Params = z.object({
  id: z.string().regex(SNIPPET_ID_RE).optional(),
  name: z.string().min(1).max(MAX_SNIPPET_NAME_LEN),
  command: z.string().min(1).max(MAX_SNIPPET_COMMAND_LEN),
  project: z.string().min(1).max(200).nullable(),
})

register('terminalSnippets.upsert', async (raw) => {
  const p = Params.parse(raw)
  return { snippet: await upsertSnippet({ id: p.id, name: p.name, command: p.command, project: p.project }) }
})
