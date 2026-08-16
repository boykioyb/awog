// Shared config builders for the Claude Agent SDK runtime (ADR 0058). Used by
// both the session path (run-stream.ts) and the task path (invoke.ts) so the
// credential/env, MCP conversion, model normalisation, effort mapping, and error
// mapping are defined once.

import { join } from 'node:path'
import type {
  Options,
  EffortLevel,
  HookInput,
  HookJSONOutput,
  ThinkingConfig,
} from '@anthropic-ai/claude-agent-sdk'
import { RpcError } from '../../transport/rpc.js'
import { awogHome } from '../../util/path.js'
import { log } from '../../util/logger.js'
import type { Credential } from '../../credentials/credential-resolver.js'
import type { McpServersConfig } from '../permission-types.js'
import type { ThinkingLevel } from '../../types/shared.js'
import { assertSafeUrl } from '../tools/ssrf.js'
import { CO_AUTHOR_TRAILER } from '../../git/co-author.js'

// Commit/PR attribution for the claude_code preset. The preset otherwise injects
// Claude's own "Generated with Claude Code" + `Co-Authored-By: Claude` trailer
// regardless of AWOG's setting — this overrides it to honor the Git
// `commitCoAuthor` toggle: on (default, flag omitted) → the AWOG trailer; off →
// '' (empty string hides attribution entirely, per the SDK's `attribution` docs).
export function commitAttribution(commitCoAuthor?: boolean): { commit: string; pr: string } {
  const text = commitCoAuthor === false ? '' : CO_AUTHOR_TRAILER
  return { commit: text, pr: text }
}

// Map a thrown error to the same RpcError codes the Pi path uses so the UI shows
// identical messages regardless of runtime. Token never logged.
export function mapClaudeErrorToRpc(err: unknown): RpcError {
  if (err instanceof RpcError) return err
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (name === 'AbortError' || lower.includes('aborted') || lower.includes('cancelled')) {
    return new RpcError(-32023, 'CANCELED')
  }
  if (lower.includes('unauthor') || lower.includes('401') || lower.includes('authentication')) {
    return new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return new RpcError(
      -32022,
      'Rate limited by the provider. Quota exhausted — try a cheaper model or wait a few minutes.',
    )
  }
  return new RpcError(-32021, `chat failed: ${message}`)
}

// Build the SDK subprocess env carrying the Anthropic credential. We do NOT
// mutate the sidecar's own process.env (that would race across concurrent
// sessions on different accounts) — the token lives only in the child's env.
// Also pins the SDK's session store to ~/.awog/claude-sdk (see below).
export function buildSdkEnv(cred: Credential): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_BASE_URL
  // Keep the SDK's session store (transcripts + resume + compaction) INSIDE
  // AWOG's own data dir instead of the default ~/.claude — so it doesn't
  // intermix with the user's real Claude Code CLI sessions and stays within the
  // local-first data layer. Sessions land under ~/.awog/claude-sdk/projects/.
  env.CLAUDE_CONFIG_DIR = join(awogHome(), 'claude-sdk')
  if (cred.kind === 'oauth') {
    env.CLAUDE_CODE_OAUTH_TOKEN = cred.accessToken
  } else {
    env.ANTHROPIC_API_KEY = cred.apiKey
    if (cred.baseURL) env.ANTHROPIC_BASE_URL = cred.baseURL
  }
  return env
}

