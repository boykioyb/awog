// `git.formatPatch` — render a single commit as a .patch file. If `savePath`
// is provided we write to that absolute path on disk (caller is responsible
// for picking a path via a vetted save dialog). Otherwise return the patch
// text for clipboard / inline use.
import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { GIT_RPC_CODE, GitErrorCode } from '../git/error-map.js'

const SHA_RE = /^[a-fA-F0-9]{4,40}$/

const Params = z.object({
  workspaceRoot: z.string().min(1),
  sha: z.string(),
  savePath: z.string().optional(),
})

interface Result {
  ok: true
  path?: string
  patch?: string
}

register('git.formatPatch', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  if (!SHA_RE.test(params.sha)) {
    throw new RpcError(GIT_RPC_CODE, 'Invalid sha', { gitCode: GitErrorCode.INVALID_REF })
  }
  if (params.savePath !== undefined && !isAbsolute(params.savePath)) {
    // Relative paths would resolve against sidecar CWD, which is surprising —
    // require an absolute path (the Tauri save dialog returns one).
    throw new RpcError(GIT_RPC_CODE, 'savePath phải là absolute path', {
      gitCode: GitErrorCode.INVALID_PATH,
    })
  }

  // `format-patch -1 <sha> --stdout` is read-only; no lock + no echo needed.
  // maxBuffer bumped because patches for large commits can exceed the default
  // when binary diffs are present.
  const r = await runGit(
    params.workspaceRoot,
    ['format-patch', '-1', params.sha, '--stdout'],
    { maxBuffer: 64 * 1024 * 1024 },
  )

  if (params.savePath !== undefined) {
    await writeFile(params.savePath, r.stdout, 'utf8')
    return { ok: true, path: params.savePath }
  }
  return { ok: true, patch: r.stdout }
})
