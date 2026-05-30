// `git.readConflictFile` — read a merge-conflicted file and parse the
// `<<<<<<<` / `=======` / `>>>>>>>` marker blocks into structured form so the
// UI can render a 2-way picker. Read-only: no mutex, no echo suppression.
// Per ADR 0017 + spec AC-32.
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
})

export interface GitMergeConflictBlock {
  index: number
  startLine: number
  separatorLine: number
  endLine: number
  ours: string[]
  theirs: string[]
  oursLabel: string
  theirsLabel: string
}

interface Result {
  path: string
  isBinary: boolean
  blocks: GitMergeConflictBlock[]
}

// UTF-8 BOM (EF BB BF) and UTF-16 BOMs (FE FF / FF FE) — anything else flagged
// as non-UTF-8 per ADR 0017 OQ-6.
function stripBom(buf: Buffer): { buf: Buffer; encoding: 'utf8' | 'unsupported' } {
  if (buf.length >= 2) {
    const b0 = buf[0]
    const b1 = buf[1]
    if ((b0 === 0xfe && b1 === 0xff) || (b0 === 0xff && b1 === 0xfe)) {
      return { buf, encoding: 'unsupported' }
    }
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { buf: buf.subarray(3), encoding: 'utf8' }
  }
  return { buf, encoding: 'utf8' }
}

function detectBinary(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, 8192))
  for (let i = 0; i < probe.length; i += 1) {
    if (probe[i] === 0x00) return true
  }
  return false
}

// Detect the replacement char (U+FFFD = 0xEF 0xBF 0xBD) after UTF-8 decode —
// presence implies the original bytes weren't valid UTF-8.
function decodedHasReplacement(s: string): boolean {
  return s.includes('�')
}

export function parseConflictBlocks(text: string): GitMergeConflictBlock[] {
  // Preserve original line endings by splitting on `\n` then trimming the `\r`
  // when reading content. Marker detection is `\n`-agnostic.
  const lines = text.split('\n')
  const blocks: GitMergeConflictBlock[] = []
  let i = 0
  let blockIdx = 0
  while (i < lines.length) {
    const line = (lines[i] ?? '').replace(/\r$/, '')
    if (line.startsWith('<<<<<<<')) {
      const startLine = i + 1
      const oursLabel = line.slice('<<<<<<<'.length).trim()
      let separatorLine = -1
      const ours: string[] = []
      const theirs: string[] = []
      let j = i + 1
      while (j < lines.length) {
        const rawJ = lines[j] ?? ''
        const lj = rawJ.replace(/\r$/, '')
        if (lj === '=======') {
          separatorLine = j + 1
          break
        }
        ours.push(rawJ)
        j += 1
      }
      if (separatorLine === -1) {
        // Stray `<<<<<<<` without matching separator — abort parsing this
        // block, advance past it so we don't infinite loop.
        i += 1
        continue
      }
      let k = separatorLine // 1-based; lines[separatorLine] is `=======`
      let endLine = -1
      let theirsLabel = ''
      while (k < lines.length) {
        const rawK = lines[k] ?? ''
        const lk = rawK.replace(/\r$/, '')
        if (lk.startsWith('>>>>>>>')) {
          endLine = k + 1
          theirsLabel = lk.slice('>>>>>>>'.length).trim()
          break
        }
        theirs.push(rawK)
        k += 1
      }
      if (endLine === -1) {
        i = j + 1
        continue
      }
      blocks.push({
        index: blockIdx,
        startLine,
        separatorLine,
        endLine,
        ours,
        theirs,
        oursLabel,
        theirsLabel,
      })
      blockIdx += 1
      i = endLine // 1-based endLine == 0-based index of next line
      continue
    }
    i += 1
  }
  return blocks
}

register('git.readConflictFile', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)

  const buf = await readFile(abs)
  const { buf: payload, encoding } = stripBom(buf)
  if (encoding === 'unsupported') {
    throw new RpcError(GIT_RPC_CODE, 'Encoding không hỗ trợ — mở external editor', {
      gitCode: GitErrorCode.ENCODING_UNSUPPORTED,
    })
  }
  if (detectBinary(payload)) {
    return { path: params.path, isBinary: true, blocks: [] }
  }
  const text = payload.toString('utf8')
  if (decodedHasReplacement(text)) {
    throw new RpcError(GIT_RPC_CODE, 'Encoding không hỗ trợ — mở external editor', {
      gitCode: GitErrorCode.ENCODING_UNSUPPORTED,
    })
  }
  return { path: params.path, isBinary: false, blocks: parseConflictBlocks(text) }
})
