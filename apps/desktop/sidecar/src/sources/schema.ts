// Zod schema for the Source config — the on-disk shape written to
// ~/.awog/sources/<slug>/config.json. Discriminated union on `type`
// (mcp | api | local), mirroring Craft's FolderSourceConfig. See ADR 0060
// + docs/features/connections-sources-model.md.
//
// This is the validation source of truth; types/shared.ts holds a hand-written
// TS mirror kept structurally identical (store.ts imports the shared type and
// returns zod-parsed data as it — tsc enforces they stay compatible).
//
// Runtime-only fields (tools/resources/live status) are NOT persisted — status
// is captured by the persisted `connectionStatus`. NO `autoStart` field: source
// lifecycle is a lazy pool (ADR 0060 D-3), not a config-driven process.

import { z } from 'zod'

// Folder name / stable identifier. Lowercase alphanumeric + hyphens. A legacy
// MCP id (`[a-z0-9][a-z0-9-]{0,62}`) is always a valid slug, so migration can
// reuse it verbatim as the folder name.
export const SOURCE_SLUG_RE = /^[a-z0-9-]+$/

// Stable source id (keychain account prefix). New sources use `${slug}_${8hex}`
// (underscore) while migrated ones keep the legacy MCP id (`[a-z0-9-]+`); both
// match this. Used to validate the `sourceId` on secret-writing RPCs.
export const SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,120}$/

export const SourceTypeSchema = z.enum(['mcp', 'api', 'local'])

export const SourceTrustSchema = z.enum(['allow', 'prompt', 'deny'])

export const SourceConnectionStatusSchema = z.enum([
  'connected',
  'needs_auth',
  'failed',
  'untested',
  'local_disabled',
])

// mcp-only auth probe run by source.test after the handshake (mirrors
// McpHealthCheck — see mcp/schema.ts).
export const SourceHealthCheckSchema = z.object({
  tool: z.string().min(1).max(200),
  args: z.record(z.unknown()).optional(),
})

// ─── Per-type config blocks ──────────────────────────────────────────────────

// MCP: remote (http/sse via url) or local (stdio via command). `env`/`headers`
// hold `secret:KEY` references (resolved from the keychain at connect time).
// `cwd` is an AWOG carry-over from McpServerConfig (Craft's block has no cwd) so
// migration never drops the working directory of a stdio server.
export const McpSourceBlockSchema = z.object({
  transport: z.enum(['http', 'sse', 'stdio']).optional(),
  // http/sse
  url: z.string().max(2000).optional(),
  authType: z.enum(['oauth', 'bearer', 'none']).optional(),
  clientId: z.string().max(500).optional(),
  headers: z.record(z.string().max(8000)).optional(),
  headerNames: z.array(z.string().max(200)).max(50).optional(),
  // stdio
  command: z.string().max(500).optional(),
  args: z.array(z.string().max(2000)).max(50).optional(),
  env: z.record(z.string().max(8000)).optional(),
  cwd: z.string().max(4096).optional(),
})

const ApiTestEndpointSchema = z.object({
  method: z.enum(['GET', 'POST']),
  path: z.string().max(2000),
  body: z.record(z.unknown()).optional(),
  headers: z.record(z.string().max(8000)).optional(),
})

const ApiRenewEndpointSchema = z.object({
  path: z.string().max(2000),
  method: z.enum(['GET', 'POST']).optional(),
  body: z.record(z.unknown()).optional(),
  headers: z.record(z.string().max(8000)).optional(),
  tokenField: z.string().max(200).optional(),
  expiresInField: z.string().max(200).optional(),
  fallbackTtlSecs: z.number().int().min(0).optional(),
})

const ApiOAuthConfigSchema = z.object({
  authorizationUrl: z.string().max(2000),
  tokenUrl: z.string().max(2000),
  clientId: z.string().max(500),
  clientSecret: z.string().max(2000).optional(),
  scopes: z.array(z.string().max(500)).max(100).optional(),
  audience: z.string().max(500).optional(),
  extraParams: z.record(z.string().max(2000)).optional(),
})

