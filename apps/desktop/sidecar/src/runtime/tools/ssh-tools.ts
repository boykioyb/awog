// SSH agent tools (ADR 0064). Available in ANY session that has SSH hosts configured
// (unified MCP-style model — no per-session host binding). The host is a PER-CALL
// param, so the agent first calls ssh_list_hosts, then targets a host by id:
//   ssh_list_hosts — list the configured hosts (id / name / user@host)  (read)
//   ssh_exec       — run a shell command on a host                      (GATED, mutating)
//   ssh_read_file  — read a remote file                                 (GATED, read)
//   ssh_list_dir   — list a remote directory                            (GATED, read)
//   ssh_write_file — write UTF-8 content to a remote path               (GATED, mutating)
//   ssh_terminal_run — run in the WATCHED terminal (co-pilot dock only) (GATED, mutating)
//
// This DELIBERATELY reverses ADR 0063's "SSH is not a model tool" stance: the
// permission gate (runtime/permission.ts, per-session sshApprovalMode) governs the
// host-targeted tools (reads too — they can exfil sensitive remote files), keyed by
// the `host` arg. In 'auto' mode the set runs without a prompt; the mutating tools are
// additionally blocked in plan mode. ssh_list_hosts is not gated (names only).
//
// SECURITY (invariant 1): credentials NEVER reach the agent. The connId is
// resolved inside the sidecar (ensureConnId → keychain-backed connect); tool
// params carry only a command / path / content, and results carry only captured
// stdout/stderr/file bytes (clamped to a context-safe budget). The headless
// connect is host-key fail-closed (manager.connectHeadless): an untrusted/changed
// key throws a clear error telling the user to trust it in the SSH tab first.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { ensureConnId, sshManager } from '../../ssh/manager.js'
import { sftpList, sftpRead, sftpWriteContent } from '../../ssh/sftp.js'
import { listHosts, loadHost } from '../../ssh/store.js'
import { clampForLlm } from './output-budget.js'

// Remote output is unbounded; clamp before it reaches the model context.
const SSH_MAX_TOTAL_CHARS = 64 * 1024

// A host is agent-usable unless it opted OUT (agentEnabled === false). Guards every
// host-targeted tool so the agent can't reach a host hidden from it by passing an id
// directly (ssh_list_hosts only lists exposed ones, but the arg is free-form).
async function assertAgentHost(hostId: string): Promise<void> {
  const host = await loadHost(hostId)
  if (!host) throw new Error(`SSH host not found: ${hostId}`)
  if (host.agentEnabled === false) {
    throw new Error(`SSH host "${hostId}" is not available to agents (enable it on the SSH page).`)
  }
}

export interface CreateSshToolsOptions {
  // Threaded for parity with other top-level tools. The host is a per-call param
  // (ssh_list_hosts → pick an id), so the toolset is NOT bound to one host.
  sessionId: string
  // SSH terminal co-pilot (ADR 0064): when set, the connId of the interactive shell
  // the user is watching → ADDS ssh_terminal_run, which drives THAT visible terminal
  // (runInShell) so the user follows along (dock only).
  terminalConnId?: string
}

interface SshExecDetails {
  command: string
  exitCode: number
}

interface SshPathDetails {
  path: string
}

// Every host-targeted tool takes `host` = the SSH host id (from ssh_list_hosts).
const HOST_DESC = 'SSH host id to target (call ssh_list_hosts first to see available ids).'

const ListHostsParams = Type.Object({})

const ExecParams = Type.Object({
  host: Type.String({ description: HOST_DESC }),
  command: Type.String({ description: 'Shell command to run on the remote host (runs remotely).' }),
})

const ListParams = Type.Object({
  host: Type.String({ description: HOST_DESC }),
  path: Type.String({ description: 'Absolute path of a directory ON THE REMOTE host to list.' }),
})

const ReadParams = Type.Object({
  host: Type.String({ description: HOST_DESC }),
  path: Type.String({ description: 'Absolute path of a file ON THE REMOTE host to read.' }),
  maxBytes: Type.Optional(
    Type.Number({ description: 'Max bytes to read (default 1MB, hard cap 5MB).' }),
  ),
})

const WriteParams = Type.Object({
  host: Type.String({ description: HOST_DESC }),
  path: Type.String({ description: 'Absolute path of a file ON THE REMOTE host to write.' }),
  content: Type.String({ description: 'UTF-8 text content to write (overwrites the file).' }),
})

