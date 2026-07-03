// Unit tests for parser.ts. Pure-function coverage — no I/O.
//
// Run với vitest: `pnpm vitest run` (cần cài `pnpm add -D vitest` trước).
// Hiện tại vitest chưa có trong devDeps do constraints của env install ở M7;
// file này giữ sẵn để test ngay khi vitest được wired vào sidecar package.json.
import { describe, expect, it } from 'vitest'
import {
  parsePorcelainV2,
  parseForEachRef,
  parseStashList,
  parseUnifiedDiff,
} from '../parser.js'

describe('parsePorcelainV2', () => {
  it('parses branch + 1 modified staged file', () => {
    // `git status --porcelain=v2 -z --branch` style. Header lines + entry.
    const stdout = [
      '# branch.oid abcdef0123456789abcdef0123456789abcdef01',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0',
      '1 M. N... 100644 100644 100644 aaa bbb src/index.ts',
    ].join('\0')
    const parsed = parsePorcelainV2(stdout)
    expect(parsed.branch).toBe('main')
    expect(parsed.upstream).toBe('origin/main')
    expect(parsed.detached).toBe(false)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0]).toMatchObject({
      path: 'src/index.ts',
      changeType: 'modified',
      stageState: 'staged',
    })
  })

  it('parses unstaged + untracked entries', () => {
    const stdout = [
      '# branch.head main',
      '1 .M N... 100644 100644 100644 aaa aaa src/foo.ts',
      '? new-file.txt',
    ].join('\0')
    const parsed = parsePorcelainV2(stdout)
    expect(parsed.files).toHaveLength(2)
    expect(parsed.files[0]).toMatchObject({
      path: 'src/foo.ts',
      changeType: 'modified',
      stageState: 'unstaged',
    })
    expect(parsed.files[1]).toMatchObject({
      path: 'new-file.txt',
      changeType: 'untracked',
      stageState: 'untracked',
    })
  })

  it('parses rename entry (kind=2) with oldPath', () => {
    // Rename: line is type 2 + extra NUL token with old path.
    const stdout = [
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaa bbb R100 newPath.ts',
      'oldPath.ts',
    ].join('\0')
    const parsed = parsePorcelainV2(stdout)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0]).toMatchObject({
      path: 'newPath.ts',
      oldPath: 'oldPath.ts',
      changeType: 'renamed',
      stageState: 'staged',
    })
  })

  it('parses unmerged (conflicted) entry', () => {
    const stdout = [
      '# branch.head main',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
    ].join('\0')
    const parsed = parsePorcelainV2(stdout)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0]).toMatchObject({
      path: 'conflict.ts',
      changeType: 'conflicted',
      stageState: 'conflicted',
    })
  })

  it('detects detached HEAD with sha7', () => {
    const stdout = [
      '# branch.oid abcdef0123456789abcdef0123456789abcdef01',
      '# branch.head (detached)',
    ].join('\0')
    const parsed = parsePorcelainV2(stdout)
    expect(parsed.detached).toBe(true)
    expect(parsed.detachedAt).toBe('abcdef0')
    expect(parsed.branch).toBeNull()
  })
})

