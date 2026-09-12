// Bridge AWOG's tool set onto Codex `dynamicTools` (ADR 0087 F1).
//
// `dynamicTools` is the 1:1 equivalent of the Claude SDK's createSdkMcpServer:
// the host declares tools at thread/start, the server calls back with
// `item/tool/call`, and the host answers. Tools run IN-PROCESS — no MCP server
// spawned outside the sidecar, so invariants #4 and #6 hold unchanged.
//
// WHICH tools we hand over is the design decision in here. Codex brings its own
// shell, file-edit and search tools, tuned for its loop and wired to its sandbox
// and approval flow — that harness is the reason for adopting Codex at all. So
// those four families are LEFT to Codex, and everything AWOG adds on top (wiki,
// memory, sources, surfaces, subagents, ssh, browser, MCP…) is bridged. Handing
// over a second Read and a second Bash would put two of each in front of the
// model, which is how a harness starts guessing which one it is supposed to use.
//
// The exclusion is a DENYLIST, not an allowlist: a tool added to AWOG next month
// should reach Codex without anyone remembering to update this file.

import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { CodexDynamicToolSpec, CodexToolContentItem } from './protocol.js'
import type { BeforeToolCall } from '../permission.js'
import { log } from '../../util/logger.js'

// Covered natively by the Codex harness. Names are AWOG's (= Claude Code's).
//
//   Read/Write/Edit/MultiEdit → Codex file changes (apply_patch), which is also
//                               what `item/fileChange/requestApproval` gates
//   Bash/BashOutput/KillShell → Codex exec, incl. its own background terminals
//   Grep/Glob                 → Codex search (the binary ships its own ripgrep)
//
// Everything else — notebooks, plan, checklist, web fetch, and every AWOG-only
// tool — is bridged, because Codex has no counterpart.
const NATIVE_TO_CODEX = new Set([
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Bash',
  'BashOutput',
  'KillShell',
  'Grep',
  'Glob',
])

export function isCodexNativeTool(name: string): boolean {
  return NATIVE_TO_CODEX.has(name)
}

// Tool names Codex accepts: the server validates them, and a rejected spec takes
// the whole thread/start with it. AWOG's own names are all [A-Za-z0-9_], and so
// are the `mcp__<id>__<tool>` ones — but a Source id comes from user input, so
// this is checked rather than assumed.
const NAME_RE = /^[A-Za-z0-9_-]{1,128}$/

// `mcp__` is RESERVED by the app-server for its own MCP tools, and the rejection
// is fatal: `thread/start` fails outright with "dynamic tool name is reserved:
// mcp__<server>__<tool>", which would have broken every session with a Source or
// MCP server attached — i.e. most of them. Measured against codex-cli 0.154.0;
// probing twenty other names (shell, apply_patch, exec_command, Task, browser…)
// found no other reserved word, so this is one narrow rule, not a namespace.
//
// Same class of trap as Anthropic reserving the `mcp_` prefix, and handled the
// same way: rename on the wire, restore before anything else in AWOG sees it.
// The gate, the step timeline and the per-source scope all key off the ORIGINAL
// name, so the round-trip has to close before dispatch and before rendering.
const MCP_PREFIX = 'mcp__'
const CODEX_MCP_PREFIX = 'awogmcp__'

export function toCodexToolName(name: string): string {
  return name.startsWith(MCP_PREFIX) ? `${CODEX_MCP_PREFIX}${name.slice(MCP_PREFIX.length)}` : name
}

export function fromCodexToolName(name: string): string {
  return name.startsWith(CODEX_MCP_PREFIX)
    ? `${MCP_PREFIX}${name.slice(CODEX_MCP_PREFIX.length)}`
    : name
}

export function toDynamicToolSpecs(tools: AgentTool[]): CodexDynamicToolSpec[] {
  const specs: CodexDynamicToolSpec[] = []
  for (const tool of tools) {
    if (isCodexNativeTool(tool.name)) continue
    const wireName = toCodexToolName(tool.name)
    if (!NAME_RE.test(wireName)) {
      log.warn('codex: skipping tool with a name the protocol will not take', { tool: tool.name })
      continue
    }
    specs.push({
      type: 'function',
      name: wireName,
      description: tool.description,
      // TypeBox schemas ARE JSON Schema at runtime, but they carry symbol keys
      // (Kind/Hint) that mean nothing to the server. A round-trip drops them and
      // guarantees what we send is what we can serialise.
      inputSchema: JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown>,
    })
  }
  return specs
}

