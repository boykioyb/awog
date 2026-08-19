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
import { runWikiRead, runWikiSearch } from '../tools/wiki-tools.js'

const textResult = (text: string): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text }],
})

export function buildWikiToolsSdkServer(
  projectId: string | undefined,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'awogwiki',
    version: '1.0.0',
    tools: [
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
