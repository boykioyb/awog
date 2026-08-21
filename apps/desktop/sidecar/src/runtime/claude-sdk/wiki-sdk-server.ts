// Wiki tools on the Claude SDK path (ADR 0073 D-7).
//
// One in-process SDK MCP server keyed `awogwiki` → the SDK exposes
// `mcp__awogwiki__wiki_search` / `mcp__awogwiki__wiki_read`. The handlers are the
// SAME functions the Pi AgentTools call (runtime/tools/wiki-tools.ts), so a wiki
// lookup behaves identically on both runtimes — which is the point: an agent that
// could read the wiki under one provider and not the other would look broken.
//
// Using createSdkMcpServer here follows the ssh/source precedent (ADR 0060 D-8
// forbade it on the PI path, not this one).

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import { runWikiDelete, runWikiRead, runWikiSearch, runWikiWrite } from '../tools/wiki-tools.js'

const textResult = (text: string): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text }],
})

export function buildWikiToolsSdkServer(
  projectId: string | undefined,
  // Agent may create/update/delete pages (Settings → Wiki, default off). Each call
  // still passes the permission gate, which matches the bridged names too.
  canWrite = false,
): McpSdkServerConfigWithInstance {
  const writeTools = canWrite
    ? [
        tool(
          'wiki_write',
          "Create or update a page in the user's wiki — for documenting something durably, not for " +
            'chat answers. A write replaces the whole body, so read the page first when editing part ' +
            'of it, and reuse an existing path to revise instead of adding a near-duplicate.',
          {
            path: z.string().describe('Wiki page path, e.g. "architecture/system-overview".'),
            body: z.string().describe('The FULL Markdown body — a write replaces the whole page.'),
            title: z.string().optional().describe('Kept as-is when omitted on an existing page.'),
            description: z
              .string()
              .optional()
              .describe('One line — what every future turn sees in <wiki_index>.'),
            tags: z.array(z.string()).optional(),
            scope: z
              .string()
              .optional()
              .describe("'project' = the project's wiki; 'global' (default) = user-wide."),
          },
          async (args) => textResult((await runWikiWrite(args, projectId)).text),
        ),
        tool(
          'wiki_delete',
          'Delete a wiki page. Only when the user asks — it may be their only copy and the global ' +
            'wiki has no version history.',
          { path: z.string().describe('Wiki page path to delete.') },
          async (args) => textResult((await runWikiDelete(args.path, projectId)).text),
        ),
      ]
    : []

  return createSdkMcpServer({
    name: 'awogwiki',
    version: '1.0.0',
    tools: [
      ...writeTools,
      tool(
        'wiki_search',
        "Search the user's internal wiki (their own architecture notes, patterns, conventions, " +
          'docs) and get back matching page paths with a snippet. Use this BEFORE answering a ' +
          'question about how this system is designed or why a convention exists — the wiki is the ' +
          'authoritative source for those, and it is not in the repo.',
        {
          query: z.string().describe('Text to find in the wiki. Matched literally, case-insensitive.'),
          space: z
            .string()
            .optional()
            .describe('Optional: restrict to one space (first path segment, e.g. "architecture").'),
        },
        async (args) => textResult((await runWikiSearch(args.query, args.space, projectId)).text),
      ),
      tool(
        'wiki_read',
        "Read one page of the user's internal wiki by its path (as listed in <wiki_index> or " +
          'returned by wiki_search). Read the page rather than inferring its content from the title.',
        {
          path: z.string().describe('Wiki page path, e.g. "architecture/system-overview".'),
          offset: z.number().optional().describe('Optional 1-based first line to return.'),
          limit: z.number().optional().describe('Optional number of lines to return.'),
        },
        async (args) =>
          textResult((await runWikiRead(args.path, projectId, args.offset, args.limit)).text),
      ),
    ],
  })
}
