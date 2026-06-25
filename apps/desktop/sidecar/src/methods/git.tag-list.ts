// `git.tagList` — enumerate refs/tags sorted by creation date (newest first).
// Read-only: no mutex, no echo suppression. For an annotated tag `objectname`
// is the tag object's sha (not the commit it points at) — acceptable here; the
// UI only needs a stable identifier + short subject for display.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'

const Params = z.object({ workspaceRoot: z.string().min(1) })

// Tab-separated so we can split on `\t`. Order: short name, full sha, short sha,
// tag/commit subject, creation date (iso-strict).
const TAG_FORMAT =
  '%(refname:short)%09%(objectname)%09%(objectname:short)%09%(contents:subject)%09%(creatordate:iso-strict)'

interface GitTag {
  name: string
  sha: string
  sha7: string
  subject: string
  date: string
}

interface Result {
  tags: GitTag[]
}

register('git.tagList', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  const r = await runGit(params.workspaceRoot, [
    'for-each-ref',
    '--sort=-creatordate',
    `--format=${TAG_FORMAT}`,
    'refs/tags',
  ])

  const tags: GitTag[] = []
  for (const line of r.stdout.split('\n')) {
    if (line.length === 0) continue
    const [name, sha, sha7, subject, date] = line.split('\t')
    tags.push({
      name: name ?? '',
      sha: sha ?? '',
      sha7: sha7 ?? '',
      subject: subject ?? '',
      date: date ?? '',
    })
  }
  return { tags }
})
