// These functions DELETE, so the classification and the cutoff are the safety
// rails, not details. Real temp trees — the thing under test is filesystem
// shape, which a mock would only restate.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let home: string

// scan.ts reads ~/.awog via awogHome(); point it at a temp tree.
vi.mock('../../util/path.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, awogHome: () => home }
})

const summaries: { id: string; title: string; projectId: string | null; updatedAt: string }[] = []
vi.mock('../../sessions/store.js', () => ({
  listSessionSummaries: async () => summaries,
}))

const { scanStorage, pruneSnapshots, deleteOrphans } = await import('../scan.js')

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

async function makeSession(
  id: string,
  opts: { projectId?: string | null; updatedAt?: string; snapshotBytes?: number; jsonlBytes?: number },
) {
  const dir = join(home, 'sessions', id)
  await mkdir(join(dir, 'snapshots', 'blobs'), { recursive: true })
  await mkdir(join(dir, 'attachments'), { recursive: true })
  await writeFile(join(dir, 'session.jsonl'), 'x'.repeat(opts.jsonlBytes ?? 100))
  if (opts.snapshotBytes) {
    await writeFile(join(dir, 'snapshots', 'blobs', 'abc'), 'y'.repeat(opts.snapshotBytes))
  }
  summaries.push({
    id,
    title: id,
    projectId: opts.projectId ?? null,
    updatedAt: opts.updatedAt ?? daysAgo(1),
  })
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-storage-'))
  await mkdir(join(home, 'sessions'), { recursive: true })
  summaries.length = 0
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const exists = async (p: string) => {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

describe('scan', () => {
  it('splits a session into transcript / snapshot / attachment bytes', async () => {
    await makeSession('s1', { projectId: 'p1', jsonlBytes: 500, snapshotBytes: 4000 })
    const scan = await scanStorage()
    const s = scan.sessions[0]!
    expect(s.transcriptBytes).toBe(500)
    expect(s.snapshotBytes).toBe(4000)
    expect(s.totalBytes).toBeGreaterThanOrEqual(4500)
  })

  it('groups by project and sorts both lists biggest-first', async () => {
    await makeSession('small', { projectId: 'p1', snapshotBytes: 100 })
    await makeSession('big', { projectId: 'p2', snapshotBytes: 9000 })
    await makeSession('mid', { projectId: 'p1', snapshotBytes: 3000 })
    const scan = await scanStorage()
    expect(scan.sessions[0]!.id).toBe('big')
    expect(scan.projects[0]!.projectId).toBe('p2')
    expect(scan.projects.find((p) => p.projectId === 'p1')!.count).toBe(2)
  })

  it('counts loose files as orphans, not sessions', async () => {
    await makeSession('s1', { snapshotBytes: 10 })
    await writeFile(join(home, 'sessions', 'ses-old.jsonl.bak'), 'z'.repeat(7000))
    await writeFile(join(home, 'sessions', '.DS_Store'), 'z'.repeat(100))
    const scan = await scanStorage()
    expect(scan.sessions).toHaveLength(1)
    expect(scan.orphanCount).toBe(2)
    expect(scan.orphanBytes).toBe(7100)
  })

  it('still lists a session directory with no readable header', async () => {
    // Directory on disk, nothing in listSessionSummaries — the case that most
    // needs reporting, since nothing else in the app can see it.
    await mkdir(join(home, 'sessions', 'ghost', 'snapshots'), { recursive: true })
    await writeFile(join(home, 'sessions', 'ghost', 'snapshots', 'b'), 'q'.repeat(2000))
    const scan = await scanStorage()
    expect(scan.sessions.map((s) => s.id)).toContain('ghost')
    expect(scan.sessions[0]!.projectId).toBeNull()
  })
})

describe('pruneSnapshots', () => {
  it('drops snapshots past the cutoff and keeps the conversation', async () => {
    await makeSession('old', { updatedAt: daysAgo(60), snapshotBytes: 5000 })
    const res = await pruneSnapshots({ olderThanDays: 30 })
    expect(res.count).toBe(1)
    expect(res.freedBytes).toBeGreaterThanOrEqual(5000)
    expect(await exists(join(home, 'sessions', 'old', 'snapshots'))).toBe(false)
    // The point of the whole feature: the transcript survives.
    expect(await exists(join(home, 'sessions', 'old', 'session.jsonl'))).toBe(true)
  })

  it('leaves recent sessions alone', async () => {
    await makeSession('recent', { updatedAt: daysAgo(3), snapshotBytes: 5000 })
    const res = await pruneSnapshots({ olderThanDays: 30 })
    expect(res.count).toBe(0)
    expect(await exists(join(home, 'sessions', 'recent', 'snapshots'))).toBe(true)
  })

  it('never touches a session that is running right now', async () => {
    await makeSession('live', { updatedAt: daysAgo(90), snapshotBytes: 5000 })
    const res = await pruneSnapshots({ olderThanDays: 30, skipIds: new Set(['live']) })
    expect(res.count).toBe(0)
    expect(await exists(join(home, 'sessions', 'live', 'snapshots'))).toBe(true)
  })

  it('scopes to one project when asked', async () => {
    await makeSession('a', { projectId: 'p1', updatedAt: daysAgo(60), snapshotBytes: 3000 })
    await makeSession('b', { projectId: 'p2', updatedAt: daysAgo(60), snapshotBytes: 3000 })
    await pruneSnapshots({ olderThanDays: 30, projectId: 'p1' })
    expect(await exists(join(home, 'sessions', 'a', 'snapshots'))).toBe(false)
    expect(await exists(join(home, 'sessions', 'b', 'snapshots'))).toBe(true)
  })
})

describe('deleteOrphans', () => {
  it('removes loose files and leaves every session directory standing', async () => {
    await makeSession('keep', { snapshotBytes: 1000 })
    await writeFile(join(home, 'sessions', 'junk.bak'), 'z'.repeat(4000))
    const res = await deleteOrphans()
    expect(res.count).toBe(1)
    expect(res.freedBytes).toBe(4000)
    expect(await exists(join(home, 'sessions', 'junk.bak'))).toBe(false)
    expect(await exists(join(home, 'sessions', 'keep', 'session.jsonl'))).toBe(true)
  })
})
