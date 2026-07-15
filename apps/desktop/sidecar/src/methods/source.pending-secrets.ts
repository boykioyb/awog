// List the secrets a Source still NEEDS a value for (ADR 0060 P1/P3 — the
// chat-creator secret step). Read-only. After the LLM writes a config.json that
// references credentials as `secret:<KEY>` placeholders (env for stdio, header
// for http), the UI calls this to learn which keychain entries are still empty so
// it can show a secure input instead of the user pasting a token into the chat.
//
// A secret is "pending" when a config value is a whole-value `secret:<KEY>` ref
// AND `getSecret(source.id, KEY)` returns nothing. api-source credentials are out
// of scope here (the chat creator is MCP-only; api sources set their credential in
// the form editor). Invariant 1: only KEY NAMES + field names cross the boundary —
// never a stored secret value.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadSource } from '../sources/store.js'
import { getSecret } from '../credentials/keychain.js'
import { secretKeyFromReference } from '../mcp/secrets.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

// One credential the source declares but the keychain has no value for yet.
// `field` is the env var / header name it fills (for display); `key` is the
// keychain key to write via source.setSecret.
interface PendingSecret {
  key: string
  field: string
}

register('source.pendingSecrets', async (raw) => {
  const { slug } = Params.parse(raw)
  const source = await loadSource(slug)
  if (!source) throw new RpcError(-32602, `source not found: ${slug}`)

  if (source.type !== 'mcp') return { secrets: [] as PendingSecret[] }

  // Collect every `secret:<KEY>` reference across env + headers, de-duped by KEY
  // (a field may reuse a KEY; only ask once). Then keep the ones with no value.
  const records: Record<string, string>[] = []
  if (source.mcp.env) records.push(source.mcp.env)
  if (source.mcp.headers) records.push(source.mcp.headers)

  const seen = new Set<string>()
  const candidates: PendingSecret[] = []
  for (const record of records) {
    for (const [field, value] of Object.entries(record)) {
      const key = secretKeyFromReference(value)
      if (!key || seen.has(key)) continue
      seen.add(key)
      candidates.push({ key, field })
    }
  }

  const secrets: PendingSecret[] = []
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await getSecret(source.id, c.key)
    if (existing === null || existing === '') secrets.push(c)
  }
  return { secrets }
})