describe('parseUnifiedDiff', () => {
  it('parses a single-hunk diff with mixed add/del/context', () => {
    const stdout = [
      'diff --git a/file.ts b/file.ts',
      'index abc..def 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,3 +1,3 @@',
      ' context',
      '-old',
      '+new',
      ' tail',
    ].join('\n')
    const out = parseUnifiedDiff(stdout)
    expect(out).toHaveLength(1)
    const f = out[0]!
    expect(f.path).toBe('file.ts')
    expect(f.isBinary).toBe(false)
    expect(f.hunks).toHaveLength(1)
    const hunk = f.hunks[0]!
    expect(hunk.oldStart).toBe(1)
    expect(hunk.newStart).toBe(1)
    expect(hunk.lines.some((l) => l.kind === 'add' && l.content === 'new')).toBe(true)
    expect(hunk.lines.some((l) => l.kind === 'del' && l.content === 'old')).toBe(true)
  })

  it('marks binary diff', () => {
    const stdout = [
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
    ].join('\n')
    const out = parseUnifiedDiff(stdout)
    expect(out).toHaveLength(1)
    expect(out[0]!.isBinary).toBe(true)
    expect(out[0]!.hunks).toHaveLength(0)
  })

  it('decodes a quoted non-ASCII path (git core.quotePath default)', () => {
    // git wraps non-ASCII paths in quotes with octal-escaped UTF-8 bytes.
    // \350\246\201\344\273\266 = 要件 — regressed to an empty path before.
    const stdout = [
      'diff --git "a/docs/\\350\\246\\201\\344\\273\\266/README.md" "b/docs/\\350\\246\\201\\344\\273\\266/README.md"',
      'index abc..def 100644',
      '--- "a/docs/\\350\\246\\201\\344\\273\\266/README.md"',
      '+++ "b/docs/\\350\\246\\201\\344\\273\\266/README.md"',
      '@@ -1 +1,2 @@',
      ' a',
      '+b',
    ].join('\n')
    const out = parseUnifiedDiff(stdout)
    expect(out).toHaveLength(1)
    expect(out[0]!.path).toBe('docs/要件/README.md')
  })

  it('decodes quoted paths on a rename (rename to overrides)', () => {
    const stdout = [
      'diff --git "a/docs/\\350\\246\\201\\344\\273\\266/README.md" "b/docs/\\350\\246\\201\\344\\273\\266/GUIDE.md"',
      'similarity index 100%',
      'rename from "docs/\\350\\246\\201\\344\\273\\266/README.md"',
      'rename to "docs/\\350\\246\\201\\344\\273\\266/GUIDE.md"',
    ].join('\n')
    const out = parseUnifiedDiff(stdout)
    expect(out).toHaveLength(1)
    expect(out[0]!.isRename).toBe(true)
    expect(out[0]!.oldPath).toBe('docs/要件/README.md')
    expect(out[0]!.path).toBe('docs/要件/GUIDE.md')
  })

  it('keeps a plain path containing spaces intact', () => {
    const stdout = [
      'diff --git a/docs/Panwall DX/README.md b/docs/Panwall DX/README.md',
      '@@ -1 +1,2 @@',
      ' a',
      '+b',
    ].join('\n')
    const out = parseUnifiedDiff(stdout)
    expect(out).toHaveLength(1)
    expect(out[0]!.path).toBe('docs/Panwall DX/README.md')
  })
})

describe('parseForEachRef', () => {
  it('parses a local branch record', () => {
    // %(refname)\0%(refname:short)\0%(upstream:short)\0%(upstream:track)\0
    //   %(objectname)\0%(subject)\0%(committerdate:iso-strict)
    const REC = '\x1e'
    const stdout = [
      'refs/heads/main\x00main\x00origin/main\x00\x00abc123\x00Initial commit\x002024-01-01T10:00:00Z',
      REC,
    ].join('')
    const branches = parseForEachRef(stdout)
    expect(branches).toHaveLength(1)
    expect(branches[0]).toMatchObject({
      name: 'main',
      kind: 'local',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      lastCommitSha: 'abc123',
    })
  })
})

describe('parseStashList', () => {
  it('parses a single stash entry', () => {
    const REC = '\x1e'
    // sel \0 sha \0 createdAt \0 subject
    const stdout = [
      'stash@{0}\x00abc123\x002024-01-01T10:00:00Z\x00WIP on main: 12345 hotfix',
      REC,
    ].join('')
    const stashes = parseStashList(stdout)
    expect(stashes).toHaveLength(1)
    expect(stashes[0]).toMatchObject({
      index: 0,
      baseSha: 'abc123',
      baseBranch: 'main',
    })
  })
})
