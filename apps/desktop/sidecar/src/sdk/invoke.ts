// One-shot task driver surface for the Task Execution Engine (ADR 0024 D-6).
//
// The LLM runtime is Pi (ADR 0029): invokeSdk delegates to runtime/invoke.ts's
// invokeSdkPi. This module keeps the call-site-stable surface (invokeSdk +
// InvokeArgs / InvokeCallbacks / InvokeResult / InvokeToolUse / InvokeToolResult)
// so tasks/engine.ts, tasks/node-runner.ts, and tasks/trace-mapper.ts are
// unaffected by the runtime.

import type { SessionSettings } from '../types/shared.js'
import type { McpServersConfig } from '../runtime/permission-types.js'

export interface InvokeArgs {
  // Already-rendered single prompt (no transcript wrapping).
  prompt: string
  settings: SessionSettings
  systemPrompt?: string
  systemPromptAppend?: string
  allowedTools?: string[]
  disabledTools?: string[]
  mcpServers?: McpServersConfig
  // Project workspace root → the runtime tools' fs root so Read/Write/Bash act
  // against the user's repo.
  cwd?: string
  abortController?: AbortController
  // Agent tiers in scope for the Task subagent menu (ADR 0030): the task's
  // project + the node agent's project. Empty/undefined → user tiers only.
  projectIds?: string[]
  // Task source connection (mcpServerId) unioned into a subagent's MCP set, same
  // as the node's own agent (ADR 0025). undefined for manual sources.
  connectionId?: string
}

export interface InvokeToolUse {
  id: string
  name: string
  input: Record<string, unknown>
  parentId?: string | null
}

export interface InvokeToolResult {
  id: string
  name: string
  input: Record<string, unknown>
  content: unknown
  isError: boolean
  parentId?: string | null
}

export interface InvokeCallbacks {
  // Main-agent assistant text deltas (the artifact body streams here).
  onText?: (delta: string) => void
  onToolUse?: (use: InvokeToolUse) => void
  onToolResult?: (result: InvokeToolResult) => void
  onThinking?: (id: string, delta: string, parentId: string | null) => void
  onAssistantMeta?: (
    model: string,
    usage: { input_tokens: number; output_tokens: number },
    parentId: string | null,
  ) => void
}

export interface InvokeResult {
  text: string
  modelUsed: string
  // cache_* are the Anthropic prompt-cache buckets (history served from cache).
  // Surfaced so the Activity rollup attributes a task's full token spend, not
  // just input/output (ADR 0054). Mirrors RunStreamResult.usage.
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_creation_tokens: number
  }
  stopReason: string | null
}

// Drive a single agentic turn through the Pi runtime. Streams text + tool +
// thinking events via cb, returns the aggregate. Throws RpcError on failure /
// cancellation.
export async function invokeSdk(args: InvokeArgs, cb: InvokeCallbacks): Promise<InvokeResult> {
  // Dynamically imported so the Pi runtime + its deps load only when a node runs.
  const { invokeSdkPi } = await import('../runtime/invoke.js')
  return invokeSdkPi(args, cb)
}
