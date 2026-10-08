// `awog chat` — interactive REPL + one-shot `-p` print mode over the engine.
// Streams session.chunk to stdout; permissions/questions go through the TTY
// prompt on stderr (the same parked-request contract the Electron UI uses).

import { randomBytes } from 'node:crypto'
import type { Engine } from '../transport.js'
import { askChoice, askPermission, askText, createRepl, createReplyRenderer, detailBody, isTTY, note, renderStepCard, sgr } from '../tty.js'
import { listProjects, resolveDefaultProject, type Project } from './project.js'
type Provider = 'anthropic' | 'openai' | 'google'


const THINKING_LEVELS = ['low', 'medium', 'high', 'extra-high', 'max'] as const
const MODES = ['ask', 'accept-edits', 'plan', 'execute'] as const
interface SessionSettings {
  provider: Provider
  modelId: string
  level: string
  mode: 'ask' | 'accept-edits' | 'plan' | 'execute'
  accountId?: string | undefined
}

interface SessionSummary {
  id: string
  title?: string | undefined
  updatedAt?: string
  archived?: boolean
}

interface SendMessageResult {
  text?: string
  stopReason?: string
  modelUsed?: string
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number }
}

interface SessionQuestion {
  header: string
  question: string
  options: Array<{ label: string; description?: string }>
  multiSelect: boolean
  kind?: 'choice' | 'text' | 'number'
}

interface PermissionRequest {
  requestId: string
  toolName?: string
  input?: unknown
  promptSentence?: string
  displayName?: string
}

export interface ChatOptions {
  print?: string | undefined
  sessionId?: string | undefined
  cwd?: string | undefined
  /** project id/name/path — defaults come from cli-state/AWOG_PROJECT. */
  project?: string | undefined
  provider?: Provider | undefined
  model?: string | undefined
  accountId?: string | undefined
  mode?: SessionSettings['mode'] | undefined
  level?: string | undefined
  json?: boolean // --json: NDJSON events instead of human stream
}

function newId(prefix: string): string {
  return `${prefix}${randomBytes(6).toString('hex')}`
}

async function resolveSettings(engine: Engine, o: ChatOptions): Promise<SessionSettings> {
  // Defaults: engine account selection + first catalog model. Flags override.
  let provider: Provider = o.provider ?? 'anthropic'
  let accountId = o.accountId
  if (!accountId) {
    try {
      const accounts = await engine.rpc<{
        providers?: Record<string, { activeAccountId?: string; accounts?: Array<{ id: string }> }>
      }>('accounts.list')
      const bucket = accounts.providers?.[provider]
      accountId = bucket?.activeAccountId ?? bucket?.accounts?.[0]?.id
    } catch {
      /* anonymous run — engine will error clearly if it needs an account */
    }
  }
  let modelId = o.model
  if (!modelId) {
    try {
      const models = await engine.rpc<{ models?: Array<{ id: string }> }>('models.list', {
        provider,
      })
      modelId = models.models?.[0]?.id ?? 'claude-sonnet-4-5'
    } catch {
      modelId = 'claude-sonnet-4-5'
    }
  }
  return {
    provider,
    modelId,
    level: o.level ?? 'medium',
    mode: o.mode ?? 'ask',
    ...(accountId ? { accountId } : {}),
  }
}

