import { z } from 'zod'
import { open, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import type { FsFileContent } from '../types/shared.js'

// Read-only single-file read for the Files / Preview tabs. Caps at maxBytes so
// a huge file can't blow up memory or the IPC payload; flags binary via a
// null-byte sniff. Security invariant #2: path gated by assertInsideWorkspace.

const DEFAULT_MAX_BYTES = 512 * 1024
const HARD_MAX_BYTES = 4 * 1024 * 1024

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  maxBytes: z.number().int().positive().max(HARD_MAX_BYTES).optional(),
})

// Extension → Monaco/highlight language hint. Best-effort; absent = plain.
const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.vue': 'vue',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.sh': 'shell',
  '.toml': 'toml',
  '.sql': 'sql',
}

const languageOf = (path: string): string | undefined => EXT_LANG[extname(path).toLowerCase()]

register('fs.readFile', async (raw): Promise<FsFileContent> => {
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

  const readLen = Math.min(st.size, maxBytes)
  const buffer = Buffer.alloc(readLen)
  const handle = await open(abs, 'r')
  try {
    await handle.read(buffer, 0, readLen, 0)
  } finally {
    await handle.close()
  }

  const language = languageOf(params.path)
  const isBinary = buffer.includes(0)
  const result: FsFileContent = {
    path: params.path,
    content: isBinary ? '' : buffer.toString('utf8'),
    truncated: st.size > readLen,
    isBinary,
  }
  if (language !== undefined) result.language = language
  return result
})
