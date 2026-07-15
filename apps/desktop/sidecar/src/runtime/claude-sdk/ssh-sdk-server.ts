// Expose the agent SSH tools (ADR 0064) to the Claude Agent SDK runtime as ONE
// in-process SDK MCP server, so the anthropic provider (the dominant Claude SDK path)
// gets the SAME tools the Pi path builds (runtime/tools/ssh-tools.ts). Unified model:
// the host is a per-call param (ssh_list_hosts → pick an id), so this is available in
// any session with hosts configured, not bound to one host.
//
// One server keyed `awogssh` → the SDK exposes `mcp__awogssh__ssh_list_hosts` /
// `__ssh_exec` / `__ssh_list_dir` / `__ssh_read_file` / `__ssh_write_file`
// (+ `__ssh_terminal_run` in the co-pilot dock). The mutating + read tools are gated
// by the EXISTING PreToolUse backstop (runtime/permission.ts), whose SSH check matches
// the bridged `mcp__<server>__<tool>` form (sshToolName) and keys the allowance by the
// `host` arg — so the SDK path is governed identically to Pi. ssh_list_hosts isn't gated.
//
// Handlers delegate to the SHARED cores so the connect + clamp logic lives ONCE in
// ssh-tools.ts. Invariant 1: no tool ARG, RESULT, or log carries a credential.

import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import {
  runSshExec,
  runSshList,
  runSshListHosts,
  runSshRead,
  runSshTerminal,
  runSshWrite,
} from '../tools/ssh-tools.js'

function textResult(text: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text }] }
}

const HOST_DESC = 'SSH host id to target (call ssh_list_hosts first to see available ids).'

// Build the `awogssh` SDK MCP server. `terminalConnId` (co-pilot dock) ADDS the
// watched-terminal tool. Caller adds it under the map key `awogssh`.
export function buildSshToolsSdkServer(terminalConnId?: string): McpSdkServerConfigWithInstance {
  // Co-pilot dock: run in the WATCHED shell (connId). Built only when bound so the
  // array's element type includes it without a mismatched .push (exactOptional).
  const terminalTools = terminalConnId
    ? [
        tool(
          'ssh_terminal_run',
          'Run a shell command IN the terminal the user is watching (their live SSH shell) — it ' +
            'types and runs LIVE, and you get back its output + exit code. Prefer this over ' +
            'ssh_exec when the user is watching so they can follow along. Runs on the REMOTE machine.',
          { command: z.string().describe('Shell command to run live in the watched terminal.') },
          async (args) => textResult((await runSshTerminal(terminalConnId, args.command)).text),
        ),
      ]
    : []

  return createSdkMcpServer({
    name: 'awogssh',
    version: '1.0.0',
    tools: [
      tool(
        'ssh_list_hosts',
        'List the SSH hosts the user has configured (id, name, user@host). Call this FIRST to ' +
          'get a host id, then pass it as `host` to the other ssh_* tools.',
        {},
        async () => textResult((await runSshListHosts()).text),
      ),
      tool(
        'ssh_exec',
        'Run a shell command on a configured SSH host (by `host` id) and capture stdout, stderr, ' +
          'and exit code. Runs on the REMOTE machine, not locally.',
        {
          host: z.string().describe(HOST_DESC),
          command: z.string().describe('Shell command to run on the remote host (runs remotely).'),
        },
        async (args) => textResult((await runSshExec(args.host, args.command)).text),
      ),
      tool(
        'ssh_list_dir',
        'List a directory on a configured SSH host (by `host` id).',
        {
          host: z.string().describe(HOST_DESC),
          path: z.string().describe('Absolute path of a directory ON THE REMOTE host to list.'),
        },
        async (args) => textResult((await runSshList(args.host, args.path)).text),
      ),
      tool(
        'ssh_read_file',
        'Read a file on a configured SSH host (by `host` id, UTF-8 decoded).',
        {
          host: z.string().describe(HOST_DESC),
          path: z.string().describe('Absolute path of a file ON THE REMOTE host to read.'),
          maxBytes: z
            .number()
            .optional()
            .describe('Max bytes to read (default 1MB, hard cap 5MB).'),
        },
        async (args) => textResult((await runSshRead(args.host, args.path, args.maxBytes)).text),
      ),
      tool(
        'ssh_write_file',
        'Write UTF-8 text content to a file on a configured SSH host (by `host` id; creates or ' +
          'overwrites the file).',
        {
          host: z.string().describe(HOST_DESC),
          path: z.string().describe('Absolute path of a file ON THE REMOTE host to write.'),
          content: z.string().describe('UTF-8 text content to write (overwrites the file).'),
        },
        async (args) => textResult((await runSshWrite(args.host, args.path, args.content)).text),
      ),
      ...terminalTools,
    ],
  })
}
