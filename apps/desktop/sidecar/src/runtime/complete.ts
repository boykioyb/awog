// Pi-SDK one-shot helpers for the 7 generator/author methods (ADR 0029 C2).
//
// Runtime chọn THEO PROVIDER, cùng quy tắc với chat: `anthropic` → Claude Agent SDK
// (claude-sdk/complete.ts); google + endpoint tuỳ chỉnh kiểu OpenAI → Pi (các hàm
// `pi*` private bên dưới). Bốn hàm public trung lập provider:
//   complete / completeWithUsage — sinh văn bản thuần (không tool, không permission).
//   streamComplete — như trên nhưng đẩy từng delta qua onDelta.
//   author — agentic one-shot CÓ tool Write/Read/Edit (bypass permission) + callback
//     stream text/tool; các method *.author ghi file lên đĩa qua nó.

import { completeSimple, streamSimple } from '@earendil-works/pi-ai/compat'
import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import { runAgentLoop, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core'
import { resolveAccount, resolveCredential, providerOfAccount } from '../credentials/credential-resolver.js'
import { normalizeModelId } from '../providers/anthropic/models-map.js'
import { runClaudeAuthor, runClaudeComplete } from './claude-sdk/complete.js'
import { recordCodexUsageFromHeaders } from '../providers/openai/usage.js'
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

// Lỗi từ chối do content-policy phía provider (vd Anthropic chặn "violative
// cyber content" → `model error: …`). Các one-shot nhét catalog do người dùng
// sở hữu (danh sách skill id — pentest/RE tooling của user chẳng hạn) có thể
// bắt lỗi này và retry bỏ block bị gắn cờ thay vì fail cả request: catalog chỉ
// là phần gợi ý, không phải payload chính.
export function isModelRefusal(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /violative|usage policy|refusals-and-fallback/i.test(msg)
}

// The minimal {provider, accountId, modelId} ref both helpers resolve from.
interface RunRef {
  provider?: ProviderName | undefined
  accountId?: string | undefined
  modelId: string
}

// Build the SessionSettings resolveModel needs from the helper args. level/mode
// are irrelevant for a non-thinking text turn but the type requires them.
function toSettings(args: RunRef, provider: ProviderName): SessionSettings {
  return {
    provider,
    modelId: normalizeModelId(args.modelId),
    level: 'low',
    mode: 'execute',
    ...(args.accountId ? { accountId: args.accountId } : {}),
  }
}

// Resolve {model, getApiKey} + the account for the Pi path.
async function resolveForRun(args: RunRef & { provider: ProviderName }): Promise<{
  account: Awaited<ReturnType<typeof resolveCredential>>['account']
  settings: SessionSettings
  model: ReturnType<typeof resolveModel>['model']
  getApiKey: ReturnType<typeof resolveModel>['getApiKey']
}> {
  const { account } = await resolveCredential(args.provider, args.accountId)
  const settings = toSettings(args, args.provider)
  // resolveModel validates the id per provider (catalog lookup) and trusts
  // user-supplied ids for custom endpoints (account.baseURL).
  const { model, getApiKey } = resolveModel(settings, account)
  return { account, settings, model, getApiKey }
}

// Runtime của một lượt one-shot. Provider = caller chỉ định, else suy từ bucket sở
// hữu account (account id là duy nhất toàn cục) — caller chỉ gửi accountId (các
// one-shot *.author/*.generate) vẫn đúng trên account không phải Anthropic.
// Anthropic chạy trên Claude SDK, TRỪ account có endpoint tuỳ chỉnh nói giao thức
// OpenAI chat-completions (nằm trong bucket anthropic nhưng CLI không nói được).
async function pickRuntime(args: RunRef): Promise<{ runtime: 'claude' } | { runtime: 'pi'; provider: ProviderName }> {
  const provider = args.provider ?? (await providerOfAccount(args.accountId)) ?? 'anthropic'
  if (provider === 'anthropic') {
    const account = await resolveAccount(provider, args.accountId)
    if (account.api !== 'openai-completions') return { runtime: 'claude' }
  }
  return { runtime: 'pi', provider }
}

// Kết quả one-shot kèm số đo thật của lượt gọi.
export interface CompleteResult {
  text: string
  modelUsed: string
  usage: { inputTokens: number; outputTokens: number }
}

// Pure-text one-shot kèm usage. Không tool — model chỉ sinh văn bản.
//
// Vì sao có bản này: `completePi` chỉ trả `string`, nên MỌI caller muốn biết
// lượt đó tốn bao nhiêu đều phải tự ƯỚC LƯỢNG bằng `chars / 4`. Kiểm định skill
// (`skills/eval.ts`) chạy tới 20 lượt liên tiếp và áp trần chi tiêu lên chính con
// số ước lượng đó — tức là một trần đo bằng thước đoán. Provider đã trả usage
// thật; chỉ là chưa ai chuyển nó ra ngoài.
export async function completeWithUsage(args: CompleteArgs): Promise<CompleteResult> {
  const picked = await pickRuntime(args)
  if (picked.runtime === 'claude') {
    const { text, modelUsed, usage } = await runClaudeComplete(args)
    return { text, modelUsed, usage }
  }
  return piCompleteWithUsage({ ...args, provider: picked.provider })
}

async function piCompleteWithUsage(args: CompleteArgs & { provider: ProviderName }): Promise<CompleteResult> {
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
      { apiKey, onResponse: (resp) => recordCodexUsageFromHeaders(account.id, resp.headers) },
    )
    if (result.stopReason === 'error') {
      throw new RpcError(-32021, `model error: ${result.errorMessage ?? 'unknown'}`)
    }
    return {
      text: concatText(result),
      modelUsed: result.model ?? settings.modelId,
      usage: { inputTokens: result.usage.input, outputTokens: result.usage.output },
    }
  } catch (err) {
    throw mapErr(err, 'completion')
  }
}