// A stable identity for a tool SET. The set is bound to a thread at thread/start
// and cannot be changed on resume (there is no dynamicTools on
// ThreadResumeParams), so run-stream compares this against the value stored with
// the thread id and starts a fresh thread when they differ — otherwise attaching
// an MCP server mid-session would silently do nothing for the rest of it.
export function toolSetSignature(specs: CodexDynamicToolSpec[]): string {
  return specs
    .map((s) => s.name)
    .sort()
    .join(',')
}

// AWOG tool results are (text | image) blocks; Codex wants inputText/inputImage.
//
// MEASURED TRAP (ADR 0087 F1): the variant is `inputText`, not `text`. Send the
// wrong one and the server does not fail the call — it replaces the result with
// the string "dynamic tool response was invalid" and lets the model carry on
// with that as the tool's output. The spike lost a turn to exactly this, with no
// exception raised anywhere.
function toContentItems(content: { type: string; text?: string; data?: string; mimeType?: string }[]): CodexToolContentItem[] {
  const items: CodexToolContentItem[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      items.push({ type: 'inputText', text: block.text })
    } else if (block.type === 'image' && block.data) {
      items.push({
        type: 'inputImage',
        imageUrl: `data:${block.mimeType ?? 'image/png'};base64,${block.data}`,
      })
    }
  }
  // A tool that returned nothing renderable still has to say something: an empty
  // contentItems array reads to the model as a tool that did not run.
  if (items.length === 0) items.push({ type: 'inputText', text: '(no output)' })
  return items
}

export interface CodexToolDispatch {
  /** Handles one `item/tool/call` server request. Never throws. */
  call: (params: {
    callId: string
    tool: string
    arguments: unknown
  }) => Promise<{ contentItems: CodexToolContentItem[]; success: boolean }>
}

/**
 * Execute bridged tools, through AWOG's permission gate.
 *
 * The gate is the SAME `BeforeToolCall` the Pi runtime uses (runtime/permission.ts),
 * so deny rules, plan mode, auto-approve, the per-source scope and the turn budget
 * all apply here without a second implementation. A blocked call comes back as a
 * failed tool result, which is what both runtimes already do — the model reads the
 * reason and moves on rather than the turn dying.
 */
export function createToolDispatch(args: {
  tools: AgentTool[]
  gate: BeforeToolCall
  signal: AbortSignal
}): CodexToolDispatch {
  const byName = new Map(args.tools.map((t) => [t.name, t]))
  return {
    call: async ({ callId, tool, arguments: rawArgs }) => {
      const fail = (text: string) => ({
        contentItems: [{ type: 'inputText' as const, text }],
        success: false,
      })
      // The server calls back with the WIRE name; every rule, label and scope in
      // AWOG is written against the original one.
      const awogName = fromCodexToolName(tool)
      const def = byName.get(awogName)
      if (!def) {
        // The thread carries the tool set it was started with (server-side
        // table), so a resumed thread can ask for a tool this turn no longer
        // builds. Say so plainly instead of pretending it ran.
        return fail(`Tool ${awogName} is not available in this session.`)
      }
      // The gate can rewrite arguments in place (an approved override), and the
      // tool has to execute with the rewritten object — same contract as Pi,
      // where the loop passes `context.args` straight through.
      const params = (rawArgs ?? {}) as Record<string, unknown>
      try {
        const verdict = await args.gate(
          { toolCall: { name: awogName, id: callId }, args: params },
          args.signal,
        )
        if (verdict?.block) return fail(verdict.reason ?? `${awogName} was blocked.`)
      } catch (err) {
        return fail(`Permission check failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      try {
        const result = await def.execute(callId, params as never, args.signal)
        return { contentItems: toContentItems(result.content), success: true }
      } catch (err) {
        // AWOG tools throw on failure (their contract), and the model is meant to
        // see the message: success:false puts it in front of the model as an
        // error result rather than as the answer.
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  }
}
