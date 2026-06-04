import type { OAuthState } from '../types/shared.js'

const STATE_TTL_MS = 10 * 60 * 1000

const states = new Map<string, OAuthState>()

function gc(): void {
  const now = Date.now()
  for (const [key, value] of states) {
    if (now - value.createdAt > STATE_TTL_MS) states.delete(key)
  }
}

export function putState(state: string, verifier: string): void {
  gc()
  states.set(state, { verifier, createdAt: Date.now() })
}

export function takeState(state: string): OAuthState | undefined {
  gc()
  const entry = states.get(state)
  if (!entry) return undefined
  if (Date.now() - entry.createdAt > STATE_TTL_MS) {
    states.delete(state)
    return undefined
  }
  states.delete(state)
  return entry
}
