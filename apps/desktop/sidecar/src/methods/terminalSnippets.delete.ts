import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SNIPPET_ID_RE, deleteSnippet } from '../terminal/snippets.js'

const Params = z.object({ id: z.string().regex(SNIPPET_ID_RE) })

register('terminalSnippets.delete', async (raw) => {
  const { id } = Params.parse(raw)
  await deleteSnippet(id)
  return { ok: true }
})
