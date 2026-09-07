// Bridge AWOG's permission gate (canUseTool → parkPermissionRequest → UI) onto
// Pi's `beforeToolCall` hook (ADR 0029 item 3).
//
// The SAME canUseTool assembled in sessions.send-message.ts flows through
// RunNonStreamArgs and is invoked here, so the UI permission RPC + parking
// machinery is reused unchanged. We translate the result:
//   behavior 'allow' → return undefined (let the tool run); if updatedInput is
//     present, validate it, re-check it against DENY rules, then mutate the
//     validated args in place (Pi executes with `args`). See F13 below.
//   behavior 'deny'  → return { block: true, reason: message } so the loop emits
//     an error tool result instead of executing.
//
// Mode handling:
//   execute      → no gate at all (canUseTool is not even wired in this mode).
//   accept-edits → auto-allow Write/Edit; everything else still gated.
//   plan         → block all writes/exec (Write/Edit/Bash); reads allowed.
//   ask          → gate all writes/exec via canUseTool.
//
// Read-family tools (Read/Grep/Glob) never PROMPT — they are non-mutating — but a
// DENY rule still applies to them (see below).
//
// Remembered allowances (ADR 0080): "Always allow" no longer keys off the tool
// NAME. Every gated call is matched against permission RULES scoped to the call's
// content — `Bash(git status)`, `Write(/repo/src/**)` — evaluated session →
// project → user, with DENY beating ALLOW everywhere. Approving `git status` once
// therefore no longer unlocks `rm -rf /` for the rest of the session.
//
// "Everywhere" is literal since the 2026-09-07 security fix (F3): the rule lookup
// runs for EVERY tool call, ahead of every early return in this hook — read-family
// tools, `WebFetch`, `Task`, SSH tools and `mcp__*` tools included. Only the DENY
// half is consumed that early; ALLOW keeps its old position (it only ever skips a
// prompt, and no non-gated tool prompts anyway).
//
// An ALLOW rule also never covers a DETACHED call — `Bash(run_in_background: true)`
// leaves a process running past the turn, so it is asked every time even when the
// same command string is approved for the foreground (F12). DENY still covers it.
//
// Contract: beforeToolCall must NOT throw. Any error → fail safe = block, so a
// bug can never silently let an unapproved write through.

import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@earendil-works/pi-agent-core'
import type {
  CanUseTool,
  PermissionRuleSuggestion,
  PermissionUpdate,
} from './permission-types.js'
import type { AgentMode, SshApprovalMode } from '../types/shared.js'
import { allowSessionTool, isSessionToolAllowed } from '../sessions/permissions.js'
import {
  evaluatePermissionRules,
  parsePermissionRule,
  suggestRuleText,
} from '../sessions/permission-rules.js'
import { isBrowserToolName, isMutatingBrowserAction } from './tools/browser-tool.js'
import { SOURCE_MUTATING_TOOL_NAMES } from './tools/source-tools.js'
import { WIKI_MUTATING_TOOL_NAMES } from './tools/wiki-tools.js'
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

// Wiki mutations (ADR 0073): the agent editing the user's own documentation. Gated
// like a file write — it prompts in ask/accept-edits, is hard-blocked in plan mode,
// and runs freely only in execute mode. Settings decides whether these tools exist
// at all; this decides each call. Matched under BOTH namings (bare Pi name and the
// SDK's `mcp__awogwiki__wiki_write`), or a bridged call would slip past UNGATED.
function isWikiMutatingTool(name: string): boolean {
  return WIKI_MUTATING_TOOL_NAMES.some((n) => name === n || name.endsWith(`__${n}`))
}

// browser_tool is one tool with mixed actions: navigate/click/fill mutate (gate);
// screenshot/extract are read-only (don't gate). Decided per-call from args.
function isGatedTool(name: string, args: unknown): boolean {
  // Khớp CẢ HAI cách gọi tên: tên trần của nhánh Pi và tên bắc cầu của nhánh
  // Claude SDK (`mcp__awogbrowser__browser_tool`). Chỉ so tên trần thì lời gọi bắc
  // cầu lọt qua cổng — kể cả trong plan mode, nơi đã hứa là read-only.
  if (isBrowserToolName(name)) return isMutatingBrowserAction(args)
  return (
    WRITE_TOOLS.has(name) ||
    EXEC_TOOLS.has(name) ||
    SPAWN_TOOLS.has(name) ||
    SSH_GATED_TOOLS.has(name) ||
    isSourceMutatingTool(name) ||
    isWikiMutatingTool(name)
  )
}

