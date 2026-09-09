import { execFile } from 'node:child_process'
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, session } from 'electron'
import { BROWSER_PARTITION } from './browser'
import { log } from './logger'

const execFileAsync = promisify(execFile)

// Import a Chromium profile into the agent's browser partition (ADR 0086 phần B).
//
// WHAT THIS IS FOR. The embedded browser starts with an empty cookie jar, so the
// agent begins every site logged out even though the user is logged in three
// windows away. This copies the user's real browsing session in: pick a browser,
// pick a profile, import.
//
// WHAT IS COPIED, AND WHAT IS DELIBERATELY NOT. Cookies, Local Storage and
// IndexedDB — the three places a web session actually lives. NOT `Login Data`
// (saved passwords), NOT `Web Data` (autofill, cards), NOT History or Bookmarks.
// Those add nothing to "the agent can read the page I am logged into" and they are
// the worst possible things to hand a process that reads untrusted web pages. The
// exclusion is the design, not an oversight: see docs/features/browser-profile-import.md.
//
// THE WALL — APP-BOUND ENCRYPTION. Chromium encrypts cookie values. Historically
// (tag `v10`) the key sat in the OS keychain, which any app can ask for. Chrome 127+
// moved to app-bound encryption (tag `v20`), where the key is bound to the signed
// Chrome binary itself — no external process can decrypt it, keychain or not. So
// cookie import CANNOT be guaranteed; it depends on what the user's browser wrote.
// This module therefore detects the tag per row and REPORTS what it could not do,
// with counts, instead of silently importing a half-empty jar. Local Storage and
// IndexedDB are NOT encrypted, so they come across either way — which is why a
// full-profile import can still land a working session when cookies fail.
//
// TWO PHASES, BECAUSE OF FILE LOCKS. Cookies go in live through
// `session.cookies.set` (decrypt → set), effective immediately. Local Storage and
// IndexedDB are LevelDB directories that Chromium holds open for the lifetime of a
// Session object, so writing into them under a running app risks corrupting them.
// They are staged instead, and `applyPendingImport()` moves them into place at the
// next boot BEFORE anything touches the partition. Hence "restart to finish".
//
// TRUST. `browserId` / `profileDir` from the renderer are matched against the
// enumerated list — never joined into a path directly (invariant #2). The keychain
// password is read into a local, passed straight to PBKDF2, and never logged.

// ─── Which browsers, and where their keychain key lives ─────────────────────
//
// All Chromium forks share the layout; they differ in data dir and in the
// keychain item name (`<Name> Safe Storage` / `<Name>`).
interface BrowserDef {
  id: string
  label: string
  // Relative to ~/Library/Application Support (macOS).
  dataDir: string
  keychainService: string
  keychainAccount: string
}

const BROWSERS: BrowserDef[] = [
  {
    id: 'chrome',
    label: 'Google Chrome',
    dataDir: 'Google/Chrome',
    keychainService: 'Chrome Safe Storage',
    keychainAccount: 'Chrome',
  },
  {
    id: 'edge',
    label: 'Microsoft Edge',
    dataDir: 'Microsoft Edge',
    keychainService: 'Microsoft Edge Safe Storage',
    keychainAccount: 'Microsoft Edge',
  },
  {
    id: 'brave',
    label: 'Brave',
    dataDir: 'BraveSoftware/Brave-Browser',
    keychainService: 'Brave Safe Storage',
    keychainAccount: 'Brave',
  },
  {
    id: 'arc',
    label: 'Arc',
    dataDir: 'Arc/User Data',
    keychainService: 'Arc Safe Storage',
    keychainAccount: 'Arc',
  },
  {
    id: 'vivaldi',
    label: 'Vivaldi',
    dataDir: 'Vivaldi',
    keychainService: 'Vivaldi Safe Storage',
    keychainAccount: 'Vivaldi',
  },
  {
    id: 'chromium',
    label: 'Chromium',
    dataDir: 'Chromium',
    keychainService: 'Chromium Safe Storage',
    keychainAccount: 'Chromium',
  },
]