// The terminal co-pilot tool (dock only) targets the WATCHED shell by connId, so it
// takes no host — just the command.
const TerminalParams = Type.Object({
  command: Type.String({ description: 'Shell command to run live in the watched terminal.' }),
})

// ─── Shared operation cores ──────────────────────────────────────────────────
// The connect + run + clamp logic, used by BOTH the Pi AgentTools below and the
// Claude SDK MCP bridge (claude-sdk/ssh-sdk-server.ts) so the two runtimes behave
// identically (the anthropic provider runs on the SDK path). Each resolves the
// connId from hostId, clamps output to a context-safe budget, and throws on
// failure — no credential ever transits (invariant 1).

export async function runSshExec(
  hostId: string,
  command: string,
): Promise<{ text: string; exitCode: number }> {
  await assertAgentHost(hostId)
  const connId = await ensureConnId(hostId)
  const { stdout, stderr, code } = await sshManager.exec(connId, command)
  const body: string[] = []
  if (stdout.trim()) body.push(stdout.replace(/\n+$/, ''))
  if (stderr.trim()) body.push(`[stderr]\n${stderr.replace(/\n+$/, '')}`)
  const clamped = clampForLlm(body.length ? body.join('\n').split('\n') : [], {
    maxTotalChars: SSH_MAX_TOTAL_CHARS,
    hint: 'redirect the command output to a file or narrow it',
  })
  return { text: `${clamped.text}${clamped.text ? '\n' : ''}[exit code ${code}]`, exitCode: code }
}

export async function runSshList(hostId: string, path: string): Promise<{ text: string }> {
  await assertAgentHost(hostId)
  const connId = await ensureConnId(hostId)
  const { entries } = await sftpList(connId, path)
  const lines = entries.map((e) => {
    const kind = e.type === 'dir' ? 'd' : e.type === 'symlink' ? 'l' : e.type === 'file' ? '-' : '?'
    return `${kind} ${String(e.size).padStart(10)}  ${e.name}`
  })
  const clamped = clampForLlm(lines, { maxTotalChars: SSH_MAX_TOTAL_CHARS, hint: 'list a narrower path' })
  return { text: clamped.text || '(empty directory)' }
}

export async function runSshRead(
  hostId: string,
  path: string,
  maxBytes?: number,
): Promise<{ text: string }> {
  await assertAgentHost(hostId)
  const connId = await ensureConnId(hostId)
  const { contentBase64, truncated } =
    maxBytes !== undefined ? await sftpRead(connId, path, maxBytes) : await sftpRead(connId, path)
  const decoded = Buffer.from(contentBase64, 'base64').toString('utf8')
  const clamped = clampForLlm(decoded.length ? decoded.split('\n') : [], {
    maxTotalChars: SSH_MAX_TOTAL_CHARS,
    hint: 'read a smaller maxBytes or a narrower path',
  })
  const note = truncated ? '\n…(file truncated at the read cap)' : ''
  return { text: (clamped.text || '(empty file)') + note }
}

export async function runSshWrite(
  hostId: string,
  path: string,
  content: string,
): Promise<{ text: string }> {
  await assertAgentHost(hostId)
  const connId = await ensureConnId(hostId)
  const { bytes } = await sftpWriteContent(connId, path, content)
  return { text: `Wrote ${bytes} bytes to ${path} on the remote host.` }
}

// Terminal co-pilot: run a command IN the visible interactive shell (connId) via
// sshManager.runInShell — the command types + runs LIVE in the user's terminal, and
// its output + exit code are captured back. Distinct from runSshExec (hidden channel).
export async function runSshTerminal(
  connId: string,
  command: string,
): Promise<{ text: string; exitCode: number }> {
  const { output, exitCode } = await sshManager.runInShell(connId, command)
  const clamped = clampForLlm(output.length ? output.split('\n') : [], {
    maxTotalChars: SSH_MAX_TOTAL_CHARS,
    hint: 'redirect the command output to a file or narrow it',
  })
  return { text: `${clamped.text}${clamped.text ? '\n' : ''}[exit code ${exitCode}]`, exitCode }
}

