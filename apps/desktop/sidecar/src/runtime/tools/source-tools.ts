// Agent-callable `source_*` session tools (ADR 0060 D-6/D-7, P6). Let the model
// set up external Sources conversationally — the Craft flow — from inside a chat
// session: list what exists, create/update a config, test the connection, store
// an api credential, or kick off an OAuth sign-in. Mirrors Craft's
// session-tools-core handlers (source-test / source-oauth / credential-prompt),
// adapted to AWOG's Pi runtime + keychain infra.
//
// Every tool here is a THIN wrapper over the existing sources/* modules + the
// same logic the source.* RPCs use — no reimplementation. Wired in for SESSIONS
// only (createRuntimeToolDefinitions, gated by ToolFilter.includeSourceTools),
// never for unattended tasks — mirroring the RunWorkflow tool's session scope.
//
// Gating (runtime/permission.ts): source_create is MUTATING and routes through
// the permission gate (SOURCE_MUTATING_TOOL_NAMES). source_list / source_test /
// source_oauth_trigger are non-destructive actions.
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
export const SOURCE_MUTATING_TOOL_NAMES = ['source_create'] as const

const RESULT_MAX_CHARS = 16 * 1024

function textResult(text: string, isError = false): AgentToolResult<unknown> {
  const clipped =
    text.length <= RESULT_MAX_CHARS ? text : `${text.slice(0, RESULT_MAX_CHARS)}\n…(truncated)`
  return { content: [{ type: 'text', text: clipped }], details: { isError } }
}

// ─── source_list ─────────────────────────────────────────────────────────────

const SourceListParams = Type.Object({})

function createSourceListTool(): AgentTool<typeof SourceListParams> {
  return {
    name: 'source_list',
    label: 'List sources',
    description:
      'List the configured external Sources (mcp / api / local) with their id, slug, name, type, provider, enabled flag, and last connection status. Returns no secrets. Use it to see what is already set up before creating a new source.',
    parameters: SourceListParams,
    async execute(): Promise<AgentToolResult<unknown>> {
      const sources = await listSources()
      if (sources.length === 0) {
        return textResult('No sources configured yet. Use source_create to add one.')
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
      return textResult(JSON.stringify(summary, null, 2))
    },
  }
}

// ─── source_create ───────────────────────────────────────────────────────────

const SourceCreateParams = Type.Object({
  config: Type.Unsafe<Record<string, unknown>>({
    type: 'object',
    description:
      'The full SourceConfig object. Must include: slug (lowercase-alphanumeric-with-hyphens), name, type ("mcp" | "api" | "local"), provider, and the matching type block — "mcp" ({ transport, url|command, authType, ... }), "api" ({ baseUrl, authType, testEndpoint, ... }), or "local" ({ path }). id, enabled, timeoutMs (30000), trust ("prompt"), createdAt/updatedAt are filled with defaults when omitted. Do NOT set autoStart (it does not exist). For secrets in an mcp env/header, use a "secret:KEY" reference — never paste a raw token here.',
  }),
})

function createSourceCreateTool(): AgentTool<typeof SourceCreateParams> {
  return {
    name: 'source_create',
    label: 'Create source',
    description:
      'Create or update an external Source by writing its config. Validates the config against the schema, fills sensible defaults (id/enabled/timeoutMs/trust/timestamps), and persists it to ~/.awog/sources/<slug>/config.json. If a source with the slug already exists it is updated (its id + createdAt are preserved). Run source_test next to validate the connection.',
    parameters: SourceCreateParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const raw =
        params.config && typeof params.config === 'object'
          ? (params.config as Record<string, unknown>)
          : {}
      const slug = typeof raw.slug === 'string' ? raw.slug : undefined
      if (!slug) {
        return textResult(
          'source_create requires config.slug (lowercase alphanumeric with hyphens).',
          true,
        )
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
        createdAt:
          existing?.createdAt ?? (typeof raw.createdAt === 'number' ? raw.createdAt : now),
        updatedAt: now,
      }

      const parsed = SourceConfigSchema.safeParse(draft)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n')
        return textResult(`Invalid source config:\n${issues}`, true)
      }

      try {
        // saveSource keychainizes any secret-looking mcp env/header values (moves
        // them to the OS keychain, leaves only a "secret:KEY" ref on disk).
        await saveSource(parsed.data)
      } catch (err) {
        return textResult(
          `Failed to save source: ${err instanceof Error ? err.message : String(err)}`,
          true,
        )
      }

      const verb = existing ? 'Updated' : 'Created'
      return textResult(
        `${verb} source "${parsed.data.name}" (slug: ${parsed.data.slug}, id: ${parsed.data.id}, type: ${parsed.data.type}). Run source_test({ slug: "${parsed.data.slug}" }) next to validate the connection.`,
      )
    },
  }
}

