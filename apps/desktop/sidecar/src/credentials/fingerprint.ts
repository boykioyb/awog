import { createHash } from 'node:crypto'

// 8-char sha256 prefix is enough to identify an account in the UI without
// exposing any portion of the actual secret.
export function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 8)
}
