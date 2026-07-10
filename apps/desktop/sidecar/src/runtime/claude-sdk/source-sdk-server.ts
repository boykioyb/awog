// Expose the agent-callable `source_*` setup tools (ADR 0060 P6) to the Claude
// Agent SDK runtime as ONE in-process SDK MCP server, so the anthropic provider
// can add/test/authenticate Sources conversationally — the SAME four tools the Pi
// path builds (runtime/tools/source-tools.ts). Without this the source_* flow is
// Pi-only and the (dominant) Claude SDK path can't set up Sources from a chat.
//
// One server named `awog` holding four tools → the SDK exposes exactly
// `mcp__awog__source_list` / `mcp__awog__source_create` / `mcp__awog__source_test`
// / `mcp__awog__source_oauth_trigger`. The mutating one (`source_create`) is gated
// by the EXISTING PreToolUse permission backstop (runtime/permission.ts), whose
// source-mutating check matches the `mcp__awog__source_create` bridged form too.
//
// The handlers delegate to the SHARED cores (runSourceList / runSourceCreate /
// runSourceTest / runSourceOAuthTrigger) — the draft-build + schema validate +
// saveSource, the test-result formatting, and the non-blocking OAuth kick-off live
// ONCE in source-tools.ts; this file only declares the zod input schemas (mirroring
// the Pi TypeBox ones) and adapts the result shape. source_oauth_trigger stays
// non-blocking (background startSourceOAuth + emit source.oauth-url) exactly like Pi.
//
// Invariant 1: no tool ARG, RESULT, or log line carries a raw secret. There is
// deliberately NO source_set_credential tool (a raw secret as a tool arg would leak
// via the permission event + persisted step) — api credentials are entered by the
// USER in the Connections UI; source_create configs must use "secret:KEY" refs.
//
// Wired into run-stream.ts (SESSIONS) ONLY — never invoke.ts (tasks) — mirroring
// the Pi ToolFilter.includeSourceTools sessions-only scope.

import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import {
  SOURCE_CREATE_CONFIG_DESCRIPTION,
  SOURCE_CREATE_DESCRIPTION,
  SOURCE_LIST_DESCRIPTION,
  SOURCE_OAUTH_DESCRIPTION,
  SOURCE_OAUTH_SLUG_DESCRIPTION,
  SOURCE_TEST_DESCRIPTION,
  SOURCE_TEST_SLUG_DESCRIPTION,
  runSourceCreate,
  runSourceList,
  runSourceOAuthTrigger,
  runSourceTest,
  type SourceToolResult,
} from '../tools/source-tools.js'

// Adapt a shared SourceToolResult to the SDK tool result shape. The text is
// already char-capped by the core, so no re-clipping here.
function toSdkResult(r: SourceToolResult): {
  content: { type: 'text'; text: string }[]
  isError: boolean
} {
  return { content: [{ type: 'text' as const, text: r.text }], isError: r.isError }
}

// Build the single `awog` SDK MCP server carrying the four source_* tools. Takes
// no context: the cores use a module-level emit for source.oauth-url and no
// per-turn signal (mirroring the Pi createSourceTools(), which also takes none).
// The caller adds this under the map key `awog` so the tools resolve to
// `mcp__awog__source_*`.
export function buildSourceToolsSdkServer(): McpSdkServerConfigWithInstance {
  const listTool = tool('source_list', SOURCE_LIST_DESCRIPTION, {}, async () =>
    toSdkResult(await runSourceList()),
  )

  const createTool = tool(
    'source_create',
    SOURCE_CREATE_DESCRIPTION,
    { config: z.record(z.string(), z.unknown()).describe(SOURCE_CREATE_CONFIG_DESCRIPTION) },
    async (args) => toSdkResult(await runSourceCreate(args.config)),
  )

  const testTool = tool(
    'source_test',
    SOURCE_TEST_DESCRIPTION,
    { slug: z.string().describe(SOURCE_TEST_SLUG_DESCRIPTION) },
    async (args) => toSdkResult(await runSourceTest(args.slug)),
  )

  const oauthTool = tool(
    'source_oauth_trigger',
    SOURCE_OAUTH_DESCRIPTION,
    { slug: z.string().describe(SOURCE_OAUTH_SLUG_DESCRIPTION) },
    async (args) => toSdkResult(await runSourceOAuthTrigger(args.slug)),
  )

  return createSdkMcpServer({
    name: 'awog',
    version: '1.0.0',
    tools: [listTool, createTool, testTool, oauthTool],
  })
}
