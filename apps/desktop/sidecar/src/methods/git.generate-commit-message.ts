// AI-generated commit message from staged diff.
//
// Reuses the same Anthropic OAuth account + claude-agent-sdk machinery as
// skills.generate / agents.generate. Unlike those, the model output is plain
// text (the commit message itself) — no JSON, no schema. The system prompt
// comes from settings.git.commitMessageRule so teams can pin their own
// convention without touching code.

import { z } from 'zod'
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { register, RpcError } from '../transport/rpc.js'
import { resolveAccount } from '../sessions/runner.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
import { log } from '../util/logger.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { runGit } from '../git/runner.js'

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

interface AssistantTextBlock {
  type: 'text'
  text: string
}

function isTextBlock(block: unknown): block is AssistantTextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  )
}

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

  const account = await resolveAccount('anthropic', params.accountId)
  const tokens = await ensureFreshAccessToken('anthropic', account.id)

  // Haiku default — commit messages are short; Opus is overkill.
  const modelId = params.modelId ?? 'claude-haiku-4-5'

  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_OAUTH_TOKEN: tokens.accessToken,
    CLAUDE_CODE_ENTRYPOINT: 'awog-sidecar',
  }
  delete env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN

  const options: Options = {
    model: modelId,
    env,
    persistSession: false,
    permissionMode: 'bypassPermissions',
    systemPrompt: params.rule,
  }

  log.info('git.generateCommitMessage', {
    account: account.id,
    model: modelId,
    files: nameList.stdout.trim().split('\n').length,
    diffChars: diffText.length,
    truncated,
  })

  let collected = ''
  try {
    const q = query({ prompt: userPrompt, options })
    for await (const evt of q) {
      if (evt.type === 'assistant') {
        const msg = evt.message as { content?: unknown[] }
        for (const block of msg.content ?? []) {
          if (isTextBlock(block)) collected += block.text
        }
      }
      if (evt.type === 'result') break
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('git.generateCommitMessage sdk error', { err: message })
    throw new RpcError(-32021, `Generate commit message failed: ${message}`)
  }

  const message = stripCodeFence(collected)
  if (!message) {
    throw new RpcError(-32021, 'Empty response from model')
  }

  return { message, model: modelId, truncated }
})