// REST API source. Becomes a single `api_<slug>` tool at runtime (phase P3).
export const ApiSourceBlockSchema = z.object({
  baseUrl: z.string().max(2000),
  authType: z.enum(['bearer', 'header', 'query', 'basic', 'oauth', 'none']),
  headerName: z.string().max(200).optional(),
  headerNames: z.array(z.string().max(200)).max(50).optional(),
  queryParam: z.string().max(200).optional(),
  authScheme: z.string().max(200).optional(),
  defaultHeaders: z.record(z.string().max(8000)).optional(),
  testEndpoint: ApiTestEndpointSchema.optional(),
  renewEndpoint: ApiRenewEndpointSchema.optional(),
  oauth: ApiOAuthConfigSchema.optional(),
  // provider-specific presets (phase P6)
  googleService: z
    .enum(['gmail', 'calendar', 'drive', 'docs', 'sheets', 'youtube', 'searchconsole'])
    .optional(),
  googleScopes: z.array(z.string().max(500)).max(100).optional(),
  googleOAuthClientId: z.string().max(500).optional(),
  googleOAuthClientSecret: z.string().max(2000).optional(),
  slackService: z.enum(['messaging', 'channels', 'users', 'files', 'full']).optional(),
  slackUserScopes: z.array(z.string().max(500)).max(100).optional(),
  microsoftService: z
    .enum(['outlook', 'microsoft-calendar', 'onedrive', 'teams', 'sharepoint'])
    .optional(),
  microsoftScopes: z.array(z.string().max(500)).max(100).optional(),
})

// Local filesystem source. `path` is absolute or `~`-anchored; runtime scopes fs
// access to it (phase P4).
export const LocalSourceBlockSchema = z.object({
  path: z.string().min(1).max(4096),
  format: z.string().max(200).optional(),
})

// ─── Base fields (present on every source) ───────────────────────────────────

const sourceBaseShape = {
  id: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(SOURCE_SLUG_RE, 'slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(120),
  provider: z.string().min(1).max(120),
  enabled: z.boolean(),
  icon: z.string().max(2000).optional(),
  tagline: z.string().max(2000).optional(),
  description: z.string().max(4000).optional(),
  isAuthenticated: z.boolean().optional(),
  connectionStatus: SourceConnectionStatusSchema.optional(),
  connectionError: z.string().max(8000).optional(),
  lastTestedAt: z.number().int().min(0).optional(),
  createdAt: z.number().int().min(0).optional(),
  updatedAt: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().min(1000).max(600000),
  deniedTools: z.array(z.string().min(1).max(200)).max(500).optional(),
  trust: SourceTrustSchema,
  healthCheck: SourceHealthCheckSchema.optional(),
} as const

// Discriminated union on `type` — exactly one per-type block is present.
export const SourceConfigSchema = z.discriminatedUnion('type', [
  z.object({ ...sourceBaseShape, type: z.literal('mcp'), mcp: McpSourceBlockSchema }),
  z.object({ ...sourceBaseShape, type: z.literal('api'), api: ApiSourceBlockSchema }),
  z.object({ ...sourceBaseShape, type: z.literal('local'), local: LocalSourceBlockSchema }),
])

// Optional per-source Explore-mode permission overrides (permissions.json).
// Enforcement is wired in phase P4 — for now this only powers the read helper.
export const SourcePermissionsSchema = z
  .object({
    allowedMcpPatterns: z.array(z.string().max(500)).max(500).optional(),
    allowedApiEndpoints: z
      .array(z.object({ method: z.string().max(20), path: z.string().max(2000) }))
      .max(500)
      .optional(),
    allowedBashPatterns: z.array(z.string().max(500)).max(500).optional(),
    allowedWritePaths: z.array(z.string().max(4096)).max(500).optional(),
  })
  .passthrough()

export type SourceType = z.infer<typeof SourceTypeSchema>
export type SourceTrust = z.infer<typeof SourceTrustSchema>
export type SourceConnectionStatus = z.infer<typeof SourceConnectionStatusSchema>
export type SourceConfig = z.infer<typeof SourceConfigSchema>
export type SourcePermissions = z.infer<typeof SourcePermissionsSchema>
