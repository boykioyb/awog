// Snapshot VPN runtime status (ADR 0065 P1). Merges live runtime states with the
// persisted status of profiles that have no live record; `id` filters to one. The
// wire shape (VpnRuntimeState) NEVER carries ports, pw-file paths, or secrets.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { VPN_ID_RE } from '../vpn/schema.js'
import { vpnStatusStates } from '../vpn/manager.js'
import type { VpnRuntimeState } from '../vpn/manager.js'

const Params = z.object({ id: z.string().regex(VPN_ID_RE).optional() })

register('vpn.status', async (raw): Promise<{ states: VpnRuntimeState[] }> => {
  // `id` is optional, so a no-args call (refreshStatus) arrives as null/undefined —
  // coerce to {} so the whole-inventory snapshot doesn't fail "Invalid params".
  const { id } = Params.parse(raw ?? {})
  return { states: await vpnStatusStates(id) }
})
