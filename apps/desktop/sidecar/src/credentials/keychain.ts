// OS keychain wrapper for MCP secrets — see ADR 0018.
//
// Backed by `@napi-rs/keyring` (prebuilt cross-platform native binding):
//   - macOS:   Keychain Services
//   - Linux:   Secret Service (gnome-keyring / kwallet via libsecret)
//   - Windows: Credential Manager (DPAPI)
//
// Dynamic import + try/catch so the sidecar still boots if the user has not
// yet run `pnpm install` after the dep was added in pha 2 B2. Without the
// binding, all secret operations log a warning and behave as no-op — MCP
// servers using plaintext values keep working, only `secret:` placeholder
// expansion fails (which surfaces as a clear error in mcp.test).
//
// Service name (top-level group in OS keychain): `awog-mcp`.
// Account name (per-secret): `<server-id>/<env-or-header-key>`.
//
// A generic service-scoped core (setKeychainValue / getKeychainValue /
// deleteKeychainValue) backs the MCP-secret wrappers below AND lets other
// credential kinds live in DISTINCT keychain services without re-implementing
// the native-binding load. Source OAuth tokens use their own service
// (`awog-source-oauth`, account = source id) via sources/oauth-store.ts so they
// never collide with the `awog-mcp` env/header secrets (ADR 0060 D-4).

import { log } from '../util/logger.js'

const MCP_SERVICE = 'awog-mcp'

interface EntryLike {
  setPassword: (password: string) => void
  getPassword: () => string | null
  deletePassword: () => boolean
}

interface KeyringModule {
  Entry: new (service: string, account: string) => EntryLike
}

let loadedModule: KeyringModule | null = null
let loadAttempted = false
let loadError: string | null = null

async function getModule(): Promise<KeyringModule | null> {
  if (loadAttempted) return loadedModule
  loadAttempted = true
  try {
    // Dynamic import so module loading is deferred until first secret op,
    // and bundle failures don't crash the sidecar. String-interpolation form
    // hides the import specifier from tsc's static module resolver — the dep
    // is declared in package.json but the @types resolution path is opaque.
    const modPath = ['@napi-rs', 'keyring'].join('/')
    const mod = (await import(modPath)) as unknown as KeyringModule
    if (!mod || typeof mod.Entry !== 'function') {
      loadError = '@napi-rs/keyring loaded but Entry class missing'
      log.warn('keychain: module shape unexpected', { err: loadError })
      return null
    }
    loadedModule = mod
    return mod
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err)
    log.warn('keychain: dynamic import failed — secrets disabled', {
      err: loadError,
      hint: 'Run `pnpm install` in apps/desktop/sidecar to enable.',
    })
    return null
  }
}

function accountFor(serverId: string, key: string): string {
  return `${serverId}/${key}`
}

export interface KeychainStatus {
  available: boolean
  error?: string
}

export async function keychainStatus(): Promise<KeychainStatus> {
  const mod = await getModule()
  if (!mod) {
    return loadError ? { available: false, error: loadError } : { available: false }
  }
  return { available: true }
}

// ─── Generic service-scoped core ─────────────────────────────────────────────
// The account/value strings are opaque to this layer — callers own the
// namespace. Values are never logged (only service/account, which are
// non-secret identifiers).

export async function setKeychainValue(
  service: string,
  account: string,
  value: string,
): Promise<void> {
  const mod = await getModule()
  if (!mod) {
    throw new Error(`keychain unavailable: ${loadError ?? 'native binding missing'}`)
  }
  const entry = new mod.Entry(service, account)
  entry.setPassword(value)
}

export async function getKeychainValue(service: string, account: string): Promise<string | null> {
  const mod = await getModule()
  if (!mod) return null
  try {
    const entry = new mod.Entry(service, account)
    return entry.getPassword()
  } catch (err) {
    // Some platforms throw on "no entry" rather than returning null.
    log.warn('keychain: get failed', {
      service,
      account,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function deleteKeychainValue(service: string, account: string): Promise<boolean> {
  const mod = await getModule()
  if (!mod) return false
  try {
    const entry = new mod.Entry(service, account)
    return entry.deletePassword()
  } catch (err) {
    log.warn('keychain: delete failed', {
      service,
      account,
      err: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// ─── MCP secret wrappers (service `awog-mcp`, account `<serverId>/<key>`) ─────
// Backward-compatible signatures — callers unchanged.

export async function setSecret(serverId: string, key: string, value: string): Promise<void> {
  return setKeychainValue(MCP_SERVICE, accountFor(serverId, key), value)
}

export async function getSecret(serverId: string, key: string): Promise<string | null> {
  return getKeychainValue(MCP_SERVICE, accountFor(serverId, key))
}

export async function deleteSecret(serverId: string, key: string): Promise<boolean> {
  return deleteKeychainValue(MCP_SERVICE, accountFor(serverId, key))
}
