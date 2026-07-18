// Bring a VPN profile up (ADR 0065 P1). PARKS on the admin/UAC prompt + tunnel
// readiness (may take seconds). Idempotent if already up/connecting. Throws
// "OpenVPN unavailable" (+ install hint) if the binary is missing, -32602 if the
// profile is missing, and rejects on prompt-cancel / auth-fail with a sanitized
// message. Not exposed as a model tool (ADR 0065 §9).

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { VPN_ID_RE } from '../vpn/schema.js'
import { vpnManager } from '../vpn/manager.js'
import type { VpnRuntimeStatus } from '../vpn/manager.js'

const Params = z.object({ id: z.string().regex(VPN_ID_RE) })

register('vpn.up', async (raw): Promise<{ status: VpnRuntimeStatus }> => {
  const { id } = Params.parse(raw)
  try {
    return await vpnManager.up(id)
  } catch (err) {
    if (err instanceof RpcError) throw err
    // Surface the REAL reason to the UI ("OpenVPN unavailable — …", an
    // elevation/auth failure) instead of the generic "Internal error" (-32603)
    // that the dispatch layer would wrap a plain Error into.
    throw new RpcError(-32021, err instanceof Error ? err.message : String(err))
  }
})
