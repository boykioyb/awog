// Tests cho worktree.ts — vòng đời worktree cô lập của node (ADR 0081). Chạy
// trên repo git THẬT trong thư mục tạm (spawn `git`), và trỏ HOME vào thư mục
// tạm vì worktree nằm dưới `~/.awog/tasks/<id>/worktrees/`.
//
// Run với vitest: `pnpm vitest run` (cần cài `pnpm add -D vitest` trước).
// Vitest chưa có trong devDeps của sidecar (xem git/__tests__/parser.test.ts) —
// file giữ sẵn để chạy ngay khi vitest được wired vào package.json.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let home: string
let repo: string
// Import động SAU khi đặt HOME: util/path.awogHome() đọc homedir() lúc gọi, nhưng
// giữ thứ tự này cho rõ ý.
type WorktreeModule = typeof import('../worktree.js')
let wt: WorktreeModule

const TASK_ID = 'task-test'

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-home-'))
  process.env.HOME = home
  repo = await mkdtemp(join(tmpdir(), 'awog-repo-'))
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@awog.local'])
  git(['config', 'user.name', 'AWOG Test'])
  await writeFile(join(repo, 'base.txt'), 'base\n')
  git(['add', '-A'])
  git(['commit', '-m', 'base'])
  wt = await import('../worktree.js')
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

function acquire(nodeId: string, version: number, projectPath = repo, canCommit = true) {
  return wt.acquireNodeWorkspace({ taskId: TASK_ID, nodeId, version, projectPath, canCommit })
}

describe('acquireNodeWorkspace', () => {
  it('cho node đầu tiên dùng chung cây gốc, node song song vào worktree riêng', async () => {
    const a = await acquire('node-a', 1)
    expect(a).toMatchObject({ cwd: repo, isolated: false })

    const b = await acquire('node-b', 1)
    expect(b.isolated).toBe(true)
    expect(b.cwd).not.toBe(repo)
    expect(b.branch).toBe('awog/task/task-test/node-b-v1')
    expect(b.cwd.startsWith(join(home, '.awog', 'tasks', TASK_ID))).toBe(true)
    // Checkout đầy đủ tại HEAD, và hai cây độc lập nhau.
    expect(await exists(join(b.cwd, 'base.txt'))).toBe(true)
    await writeFile(join(b.cwd, 'from-b.txt'), 'b\n')
    expect(await exists(join(repo, 'from-b.txt'))).toBe(false)
    expect(git(['status', '--porcelain'])).toBe('')

    // Node commit trong cây của mình (auto-commit per-phase), release xoá checkout
    // nhưng GIỮ branch — đó là công sức của agent.
    git(['add', '-A'], b.cwd)
    git(['commit', '-m', 'node B work'], b.cwd)
    expect(await wt.releaseNodeWorkspace(TASK_ID, b)).toMatchObject({ status: 'clean' })
    expect(await exists(b.cwd)).toBe(false)
    expect(git(['branch', '--list', b.branch as string])).toContain('node-b-v1')

    await wt.releaseNodeWorkspace(TASK_ID, a)
  })

  it('degrade về cây gốc khi node không commit (auto-commit per-phase tắt)', async () => {
    const a = await acquire('node-a2', 1)
    const b = await acquire('node-b2', 1, repo, false)
    expect(b).toMatchObject({ cwd: repo, isolated: false })
    await wt.releaseNodeWorkspace(TASK_ID, b)
    await wt.releaseNodeWorkspace(TASK_ID, a)
  })

  it('degrade về cây gốc khi project không phải git repo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'awog-plain-'))
    const a = await acquire('node-a3', 1, plain)
    const b = await acquire('node-b3', 1, plain)
    expect(b).toMatchObject({ cwd: plain, isolated: false })
    await wt.releaseNodeWorkspace(TASK_ID, b)
    await wt.releaseNodeWorkspace(TASK_ID, a)
    await rm(plain, { recursive: true, force: true })
  })
})

