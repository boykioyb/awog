import { z } from 'zod'
import { writeFile, rename, stat } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'

// Atomic save for the Project workspace editor (ADR 0022). Writes to a sibling
// `.tmp` then renames so a crash never leaves a half-written file (mirrors
// projects/store.ts). Security invariant #2: path gated by assertInsideWorkspace;
// content is opaque bytes — the sidecar never evals/parses it (invariant #8).

// Cap so the editor can't push a pathological payload through the IPC channel.
const MAX_BYTES = 8 * 1024 * 1024

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
})

register('fs.writeFile', async (raw): Promise<{ bytesWritten: number }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)

  const bytes = Buffer.byteLength(params.content, 'utf8')
  if (bytes > MAX_BYTES) {
    throw new RpcError(-32602, `File too large to write (> ${MAX_BYTES} bytes)`)
  }

  // Refuse to clobber a directory with a file write.
  try {
    const st = await stat(abs)
    if (st.isDirectory()) throw new RpcError(-32602, 'Path is a directory')
  } catch (err) {
    if (err instanceof RpcError) throw err
    // ENOENT — new file, fine.
  }

  // Random suffix so concurrent saves of the same file (same pid) can't collide
  // on the temp path (infosec F4).
  const tmp = `${abs}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  await writeFile(tmp, params.content, 'utf8')
  await rename(tmp, abs)
  return { bytesWritten: bytes }
})
