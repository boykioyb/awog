import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { parseLogFormat } from '../git/parser.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import type { GitCommit } from '../git/types.js'

// Refs allowed in `ref` field. Reject suspicious chars to prevent flag
// injection; git's own ref parser will catch the rest.
const SAFE_REF = /^(?!-)[A-Za-z0-9._/@^~+-]{1,200}$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  limit: z.number().int().min(1).max(1000),
  skip: z.number().int().min(0).optional(),
  ref: z.string().optional(),
  path: z.string().optional(),
})

// %D = ref decoration (e.g. `HEAD -> main, tag: v1.0, origin/main`). Slotted
// between parents (%P) and subject (%s); subject + body stay last because body
// can contain almost anything (the record separator %x1e is the only thing we
// rely on terminating a record). `--decorate=full` makes refs absolute
// (`refs/heads/main`, `refs/tags/v1.0`, …) so the parser can classify them.
const LOG_FORMAT = '%H%x00%h%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%P%x00%D%x00%s%x00%b%x1e'

interface Result {
  commits: GitCommit[]
  hasMore: boolean
}

register('git.log', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (params.ref !== undefined && !SAFE_REF.test(params.ref)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid ref', { gitCode: GitErrorCode.INVALID_REF })
  }
  if (params.path !== undefined) {
    assertInsideWorkspace(params.workspaceRoot, params.path)
  }

  const limit = params.limit
  const args = [
    'log',
    `--pretty=format:${LOG_FORMAT}`,
    '--decorate=full',
    '-n',
    String(limit + 1),
  ]
  if (params.skip !== undefined && params.skip > 0) args.push(`--skip=${params.skip}`)
  if (params.ref !== undefined) args.push(params.ref)
  if (params.path !== undefined) args.push('--', params.path)

  // Empty repo: `git log` exit non-zero với stderr "does not have any commits yet".
  // Return empty list thay vì throw để UI History tab render empty state thay vì
  // toast error. NO_REPO vẫn propagate (workspace chưa init).
  const r = await runGit(params.workspaceRoot, args, { throwOnNonZero: false })
  if (r.code !== 0) {
    if (/not a git repository/i.test(r.stderr)) {
      throw new RpcError(GIT_RPC_CODE, 'Not a git repository', { gitCode: GitErrorCode.NO_REPO })
    }
    if (/does not have any commits yet|bad default revision/i.test(r.stderr)) {
      return { commits: [], hasMore: false }
    }
    // Mọi lỗi khác — re-throw qua RpcError chuẩn.
    throw new RpcError(GIT_RPC_CODE, r.stderr || 'git log failed', {
      gitCode: GitErrorCode.UNKNOWN,
    })
  }
  const all = parseLogFormat(r.stdout)
  const hasMore = all.length > limit
  return { commits: hasMore ? all.slice(0, limit) : all, hasMore }
})
