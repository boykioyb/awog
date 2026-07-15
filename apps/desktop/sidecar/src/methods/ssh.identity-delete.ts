// Delete an SSH identity (ADR 0063 P0). Removes the config file AND purges any
// stored passphrase / inline key material from the keychain (deleteIdentity
// handles both). Hosts referencing this identity keep the dangling identityId —
// the connect path (P2) surfaces "identity missing" rather than silently
// falling through, so a stale link is visible.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SSH_ID_RE } from '../ssh/schema.js'
import { deleteIdentity } from '../ssh/store.js'

const Params = z.object({
  id: z.string().regex(SSH_ID_RE),
})

register('ssh.identityDelete', async (raw) => {
  const params = Params.parse(raw)
  await deleteIdentity(params.id)
  return { ok: true }
})
