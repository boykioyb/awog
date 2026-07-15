// Read-only parser for the user's ~/.ssh/config — ADR 0063, import flow.
//
// Produces candidate hosts the UI can offer to import into the AWOG inventory.
// This NEVER writes to ~/.ssh/config (or anywhere in ~/.ssh) — it only reads.
// Limitations (v1): `Include` directives are not followed; `Match` blocks are
// skipped (their conditional fields don't map cleanly to a static host card);
// wildcard `Host` patterns (`*`, `?`, `!`) are ignored — they're rules, not
// concrete hosts.

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from '../util/logger.js'

export interface SshConfigCandidate {
  // The concrete `Host` alias — becomes the imported host's name + id seed.
  alias: string
  // `HostName` if present, else the alias.
  host: string
  port: number
  user?: string
  identityFile?: string
  proxyJump?: string
}

function configPath(): string {
  return join(homedir(), '.ssh', 'config')
}

export async function parseSshConfig(): Promise<SshConfigCandidate[]> {
  let raw: string
  try {
    raw = await readFile(configPath(), 'utf8')
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return []
    log.warn('ssh: failed to read ~/.ssh/config', {
      err: err instanceof Error ? err.message : String(err),
    })
    return []
  }
  return parseConfigText(raw)
}

interface Block {
  aliases: string[]
  fields: Record<string, string>
}

export function parseConfigText(raw: string): SshConfigCandidate[] {
  const out: SshConfigCandidate[] = []
  let current: Block | null = null
  let inMatch = false

  const flush = (): void => {
    if (!current) return
    const alias = current.aliases.find((a) => !/[*?!]/.test(a))
    if (alias) {
      const f = current.fields
      const parsed = f.port ? Number.parseInt(f.port, 10) : 22
      const port = Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 22
      out.push({
        alias,
        host: f.hostname || alias,
        port,
        ...(f.user ? { user: f.user } : {}),
        ...(f.identityfile ? { identityFile: f.identityfile } : {}),
        ...(f.proxyjump ? { proxyJump: f.proxyjump } : {}),
      })
    }
    current = null
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // Accept both `Key Value` and `Key=Value` (ssh allows both).
    const m = /^(\S+?)[=\s]+(.*)$/.exec(trimmed)
    if (!m) continue
    const key = (m[1] ?? '').toLowerCase()
    const value = (m[2] ?? '').trim().replace(/^"(.*)"$/, '$1')
    if (!key) continue

    if (key === 'host') {
      flush()
      inMatch = false
      current = { aliases: value.split(/\s+/).filter(Boolean), fields: {} }
    } else if (key === 'match') {
      // Match blocks are conditional; close any Host block and skip fields.
      flush()
      inMatch = true
    } else if (current && !inMatch) {
      // First occurrence wins, mirroring ssh's own precedence.
      if (!(key in current.fields)) current.fields[key] = value
    }
  }
  flush()
  return out
}
