// Tests for discover.ts — repo discovery walk. Uses a temp dir (real fs I/O).
//
// Run với vitest: `pnpm vitest run` (cần cài `pnpm add -D vitest` trước).
// Vitest chưa có trong devDeps của sidecar (xem parser.test.ts) — file giữ sẵn
// để chạy ngay khi vitest được wired vào package.json.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverGitRepos } from '../discover.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'awog-discover-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// Create a repo at `<root>/<rel>` — a `.git` dir with a HEAD file (the marker
// `isGitRepo` checks for).
async function makeRepo(rel: string): Promise<void> {
  const dir = join(root, rel)
  await mkdir(join(dir, '.git'), { recursive: true })
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
}

async function makeDir(rel: string): Promise<void> {
  await mkdir(join(root, rel), { recursive: true })
}

describe('discoverGitRepos', () => {
  it('returns the root itself when it is a repo', async () => {
    await mkdir(join(root, '.git'), { recursive: true })
    const repos = await discoverGitRepos(root)
    expect(repos).toHaveLength(1)
    expect(repos[0]).toMatchObject({ relativePath: '.', isRoot: true, path: root })
  })

  it('finds depth-1 repos in a container folder', async () => {
    await makeRepo('api')
    await makeRepo('web')
    const repos = await discoverGitRepos(root)
    expect(repos.map((r) => r.relativePath).sort()).toEqual(['api', 'web'])
    expect(repos.every((r) => !r.isRoot)).toBe(true)
  })

  it('finds depth-2 repos (monorepo group layout)', async () => {
    await makeRepo(join('packages', 'api'))
    await makeRepo(join('packages', 'web'))
    await makeRepo(join('services', 'worker'))
    const repos = await discoverGitRepos(root)
    expect(repos.map((r) => r.relativePath)).toEqual([
      join('packages', 'api'),
      join('packages', 'web'),
      join('services', 'worker'),
    ])
  })

  it('stops descending once a .git is found (no nested repos)', async () => {
    await makeRepo('app')
    await makeRepo(join('app', 'vendor', 'lib')) // would be depth 3 + nested
    const repos = await discoverGitRepos(root)
    expect(repos.map((r) => r.relativePath)).toEqual(['app'])
  })

  it('skips node_modules and other build dirs', async () => {
    await makeRepo(join('node_modules', 'pkg'))
    await makeRepo(join('dist', 'thing'))
    await makeRepo('real')
    const repos = await discoverGitRepos(root)
    expect(repos.map((r) => r.relativePath)).toEqual(['real'])
  })

  it('ignores a bogus .git dir (no HEAD) and finds the real sub-repos below', async () => {
    // Mirrors the civilink case: root has a stray `.git/` (only a junk subdir,
    // no HEAD) but the actual repos live one level down.
    await mkdir(join(root, '.git', 'gk'), { recursive: true })
    await makeRepo('backend')
    await makeRepo('frontend')
    const repos = await discoverGitRepos(root)
    expect(repos.map((r) => r.relativePath).sort()).toEqual(['backend', 'frontend'])
    expect(repos.every((r) => !r.isRoot)).toBe(true)
  })

  it('treats a worktree-style .git file (gitdir:) as a repo', async () => {
    await mkdir(join(root, 'wt'), { recursive: true })
    await writeFile(join(root, 'wt', '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n')
    const repos = await discoverGitRepos(root)
    expect(repos.map((r) => r.relativePath)).toEqual(['wt'])
  })

  it('returns empty when no repos exist', async () => {
    await makeDir(join('a', 'b'))
    await writeFile(join(root, 'README.md'), '# hi')
    const repos = await discoverGitRepos(root)
    expect(repos).toEqual([])
  })

  it('does not descend past maxDepth', async () => {
    await makeRepo(join('a', 'b', 'deep')) // depth 3
    const repos = await discoverGitRepos(root)
    expect(repos).toEqual([])
  })
})
