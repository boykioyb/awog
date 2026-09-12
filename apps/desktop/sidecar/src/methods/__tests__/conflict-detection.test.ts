// Regression test for conflict detection on merge / rebase / cherry-pick.
//
// The bug this pins down: these three RPCs used to decide "is this a conflict?"
// by regex-matching the child's STDERR for "CONFLICT". `git merge` writes its
// "CONFLICT (content)" / "Automatic merge failed" lines to STDOUT and leaves
// stderr EMPTY, so every merge conflict escaped as gitCode UNKNOWN — the UI
// never routed into the resolver and the repo sat mid-merge with nothing said.
// Message text is also localised (LANG/LC_ALL pass through to the child), so
// matching English strings was doubly wrong. The fix asks the index instead:
// an unmerged entry exists only after a conflicting operation.
//
// Real git, real temp repos — the whole point is the child process's actual
// stream behaviour, which a mock cannot reproduce.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import '../git.merge.js'
import '../git.rebase.js'
import '../git.rebase-skip.js'
import '../git.cherry-pick.js'
import '../git.cherry-pick-abort.js'
import '../git.revert-commit.js'
import '../git.revert-abort.js'
import '../git.stash-save.js'
import '../git.stash-pop.js'
import '../git.status.js'
import { dispatch, RpcError } from '../../transport/rpc.js'

const exec = promisify(execFile)

let root: string

const git = (...args: string[]) => exec('git', args, { cwd: root })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'awog-conflict-'))
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.email', 't@t.dev')
  await git('config', 'user.name', 'T')
  await writeFile(join(root, 'f.txt'), 'v0\n')
  await git('add', '-A')
  await git('commit', '-qm', 'base')
  // topic and main change the same line → any of merge/rebase/cherry-pick conflicts.
  await git('checkout', '-q', '-b', 'topic')
  await writeFile(join(root, 'f.txt'), 'topic\n')
  await git('add', '-A')
  await git('commit', '-qm', 'topic')
  await git('checkout', '-q', 'main')
  await writeFile(join(root, 'f.txt'), 'main\n')
  await git('add', '-A')
  await git('commit', '-qm', 'main')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// The op must FAIL; return the error payload the UI branches on.
async function errorDataOf(method: string, params: Record<string, unknown>) {
  try {
    await dispatch(method, params)
  } catch (err) {
    expect(err).toBeInstanceOf(RpcError)
    return (err as RpcError).data as { gitCode?: string; files?: string[] } | undefined
  }
  throw new Error(`${method} unexpectedly succeeded`)
}

describe('conflict detection', () => {
  it('tags a merge conflict as MERGE_CONFLICT even though git writes it to stdout', async () => {
    const data = await errorDataOf('git.merge', { workspaceRoot: root, branch: 'topic' })
    expect(data?.gitCode).toBe('MERGE_CONFLICT')
    expect(data?.files).toEqual(['f.txt'])
  })

  it('tags a rebase conflict as MERGE_CONFLICT', async () => {
    await git('checkout', '-q', 'topic')
    const data = await errorDataOf('git.rebase', { workspaceRoot: root, onto: 'main' })
    expect(data?.gitCode).toBe('MERGE_CONFLICT')
    expect(data?.files).toEqual(['f.txt'])
  })

  it('tags a cherry-pick conflict as MERGE_CONFLICT', async () => {
    const { stdout } = await git('rev-parse', 'topic')
    const data = await errorDataOf('git.cherryPick', { workspaceRoot: root, sha: stdout.trim() })
    expect(data?.gitCode).toBe('MERGE_CONFLICT')
    expect(data?.files).toEqual(['f.txt'])
  })

  it('leaves a non-conflict failure alone (dirty tree stays DIRTY_TREE)', async () => {
    // No unmerged entries here — the structural check must NOT claim a conflict.
    await writeFile(join(root, 'f.txt'), 'uncommitted\n')
    const data = await errorDataOf('git.merge', { workspaceRoot: root, branch: 'topic' })
    expect(data?.gitCode).toBe('DIRTY_TREE')
  })
})

