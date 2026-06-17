import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parseUnifiedDiff } from '../git/parser.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import type { GitDiff } from '../git/types.js'

const SHA_RE = /^[a-fA-F0-9]{4,40}$/
const SAFE_REF = /^(?!-)[A-Za-z0-9._/@^~+-]{1,200}$/

const WorkingTree = z.object({
  kind: z.literal('workingTree'),
  workspaceRoot: z.string().min(1),
  path: z.string().optional(),
})
const Staged = z.object({
  kind: z.literal('staged'),
  workspaceRoot: z.string().min(1),
  path: z.string().optional(),
})
// Untracked file: `git diff` ignores it (the path is not in the index), so the
// UI would show "No changes". Diff against the null device instead — the whole
// file renders as additions. Requires a concrete path.
const Untracked = z.object({
  kind: z.literal('untracked'),
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
})
const Commit = z.object({
  kind: z.literal('commit'),
  workspaceRoot: z.string().min(1),
  sha: z.string(),
})
const CommitRange = z.object({
  kind: z.literal('commitRange'),
  workspaceRoot: z.string().min(1),
  from: z.string(),
  to: z.string(),
})
// "Compare to Local Changes" — diff of a commit against the current working
// tree (no --cached, no range — straight `git diff <sha>`). Lets the user see
// what their uncommitted state would look like on top of an arbitrary commit.
const CommitVsWorkingTree = z.object({
  kind: z.literal('commitVsWorkingTree'),
  workspaceRoot: z.string().min(1),
  sha: z.string(),
})
const Params = z.discriminatedUnion('kind', [
  WorkingTree,
  Staged,
  Untracked,
  Commit,
  CommitRange,
  CommitVsWorkingTree,
])

function assertSha(s: string): void {
  if (!SHA_RE.test(s) && !SAFE_REF.test(s)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid ref', { gitCode: GitErrorCode.INVALID_REF })
  }
}

register('git.diff', async (raw): Promise<GitDiff> => {
  const params = Params.parse(raw)
  let args: string[]
  switch (params.kind) {
    case 'workingTree': {
      if (params.path) assertInsideWorkspace(params.workspaceRoot, params.path)
      args = ['diff', '--no-color', '--find-renames']
      if (params.path) args.push('--', params.path)
      break
    }
    case 'staged': {
      if (params.path) assertInsideWorkspace(params.workspaceRoot, params.path)
      args = ['diff', '--cached', '--no-color', '--find-renames']
      if (params.path) args.push('--', params.path)
      break
    }
    case 'untracked': {
      assertInsideWorkspace(params.workspaceRoot, params.path)
      // --no-index returns exit code 1 when content differs (it always does
      // for a new file vs /dev/null) — that is the documented "differences
      // found" signal, not a failure, so don't throw on non-zero.
      const r = await runGit(
        params.workspaceRoot,
        ['diff', '--no-index', '--no-color', '--', '/dev/null', params.path],
        { throwOnNonZero: false },
      )
      return { files: parseUnifiedDiff(r.stdout) }
    }
    case 'commit': {
      assertSha(params.sha)
      args = ['show', '--no-color', '--find-renames', '--format=', params.sha]
      break
    }
    case 'commitRange': {
      assertSha(params.from)
      assertSha(params.to)
      args = ['diff', '--no-color', '--find-renames', `${params.from}..${params.to}`]
      break
    }
    case 'commitVsWorkingTree': {
      assertSha(params.sha)
      args = ['diff', '--no-color', '--find-renames', params.sha]
      break
    }
    default: {
      // Exhaustiveness — unreachable.
      const _exhaust: never = params
      throw new RpcError(GIT_RPC_CODE, 'Invalid params', { gitCode: GitErrorCode.UNKNOWN, _exhaust })
    }
  }

  const r = await runGit(params.workspaceRoot, args)
  return { files: parseUnifiedDiff(r.stdout) }
})
