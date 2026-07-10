// Store a Source's api credential in the OS keychain (ADR 0060 D-4, P3).
// Companion to source.setSecret (which handles MCP `secret:KEY` env/header
// refs); this handles the single secret an `api` source authenticates with.
//
// The secret NEVER touches config.json and is NEVER echoed back — the RPC
// returns only { ok }. Modes mirror Craft's CredentialInputMode
// (bearer/header/query/basic/multi-header); bearer/header/query collapse to a
// single-value credential, basic to username/password, multi-header to a
// header→value map. The api tool builder reads the stored value fresh per call
// (sources/api-tools.ts) so a re-save takes effect on the next tool call.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SOURCE_ID_RE } from '../sources/schema.js'
import { keychainStatus } from '../credentials/keychain.js'
import { buildApiCredential, saveApiCredential } from '../sources/api-credentials.js'

const Params = z.object({
  // The source's stable id (keychain account), NOT the slug — matches the id the
  // api tool reads the credential against at call time.
  sourceId: z.string().regex(SOURCE_ID_RE),
  mode: z.enum(['bearer', 'header', 'query', 'basic', 'multi-header']),
  // bearer / header / query: a single secret string.
  value: z.string().min(1).max(16_384).optional(),
  // basic: username + password.
  username: z.string().min(1).max(1_024).optional(),
  password: z.string().min(1).max(16_384).optional(),
  // multi-header: header name → value (each value a secret).
  headers: z.record(z.string().min(1).max(200), z.string().min(1).max(16_384)).optional(),
})

register('source.setApiCredential', async (raw) => {
  const params = Params.parse(raw)
  const status = await keychainStatus()
  if (!status.available) {
    throw new RpcError(
      -32024,
      `keychain unavailable: ${status.error ?? 'native binding missing — run \`pnpm install\` in apps/desktop/sidecar'}`,
    )
  }
  let cred
  try {
    cred = buildApiCredential(params.mode, params)
  } catch (err) {
    throw new RpcError(-32602, err instanceof Error ? err.message : String(err))
  }
  await saveApiCredential(params.sourceId, cred)
  // Status only — never echo the secret (invariant 1).
  return { ok: true }
})
