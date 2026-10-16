// Upstream của branch hiện tại cho pull/push KHÔNG cần người dùng tự `--set-upstream`.
//
// Luật an toàn (cũng là luật trong CLAUDE.md của người dùng): chỉ bao giờ gắn branch
// local vào branch CÙNG TÊN trên remote — `feat/x` → `origin/feat/x`. Không bao giờ
// đoán sang `develop`/`main`/branch khác tên: upstream trỏ vào branch chung là con
// đường feature commit bị push thẳng lên nhánh chung, bỏ qua PR.
import { runGit } from './runner.js'

export type UpstreamPlan =
  // Branch đã có upstream — để git tự làm như thường.
  | { kind: 'tracked' }
  // Chưa có upstream: dùng `<remote> <branch>` cùng tên.
  | { kind: 'untracked'; remote: string; branch: string }
  // Không có remote nào để gắn.
  | { kind: 'no-remote'; branch: string }

// Branch hiện tại (đã kiểm không detached ở caller) + upstream của nó.
export async function planUpstream(workspaceRoot: string, branch: string): Promise<UpstreamPlan> {
  const up = await runGit(
    workspaceRoot,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { throwOnNonZero: false },
  )
  if (up.code === 0 && up.stdout.trim()) return { kind: 'tracked' }
  const remote = await defaultRemote(workspaceRoot)
  return remote ? { kind: 'untracked', remote, branch } : { kind: 'no-remote', branch }
}

// `origin` nếu có, không thì remote DUY NHẤT; nhiều remote mà không có origin ⇒ không
// đoán (null) — chọn sai remote là đẩy code lên nhầm chỗ.
async function defaultRemote(workspaceRoot: string): Promise<string | null> {
  const res = await runGit(workspaceRoot, ['remote'], { throwOnNonZero: false })
  const remotes = res.stdout
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
  if (remotes.includes('origin')) return 'origin'
  return remotes.length === 1 ? remotes[0]! : null
}

// Gắn tracking `<remote>/<branch>` cho branch local cùng tên (sau khi pull/push qua
// refspec tường minh đã tạo remote-tracking ref). Best-effort: lỗi chỉ có nghĩa lần
// sau lại đi đường tường minh, pull/push vừa rồi vẫn thành công.
export async function setUpstreamSameName(workspaceRoot: string, remote: string, branch: string): Promise<boolean> {
  const res = await runGit(workspaceRoot, ['branch', `--set-upstream-to=${remote}/${branch}`, branch], {
    throwOnNonZero: false,
  })
  return res.code === 0
}
