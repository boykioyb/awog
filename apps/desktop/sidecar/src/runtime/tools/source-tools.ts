// Agent-callable `source_*` session tools (ADR 0060 D-6/D-7, P6). Let the model
// set up external Sources conversationally — the Craft flow — from inside a chat
// session: list what exists, create/update a config, test the connection, or kick
// off an OAuth sign-in. Mirrors Craft's session-tools-core handlers (source-test /
// source-oauth / credential-prompt), adapted to AWOG's runtime + keychain infra.
//
// TWO runtimes call the SAME four cores here (runSourceList / runSourceCreate /
// runSourceTest / runSourceOAuthTrigger): the Pi runtime wraps them in AgentTools
// (this file), the Claude Agent SDK runtime wraps the identical cores in
// createSdkMcpServer + tool (runtime/claude-sdk/source-sdk-server.ts). The handler
// LOGIC (draft-build + schema validate + saveSource, test-result formatting, the
// non-blocking OAuth kick-off) lives ONCE in the cores; each runtime only adapts
// the result shape + declares its own input schema (TypeBox here, zod there).
//
// Every core is a THIN wrapper over the existing sources/* modules + the same
// logic the source.* RPCs use — no reimplementation. Wired in for SESSIONS only
// (Pi: ToolFilter.includeSourceTools; SDK: run-stream only, not invoke), never for
// unattended tasks — mirroring the RunWorkflow tool's session scope.
//
// Gating (runtime/permission.ts): source_create is MUTATING and routes through the
// permission gate (SOURCE_MUTATING_TOOL_NAMES) — under BOTH the bare Pi name
// `source_create` and the SDK-bridged `mcp__awog__source_create`. source_list /
// source_test / source_oauth_trigger are non-destructive actions.
//
// Invariant 1: no tool ARG, RESULT, or log line here carries a raw secret. There
// is deliberately NO tool that takes a raw api key/token as an argument — a tool
// arg transits the permission-request event + the persisted tool step (both
// UI-bound), which invariant 1 forbids for secrets. api credentials are entered
// by the USER in the Connections UI (UI→sidecar only); source_oauth_trigger runs
// a browser flow (no secret in-band); source_create must use "secret:KEY" refs.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { randomBytes } from 'node:crypto'
import { emit } from '../../transport/stdio.js'
import { log } from '../../util/logger.js'
import { listSources, loadSource, saveSource } from '../../sources/store.js'
import { SourceConfigSchema } from '../../sources/schema.js'
import { testAndPersistSource } from '../../sources/test.js'
import { getFreshToken } from '../../sources/oauth-manager.js'
import { resolveOAuthTarget, startSourceOAuth } from '../../sources/oauth-start.js'

// The mutating source tools — added to the permission gate (runtime/permission.ts)
// so they prompt for approval in ask/accept-edits mode (like Write/RunWorkflow).
// The gate matches BOTH the bare name (Pi) and the `mcp__awog__source_create`
// SDK-bridged form (isSourceMutatingTool there keys off the `__<name>` suffix).
export const SOURCE_MUTATING_TOOL_NAMES = ['source_create'] as const

const RESULT_MAX_CHARS = 16 * 1024

// ─── Tool descriptions (shared by both runtimes so they never drift) ───────────

export const SOURCE_LIST_DESCRIPTION =
  'List the configured external Sources (mcp / api / local) with their id, slug, name, type, provider, enabled flag, and last connection status. Returns no secrets. Use it to see what is already set up before creating a new source.'

export const SOURCE_CREATE_DESCRIPTION =
  'Create or update an external Source by writing its config. Validates the config against the schema, fills sensible defaults (id/enabled/timeoutMs/trust/timestamps), and persists it to ~/.awog/sources/<slug>/config.json. If a source with the slug already exists it is updated (its id + createdAt are preserved). Run source_test next to validate the connection.'

export const SOURCE_CREATE_CONFIG_DESCRIPTION =
  'The full SourceConfig object. Must include: slug (lowercase-alphanumeric-with-hyphens), name, type ("mcp" | "api" | "local"), provider, and the matching type block — "mcp" ({ transport, url|command, authType, ... }), "api" ({ baseUrl, authType, testEndpoint, ... }), or "local" ({ path }). id, enabled, timeoutMs (30000), trust ("prompt"), createdAt/updatedAt are filled with defaults when omitted. Do NOT set autoStart (it does not exist). For secrets in an mcp env/header, use a "secret:KEY" reference — never paste a raw token here.'

export const SOURCE_TEST_DESCRIPTION =
  'Test a source connection (mcp handshake / api testEndpoint / local path) and persist the outcome (connectionStatus / isAuthenticated / lastTestedAt); auto-enables a clean run so its tools become available. Reports the status, tool count, and any error. Call it after source_create and after authenticating.'

