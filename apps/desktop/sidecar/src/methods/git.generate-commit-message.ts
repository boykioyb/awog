// AI-generated commit message from staged diff.
//
// Runs through the Pi runtime (completePi) like skills.generate /
// agents.generate. Unlike those, the model output is plain text (the commit
// message itself) — no JSON, no schema. The system prompt comes from
// settings.git.commitMessageRule so teams can pin their own convention without
// touching code.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { runGit } from '../git/runner.js'
import { completePi } from '../runtime/complete.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const Params = z.object({
  workspaceRoot: z.string().min(1).max(4096),
  rule: z.string().min(1).max(16_000),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
})

// Cap the diff we send to the model. Past ~80KB the prompt cost balloons and
// the message quality plateaus — better to truncate and tell the model.
const DIFF_MAX_CHARS = 80_000

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:[a-zA-Z]*)?\s*([\s\S]*?)\s*```$/)
  if (fenced && fenced[1]) return fenced[1].trim()
  return trimmed
}

register('git.generateCommitMessage', async (raw) => {
  const params = Params.parse(raw)

  // Collect staged diff + file list. `git diff --cached` returns exit 0 with
  // empty stdout when nothing is staged — caller (UI) already guards but we
  // re-check defensively.
  const nameList = await runGit(params.workspaceRoot, ['diff', '--cached', '--name-only'])
  if (!nameList.stdout.trim()) {
    throw new RpcError(-32602, 'Nothing staged to generate a message for')
  }
  const diff = await runGit(params.workspaceRoot, [
    'diff',
    '--cached',
    '--no-color',
    '--find-renames',
  ])

  let diffText = diff.stdout
  let truncated = false
  if (diffText.length > DIFF_MAX_CHARS) {
    diffText = `${diffText.slice(0, DIFF_MAX_CHARS)}\n\n[…diff truncated at ${DIFF_MAX_CHARS} characters; ${diffText.length - DIFF_MAX_CHARS} more bytes elided]`
    truncated = true
  }

  const userPrompt = [
    'Files staged:',
    nameList.stdout.trim(),
    '',
    truncated ? 'Diff (truncated):' : 'Diff:',
    diffText,
    '',
    'Write the commit message now.',
  ].join('\n')

  // Haiku default — commit messages are short; Opus is overkill.
  const modelId = params.modelId ?? 'claude-haiku-4-5'

  log.info('git.generateCommitMessage', {
    model: modelId,
    files: nameList.stdout.trim().split('\n').length,
    diffChars: diffText.length,
    truncated,
  })

  // Pure-text generation through the Pi runtime (no tools).
  const collected = await completePi({
    accountId: params.accountId,
    modelId,
    systemPrompt: params.rule,
    prompt: userPrompt,
  })

  const message = stripCodeFence(collected)
  if (!message) {
    throw new RpcError(-32021, 'Empty response from model')
  }

  return { message, model: modelId, truncated }
})
