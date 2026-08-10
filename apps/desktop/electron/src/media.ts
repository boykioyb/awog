import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { log } from './logger'
import { resolveInsideWorkspace } from './workspace-scope'

// Custom scheme for streaming workspace media (video / audio) into the in-app
// PreviewModal. Unlike fs.readFileBase64 — which buffers the whole file into a
// base64 data: URL (capped at 25 MB, can't seek, and would push a huge string
// through the stdio JSON-RPC pipe) — this serves the file straight off disk with
// HTTP Range support, so large videos play and scrub like they would in a
// browser, holding only the current window in memory.
//
// URL shape (MUST match mediaFileUrl() in ui-next composables/usePreview.ts):
//   media://awog/?root=<enc workspaceRoot>&path=<enc workspace-relative path>
// A preview reload appends a `&v=<n>` cache-buster so the element re-requests a file
// rewritten in place; only root+path are read here, any other param is ignored.
// The path is validated inside the workspace via resolveInsideWorkspace before a
// single byte is read (security invariant #2) — a request that escapes the root
// (traversal / symlink) is rejected with 403 and never served.
export const MEDIA_SCHEME = 'media'

// Extension → MIME for the media element. Only formats Chromium can decode are
// worth serving; an unknown extension falls back to octet-stream (the element
// then errors and the modal shows its "open externally" fallback).
const EXT_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.weba': 'audio/webm',
}
const mimeOf = (p: string): string =>
  EXT_MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'

// Parse a single `bytes=start-end` range header against the known file size.
// Returns null for a missing / malformed / unsatisfiable range → the caller
// serves the whole file (200). Supports the suffix form `bytes=-N` (last N bytes)
// that some players use to probe the moov atom at the end of an MP4.
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return null
  let start: number
  let end: number
  if (rawStart === '') {
    const n = Number(rawEnd)
    if (!Number.isFinite(n) || n <= 0) return null
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

let registered = false

// Register the media:// stream handler. Idempotent (protocol.handle throws if the
// same scheme is registered twice). Must run after app.whenReady().
export function registerMediaProtocol(): void {
  if (registered) return
  registered = true

  protocol.handle(MEDIA_SCHEME, async (request) => {
    // ── resolve + validate path (invariant #2) ──────────────────────────────
    let abs: string
    let mime: string
    try {
      const url = new URL(request.url)
      const root = url.searchParams.get('root')
      const rel = url.searchParams.get('path')
      if (!root || !rel) return new Response('bad request', { status: 400 })
      abs = resolveInsideWorkspace(root, rel) // throws if it escapes the workspace
      mime = mimeOf(abs)
    } catch (err) {
      log.error(`[media] rejected: ${err instanceof Error ? err.message : String(err)}`)
      return new Response('forbidden', { status: 403 })
    }

    // ── stream the file (with Range) ─────────────────────────────────────────
    try {
      const st = await stat(abs)
      if (st.isDirectory()) return new Response('not a file', { status: 400 })
      const size = st.size
      const range = parseRange(request.headers.get('range'), size)

      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      }

      if (range) {
        const { start, end } = range
        const stream = createReadStream(abs, { start, end })
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`
        headers['Content-Length'] = String(end - start + 1)
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
          status: 206,
          headers,
        })
      }

      const stream = createReadStream(abs)
      headers['Content-Length'] = String(size)
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
        status: 200,
        headers,
      })
    } catch (err) {
      log.error(`[media] read failed: ${err instanceof Error ? err.message : String(err)}`)
      return new Response('not found', { status: 404 })
    }
  })
}