// `pendingOp` is what the header banner keys on. Before it existed, a conflicted
// cherry-pick or revert left isMerging AND isRebasing false, so the user got no
// banner and no way to continue or abort — stuck mid-sequencer with a silent UI.
describe('pendingOp', () => {
  const statusOf = () =>
    dispatch('git.status', { workspaceRoot: root }) as Promise<{
      pendingOp: string | null
      isMerging: boolean
      isRebasing: boolean
      conflictedCount: number
    }>

  it('reports null on a clean tree', async () => {
    expect((await statusOf()).pendingOp).toBeNull()
  })

  it('reports merge, and keeps the legacy booleans in step', async () => {
    await errorDataOf('git.merge', { workspaceRoot: root, branch: 'topic' })
    const st = await statusOf()
    expect(st.pendingOp).toBe('merge')
    expect(st.isMerging).toBe(true)
    expect(st.isRebasing).toBe(false)
  })

  it('reports cherry-pick — which both booleans miss', async () => {
    const { stdout } = await git('rev-parse', 'topic')
    await errorDataOf('git.cherryPick', { workspaceRoot: root, sha: stdout.trim() })
    const st = await statusOf()
    expect(st.pendingOp).toBe('cherry-pick')
    expect(st.isMerging).toBe(false)
    expect(st.isRebasing).toBe(false)
  })

  it('reports revert — which both booleans also miss', async () => {
    const { stdout } = await git('rev-parse', 'HEAD~1')
    await errorDataOf('git.revertCommit', { workspaceRoot: root, sha: stdout.trim() })
    const st = await statusOf()
    expect(st.pendingOp).toBe('revert')
    expect(st.isMerging).toBe(false)
    expect(st.isRebasing).toBe(false)
  })
})

describe('getting back out', () => {
  it('cherry-pick --abort clears the conflict', async () => {
    const { stdout } = await git('rev-parse', 'topic')
    await errorDataOf('git.cherryPick', { workspaceRoot: root, sha: stdout.trim() })
    await dispatch('git.cherryPickAbort', { workspaceRoot: root })
    const st = (await dispatch('git.status', { workspaceRoot: root })) as {
      pendingOp: string | null
      conflictedCount: number
    }
    expect(st.pendingOp).toBeNull()
    expect(st.conflictedCount).toBe(0)
  })

  it('revert --abort clears the conflict', async () => {
    const { stdout } = await git('rev-parse', 'HEAD~1')
    await errorDataOf('git.revertCommit', { workspaceRoot: root, sha: stdout.trim() })
    await dispatch('git.revertAbort', { workspaceRoot: root })
    const st = (await dispatch('git.status', { workspaceRoot: root })) as {
      pendingOp: string | null
      conflictedCount: number
    }
    expect(st.pendingOp).toBeNull()
    expect(st.conflictedCount).toBe(0)
  })

  it('rebase --skip drops the stuck commit and finishes the rebase', async () => {
    await git('checkout', '-q', 'topic')
    await errorDataOf('git.rebase', { workspaceRoot: root, onto: 'main' })
    await dispatch('git.rebaseSkip', { workspaceRoot: root })
    const st = (await dispatch('git.status', { workspaceRoot: root })) as {
      pendingOp: string | null
      branch: string | null
      conflictedCount: number
    }
    expect(st.pendingOp).toBeNull()
    expect(st.branch).toBe('topic')
    expect(st.conflictedCount).toBe(0)
  })

  it('refuses a continue/abort when no such op is running', async () => {
    const data = await errorDataOf('git.cherryPickAbort', { workspaceRoot: root })
    expect(data?.gitCode).toBe('INVALID_REF')
  })
})

// Stash used to resolve with a `hasConflict` flag — a second contract for the
// same situation, decided by grepping output for the word "conflict".
describe('stash conflict speaks the same envelope', () => {
  it('throws MERGE_CONFLICT and says the stash was kept', async () => {
    await writeFile(join(root, 'f.txt'), 'stashme\n')
    await dispatch('git.stashSave', { workspaceRoot: root, message: 'wip' })
    await writeFile(join(root, 'f.txt'), 'moved on\n')
    await git('add', '-A')
    await git('commit', '-qm', 'moved on')

    const data = (await errorDataOf('git.stashPop', { workspaceRoot: root, index: 0 })) as
      | { gitCode?: string; files?: string[]; stashKept?: boolean }
      | undefined
    expect(data?.gitCode).toBe('MERGE_CONFLICT')
    expect(data?.files).toEqual(['f.txt'])
    expect(data?.stashKept).toBe(true)
  })
})