async function ensureSession(
  engine: Engine,
  o: ChatOptions,
  settings: SessionSettings,
  project: Project | null,
): Promise<string> {
  if (o.sessionId) return o.sessionId
  const now = new Date().toISOString()
  const id = newId('ses-')
  const title = o.print
    ? o.print.slice(0, 60)
    : `CLI ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
  await engine.rpc('sessions.upsert', {
    mode: 'create',
    session: {
      id,
      title,
      projectId: project?.id ?? null,
      createdAt: now,
      updatedAt: now,
      invitedAgentIds: [],
      pendingAgentIds: [],
      messages: [],
      settings: {
        provider: settings.provider,
        modelId: settings.modelId,
        level: settings.level,
        mode: settings.mode,
        ...(settings.accountId ? { accountId: settings.accountId } : {}),
      },
    },
  })
  return id
}

async function runTurn(
  engine: Engine,
  o: ChatOptions,
  sessionId: string,
  settings: SessionSettings,
  text: string,
  workspacePath: string | undefined,
): Promise<SendMessageResult> {
  const messageId = newId('msg_u_')
  const { promise: done, resolve: resolveDone } = Promise.withResolvers<SendMessageResult>()
  const reply = createReplyRenderer()
  const printedSteps = new Set<string>()
  // Stream + interactive gates scoped to this turn.
  const off = engine.onEvent(async (evt) => {
    const p =
      evt.payload && typeof evt.payload === 'object'
        ? (evt.payload as Record<string, unknown>)
        : {}
    if (p.sessionId !== sessionId && p.messageId !== messageId) return

    if (evt.type === 'session.chunk') {
      const delta = typeof p.delta === 'string' ? p.delta : ''
      if (o.json) {
        process.stdout.write(`${JSON.stringify({ t: 'chunk', delta })}\n`)
      } else {
        reply.push(delta)
      }
    } else if (evt.type === 'session.step') {
      const step = p.step && typeof p.step === 'object' ? (p.step as Record<string, unknown>) : {}
      if (step.kind === 'question' && step.status === 'running' && Array.isArray(step.questions)) {
        const answers: Array<{ header: string; selected: string[] }> = []
        for (const q of step.questions as SessionQuestion[]) {
          if (q.kind === 'text' || q.kind === 'number') {
            const v = await askText(q.header, q.question)
            answers.push({ header: q.header, selected: v ? [v] : [] })
          } else {
            const picked = await askChoice(q.header, q.question, q.options, q.multiSelect)
            answers.push({ header: q.header, selected: picked })
          }
        }
        await engine.rpc('sessions.answerQuestion', {
          requestId: step.id,
          answers,
        }).catch(() => {})
      } else if (o.json) {
        process.stdout.write(`${JSON.stringify({ t: 'step', step })}\n`)
      } else {
        const label = typeof step.label === 'string' ? step.label : ''
        const st = typeof step.status === 'string' ? step.status : ''
        const nested = typeof step.parentId === 'string'
        const stepId = typeof step.id === 'string' ? step.id : ''

        // thinking/note steps re-emit their ACCUMULATED text on every chunk —
        // render once at 'done', tracked by step.id, not per event.
        if (step.kind === 'thinking' || step.kind === 'note') {
          if (st !== 'done' && st !== 'error') return
          if (printedSteps.has(stepId)) return
          printedSteps.add(stepId)
          const thinking =
            step.detail && typeof step.detail === 'object'
              ? ((step.detail as { content?: string }).content ?? label)
              : label
          note(
            renderStepCard({
              icon: sgr.dim('💭'),
              title: step.kind === 'thinking' ? 'Thinking' : label,
              ...(thinking
                ? { body: thinking.split('\n').slice(0, 14).map((l) => sgr.dim(l)) }
                : {}),
            }),
          )
          return
        }

        const title = `${nested ? '└ ' : ''}${label}`
        if (st === 'running') {
          // Thin one-liner while the tool is busy — the done card replaces it
          // visually (no box chrome for a transient state).
          note(`  ${sgr.dim('⠿')} ${sgr.dim(title)}`)
          return
        }
        const icon = st === 'done' ? sgr.ok('✓') : sgr.err('✗')
        const { body, meta } = detailBody(step.detail)
        const additions = typeof step.additions === 'number' ? step.additions : 0
        const deletions = typeof step.deletions === 'number' ? step.deletions : 0
        const stat = additions || deletions ? `+${additions} −${deletions}` : meta
        note(
          renderStepCard({
            icon,
            title,
            ...(stat ? { meta: stat } : {}),
            ...(body ? { body } : {}),
          }),
        )
      }
    } else if (evt.type === 'session.permission-request') {
      const req = p as unknown as PermissionRequest
      const tool = req.displayName ?? req.toolName ?? 'tool'
      const detail =
        req.promptSentence ?? JSON.stringify(req.input ?? {}).slice(0, 200)
      const decision = await askPermission(tool, detail)
      await engine
        .rpc('sessions.permission', {
          requestId: req.requestId,
          decision: decision === 'always' ? 'allow' : decision,
          ...(decision === 'always' ? { alwaysAllow: true, scope: 'session' } : {}),
        })
        .catch(() => {})
    } else if (evt.type === 'session.message.done') {
      resolveDone(p as unknown as SendMessageResult)
    }
  })

  // The RPC resolves with the same result as message.done — race them so a
  // dropped event can't hang the CLI.
  const rpcResult = engine.rpc<SendMessageResult>('sessions.sendMessage', {
    sessionId,
    messageId,
    text,
    history: [],
    settings,
    ...(workspacePath ? { workspacePath } : {}),
  })
  rpcResult.then(resolveDone).catch(() => {})
  const result = await Promise.race([
    done,
    rpcResult.catch((err) => ({ stopReason: 'error', text: '', error: String(err) })),
  ])
  off()
  reply.flush()
  return result as SendMessageResult
}

export async function cmdChat(engine: Engine, o: ChatOptions): Promise<void> {
  const project = await resolveDefaultProject(engine, o.project)
  const settings = await resolveSettings(engine, o)
  const sessionId = await ensureSession(engine, o, settings, project)
  // --cwd wins; else the resolved project's path is the session workspace.
  const workspacePath = o.cwd ?? project?.path
  note(
    `${sgr.accent('·')} ${sgr.dim(engine.attached ? 'attached to running engine' : 'spawned engine')}`,
  )
  note(
    `${sgr.accent('·')} session ${sgr.bold(sessionId)} — ${sgr.dim(
      `${settings.provider}/${settings.modelId} (${settings.mode})`,
    )}`,
  )

  if (o.print !== undefined) {
    const r = await runTurn(engine, o, sessionId, settings, o.print, workspacePath)
    if (!o.json) process.stdout.write('\n')
    const cost = r.usage?.cost_usd
    note(
      `${sgr.accent('·')} ${sgr.dim(
        `${r.stopReason ?? 'done'}${r.modelUsed ? ` — ${r.modelUsed}` : ''}${
          typeof cost === 'number' ? ` — $${cost.toFixed(4)}` : ''
        }`,
      )}`,
    )
    return
  }

  if (!isTTY()) {
    note('interactive chat needs a TTY — use `awog chat -p "prompt"`')
    return
  }
  note(sgr.dim('type a message; ctrl-c twice or /quit to exit'))
  note(sgr.dim('slash: /model /account /level /mode /status'))
  createRepl(
    (line) => {
      if (line.startsWith('/')) {
        void handleSlash(engine, sessionId, settings, line)
          .then((handled) => {
            if (!handled) note(`${sgr.err('·')} unknown command: ${line.split(/\s+/)[0]}`)
          })
          .catch((err) => note(`${sgr.err('·')} ${err instanceof Error ? err.message : String(err)}`))
        return
      }
      void runTurn(engine, o, sessionId, settings, line, workspacePath).then((r) => {
        if (!o.json) process.stdout.write('\n')
        note(`${sgr.accent('·')} ${sgr.dim(r.stopReason ?? 'done')}`)
      })
    },
    () => process.exit(0),
  )
  // Keep process alive: the REPL holds stdin open.
}

// Slash commands inside the REPL — mutate THIS session's llmOverride (persisted
// on the header; wins over agent pin, applied to the NEXT turn) or the global
// active account. Returns true when the line was a command the REPL consumed.
async function handleSlash(
  engine: Engine,
  sessionId: string,
  settings: SessionSettings,
  line: string,
): Promise<boolean> {
  const [cmd, ...args] = line.split(/\s+/)
  const arg = args.join(' ').trim()

  const setOverride = async (
    patch: Partial<
      Pick<SessionSettings, 'provider' | 'modelId' | 'accountId' | 'level' | 'mode'>
    >,
    label: string,
  ) => {
    const override: Record<string, string> = {}
    if (patch.provider) override.provider = patch.provider
    if (patch.modelId) override.modelId = patch.modelId
    if (patch.accountId) override.accountId = patch.accountId
    if (patch.level) override.level = patch.level
    if (patch.mode) override.mode = patch.mode
    await engine.rpc('sessions.setLlmOverride', { id: sessionId, override })
    Object.assign(settings, patch)
    note(`· ${label}`)
  }

  switch (cmd) {
    case '/model': {
      if (!arg) {
        const res = await engine.rpc<{ models?: Array<{ id: string }> }>('models.list', {
          provider: settings.provider,
        })
        const ids = (res.models ?? []).map((m) => m.id)
        note(`· models for ${settings.provider}: ${ids.join(', ')}`)
        return true
      }
      await setOverride({ modelId: arg }, `model → ${arg}`)
      return true
    }
    case '/level': {
      if (!arg || !(THINKING_LEVELS as readonly string[]).includes(arg)) {
        note(`· levels: ${THINKING_LEVELS.join(', ')}`)
        return true
      }
      await setOverride({ level: arg }, `level → ${arg}`)
      return true
    }
    case '/mode': {
      if (!arg || !(MODES as readonly string[]).includes(arg)) {
        note(`· modes: ${MODES.join(', ')}`)
        return true
      }
      await setOverride({ mode: arg as SessionSettings['mode'] }, `mode → ${arg}`)
      return true
    }
    case '/account': {
      if (!arg) {
        const res = await engine.rpc<{
          providers?: Record<
            string,
            {
              activeAccountId?: string | null
              accounts?: Array<{ id: string; label?: string }>
            }
          >
        }>('accounts.list')
        for (const [p, b] of Object.entries(res.providers ?? {})) {
          for (const a of b.accounts ?? []) {
            const mark = a.id === b.activeAccountId ? '*' : ' '
            note(`  ${mark} ${p}  ${a.id}  ${a.label ?? ''}`)
          }
        }
        return true
      }
      await setOverride({ accountId: arg }, `account → ${arg} (this session)`)
      return true
    }
    case '/status': {
      note(
        `· ${settings.provider}/${settings.modelId} · ${settings.mode} · ${settings.level}` +
          (settings.accountId ? ` · ${settings.accountId}` : ''),
      )
      return true
    }
    case '/project': {
      const projects = await listProjects(engine)
      for (const p of projects) {
        note(`  ${sgr.dim('·')} ${sgr.bold(p.id)}  ${sgr.dim(p.name ?? '')}  ${sgr.dim(p.path ?? '')}`)
      }
      note(sgr.dim('  switch project for the NEXT session: /quit then awog project use <id>'))
      return true
    }
    case '/quit':
    case '/exit':
      process.exit(0)
      return true
    default:
      return false
  }
}
