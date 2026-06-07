// Pi-SDK one-shot helpers for the 7 generator/author methods (ADR 0029 C2).
//
// Two shapes:
//   completePi — pure text generation (NO tools, NO permission). The 4
//     *.generate methods + git.generateCommitMessage call this: a single
//     non-streaming turn returning concatenated assistant text.
//   authorPi — agentic one-shot WITH the AWOG Write/Read tool set (bypass
//     permission) + streaming callbacks. The 3 *.author methods call this: they
//     materialise a file on disk via Write AND stream text/step events to the UI,
//     so a no-tools completeSimple cannot reach parity. authorPi drives
//     runAgentLoop (like runtime/invoke.ts) and forwards deltas + tool steps.

import { completeSimple, type AssistantMessage, type Message } from '@earendil-works/pi-ai'
import { runAgentLoop, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core'
import { resolveCredential } from '../credentials/credential-resolver.js'
import { normalizeModelId } from '../providers/anthropic/models-map.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import type { ProviderName, SessionSettings } from '../types/shared.js'
import { resolveModel } from './model-resolver.js'
import { createAwogToolDefinitions } from './tools/index.js'

export interface CompleteArgs {
  // `| undefined` (not just optional) so callers can forward params.accountId
  // verbatim under exactOptionalPropertyTypes without a conditional spread.
  provider?: ProviderName | undefined
  accountId?: string | undefined
  modelId: string
  systemPrompt: string
  prompt: string
}

function concatText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

// Map errors to the same RPC code the sdk one-shots use for SDK failures.
function mapErr(err: unknown, what: string): RpcError {
  if (err instanceof RpcError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new RpcError(-32021, `${what} failed: ${message}`)
}

// The minimal {provider, accountId, modelId} ref both helpers resolve from.
interface RunRef {
  provider?: ProviderName | undefined
  accountId?: string | undefined
  modelId: string
}

// Build the SessionSettings resolveModel needs from the helper args. level/mode
// are irrelevant for a non-thinking text turn but the type requires them.
function toSettings(args: RunRef): SessionSettings {
  return {
    provider: args.provider ?? 'anthropic',
    modelId: normalizeModelId(args.modelId),
    level: 'low',
    mode: 'execute',
    ...(args.accountId ? { accountId: args.accountId } : {}),
  }
}

// Resolve {model, getApiKey} + the account. Shared by both helpers.
async function resolveForRun(args: RunRef): Promise<{
  account: Awaited<ReturnType<typeof resolveCredential>>['account']
  settings: SessionSettings
  model: ReturnType<typeof resolveModel>['model']
  getApiKey: ReturnType<typeof resolveModel>['getApiKey']
}> {
  const { account } = await resolveCredential(args.provider ?? 'anthropic', args.accountId)
  const settings = toSettings(args)
  // resolveModel validates the id per provider (catalog lookup) and trusts
  // user-supplied ids for custom endpoints (account.baseURL).
  const { model, getApiKey } = resolveModel(settings, account)
  return { account, settings, model, getApiKey }
}

// Pure-text one-shot. No tools — the model just generates and we return text.
export async function completePi(args: CompleteArgs): Promise<string> {
  const { account, settings, model, getApiKey } = await resolveForRun(args)
  const apiKey = await getApiKey(settings.provider)
  if (!apiKey) throw new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')

  log.info('one-shot complete (pi)', { model: settings.modelId, account: account.id })

  try {
    const result = await completeSimple(
      model,
      {
        systemPrompt: args.systemPrompt,
        messages: [{ role: 'user', content: args.prompt, timestamp: Date.now() }],
      },
      { apiKey },
    )
    if (result.stopReason === 'error') {
      throw new RpcError(-32021, `model error: ${result.errorMessage ?? 'unknown'}`)
    }
    return concatText(result)
  } catch (err) {
    throw mapErr(err, 'completion')
  }
}

export interface AuthorArgs {
  // `| undefined` (not just optional) so callers forward params.accountId
  // verbatim under exactOptionalPropertyTypes (see CompleteArgs).
  provider?: ProviderName | undefined
  accountId?: string | undefined
  modelId: string
  systemPrompt: string
  // Already-rendered transcript (the *.author methods own history rendering).
  prompt: string
  // cwd anchors the tool fs root (defaults to the process cwd); the tools still
  // enforce their own path sanitisation against the AWOG dirs the systemPrompt
  // allows.
  cwd?: string | undefined
}

export interface AuthorCallbacks {
  onText: (delta: string) => void
  onToolUse: (use: { id: string; name: string; input: Record<string, unknown> }) => void
  onToolResult: (res: {
    id: string
    name: string
    input: Record<string, unknown>
    content: unknown
    isError: boolean
  }) => void
}

export interface AuthorResult {
  text: string
  modelUsed: string
  usage: { inputTokens: number; outputTokens: number }
  stopReason: string | null
}

function isAssistant(m: AgentMessage): m is AssistantMessage {
  return (m as { role?: unknown }).role === 'assistant'
}

function toInputRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
}

// Agentic one-shot WITH tools + streaming. Drives runAgentLoop with the AWOG
// Write/Read/Edit/Bash/Grep/Glob set and bypass permission (the user explicitly
// opened the author flow → implicit consent, mirroring the sdk branch's
// bypassPermissions). Forwards text deltas + tool steps via cb.
export async function authorPi(args: AuthorArgs, cb: AuthorCallbacks): Promise<AuthorResult> {
  const { account, settings, model, getApiKey } = await resolveForRun(args)
  const initialKey = await getApiKey(settings.provider)

  // Full tool set: the author needs Write to materialise the file on disk.
  const tools = createAwogToolDefinitions(args.cwd ?? process.cwd())

  let text = ''
  let modelUsed = ''
  let inputTokens = 0
  let outputTokens = 0
  let stopReason: string | null = null
  const toolInputs = new Map<string, { name: string; input: Record<string, unknown> }>()

  log.info('one-shot author (pi)', { model: settings.modelId, account: account.id })

  const emit = (event: AgentEvent): void => {
    switch (event.type) {
      case 'message_update': {
        const inner = event.assistantMessageEvent
        if (inner.type === 'text_delta' && inner.delta.length > 0) {
          text += inner.delta
          cb.onText(inner.delta)
        }
        break
      }
      case 'tool_execution_start': {
        const input = toInputRecord(event.args)
        toolInputs.set(event.toolCallId, { name: event.toolName, input })
        cb.onToolUse({ id: event.toolCallId, name: event.toolName, input })
        break
      }
      case 'tool_execution_end': {
        const meta = toolInputs.get(event.toolCallId) ?? { name: event.toolName, input: {} }
        const content =
          event.result && typeof event.result === 'object'
            ? (event.result as { content?: unknown }).content
            : event.result
        cb.onToolResult({
          id: event.toolCallId,
          name: meta.name,
          input: meta.input,
          content,
          isError: event.isError === true,
        })
        break
      }
      case 'agent_end': {
        const last = [...event.messages].reverse().find(isAssistant)
        if (last) {
          const finalText = last.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text)
            .join('')
          if (finalText) text = finalText
          if (last.model) modelUsed = last.model
          inputTokens = last.usage.input
          outputTokens = last.usage.output
          stopReason = last.stopReason
        }
        break
      }
      default:
        break
    }
  }

  try {
    await runAgentLoop(
      [{ role: 'user', content: args.prompt, timestamp: Date.now() }],
      {
        systemPrompt: args.systemPrompt,
        messages: [],
        ...(tools.length > 0 ? { tools } : {}),
      },
      {
        model,
        ...(initialKey ? { apiKey: initialKey } : {}),
        getApiKey,
        convertToLlm: (messages) => messages as Message[],
        // Author flows are unattended one-shots: always allow (the listed paths
        // in the systemPrompt are the gate, same as the sdk bypassPermissions).
        beforeToolCall: async () => undefined,
        toolExecution: 'sequential',
      },
      emit,
    )
  } catch (err) {
    throw mapErr(err, 'authoring')
  }

  return {
    text,
    modelUsed: modelUsed || settings.modelId,
    usage: { inputTokens, outputTokens },
    stopReason,
  }
}
