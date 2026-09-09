import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import { register, RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { resolveClaudeBinary } from '../runtime/claude-sdk/binary.js'
import { log } from '../util/logger.js'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

// The Claude Code CLI's OWN slash-command catalogue, for the composer's `/` menu
// (Claude SDK branch only — the Pi runtime has no such surface).
//
// Why an RPC at all: the list lives inside the CLI, not on disk. It is the union of
// its built-in commands (/goal, /context, /usage, /recap, /security-review…) and the
// skills it discovers for a given cwd, and the SDK hands it over through one control
// request — `Query.supportedCommands()`. That request needs a live CLI, so we open a
// throwaway query whose input stream never yields a turn: no model call, no tokens,
// ~0.5s, and no credential (measured — the control request answers even on an expired
// login). The turn itself, when the user picks a command, runs on the normal session
// path with the raw `/name args` text passed through verbatim (RunNonStreamArgs.
// nativeCommand → runtime/claude-sdk/run-stream.ts).
//
// NOT cached here: the caller (ui-next useComposerData) caches per project and drops
// its cache on the skills/commands fs-changed events, which is exactly when this list
// changes. A second cache would only make a stale one harder to see.
const Params = z.object({
  projectId: z.string().optional(),
  // Session's dragged working folder — same precedence as sessions.sendMessage
  // (workspacePath wins over the project path) so the list matches the cwd the
  // turn will actually run in.
  workspacePath: z.string().max(4096).optional(),
})

// A hung CLI must not hold the RPC open forever: the menu can live without this
// section, so bound the wait and fail.
const PROBE_TIMEOUT_MS = 15_000

async function resolveCwd(params: z.infer<typeof Params>): Promise<string | undefined> {
  if (params.workspacePath) {
    try {
      if (isAbsolute(params.workspacePath) && (await stat(params.workspacePath)).isDirectory()) {
        return params.workspacePath
      }
    } catch {
      // Stale / removed folder → fall through to the project path.
    }
  }
  if (params.projectId) {
    try {
      const project = await loadProject(params.projectId)
      if (project?.path) return project.path
    } catch {
      // Stale projectId → probe in the sidecar's own cwd (the session's fallback too).
    }
  }
  return undefined
}

register('sessions.cliCommands', async (raw) => {
  const params = Params.parse(raw)
  const cwd = await resolveCwd(params)
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const bin = resolveClaudeBinary()

  // Input stream that opens the session and then just waits: `supportedCommands()`
  // is answered from the CLI's init state, so nothing is ever sent.
  let release = (): void => {}
  const closed = new Promise<void>((resolve) => {
    release = resolve
  })
  const stream = (async function* (): AsyncGenerator<SDKUserMessage> {
    await closed
  })()

  const q = query({
    prompt: stream,
    options: {
      ...(cwd ? { cwd } : {}),
      // Same sources the turn runs with (tuning.ts) → the same skills resolve.
      settingSources: ['user', 'project', 'local'],
      ...(bin ? { pathToClaudeCodeExecutable: bin } : {}),
    },
  })

  try {
    const commands = await Promise.race([
      q.supportedCommands(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timed out')), PROBE_TIMEOUT_MS),
      ),
    ])
    return {
      commands: commands.map((c) => ({
        name: c.name,
        description: c.description,
        argumentHint: c.argumentHint,
        ...(c.aliases?.length ? { aliases: c.aliases } : {}),
      })),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn('cli slash-command probe failed', { cwd, err: message })
    throw new RpcError(-32021, `cli command list failed: ${message}`)
  } finally {
    // Close the input stream (CLI sees stdin EOF) and tear the query down so the
    // throwaway process cannot outlive the RPC.
    release()
    await q.return(undefined).catch(() => {})
  }
})
