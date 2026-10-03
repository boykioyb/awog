// Tests cho phần Session Teams của worktree.ts — worktree THEO MEMBERSHIP của
// member trong nhóm (docs/features/session-teams.md §4–§5): ensure lười, nhả
// theo membership, memberDiff, và cổng merge của người dùng
// integrateSessionBranch. Chạy trên repo git THẬT trong thư mục tạm, HOME trỏ
// vào thư mục tạm vì checkout + project store nằm dưới `~/.awog/`.
//
// Run: `npx vitest@2 run`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let home: string
// Import động SAU khi đặt HOME: awogHome() đọc homedir() lúc gọi.
type WorktreeModule = typeof import('../worktree.js')
let wt: WorktreeModule

const PROJECT_ID = 'proj-team'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function makeRepo(name: string): Promise<string> {
  const dir = join(home, name)
  await mkdir(dir, { recursive: true })
  git(['init', '-b', 'main'], dir)
  git(['config', 'user.email', 'test@awog.local'], dir)
  git(['config', 'user.name', 'AWOG Test'], dir)
  await writeFile(join(dir, 'base.txt'), 'base\n')
  git(['add', '-A'], dir)
  git(['commit', '-m', 'base'], dir)
  return dir
}

// Project store = ~/.awog/projects/<id>.json (projects/store.ts) — ensureSession
// Workspace tra project.path từ đây.
async function makeProject(path: string, id = PROJECT_ID): Promise<void> {
  const dir = join(home, '.awog', 'projects')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${id}.json`),
    JSON.stringify({
      id,
      name: 'team test',
      path,
      description: '',
      gitRemote: '',
      gitBranch: 'main',
      language: '',
      createdAt: new Date().toISOString(),
    }),
  )
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-team-home-'))
  process.env.HOME = home
  wt = await import('../worktree.js')
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
})

function memberSession(id: string, projectId: string | null = PROJECT_ID) {
  return { id, projectId }
}

// Git ops trong môi trường test đôi khi chậm bất ngờ (worktree add ~13s đã thấy
// trên macOS sandbox); test mặc định 5s của vitest không đủ. Các `it` nặng git
// truyền timeout này làm tham số thứ ba.
const GIT_TEST_TIMEOUT = 60_000

describe('ensureSessionWorkspace', () => {
  it('cấp worktree/team + branch awog/session/<id>/team neo vào nhánh hiện tại', async () => {
    const repoDir = await makeRepo('repo-team-ensure')
    const sessionId = 'ses-member-1'
    await makeProject(repoDir, `proj-${sessionId}`)

    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()
    // `rev-parse --show-toplevel` trả đường dẫn THẬT — macOS symlink /var →
    // /private/var nên phải so với realpath.
    expect(created?.repoPath).toBe(realpathSync(repoDir))
    expect(created?.worktreePath).toBe(
      join(home, '.awog', 'session-worktrees', sessionId, 'worktrees', 'team'),
    )
    expect(created?.branch).toBe(`awog/session/${sessionId}/team`)
    expect(created?.baseRef).toBe('main')
    expect(await exists(join(created?.worktreePath as string, 'base.txt'))).toBe(true)

    // Idempotent: gọi lại trả về bản ghi của cùng checkout đã neo.
    const again = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(again).toMatchObject({
      worktreePath: created?.worktreePath,
      branch: created?.branch,
      baseRef: 'main',
    })

    // Không đẻ task ma trong store Task (cùng bẫy ADR 0083 §c).
    expect(await exists(join(home, '.awog', 'tasks', sessionId))).toBe(false)
    await wt.releaseSessionWorkspace(sessionId)
  }, GIT_TEST_TIMEOUT)

  it('degrade về null khi không có projectId / project không phải git repo', async () => {
    expect(await wt.ensureSessionWorkspace(memberSession('ses-no-proj', null))).toBeNull()

    const plain = join(home, 'plain-dir')
    await mkdir(plain, { recursive: true })
    await makeProject(plain, 'proj-plain')
    expect(await wt.ensureSessionWorkspace(memberSession('ses-plain', 'proj-plain'))).toBeNull()

    await rm(plain, { recursive: true, force: true })
  }, GIT_TEST_TIMEOUT)

  it('HEAD detached vẫn được cấp — baseRef là SHA', async () => {
    const repoDir = await makeRepo('repo-team-detached')
    const sessionId = 'ses-detached'
    await makeProject(repoDir, `proj-${sessionId}`)
    const sha = git(['rev-parse', 'HEAD'], repoDir)
    git(['checkout', '-q', '--detach'], repoDir)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()
    expect(created?.baseRef).toBe(sha)
    expect(await exists(created?.worktreePath as string)).toBe(true)

    // Nhưng integrate không thể merge vào một HEAD rời: báo rõ lý do.
    const merged = await wt.integrateSessionBranch({
      repoPath: created?.repoPath as string,
      worktreePath: created?.worktreePath as string,
      branch: created?.branch as string,
      baseRef: created?.baseRef as string,
    })
    expect(merged.merged).toBe(false)
    if (!merged.merged) expect(merged.reason).toContain('base-not-checked-out')
    await wt.releaseSessionWorkspace(sessionId)
  }, GIT_TEST_TIMEOUT)
})

describe('releaseSessionWorkspace', () => {
  it('member có việc dở: commit WIP lên branch, xoá checkout, GIỮ branch', async () => {
    const repoDir = await makeRepo('repo-team-release')
    const sessionId = 'ses-member-rw'
    await makeProject(repoDir, `proj-${sessionId}`)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()
    const wtPath = created?.worktreePath as string
    const branch = created?.branch as string

    await writeFile(join(wtPath, 'member-work.txt'), 'half done\n')
    await wt.releaseSessionWorkspace(sessionId)

    expect(await exists(wtPath)).toBe(false)
    // Việc của member không mất: nằm trên branch của chính nó (F8a).
    expect(git(['show', `${branch}:member-work.txt`], repoDir)).toBe('half done')
    expect(git(['log', '-1', '--format=%s', branch], repoDir)).toMatch(/^WIP: rescued/)
    // Khác releaseWorkspace của lượt chạy: branch member KHÔNG bao giờ bị xoá,
    // kể cả khi merge/xoá sau đó là quyết của người dùng.
    expect(git(['branch', '--list', branch], repoDir)).toContain('team')
  }, GIT_TEST_TIMEOUT)

  it('member chỉ-đọc: checkout bị dọn nhưng branch vẫn còn', async () => {
    const repoDir = await makeRepo('repo-team-release-ro')
    const sessionId = 'ses-member-ro'
    await makeProject(repoDir, `proj-${sessionId}`)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()

    await wt.releaseSessionWorkspace(sessionId)
    expect(await exists(created?.worktreePath as string)).toBe(false)
    expect(git(['branch', '--list', created?.branch as string], repoDir)).toContain('team')
  }, GIT_TEST_TIMEOUT)

  it('không có worktree thì là no-op, không ném', async () => {
    await expect(wt.releaseSessionWorkspace('ses-ghost')).resolves.toBeUndefined()
  }, GIT_TEST_TIMEOUT)
})

describe('memberDiff', () => {
  it('null khi không có worktree; đếm đúng file + stat khi có', async () => {
    expect(await wt.memberDiff({ id: 'ses-none' })).toBeNull()

    const repoDir = await makeRepo('repo-team-diff')
    const sessionId = 'ses-member-diff'
    await makeProject(repoDir, `proj-${sessionId}`)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()

    // Hai file trên branch của member (commit trong worktree).
    const wtPath = created?.worktreePath as string
    await writeFile(join(wtPath, 'a.txt'), 'a\n')
    await writeFile(join(wtPath, 'b.txt'), 'b\n')
    git(['add', '-A'], wtPath)
    git(['commit', '-m', 'member work'], wtPath)

    const diff = await wt.memberDiff({
      id: sessionId,
      // exactOptionalPropertyTypes: gỡ hẳn key thay vì gán undefined.
      ...(created ? { worktree: created } : {}),
    })
    expect(diff).not.toBeNull()
    expect(diff?.files).toBe(2)
    expect(diff?.stat).toContain('2 files changed')
    expect(diff?.diff).toContain('a.txt')
    expect(diff?.diff).toContain('b.txt')

    await wt.releaseSessionWorkspace(sessionId)
  }, GIT_TEST_TIMEOUT)
})

describe('integrateSessionBranch', () => {
  it('merge branch của member về nhánh base, giữ branch, trả commit', async () => {
    const repoDir = await makeRepo('repo-team-merge')
    const sessionId = 'ses-merge-ok'
    await makeProject(repoDir, `proj-${sessionId}`)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()

    const wtPath = created?.worktreePath as string
    await writeFile(join(wtPath, 'feat.txt'), 'feature\n')
    git(['add', '-A'], wtPath)
    git(['commit', '-m', 'member feat'], wtPath)

    const res = await wt.integrateSessionBranch({
      repoPath: created?.repoPath as string,
      worktreePath: wtPath,
      branch: created?.branch as string,
      baseRef: 'main',
    })
    expect(res).toMatchObject({ merged: true })
    if (res.merged) expect(res.commit).toMatch(/^[0-9a-f]{40}$/)
    // Kết quả hạ cánh đúng nhánh người dùng đang checkout; branch member còn.
    expect(await exists(join(repoDir, 'feat.txt'))).toBe(true)
    expect(git(['symbolic-ref', '--short', 'HEAD'], repoDir)).toBe('main')
    expect(git(['branch', '--list', created?.branch as string], repoDir)).toContain('team')
    await wt.releaseSessionWorkspace(sessionId)
  }, GIT_TEST_TIMEOUT)

  it('repo đang ở nhánh khác ⇒ base-not-checked-out, cây người dùng không nhúc nhích', async () => {
    const repoDir = await makeRepo('repo-team-merge-head')
    const sessionId = 'ses-merge-head'
    await makeProject(repoDir, `proj-${sessionId}`)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()
    const wtPath = created?.worktreePath as string
    await writeFile(join(wtPath, 'work.txt'), 'work\n')
    git(['add', '-A'], wtPath)
    git(['commit', '-m', 'member work'], wtPath)

    git(['checkout', '-q', '-b', 'other'], repoDir)
    const headBefore = git(['rev-parse', 'HEAD'], repoDir)
    const res = await wt.integrateSessionBranch({
      repoPath: created?.repoPath as string,
      worktreePath: wtPath,
      branch: created?.branch as string,
      baseRef: 'main',
    })
    expect(res.merged).toBe(false)
    if (!res.merged) {
      expect(res.reason).toContain('base-not-checked-out')
      expect(res.reason).toContain('other')
      expect(res.reason).toContain('main')
    }
    // AWOG không checkout hộ: HEAD của người dùng y nguyên, việc không rơi vào
    // nhánh lạ, branch member còn để merge tay.
    expect(git(['rev-parse', 'HEAD'], repoDir)).toBe(headBefore)
    expect(await exists(join(repoDir, 'work.txt'))).toBe(false)
    expect(git(['branch', '--list', created?.branch as string], repoDir)).toContain('team')
    git(['checkout', '-q', 'main'], repoDir)
    await wt.releaseSessionWorkspace(sessionId)
  }, GIT_TEST_TIMEOUT)

  it('conflict ⇒ merge --abort, cây sạch, giữ branch, reason = conflict', async () => {
    const repoDir = await makeRepo('repo-team-merge-conflict')
    const sessionId = 'ses-merge-conflict'
    await makeProject(repoDir, `proj-${sessionId}`)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()

    // Hai phía sửa cùng một file ⇒ conflict thật.
    await writeFile(join(repoDir, 'shared.txt'), 'base side\n')
    git(['add', '-A'], repoDir)
    git(['commit', '-m', 'base edit'], repoDir)
    const wtPath = created?.worktreePath as string
    await writeFile(join(wtPath, 'shared.txt'), 'member side\n')
    git(['add', '-A'], wtPath)
    git(['commit', '-m', 'member edit'], wtPath)

    const res = await wt.integrateSessionBranch({
      repoPath: created?.repoPath as string,
      worktreePath: wtPath,
      branch: created?.branch as string,
      baseRef: 'main',
    })
    expect(res).toMatchObject({ merged: false, reason: 'conflict' })
    expect(git(['status', '--porcelain'], repoDir)).toBe('')
    expect(git(['show', 'HEAD:shared.txt'], repoDir)).toBe('base side')
    expect(git(['branch', '--list', created?.branch as string], repoDir)).toContain('team')
    await wt.releaseSessionWorkspace(sessionId)
  }, GIT_TEST_TIMEOUT)

  it('worktree còn việc dở ⇒ commit WIP rồi merge — việc của member không mất', async () => {
    const repoDir = await makeRepo('repo-team-merge-dirty')
    const sessionId = 'ses-merge-dirty'
    await makeProject(repoDir, `proj-${sessionId}`)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()
    const wtPath = created?.worktreePath as string

    // Member kết thúc mà quên commit — vẫn phải merge được, không mất việc.
    await writeFile(join(wtPath, 'dirty.txt'), 'uncommitted\n')
    const res = await wt.integrateSessionBranch({
      repoPath: created?.repoPath as string,
      worktreePath: wtPath,
      branch: created?.branch as string,
      baseRef: 'main',
    })
    expect(res).toMatchObject({ merged: true })
    expect(await exists(join(repoDir, 'dirty.txt'))).toBe(true)
    expect(git(['log', '-1', '--format=%s', created?.branch as string], repoDir)).toMatch(
      /^WIP: rescued|Merge/,
    )
    await wt.releaseSessionWorkspace(sessionId)
  }, GIT_TEST_TIMEOUT)
})

describe('sweepOrphanWorktrees vs membership', () => {
  // Regression: sweeper ở boot từng xoá luôn checkout `team` của member — nó
  // sống theo membership, chỉ releaseSessionWorkspace được động vào. Sweeper
  // chỉ được quét các lá theo LƯỢT (subagent, ADR 0083) chết dở.
  it('boot sweep dọn lá theo lượt nhưng GIỮ worktree team của member', async () => {
    const repoDir = await makeRepo('repo-team-sweep')
    const sessionId = 'ses-sweep-member'
    await makeProject(repoDir, `proj-${sessionId}`)
    const created = await wt.ensureSessionWorkspace(memberSession(sessionId, `proj-${sessionId}`))
    expect(created).not.toBeNull()
    const teamDir = created?.worktreePath as string
    // Việc đang làm dở trên cây member — sweep không được chạm vào nó.
    await writeFile(join(teamDir, 'wip.txt'), 'member in-flight\n')
    git(['add', '-A'], teamDir)
    git(['commit', '-m', 'member work'], teamDir)

    // Giả một checkout theo lượt chết dở cạnh `team` — đây mới là con mồi của
    // sweeper (branch theo đúng prefix của owner session).
    const leakDir = join(home, '.awog', 'session-worktrees', sessionId, 'worktrees', 'turn-leak')
    git(['worktree', 'add', '-b', `awog/session/${sessionId}/turn-leak`, leakDir, 'HEAD'], repoDir)

    const removed = await wt.sweepOrphanWorktrees()
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(await exists(leakDir)).toBe(false)
    // Cây membership còn nguyên: vẫn là checkout sống, commit của member còn.
    expect(await exists(join(teamDir, 'wip.txt'))).toBe(true)
    expect(git(['rev-parse', '--is-inside-work-tree'], teamDir)).toBe('true')

    await wt.releaseSessionWorkspace(sessionId)
  }, GIT_TEST_TIMEOUT)
})
