// OAuth token persistence for remote (http) MCP sources — ADR 0060 D-4, P2.
//
// The confirmed divergence from Craft: instead of Craft's self-encrypted
// `credentials.enc`, AWOG stores the OAuth token bundle in the OS keychain
// (invariant 1 — credentials never leave the sidecar, never touch config.json
// or any file). A DISTINCT service namespace (`awog-source-oauth`, account =
// source `id`) keeps these tokens from ever colliding with the `secret:KEY`
// env/header secrets, which live under service `awog-mcp` (mcp/secrets.ts).
//
// One keychain entry per source holds the whole bundle as a JSON blob. The
// token strings NEVER appear in a log line or an RPC payload — only the derived
// `connectionStatus` / `isAuthenticated` is surfaced to the UI.

import { deleteKeychainValue, getKeychainValue, setKeychainValue } from '../credentials/keychain.js'
import { log } from '../util/logger.js'

// Keychain service group for source OAuth tokens (distinct from `awog-mcp`).
const OAUTH_SERVICE = 'awog-source-oauth'

// The persisted OAuth token bundle. `expiresAt` is epoch ms; `clientId` is the
// (non-secret) OAuth client id used for refresh (may be a dynamically
// registered id or a fixed public-client id).
export interface OAuthTokenBundle {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  clientId?: string
  tokenType?: string
}

// Refresh when the access token is within this window of expiry (5 min) — a
// buffer so a token doesn't expire mid-handshake.
const REFRESH_WINDOW_MS = 5 * 60 * 1000

function isBundle(value: unknown): value is OAuthTokenBundle {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.accessToken === 'string' && v.accessToken.length > 0
}

// Load the token bundle for a source id, or null if none is stored / the entry
// is corrupt. Never throws — a keychain miss is a normal "not authenticated".
export async function loadToken(id: string): Promise<OAuthTokenBundle | null> {
  const raw = await getKeychainValue(OAUTH_SERVICE, id)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isBundle(parsed)) {
      log.warn('sources/oauth: stored token bundle has unexpected shape', { id })
      return null
    }
    return parsed
  } catch (err) {
    log.warn('sources/oauth: failed to parse stored token bundle', {
      id,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// Persist the token bundle for a source id. Throws only if the keychain binding
// is unavailable (callers surface that as a clear auth error).
export async function saveToken(id: string, bundle: OAuthTokenBundle): Promise<void> {
  await setKeychainValue(OAUTH_SERVICE, id, JSON.stringify(bundle))
}

// Remove the stored token bundle for a source id (best-effort). Wired into
// source.delete so a deleted source leaves no orphan token behind.
export async function deleteToken(id: string): Promise<boolean> {
  return deleteKeychainValue(OAUTH_SERVICE, id)
}

// True when the token is past its expiry (no expiry → never "expired").
export function isTokenExpired(bundle: OAuthTokenBundle): boolean {
  if (typeof bundle.expiresAt !== 'number') return false
  return Date.now() > bundle.expiresAt
}

// True when the token is expired OR within the 5-min refresh window. A bundle
// with no expiry can't be reasoned about → treat as needing refresh so the next
// refresh writes a proper expiresAt (matches Craft's TokenRefreshManager).
export function tokenNeedsRefresh(bundle: OAuthTokenBundle): boolean {
  if (typeof bundle.expiresAt !== 'number') return true
  return Date.now() > bundle.expiresAt - REFRESH_WINDOW_MS
}
