import { createHash, randomBytes } from 'node:crypto'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function genVerifier(): string {
  return base64url(randomBytes(32))
}

export function genChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

export function genStateToken(): string {
  return randomBytes(16).toString('hex')
}