// Bản chỉ-lấy-text của completeWithUsage.
export async function complete(args: CompleteArgs): Promise<string> {
  return (await completeWithUsage(args)).text
}

// Streaming pure-text one-shot. Same shape as completePi but forwards each text
// delta via onDelta as it arrives (the caller relays them to the UI) and returns
// the full text at the end. No tools — the model just generates. Used by the
// summarize-prompt method so the Export dialog shows the prompt building live
// instead of a blank spinner.
export async function streamComplete(args: CompleteArgs, onDelta: (delta: string) => void): Promise<string> {
  const picked = await pickRuntime(args)
  if (picked.runtime === 'claude') {
    return (await runClaudeComplete(args, onDelta)).text
  }
  return piStreamComplete({ ...args, provider: picked.provider }, onDelta)
}

async function piStreamComplete(
  args: CompleteArgs & { provider: ProviderName },
  onDelta: (delta: string) => void,
): Promise<string> {
  const { account, settings, model, getApiKey } = await resolveForRun(args)
  const apiKey = await getApiKey(settings.provider)
  if (!apiKey) throw new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')

  log.info('one-shot stream (pi)', { model: settings.modelId, account: account.id })

  try {
    const events = streamSimple(
      model,
      {
        systemPrompt: args.systemPrompt,
        messages: [{ role: 'user', content: args.prompt, timestamp: Date.now() }],
      },
      { apiKey, onResponse: (resp) => recordCodexUsageFromHeaders(account.id, resp.headers) },
    )
    let text = ''
    for await (const ev of events) {
      if (ev.type === 'text_delta' && ev.delta.length > 0) {
        text += ev.delta
        onDelta(ev.delta)
      } else if (ev.type === 'error') {
        throw new RpcError(-32021, `model error: ${ev.error.errorMessage ?? 'unknown'}`)
      }
    }
    return text
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

// Agentic one-shot WITH tools + streaming (Write/Read/Edit, bypass permission: the
// user explicitly opened the author flow → implicit consent). Forwards text deltas
// + tool steps via cb.
export async function author(args: AuthorArgs, cb: AuthorCallbacks): Promise<AuthorResult> {
  const picked = await pickRuntime(args)
  if (picked.runtime === 'claude') return runClaudeAuthor(args, cb)
  return piAuthor({ ...args, provider: picked.provider }, cb)
}

async function piAuthor(args: AuthorArgs & { provider: ProviderName }, cb: AuthorCallbacks): Promise<AuthorResult> {
  const { account, settings, model, getApiKey } = await resolveForRun(args)
  const initialKey = await getApiKey(settings.provider)

  // Authoring only materialises a single config .md — Write/Read/Edit cover it
  // (Write mkdir's parents itself). Withhold Bash/Grep/Glob/Web stubs: with the
  // full set the model probes the shell (pwd/ls) in this headless one-shot env,
  // the command fails, and it narrates "shell unavailable", derailing the author
  // chat. The systemPrompt's allowed paths remain the write gate.
  const tools = createAwogToolDefinitions(args.cwd ?? process.cwd(), {
    allowedTools: ['Write', 'Read', 'Edit'],
  })

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
        // Capture Codex plan-usage from response headers (no-op for non-Codex).
        onResponse: (resp) => recordCodexUsageFromHeaders(account.id, resp.headers),
        toolExecution: 'sequential',
      },
      emit,
      // No abort signal: author flows are unattended one-shots. pi 0.84 wants the
      // stream function explicitly (see run-stream.ts).
      undefined,
      streamSimple,
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
