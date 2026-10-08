#!/usr/bin/env node
// `awog` — terminal client for the AWOG engine.
//
// Connects to the running app's engine over ~/.awog/engine.sock (ADR 0093) or,
// when the app isn't up, spawns a short-lived engine for the command. Model
// output goes to stdout; all prompts/status go to stderr so `-p` stays
// scriptable.

import { connectEngine, type Engine } from './transport.js'
import { cmdChat, type ChatOptions } from './commands/chat.js'
import { cmdSessionCli, cmdSessionLs, cmdSessionSet } from './commands/session.js'
import { cmdTaskRun, type TaskRunOptions } from './commands/task.js'
import { cmdLogin, type LoginOptions } from './commands/login.js'
import { cmdAccountLs, cmdAccountUse } from './commands/account.js'
import { cmdModelsLs } from './commands/models.js'
import { cmdProjectLs, cmdProjectUse, cmdProjectAdd } from './commands/project.js'
import {
  cmdSourceLs,
  cmdSourceAdd,
  cmdSourceRm,
  cmdSourceToggle,
  cmdSourceTest,
  cmdSourceTools,
  cmdSourceSecret,
  type SourceAddFlags,
} from './commands/source.js'
import { cmdDash } from './commands/dash.js'
import { note, sgr } from './tty.js'

const USAGE = `awog — AWOG terminal client

usage:
  awog                                dashboard (sessions · projects · sources · accounts)
  awog chat [-p "prompt"] [-s <sessionId>] [--cwd <dir>] [--provider anthropic|openai|google]
            [--model <id>] [--mode ask|plan|accept-edits|execute] [--level low|medium|high|extra-high|max]
            [--json] [--spawn]
  awog session ls [--json]
  awog session cli <id> [--json]        print the native resume command
  awog session set <id> [--model m] [--provider p] [--account id] [--level l] [--mode m]
  awog project ls [--json]              list projects (● = CLI default)
  awog project use <id|name|path>       set default project for chat/task
  awog project add <path> [--name n]    register a project
  awog account ls [--json]              list provider accounts
  awog account use <id> [--provider p]  set the global active account
  awog models ls [--provider p] [--json]
  awog source ls [--json]               list sources (mcp/api/local) — alias: mcp
  awog source add <slug> [--stdio --command c --args "a b" --env K=V;K2=V2]
                                      [--url http://… --headers K=V] [--bearer tok]
  awog source rm|on|off|test|tools <slug>
  awog source secret <slug> <KEY> [value]   keychain a secret value
  awog task run <workflow> [--project <id>] [--title t] [--desc d] [--watch] [--approve] [--json]

env:
  AWOG_ENGINE_PATH   engine entry override (dev)
  AWOG_NO_ATTACH     never try the socket — always spawn an engine
`