// The "Always allow" suggestion for this call (ADR 0080), or null when the call
// cannot be turned into a rule that is safe to remember — a compound shell command
// (`git status; rm -rf /`), a Bash call with no `command` string, a relative or
// traversing file path, or a subject that itself contains `*`. Returning null
// hides the button, so the ONLY way past those calls is an explicit per-call yes.
function buildRuleSuggestion(
  toolName: string,
  args: unknown,
  sessionId: string | undefined,
): PermissionRuleSuggestion | null {
  const rule = suggestRuleText(toolName, args)
  if (!rule) return null
  const parsed = parsePermissionRule(rule)
  if (!parsed) return null
  return {
    type: 'addRule',
    toolName,
    destination: 'session',
    rule: parsed.text,
    ruleKind: parsed.kind,
    action: 'allow',
    ...(sessionId ? { sessionId } : {}),
  }
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

// ─── Approved argument override (`updatedInput`) ────────────────────────────
// Answering a prompt may carry `updatedInput`: the user edited the tool's args
// before approving. That is the user's own call to make, but it is L1 data from
// the UI payload and it lands in a mutation sink, so it gets two guards (F13):
//
//  1. Shape. `__proto__` / `constructor` / `prototype` are refused outright —
//     `target['__proto__'] = v` walks the prototype setter instead of defining a
//     key, i.e. prototype pollution rather than an arg override. A key cap keeps
//     an absurd payload out of the sink.
//  2. Rules. The decision above was made against the ORIGINAL args, so the
//     overridden args are re-checked against DENY rules before they are applied
//     (see promptViaUi) — otherwise approving `ls` and overriding the command
//     would walk straight past a `Bash(rm -rf /)` deny rule.
const UNSAFE_TOOL_ARG_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_TOOL_ARG_KEYS = 64

// Validated at the RPC boundary (methods/sessions.permission.ts) AND at this
// sink, on purpose: the RPC rejects a hostile payload loudly, the sink can never
// be reached by one even if another caller appears.
export function isSafeToolInputOverride(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  // `Object.keys` sees an own `__proto__` produced by JSON.parse, which is
  // exactly the shape this rejects.
  const keys = Object.keys(value)
  if (keys.length > MAX_TOOL_ARG_KEYS) return false
  return !keys.some((key) => UNSAFE_TOOL_ARG_KEYS.has(key))
}

// The tool name a DENY rule matched for these args, or null when nothing denies
// them. Checks the bridged SSH alias too (`mcp__<server>__ssh_exec` → `ssh_exec`),
// mirroring the main gate so one rule holds on both runtimes.
async function deniedToolName(
  toolName: string,
  args: unknown,
  sessionId: string | undefined,
): Promise<string | null> {
  const scoped = sessionId ? { sessionId } : {}
  if ((await evaluatePermissionRules({ toolName, args, ...scoped })) === 'deny') return toolName
  const bare = sshToolName(toolName)
  if (bare && bare !== toolName) {
    if ((await evaluatePermissionRules({ toolName: bare, args, ...scoped })) === 'deny') return bare
  }
  return null
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

    // A DENY rule is a hard guardrail the user wrote down on purpose, so it beats
    // EVERY relaxation below — execute mode, auto-approve, accept-edits, the SSH
    // gate's own 'auto' mode, and an approved argument override alike.
    const denyBlock = (name: string): BeforeToolCallResult => ({
      block: true,
      reason: `Blocked by a permission rule you configured for ${name}. Remove that rule from your permission rules under ~/.awog to change this.`,
    })

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
        // allow" button — and the suggestion now spells out the EXACT rule that
        // will be created (ADR 0080). No rule can be derived (compound shell
        // command, missing/relative path…) ⇒ empty array ⇒ no "Always allow"
        // button: this call has to be answered on its own merits.
        const input = (context.args ?? {}) as Record<string, unknown>
        const suggestion = offerAlwaysAllow
          ? buildRuleSuggestion(toolName, context.args, sessionId)
          : null
        const suggestions: PermissionUpdate[] = suggestion ? [suggestion] : []
        const result = await canUseTool(toolName, input, {
          signal: signal ?? new AbortController().signal,
          toolUseID: toolUseId,
          suggestions,
        })
        if (result.behavior === 'allow') {
          // "Always allow" for a GENERAL tool is persisted by sessions.permission
          // itself (it owns the destination tier), so nothing is remembered here.
          // This branch only serves the SSH gate, whose 'session' mode remembers
          // the first approval under its own opaque (session, host, tool) key.
          if (sessionId && forceRemember) allowSessionTool(sessionId, rememberKey)
          // Apply an approved input override by mutating the validated args object
          // in place — Pi executes the tool with `context.args`.
          const hasOverride = result.updatedInput !== undefined
          if (hasOverride && context.args && typeof context.args === 'object') {
            // The rules above were evaluated against the ORIGINAL args. The user
            // may rewrite them, but a DENY rule must survive that rewrite — else
            // approving `ls` and overriding the command past a `Bash(rm -rf /)`
            // deny rule is a one-click bypass of the user's own guardrail (F13).
            if (!isSafeToolInputOverride(result.updatedInput)) {
              log.warn('runtime beforeToolCall: rejected an unsafe input override; blocking', {
                toolName,
              })
              return { block: true, reason: 'Rejected an unsafe argument override — blocked.' }
            }
            const denied = await deniedToolName(toolName, result.updatedInput, sessionId)
            if (denied) return denyBlock(denied)
            const target = context.args as Record<string, unknown>
            for (const key of Object.keys(target)) delete target[key]
            for (const [key, value] of Object.entries(result.updatedInput)) {
              target[key] = value
            }
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

    // Persisted permission rules (ADR 0080), evaluated session → project → user.
    // Never throws (any failure degrades to 'ask').
    //
    // Evaluated HERE — before every early return below — because a DENY rule must
    // apply to EVERY tool, exactly as the ADR promises. Previously this ran after
    // the `!builtInGated && !promptTrust` short-circuit, so `Read`, `Grep`, `Glob`,
    // `WebFetch`, `Task` and every `mcp__*` tool never reached it: a rule like
    // `{"rule":"WebFetch","action":"deny"}` parsed fine and did nothing (F3).
    const ruleDecision = await evaluatePermissionRules({
      toolName,
      args: context.args,
      ...(sessionId ? { sessionId } : {}),
    })

    if (ruleDecision === 'deny') return denyBlock(toolName)

    // SSH tools (ADR 0064 P2): act on the session's LINKED remote host. Gating is
    // MANDATORY and driven ONLY by the per-session sshApprovalMode — NOT the session
    // AgentMode / autoApprove — so it's checked BEFORE the general `execute`/
    // `autoApprove` short-circuits and neither can bypass it. Plan mode blocks the
    // MUTATING tools (a remote command / write is not read-only) but leaves the READ
    // tools to the approval flow (remote reads aid investigation, like local reads).
    const sshName = sshToolName(toolName)
    if (sshName) {
      // A rule is written against the BARE tool name (`ssh_exec`); the anthropic
      // path calls the same tool bridged as `mcp__<server>__ssh_exec`. Evaluate the
      // bare alias too, before sshApprovalMode is consulted — otherwise the same
      // DENY rule would hold on one runtime and be ignored on the other (F3).
      if (sshName !== toolName) {
        const aliasDecision = await evaluatePermissionRules({
          toolName: sshName,
          args: context.args,
          ...(sessionId ? { sessionId } : {}),
        })
        if (aliasDecision === 'deny') return denyBlock(sshName)
      }
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

    // Non-mutating built-in tool AND not a trust:'prompt' source tool: always allow
    // (a DENY rule for it was already applied above).
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

    // An ALLOW rule matched this call's CONTENT (this exact command / this file),
    // not merely its tool name — skip the prompt.
    if (ruleDecision === 'allow') return undefined

    // Auto-approve (Settings → Sessions): allow gated tools without prompting. Sits
    // after the plan-mode block (planning stays read-only) but before the ask path.
    if (autoApprove) return undefined

    // accept-edits: auto-allow file edits; other gated tools (Bash) still prompt.
    if (mode === 'accept-edits' && WRITE_TOOLS.has(toolName)) return undefined

    // ask (and accept-edits for Bash): defer to the UI permission prompt.
    return promptViaUi(false)
  }
}
