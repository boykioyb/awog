// Zod schema for MCP server config. The on-disk shape is a subset of the UI
// MCPServer type (apps/desktop/ui/types/index.ts) — runtime fields (status,
// tools, resources, lastError) are NOT persisted; they live in the manager's
// in-memory snapshot and are layered on top by mcp.list. See ADR 0014.

import { z } from 'zod'

export const MCP_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

export const McpTransportSchema = z.enum(['stdio', 'http', 'sse'])

export const McpTrustSchema = z.enum(['allow', 'prompt', 'deny'])

export const McpStatusSchema = z.enum(['running', 'starting', 'idle', 'error', 'disabled'])

export const McpToolSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
})

export const McpResourceSchema = z.object({
  uri: z.string().min(1).max(2000),
  mime: z.string().max(200).default(''),
})

// Persistence shape — what we actually write to ~/.awog/mcp-servers/<id>.json.
// Runtime fields are intentionally excluded.
export const McpServerConfigSchema = z.object({
  id: z.string().regex(MCP_ID_RE, 'id must match [a-z0-9][a-z0-9-]{0,62}'),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  transport: McpTransportSchema,
  command: z.string().min(1).max(500).optional(),
  args: z.array(z.string().max(2000)).max(50).optional(),
  env: z.record(z.string().max(8000)).optional(),
  cwd: z.string().max(4096).optional(),
  url: z.string().max(2000).optional(),
  headers: z.record(z.string().max(8000)).optional(),
  enabled: z.boolean(),
  autoStart: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(600000),
  trust: McpTrustSchema,
  // Tools the user has explicitly denied. Persisted so the choice survives
  // restarts. Runtime enforcement (filtering on agent invocation) is wired
  // separately — this list is the source of truth.
  deniedTools: z.array(z.string().min(1).max(200)).max(500).optional(),
})

// Stdio-specific narrowing — pha 1 only stdio is implemented. Refines must hold
// when transport is stdio; other transports are rejected upstream in mcp.upsert
// (ADR 0014 Q1).
export const StdioMcpServerSchema = McpServerConfigSchema.refine(
  (s) => s.transport !== 'stdio' || typeof s.command === 'string',
  { message: 'stdio transport requires command', path: ['command'] },
)

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export type McpTool = z.infer<typeof McpToolSchema>
export type McpResource = z.infer<typeof McpResourceSchema>
export type McpTransport = z.infer<typeof McpTransportSchema>
export type McpTrust = z.infer<typeof McpTrustSchema>
export type McpStatus = z.infer<typeof McpStatusSchema>

// Full snapshot delivered to UI (config + runtime). Matches UI MCPServer type.
export interface McpServerSnapshot extends McpServerConfig {
  status: McpStatus
  tools: McpTool[]
  resources: McpResource[]
  lastError?: string
  lastStartedAt?: string
}