export const SOURCE_TEST_SLUG_DESCRIPTION = 'The slug of the source to test.'

export const SOURCE_OAUTH_DESCRIPTION =
  'Start an OAuth sign-in for an OAuth source (mcp OR generic api). Opens a browser authorization flow in the BACKGROUND and returns immediately — it does not wait for the sign-in to finish. If the source already has a valid token it says so. After the user completes sign-in in the browser, re-run source_test to confirm.'

export const SOURCE_OAUTH_SLUG_DESCRIPTION =
  'The slug of the OAuth source to authenticate — an mcp source with mcp.authType "oauth", or an api source with api.authType "oauth".'

// ─── Shared result shape + cores (runtime-agnostic) ────────────────────────────

// The runtime-agnostic result of a source tool: the (already char-capped) text to
// hand the model + whether it is an error. NEVER carries a secret (invariant 1).
export interface SourceToolResult {
  text: string
  isError: boolean
}

function clip(text: string): string {
  return text.length <= RESULT_MAX_CHARS ? text : `${text.slice(0, RESULT_MAX_CHARS)}\n…(truncated)`
}

// Build a char-capped SourceToolResult. Both runtimes wrap this without re-clipping
// so their model-facing text is byte-identical.
function result(text: string, isError = false): SourceToolResult {
  return { text: clip(text), isError }
}

// source_list: summarise configured sources (no secrets). Thin — the Pi tool and
// the SDK handler both call this.
export async function runSourceList(): Promise<SourceToolResult> {
  const sources = await listSources()
  if (sources.length === 0) {
    return result('No sources configured yet. Use source_create to add one.')
  }
  const summary = sources.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    type: s.type,
    provider: s.provider,
    enabled: s.enabled,
    connectionStatus: s.connectionStatus ?? 'untested',
  }))
  return result(JSON.stringify(summary, null, 2))
}

// source_create core: build the draft (defaults + id/createdAt preservation),
// validate against SourceConfigSchema, and persist via saveSource (which
// keychainizes any secret-looking mcp env/header, leaving only a "secret:KEY" ref
// on disk). `rawConfig` is L1 (model-supplied) — a raw token here would leak via
// the persisted step, which is exactly why the schema guidance mandates
// "secret:KEY" refs (invariant 1); nothing secret is returned or logged.
export async function runSourceCreate(rawConfig: Record<string, unknown>): Promise<SourceToolResult> {
  const raw = rawConfig
  const slug = typeof raw.slug === 'string' ? raw.slug : undefined
  if (!slug) {
    return result('source_create requires config.slug (lowercase alphanumeric with hyphens).', true)
  }

  const existing = await loadSource(slug)
  const now = Date.now()
  const draft: Record<string, unknown> = {
    trust: 'prompt',
    enabled: false,
    timeoutMs: 30_000,
    ...raw,
    id:
      (typeof raw.id === 'string' && raw.id) ||
      existing?.id ||
      `${slug}_${randomBytes(4).toString('hex')}`,
    createdAt: existing?.createdAt ?? (typeof raw.createdAt === 'number' ? raw.createdAt : now),
    updatedAt: now,
  }

  const parsed = SourceConfigSchema.safeParse(draft)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    return result(`Invalid source config:\n${issues}`, true)
  }

  try {
    await saveSource(parsed.data)
  } catch (err) {
    return result(`Failed to save source: ${err instanceof Error ? err.message : String(err)}`, true)
  }

  const verb = existing ? 'Updated' : 'Created'
  return result(
    `${verb} source "${parsed.data.name}" (slug: ${parsed.data.slug}, id: ${parsed.data.id}, type: ${parsed.data.type}). Run source_test({ slug: "${parsed.data.slug}" }) next to validate the connection.`,
  )
}

// source_test core: run the connection test, persist the outcome, and format a
// concise report. needs_auth is a soft, actionable state (not a tool error); a
// hard failure (unreachable / bad config) is.
export async function runSourceTest(slug: string): Promise<SourceToolResult> {
  const { source, outcome } = await testAndPersistSource(slug)
  if (!source && !outcome.supported && outcome.error?.startsWith('source not found')) {
    return result(`Source '${slug}' not found.`, true)
  }

  const lines: string[] = [`Status: ${outcome.status}`]
  if (outcome.isAuthenticated !== undefined) {
    lines.push(`Authenticated: ${outcome.isAuthenticated}`)
  }
  if (outcome.tools && outcome.tools.length > 0) {
    const names = outcome.tools
      .slice(0, 20)
      .map((t) => t.name)
      .join(', ')
    lines.push(`Tools (${outcome.tools.length}): ${names}${outcome.tools.length > 20 ? ', …' : ''}`)
  }
  if (outcome.resources && outcome.resources.length > 0) {
    lines.push(`Resources: ${outcome.resources.length}`)
  }
  if (outcome.stderr && outcome.stderr.length > 0) {
    lines.push(`stderr: ${outcome.stderr.slice(0, 5).join(' | ')}`)
  }
  if (outcome.error) lines.push(`Note: ${outcome.error}`)
  if (outcome.status === 'needs_auth') {
    lines.push(
      'Next: authenticate — source_oauth_trigger for OAuth; for an api key/token, ask the user to enter it in the Connections UI — then re-run source_test.',
    )
  }
  return result(lines.join('\n'), outcome.status === 'failed')
}

