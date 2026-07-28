import { mkdir, readFile, writeFile, chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { codexSubscriptionModelIds } from '../auth/openai-codex-oauth.js'
import { fingerprint } from './fingerprint.js'
import type {
  AccountRecord,
  AccountSafe,
  AccountStatus,
  CredentialsFile,
  ProviderName,
} from '../types/shared.js'

const FILE_NAME = sanitizeChild('credentials.json')

function credentialsPath(): string {
  return join(awogHome(), FILE_NAME)
}

function emptyCredentials(): CredentialsFile {
  return {
    version: 1,
    providers: {
      anthropic: { accounts: [], activeAccountId: null },
      openai: { accounts: [], activeAccountId: null },
      google: { accounts: [], activeAccountId: null },
    },
  }
}

async function ensureHome(): Promise<void> {
  await mkdir(awogHome(), { recursive: true, mode: 0o700 })
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

export async function loadCredentials(): Promise<CredentialsFile> {
  const file = credentialsPath()
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return reconcileShape(parsed)
  } catch (err) {
    if (isMissing(err)) {
      const skeleton = emptyCredentials()
      await saveCredentials(skeleton)
      return skeleton
    }
    throw err
  }
}

// Tolerate older / partial credential files by filling in missing provider
// buckets. Fail fast if shape is otherwise unrecognisable.
function reconcileShape(value: unknown): CredentialsFile {
  if (typeof value !== 'object' || value === null) {
    throw new Error('credentials.json is not a JSON object')
  }
  const v = value as { version?: unknown; providers?: unknown }
  if (v.version !== 1) {
    throw new Error(`credentials.json version unsupported: ${String(v.version)}`)
  }
  const skeleton = emptyCredentials()
  const providers = (v.providers ?? {}) as Record<string, unknown>
  for (const name of ['anthropic', 'openai', 'google'] as const) {
    const bucket = providers[name] as
      | { accounts?: AccountRecord[]; activeAccountId?: string | null }
      | undefined
    if (bucket && Array.isArray(bucket.accounts)) {
      skeleton.providers[name] = {
        accounts: bucket.accounts,
        activeAccountId: bucket.activeAccountId ?? null,
      }
    }
  }
  return skeleton
}

export async function saveCredentials(data: CredentialsFile): Promise<void> {
  await ensureHome()
  const file = credentialsPath()
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

// Pull a number field from a pi OAuth credential blob (e.g. `expires`, in ms
// epoch). Returns undefined when absent or not a finite number — the blob is L2
// trust (loaded from disk) so we re-validate at this boundary.
function piOAuthNumber(record: AccountRecord, key: string): number | undefined {
  const value = record.piOAuth?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function piOAuthString(record: AccountRecord, key: string): string | undefined {
  const value = record.piOAuth?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function accountStatus(record: AccountRecord): AccountStatus {
  if (record.authMode === 'oauth') {
    // pi-managed OAuth (codex/copilot/…): connected if creds present. pi auto-
    // refreshes an expired token at request time, so a past `expires` is not
    // "disconnected" — surface 'expired' as a hint, still recoverable.
    if (record.piOAuth) {
      const expires = piOAuthNumber(record, 'expires')
      if (expires !== undefined && expires < Date.now()) return 'expired'
      return 'connected'
    }
    if (!record.oauth) return 'disconnected'
    return record.oauth.expiresAt < Date.now() ? 'expired' : 'connected'
  }
  return record.apiKey ? 'connected' : 'disconnected'
}

function accountFingerprint(record: AccountRecord): string {
  // pi-managed OAuth: fingerprint the (secret) refresh token. Never expose it.
  const piRefresh = piOAuthString(record, 'refresh')
  if (piRefresh) return fingerprint(piRefresh)
  if (record.oauth?.refreshToken) return fingerprint(record.oauth.refreshToken)
  if (record.apiKey) return fingerprint(record.apiKey)
  return '00000000'
}

export function toSafe(record: AccountRecord): AccountSafe {
  const safe: AccountSafe = {
    id: record.id,
    label: record.label,
    authMode: record.authMode,
    fingerprint: accountFingerprint(record),
    status: accountStatus(record),
    version: record.version,
    createdAt: record.createdAt,
  }
  // Expose only the non-secret expiry. piOAuth itself is NEVER copied into the
  // safe view (invariant #1 — credential blob never leaves the sidecar).
  if (record.oauth?.expiresAt !== undefined) safe.expiresAt = record.oauth.expiresAt
  else {
    const piExpires = piOAuthNumber(record, 'expires')
    if (piExpires !== undefined) safe.expiresAt = piExpires
  }
  if (record.baseURL) safe.baseURL = record.baseURL
  if (record.api) safe.api = record.api
  // Models belong to the PROVIDER now (Provider Model Catalog) — a built-in
  // account no longer curates a per-account list, so its stored `models` (legacy
  // per-account curation) is NOT exposed; the UI reads the provider catalog. Only
  // two account kinds still carry an account-scoped list:
  //   - Codex subscription (OAuth + piOAuth): a distinct, subscription-eligible
  //     set the provider catalog doesn't represent.
  //   - Custom endpoint (baseURL): serves models the provider catalog can't know.
  if (record.models && record.models.length) {
    const isCodex = record.authMode === 'oauth' && !!record.piOAuth
    const isCustom = !!record.baseURL
    if (isCodex) {
      const models = codexSubscriptionModelIds(record.models)
      if (models.length) safe.models = models
    } else if (isCustom) {
      safe.models = record.models
    }
  }
  if (record.organization) safe.organization = record.organization
  if (record.account) safe.account = record.account
  return safe
}

export function findAccount(
  data: CredentialsFile,
  provider: ProviderName,
  accountId: string,
): AccountRecord | undefined {
  return data.providers[provider].accounts.find((a) => a.id === accountId)
}
