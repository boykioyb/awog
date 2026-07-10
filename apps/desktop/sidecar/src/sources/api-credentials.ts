// API-source credential persistence — ADR 0060 D-4, P3.
//
// A REST `api` source authenticates with a single secret: a bearer token, an
// api-key header/query value, a set of header→value pairs (multi-header), or an
// HTTP Basic username/password. Like the MCP env/header secrets (mcp/secrets.ts)
// and the OAuth token bundle (sources/oauth-store.ts), the secret lives ONLY in
// the OS keychain — never in config.json, an RPC payload/response, or a log line
// (invariant 1).
//
// A DISTINCT service namespace (`awog-source-api`, account = source id) keeps it
// from ever colliding with the `awog-mcp` env/header secrets or the
// `awog-source-oauth` token bundles. One keychain entry per source holds the
// credential as a tagged-union JSON blob.
//
// The api tool builder (sources/api-tools.ts) reads this FRESH on every call so a
// mid-session credential update takes effect without restarting the tool
// (mirrors Craft's per-request credential getter in server-builder.ts).

import { deleteKeychainValue, getKeychainValue, setKeychainValue } from '../credentials/keychain.js'
import { log } from '../util/logger.js'

// Keychain service group for api-source credentials (distinct from `awog-mcp`
// and `awog-source-oauth`).
const API_SERVICE = 'awog-source-api'

// The persisted credential shape. `value` covers bearer / single api-key header /
// query param (a lone secret string); `basic` covers HTTP Basic auth;
// `multi-header` covers a set of header→value pairs (authType 'header' with
// headerNames). Mirrors Craft's ApiCredential (string | BasicAuthCredential |
// MultiHeaderCredential) as a tagged union so a keychain read narrows safely.
export type ApiCredential =
  | { type: 'value'; value: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'multi-header'; headers: Record<string, string> }

function isApiCredential(v: unknown): v is ApiCredential {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  switch (c.type) {
    case 'value':
      return typeof c.value === 'string'
    case 'basic':
      return typeof c.username === 'string' && typeof c.password === 'string'
    case 'multi-header':
      return typeof c.headers === 'object' && c.headers !== null
    default:
      return false
  }
}

// Load the stored credential for a source id, or null if none is stored / the
// entry is corrupt. Never throws — a keychain miss is a normal "no credential".
export async function loadApiCredential(id: string): Promise<ApiCredential | null> {
  const raw = await getKeychainValue(API_SERVICE, id)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isApiCredential(parsed)) {
      log.warn('sources/api: stored credential has unexpected shape', { id })
      return null
    }
    return parsed
  } catch (err) {
    log.warn('sources/api: failed to parse stored credential', {
      id,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Persist the credential for a source id. Throws only if the keychain binding is
// unavailable (callers surface that as a clear error). The secret value never
// enters a log line.
export async function saveApiCredential(id: string, cred: ApiCredential): Promise<void> {
  await setKeychainValue(API_SERVICE, id, JSON.stringify(cred))
}

// Remove the stored credential for a source id (best-effort). Wired into
// source.delete so a deleted api source leaves no orphan secret behind.
export async function deleteApiCredential(id: string): Promise<boolean> {
  return deleteKeychainValue(API_SERVICE, id)
}

// True when a credential is stored for the source (does NOT read the value).
// Used by source.test to decide needs_auth vs a live probe.
export async function hasApiCredential(id: string): Promise<boolean> {
  return (await getKeychainValue(API_SERVICE, id)) !== null
}
