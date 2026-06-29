// `git.remoteAdd` — thêm một remote mới (`git remote add <name> <url>`).
// cwd = workspaceRoot (security invariant #3). name + url đi qua execFile arg array
// (không shell) nên không có bề mặt command injection; vẫn validate ký tự + chặn
// name/url bắt đầu bằng `-` để git không hiểu nhầm thành flag. Remote trùng tên →
// git exit ≠ 0 ("remote <name> already exists") → surface lên UI.
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

// Remote URL: non-empty, no control chars, no leading dash.
const RemoteUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine((s) => !/[\r\n\t]/.test(s), 'must not contain control characters')
  .refine((s) => !s.startsWith('-'), 'must not start with "-"')

const Params = z.object({
  workspaceRoot: z.string().min(1),
  name: RemoteName,
  url: RemoteUrl,
})

register('git.remoteAdd', async (raw): Promise<{ ok: true }> => {
  const params = Params.parse(raw)
  await runGit(params.workspaceRoot, ['remote', 'add', params.name, params.url])
  return { ok: true }
})