// List configured hosts so the agent can pick a `host` id. No secrets — only
// id / name / user@host:port / folder / tags.
export async function runSshListHosts(): Promise<{ text: string }> {
  const hosts = (await listHosts()).filter((h) => h.agentEnabled !== false)
  if (!hosts.length) {
    return { text: 'No SSH hosts are available to agents. Ask the user to add/enable one.' }
  }
  const lines = hosts.map((h) => {
    const folder = h.folder ? ` (${h.folder})` : ''
    const tags = h.tags?.length ? ` [${h.tags.join(', ')}]` : ''
    return `${h.id}  —  ${h.name || h.host}  ${h.user}@${h.host}:${h.port}${folder}${tags}`
  })
  return { text: lines.join('\n') }
}

export function createSshTools(opts: CreateSshToolsOptions): AgentTool[] {
  const { terminalConnId } = opts

  const listHostsTool: AgentTool<typeof ListHostsParams, Record<string, never>> = {
    name: 'ssh_list_hosts',
    label: 'SSH hosts',
    description:
      'List the SSH hosts the user has configured (id, name, user@host). Call this FIRST to ' +
      'get a host id, then pass it as `host` to the other ssh_* tools.',
    parameters: ListHostsParams,
    executionMode: 'sequential',
    async execute(): Promise<AgentToolResult<Record<string, never>>> {
      const { text } = await runSshListHosts()
      return { content: [{ type: 'text', text }], details: {} }
    },
  }

  const execTool: AgentTool<typeof ExecParams, SshExecDetails> = {
    name: 'ssh_exec',
    label: 'SSH exec',
    description:
      'Run a shell command on a configured SSH host (by `host` id) and capture its stdout, ' +
      'stderr, and exit code. The command runs on the REMOTE machine, not locally.',
    parameters: ExecParams,
    // Sequential: avoid duplicate headless connects + interleaved permission prompts.
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<SshExecDetails>> {
      const { text, exitCode } = await runSshExec(params.host, params.command)
      return { content: [{ type: 'text', text }], details: { command: params.command, exitCode } }
    },
  }

  const listTool: AgentTool<typeof ListParams, SshPathDetails> = {
    name: 'ssh_list_dir',
    label: 'SSH list',
    description: 'List a directory on a configured SSH host (by `host` id).',
    parameters: ListParams,
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<SshPathDetails>> {
      const { text } = await runSshList(params.host, params.path)
      return { content: [{ type: 'text', text }], details: { path: params.path } }
    },
  }

  const readTool: AgentTool<typeof ReadParams, SshPathDetails> = {
    name: 'ssh_read_file',
    label: 'SSH read',
    description: 'Read a file on a configured SSH host (by `host` id, UTF-8 decoded).',
    parameters: ReadParams,
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<SshPathDetails>> {
      const { text } = await runSshRead(params.host, params.path, params.maxBytes)
      return { content: [{ type: 'text', text }], details: { path: params.path } }
    },
  }

  const writeTool: AgentTool<typeof WriteParams, SshPathDetails> = {
    name: 'ssh_write_file',
    label: 'SSH write',
    description:
      'Write UTF-8 text content to a file on a configured SSH host (by `host` id; creates or ' +
      'overwrites the file).',
    parameters: WriteParams,
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<SshPathDetails>> {
      const { text } = await runSshWrite(params.host, params.path, params.content)
      return { content: [{ type: 'text', text }], details: { path: params.path } }
    },
  }

  const tools: AgentTool[] = [
    listHostsTool as AgentTool,
    execTool as AgentTool,
    listTool as AgentTool,
    readTool as AgentTool,
    writeTool as AgentTool,
  ]

  // Co-pilot dock (terminalConnId set): ADD a tool that drives the WATCHED terminal
  // (runInShell) so the user follows along live. Host-fixed to that shell's connId.
  if (terminalConnId) {
    const terminalTool: AgentTool<typeof TerminalParams, SshExecDetails> = {
      name: 'ssh_terminal_run',
      label: 'SSH terminal',
      description:
        'Run a shell command IN the terminal the user is watching (their live SSH shell) — it ' +
        'types and runs LIVE, and you get back its output + exit code. Prefer this over ssh_exec ' +
        'when the user is watching so they can follow along. Runs on the REMOTE machine.',
      parameters: TerminalParams,
      executionMode: 'sequential',
      async execute(_id, params): Promise<AgentToolResult<SshExecDetails>> {
        const { text, exitCode } = await runSshTerminal(terminalConnId, params.command)
        return { content: [{ type: 'text', text }], details: { command: params.command, exitCode } }
      },
    }
    tools.push(terminalTool as AgentTool)
  }

  return tools
}
