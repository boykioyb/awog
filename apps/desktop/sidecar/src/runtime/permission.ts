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
import type { AgentMode, SshApprovalMode } from '../types/shared.js'
import { allowSessionTool, isSessionToolAllowed } from '../sessions/permissions.js'
import { BROWSER_TOOL_NAME, isMutatingBrowserAction } from './tools/browser-tool.js'
import { SOURCE_MUTATING_TOOL_NAMES } from './tools/source-tools.js'
import { log } from '../util/logger.js'

// Tools that mutate the workspace or execute code. Everything else is read-only
// and runs without a permission prompt.
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const EXEC_TOOLS = new Set(['Bash'])
// Tools that spawn durable background work (ADR 0055): RunWorkflow kicks off a
// Task. Gated like a mutation so it prompts in ask/accept-edits and runs only in
// execute mode (in plan mode it isn't even registered).
const SPAWN_TOOLS = new Set(['RunWorkflow'])
// SSH tools that act on the LINKED remote host (ADR 0064 P2), all gated via the
// per-session sshApprovalMode (NOT the general AgentMode). MUTATING = command /
// file write (higher consequence — also blocked in plan mode). READ = remote read
// / list; the user chose to gate these too (they can exfil sensitive remote files
// to the model), but they stay available in plan mode for investigation. In 'auto'
// mode the whole set runs without a prompt.
const SSH_MUTATING_TOOLS = new Set(['ssh_exec', 'ssh_terminal_run', 'ssh_write_file'])
const SSH_READ_TOOLS = new Set(['ssh_read_file', 'ssh_list_dir'])
const SSH_GATED_TOOLS = new Set([...SSH_MUTATING_TOOLS, ...SSH_READ_TOOLS])

// Resolve the bare SSH tool name from a raw name (`ssh_exec`, Pi path) OR its Claude
// SDK bridged form (`mcp__<server>__ssh_exec`, ssh-sdk-server.ts), else null. The
// anthropic provider exposes the SSH tools as an MCP server, so the gate must match
// both forms — otherwise a bridged SSH tool would slip past this gate and run
// UNGATED. Matched by exact name or `__<tool>` suffix (mirrors isSourceMutatingTool).
function sshToolName(name: string): string | null {
  for (const n of SSH_GATED_TOOLS) if (name === n || name.endsWith(`__${n}`)) return n
  return null
}
// Source setup tools that persist config (ADR 0060 P6): source_create writes a
// source config. Gated like a mutation so it prompts for approval in ask/
// accept-edits mode (source_list/source_test/source_oauth_trigger are not). No
// source tool takes a raw secret as an arg — api credentials are entered in the
// UI (invariant 1), so nothing secret transits this gate's permission event.
//
// A source-mutating tool under EITHER naming: the bare Pi name (`source_create`)
// or the Claude SDK-bridged form (`mcp__awog__source_create`). Matched precisely —
// the name IS the mutating name, or it ENDS WITH `__<mutating name>` (the SDK
// `mcp__<server>__<tool>` convention) — so it never over-matches an unrelated tool.
function isSourceMutatingTool(name: string): boolean {
  return SOURCE_MUTATING_TOOL_NAMES.some((n) => name === n || name.endsWith(`__${n}`))
}

// browser_tool is one tool with mixed actions: navigate/click/fill mutate (gate);
// screenshot/extract are read-only (don't gate). Decided per-call from args.
function isGatedTool(name: string, args: unknown): boolean {
  if (name === BROWSER_TOOL_NAME) return isMutatingBrowserAction(args)
  return (
    WRITE_TOOLS.has(name) ||
    EXEC_TOOLS.has(name) ||
    SPAWN_TOOLS.has(name) ||
    SSH_GATED_TOOLS.has(name) ||
    isSourceMutatingTool(name)
  )
}

// Per-source runtime gate resolved from each active source's trust +
// permissions.json (ADR 0060 P4). All fields optional + no-op when empty, so a
// turn with no P4 config leaves the gate's behaviour byte-identical to before.
export interface SourceGateConfig {
  // trust:'prompt' source ids — their `mcp__<id>__*` tools route through the
  // EXISTING ask-gate/park instead of running silently.
  promptSourceIds?: string[]
  // Per-source auto-scoped allowedMcpPatterns (mcp__<id>__.*<pat>) keyed by source
  // id. A source tool NOT matching its source's patterns is HARD-BLOCKED. This is
  // the enforcement backstop for the Pi path (where such tools are also filtered
  // from exposure) and the SOLE enforcement on the Claude SDK path (the SDK owns
  // MCP listing, so exposure can't be filtered there).
  toolPatterns?: Record<string, RegExp[]>
}

