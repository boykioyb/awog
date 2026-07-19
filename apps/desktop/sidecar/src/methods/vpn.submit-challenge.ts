// Answer a pending VPN MFA/OTP challenge (ADR 0065). The user-entered code travels
// UI → sidecar → openvpn's management socket ONLY; it is never echoed back, logged, or
// persisted (invariant #1). No-op-safe: throws -32602 if no challenge is pending.
// Not exposed as a model tool (ADR 0065 §9).

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { VPN_ID_RE } from '../vpn/schema.js'
import { vpnManager } from '../vpn/manager.js'

// The code is L1-untrusted but short — a one-time authenticator value. Cap the length
// (the manager \r\n-strips + encodes it before it reaches the control channel).
const Params = z.object({
  id: z.string().regex(VPN_ID_RE),
  code: z.string().min(1).max(256),
})

register('vpn.submitChallenge', (raw): { ok: true } => {
  const { id, code } = Params.parse(raw)
  try {
    vpnManager.submitChallenge(id, code)
  } catch (err) {
    if (err instanceof RpcError) throw err
    throw new RpcError(-32021, err instanceof Error ? err.message : String(err))
  }
  return { ok: true }
})
