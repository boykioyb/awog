// Bridge AWOG's permission gate (canUseTool → parkPermissionRequest → UI) onto
// Pi's `beforeToolCall` hook (ADR 0029 item 3).
//
// The SAME canUseTool assembled in sessions.send-message.ts flows through
// RunNonStreamArgs and is invoked here, so the UI permission RPC + parking
// machinery is reused unchanged. We translate the result:
//   behavior 'allow' → return undefined (let the tool run); if updatedInput is
//     present, mutate the validated args in place (Pi executes with `args`).
//   behavior 'deny'  → return { block: true, reason: message } so the loop emits
//     an error tool result instead of executing.
//
// Mode handling:
//   execute      → no gate at all (canUseTool is not even wired in this mode).
//   accept-edits → auto-allow Write/Edit; everything else still gated.
//   plan         → block all writes/exec (Write/Edit/Bash); reads allowed.
//   ask          → gate all writes/exec via canUseTool.
//
// Read-family tools (Read/Grep/Glob) never gate — they are non-mutating.
//
// Contract: beforeToolCall must NOT throw. Any error → fail safe = block, so a
// bug can never silently let an unapproved write through.

import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'
import type { CanUseTool, PermissionUpdate } from './permission-types.js'
import type { AgentMode } from '../types/shared.js'
import { allowSessionTool, isSessionToolAllowed } from '../sessions/permissions.js'
import { BROWSER_TOOL_NAME, isMutatingBrowserAction } from './tools/browser-tool.js'
import { log } from '../util/logger.js'

// Tools that mutate the workspace or execute code. Everything else is read-only
// and runs without a permission prompt.
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const EXEC_TOOLS = new Set(['Bash'])
// Tools that spawn durable background work (ADR 0055): RunWorkflow kicks off a
// Task. Gated like a mutation so it prompts in ask/accept-edits and runs only in
// execute mode (in plan mode it isn't even registered).
const SPAWN_TOOLS = new Set(['RunWorkflow'])

// browser_tool is one tool with mixed actions: navigate/click/fill mutate (gate);
// screenshot/extract are read-only (don't gate). Decided per-call from args.
function isGatedTool(name: string, args: unknown): boolean {
  if (name === BROWSER_TOOL_NAME) return isMutatingBrowserAction(args)
  return WRITE_TOOLS.has(name) || EXEC_TOOLS.has(name) || SPAWN_TOOLS.has(name)
}

