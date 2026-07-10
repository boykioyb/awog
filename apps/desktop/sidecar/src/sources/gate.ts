// Source-scoped runtime resolution (ADR 0060 P4). Turns an enabled source's
// `trust` + optional `permissions.json` into the small in-process shapes the
// runtime tool filter + permission gate consume, plus surfaces `local` sources to
// the agent.
//
// STRICTLY ADDITIVE + SOURCE-SCOPED. Nothing here widens access or touches
// non-source tools:
//   - trust 'deny'   → the resolver drops the source (its tools never exist).
//   - trust 'prompt' → its tools route through AWOG's EXISTING ask-gate/park.
//   - allowedMcpPatterns → RESTRICTS the source to its own matching tools.
//   - allowedApiEndpoints → RESTRICTS the source's non-GET api calls.
// A source with no permissions.json + default trust behaves EXACTLY as before.
//
// Auto-scoping mirrors Craft's applySourceConfig but keys on the source ID (not
// the slug): AWOG names mcp + api tools `mcp__<id>__*` (ADR 0060 P3), so a
// permissions.json pattern "list" compiles to /mcp__<id>__.*list/ — a source can
// only ever whitelist ITS OWN tools.

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { readPermissions } from './store.js'
import { log } from '../util/logger.js'
import type { CompiledApiEndpoint } from '../runtime/permission-types.js'
import type { LocalSource, SourceConfig, SourceTrust } from '../types/shared.js'

// The resolved P4 gate for ONE source.
export interface SourceGate {
  trust: SourceTrust
  // Compiled, auto-scoped allowedMcpPatterns. Non-empty → ONLY this source's tools
  // (mcp__<id>__*) whose full name matches one of these survive (a restriction).
  mcpToolPatterns: RegExp[]
  // Compiled allowedApiEndpoints (method + path regex). Non-empty → non-GET calls
  // of this source's api tool must match a rule (GET always allowed).
  apiEndpoints: CompiledApiEndpoint[]
}

function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

// Read + compile a source's permissions.json + trust. Auto-scopes mcp patterns to
// the source id. Never throws — a missing/invalid file yields an empty gate (=
// current behaviour). Default trust passes through unchanged.
export async function resolveSourceGate(source: SourceConfig): Promise<SourceGate> {
  const gate: SourceGate = { trust: source.trust, mcpToolPatterns: [], apiEndpoints: [] }
  let perms
  try {
    perms = await readPermissions(source.slug)
  } catch (err) {
    log.warn('sources: failed to read permissions.json', {
      slug: source.slug,
      err: err instanceof Error ? err.message : String(err),
    })
    return gate
  }
  if (!perms) return gate

  for (const pattern of perms.allowedMcpPatterns ?? []) {
    // Auto-scope to THIS source's tools: mcp__<id>__.*<pattern> (id, not slug —
    // AWOG names mcp + api tools mcp__<id>__*).
    const re = compileRegex(`mcp__${source.id}__.*${pattern}`)
    if (re) gate.mcpToolPatterns.push(re)
    else log.warn('sources: invalid allowedMcpPatterns entry, skipping', { slug: source.slug, pattern })
  }

  for (const rule of perms.allowedApiEndpoints ?? []) {
    const re = compileRegex(rule.path)
    if (re) gate.apiEndpoints.push({ method: rule.method.toUpperCase(), path: re })
    else log.warn('sources: invalid allowedApiEndpoints path, skipping', { slug: source.slug, path: rule.path })
  }

  return gate
}

// Accumulator both runtime resolvers (sessions.send-message + tasks/agent-context)
// fill while iterating the enabled source list, keyed by source id.
export interface SourceGateAccumulator {
  // trust:'prompt' source ids — their tools route through the ask-gate.
  promptSourceIds: string[]
  // Per-source auto-scoped allowedMcpPatterns.
  toolPatterns: Record<string, RegExp[]>
  // Per-source compiled allowedApiEndpoints.
  apiEndpoints: Record<string, CompiledApiEndpoint[]>
}

export function emptyGateAccumulator(): SourceGateAccumulator {
  return { promptSourceIds: [], toolPatterns: {}, apiEndpoints: {} }
}

// Fold ONE surviving source's gate into the accumulator (call only after the deny
// check dropped denied sources). No-op fields stay empty so a turn with no P4
// config produces an all-empty accumulator (byte-identical to before).
export function accumulateSourceGate(
  acc: SourceGateAccumulator,
  sourceId: string,
  gate: SourceGate,
): void {
  if (gate.trust === 'prompt') acc.promptSourceIds.push(sourceId)
  if (gate.mcpToolPatterns.length > 0) acc.toolPatterns[sourceId] = gate.mcpToolPatterns
  if (gate.apiEndpoints.length > 0) acc.apiEndpoints[sourceId] = gate.apiEndpoints
}

// The optional tool-filter fields (ADR 0060 P4). Spread into ToolFilter by the
// runtime callers; omitted keys keep the filter identical to a pre-P4 turn.
export function gateToolFilterFields(acc: SourceGateAccumulator): {
  sourceToolPatterns?: Record<string, RegExp[]>
  sourceApiEndpoints?: Record<string, CompiledApiEndpoint[]>
} {
  return {
    ...(Object.keys(acc.toolPatterns).length > 0 ? { sourceToolPatterns: acc.toolPatterns } : {}),
    ...(Object.keys(acc.apiEndpoints).length > 0 ? { sourceApiEndpoints: acc.apiEndpoints } : {}),
  }
}

// ─── local source surfacing ───────────────────────────────────────────────────

// Expand `~`/`~/…` and resolve to an absolute path. Returns null when the input
// tried to traverse up with a literal `..` segment (sanitize per invariant #2 —
// mirrors resolveCwd in the old mcp manager). Does NOT confine to homedir: a local
// source is the user's own choice of folder, and the fs tools apply their own
// cwd gate at call time (see buildLocalSourcesNote).
export function resolveLocalPath(input: string): string | null {
  if (input.split(/[\\/]+/).includes('..')) return null
  const expanded =
    input === '~'
      ? homedir()
      : input.startsWith('~/')
        ? resolve(homedir(), input.slice(2))
        : input
  return resolve(expanded)
}

// A system-prompt note listing enabled `local` (filesystem) sources so the agent
// knows the folders it may explore.
//
// P4 FLAG — this note is INFORMATIONAL. HARD fs-root enforcement (registering
// local.path as an additional allowed root for the structured Read/Write/Edit/
// Grep/Glob tools) is DEFERRED: those tools gate every path to a SINGLE session
// cwd via assertInsideWorkspace (the global fs gate), and reworking it to accept
// extra roots is out of scope for P4 (it would change the invariant-#2 gate that
// governs every tool call). Practical reach today: a local.path INSIDE the session
// cwd is reachable by every tool; a path OUTSIDE it is reachable via Bash
// (cwd-scoped shell, absolute paths) but denied by the structured fs tools.
export function buildLocalSourcesNote(sources: LocalSource[]): string | undefined {
  const rows: string[] = []
  for (const s of sources) {
    const abs = resolveLocalPath(s.local.path)
    if (!abs) {
      log.warn('sources: local source path rejected (traversal), skipping note', { slug: s.slug })
      continue
    }
    const note = s.tagline || s.description
    rows.push(`- ${s.name}: ${abs}${note ? ` — ${note}` : ''}`)
  }
  if (rows.length === 0) return undefined
  return `<local-sources>
These local filesystem folders are attached to this session. Use the Read/Grep/Glob/Bash tools to explore them (a folder outside the current working directory may only be reachable via Bash with absolute paths):
${rows.join('\n')}
</local-sources>`
}