// ─── source_test ─────────────────────────────────────────────────────────────

const SourceTestParams = Type.Object({
  slug: Type.String({ description: 'The slug of the source to test.' }),
})

function createSourceTestTool(): AgentTool<typeof SourceTestParams> {
  return {
    name: 'source_test',
    label: 'Test source',
    description:
      'Test a source connection (mcp handshake / api testEndpoint / local path) and persist the outcome (connectionStatus / isAuthenticated / lastTestedAt); auto-enables a clean run so its tools become available. Reports the status, tool count, and any error. Call it after source_create and after authenticating.',
    parameters: SourceTestParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const { source, outcome } = await testAndPersistSource(params.slug)
      if (!source && !outcome.supported && outcome.error?.startsWith('source not found')) {
        return textResult(`Source '${params.slug}' not found.`, true)
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
      // Hard failure (unreachable / bad config) is an error; needs_auth is a soft,
      // actionable state, not a tool error.
      return textResult(lines.join('\n'), outcome.status === 'failed')
    },
  }
}

// ─── source_oauth_trigger ──────────────────────────────────────────────────────

const SourceOAuthTriggerParams = Type.Object({
  slug: Type.String({
    description:
      'The slug of the OAuth source to authenticate — an mcp source with mcp.authType "oauth", or an api source with api.authType "oauth".',
  }),
})

function createSourceOAuthTriggerTool(): AgentTool<typeof SourceOAuthTriggerParams> {
  return {
    name: 'source_oauth_trigger',
    label: 'Authenticate source (OAuth)',
    description:
      'Start an OAuth sign-in for an OAuth source (mcp OR generic api). Opens a browser authorization flow in the BACKGROUND and returns immediately — it does not wait for the sign-in to finish. If the source already has a valid token it says so. After the user completes sign-in in the browser, re-run source_test to confirm.',
    parameters: SourceOAuthTriggerParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
      const source = await loadSource(params.slug)
      if (!source) return textResult(`Source '${params.slug}' not found.`, true)
      if (source.type === 'local') {
        return textResult(
          `Source '${params.slug}' is a local source — OAuth applies only to mcp/api sources.`,
          true,
        )
      }
      // source is now McpSource | ApiSource.
      const resolved = resolveOAuthTarget(source)
      if (!resolved.ok) return textResult(resolved.error, true)

      const existing = await getFreshToken(source)
      if (existing) {
        return textResult(
          `"${source.name}" is already authenticated — use its tools directly (no sign-in needed).`,
        )
      }

      // Kick off the browser flow in the BACKGROUND so the turn doesn't block on
      // the (up to 5-minute) loopback callback. The flow emits source.oauth-url
      // for the UI to open, persists the token to the keychain on success, and
      // flips the source status. Errors are logged, never surfaced as a token.
      void startSourceOAuth(params.slug, (url) =>
        emit('source.oauth-url', { slug: params.slug, url }),
      ).catch((err) => {
        log.warn('source_oauth_trigger: background OAuth flow failed', {
          slug: params.slug,
          err: err instanceof Error ? err.message : String(err),
        })
      })

      return textResult(
        `Authorization started for "${source.name}". A browser window will open for sign-in. Once the user confirms they have signed in, re-run source_test({ slug: "${source.slug}" }) to confirm the connection. Do not assume success before then.`,
      )
    },
  }
}

// Build the session-scoped source toolset (all five tools). Widened to
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
