// MCP secret expansion + extraction helpers — see ADR 0018.
//
// Storage syntax: a value starting with `secret:` is treated as a keychain
// reference. The substring after the prefix is the keychain key (account
// component). Example:
//
//   env: { GITHUB_PAT: "secret:GITHUB_PAT" }
//
// → lookup `getSecret(serverId, "GITHUB_PAT")` at use time.
//
// Two flows:
//   - extractSecrets: called by mcp/store.ts saveServer BEFORE writing JSON.
//     Caller-side has already split which entries are secret (UI marks them).
//     This module just does the keychain write + returns the redacted shape.
//   - expandSecrets: called by McpManager/sessions.send-message JUST BEFORE
//     passing the env/headers to the spawned process / SDK / fetch. Looks up
//     each `secret:KEY` value, substitutes plaintext.

import { deleteSecret, getSecret, setSecret } from '../credentials/keychain.js'
import { log } from '../util/logger.js'

const PREFIX = 'secret:'

export function isSecretReference(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function secretKeyFromReference(value: string): string | null {
  if (!isSecretReference(value)) return null
  const key = value.slice(PREFIX.length).trim()
  return key.length > 0 ? key : null
}

export function makeReference(key: string): string {
  return `${PREFIX}${key}`
}

// Persist a single secret to OS keychain and return the placeholder to write
// to the JSON config. Throws on keychain failure (callers wrap in try/catch).
export async function persistSecret(
  serverId: string,
  key: string,
  plaintext: string,
): Promise<string> {
  await setSecret(serverId, key, plaintext)
  return makeReference(key)
}

// Look up every `secret:KEY` placeholder in `record` and return a new object
// with plaintext substituted. Plain values pass through. Missing keychain
// entries are logged and replaced with empty string (so the spawn/fetch
// proceeds — the upstream call will fail loudly with "missing token" which
// is clearer than crashing with a Node error).
export async function expandSecrets(
  serverId: string,
  record: Record<string, string> | undefined,
): Promise<Record<string, string>> {
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(record)) {
    if (!isSecretReference(value)) {
      out[name] = value
      continue
    }
    const key = secretKeyFromReference(value)
    if (!key) {
      out[name] = ''
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    const secret = await getSecret(serverId, key)
    if (secret === null) {
      log.warn('mcp/secrets: missing keychain entry, passing empty string', {
        serverId,
        key,
      })
      out[name] = ''
      continue
    }
    out[name] = secret
  }
  return out
}

// Cleanup all keychain entries referenced by env + headers of a server. Used
// by mcp.delete to avoid orphan entries. Best-effort — failures logged but
// don't block the delete RPC.
export async function purgeServerSecrets(
  serverId: string,
  env: Record<string, string> | undefined,
  headers: Record<string, string> | undefined,
): Promise<void> {
  const candidates: string[] = []
  for (const value of Object.values(env ?? {})) {
    const key = secretKeyFromReference(value)
    if (key) candidates.push(key)
  }
  for (const value of Object.values(headers ?? {})) {
    const key = secretKeyFromReference(value)
    if (key) candidates.push(key)
  }
  for (const key of candidates) {
    // eslint-disable-next-line no-await-in-loop
    await deleteSecret(serverId, key).catch((err: unknown) => {
      log.warn('mcp/secrets: purge failed for entry', {
        serverId,
        key,
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }
}

// Migration helper: when user toggles a value from plaintext to secret in the
// UI, we receive the plaintext + the intended keychain key. Persist + return
// the placeholder. Called from mcp.upsert before saveServer.
//
// Reverse direction (secret → plaintext) is handled by the UI doing
// expandSecrets first, then sending the expanded value as plaintext on save.
export async function plaintextToSecret(
  serverId: string,
  key: string,
  plaintext: string,
): Promise<string> {
  return persistSecret(serverId, key, plaintext)
}
