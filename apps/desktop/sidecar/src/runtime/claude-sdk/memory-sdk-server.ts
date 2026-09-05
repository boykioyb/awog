// Memory tools on the Claude SDK path (ADR 0073 D-7/D-11).
//
// One in-process SDK MCP server keyed `awogmemory` → `mcp__awogmemory__memory_*`.
// Handlers are the same functions the Pi AgentTools call, so remembering a fact
// behaves identically whichever runtime the session is on.

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import { runForget, runMemoryRead, runRemember } from '../tools/memory-tools.js'

// `isError` carries a helper's failure across the bridge — runForget reports "no
// match" in a return field rather than by throwing (tools/tool-error.ts), and
// without this it would render as a completed forget.
const textResult = (
  text: string,
  isError = false,
): { content: { type: 'text'; text: string }[]; isError?: boolean } => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
})

export function buildMemoryToolsSdkServer(
  projectId: string | undefined,
  opts: { autoWrite: boolean; hasBodies: boolean },
): McpSdkServerConfigWithInstance {
  const writeTools = opts.autoWrite
    ? [
        tool(
          'memory_remember',
          'Save a durable fact about the user, their preferences, or a constraint of this project so ' +
            'you still know it in future sessions. Reuse an existing name to correct a fact instead of ' +
            'adding a duplicate. Not for task state or anything the user asked you to keep private.',
          {
            name: z.string().describe('Short stable name, e.g. "git-push-account".'),
            description: z
              .string()
              .describe('The fact in ONE self-contained line — this is what stays in your context.'),
            body: z
              .string()
              .optional()
              .describe('Optional longer detail, read later via memory_read.'),
            type: z
              .string()
              .optional()
              .describe("'user' | 'feedback' | 'project' | 'reference' (default 'project')."),
            scope: z
              .string()
              .optional()
              .describe("'project' = this project only; 'global' (default) = everywhere."),
          },
          async (args) => textResult((await runRemember(args, projectId)).text),
        ),
        tool(
          'memory_forget',
          'Delete a saved memory by name — when the user says something you remembered is wrong.',
          { name: z.string().describe('Name of the saved memory to delete.') },
          async (args) => {
            const r = await runForget(args.name, projectId)
            return textResult(r.text, !r.found)
          },
        ),
      ]
    : []

  const readTools = opts.hasBodies
    ? [
        tool(
          'memory_read',
          'Read the full detail of a saved memory whose <memory> entry is marked [more: memory_read].',
          { name: z.string().describe('Name of the saved memory.') },
          async (args) => textResult((await runMemoryRead(args.name, projectId)).text),
        ),
      ]
    : []

  return createSdkMcpServer({
    name: 'awogmemory',
    version: '1.0.0',
    tools: [...writeTools, ...readTools],
  })
}
