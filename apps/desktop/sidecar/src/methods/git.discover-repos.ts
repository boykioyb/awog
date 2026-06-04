// `git.discoverRepos` — scan a project/workspace folder for git repos.
//
// A "project" in AWOG may be a container of several repos in subfolders (no
// `.git` at its own root). This walks up to 2 levels deep and returns each repo
// so the UI can show a repo picker instead of an empty NO_REPO state.
//
// Read-only. Input guards mirror `projects.inspect` (expand `~`, reject `..`,
// require an existing absolute directory). No git spawn — see git/discover.ts.
import { z } from 'zod'
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

  const repos = await discoverGitRepos(root)
  return { repos }
})