describe('integrateTaskBranches', () => {
  it('merge branch node về nhánh chính rồi xoá branch', async () => {
    const outcomes = await wt.integrateTaskBranches(TASK_ID, repo)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ status: 'merged' })
    expect(await exists(join(repo, 'from-b.txt'))).toBe(true)
    expect(git(['branch', '--list', 'awog/task/task-test/node-b-v1'])).toBe('')
    // Idempotent: gọi lại khi không còn branch nào là no-op.
    expect(await wt.integrateTaskBranches(TASK_ID, repo)).toHaveLength(0)
  })

  it('conflict thì abort merge, giữ branch và để cây gốc sạch', async () => {
    const d = await acquire('node-d', 2)
    const e = await acquire('node-e', 2)
    expect(e.isolated).toBe(true)

    await writeFile(join(repo, 'shared.txt'), 'from D\n')
    git(['add', '-A'])
    git(['commit', '-m', 'D edit'])
    await writeFile(join(e.cwd, 'shared.txt'), 'from E\n')
    git(['add', '-A'], e.cwd)
    git(['commit', '-m', 'E edit'], e.cwd)
    await wt.releaseNodeWorkspace(TASK_ID, e)
    await wt.releaseNodeWorkspace(TASK_ID, d)

    const outcomes = await wt.integrateTaskBranches(TASK_ID, repo)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ status: 'conflict' })
    expect(git(['branch', '--list', e.branch as string])).toContain('node-e-v2')
    // Không để lại merge dở trong cây của người dùng.
    expect(git(['status', '--porcelain'])).toBe('')
    expect(git(['show', 'HEAD:shared.txt'])).toBe('from D')
  })
})

describe('sweepOrphanWorktrees', () => {
  it('xoá checkout mồ côi còn sót sau khi sidecar chết giữa chừng', async () => {
    const orphan = join(home, '.awog', 'tasks', 'task-orphan', 'worktrees', 'ghost-v1')
    await mkdir(orphan, { recursive: true })
    await writeFile(join(home, '.awog', 'tasks', 'task-orphan', 'events.log'), '')
    const removed = await wt.sweepOrphanWorktrees()
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(await exists(orphan)).toBe(false)
  })
})

// ─── Lưới an toàn chống mất dữ liệu (đính chính F8 của ADR 0081) ─────────────
// Mỗi kịch bản dùng repo riêng để không lẫn nhánh/neo với các test ở trên.

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

describe('F8a — không xoá cây còn việc chưa commit', () => {
  it('node hỏng giữa chừng: gom thay đổi vào commit WIP, hook pre-commit không chặn được', async () => {
    const taskId = 'task-rescue'
    const repo = await makeRepo('repo-rescue')
    // Hook luôn fail — đúng một trong các đường mất trắng của finding.
    await mkdir(join(repo, '.git', 'hooks'), { recursive: true })
    await writeFile(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })

    const a = await wt.acquireNodeWorkspace({
      taskId,
      nodeId: 'node-a',
      version: 1,
      projectPath: repo,
      canCommit: true,
    })
    const b = await wt.acquireNodeWorkspace({
      taskId,
      nodeId: 'node-b',
      version: 1,
      projectPath: repo,
      canCommit: true,
    })
    expect(b.isolated).toBe(true)
    // Agent viết file rồi node fail — không có commit nào của auto-commit.
    await writeFile(join(b.cwd, 'agent-work.txt'), 'uncommitted\n')

    const released = await wt.releaseNodeWorkspace(taskId, b)
    expect(released.status).toBe('rescued')
    expect(await exists(b.cwd)).toBe(false)
    // Việc của agent nằm trên branch của node, không biến mất theo checkout.
    expect(git(['show', `${b.branch as string}:agent-work.txt`], repo)).toBe('uncommitted')
    expect(git(['log', '-1', '--format=%s', b.branch as string], repo)).toMatch(/^WIP: rescued/)

    await wt.releaseNodeWorkspace(taskId, a)
    const outcomes = await wt.integrateTaskBranches(taskId, repo)
    expect(outcomes[0]).toMatchObject({ status: 'merged' })
    expect(await exists(join(repo, 'agent-work.txt'))).toBe(true)
  })

  it('cứu không được thì GIỮ checkout, và lượt sweep sau mới dọn', async () => {
    const taskId = 'task-retain'
    const repo = await makeRepo('repo-retain')
    const a = await wt.acquireNodeWorkspace({
      taskId,
      nodeId: 'node-a',
      version: 1,
      projectPath: repo,
      canCommit: true,
    })
    const b = await wt.acquireNodeWorkspace({
      taskId,
      nodeId: 'node-b',
      version: 1,
      projectPath: repo,
      canCommit: true,
    })
    await writeFile(join(b.cwd, 'precious.txt'), 'do not lose me\n')
    // `.git/objects` chỉ đọc ⇒ `git add` không ghi được blob: dạng "commit rescue
    // cũng hỏng" (đĩa đầy / `.git` read-only).
    chmodSync(join(repo, '.git', 'objects'), 0o555)
    const released = await wt.releaseNodeWorkspace(taskId, b)
    expect(released).toMatchObject({ status: 'retained', path: b.cwd })
    expect(released.detail).toBeTruthy()
    expect(released.detail).not.toContain(home) // đã qua sanitizeStderr
    expect(await exists(join(b.cwd, 'precious.txt'))).toBe(true)

    // Sweep ở boot cũng không được xoá khi chưa cứu được.
    await wt.sweepOrphanWorktrees()
    expect(await exists(join(b.cwd, 'precious.txt'))).toBe(true)

    chmodSync(join(repo, '.git', 'objects'), 0o755)
    await wt.sweepOrphanWorktrees()
    expect(git(['show', `${b.branch as string}:precious.txt`], repo)).toBe('do not lose me')
    expect(await exists(b.cwd)).toBe(false)
    await wt.releaseNodeWorkspace(taskId, a)
  })
})

