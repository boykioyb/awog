// `git.remoteRemove` — gỡ một remote (`git remote remove <name>`).
// cwd = workspaceRoot (security invariant #3). name đi qua execFile arg array
// (không shell) nên không có bề mặt command injection; vẫn validate ký tự + chặn
// name bắt đầu bằng `-` để git không hiểu nhầm thành flag. Remote không tồn tại →
// git exit ≠ 0 ("No such remote") → runGit map REMOTE_NOT_FOUND, surface lên UI.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'

// Git remote name: alnum + . _ - (no slash, no leading dash, no whitespace).
const RemoteName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._-]+$/, 'invalid remote name')
  .refine((s) => !s.startsWith('-'), 'must not start with "-"')

const Params = z.object({
  workspaceRoot: z.string().min(1),
  name: RemoteName,
})

register('git.remoteRemove', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  await runGit(params.workspaceRoot, ['remote', 'remove', params.name])
  return { ok: true }
})