// Convert AWOG's already-resolved MCP set (whitelist-intersected + secrets
// expanded upstream) into the SDK's `options.mcpServers` shape so the SDK spawns
// / connects them natively (ADR 0058: MCP is the SDK's own mechanism, NOT a
// custom tool). `alwaysLoad` so an explicitly-attached server's tools are present
// at turn-1 instead of deferred behind tool-search. http/sse URLs pass the same
// SSRF guard as the Pi path before we hand them to the SDK (invariant #7); a
// server failing the guard is dropped with a warning rather than blocking the turn.
export async function toSdkMcpServers(
  mcp: McpServersConfig | undefined,
): Promise<NonNullable<Options['mcpServers']> | undefined> {
  if (!mcp) return undefined
  const out: NonNullable<Options['mcpServers']> = {}
  for (const [name, cfg] of Object.entries(mcp)) {
    if (cfg.type === 'stdio') {
      out[name] = {
        type: 'stdio',
        command: cfg.command,
        ...(cfg.args ? { args: cfg.args } : {}),
        ...(cfg.env ? { env: cfg.env } : {}),
        ...(cfg.timeoutMs ? { timeout: cfg.timeoutMs } : {}),
        alwaysLoad: true,
      }
    } else {
      try {
        await assertSafeUrl(cfg.url)
      } catch (err) {
        log.warn('claude-sdk: dropping MCP server failing SSRF guard', {
          name,
          err: err instanceof Error ? err.message : String(err),
        })
        continue
      }
      out[name] = {
        type: 'http',
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers } : {}),
        ...(cfg.timeoutMs ? { timeout: cfg.timeoutMs } : {}),
        alwaysLoad: true,
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// Strip AWOG's internal `-1m` model variant to the API base id the SDK accepts.
export function toSdkModel(modelId: string): string {
  return modelId.replace(/-1m$/, '')
}

// AWOG ThinkingLevel → SDK effort. AWOG's picker IS the Claude Code effort picker
// (see thinking.ts), so on the SDK path (native Claude Code) we map DIRECTLY —
// `extra-high` is the SDK's `xhigh`. (The Pi path shifts levels down because Pi's
// reasoning scale differs; that translation is Pi-specific and not applied here.)
export function effortFromLevel(level: ThinkingLevel): EffortLevel {
  switch (level) {
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'extra-high':
      return 'xhigh'
    case 'max':
      return 'max'
    default:
      return 'medium'
  }
}

// AWOG ThinkingLevel → SDK extended-thinking config. `effort` alone guides depth
// but does NOT emit thinking blocks; `thinking` must be enabled for the model to
// produce (and stream) reasoning as thinking content. Mirrors the Pi mapping
// where 'low' = thinking off; every higher level uses ADAPTIVE thinking (Claude
// decides when/how much, guided by effort — Opus 4.6+/Sonnet 4.6+/Fable 5).
//
// `display: 'summarized'` is REQUIRED for the reasoning text to reach the UI. On
// the subscription (OAuth) path the SDK otherwise defaults to redacted thinking:
// the API streams only pings (`thinking_delta.estimated_tokens`) with empty
// `thinking` text (see sdk.d.ts SDKThinkingTokensMessage), so every thinking step
// collapses to the "Thinking…" placeholder. 'summarized' returns visible reasoning.
export function thinkingFromLevel(level: ThinkingLevel): ThinkingConfig {
  return level === 'low' ? { type: 'disabled' } : { type: 'adaptive', display: 'summarized' }
}

// ── Background work ─────────────────────────────────────────────────────────
//
// The CLI keeps a turn alive for background subagents/shells and wakes the model
// when one settles (`system/task_notification`) — but only while its stdin is
// open. The SDK closes stdin at the FIRST `result` whenever the caller passed a
// STRING prompt (sdk.mjs sets `isSingleUserTurn` from `typeof prompt === 'string'`),
// which killed the CLI process mid-run and made the promised notification
// impossible. The chat path therefore feeds a streaming prompt it holds open until
// no background task is live (run-stream.ts); this prompt tells the model the
// resulting contract.
export const BACKGROUND_TURN_PROMPT = `<background-work>
Background work is supported in this session and the turn stays open until it settles: subagents you spawn with \`Task\` (which run in the background by default) and commands you start with \`Bash(run_in_background: true)\` keep running, and you are woken with their result inside this same turn. Use that for genuinely parallel work. What does NOT survive is the END of the turn: never finish your reply expecting to be notified later — if a result matters, wait for it now and answer with it.
</background-work>`

// The TASK path (workflow nodes) has no such holding: it is a one-shot query whose
// result ends the node, so a backgrounded subagent there would be killed with it.
// Force the synchronous form on that path — applied to the tool INPUT via the
// PreToolUse hook's `updatedInput`, so it holds regardless of what the model asked.
export function forceForegroundSubagent(
  toolName: string,
  toolInput: Record<string, unknown>,
): void {
  if (toolName === 'Task' && toolInput.run_in_background !== false) {
    toolInput.run_in_background = false
  }
}

// Task-path counterpart of BACKGROUND_TURN_PROMPT: explains the constraint the
// hook above enforces, so the node doesn't end waiting to be notified.
export const NO_BACKGROUND_PROMPT = `<background-work>
This task node runs as a single one-shot: nothing survives its end, so background work is terminated and no completion notification can reach you. Subagents you spawn with \`Task\` are forced to run synchronously — their result comes back in the same tool call, so just use it. Do not run \`Bash\` with \`run_in_background: true\`, and never end your run waiting to be notified about anything.
</background-work>`

// Minimal PreToolUse hook for the UNATTENDED path (tasks): no permission gate to
// run — it exists solely to apply forceForegroundSubagent to the tool input. The
// chat path has its own hook (the 4-mode gate) and does not need this.
export function makeForegroundOnlyHook(): (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput> {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true }
    const toolInput =
      input.tool_input && typeof input.tool_input === 'object'
        ? { ...(input.tool_input as Record<string, unknown>) }
        : {}
    forceForegroundSubagent(input.tool_name, toolInput)
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: toolInput,
      },
    }
  }
}
