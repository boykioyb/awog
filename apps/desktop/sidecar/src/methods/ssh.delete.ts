// Delete an SSH host (ADR 0063 P0). Removes the config file AND purges any
// stored password from the keychain (deleteHost handles both) so no orphan
// secret is left behind.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SSH_ID_RE } from '../ssh/schema.js'
import { deleteHost } from '../ssh/store.js'

const Params = z.object({
  id: z.string().regex(SSH_ID_RE),
})

register('ssh.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteHost(params.id)
  return { ok: true }
})