export type BeforeToolCall = (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>

// Wrap a beforeToolCall with per-turn hard caps (Pha 3 budget guard): once the
// turn makes more than `maxToolCalls` tool calls, or runs past `maxWallclockMs`,
// every further tool call is blocked — a runaway-loop / cost backstop independent
// of the permission mode. No-op (returns the inner hook unchanged) when no cap is
// set. The block reason surfaces to the model as a tool error, so it sees why and
// stops. `startedAtMs` is the turn start (caller-supplied so the clock is testable).
export function withTurnBudget(
  inner: BeforeToolCall,
  budget: { maxToolCalls?: number; maxWallclockMs?: number } | undefined,
  startedAtMs: number,
): BeforeToolCall {
  const maxCalls = budget?.maxToolCalls
  const maxMs = budget?.maxWallclockMs
  if ((maxCalls == null || maxCalls <= 0) && (maxMs == null || maxMs <= 0)) return inner
  let calls = 0
  return async (context, signal) => {
    calls += 1
    if (maxCalls != null && maxCalls > 0 && calls > maxCalls) {
      return {
        block: true,
        reason: `Turn tool-call budget exceeded (${maxCalls}). Stopped to prevent a runaway loop — raise the cap in session config to continue.`,
      }
    }
    if (maxMs != null && maxMs > 0 && Date.now() - startedAtMs > maxMs) {
      return {
        block: true,
        reason: `Turn time budget exceeded (${Math.round(maxMs / 1000)}s). Stopped — raise the cap in session config to continue.`,
      }
    }
    return inner(context, signal)
  }
}

export function makeBeforeToolCall(
  canUseTool: CanUseTool | undefined,
  mode: AgentMode,
  sessionId?: string,
  // Auto-approve (Settings → Sessions). When true, gated tools run WITHOUT a
  // permission prompt — the user opted into auto-approval for this session. Plan
  // mode still blocks writes/exec below (planning is read-only by design); auto-
  // approve only short-circuits the ask/accept-edits prompt path.
  autoApprove = false,
): BeforeToolCall {
  return async (context, signal) => {
    const toolName = context.toolCall.name
    const toolUseId = context.toolCall.id

    // Non-mutating tools: always allow.
    if (!isGatedTool(toolName, context.args)) return undefined

    // execute mode: no gate (the user opted into full access).
    if (mode === 'execute') return undefined

    // plan mode: block every write/exec — planning is read-only. Checked BEFORE
    // auto-approve so plan mode stays read-only even with auto-approve on.
    if (mode === 'plan') {
      return { block: true, reason: `Blocked in plan mode: ${toolName} is not allowed while planning.` }
    }

    // Auto-approve (Settings → Sessions): allow gated tools without prompting. Sits
    // after the plan-mode block (planning stays read-only) but before the ask path.
    if (autoApprove) return undefined

    // accept-edits: auto-allow file edits; other gated tools (Bash) still prompt.
    if (mode === 'accept-edits' && WRITE_TOOLS.has(toolName)) return undefined

    // Session "always allow": the user previously chose to allow this tool for
    // the whole session — skip the prompt for every later call of the same tool.
    if (sessionId && isSessionToolAllowed(sessionId, toolName)) return undefined

    // ask (and accept-edits for Bash): defer to the UI permission prompt.
    if (!canUseTool) {
      // No gate supplied but mode wants one — fail safe (block) rather than
      // silently allowing an unapproved mutation.
      log.warn('runtime beforeToolCall: no canUseTool in a gated mode; blocking', {
        toolName,
        mode,
      })
      return { block: true, reason: 'No permission handler available — blocked.' }
    }

    try {
      // canUseTool takes an options bag; we supply the fields it reads.
      // `signal` ties the prompt to the turn abort; toolUseID identifies the call.
      // A non-empty `suggestions` array is what makes the UI offer the
      // "Always allow" button; the rule body is opaque to AWOG (the session
      // allowlist below keys off toolName), so a single marker rule suffices.
      const input = (context.args ?? {}) as Record<string, unknown>
      const suggestions: PermissionUpdate[] = [
        { type: 'addRule', toolName, destination: 'session' },
      ]
      const result = await canUseTool(toolName, input, {
        signal: signal ?? new AbortController().signal,
        toolUseID: toolUseId,
        suggestions,
      })
      if (result.behavior === 'allow') {
        // "Always allow" round-trips the suggestions back as updatedPermissions
        // (sessions.permission.ts). Remember the tool so it stops prompting for
        // the rest of this session.
        if (sessionId && result.updatedPermissions && result.updatedPermissions.length > 0) {
          allowSessionTool(sessionId, toolName)
        }
        // Apply an approved input override by mutating the validated args object
        // in place — Pi executes the tool with `context.args`.
        if (result.updatedInput && context.args && typeof context.args === 'object') {
          const target = context.args as Record<string, unknown>
          for (const key of Object.keys(target)) delete target[key]
          Object.assign(target, result.updatedInput)
        }
        return undefined
      }
      // deny.
      return { block: true, reason: result.message || 'Denied by user.' }
    } catch (err) {
      // Never throw out of beforeToolCall. Treat any failure as a block.
      log.warn('runtime beforeToolCall error; blocking', {
        toolName,
        err: err instanceof Error ? err.message : String(err),
      })
      return { block: true, reason: 'Permission check failed — blocked.' }
    }
  }
}
