// Inspect a git REMOTE (before cloning) to pre-fill the new-project form: repo
// name (always, parsed from the URL), plus primary language + description +
// default branch for GitHub repos (via `gh repo view`, honoring the gh account,
// so private repos the user can access resolve too). All best-effort — a
// non-GitHub remote, a missing/unauthed gh, or a repo the account can't see
// degrades to name-only (`detected:false`) rather than failing the call.

import { z } from 'zod'
import { homedir } from 'node:os'
import { register } from '../transport/rpc.js'
import { runGh } from '../github/runner.js'
import { log } from '../util/logger.js'

const Params = z.object({
  gitRemote: z.string().min(1).max(2048),
  // Optional gh account to resolve the metadata as (defaults to the active one).
  account: z.string().max(120).optional(),
})

// Parse owner/repo from a GitHub remote (scp-style `git@github.com:o/r.git`,
// `https://github.com/o/r(.git)`, or `ssh://git@github.com/o/r.git`). Returns null
// for any non-GitHub host — those still get a name via repoNameOf.
function parseGitHubRepo(remote: string): { owner: string; repo: string } | null {
  const s = remote.trim()
  const scp = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(s)
  if (scp?.[1] && scp[2]) return { owner: scp[1], repo: scp[2] }
  const url = /^(?:https?:\/\/|ssh:\/\/(?:git@)?)github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(s)
  if (url?.[1] && url[2]) return { owner: url[1], repo: url[2] }
  return null
}

// Last path segment of ANY remote, sans a trailing `.git` — the folder name a
// clone would create. Works for GitHub and non-GitHub remotes alike.
function repoNameOf(remote: string): string {
  const s = remote
    .trim()
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
  return s.split(/[/:]/).filter(Boolean).pop() ?? ''
}

// Path-segment-safe owner/repo (defence in depth on top of the URL regex before
// the value reaches the `gh` argv).
const SEG_RE = /^[A-Za-z0-9._-]+$/

interface GhRepoView {
  name?: string
  description?: string | null
  primaryLanguage?: { name?: string } | null
  defaultBranchRef?: { name?: string } | null
}

export interface RemoteInspectResult {
  name: string
  language: string
  description: string
  defaultBranch: string
  detected: boolean
}

register('projects.inspectRemote', async (raw): Promise<RemoteInspectResult> => {
  const params = Params.parse(raw)
  const name = repoNameOf(params.gitRemote)
  const gh = parseGitHubRepo(params.gitRemote)
  const bare: RemoteInspectResult = {
    name,
    language: '',
    description: '',
    defaultBranch: '',
    detected: false,
  }
  if (!gh || !SEG_RE.test(gh.owner) || !SEG_RE.test(gh.repo)) return bare

  try {
    const stdout = await runGh(
      [
        'repo',
        'view',
        `${gh.owner}/${gh.repo}`,
        '--json',
        'name,description,primaryLanguage,defaultBranchRef',
      ],
      homedir(),
      params.account,
    )
    const data = JSON.parse(stdout) as GhRepoView
    return {
      name: data.name || name,
      language: data.primaryLanguage?.name ?? '',
      description: data.description ?? '',
      defaultBranch: data.defaultBranchRef?.name ?? '',
      detected: true,
    }
  } catch (err) {
    // gh missing / not authed / repo not found / no access → name-only. The UI
    // still auto-fills name + clone destination from the parsed remote.
    log.info('projects.inspectRemote: gh metadata unavailable', {
      err: err instanceof Error ? err.message : String(err),
    })
    return bare
  }
})
