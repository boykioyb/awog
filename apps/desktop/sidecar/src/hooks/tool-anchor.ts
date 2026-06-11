// Tool-call hook anchor (ADR 0032 D-1/D-2). Wraps each AgentTool's execute so
// `tool.before-call` / `tool.after-call` fire around EVERY tool (built-in + MCP)
// and `artifact.before-write` / `artifact.after-write` fire around Write/Edit
// (the files the agent actually changes). Applied once in
// createRuntimeToolDefinitions so it covers chat sessions AND task nodes.
//
// A blockable hook that exits non-zero throws an Error — the Pi loop turns it
// into an error tool result (same convention fs-tools uses for failures), so the
// model sees "Blocked by hook …" and adapts. Dispatch fast-returns when no hook
// matches, so the per-call overhead is a cache lookup when nothing is configured.

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { dispatch } from './dispatcher.js'

export interface HookToolContext {
  surface: 'session' | 'task'
  projectId?: string
  workspace: string
}

const FILE_WRITE_TOOLS = new Set(['Write', 'Edit'])

type ExecuteFn = (...callArgs: unknown[]) => Promise<AgentToolResult<unknown>>

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

function filePathOf(input: Record<string, unknown>): string | undefined {
  const p = input.file_path
  return typeof p === 'string' ? p : undefined
}

function blockError(stderr: string, hookName: string): Error {
  return new Error(`Blocked by hook "${hookName}": ${stderr}`)
}

function wrapTool(tool: AgentTool, ctx: HookToolContext): AgentTool {
  const orig = tool.execute.bind(tool) as ExecuteFn
  const base: { projectId?: string; workspace: string } = {
    workspace: ctx.workspace,
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
  }
  const toolName = tool.name

  const execute: ExecuteFn = async (...callArgs) => {
    const input = asRecord(callArgs[1])
    const path = FILE_WRITE_TOOLS.has(toolName) ? filePathOf(input) : undefined

    const before = await dispatch('tool.before-call', { payload: { toolName, input } }, base)
    if (before.blocked && before.blockedBy) throw blockError(before.blockedBy.stderr, before.blockedBy.name)

    if (path !== undefined) {
      const beforeWrite = await dispatch('artifact.before-write', { payload: { path, toolName } }, base)
      if (beforeWrite.blocked && beforeWrite.blockedBy) {
        throw blockError(beforeWrite.blockedBy.stderr, beforeWrite.blockedBy.name)
      }
    }

    const result = await orig(...callArgs)

    if (path !== undefined) {
      await dispatch('artifact.after-write', { payload: { path, toolName } }, base)
    }
    await dispatch('tool.after-call', { payload: { toolName, input } }, base)
    return result
  }

  return { ...tool, execute } as AgentTool
}

export function wrapToolsWithHooks(tools: AgentTool[], ctx: HookToolContext): AgentTool[] {
  return tools.map((t) => wrapTool(t, ctx))
}
