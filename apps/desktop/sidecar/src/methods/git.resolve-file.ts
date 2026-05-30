// `git.resolveFile` — apply per-block ours/theirs choices to a conflicted
// text file and stage the result. Defense in depth: re-reads + re-parses the
// file at the sidecar so a stale UI cache can't desync the resolution. Writes
// via atomic rename (tmp + rename) to avoid TOCTOU. Per ADR 0017 + spec
// AC-34 + "Conflict resolver UI v1".
import { readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { relative } from 'node:path'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { emit } from '../transport/stdio.js'
import { parseConflictBlocks } from './git.read-conflict-file.js'

const Resolution = z.object({
  blockIndex: z.number().int().nonnegative(),
  choice: z.enum(['ours', 'theirs']),
})

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  resolutions: z.array(Resolution).min(1),
})

// Detect the file's dominant line ending so the rewrite keeps the original
// convention (most files are uniform; default to LF when ambiguous).
function detectLineEnding(text: string): '\r\n' | '\n' {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf > lf ? '\r\n' : '\n'
}

register('git.resolveFile', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)
  const rel = relative(params.workspaceRoot, abs) || '.'

  await withWorkspaceLock(params.workspaceRoot, async () => {
    suppressEchoFor(params.workspaceRoot)

    const text = await readFile(abs, 'utf8')
    const blocks = parseConflictBlocks(text)
    if (blocks.length === 0) {
      throw new RpcError(GIT_RPC_CODE, 'File không có conflict block', {
        gitCode: GitErrorCode.MERGE_CONFLICT,
      })
    }
    if (params.resolutions.length !== blocks.length) {
      throw new RpcError(
        GIT_RPC_CODE,
        `Cần ${blocks.length} resolution(s) — nhận ${params.resolutions.length}`,
        { gitCode: GitErrorCode.MERGE_CONFLICT },
      )
    }
    const choiceByIndex = new Map<number, 'ours' | 'theirs'>()
    for (const r of params.resolutions) choiceByIndex.set(r.blockIndex, r.choice)
    for (const b of blocks) {
      if (!choiceByIndex.has(b.index)) {
        throw new RpcError(GIT_RPC_CODE, `Block ${b.index} chưa được resolve`, {
          gitCode: GitErrorCode.MERGE_CONFLICT,
        })
      }
    }

    const eol = detectLineEnding(text)
    // Split with `\n` to keep block boundaries; strip trailing `\r` from each
    // line so we don't double up when rejoining with `eol`. Each ours/theirs
    // line is normalized identically.
    const stripCr = (s: string): string => s.replace(/\r$/, '')
    const rawLines = text.split('\n').map(stripCr)

    // Walk lines, copy verbatim outside blocks, replace block content with the
    // chosen side's lines.
    const out: string[] = []
    let cursor = 0 // 1-based line number we've emitted up to (exclusive).
    for (const block of blocks) {
      // Append lines before this block: lines indexed [cursor + 1 .. startLine - 1].
      for (let n = cursor + 1; n < block.startLine; n += 1) {
        out.push(rawLines[n - 1] ?? '')
      }
      const chosen = choiceByIndex.get(block.index) === 'ours' ? block.ours : block.theirs
      for (const line of chosen) out.push(stripCr(line))
      cursor = block.endLine // skip past `>>>>>>>` line
    }
    // Trailing content after the last block.
    for (let n = cursor + 1; n <= rawLines.length; n += 1) {
      out.push(rawLines[n - 1] ?? '')
    }

    // Preserve trailing newline if the original had one. `text.split('\n')`
    // leaves an empty string at the end when the file ended with `\n`.
    const hadTrailingNewline = text.endsWith('\n')
    let payload = out.join(eol)
    // If we already produced a trailing empty token via the split convention
    // (i.e. last `out` entry is ''), `join` already added the terminator
    // separator before it; just normalise.
    if (hadTrailingNewline && !payload.endsWith(eol)) payload += eol

    // Atomic rename: write to sibling tmp first then `rename(tmp, target)`.
    const tmp = `${abs}.tmp.${randomBytes(6).toString('hex')}`
    await writeFile(tmp, payload, 'utf8')
    try {
      await rename(tmp, abs)
    } catch (err) {
      await unlink(tmp).catch(() => undefined)
      throw err
    }

    await runGit(params.workspaceRoot, ['add', '--', rel])
  })

  emit('git:status:changed', { reason: 'stage', workspaceRoot: params.workspaceRoot })
  return { ok: true }
})
