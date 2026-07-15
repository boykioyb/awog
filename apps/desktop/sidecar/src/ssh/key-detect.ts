// Detect an SSH key's algorithm (ADR 0063 P5) so the identity editor can
// auto-fill the key type on import instead of asking the user to pick it.
//
// Runs in the sidecar because it inspects key material: for a keyPath we prefer
// the sibling `.pub` (names the algorithm directly and is NOT secret), else we
// read the private key and infer from its PEM header / embedded type token. The
// content NEVER leaves the sidecar — only the resolved type is returned, and
// nothing is logged.

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { SshKeyType } from './schema.js'

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

// Map an SSH algorithm token (e.g. "ssh-ed25519", "ecdsa-sha2-nistp256",
// "ssh-rsa", "ssh-dss") onto the coarse key-type enum.
function fromAlgoToken(token: string): SshKeyType | null {
  const a = token.toLowerCase()
  if (a.includes('ed25519')) return 'ed25519'
  if (a.includes('ssh-rsa') || a === 'rsa' || a.startsWith('rsa-')) return 'rsa'
  if (a.startsWith('ecdsa') || a.includes('ecdsa-sha2')) return 'ecdsa'
  if (a.includes('dss') || a.includes('dsa')) return 'other'
  return null
}

// A public-key line ("ssh-ed25519 AAAA… comment") — the first field is the algo.
function fromPubLine(line: string): SshKeyType | null {
  const first = line.trim().split(/\s+/)[0] ?? ''
  return first ? fromAlgoToken(first) : null
}

function fromPrivateKeyText(text: string): SshKeyType | null {
  if (/BEGIN RSA PRIVATE KEY/.test(text)) return 'rsa'
  if (/BEGIN EC PRIVATE KEY/.test(text)) return 'ecdsa'
  if (/BEGIN DSA PRIVATE KEY/.test(text)) return 'other'
  if (/BEGIN OPENSSH PRIVATE KEY/.test(text)) {
    // The new OpenSSH container embeds the algorithm as an ASCII length-prefixed
    // string; scanning the decoded body for the token is enough to classify it.
    const body = text
      .replace(/-----BEGIN OPENSSH PRIVATE KEY-----/, '')
      .replace(/-----END OPENSSH PRIVATE KEY-----/, '')
      .replace(/\s+/g, '')
    try {
      const decoded = Buffer.from(body, 'base64').toString('latin1')
      if (decoded.includes('ssh-ed25519')) return 'ed25519'
      if (decoded.includes('ssh-rsa')) return 'rsa'
      if (decoded.includes('ecdsa-sha2-')) return 'ecdsa'
      if (decoded.includes('ssh-dss')) return 'other'
    } catch {
      // undecodable body → unknown
    }
    return null
  }
  return null
}

// Returns the detected type, or null when it can't be determined (the UI then
// leaves the field for the user to pick). Never throws.
export async function detectKeyType(opts: {
  keyPath?: string | undefined
  privateKey?: string | undefined
}): Promise<SshKeyType | null> {
  if (opts.privateKey) return fromPrivateKeyText(opts.privateKey)
  if (opts.keyPath) {
    const path = expandHome(opts.keyPath)
    // Prefer the sibling .pub (algorithm named directly, non-secret).
    try {
      const pub = await readFile(`${path}.pub`, 'utf8')
      const t = fromPubLine(pub)
      if (t) return t
    } catch {
      // no readable .pub → fall back to the private key
    }
    try {
      return fromPrivateKeyText(await readFile(path, 'utf8'))
    } catch {
      return null
    }
  }
  return null
}
