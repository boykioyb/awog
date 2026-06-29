// `git.setIdentity` — ghi commit identity (user.name / user.email) ở scope global
// hoặc repo-local. Value rỗng → `--unset` để xoá override (cho phép local fall
// back về global). cwd = workspaceRoot (security invariant #3). Config key là
// literal cố định, value đi qua execFile arg array nên không có bề mặt command
// injection. Scope=local mà workspace chưa phải repo → runGit throw NO_REPO tự
// nhiên (surface lên UI).
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'
import { GIT_RPC_CODE, mapStderrToCode, sanitizeStderr } from '../git/error-map.js'

const IdentityField = z
  .string()
  .max(255)
  .refine((s) => !/[\r\n]/.test(s), 'must not contain a newline')

const Params = z
  .object({
    workspaceRoot: z.string().min(1),
    scope: z.enum(['global', 'local']),
    name: IdentityField.optional(),
    email: IdentityField.optional(),
  })
  .refine((p) => p.name !== undefined || p.email !== undefined, {
    message: 'name or email is required',
  })

type Scope = 'global' | 'local'
type Key = 'user.name' | 'user.email'

async function writeOne(workspaceRoot: string, scope: Scope, key: Key, value: string): Promise<void> {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    // Xoá key: exit 5 = "key chưa tồn tại" → coi như no-op, không phải lỗi.
    const r = await runGit(workspaceRoot, ['config', `--${scope}`, '--unset', key], {
      throwOnNonZero: false,
    })
    if (r.code !== 0 && r.code !== 5) {
      throw new RpcError(GIT_RPC_CODE, sanitizeStderr(r.stderr) || `git config --unset ${key} failed`, {
        gitCode: mapStderrToCode(r.stderr),
      })
    }
    return
  }
  await runGit(workspaceRoot, ['config', `--${scope}`, key, trimmed])
}

register('git.setIdentity', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  if (params.name !== undefined) {
    await writeOne(params.workspaceRoot, params.scope, 'user.name', params.name)
  }
  if (params.email !== undefined) {
    await writeOne(params.workspaceRoot, params.scope, 'user.email', params.email)
  }
  return { ok: true }
})
