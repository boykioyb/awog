// Read a VPN profile's stored credential back so the editor can prefill it (ADR 0065).
//
// DELIBERATE, SCOPED exception to invariant #1 ("secrets never cross the IPC
// boundary"): unlike an LLM provider key (never shown, model-adjacent), a VPN
// username/password is the USER'S OWN credential that they type and manage in their
// own settings — exactly like a password manager reveal. It is returned ONLY here,
// for the editor to prefill, and is still never logged, traced, emitted as an event,
// or sent to a model. The renderer keeps the password/passphrase behind a reveal
// toggle. See ADR 0065 for the rationale.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { VPN_ID_RE } from '../vpn/schema.js'
import { loadVpnCredential } from '../vpn/credentials.js'

const Params = z.object({ id: z.string().regex(VPN_ID_RE) })

interface CredentialView {
  username?: string
  password?: string
  keyPassphrase?: string
}

register('vpn.getCredential', async (raw): Promise<CredentialView> => {
  const { id } = Params.parse(raw)
  const cred = await loadVpnCredential(id)
  if (!cred) return {}
  return {
    ...(cred.username ? { username: cred.username } : {}),
    ...(cred.password ? { password: cred.password } : {}),
    ...(cred.keyPassphrase ? { keyPassphrase: cred.keyPassphrase } : {}),
  }
})
