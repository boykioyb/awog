// Store a single Source secret in the OS keychain (ADR 0060 P1 / ADR 0018).
// Successor to mcp.setSecret. Keeps the SAME keychain layout (group `awog-mcp`,
// account `<sourceId>/<key>`) so tokens saved before migration keep resolving.
//
// UI flow (unchanged from mcp): user marks an env/header row as a secret →
// source.setSecret persists the plaintext to the keychain and returns the
// `secret:KEY` placeholder → the UI swaps it into the draft → source.upsert
// writes only the placeholder (plaintext never touches the JSON config).

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SOURCE_ID_RE } from '../sources/schema.js'
import { keychainStatus } from '../credentials/keychain.js'
import { persistSecret } from '../mcp/secrets.js'

const Params = z.object({
  // The source's stable id (keychain account prefix), NOT the slug — matches the
  // id env/headers are expanded against at connect time.
  sourceId: z.string().regex(SOURCE_ID_RE),
  key: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, 'key must match [A-Za-z][A-Za-z0-9_.-]*'),
  value: z.string().min(1).max(16_384),
})

register('source.setSecret', async (raw) => {
  const params = Params.parse(raw)
  const status = await keychainStatus()
  if (!status.available) {
    throw new RpcError(
      -32024,
      `keychain unavailable: ${status.error ?? 'native binding missing — run \`pnpm install\` in apps/desktop/sidecar'}`,
    )
  }
  const placeholder = await persistSecret(params.sourceId, params.key, params.value)
  return { placeholder }
})