describe('F8b — merge chỉ hạ cánh xuống nhánh đã neo', () => {
  it('người dùng checkout nhánh khác giữa chừng ⇒ không merge, giữ branch', async () => {
    const taskId = 'task-head'
    const repo = await makeRepo('repo-head')
    const a = await wt.acquireNodeWorkspace({
      taskId,
      nodeId: 'node-a',
      version: 1,
      projectPath: repo,
      canCommit: true,
    })
    const b = await wt.acquireNodeWorkspace({
      taskId,
      nodeId: 'node-b',
      version: 1,
      projectPath: repo,
      canCommit: true,
    })
    await writeFile(join(b.cwd, 'node-work.txt'), 'work\n')
    git(['add', '-A'], b.cwd)
    git(['commit', '-m', 'node work'], b.cwd)
    await wt.releaseNodeWorkspace(taskId, b)
    await wt.releaseNodeWorkspace(taskId, a)

    git(['checkout', '-q', '-b', 'other'], repo)
    const headBefore = git(['rev-parse', 'HEAD'], repo)
    const outcomes = await wt.integrateTaskBranches(taskId, repo)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ status: 'conflict' })
    expect(outcomes[0]?.detail).toContain('other')
    expect(outcomes[0]?.detail).toContain('main')
    // Nhánh của người dùng không nhúc nhích, AWOG cũng không checkout hộ.
    expect(git(['rev-parse', 'HEAD'], repo)).toBe(headBefore)
    expect(await exists(join(repo, 'node-work.txt'))).toBe(false)
    expect(git(['symbolic-ref', '--short', 'HEAD'], repo)).toBe('other')
    expect(git(['branch', '--list', b.branch as string], repo)).toContain('node-b-v1')

    // Detached HEAD cũng bị chặn.
    git(['checkout', '-q', '--detach'], repo)
    const detached = await wt.integrateTaskBranches(taskId, repo)
    expect(detached[0]).toMatchObject({ status: 'conflict' })

    // Về đúng nhánh đã neo ⇒ merge như thường.
    git(['checkout', '-q', 'main'], repo)
    const merged = await wt.integrateTaskBranches(taskId, repo)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ status: 'merged' })
    expect(await exists(join(repo, 'node-work.txt'))).toBe(true)
  })
})

describe('F15 — detail lên UI đã qua sanitizeStderr', () => {
  it('stderr có path tuyệt đối thì được thay bằng ~', async () => {
    const taskId = 'task-sanitize'
    const repo = await makeRepo('repo-sanitize')
    const a = await wt.acquireNodeWorkspace({
      taskId,
      nodeId: 'node-a',
      version: 1,
      projectPath: repo,
      canCommit: true,
    })
    const b = await wt.acquireNodeWorkspace({
      taskId,
      nodeId: 'node-b',
      version: 1,
      projectPath: repo,
      canCommit: true,
    })
    await writeFile(join(b.cwd, 'x.txt'), 'x\n')
    git(['add', '-A'], b.cwd)
    git(['commit', '-m', 'x'], b.cwd)
    await wt.releaseNodeWorkspace(taskId, b)
    await wt.releaseNodeWorkspace(taskId, a)

    // `index.lock` TƯƠI (chưa quá ngưỡng stale) ⇒ merge fail kèm path tuyệt đối.
    await writeFile(join(repo, '.git', 'index.lock'), '')
    const outcomes = await wt.integrateTaskBranches(taskId, repo)
    expect(outcomes[0]).toMatchObject({ status: 'conflict' })
    expect(outcomes[0]?.detail).not.toContain(home)
    expect(outcomes[0]?.detail).toContain('~/')
    await rm(join(repo, '.git', 'index.lock'), { force: true })
  })
})
