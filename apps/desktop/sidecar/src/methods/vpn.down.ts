// Bring a VPN profile down (ADR 0065 P1). Sends `signal SIGTERM` over the
// management socket + cleans up runtime files; no-op if already down. Not exposed
// as a model tool (ADR 0065 §9).

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { VPN_ID_RE } from '../vpn/schema.js'
import { vpnManager } from '../vpn/manager.js'

const Params = z.object({ id: z.string().regex(VPN_ID_RE) })

register('vpn.down', async (raw): Promise<{ ok: true }> => {
  const { id } = Params.parse(raw)
  try {
    await vpnManager.down(id)
  } catch (err) {
    if (err instanceof RpcError) throw err
    throw new RpcError(-32021, err instanceof Error ? err.message : String(err))
  }
  return { ok: true }
})
