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
import { saveApiCredential, type ApiCredential } from '../sources/api-credentials.js'

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

// Map the request mode + fields onto the stored ApiCredential union, failing
// fast when the required field(s) for the mode are missing.
function toCredential(p: z.infer<typeof Params>): ApiCredential {
  switch (p.mode) {
    case 'bearer':
    case 'header':
    case 'query':
      if (p.value === undefined) {
        throw new RpcError(-32602, `mode "${p.mode}" requires a "value"`)
      }
      return { type: 'value', value: p.value }
    case 'basic':
      if (p.username === undefined || p.password === undefined) {
        throw new RpcError(-32602, 'mode "basic" requires "username" and "password"')
      }
      return { type: 'basic', username: p.username, password: p.password }
    case 'multi-header':
      if (!p.headers || Object.keys(p.headers).length === 0) {
        throw new RpcError(-32602, 'mode "multi-header" requires a non-empty "headers" map')
      }
      return { type: 'multi-header', headers: p.headers }
  }
}

register('source.setApiCredential', async (raw) => {
  const params = Params.parse(raw)
  const status = await keychainStatus()
  if (!status.available) {
    throw new RpcError(
      -32024,
      `keychain unavailable: ${status.error ?? 'native binding missing — run \`pnpm install\` in apps/desktop/sidecar'}`,
    )
  }
  await saveApiCredential(params.sourceId, toCredential(params))
  // Status only — never echo the secret (invariant 1).
  return { ok: true }
})
