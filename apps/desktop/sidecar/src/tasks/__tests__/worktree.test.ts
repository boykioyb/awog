// Tests cho worktree.ts — vòng đời worktree cô lập, khoá theo OWNER (ADR 0081 +
// đính chính gói #7c). Chạy trên repo git THẬT trong thư mục tạm (spawn `git`),
// và trỏ HOME vào thư mục tạm vì checkout nằm dưới `~/.awog/`.
//
// Run: `npx vitest@2 run`.
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
const TASK_OWNER = { kind: 'task', id: TASK_ID } as const

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

// Node của Task: `first-claim` khi node có commit, `shared` khi auto-commit
// per-phase tắt (đúng bằng cách node-runner.ts gọi).
function acquireNode(nodeId: string, version: number, projectPath = repo, canCommit = true) {
  return wt.acquireWorkspace({
    owner: { kind: 'task', id: TASK_ID },
    slug: `${nodeId}-v${version}`,
    projectPath,
    policy: canCommit ? 'first-claim' : 'shared',
  })
}

describe('acquireWorkspace (owner: task)', () => {
  it('cho node đầu tiên dùng chung cây gốc, node song song vào worktree riêng', async () => {
    const a = await acquireNode('node-a', 1)
    expect(a).toMatchObject({ cwd: repo, isolated: false })

    const b = await acquireNode('node-b', 1)
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
    expect(await wt.releaseWorkspace(TASK_OWNER, b)).toMatchObject({
      status: 'clean',
      branch: b.branch,
    })
    expect(await exists(b.cwd)).toBe(false)
    expect(git(['branch', '--list', b.branch as string])).toContain('node-b-v1')

    await wt.releaseWorkspace(TASK_OWNER, a)
  })

  it('degrade về cây gốc khi node không commit (auto-commit per-phase tắt)', async () => {
    const a = await acquireNode('node-a2', 1)
    const b = await acquireNode('node-b2', 1, repo, false)
    expect(b).toMatchObject({ cwd: repo, isolated: false })
    await wt.releaseWorkspace(TASK_OWNER, b)
    await wt.releaseWorkspace(TASK_OWNER, a)
  })

  it('degrade về cây gốc khi project không phải git repo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'awog-plain-'))
    const a = await acquireNode('node-a3', 1, plain)
    const b = await acquireNode('node-b3', 1, plain)
    expect(b).toMatchObject({ cwd: plain, isolated: false })
    await wt.releaseWorkspace(TASK_OWNER, b)
    await wt.releaseWorkspace(TASK_OWNER, a)
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
    const d = await acquireNode('node-d', 2)
    const e = await acquireNode('node-e', 2)
    expect(e.isolated).toBe(true)

    await writeFile(join(repo, 'shared.txt'), 'from D\n')
    git(['add', '-A'])
    git(['commit', '-m', 'D edit'])
    await writeFile(join(e.cwd, 'shared.txt'), 'from E\n')
    git(['add', '-A'], e.cwd)
    git(['commit', '-m', 'E edit'], e.cwd)
    await wt.releaseWorkspace(TASK_OWNER, e)
    await wt.releaseWorkspace(TASK_OWNER, d)

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

function acquireFor(taskId: string, nodeId: string, projectPath: string) {
  return wt.acquireWorkspace({
    owner: { kind: 'task', id: taskId },
    slug: `${nodeId}-v1`,
    projectPath,
    policy: 'first-claim',
  })
}

describe('F8a — không xoá cây còn việc chưa commit', () => {
  it('node hỏng giữa chừng: gom thay đổi vào commit WIP, hook pre-commit không chặn được', async () => {
    const taskId = 'task-rescue'
    const owner = { kind: 'task', id: taskId } as const
    const repoDir = await makeRepo('repo-rescue')
    // Hook luôn fail — đúng một trong các đường mất trắng của finding.
    await mkdir(join(repoDir, '.git', 'hooks'), { recursive: true })
    await writeFile(join(repoDir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    })

    const a = await acquireFor(taskId, 'node-a', repoDir)
    const b = await acquireFor(taskId, 'node-b', repoDir)
    expect(b.isolated).toBe(true)
    // Agent viết file rồi node fail — không có commit nào của auto-commit.
    await writeFile(join(b.cwd, 'agent-work.txt'), 'uncommitted\n')

    const released = await wt.releaseWorkspace(owner, b)
    expect(released.status).toBe('rescued')
    expect(released.branch).toBe(b.branch)
    expect(await exists(b.cwd)).toBe(false)
    // Việc của agent nằm trên branch của node, không biến mất theo checkout.
    expect(git(['show', `${b.branch as string}:agent-work.txt`], repoDir)).toBe('uncommitted')
    expect(git(['log', '-1', '--format=%s', b.branch as string], repoDir)).toMatch(/^WIP: rescued/)

    await wt.releaseWorkspace(owner, a)
    const outcomes = await wt.integrateTaskBranches(taskId, repoDir)
    expect(outcomes[0]).toMatchObject({ status: 'merged' })
    expect(await exists(join(repoDir, 'agent-work.txt'))).toBe(true)
  })

  it('cứu không được thì GIỮ checkout, và lượt sweep sau mới dọn', async () => {
    const taskId = 'task-retain'
    const owner = { kind: 'task', id: taskId } as const
    const repoDir = await makeRepo('repo-retain')
    const a = await acquireFor(taskId, 'node-a', repoDir)
    const b = await acquireFor(taskId, 'node-b', repoDir)
    await writeFile(join(b.cwd, 'precious.txt'), 'do not lose me\n')
    // `.git/objects` chỉ đọc ⇒ `git add` không ghi được blob: dạng "commit rescue
    // cũng hỏng" (đĩa đầy / `.git` read-only).
    chmodSync(join(repoDir, '.git', 'objects'), 0o555)
    const released = await wt.releaseWorkspace(owner, b)
    expect(released).toMatchObject({ status: 'retained', path: b.cwd })
    expect(released.detail).toBeTruthy()
    expect(released.detail).not.toContain(home) // đã qua sanitizeStderr
    expect(await exists(join(b.cwd, 'precious.txt'))).toBe(true)

    // Sweep ở boot cũng không được xoá khi chưa cứu được.
    await wt.sweepOrphanWorktrees()
    expect(await exists(join(b.cwd, 'precious.txt'))).toBe(true)

    chmodSync(join(repoDir, '.git', 'objects'), 0o755)
    await wt.sweepOrphanWorktrees()
    expect(git(['show', `${b.branch as string}:precious.txt`], repoDir)).toBe('do not lose me')
    expect(await exists(b.cwd)).toBe(false)
    await wt.releaseWorkspace(owner, a)
  })
})

describe('F8b — merge chỉ hạ cánh xuống nhánh đã neo', () => {
  it('người dùng checkout nhánh khác giữa chừng ⇒ không merge, giữ branch', async () => {
    const taskId = 'task-head'
    const owner = { kind: 'task', id: taskId } as const
    const repoDir = await makeRepo('repo-head')
    const a = await acquireFor(taskId, 'node-a', repoDir)
    const b = await acquireFor(taskId, 'node-b', repoDir)
    await writeFile(join(b.cwd, 'node-work.txt'), 'work\n')
    git(['add', '-A'], b.cwd)
    git(['commit', '-m', 'node work'], b.cwd)
    await wt.releaseWorkspace(owner, b)
    await wt.releaseWorkspace(owner, a)

    git(['checkout', '-q', '-b', 'other'], repoDir)
    const headBefore = git(['rev-parse', 'HEAD'], repoDir)
    const outcomes = await wt.integrateTaskBranches(taskId, repoDir)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ status: 'conflict' })
    expect(outcomes[0]?.detail).toContain('other')
    expect(outcomes[0]?.detail).toContain('main')
    // Nhánh của người dùng không nhúc nhích, AWOG cũng không checkout hộ.
    expect(git(['rev-parse', 'HEAD'], repoDir)).toBe(headBefore)
    expect(await exists(join(repoDir, 'node-work.txt'))).toBe(false)
    expect(git(['symbolic-ref', '--short', 'HEAD'], repoDir)).toBe('other')
    expect(git(['branch', '--list', b.branch as string], repoDir)).toContain('node-b-v1')

    // Detached HEAD cũng bị chặn.
    git(['checkout', '-q', '--detach'], repoDir)
    const detached = await wt.integrateTaskBranches(taskId, repoDir)
    expect(detached[0]).toMatchObject({ status: 'conflict' })

    // Về đúng nhánh đã neo ⇒ merge như thường.
    git(['checkout', '-q', 'main'], repoDir)
    const merged = await wt.integrateTaskBranches(taskId, repoDir)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ status: 'merged' })
    expect(await exists(join(repoDir, 'node-work.txt'))).toBe(true)
  })
})

