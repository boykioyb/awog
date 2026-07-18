// Delete a VPN profile (ADR 0065 P0). Removes the config file AND purges any
// stored credential from the keychain (deleteProfile handles both) so no orphan
// secret is left behind. (Tearing down a running tunnel is P1 — v1 assumes the
// profile is down when deleted.)

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { VPN_ID_RE } from '../vpn/schema.js'
import { deleteProfile } from '../vpn/store.js'

const Params = z.object({
  id: z.string().regex(VPN_ID_RE),
})

register('vpn.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteProfile(params.id)
  return { ok: true }
})
