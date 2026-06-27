// gh.commits → the commit list of a PR (ADR 0049). cwd = project.path
// (server-loaded). `number` is an int; nothing path-like from params reaches the
// args. Issues carry no commits → `{ commits: [] }` without spawning gh.
//
// gh `pr view --json commits` returns commits as
//   { oid, messageHeadline, messageBody, committedDate, authors: [{ name, login }] }
// across versions, plus extra keys → the schema is lenient (.passthrough(), pick
// only what we need; never reject unknown keys), mirroring github/thread.ts.
//
// On gh failure, runGh throws the same RpcError envelope (GH_RPC_CODE + ghCode)
// the other gh methods use; stderr is token-stripped in the runner (tokens never
// logged).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGh } from '../github/runner.js'
import { resolveProjectCwd } from '../github/project-cwd.js'

const Params = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['issue', 'pr']),
  number: z.number().int().positive(),
  account: z.string().optional(),
  // Child repo of a multi-repo workspace (relativePath from git.discoverRepos).
  repoPath: z.string().optional(),
})

// One commit on the RPC contract. The UI shortens the sha for display, so the full
// oid is kept here.
export interface GhCommit {
  sha: string
  message: string
  author: string
  date: string
}

interface Result {
  commits: GhCommit[]
}

// Lenient per-commit shape (matches github/thread.ts: passthrough + pick).
const CommitAuthor = z
  .object({ name: z.string().optional(), login: z.string().optional() })
  .passthrough()

const CommitJson = z
  .object({
    oid: z.string().optional(),
    messageHeadline: z.string().optional(),
    committedDate: z.string().optional(),
    authors: z.array(CommitAuthor).optional(),
  })
  .passthrough()

const CommitsJson = z.object({ commits: z.array(CommitJson).optional() }).passthrough()

register('gh.commits', async (raw): Promise<Result> => {
  const params = Params.parse(raw)

  // Issues carry no commits — return empty without touching gh.
  if (params.kind === 'issue') return { commits: [] }

  const cwd = await resolveProjectCwd(params.projectId, params.repoPath)
  const stdout = await runGh(
    ['pr', 'view', String(params.number), '--json', 'commits'],
    cwd,
    params.account,
  )

  const j = CommitsJson.parse(JSON.parse(stdout))
  // gh returns commits oldest → newest already; keep that order.
  const commits: GhCommit[] = (j.commits ?? []).map((c) => {
    const first = c.authors?.[0]
    return {
      sha: c.oid ?? '',
      message: c.messageHeadline ?? '',
      author: first?.login ?? first?.name ?? '',
      date: c.committedDate ?? '',
    }
  })
  return { commits }
})