describe('F15 — detail lên UI đã qua sanitizeStderr', () => {
  it('stderr có path tuyệt đối thì được thay bằng ~', async () => {
    const taskId = 'task-sanitize'
    const owner = { kind: 'task', id: taskId } as const
    const repoDir = await makeRepo('repo-sanitize')
    const a = await acquireFor(taskId, 'node-a', repoDir)
    const b = await acquireFor(taskId, 'node-b', repoDir)
    await writeFile(join(b.cwd, 'x.txt'), 'x\n')
    git(['add', '-A'], b.cwd)
    git(['commit', '-m', 'x'], b.cwd)
    await wt.releaseWorkspace(owner, b)
    await wt.releaseWorkspace(owner, a)

    // `index.lock` TƯƠI (chưa quá ngưỡng stale) ⇒ merge fail kèm path tuyệt đối.
    await writeFile(join(repoDir, '.git', 'index.lock'), '')
    const outcomes = await wt.integrateTaskBranches(taskId, repoDir)
    expect(outcomes[0]).toMatchObject({ status: 'conflict' })
    expect(outcomes[0]?.detail).not.toContain(home)
    expect(outcomes[0]?.detail).toContain('~/')
    await rm(join(repoDir, '.git', 'index.lock'), { force: true })
  })
})