export interface ProfileEntry {
  // Directory name inside the browser's data dir ("Default", "Profile 3").
  dir: string
  // Display name the user set in the browser, else the directory name.
  name: string
  // Signed-in account, when the browser recorded one — the only way to tell
  // "Profile 3" from "Profile 7" at a glance.
  email: string
  hasCookies: boolean
}

export interface BrowserEntry {
  id: string
  label: string
  profiles: ProfileEntry[]
}

export interface ImportParts {
  cookies: boolean
  localStorage: boolean
  indexedDb: boolean
}

export interface ImportReport {
  browser: string
  profile: string
  cookies: {
    total: number
    imported: number
    // Values written with app-bound encryption (tag v20+): undecryptable by
    // design, not a bug we can fix here.
    appBound: number
    // Decryption ran but produced nothing usable (unknown scheme / bad padding).
    undecryptable: number
    // Electron refused the cookie (e.g. a `__Host-` prefix whose invariants the
    // stored row does not satisfy).
    rejected: number
    // Already past its expiry in the source profile. Chromium ACCEPTS these and
    // then drops them, so counting them as imported would report a jar fuller
    // than it is — measured while testing: a stale expiry set fine and read back
    // empty. Skipped explicitly instead.
    expired: number
    // No keychain key: the user denied the macOS prompt, or the item is missing.
    keyUnavailable: boolean
  } | null
  localStorage: { staged: boolean; bytes: number } | null
  indexedDb: { staged: boolean; bytes: number } | null
  needsRestart: boolean
}

const supportPath = (): string => join(homedir(), 'Library', 'Application Support')

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// ─── Discovery ───────────────────────────────────────────────────────────────

// Profile display names live in the BROWSER-level `Local State`, under
// `profile.info_cache` keyed by directory name. Fall back to a directory scan so a
// profile the browser has not written to the cache yet still shows up.
async function profilesOf(dataDir: string): Promise<ProfileEntry[]> {
  const names = new Map<string, { name: string; email: string }>()
  try {
    const raw = await readFile(join(dataDir, 'Local State'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const cache = (parsed as { profile?: { info_cache?: Record<string, unknown> } })?.profile
      ?.info_cache
    for (const [dir, infoRaw] of Object.entries(cache ?? {})) {
      const info = (infoRaw ?? {}) as { name?: unknown; user_name?: unknown }
      names.set(dir, {
        name: typeof info.name === 'string' ? info.name : dir,
        email: typeof info.user_name === 'string' ? info.user_name : '',
      })
    }
  } catch {
    // No/broken Local State — the directory scan below still finds profiles.
  }

  const out: ProfileEntry[] = []
  let entries: string[] = []
  try {
    entries = (await readdir(dataDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return out
  }
  for (const dir of entries) {
    if (dir !== 'Default' && !/^Profile \d+$/.test(dir)) continue
    const meta = names.get(dir)
    out.push({
      dir,
      name: meta?.name ?? dir,
      email: meta?.email ?? '',
      hasCookies: await exists(join(dataDir, dir, 'Cookies')),
    })
  }
  // Default first, then Profile N in numeric order.
  return out.sort((a, b) => {
    if (a.dir === 'Default') return -1
    if (b.dir === 'Default') return 1
    return a.dir.localeCompare(b.dir, undefined, { numeric: true })
  })
}

export async function listBrowsers(): Promise<BrowserEntry[]> {
  const out: BrowserEntry[] = []
  for (const def of BROWSERS) {
    const dataDir = join(supportPath(), def.dataDir)
    if (!(await exists(dataDir))) continue
    const profiles = await profilesOf(dataDir)
    if (profiles.length > 0) out.push({ id: def.id, label: def.label, profiles })
  }
  return out
}

// ─── Cookie decryption ───────────────────────────────────────────────────────

const KEY_SALT = 'saltysalt'
const KEY_ITERATIONS = 1003
const KEY_LENGTH = 16
// Chromium's macOS/Linux scheme uses a fixed IV of 16 spaces.
const IV = Buffer.alloc(16, ' ')

// The keychain password for `<Browser> Safe Storage`. Read through the `security`
// CLI (no new dependency; the sidecar's keyring binding is not a dep of main), and
// the value is returned to the caller's local only — never logged, never persisted.
// macOS shows the user a one-time approval prompt for the item.
async function safeStorageKey(def: BrowserDef): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      def.keychainService,
      '-a',
      def.keychainAccount,
      '-w',
    ])
    const password = stdout.trim()
    if (!password) return null
    return pbkdf2Sync(password, KEY_SALT, KEY_ITERATIONS, KEY_LENGTH, 'sha1')
  } catch {
    // Denied prompt, missing item, or no `security` binary.
    return null
  }
}