// source_oauth_trigger core: kick off a browser OAuth flow in the BACKGROUND and
// return immediately (non-blocking) — the flow emits source.oauth-url for the UI,
// persists the token to the keychain on success, and flips the source status.
// Errors are logged, never surfaced as a token (invariant 1).
export async function runSourceOAuthTrigger(slug: string): Promise<SourceToolResult> {
  const source = await loadSource(slug)
  if (!source) return result(`Source '${slug}' not found.`, true)
  if (source.type === 'local') {
    return result(
      `Source '${slug}' is a local source — OAuth applies only to mcp/api sources.`,
      true,
    )
  }
  const resolved = resolveOAuthTarget(source)
  if (!resolved.ok) return result(resolved.error, true)

  const existing = await getFreshToken(source)
  if (existing) {
    return result(
      `"${source.name}" is already authenticated — use its tools directly (no sign-in needed).`,
    )
  }

  // Background flow: don't block the turn on the (up to 5-minute) loopback callback.
  void startSourceOAuth(slug, (url) => emit('source.oauth-url', { slug, url })).catch((err) => {
    log.warn('source_oauth_trigger: background OAuth flow failed', {
      slug,
      err: err instanceof Error ? err.message : String(err),
    })
  })

  return result(
    `Authorization started for "${source.name}". A browser window will open for sign-in. Once the user confirms they have signed in, re-run source_test({ slug: "${source.slug}" }) to confirm the connection. Do not assume success before then.`,
  )
}

// ─── Pi AgentTool wrappers ─────────────────────────────────────────────────────

// Wrap a shared SourceToolResult as a Pi AgentToolResult WITHOUT re-clipping (the
// text is already char-capped by the core) so the Pi output is byte-for-byte what
// it produced before the shared-core refactor.
function toAgentResult(r: SourceToolResult): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text: r.text }], details: { isError: r.isError } }
}

const SourceListParams = Type.Object({})

function createSourceListTool(): AgentTool<typeof SourceListParams> {
  return {
    name: 'source_list',
    label: 'List sources',
    description: SOURCE_LIST_DESCRIPTION,
    parameters: SourceListParams,
    async execute(): Promise<AgentToolResult<unknown>> {
      return toAgentResult(await runSourceList())
    },
  }
}

const SourceCreateParams = Type.Object({
  config: Type.Unsafe<Record<string, unknown>>({
    type: 'object',
    description: SOURCE_CREATE_CONFIG_DESCRIPTION,
  }),
})

function createSourceCreateTool(): AgentTool<typeof SourceCreateParams> {
  return {
    name: 'source_create',
    label: 'Create source',
    description: SOURCE_CREATE_DESCRIPTION,
    parameters: SourceCreateParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const raw =
        params.config && typeof params.config === 'object'
          ? (params.config as Record<string, unknown>)
          : {}
      return toAgentResult(await runSourceCreate(raw))
    },
  }
}

const SourceTestParams = Type.Object({
  slug: Type.String({ description: SOURCE_TEST_SLUG_DESCRIPTION }),
})

function createSourceTestTool(): AgentTool<typeof SourceTestParams> {
  return {
    name: 'source_test',
    label: 'Test source',
    description: SOURCE_TEST_DESCRIPTION,
    parameters: SourceTestParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      return toAgentResult(await runSourceTest(params.slug))
    },
  }
}

const SourceOAuthTriggerParams = Type.Object({
  slug: Type.String({ description: SOURCE_OAUTH_SLUG_DESCRIPTION }),
})

function createSourceOAuthTriggerTool(): AgentTool<typeof SourceOAuthTriggerParams> {
  return {
    name: 'source_oauth_trigger',
    label: 'Authenticate source (OAuth)',
    description: SOURCE_OAUTH_DESCRIPTION,
    parameters: SourceOAuthTriggerParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      return toAgentResult(await runSourceOAuthTrigger(params.slug))
    },
  }
}

// Build the session-scoped source toolset (all four tools). Widened to
// AgentTool[] for the homogeneous runtime array (Pi validates each against its
// own schema). Filtered by allowedTools/disabledTools upstream like any tool.
export function createSourceTools(): AgentTool[] {
  return [
    createSourceListTool(),
    createSourceCreateTool(),
    createSourceTestTool(),
    createSourceOAuthTriggerTool(),
  ] as AgentTool[]
}