interface Args {
  positional: string[]
  flags: Record<string, string | true>
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else if (a.startsWith('-') && a.length === 2) {
      const key = a.slice(1)
      const next = argv[i + 1]
      if (next !== undefined) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

function flagStr(flags: Record<string, string | true>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = flags[k]
    if (typeof v === 'string') return v
    if (v === true) return ''
  }
  return undefined
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [cmd, sub, ...rest] = positional

  if (flags.help || flags.h || cmd === 'help') {
    process.stdout.write(USAGE)
    return
  }

  const engine: Engine = await connectEngine({ spawn: flags.spawn === true })
  // Socket connections default to no events; opt in to what we render.
  engine.subscribe(['session.', 'task.'])

  // `awog` bare → dashboard (claude-style entry point).
  if (cmd === undefined) {
    await cmdDash(engine)
    return
  }

  try {
    if (cmd === 'chat') {
      const opts: ChatOptions = {
        ...(flags.p !== undefined ? { print: flagStr(flags, 'p') ?? '' } : {}),
        ...(flags.s !== undefined && flags.s !== true ? { sessionId: flagStr(flags, 's') } : {}),
        ...(flags.cwd !== undefined ? { cwd: flagStr(flags, 'cwd') } : {}),
        ...(flags.project !== undefined && flags.project !== true
          ? { project: flagStr(flags, 'project') }
          : {}),
        ...(flags.provider !== undefined
          ? { provider: flagStr(flags, 'provider') as ChatOptions['provider'] }
          : {}),
        ...(flags.model !== undefined ? { model: flagStr(flags, 'model') } : {}),
        ...(flags.account !== undefined ? { accountId: flagStr(flags, 'account') } : {}),
        ...(flags.mode !== undefined
          ? { mode: flagStr(flags, 'mode') as ChatOptions['mode'] }
          : {}),
        ...(flags.level !== undefined ? { level: flagStr(flags, 'level') } : {}),
        json: flags.json === true,
      }
      await cmdChat(engine, opts)
      return // chat keeps the process alive via the REPL
    }

    if (cmd === 'session') {
      if (sub === 'ls') {
        await cmdSessionLs(engine, flags.json === true)
      } else if (sub === 'cli' && rest[0]) {
        await cmdSessionCli(engine, rest[0], flags.json === true)
      } else if (sub === 'set' && rest[0]) {
        await cmdSessionSet(engine, rest[0], flags)
      } else {
        process.stdout.write(USAGE)
        process.exitCode = 1
      }
      return
    }

    if (cmd === 'account') {
      if (sub === 'ls') {
        await cmdAccountLs(engine, flags.json === true)
      } else if (sub === 'use' && rest[0]) {
        await cmdAccountUse(engine, rest[0], flagStr(flags, 'provider'))
      } else {
        process.stdout.write(USAGE)
        process.exitCode = 1
      }
      return
    }

    if (cmd === 'models' && sub === 'ls') {
      await cmdModelsLs(engine, flagStr(flags, 'provider'), flags.json === true)
      return
    }

    if (cmd === 'project') {
      if (sub === 'ls') await cmdProjectLs(engine, flags.json === true)
      else if (sub === 'use' && rest[0]) await cmdProjectUse(engine, rest[0])
      else if (sub === 'add' && rest[0]) {
        await cmdProjectAdd(engine, rest[0], flagStr(flags, 'name'))
      } else {
        process.stdout.write(USAGE)
        process.exitCode = 1
      }
      return
    }

    if (cmd === 'source' || cmd === 'mcp') {
      if (sub === 'ls') {
        await cmdSourceLs(engine, flags.json === true)
      } else if (sub === 'add' && rest[0]) {
        const sf: SourceAddFlags = {
          ...(flagStr(flags, 'type') !== undefined ? { type: flagStr(flags, 'type') } : {}),
          stdio: flags.stdio === true,
          ...(flagStr(flags, 'url') !== undefined ? { url: flagStr(flags, 'url') } : {}),
          ...(flagStr(flags, 'command') !== undefined
            ? { command: flagStr(flags, 'command') }
            : {}),
          ...(flagStr(flags, 'args') !== undefined ? { args: flagStr(flags, 'args') } : {}),
          ...(flagStr(flags, 'cwd') !== undefined ? { cwd: flagStr(flags, 'cwd') } : {}),
          ...(flagStr(flags, 'env') !== undefined ? { env: flagStr(flags, 'env') } : {}),
          ...(flagStr(flags, 'headers') !== undefined
            ? { headers: flagStr(flags, 'headers') }
            : {}),
          ...(flagStr(flags, 'bearer') !== undefined
            ? { bearer: flagStr(flags, 'bearer') }
            : {}),
          ...(flagStr(flags, 'base-url') !== undefined
            ? { baseUrl: flagStr(flags, 'base-url') }
            : {}),
          ...(flagStr(flags, 'path') !== undefined ? { path: flagStr(flags, 'path') } : {}),
          ...(flagStr(flags, 'name') !== undefined ? { name: flagStr(flags, 'name') } : {}),
          ...(flagStr(flags, 'trust') !== undefined ? { trust: flagStr(flags, 'trust') } : {}),
        }
        await cmdSourceAdd(engine, rest[0], sf)
      } else if ((sub === 'rm' || sub === 'delete') && rest[0]) {
        await cmdSourceRm(engine, rest[0])
      } else if (sub === 'on' && rest[0]) {
        await cmdSourceToggle(engine, rest[0], true)
      } else if (sub === 'off' && rest[0]) {
        await cmdSourceToggle(engine, rest[0], false)
      } else if (sub === 'test' && rest[0]) {
        await cmdSourceTest(engine, rest[0])
      } else if (sub === 'tools' && rest[0]) {
        await cmdSourceTools(engine, rest[0])
      } else if (sub === 'secret' && rest[0] && rest[1]) {
        await cmdSourceSecret(engine, rest[0], rest[1], rest[2])
      } else {
        process.stdout.write(USAGE)
        process.exitCode = 1
      }
      return
    }


    if (cmd === 'task' && sub === 'run' && rest[0]) {
      const opts: TaskRunOptions = {
        workflow: rest[0],
        ...(flags.project !== undefined && flags.project !== true
          ? { project: flagStr(flags, 'project') }
          : {}),
        ...(flags.title !== undefined ? { title: flagStr(flags, 'title') } : {}),
        ...(flags.desc !== undefined ? { description: flagStr(flags, 'desc') } : {}),
        watch: flags.watch === true,
        approve: flags.approve === true,
        json: flags.json === true,
      }
      await cmdTaskRun(engine, opts)
      return
    }

    if (cmd === 'login') {
      const opts: LoginOptions = {
        ...(flags.provider !== undefined
          ? { provider: flagStr(flags, 'provider') as LoginOptions['provider'] }
          : {}),
        ...(flags['api-key'] !== undefined ? { apiKey: flagStr(flags, 'api-key') } : {}),
        ...(flags.label !== undefined ? { label: flagStr(flags, 'label') } : {}),
        ...(flags['base-url'] !== undefined ? { baseURL: flagStr(flags, 'base-url') } : {}),
      }
      await cmdLogin(engine, opts)
      return
    }

    process.stdout.write(USAGE)
    process.exitCode = 1
  } finally {
    // One-shot commands close the engine; chat returns early to keep the REPL.
    if (cmd !== 'chat' || flags.p !== undefined) await engine.close()
  }
}

// `awog x | head -3`: head closes the pipe early; Node 22 throws EPIPE on the
// next stdout.write instead of SIGPIPE-killing silently. Swallow it — exit 0.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

main().catch(async (err: unknown) => {
  note(`${sgr.err('✗')} ${sgr.dim(err instanceof Error ? err.message : String(err))}`)
  process.exitCode = 1
})