// ─── Owner `session`: subagent chat (ADR 0083 §c, gói #7c) ───────────────────

const SESSION_ID = 'ses-abc123'
const SESSION_OWNER = { kind: 'session', id: SESSION_ID } as const

function acquireSubagent(slug: string, projectPath: string, id = SESSION_ID) {
  return wt.acquireWorkspace({
    owner: { kind: 'session', id },
    slug,
    projectPath,
    policy: 'always',
  })
}

describe('owner `session` — cô lập subagent chat', () => {
  it('policy `always` luôn cô lập, và đi vào nhà riêng của session (không phải store Task)', async () => {
    const repoDir = await makeRepo('repo-session')
    const ws = await acquireSubagent('toolu-01', repoDir)
    expect(ws.isolated).toBe(true)
    expect(ws.branch).toBe(`awog/session/${SESSION_ID}/toolu-01`)
    expect(ws.cwd).toBe(
      join(home, '.awog', 'session-worktrees', SESSION_ID, 'worktrees', 'toolu-01'),
    )
    // KHÔNG đẻ task ma trong store Task — đó là cái bẫy ADR 0083 §c nêu.
    expect(await exists(join(home, '.awog', 'tasks', SESSION_ID))).toBe(false)
    expect(await exists(join(ws.cwd, 'base.txt'))).toBe(true)

    // Cô lập ngay cả khi không ai giữ cây gốc: lượt chat cha đang dùng nó.
    const second = await acquireSubagent('toolu-02', repoDir)
    expect(second.isolated).toBe(true)
    expect(second.cwd).not.toBe(ws.cwd)

    await wt.releaseWorkspace(SESSION_OWNER, ws)
    await wt.releaseWorkspace(SESSION_OWNER, second)
  })

  it('subagent CHỈ-ĐỌC không để lại branch rác', async () => {
    const repoDir = await makeRepo('repo-session-ro')
    const ws = await acquireSubagent('toolu-ro', repoDir)
    const released = await wt.releaseWorkspace(SESSION_OWNER, ws)
    expect(released.status).toBe('clean')
    // Branch rỗng ⇒ `git branch -d` dọn được ⇒ không có gì để báo cho người dùng.
    expect(released.branch).toBeUndefined()
    expect(git(['branch', '--list', ws.branch as string], repoDir)).toBe('')
    expect(await exists(ws.cwd)).toBe(false)
  })

  it('subagent CÓ SỬA FILE: việc lên branch, cây của người dùng không nhúc nhích, KHÔNG tự merge', async () => {
    const repoDir = await makeRepo('repo-session-rw')
    const headBefore = git(['rev-parse', 'HEAD'], repoDir)
    const ws = await acquireSubagent('toolu-rw', repoDir)
    await writeFile(join(ws.cwd, 'subagent.txt'), 'from subagent\n')

    const released = await wt.releaseWorkspace(SESSION_OWNER, ws)
    expect(released).toMatchObject({ status: 'rescued', branch: ws.branch })
    expect(git(['show', `${ws.branch as string}:subagent.txt`], repoDir)).toBe('from subagent')

    // Ranh giới sản phẩm: chỉ cô lập, không merge. Repo của người dùng y nguyên.
    expect(git(['rev-parse', 'HEAD'], repoDir)).toBe(headBefore)
    expect(git(['status', '--porcelain'], repoDir)).toBe('')
    expect(await exists(join(repoDir, 'subagent.txt'))).toBe(false)
    // Và người dùng lấy về được bằng một lệnh merge của chính họ.
    git(['merge', '--no-edit', ws.branch as string], repoDir)
    expect(await exists(join(repoDir, 'subagent.txt'))).toBe(true)
  })

  it('degrade sạch khi cwd của phiên không phải git repo', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'awog-chat-plain-'))
    const ws = await acquireSubagent('toolu-plain', plain)
    expect(ws).toMatchObject({ cwd: plain, isolated: false })
    expect(await wt.releaseWorkspace(SESSION_OWNER, ws)).toMatchObject({ status: 'clean' })
    await rm(plain, { recursive: true, force: true })
  })

  it('degrade sạch khi HEAD detached', async () => {
    const repoDir = await makeRepo('repo-session-detached')
    git(['checkout', '-q', '--detach'], repoDir)
    const ws = await acquireSubagent('toolu-detached', repoDir)
    expect(ws).toMatchObject({ cwd: repoDir, isolated: false })
    await wt.releaseWorkspace(SESSION_OWNER, ws)
  })
})

