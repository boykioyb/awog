// Resolve a display avatar for a git commit author from name + email.
//
// Strategy (best-effort, GitHub-first):
//   1. GitHub `…@users.noreply.github.com` email → avatar served directly by
//      GitHub (`avatars.githubusercontent.com/u/<id>` or `github.com/<login>.png`).
//   2. Any other email → Gravatar with `d=404` so a miss returns 404 and the
//      caller's <img> error handler falls back to initials.
//
// When no URL can be built (empty email, crypto unavailable) we return null and
// the caller renders initials. This file does NOT decide the fallback UI — it
// only produces a candidate URL.

// `ID+login@users.noreply.github.com` (new) or `login@users.noreply.github.com`
// (legacy). Capture both the numeric id and the login.
const GH_NOREPLY = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i

// email|size → resolved url (or null). Avoids re-hashing the same author on
// every row render and across the table/list views.
const cache = new Map<string, string | null>()

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const sha256Hex = async (input: string): Promise<string | null> => {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  try {
    const data = new TextEncoder().encode(input)
    return toHex(await crypto.subtle.digest('SHA-256', data))
  } catch {
    return null
  }
}

const resolve = async (email: string, px: number): Promise<string | null> => {
  const gh = GH_NOREPLY.exec(email)
  if (gh) {
    const [, id, login] = gh
    if (id) return `https://avatars.githubusercontent.com/u/${id}?v=4&s=${px}`
    if (login) return `https://github.com/${encodeURIComponent(login)}.png?size=${px}`
  }
  // Gravatar accepts a SHA-256 hash of the trimmed, lowercased email.
  const hash = await sha256Hex(email)
  if (!hash) return null
  return `https://www.gravatar.com/avatar/${hash}?s=${px}&d=404`
}

/** First letter of first + last name, uppercased. Falls back to `?`. */
export const initials = (name: string): string => {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

/**
 * Candidate avatar URL for an author email, or null when none can be built.
 * `size` is the rendered px box; the request asks for 2× for retina sharpness.
 */
export const gitAvatarUrl = async (email: string, size = 18): Promise<string | null> => {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  const px = size * 2
  const key = `${px}:${normalized}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const url = await resolve(normalized, px)
  cache.set(key, url)
  return url
}