// The source id segment of a bridged tool name `mcp__<id>__<tool>`, or null for a
// built-in / non-source tool. `<id>` never contains `__` (SOURCE_ID_RE) so the
// first `__` after the prefix ends it.
function sourceIdOfTool(name: string): string | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const sep = rest.indexOf('__')
  return sep > 0 ? rest.slice(0, sep) : null
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
  // Per-source P4 gate (trust:'prompt' + allowedMcpPatterns). Absent/empty → no
  // behaviour change (default sources gate exactly as before). ADR 0060.
  sourceGate?: SourceGateConfig,
  // Per-session SSH approval mode (ADR 0064 P2). Governs the gated SSH tools
  // (ssh_exec / ssh_write_file) INDEPENDENTLY of `mode`/`autoApprove`. Default
  // 'prompt' (ask every call). Inert unless an SSH tool is actually registered
  // (only run-stream's Pi path pushes them when the session links a host).
  sshApprovalMode: SshApprovalMode = 'prompt',
): BeforeToolCall {
  const promptSourceIds =
    sourceGate?.promptSourceIds && sourceGate.promptSourceIds.length > 0
      ? new Set(sourceGate.promptSourceIds)
      : null
  const toolPatterns = sourceGate?.toolPatterns
  // A source tool that violates its OWN source's allowedMcpPatterns (ADR 0060 P4).
  const violatesSourceScope = (name: string): boolean => {
    if (!toolPatterns) return false
    const id = sourceIdOfTool(name)
    if (!id) return false
    const pats = toolPatterns[id]
    if (!pats || pats.length === 0) return false
    return !pats.some((re) => re.test(name))
  }
  // A tool belonging to a trust:'prompt' source (ADR 0060 P4) → routes through the
  // ask-gate. False for built-in + non-prompt-source tools.
  const isPromptTrustTool = (name: string): boolean => {
    if (!promptSourceIds) return false
    const id = sourceIdOfTool(name)
    return id !== null && promptSourceIds.has(id)
  }
  return async (context, signal) => {
    const toolName = context.toolCall.name
    const toolUseId = context.toolCall.id

    // Defer to the UI permission prompt (park) and translate the answer. Shared by
    // the general gated path and the SSH-tool path. `forceRemember` = remember on
    // the FIRST approval regardless of an "always allow" click (SSH 'session' mode);
    // when false, only an explicit "always allow" (updatedPermissions) is remembered.
    // Never throws — any failure fails safe as a block.
    const promptViaUi = async (
      forceRemember: boolean,
      // SSH tools override these: `rememberKey` scopes the remembered allowance per
      // (session, host, tool) (F2); `offerAlwaysAllow=false` hides the "Always allow"
      // button, which no-ops for the SSH gate (it consults sshApprovalMode, not the
      // general allowlist — a dead button in 'prompt' mode, F6).
      opts?: { rememberKey?: string; offerAlwaysAllow?: boolean },
    ): Promise<BeforeToolCallResult | undefined> => {
      const rememberKey = opts?.rememberKey ?? toolName
      const offerAlwaysAllow = opts?.offerAlwaysAllow ?? true
      if (!canUseTool) {
        // No gate supplied but the mode wants one — fail safe (block) rather than
        // silently allowing an unapproved mutation.
        log.warn('runtime beforeToolCall: no canUseTool in a gated mode; blocking', {
          toolName,
          mode,
        })
        return { block: true, reason: 'No permission handler available — blocked.' }
      }
      try {
        // canUseTool takes an options bag; we supply the fields it reads. `signal`
        // ties the prompt to the turn abort; toolUseID identifies the call. A
        // non-empty `suggestions` array is what makes the UI offer the "Always
        // allow" button; the rule body is opaque (the session allowlist keys off
        // rememberKey), so a single marker rule suffices.
        const input = (context.args ?? {}) as Record<string, unknown>
        const suggestions: PermissionUpdate[] = offerAlwaysAllow
          ? [{ type: 'addRule', toolName, destination: 'session' }]
          : []
        const result = await canUseTool(toolName, input, {
          signal: signal ?? new AbortController().signal,
          toolUseID: toolUseId,
          suggestions,
        })
        if (result.behavior === 'allow') {
          // Remember the tool for the rest of the session when either the user
          // clicked "Always allow" (updatedPermissions round-trips the suggestions)
          // or the caller forced it (SSH 'session' mode remembers on first allow).
          const remember =
            forceRemember || (!!result.updatedPermissions && result.updatedPermissions.length > 0)
          if (sessionId && remember) allowSessionTool(sessionId, rememberKey)
          // Apply an approved input override by mutating the validated args object
          // in place — Pi executes the tool with `context.args`.
          if (result.updatedInput && context.args && typeof context.args === 'object') {
            const target = context.args as Record<string, unknown>
            for (const key of Object.keys(target)) delete target[key]
            Object.assign(target, result.updatedInput)
          }
          return undefined
        }
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

    // Per-source Explore scoping (ADR 0060 P4): a source tool outside its own
    // permissions.json allowedMcpPatterns is HARD-BLOCKED regardless of mode — the
    // source scoped ITSELF to a read-only subset. Checked first so the block holds
    // even in execute mode. No-op unless a source declared patterns.
    if (violatesSourceScope(toolName)) {
      return {
        block: true,
        reason: `Blocked by source permissions: ${toolName} is outside this source's allowed tool set (permissions.json allowedMcpPatterns).`,
      }
    }

    // SSH tools (ADR 0064 P2): act on the session's LINKED remote host. Gating is
    // MANDATORY and driven ONLY by the per-session sshApprovalMode — NOT the session
    // AgentMode / autoApprove — so it's checked BEFORE the general `execute`/
    // `autoApprove` short-circuits and neither can bypass it. Plan mode blocks the
    // MUTATING tools (a remote command / write is not read-only) but leaves the READ
    // tools to the approval flow (remote reads aid investigation, like local reads).
    const sshName = sshToolName(toolName)
    if (sshName) {
      if (mode === 'plan' && SSH_MUTATING_TOOLS.has(sshName)) {
        return {
          block: true,
          reason: `Blocked in plan mode: ${sshName} mutates the remote host and is not allowed while planning.`,
        }
      }
      if (sshApprovalMode === 'auto') return undefined
      // Scope the remembered allowance per (session, host, BARE tool name), reading
      // the host from THIS call's `host` arg (unified model — the tool targets any
      // host). So approving ssh_exec on host A never auto-approves it on host B, and
      // the Pi + SDK forms of the same tool share one allowance. ssh_terminal_run has
      // no host arg (drives the watched shell) → keyed by name alone.
      const hostArg = (context.args as { host?: string } | undefined)?.host
      const sshKey = hostArg ? `${sshName}@${hostArg}` : sshName
      if (sshApprovalMode === 'session' && sessionId && isSessionToolAllowed(sessionId, sshKey)) {
        return undefined
      }
      // 'prompt' (every call) or 'session' first-use → park. 'session' remembers on
      // approval (forceRemember); 'prompt' never does. No "Always allow" button: the
      // SSH gate keys off sshApprovalMode, not the general allowlist (F6).
      return promptViaUi(sshApprovalMode === 'session', {
        rememberKey: sshKey,
        offerAlwaysAllow: false,
      })
    }

    const builtInGated = isGatedTool(toolName, context.args)
    const promptTrust = isPromptTrustTool(toolName)

    // Non-mutating built-in tool AND not a trust:'prompt' source tool: always allow.
    if (!builtInGated && !promptTrust) return undefined

    // execute mode: no gate (the user opted into full access).
    if (mode === 'execute') return undefined

    // plan mode: block every write/exec — planning is read-only. Only the built-in
    // write/exec set is hard-blocked; a trust:'prompt' source tool (not a write)
    // still routes through the ask path below so a read can be approved. Checked
    // BEFORE auto-approve so plan mode stays read-only even with auto-approve on.
    if (mode === 'plan' && builtInGated) {
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
    return promptViaUi(false)
  }
}