describe('sweeper quét CẢ HAI loại owner', () => {
  it('app chết giữa lượt chat: checkout của session được cứu và dọn ở boot', async () => {
    const sessionId = 'ses-crash'
    const repoDir = await makeRepo('repo-session-crash')
    const ws = await acquireSubagent('toolu-crash', repoDir, sessionId)
    await writeFile(join(ws.cwd, 'half-done.txt'), 'work in progress\n')
    // Không release — mô phỏng sidecar chết giữa lượt.

    // Một checkout task mồ côi thuần rác, để chứng minh sweeper không bỏ loại nào.
    const taskOrphan = join(home, '.awog', 'tasks', 'task-orphan-2', 'worktrees', 'ghost-v1')
    await mkdir(taskOrphan, { recursive: true })

    const removed = await wt.sweepOrphanWorktrees()
    expect(removed).toBeGreaterThanOrEqual(2)
    expect(await exists(taskOrphan)).toBe(false)
    expect(await exists(ws.cwd)).toBe(false)
    // Việc dở của subagent không bị xoá mù — nó nằm trên branch của chính nó.
    expect(git(['show', `${ws.branch as string}:half-done.txt`], repoDir)).toBe('work in progress')
    expect(git(['log', '-1', '--format=%s', ws.branch as string], repoDir)).toMatch(/^WIP: rescued/)
    // Và metadata worktree trong `.git` đã được prune (nhờ file neo `worktree-repo`).
    expect(git(['worktree', 'list'], repoDir).split('\n')).toHaveLength(1)
  })

  it('checkout chỉ-đọc mồ côi của session bị dọn cả branch', async () => {
    const sessionId = 'ses-crash-ro'
    const repoDir = await makeRepo('repo-session-crash-ro')
    const ws = await acquireSubagent('toolu-crash-ro', repoDir, sessionId)
    await wt.sweepOrphanWorktrees()
    expect(await exists(ws.cwd)).toBe(false)
    expect(git(['branch', '--list', ws.branch as string], repoDir)).toBe('')
  })
})
