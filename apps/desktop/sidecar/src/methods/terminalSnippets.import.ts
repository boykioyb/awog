import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { MAX_SNIPPETS, importSnippets } from '../terminal/snippets.js'

// Một lần: thư viện cũ trong localStorage của renderer → file của sidecar. Từng entry
// được validate lại trong importSnippets (payload IPC là L1).
const Params = z.object({ snippets: z.array(z.unknown()).max(MAX_SNIPPETS) })

register('terminalSnippets.import', async (raw) => {
  const { snippets } = Params.parse(raw)
  return importSnippets(snippets)
})
