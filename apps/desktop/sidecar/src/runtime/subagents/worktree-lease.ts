// Worktree cô lập cho subagent của MỘT lượt chat (ADR 0083 §c, thực hiện ở gói #7c).
//
// Vì sao mỏng thế này: toàn bộ cơ chế thật — checkout, neo nhánh, commit WIP cứu
// việc chưa lưu, sweeper dọn mồ côi ở boot — nằm ở `tasks/worktree.ts`, đã được
// tổng quát hoá sang khoá theo owner `{ kind: 'task' | 'session', id }`. File này
// chỉ là phần vòng đời riêng của chat: giữ danh sách lease của một lượt và nhả
// hết khi lượt kết thúc. KHÔNG fork bản worktree thứ hai.
//
// Ranh giới sản phẩm — cô lập, KHÔNG tự merge:
//   `integrateTaskBranches()` merge vào nhánh người dùng đang checkout. Task có
//   quyền đó vì người dùng đã bật auto-commit per-phase và task có "điểm ráo" để
//   merge. Một lượt chat KHÔNG có công tắc nào như vậy, nên subagent chỉ được
//   một branch riêng: cây làm việc của người dùng không nhúc nhích một byte, và
//   họ tự `git merge` khi muốn. Branch không mang commit nào bị `git branch -d`
//   dọn lúc release, nên subagent chỉ-đọc không để lại dấu vết.
//
// Vòng đời = ĐÚNG BẰNG lượt cha (giống registry.ts): `releaseAll()` được gọi
// trong `disposeAll()` của toolset. App chết giữa chừng ⇒ `sweepOrphanWorktrees()`
// lúc boot bắt được, vì owner `session` nằm trong `listOwners()`.

import { acquireWorkspace, releaseWorkspace } from '../../tasks/worktree.js'
import type { IsolatedWorkspace, WorkspaceOwner } from '../../tasks/worktree.js'
import { log } from '../../util/logger.js'

// Trần số checkout cô lập sống cùng lúc trong một lượt. Cùng con số với trần
// subagent nền và trần scheduler của Task — một mô hình duy nhất cho "AWOG tự
// fan-out rộng bao nhiêu" — và mỗi checkout là một bản sao cây làm việc thật.
export const MAX_ISOLATED_SUBAGENTS = 4

export interface Lease {
  // cwd cho subagent: worktree riêng, hoặc cây gốc khi không cô lập được.
  cwd: string
  // Branch của worktree — chỉ set khi cô lập THÀNH CÔNG.
  branch?: string
  // Câu giải thích cho model khi yêu cầu cô lập không được đáp ứng.
  note?: string
}

export class WorktreeLeases {
  private readonly leases: IsolatedWorkspace[] = []

  constructor(
    private readonly owner: WorkspaceOwner,
    private readonly projectPath: string,
  ) {}

  get count(): number {
    return this.leases.length
  }

  // Cấp một worktree cho subagent. Không cô lập được (không phải git repo, git
  // quá cũ, HEAD detached, hết trần) ⇒ trả cây gốc + `note` để tool result nói
  // thẳng cho model, thay vì im lặng chạy chung rồi giẫm chân nhau.
  async acquire(slug: string): Promise<Lease> {
    if (this.leases.length >= MAX_ISOLATED_SUBAGENTS) {
      return {
        cwd: this.projectPath,
        note: `The isolated-worktree limit (${MAX_ISOLATED_SUBAGENTS} per turn) was already reached, so this subagent ran in the shared working tree.`,
      }
    }
    const ws = await acquireWorkspace({
      owner: this.owner,
      slug,
      projectPath: this.projectPath,
      policy: 'always',
    })
    if (!ws.isolated || !ws.branch) {
      return {
        cwd: ws.cwd,
        note: 'Worktree isolation was unavailable here (not a git repository, git older than 2.20, or a detached HEAD), so this subagent ran in the shared working tree.',
      }
    }
    this.leases.push(ws)
    return { cwd: ws.cwd, branch: ws.branch }
  }

  // Hết lượt cha: nhả mọi checkout. Việc chưa commit được cứu thành commit WIP
  // trên chính branch của subagent (lưới F8a của ADR 0081), nên không có đường
  // nào xoá mất thứ agent vừa làm. Branch còn commit thì GIỮ — đó là thứ người
  // dùng lấy về; branch rỗng bị git tự dọn.
  async releaseAll(): Promise<void> {
    const pending = this.leases.splice(0, this.leases.length)
    for (const ws of pending) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await releaseWorkspace(this.owner, ws).catch((err: unknown) => {
        log.warn('releasing a subagent worktree failed', {
          owner: `${this.owner.kind}:${this.owner.id}`,
          dir: ws.cwd,
          err: err instanceof Error ? err.message : String(err),
        })
        return undefined
      })
      if (!outcome) continue
      if (outcome.status === 'retained') {
        log.error('subagent worktree kept — uncommitted work could not be rescued', {
          owner: `${this.owner.kind}:${this.owner.id}`,
          path: outcome.path,
          detail: outcome.detail,
        })
        continue
      }
      if (outcome.branch) {
        log.info('subagent left work on an isolated branch', {
          owner: `${this.owner.kind}:${this.owner.id}`,
          branch: outcome.branch,
          rescued: outcome.status === 'rescued',
        })
      }
    }
  }
}
