// `git.remoteSetUrl` — đổi fetch và/hoặc push URL của một remote
// (`git remote set-url [--push] <name> <url>`). cwd = workspaceRoot (security
// invariant #3). name + url đi qua execFile arg array (không shell) nên không có
// bề mặt command injection; vẫn validate ký tự + chặn URL/name bắt đầu bằng `-`
// để git không hiểu nhầm thành flag. Remote không tồn tại → runGit throw
// REMOTE_NOT_FOUND tự nhiên (surface lên UI).
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'

// Git remote name: alnum + . _ - (no slash, no leading dash, no whitespace).
const RemoteName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._-]+$/, 'invalid remote name')
  .refine((s) => !s.startsWith('-'), 'must not start with "-"')

// Remote URL: any non-empty value without control chars; reject a leading dash so
// it can never be parsed as a git option.
const RemoteUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine((s) => !/[\r\n\t]/.test(s), 'must not contain control characters')
  .refine((s) => !s.startsWith('-'), 'must not start with "-"')

const Params = z
  .object({
    workspaceRoot: z.string().min(1),
    name: RemoteName,
    fetchUrl: RemoteUrl.optional(),
    pushUrl: RemoteUrl.optional(),
  })
  .refine((p) => p.fetchUrl !== undefined || p.pushUrl !== undefined, {
    message: 'fetchUrl or pushUrl is required',
  })

register('git.remoteSetUrl', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (params.fetchUrl === undefined && params.pushUrl === undefined) {
    throw new RpcError(GIT_RPC_CODE, 'fetchUrl or pushUrl is required', {
      gitCode: GitErrorCode.UNKNOWN,
    })
  }
  if (params.fetchUrl !== undefined) {
    await runGit(params.workspaceRoot, ['remote', 'set-url', params.name, params.fetchUrl])
  }
  if (params.pushUrl !== undefined) {
    await runGit(params.workspaceRoot, ['remote', 'set-url', '--push', params.name, params.pushUrl])
  }
  return { ok: true }
})
