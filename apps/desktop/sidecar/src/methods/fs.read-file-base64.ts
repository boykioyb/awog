import { z } from 'zod'
import { open, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import type { FsFileBase64 } from '../types/shared.js'

// Read a file's raw bytes as base64 for in-app preview of rich/binary formats
// (PDF, images) that fs.readFile can't carry (it returns '' for binary). Capped
// well above the text reader since PDFs are larger; a file past the cap is NOT
// partially read (a half PDF won't render) — we return truncated=true with an
// empty payload so the caller falls back to opening externally. Security
// invariant #2: path gated by assertInsideWorkspace.

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const HARD_MAX_BYTES = 25 * 1024 * 1024

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(HARD_MAX_BYTES).optional(),
})

// Extension → MIME for the renderer Blob. Best-effort; absent = octet-stream.
const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const mimeOf = (path: string): string =>
  EXT_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

register('fs.readFileBase64', async (raw): Promise<FsFileBase64> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)
  const maxBytes = params.maxBytes ?? DEFAULT_MAX_BYTES

  const st = await stat(abs)
  if (st.isDirectory()) {
    throw new RpcError(-32602, 'Path is a directory')
  }

  // Past the cap → don't read partial bytes (useless for a PDF/image preview).
  const tooLarge = st.size > maxBytes
  let base64 = ''
  if (!tooLarge) {
    const buffer = Buffer.alloc(st.size)
    const handle = await open(abs, 'r')
    try {
      await handle.read(buffer, 0, st.size, 0)
    } finally {
      await handle.close()
    }
    base64 = buffer.toString('base64')
  }

  return {
    path: params.path,
    base64,
    mimeType: mimeOf(params.path),
    size: st.size,
    truncated: tooLarge,
  }
})