type DecryptOutcome =
  | { kind: 'ok'; value: string }
  | { kind: 'appBound' }
  | { kind: 'undecryptable' }

// `hostKey` is needed because recent Chromium versions prepend a SHA-256 of the
// cookie's domain to the plaintext, binding a value to its host. Comparing that
// hash is how we know whether to strip 32 bytes — a length heuristic would corrupt
// values that merely happen to be long.
export function decryptCookie(hex: string, plain: string, key: Buffer | null, hostKey: string): DecryptOutcome {
  if (!hex) return plain ? { kind: 'ok', value: plain } : { kind: 'ok', value: '' }
  const buf = Buffer.from(hex, 'hex')
  const tag = buf.subarray(0, 3).toString('latin1')
  // v10 (macOS/Linux) is the AES-128-CBC scheme below. v11 is the Linux variant of
  // the same scheme. v20+ is app-bound: the key never leaves the signed browser.
  if (tag !== 'v10' && tag !== 'v11') {
    return /^v\d\d$/.test(tag) ? { kind: 'appBound' } : { kind: 'undecryptable' }
  }
  if (!key) return { kind: 'undecryptable' }
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, IV)
    decipher.setAutoPadding(true)
    let out = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()])
    if (out.length >= 32) {
      const expected = createHash('sha256').update(hostKey).digest()
      if (out.subarray(0, 32).equals(expected)) out = out.subarray(32)
    }
    return { kind: 'ok', value: out.toString('utf8') }
  } catch {
    return { kind: 'undecryptable' }
  }
}

// ─── Reading the cookie DB ───────────────────────────────────────────────────

// Column names have drifted across Chromium versions (`secure` → `is_secure`,
// `httponly` → `is_httponly`), so read the actual schema instead of assuming one.
// `hex()` on the BLOB because `sqlite3 -json` cannot encode raw bytes.
//
// Exported so the schema/hex/JSON path can be covered by a test against a
// SYNTHETIC jar — the real one cannot be a fixture, it is the user's live session.
export async function readCookieRows(dbPath: string): Promise<Record<string, string>[]> {
  const pragma = await execFileAsync('/usr/bin/sqlite3', [dbPath, 'PRAGMA table_info(cookies);'])
  const columns = pragma.stdout
    .split('\n')
    .map((line) => line.split('|')[1])
    .filter((c): c is string => !!c)
  if (columns.length === 0) return []
  const projection = columns
    .map((c) => (c === 'encrypted_value' ? 'hex(encrypted_value) AS encrypted_value' : `"${c}"`))
    .join(', ')
  const { stdout } = await execFileAsync(
    '/usr/bin/sqlite3',
    ['-json', dbPath, `SELECT ${projection} FROM cookies;`],
    // A big jar is a few MB of JSON; the default 1MB buffer is not enough.
    { maxBuffer: 256 * 1024 * 1024 },
  )
  const text = stdout.trim()
  if (!text) return []
  const parsed: unknown = JSON.parse(text)
  return Array.isArray(parsed) ? (parsed as Record<string, string>[]) : []
}

