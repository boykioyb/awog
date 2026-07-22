// AI-generate a one-line project description for the new-project form. Pure-text
// generation through the Pi runtime (no tools), mirroring
// git.generateCommitMessage. Facts (name / language / remote / existing notes)
// are fed as context; the model returns a single concise sentence.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { completePi } from '../runtime/complete.js'
import { log } from '../util/logger.js'

const ModelSchema = z.enum(ANTHROPIC_MODELS)

const Params = z.object({
  name: z.string().min(1).max(120),
  language: z.string().max(80).optional(),
  gitRemote: z.string().max(2048).optional(),
  // Any existing description / notes to refine instead of writing from scratch.
  hint: z.string().max(2000).optional(),
  accountId: z.string().min(1).max(120).optional(),
  modelId: ModelSchema.optional(),
})

const SYSTEM_PROMPT =
  'You write a single concise project description for a developer project catalog: ' +
  'one sentence, at most ~160 characters, plain and factual. Output ONLY the ' +
  'description text — no surrounding quotes, no preamble, no markdown, no bullet.'

register('projects.generateDescription', async (raw) => {
  const params = Params.parse(raw)
  // Haiku default — a one-liner; Opus is overkill (same choice as commit messages).
  const modelId = params.modelId ?? 'claude-haiku-4-5'

  const facts = [
    `Project name: ${params.name}`,
    params.language ? `Primary language: ${params.language}` : '',
    params.gitRemote ? `Git remote: ${params.gitRemote}` : '',
    params.hint ? `Existing notes to refine: ${params.hint}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  log.info('projects.generateDescription', { model: modelId, hasHint: !!params.hint })

  const collected = await completePi({
    accountId: params.accountId,
    modelId,
    systemPrompt: SYSTEM_PROMPT,
    prompt: `${facts}\n\nWrite the one-sentence description now.`,
  })

  const description = collected
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
  if (!description) throw new RpcError(-32021, 'Empty response from model')
  return { description, model: modelId }
})
