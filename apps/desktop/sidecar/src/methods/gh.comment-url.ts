// gh.commentUrl → resolve a bare GitHub comment/review id to its html_url, so
// text like "comment 5949627309" in a board thread or session message can open
// straight into the browser. cwd = project.path (server-loaded).
//
// A bare id is ambiguous across three API families — issue/PR comments
// (#issuecomment-…), PR review comments (#discussion_r…), and PR reviews
// (#pullrequestreview-…) — so we probe each endpoint in order and keep the
// first hit. A 404 just means "wrong family"; an auth/no-repo failure aborts
// the probe immediately since every endpoint would fail the same way.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGh } from '../github/runner.js'
import { resolveProjectCwd } from '../github/project-cwd.js'
import { GH_RPC_CODE, GhErrorCode } from '../github/error-map.js'

const Params = z.object({
  projectId: z.string().min(1),
  // Child repo of a multi-repo workspace (relativePath from git.discoverRepos).
  repoPath: z.string().optional(),
  // Digits only — the id never reaches a path or shell.
  commentId: z.string().regex(/^\d{4,}$/),
  account: z.string().optional(),
})

const FATAL_GH_CODES = new Set<string>([
  GhErrorCode.GH_NOT_FOUND,
  GhErrorCode.GH_NOT_AUTH,
  GhErrorCode.GH_NO_REPO,
])

const endpoints = (id: string): string[] => [
  `repos/{owner}/{repo}/issues/comments/${id}`,
  `repos/{owner}/{repo}/pulls/comments/${id}`,
  `repos/{owner}/{repo}/pulls/reviews/${id}`,
]

register('gh.commentUrl', async (raw): Promise<{ url: string }> => {
  const params = Params.parse(raw)
  const cwd = await resolveProjectCwd(params.projectId, params.repoPath)
  for (const ep of endpoints(params.commentId)) {
    try {
      const url = (
        await runGh(['api', ep, '--jq', '.html_url'], cwd, params.account)
      ).trim()
      // Belt-and-suspend: only ever hand back an https GitHub URL — the UI
      // shells it to shell.openExternal.
      if (/^https:\/\/[\w.-]+(?::\d+)?\//.test(url)) return { url }
    } catch (err) {
      const ghCode =
        err instanceof RpcError ? (err.data as { ghCode?: string } | undefined)?.ghCode : undefined
      if (ghCode && FATAL_GH_CODES.has(ghCode)) throw err // auth/no-repo — probing more is pointless
      // else: not found on this family → try the next endpoint.
    }
  }
  throw new RpcError(GH_RPC_CODE, 'Comment not found', { ghCode: GhErrorCode.UNKNOWN })
})
