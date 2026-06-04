// Store a single MCP secret in the OS keychain — ADR 0018.
//
// UI flow:
//   1. User toggles "🔒 Store in keychain" on an env/header row in McpEditor.
//   2. UI prompts for the plaintext value (or reuses what's in the input).
//   3. UI calls `mcp.setSecret({ serverId, key, value })`.
//   4. Sidecar persists to keychain, returns the placeholder string
//      (`secret:KEY`).
//   5. UI swaps the env/header value to that placeholder in the draft.
//   6. User saves → `mcp.upsert` writes the placeholder to disk; plaintext
//      never touches the JSON config.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { MCP_ID_RE } from '../mcp/schema.js'
import { keychainStatus } from '../credentials/keychain.js'
import { persistSecret } from '../mcp/secrets.js'

const Params = z.object({
  serverId: z.string().regex(MCP_ID_RE),
  // Key = the env/header name (or any stable string). UI conventionally
  // passes the env/header key itself so the keychain entry is readable
  // (e.g. account "github/GITHUB_PERSONAL_ACCESS_TOKEN" in Keychain Access).
  key: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, 'key must match [A-Za-z][A-Za-z0-9_.-]*'),
  value: z.string().min(1).max(16_384),
})

register('mcp.setSecret', async (raw) => {
  const params = Params.parse(raw)
  const status = await keychainStatus()
  if (!status.available) {
    throw new RpcError(
      -32024,
      `keychain unavailable: ${status.error ?? 'native binding missing — run \`pnpm install\` in apps/desktop/sidecar'}`,
    )
  }
  const placeholder = await persistSecret(params.serverId, params.key, params.value)
  return { placeholder }
})
