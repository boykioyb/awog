// AI-generated pull-request summary (title + markdown description).
//
// Runs through the Pi runtime (completePi) like git.generateCommitMessage. The
// model sees three inputs describing the branch's work:
//   1. the commit log of `base..head` (the narrative / plan),
//   2. the diff of `base...head` (the code changes since the branches diverged),
//   3. the content of requirement/plan docs the branch added or modified.
// Output is plain text: the FIRST line is the PR title, the rest is the markdown
// body (git-commit convention). No JSON — markdown bodies with fenced code round-
// trip through JSON badly, so first-line-is-title keeps parsing robust.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { runGit } from '../git/runner.js'
import { completePi } from '../runtime/complete.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const Params = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  // head = the branch the PR is opened FROM; base = the branch it merges INTO.
  head: z.string().min(1).max(512),
  base: z.string().min(1).max(512),
  // The project's git commit convention (settings.git.commitMessageRule). The PR
  // TITLE must follow it so the summary matches the team's rule (e.g. Conventional
  // Commits). The description stays free-form Markdown, so the rule binds the title
  // only. Omitted → a generic imperative title.
  titleRule: z.string().min(1).max(16_000).optional(),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
})

// Budgets — past these the prompt cost balloons with little quality gain.
const DIFF_MAX_CHARS = 60_000
const DOC_FILE_MAX_CHARS = 8_000
const DOC_TOTAL_MAX_CHARS = 40_000
const MAX_DOC_FILES = 10
const MAX_COMMITS = 60

// Title rule block — injected only when the project defines a commit convention.
// The rule describes a full commit message ("NO markdown", subject+body), so we
// scope it to the title line and explicitly free the description from it.
function titleRuleBlock(rule: string | undefined): string {
  if (!rule) {
    return '- The FIRST line is the PR title: a single imperative sentence, no trailing period, ideally under 72 characters. Do NOT prefix it with "#" or "Title:".'
  }
  return `- The FIRST line is the PR title and MUST follow this project's commit convention. Apply the convention's SUBJECT-LINE format and constraints (e.g. \`<type>(<scope>): <subject>\`, length, casing, language) to the title. Ignore any part of the convention about a body or "no markdown" — that governs commit messages, not the description below. Do NOT prefix the title with "#" or "Title:".
  Project commit convention:
  """
  ${rule.trim()}
  """`
}

function buildSystemPrompt(titleRule: string | undefined): string {
  return `You write clear, concise pull-request summaries for a software team.

You are given a branch's commit log, its code diff against the base branch, and the content of any requirement/plan documents the branch touched. Produce a pull-request summary.

Output format (STRICT):
${titleRuleBlock(titleRule)}
- Leave the second line blank.
- The rest is the PR description in GitHub-flavored Markdown.

Description guidance:
- Open with a short "## Summary" of what the PR does and why (grounded in the requirement/plan docs when present).
- Add "## Changes" as a bullet list of the notable changes (group by area; reference files/modules, not every line).
- Add "## Test plan" with checkbox items ("- [ ] …") describing how to verify the change.
- Omit a section only if there is genuinely nothing to say for it.
- Be faithful to the diff and docs; never invent changes or requirements that aren't evidenced. Write in the language of the source material (English if the code/docs are English, Vietnamese if they are Vietnamese).
- Output ONLY the title + description. No preamble, no surrounding code fence.`
}

// Doc files that count as "requirement / plan" context. Matched on extension or
// on a path/basename signal (docs dir, spec/plan/requirement/design/rfc, or a
// well-known top-level doc). Kept broad but cheap — it only decides which changed
// files to inline as prose context.
const DOC_EXT = /\.(md|mdx|markdown|txt|rst|adoc)$/i
const DOC_PATH = /(^|\/)(docs?|requirements?|specs?|plans?|designs?|rfcs?)(\/|$)/i
const DOC_BASENAME = /(readme|changelog|plan|spec|requirements?|design|prd|roadmap)/i

function isDocFile(path: string): boolean {
  const base = path.split('/').at(-1) ?? path
  return DOC_EXT.test(path) || DOC_PATH.test(path) || DOC_BASENAME.test(base)
}

