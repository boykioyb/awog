import { homedir } from 'node:os'
import { resolve } from 'node:path'

// AWOG home is the only filesystem surface owned by the sidecar.
// Every credential / config file lives directly under this directory.
export function awogHome(): string {
  return resolve(homedir(), '.awog')
}

const ILLEGAL_CHILD_RE = /[/\\]|\.\./

// Guard against path traversal when composing paths from method params or
// computed names. Caller should always concat result with awogHome().
export function sanitizeChild(name: string): string {
  if (!name || ILLEGAL_CHILD_RE.test(name)) {
    throw new Error(`Illegal path segment: ${name}`)
  }
  return name
}
