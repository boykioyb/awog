import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from './logger'

// Device store for the Remote Gateway (F6, ADR 0067 §4 / spec §Contract). Lives in
// MAIN (the process that binds the network + has no API key). We store only a
// sha256 HASH of each device token — the token itself is minted once at pairing,
// returned to the phone, and never persisted here. So there is no recoverable
// secret at rest; verification hashes the incoming token and constant-time
// compares. Pairing codes are short-lived, single-use, in-memory only.

export type RemoteDevice = {
  id: string
  label: string
  platform: string
  pairedAt: string
  lastSeenAt?: string
}

type StoredDevice = RemoteDevice & { tokenHash: string }

type Pairing = { code: string; expiresAt: number; used: boolean }

const STORE_FILE = join(homedir(), '.awog', 'remote-devices.json')
const PAIRING_TTL_MS = 120_000

// Crockford-ish alphabet (no I/L/O/U) for typable fallback codes. 256 % 32 === 0
// so the modulo below is bias-free.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function genCode(len = 8): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i += 1) out += CODE_ALPHABET[bytes[i] % 32]
  return out
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

export class DeviceStore {
  private devices: StoredDevice[] = []

  // One active pairing challenge at a time (the UI shows one QR/code). Regenerating
  // replaces it, invalidating the previous code.
  private pairing: Pairing | null = null

  async load(): Promise<void> {
    try {
      const raw = await readFile(STORE_FILE, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      this.devices = Array.isArray(parsed) ? (parsed as StoredDevice[]) : []
    } catch {
      this.devices = [] // missing/corrupt → start empty (fail-safe, not fail-open)
    }
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(join(homedir(), '.awog'), { recursive: true })
      await writeFile(STORE_FILE, JSON.stringify(this.devices, null, 2), { mode: 0o600 })
    } catch (err) {
      log.error('remote-devices persist failed', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Public metadata only — tokenHash never leaves this module.
  list(): RemoteDevice[] {
    return this.devices.map(({ tokenHash: _hash, ...pub }) => pub)
  }

  hasDevices(): boolean {
    return this.devices.length > 0
  }

  // Start a fresh pairing challenge; returns the one-time code + expiry.
  createPairing(): { code: string; expiresAt: number } {
    const code = genCode()
    const expiresAt = Date.now() + PAIRING_TTL_MS
    this.pairing = { code, expiresAt, used: false }
    return { code, expiresAt }
  }

  cancelPairing(): void {
    this.pairing = null
  }

  // Verify a pairing code and mint a device token. One-time + TTL enforced. Returns
  // the raw token (to hand to the phone; NEVER stored) + the public device record,
  // or null if the code is wrong/expired/used.
  async completePairing(
    code: string,
    label: string,
    platform: string,
  ): Promise<{ token: string; device: RemoteDevice } | null> {
    const p = this.pairing
    if (!p || p.used || Date.now() > p.expiresAt) return null
    if (!safeEqualHex(hashToken(code), hashToken(p.code))) return null
    p.used = true
    this.pairing = null
    const token = randomBytes(32).toString('base64url')
    const device: StoredDevice = {
      id: randomBytes(8).toString('hex'),
      label: String(label || 'Thiết bị').slice(0, 60),
      platform: String(platform || 'web').slice(0, 20),
      pairedAt: new Date().toISOString(),
      tokenHash: hashToken(token),
    }
    this.devices.push(device)
    await this.persist()
    const { tokenHash: _hash, ...pub } = device
    return { token, device: pub }
  }

  // Verify a device token at WS handshake (F6 — auth once per connection, not per
  // frame). Returns the device id on success (and refreshes lastSeenAt), else null.
  async verifyToken(token: string): Promise<string | null> {
    if (typeof token !== 'string' || token.length === 0) return null
    const incoming = hashToken(token)
    const match = this.devices.find((d) => safeEqualHex(d.tokenHash, incoming))
    if (!match) return null
    match.lastSeenAt = new Date().toISOString()
    await this.persist()
    return match.id
  }

  // Remove a device (revoke). The gateway force-closes its live sockets separately.
  async revoke(id: string): Promise<boolean> {
    const before = this.devices.length
    this.devices = this.devices.filter((d) => d.id !== id)
    if (this.devices.length === before) return false
    await this.persist()
    return true
  }
}
