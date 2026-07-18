// Dry-run parse of a .ovpn into a NEW-profile draft (VPN Manager P4). This is a
// READ-ONLY import: it NEVER writes a profile and NEVER returns key/cert material or
// any secret. The path runs through validateOvpnConfig (the root-RCE denylist) first
// — a rejected config throws OvpnValidationError, surfaced here as -32602 so a hostile
// .ovpn can never seed a profile. The returned draft holds only non-secret metadata
// (name / configPath / authMode); the user fills in credentials in the editor, and
// connect-time re-validation still applies (ADR 0065). Not exposed as a model tool.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { deriveOvpnDraft, OvpnValidationError } from '../vpn/ovpn-config.js'
import type { OvpnDraft } from '../vpn/ovpn-config.js'

const Params = z.object({ path: z.string().min(1).max(4096) })

register('vpn.importOvpn', async (raw): Promise<{ draft: OvpnDraft }> => {
  const { path } = Params.parse(raw)
  try {
    return { draft: await deriveOvpnDraft(path) }
  } catch (err) {
    // A rejected config MUST NOT import — surface the (secret-free) reason as an
    // invalid-params error so the UI can toast it verbatim.
    if (err instanceof OvpnValidationError) {
      throw new RpcError(-32602, err.message)
    }
    throw err
  }
})
