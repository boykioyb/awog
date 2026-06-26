// `git.discoverRepos` — scan a project/workspace folder for git repos.
//
// A "project" in AWOG may be a container of several repos in subfolders (no
// `.git` at its own root). This walks up to 2 levels deep and returns each repo
// so the UI can show a repo picker instead of an empty NO_REPO state.
//
// Read-only. Input guards mirror `projects.inspect` (expand `~`, reject `..`,
// require an existing absolute directory). The structural scan does not spawn git
// (see git/discover.ts); each found repo is then enriched with branch + remote via
// cheap read-only `git config/rev-parse` so the UI can show the branch and derive
// a GitHub slug per repo (multi-repo workspaces).
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { register, RpcError } from '../transport/rpc.js'
import { discoverGitRepos } from '../git/discover.js'
import type { GitRepoEntry } from '../git/types.js'

const Params = z.object({
  root: z.string().min(1).max(4096),
})

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

// Best-effort `git` in a repo cwd → '' on any failure. Read-only, arg-array (no
// shell); cwd is a discovered repo path under the scanned root.
function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((res) => {
    execFile('git', args, { cwd }, (err, stdout) => res(err || !stdout ? '' : stdout.trim()))
  })
}

async function enrich(repo: GitRepoEntry): Promise<GitRepoEntry> {
  const [remote, branch, status] = await Promise.all([
    runGit(repo.path, ['config', '--get', 'remote.origin.url']),
    runGit(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD']),
    // Tracked changes only (untracked excluded) → matches the Git page's dirty count.
    runGit(repo.path, ['status', '--porcelain', '--untracked-files=no']),
  ])
  const out: GitRepoEntry = { ...repo }
  if (branch) out.branch = branch
  if (remote) out.remote = remote
  const dirty = status ? status.split('\n').filter((l) => l.length > 0).length : 0
  if (dirty > 0) out.dirty = dirty
  return out
}

register('git.discoverRepos', async (raw): Promise<{ repos: GitRepoEntry[] }> => {
  const params = Params.parse(raw)
  if (params.root.includes('..')) {
    throw new RpcError(-32602, 'Path must not contain ".."')
  }
  const expanded = expandHome(params.root)
  if (!isAbsolute(expanded)) {
    throw new RpcError(-32602, 'Path must be absolute (or start with "~/")')
  }
  const root = resolve(expanded)

  let stats
  try {
    stats = await stat(root)
  } catch {
    throw new RpcError(-32602, `Path does not exist: ${root}`)
  }
  if (!stats.isDirectory()) {
    throw new RpcError(-32602, `Path is not a directory: ${root}`)
  }

  const found = await discoverGitRepos(root)
  const repos = await Promise.all(found.map(enrich))
  return { repos }
})