const num = (row: Record<string, string>, ...keys: string[]): number => {
  for (const key of keys) {
    const v = row[key]
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return 0
}

// Chromium timestamps are microseconds since 1601-01-01; Electron wants seconds
// since the Unix epoch.
const WEBKIT_EPOCH_OFFSET_SEC = 11_644_473_600
const SAME_SITE: Record<number, 'unspecified' | 'no_restriction' | 'lax' | 'strict'> = {
  [-1]: 'unspecified',
  0: 'no_restriction',
  1: 'lax',
  2: 'strict',
}

// ─── Import ──────────────────────────────────────────────────────────────────

const PENDING_DIR = 'pending-browser-import'

// Where Electron keeps a `persist:<name>` partition's storage.
const partitionDir = (): string =>
  join(app.getPath('userData'), 'Partitions', BROWSER_PARTITION.replace(/^persist:/, ''))

async function dirBytes(path: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await dirBytes(child)
    else {
      try {
        total += (await stat(child)).size
      } catch {
        // Raced with the browser deleting it — it just doesn't count.
      }
    }
  }
  return total
}

async function importCookies(
  def: BrowserDef,
  profilePath: string,
): Promise<NonNullable<ImportReport['cookies']>> {
  const report = {
    total: 0,
    imported: 0,
    appBound: 0,
    undecryptable: 0,
    rejected: 0,
    expired: 0,
    keyUnavailable: false,
  }
  const source = join(profilePath, 'Cookies')
  if (!(await exists(source))) return report

  // Never read the live file: the browser may be mid-write, and SQLite readers on
  // a WAL database can block it. Work on a snapshot.
  const temp = await mkdtemp(join(tmpdir(), 'awog-cookie-'))
  try {
    const copy = join(temp, 'Cookies')
    await cp(source, copy)
    for (const suffix of ['-wal', '-shm']) {
      if (await exists(source + suffix)) await cp(source + suffix, copy + suffix)
    }
    const rows = await readCookieRows(copy)
    report.total = rows.length
    if (rows.length === 0) return report

    const key = await safeStorageKey(def)
    report.keyUnavailable = key === null

    const jar = session.fromPartition(BROWSER_PARTITION).cookies
    for (const row of rows) {
      const hostKey = row.host_key ?? ''
      const name = row.name ?? ''
      if (!hostKey || !name) {
        report.rejected += 1
        continue
      }
      const outcome = decryptCookie(row.encrypted_value ?? '', row.value ?? '', key, hostKey)
      if (outcome.kind === 'appBound') {
        report.appBound += 1
        continue
      }
      if (outcome.kind === 'undecryptable') {
        report.undecryptable += 1
        continue
      }
      const host = hostKey.replace(/^\./, '')
      const secure = num(row, 'is_secure', 'secure') === 1
      const path = row.path || '/'
      const expires = num(row, 'expires_utc')
      const persistent = num(row, 'is_persistent', 'persistent') === 1
      const expiresAtSec = expires / 1_000_000 - WEBKIT_EPOCH_OFFSET_SEC
      if (persistent && expires > 0 && expiresAtSec <= Date.now() / 1000) {
        report.expired += 1
        continue
      }
      try {
        await jar.set({
          url: `${secure ? 'https' : 'http'}://${host}${path}`,
          name,
          value: outcome.value,
          // A leading dot means "and subdomains"; a host-only cookie must NOT
          // carry a domain or Chromium widens its scope.
          ...(hostKey.startsWith('.') ? { domain: hostKey } : {}),
          path,
          secure,
          httpOnly: num(row, 'is_httponly', 'httponly') === 1,
          sameSite: SAME_SITE[num(row, 'samesite')] ?? 'unspecified',
          ...(persistent && expires > 0 ? { expirationDate: expiresAtSec } : {}),
        })
        report.imported += 1
      } catch {
        // Prefixed cookies (`__Host-`, `__Secure-`) and malformed rows land here.
        report.rejected += 1
      }
    }
    return report
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

// LevelDB stores cannot be written under a running app (see the header), so stage
// them and let the next boot move them in.
async function stageStore(
  profilePath: string,
  stageRoot: string,
  relative: string,
): Promise<{ staged: boolean; bytes: number }> {
  const source = join(profilePath, relative)
  if (!(await exists(source))) return { staged: false, bytes: 0 }
  const target = join(stageRoot, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await cp(source, target, { recursive: true })
  return { staged: true, bytes: await dirBytes(target) }
}

export async function importProfile(
  browserId: string,
  profileDir: string,
  parts: ImportParts,
): Promise<ImportReport> {
  // Renderer input resolves against the enumerated list — no path from the UI ever
  // reaches the filesystem (invariant #2).
  const def = BROWSERS.find((b) => b.id === browserId)
  if (!def) throw new Error(`unknown browser: ${browserId}`)
  const dataDir = join(supportPath(), def.dataDir)
  const known = await profilesOf(dataDir)
  const profile = known.find((p) => p.dir === profileDir)
  if (!profile) throw new Error(`unknown profile: ${profileDir}`)
  const profilePath = join(dataDir, profile.dir)

  const report: ImportReport = {
    browser: def.label,
    profile: profile.name,
    cookies: null,
    localStorage: null,
    indexedDb: null,
    needsRestart: false,
  }

  if (parts.cookies) report.cookies = await importCookies(def, profilePath)

  if (parts.localStorage || parts.indexedDb) {
    const stageRoot = join(app.getPath('userData'), PENDING_DIR)
    await rm(stageRoot, { recursive: true, force: true })
    await mkdir(stageRoot, { recursive: true })
    if (parts.localStorage) {
      report.localStorage = await stageStore(profilePath, stageRoot, 'Local Storage')
    }
    if (parts.indexedDb) {
      report.indexedDb = await stageStore(profilePath, stageRoot, 'IndexedDB')
    }
    report.needsRestart = !!report.localStorage?.staged || !!report.indexedDb?.staged
    if (report.needsRestart) {
      await writeFile(
        join(stageRoot, 'manifest.json'),
        JSON.stringify({ browser: def.label, profile: profile.name, at: Date.now() }, null, 2),
      )
    } else {
      await rm(stageRoot, { recursive: true, force: true })
    }
  }

  log.info('browser profile import', {
    browser: def.id,
    profile: profile.dir,
    cookiesImported: report.cookies?.imported ?? 0,
    cookiesAppBound: report.cookies?.appBound ?? 0,
    needsRestart: report.needsRestart,
  })
  return report
}

// Called at boot BEFORE any partition session exists — the only moment a LevelDB
// store can be replaced without racing Chromium for the lock.
export async function applyPendingImport(): Promise<void> {
  const stageRoot = join(app.getPath('userData'), PENDING_DIR)
  if (!(await exists(join(stageRoot, 'manifest.json')))) return
  const target = partitionDir()
  try {
    await mkdir(target, { recursive: true })
    for (const relative of ['Local Storage', 'IndexedDB']) {
      const staged = join(stageRoot, relative)
      if (!(await exists(staged))) continue
      // Replace wholesale: merging two LevelDB stores is not a thing, and a
      // half-merged store is a corrupt store.
      await rm(join(target, relative), { recursive: true, force: true })
      await cp(staged, join(target, relative), { recursive: true })
    }
    log.info('browser profile import applied')
  } catch (err) {
    log.warn('browser profile import failed to apply', {
      err: err instanceof Error ? err.message : String(err),
    })
  } finally {
    await rm(stageRoot, { recursive: true, force: true })
  }
}

// The undo. A full-profile import hands the agent every session in that profile,
// so there has to be one button that takes it all back.
export async function clearImportedData(): Promise<void> {
  await session.fromPartition(BROWSER_PARTITION).clearStorageData()
  await rm(join(app.getPath('userData'), PENDING_DIR), { recursive: true, force: true })
}
