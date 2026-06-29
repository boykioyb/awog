// `git.getIdentity` — đọc commit identity (user.name / user.email) ở cả hai scope:
// global (~/.gitconfig) và repo-local (.git/config). Read-only; không bao giờ
// throw khi key chưa set (git exit 1) hoặc workspace chưa phải repo (git exit
// 128) — các trường hợp đó trả về null. cwd = workspaceRoot theo security
// invariant #3. Config key là literal cố định (không từ payload UI).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
})

type IdentityValue = { name: string | null; email: string | null }

interface Result {
  global: IdentityValue
  local: IdentityValue
}

type Scope = 'global' | 'local'
type Key = 'user.name' | 'user.email'

async function readConfig(workspaceRoot: string, scope: Scope, key: Key): Promise<string | null> {
  // `--get` trả value + exit 0 khi set; exit 1 khi key chưa có; exit 128 khi
  // scope=local mà workspace không phải repo. Không throw — mọi exit ≠ 0 → null.
  const r = await runGit(workspaceRoot, ['config', `--${scope}`, '--get', key], {
    throwOnNonZero: false,
  })
  if (r.code !== 0) return null
  const v = r.stdout.replace(/\r?\n$/, '')
  return v.length > 0 ? v : null
}

register('git.getIdentity', async (raw): Promise<Result> => {
  const { workspaceRoot } = Params.parse(raw)
  const [gName, gEmail, lName, lEmail] = await Promise.all([
    readConfig(workspaceRoot, 'global', 'user.name'),
    readConfig(workspaceRoot, 'global', 'user.email'),
    readConfig(workspaceRoot, 'local', 'user.name'),
    readConfig(workspaceRoot, 'local', 'user.email'),
  ])
  return {
    global: { name: gName, email: gEmail },
    local: { name: lName, email: lEmail },
  }
})
