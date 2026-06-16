// Parse a git remote URL and build the provider's "open a pull/merge request"
// web URL. Pure functions (no IPC) so they are trivially testable and the
// caller (Create PR modal) only opens the result via `sidecar.openExternal`.
// Per ADR 0040 — Create PR is browser-only (no gh CLI / API / token).

export type RemoteRepo = {
  // Lower-cased hostname, e.g. `github.com`, `gitlab.example.com`.
  host: string
  // Namespace + repo, e.g. `owner/repo` or `group/subgroup/repo` (GitLab).
  path: string
}

export type Forge = 'github' | 'gitlab' | 'bitbucket' | null

// Accepts the common remote URL shapes:
//   - SCP-like SSH:  git@github.com:owner/repo.git
//   - SSH URL:       ssh://git@github.com/owner/repo.git
//   - HTTPS:         https://github.com/owner/repo(.git)
//   - git protocol:  git://github.com/owner/repo.git
// Returns null when the URL can't be parsed into host + owner/repo.
export function parseRemoteUrl(url: string): RemoteRepo | null {
  if (!url) return null
  const s = url.trim()
  let host: string | undefined
  let path: string | undefined

  const scp = /^[A-Za-z0-9._-]+@([^:/]+):(.+)$/.exec(s)
  if (scp && !s.includes('://')) {
    host = scp[1]
    path = scp[2]
  } else {
    try {
      const u = new URL(s)
      host = u.hostname
      path = u.pathname.replace(/^\/+/, '')
    } catch {
      return null
    }
  }

  if (!host || !path) return null
  host = host.toLowerCase()
  // Reject anything that isn't a plausible hostname so a crafted remote can't
  // smuggle extra authority/scheme characters into the opened URL.
  if (!/^[a-z0-9.-]+$/.test(host)) return null
  path = path.replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!path.includes('/')) return null
  return { host, path }
}

export function detectForge(host: string): Forge {
  if (host.includes('github')) return 'github'
  if (host.includes('gitlab')) return 'gitlab'
  if (host.includes('bitbucket')) return 'bitbucket'
  return null
}

// Build the "create PR/MR" URL for the given head/base branches. For unknown
// forges we fall back to the repo home page (caller surfaces a hint). Always
// https; branch names are URL-encoded to avoid query injection.
export function buildPullRequestUrl(repo: RemoteRepo, head: string, base?: string): string {
  const h = encodeURIComponent(head)
  const b = base ? encodeURIComponent(base) : ''
  // Encode each path segment so an exotic remote path can't inject raw
  // characters into the URL (the host is already a validated hostname).
  const safePath = repo.path.split('/').map(encodeURIComponent).join('/')
  const baseUrl = `https://${repo.host}/${safePath}`
  switch (detectForge(repo.host)) {
    case 'github':
      return base ? `${baseUrl}/compare/${b}...${h}?expand=1` : `${baseUrl}/compare/${h}?expand=1`
    case 'gitlab': {
      let url = `${baseUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${h}`
      if (base) url += `&merge_request%5Btarget_branch%5D=${b}`
      return url
    }
    case 'bitbucket': {
      let url = `${baseUrl}/pull-requests/new?source=${h}`
      if (base) url += `&dest=${b}`
      return url
    }
    default:
      return baseUrl
  }
}
