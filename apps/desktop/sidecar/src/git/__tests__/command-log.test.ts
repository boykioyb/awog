// The command log ships argv and both git streams straight to the renderer, so
// the redaction and the caps here are load-bearing, not cosmetic (invariant #1).
import { beforeEach, describe, expect, it } from 'vitest'
import { clearGitCommands, listGitCommands, recordGitCommand } from '../command-log.js'

const base = {
  workspaceRoot: '/tmp/repo',
  startedAt: Date.now(),
  durationMs: 12,
  exitCode: 0,
  stdout: '',
  stderr: '',
}

beforeEach(() => clearGitCommands())

describe('redaction', () => {
  it('strips credentials embedded in a remote URL passed as argv', () => {
    recordGitCommand({
      ...base,
      argv: ['remote', 'add', 'origin', 'https://u:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@github.com/o/r.git'],
    })
    const joined = listGitCommands()[0]!.argv.join(' ')
    expect(joined).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    expect(joined).toContain('[redacted]')
  })

  it('strips a token that git echoed back in stderr', () => {
    recordGitCommand({
      ...base,
      argv: ['push'],
      exitCode: 128,
      stderr: "fatal: could not read 'https://x:ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@github.com/o/r'",
    })
    expect(listGitCommands()[0]!.stderr).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
  })
})

describe('bounds', () => {
  it('keeps only the head of a huge stream — `git diff` may emit megabytes', () => {
    recordGitCommand({ ...base, argv: ['diff'], stdout: 'x'.repeat(50_000) })
    const e = listGitCommands()[0]!
    expect(e.stdout.length).toBeLessThanOrEqual(4000)
    expect(e.truncated).toBe(true)
  })

  it('caps the ring so a long session cannot grow it without bound', () => {
    for (let i = 0; i < 450; i++) recordGitCommand({ ...base, argv: ['status'] })
    expect(listGitCommands().length).toBe(400)
  })

  it('filters by workspace', () => {
    recordGitCommand({ ...base, argv: ['status'] })
    recordGitCommand({ ...base, workspaceRoot: '/tmp/other', argv: ['status'] })
    expect(listGitCommands('/tmp/repo')).toHaveLength(1)
    expect(listGitCommands()).toHaveLength(2)
  })
})

// The UI hides reads by default; misclassifying a mutation as a read would hide
// the command the user is actually hunting for.
describe('read vs write classification', () => {
  const readOnlyOf = (argv: string[]) => {
    clearGitCommands()
    recordGitCommand({ ...base, argv })
    return listGitCommands()[0]!.readOnly
  }

  it.each([
    [['status', '--porcelain=v2'], true],
    [['diff', '--cached'], true],
    [['rev-parse', 'HEAD'], true],
    [['branch', '--list'], true],
    [['remote', '-v'], true],
    [['stash', 'list'], true],
  ])('%j → read', (argv, expected) => {
    expect(readOnlyOf(argv as string[])).toBe(expected)
  })

  it.each([
    [['commit', '-m', 'x'], false],
    [['add', '--', 'f.txt'], false],
    [['merge', '--no-edit', 'topic'], false],
    // Same subcommand, opposite meaning — the verb decides.
    [['remote', 'add', 'origin', 'url'], false],
    [['stash', 'pop'], false],
    [['branch', '-d', 'gone'], false],
    // Unknown subcommands default to "mutation" so nothing new hides silently.
    [['bisect', 'start'], false],
  ])('%j → write', (argv, expected) => {
    expect(readOnlyOf(argv as string[])).toBe(expected)
  })

  it('sees past leading -c options to find the subcommand', () => {
    expect(readOnlyOf(['-c', 'credential.helper=x', 'status'])).toBe(true)
    expect(readOnlyOf(['-c', 'credential.helper=x', 'fetch', '--prune'])).toBe(false)
  })
})