// Parse `git diff --name-status` output into {status, path}. Renames/copies come
// as `R100\told\tnew` (3 columns) — we keep the NEW path (it exists at head).
function parseNameStatus(stdout: string): Array<{ status: string; path: string }> {
  const out: Array<{ status: string; path: string }> = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const cols = line.split('\t')
    const status = (cols[0] ?? '').trim()
    const path = cols.length >= 3 ? (cols[2] ?? '') : (cols[1] ?? '')
    if (path) out.push({ status: status[0] ?? '', path })
  }
  return out
}

register('git.generatePrSummary', async (raw) => {
  const params = Params.parse(raw)
  const { workspaceRoot, head, base } = params

  if (head === base) {
    throw new RpcError(-32602, 'Head and base branches are the same')
  }

  // Commit log of base..head — the branch's narrative. Empty when head has no
  // commits beyond base (nothing to summarise).
  const logRes = await runGit(workspaceRoot, [
    'log',
    `${base}..${head}`,
    `--max-count=${MAX_COMMITS}`,
    '--no-color',
    '--pretty=format:- %s%n%w(0,2,2)%b',
  ])
  const commitLog = logRes.stdout.trim()

  // Three-dot diff: what changed on head since it diverged from base (the PR view).
  const diffRes = await runGit(workspaceRoot, [
    'diff',
    `${base}...${head}`,
    '--no-color',
    '--find-renames',
  ])
  let diffText = diffRes.stdout
  let truncated = false
  if (diffText.length > DIFF_MAX_CHARS) {
    diffText = `${diffText.slice(0, DIFF_MAX_CHARS)}\n\n[…diff truncated at ${DIFF_MAX_CHARS} characters; ${diffText.length - DIFF_MAX_CHARS} more bytes elided]`
    truncated = true
  }

  if (!commitLog && !diffText.trim()) {
    throw new RpcError(-32602, `No changes between ${base} and ${head}`)
  }

  // Requirement/plan docs the branch added or modified → inline their content at
  // head so the model can ground the summary in the intended behavior. Skip
  // deletions (no content at head) and cap count + total size.
  const nameStatus = await runGit(workspaceRoot, [
    'diff',
    `${base}...${head}`,
    '--name-status',
    '--find-renames',
  ])
  const docPaths = parseNameStatus(nameStatus.stdout)
    .filter((f) => f.status !== 'D' && isDocFile(f.path))
    .map((f) => f.path)
    .slice(0, MAX_DOC_FILES)

  const docSections: string[] = []
  let docTotal = 0
  for (const path of docPaths) {
    if (docTotal >= DOC_TOTAL_MAX_CHARS) break
    // eslint-disable-next-line no-await-in-loop -- sequential, capped to MAX_DOC_FILES
    const show = await runGit(workspaceRoot, ['show', `${head}:${path}`], {
      throwOnNonZero: false,
    })
    if (show.code !== 0 || !show.stdout.trim()) continue
    let content = show.stdout
    if (content.length > DOC_FILE_MAX_CHARS) {
      content = `${content.slice(0, DOC_FILE_MAX_CHARS)}\n[…truncated]`
    }
    docTotal += content.length
    docSections.push(`### ${path}\n${content}`)
  }

  const userPrompt = [
    `Base branch: ${base}`,
    `Head branch: ${head}`,
    '',
    '## Commits',
    commitLog || '(no commits beyond base)',
    '',
    docSections.length ? '## Requirement / plan documents (added or changed on this branch)' : '',
    docSections.join('\n\n'),
    '',
    truncated ? '## Diff (truncated)' : '## Diff',
    diffText.trim() || '(no textual diff)',
    '',
    'Write the pull-request summary now.',
  ]
    .filter((line) => line !== '')
    .join('\n')

  const modelId = params.modelId ?? 'claude-haiku-4-5'

  log.info('git.generatePrSummary', {
    model: modelId,
    base,
    head,
    docFiles: docSections.length,
    diffChars: diffText.length,
    truncated,
  })

  const collected = await completePi({
    accountId: params.accountId,
    modelId,
    systemPrompt: buildSystemPrompt(params.titleRule),
    prompt: userPrompt,
  })

  const text = collected.trim()
  if (!text) throw new RpcError(-32021, 'Empty response from model')

  // First non-empty line = title; the remainder (after the blank separator) =
  // markdown description. Strip a stray leading "# " the model may still emit.
  const lines = text.split('\n')
  const title = (lines[0] ?? '').replace(/^#+\s*/, '').trim()
  const description = lines.slice(1).join('\n').trim()

  return { title, description, model: modelId, truncated }
})
