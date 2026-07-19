// Read an SSH host's (or identity's) stored secret back so the editor can prefill it.
//
// DELIBERATE, SCOPED exception to invariant #1 (mirrors vpn.getCredential): unlike an
// LLM provider key (never shown, model-adjacent), an SSH password / key passphrase is
// the USER'S OWN login that they type and manage in their own settings — exactly like a
// password manager reveal. It is returned ONLY here, for the editor to prefill, and is
// still never logged, traced, emitted as an event, or sent to a model. The renderer
// keeps it behind a reveal toggle. See ADR 0063 for the rationale.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { SSH_ID_RE } from '../ssh/schema.js'
import { loadSshCredential } from '../ssh/credentials.js'

const Params = z.object({
  scope: z.enum(['host', 'identity']),
  id: z.string().regex(SSH_ID_RE),
})

interface CredentialView {
  password?: string
  passphrase?: string
  privateKey?: string
}

register('ssh.getCredential', async (raw): Promise<CredentialView> => {
  const { scope, id } = Params.parse(raw)
  const cred = await loadSshCredential(scope, id)
  if (!cred) return {}
  switch (cred.type) {
    case 'password':
      return { password: cred.password }
    case 'passphrase':
      return { passphrase: cred.passphrase }
    case 'inline-key':
      return {
        privateKey: cred.privateKey,
        ...(cred.passphrase ? { passphrase: cred.passphrase } : {}),
      }
  }
})
