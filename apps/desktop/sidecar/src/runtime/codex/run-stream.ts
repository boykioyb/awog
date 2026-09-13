// Codex `app-server` chat runtime (ADR 0087).
//
// The third backend behind sessions/runner.ts's dispatch, serving OpenAI
// accounts. Shape of a turn:
//
//   ensureCodexHome(account)       → an isolated CODEX_HOME, never the user's
//   getCodexDaemon(home)           → one daemon per account, N threads
//   thread/start | thread/resume   → one thread per AWOG session
//   turn/start                     → the turn; events arrive as notifications
//   turn/completed                 → the turn is over
//
// What AWOG keeps: the permission gate, the tool set, the context blocks, the
// step timeline, usage accounting. What Codex owns: the agent loop, the shell
// and file tools with their sandbox, compaction inside a thread, and history.
//
// What this path does NOT do, deliberately:
//   - `/compact` never arrives here (runner routes it to Pi — ADR 0047 keeps
//     compaction provider-agnostic, and its checkpoint is AWOG's own).
//   - a custom OpenAI-compatible endpoint (account.baseURL) stays on Pi: Codex
//     speaks the Responses API to its own provider table, so pointing it at a
//     chat/completions gateway would break the turn rather than translate it.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcError } from '../../transport/rpc.js'
import { redactString } from '../../sessions/redact.js'
import { log } from '../../util/logger.js'
import type { RunNonStreamArgs, RunStreamResult, StreamCallbacks } from '../../sessions/runner.js'
import type {
  ContextChars,
  SessionAttachment,
  SessionQuestion,
  SessionStep,
  ThinkingLevel,
} from '../../types/shared.js'
import { resolveCredential } from '../../credentials/credential-resolver.js'
import { buildChatToolset } from '../chat-toolset.js'
import { renderHistoryPrefix } from '../history-prefix.js'
import { makeBeforeToolCall, withTurnBudget } from '../permission.js'
import { buildRulesPrompt, extractTurnPaths } from '../../rules/inject.js'
import { buildStylePrompt } from '../../style/styles.js'
import { buildMcpUnavailableNote } from '../tools/mcp-tools.js'
import {
  buildCurrentStateBlock,
  buildEnvironmentBlock,
  collectWorkspaceSnapshot,
} from '../../context/environment.js'
import {
  EVIDENCE_PROMPT,
  OUTPUT_SURFACE_PROMPT,
  SCRATCH_DIR_PROMPT,
  VERIFY_PROMPT,
  fileRefPrompt,
} from '../prompts.js'
import { CO_AUTHOR_INSTRUCTION } from '../../git/co-author.js'
import { ensureCodexHome } from './home.js'
import { getCodexDaemon, type CodexDaemon } from './app-server.js'
import { createToolDispatch, toDynamicToolSpecs, toolSetSignature } from './dynamic-tools.js'
import { createCodexEventAdapter, type CodexTurnOutcome } from './event-adapter.js'
import { createEventAdapter as createPiEventAdapter } from '../event-adapter.js'
import type {
  CodexAskForApproval,
  CodexModelInfo,
  CodexCommandApprovalParams,
  CodexDynamicToolCallParams,
  CodexFileChangeApprovalParams,
  CodexReasoningEffort,
  CodexSandboxMode,
  CodexThreadResponse,
  CodexUserInput,
  CodexUserInputParams,
} from './protocol.js'

const SIDECAR_VERSION = process.env.npm_package_version ?? '0.0.0'

// Steering (ADR 0087 F3) is native here: `turn/steer` takes the id of the turn
// it must apply to and fails loudly when that turn is no longer steerable. The
// queue is drained on a timer because AWOG's steer RPC lands out-of-band —
// 700ms is well under human typing latency and costs one map lookup when empty.
const STEER_POLL_MS = 700

// AWOG's thinking level → Codex reasoning effort.
//
// `extra-high` → `xhigh` and `max` → `max`, NOT `high`/`ultra`: both are
// first-class efforts here, and `ultra` is not simply "more" — the server calls
// it "maximum reasoning with automatic task delegation", so picking it for
// AWOG's `max` would turn on multi-agent behaviour the user never asked for.
export function effortFrom(level: ThinkingLevel): CodexReasoningEffort {
  switch (level) {
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'extra-high':
      return 'xhigh'
    case 'max':
      return 'max'
    default:
      return 'medium'
  }
}

// Efforts a model accepts vary per model — measured: gpt-6-astra takes all six,
// gpt-5.5 stops at `xhigh`. Sending one it does not take is a turn that fails on
// a setting the user picked from a dropdown, so clamp DOWN the ladder to the
// nearest supported rung instead. `model/list` is a local RPC (3-45ms) and the
// catalogue is fixed for the daemon's life, so it is fetched once per daemon.
const EFFORT_LADDER: CodexReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const modelCatalogs = new WeakMap<CodexDaemon, Promise<CodexModelInfo[]>>()

async function clampEffort(
  daemon: CodexDaemon,
  modelId: string,
  wanted: CodexReasoningEffort,
): Promise<CodexReasoningEffort | undefined> {
  let catalog = modelCatalogs.get(daemon)
  if (!catalog) {
    catalog = daemon
      .request('model/list', {})
      .then((res) => ((res as { data?: CodexModelInfo[] }).data ?? []))
      // A catalogue we cannot read must not cost the user their turn: fall back
      // to sending what they picked and let the server decide.
      .catch(() => [])
    modelCatalogs.set(daemon, catalog)
  }
  const model = (await catalog).find((m) => m.id === modelId)
  const supported = model?.supportedReasoningEfforts?.map((e) => e.reasoningEffort)
  if (!supported || supported.length === 0) return wanted
  if (supported.includes(wanted)) return wanted
  // Walk down from the requested rung; if nothing below is offered either, use
  // the model's own default rather than guessing.
  for (let i = EFFORT_LADDER.indexOf(wanted) - 1; i >= 0; i -= 1) {
    const rung = EFFORT_LADDER[i]
    if (rung && supported.includes(rung)) return rung
  }
  return model?.defaultReasoningEffort ?? undefined
}

// AWOG's permission mode → what Codex should stop and ask about.
//
// `never` is NOT "no gate": AWOG's own gate still runs on every bridged tool,
// and in execute/auto-approve mode the user has already said they do not want
// to be asked. `on-request` everywhere else routes shell and file approvals
// back to us as server requests, which is where the user's existing
// `Bash(git status)` rules get applied.
function approvalPolicyFor(args: RunNonStreamArgs): CodexAskForApproval {
  if (args.autoApprove || args.settings.mode === 'execute') return 'never'
  return 'on-request'
}

// Plan mode is read-only by definition (permission.ts blocks writes and exec on
// the bridged side), so the sandbox has to say the same thing on the native
// side — otherwise Codex's own shell would happily write while AWOG's Bash is
// blocked, and "plan mode" would be a half-truth.
function sandboxFor(args: RunNonStreamArgs): CodexSandboxMode {
  return args.settings.mode === 'plan' ? 'read-only' : 'workspace-write'
}

function mapErrorToRpc(err: unknown): RpcError {
  if (err instanceof RpcError) return err
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (lower.includes('abort') || lower.includes('cancel')) return new RpcError(-32023, 'CANCELED')
  if (lower.includes('unauthor') || /\b401\b/.test(lower) || lower.includes('authentication')) {
    return new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
  }
  if (lower.includes('rate limit') || /\b429\b/.test(lower)) {
    return new RpcError(-32022, 'Rate limited by the provider. Quota exhausted — wait a few minutes.')
  }
  return new RpcError(-32021, `chat failed: ${message}`)
}

// Image attachments: Codex takes a PATH (`localImage`), AWOG carries base64 for
// anything pasted rather than dropped. Materialise those into a per-turn temp
// dir and delete it when the turn ends — writing them into the workspace would
// put model input into the user's repo.
async function buildTurnInput(
  text: string,
  attachments: SessionAttachment[] | undefined,
): Promise<{ input: CodexUserInput[]; cleanup: () => Promise<void> }> {
  const input: CodexUserInput[] = [{ type: 'text', text, text_elements: [] }]
  const images = (attachments ?? []).filter((a) => a.type === 'image')
  if (images.length === 0) return { input, cleanup: async () => {} }

  let dir: string | undefined
  for (const img of images) {
    if (img.path) {
      input.push({ type: 'localImage', path: img.path })
      continue
    }
    const base64 = img.url?.includes(',') ? img.url.slice(img.url.indexOf(',') + 1) : undefined
    if (!base64) continue
    try {
      dir ??= await mkdtemp(join(tmpdir(), 'awog-codex-'))
      const file = join(dir, img.name || `${img.id}.png`)
      await writeFile(file, Buffer.from(base64, 'base64'))
      input.push({ type: 'localImage', path: file })
    } catch (err) {
      // One unreadable attachment must not cost the user their message.
      log.warn('codex: could not materialise an image attachment', {
        name: img.name,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return {
    input,
    cleanup: async () => {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

export async function runStreamCodex(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
): Promise<RunStreamResult> {
  const { account, cred } = await resolveCredential('openai', args.settings.accountId)
  if (cred.kind !== 'apikey') {
    throw new RpcError(-32011, 'openai accounts must connect with an API key or ChatGPT login')
  }

  const home = await ensureCodexHome({
    accountId: account.id,
    secret: cred.apiKey,
    // `cred.codex` marks the ChatGPT-subscription bearer resolved through pi's
    // OAuth flow; a plain key is a platform API key. Codex installs them with
    // different login flags, and getting it wrong logs in as the wrong kind.
    kind: cred.codex ? 'access-token' : 'api-key',
  })
  const daemon = await getCodexDaemon(home, SIDECAR_VERSION)

  const inPlanMode = args.settings.mode === 'plan'

  // ── Gate ──────────────────────────────────────────────────────────────────
  // Built before the toolset because the subagent tool takes it: a depth-1
  // subagent runs under the PARENT turn's permissions, so an ask-mode session
  // still prompts for its writes.
  const startedAtMs = Date.now()
  const gate = withTurnBudget(
    makeBeforeToolCall(
      args.canUseTool,
      args.settings.mode,
      args.sessionId,
      args.autoApprove === true,
      {
        ...(args.promptSourceIds ? { promptSourceIds: args.promptSourceIds } : {}),
        ...(args.sourceToolPatterns ? { toolPatterns: args.sourceToolPatterns } : {}),
      },
      args.settings.sshApprovalMode ?? 'prompt',
      args.cwd,
      // Ngữ cảnh hạ tầng của phiên (ADR 0088 §5b) — cột ma trận và nội dung prompt
      // duyệt đều lấy từ đây; vắng nó là cổng quyền tính nhầm sang tài khoản thường.
      args.settings.infra || args.settings.infraFloor
        ? {
            ...(args.settings.infra ? { context: args.settings.infra } : {}),
            ...(args.settings.infraFloor ? { sessionFloor: args.settings.infraFloor } : {}),
          }
        : undefined,
    ),
    args.budget,
    startedAtMs,
  )
  const signal = args.abortController?.signal ?? new AbortController().signal

  const { tools, failures: mcpFailures, mcpCatalog, subagents } = await buildChatToolset(args, {
    inPlanMode,
    beforeToolCall: gate,
    // A subagent always runs its OWN Pi loop regardless of the parent runtime, so
    // its nested steps come through the Pi event adapter here too.
    makeChildSink: (parentToolCallId) => {
      const child = createPiEventAdapter(cb, { parentId: parentToolCallId })
      return { emit: child.handle, text: () => child.result().text }
    },
  })
  const specs = toDynamicToolSpecs(tools)
  const signature = toolSetSignature(specs)

  // ── Instructions ──────────────────────────────────────────────────────────
  // `developerInstructions`, never `baseInstructions`: the latter REPLACES the
  // harness's own prompt, and that prompt is the reason for being here at all
  // (ADR 0058's finding that a self-written loop is where confabulation comes
  // from). So the blocks below are only what Codex cannot know — AWOG's
  // environment, the user's rules and style, and the corrections that apply to
  // any first-party harness (ADR 0071: on a preset path AWOG adds VERIFY and
  // EVIDENCE, not a second ENGINEERING/COMMUNICATION body).
  const workspaceSnapshot = await collectWorkspaceSnapshot(args.cwd)
  const rulesPrompt = await buildRulesPrompt(args.projectId, extractTurnPaths(args.pendingText))
  const stylePrompt = buildStylePrompt(
    args.settings.responseStyle,
    args.settings.responseStyleNoMarkdown,
    args.projectId,
  )
  const instructionParts = [
    buildEnvironmentBlock(args.cwd, workspaceSnapshot),
    args.systemPrompt,
    args.systemPromptAppend,
    rulesPrompt,
    EVIDENCE_PROMPT,
    // ADR 0077: the transcript is markdown in a resizable GUI panel, not a
    // terminal. This is a correction to an assumption every CLI harness makes,
    // so it belongs on this path exactly as much as on the Claude SDK one.
    OUTPUT_SURFACE_PROMPT,
    stylePrompt,
    VERIFY_PROMPT,
    SCRATCH_DIR_PROMPT,
    args.commitCoAuthor === false ? undefined : CO_AUTHOR_INSTRUCTION,
    fileRefPrompt(args.cwd),
    buildMcpUnavailableNote(mcpFailures),
    mcpCatalog,
    args.sessionChecklist,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const developerInstructions = instructionParts.join('\n\n')

  // ── Turn prompt ───────────────────────────────────────────────────────────
  let promptText = args.pendingText
  // A thread we are about to START has no history of its own, so the
  // conversation has to ride in-band exactly once (shared with the Claude SDK
  // path — runtime/history-prefix.ts).
  const canResume = !!args.codexThreadId && args.codexToolSignature === signature
  if (!canResume && args.history.length > 0) {
    const prefix = renderHistoryPrefix(args.history, args.compaction)
    if (prefix) promptText = `${prefix}\n\n${promptText}`
  }
  // Volatile orientation (ADR 0071): rebuilt per turn so a resumed thread's view
  // of the tree does not go stale.
  if (workspaceSnapshot) {
    promptText = `${buildCurrentStateBlock(workspaceSnapshot)}\n\n${promptText}`
  }

  const dispatch = createToolDispatch({ tools, gate, signal })

  // ── Wire the thread ───────────────────────────────────────────────────────
  let settle: ((outcome: CodexTurnOutcome) => void) | undefined
  const turnEnded = new Promise<CodexTurnOutcome>((resolve) => {
    settle = resolve
  })
  const adapter = createCodexEventAdapter({
    onChunk: cb.onChunk,
    ...(cb.onStep ? { onStep: cb.onStep } : {}),
    onTurnEnd: (outcome) => settle?.(outcome),
  })

  const route = daemon.openRoute({
    onNotification: (n) => adapter.handle(n.method, n.params),
    onServerRequest: (method, params) =>
      handleServerRequest({ method, params, args, dispatch, account: account.id }),
  })

  const cleanupFns: (() => void | Promise<void>)[] = [
    () => route.close(),
    // ADR 0083: a background subagent may not outlive the turn that started it.
    () => subagents?.disposeAll(),
  ]
  const runCleanup = async (): Promise<void> => {
    for (const fn of cleanupFns.reverse()) {
      try {
        await fn()
      } catch {
        /* cleanup is best effort — never mask the turn's own outcome */
      }
    }
  }

  try {
    const common = {
      model: args.settings.modelId,
      cwd: args.cwd ?? process.cwd(),
      approvalPolicy: approvalPolicyFor(args),
      sandbox: sandboxFor(args),
      developerInstructions,
    }
    let threadId: string
    if (canResume) {
      try {
        const res = (await daemon.request('thread/resume', {
          threadId: args.codexThreadId,
          excludeTurns: true,
          ...common,
        })) as CodexThreadResponse
        threadId = res.thread.id
      } catch (err) {
        // A thread whose rollout is gone (deleted home, a thread that never got
        // a turn) must not cost the user their message — ADR 0087 F8 flagged
        // resume as unverified, so the failure path is the design, not a patch.
        log.warn('codex: resume failed, starting a fresh thread', {
          sessionId: args.sessionId,
          err: err instanceof Error ? err.message : String(err),
        })
        const prefix = renderHistoryPrefix(args.history, args.compaction)
        if (prefix) promptText = `${prefix}\n\n${promptText}`
        threadId = await startThread(daemon, common, specs)
      }
    } else {
      threadId = await startThread(daemon, common, specs)
    }
    route.bind(threadId)

    const { input, cleanup } = await buildTurnInput(promptText, args.pendingAttachments)
    cleanupFns.push(cleanup)

    const effort = await clampEffort(daemon, args.settings.modelId, effortFrom(args.settings.level))
    const turnRes = (await daemon.request('turn/start', {
      threadId,
      input,
      ...(effort ? { effort } : {}),
    })) as { turn?: { id?: string } }
    const turnId = turnRes.turn?.id
    if (turnId) adapter.acc.turnId = turnId

    // Abort → interrupt. The turn still ends through `turn/completed`
    // (status interrupted), so there is exactly one path out of the wait.
    const onAbort = (): void => {
      if (!adapter.acc.turnId) return
      void daemon
        .request('turn/interrupt', { threadId, turnId: adapter.acc.turnId })
        .catch((err) => log.warn('codex: interrupt failed', { err: String(err) }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    cleanupFns.push(() => signal.removeEventListener('abort', onAbort))

    // Steering: drain AWOG's queue into `turn/steer`. Every steer is also shown
    // in the timeline, so the user can see where their instruction landed.
    if (args.getSteeringMessages) {
      const drain = args.getSteeringMessages
      const timer = setInterval(() => {
        void (async () => {
          const pending = await drain().catch(() => [])
          for (const item of pending) {
            const expectedTurnId = adapter.acc.turnId
            if (!expectedTurnId) continue
            try {
              await daemon.request('turn/steer', {
                threadId,
                expectedTurnId,
                input: [{ type: 'text', text: item.text, text_elements: [] }],
              })
              const step: SessionStep = {
                id: `steer-${item.id}`,
                kind: 'steer',
                label: item.text,
                status: 'done',
                steerText: item.text,
              }
              cb.onStep?.(step)
            } catch (err) {
              // `active_turn_not_steerable` is the normal race (the turn ended
              // between the drain and the send), not a fault to surface.
              log.info('codex: steer not applied', {
                sessionId: args.sessionId,
                err: err instanceof Error ? err.message : String(err),
              })
            }
          }
        })()
      }, STEER_POLL_MS)
      timer.unref?.()
      cleanupFns.push(() => clearInterval(timer))
    }

    const outcome = await turnEnded
    if (outcome.status === 'interrupted' && signal.aborted) throw new RpcError(-32023, 'CANCELED')

    const acc = adapter.acc
    const contextChars = buildContextChars(args, developerInstructions, tools, promptText)
    const result: RunStreamResult = {
      text: acc.text,
      modelUsed: args.settings.modelId,
      usage: {
        input_tokens: acc.inputTokens,
        output_tokens: acc.outputTokens,
        cache_read_tokens: acc.cacheReadTokens,
        cache_creation_tokens: acc.cacheWriteTokens,
        ...(acc.contextTokens > 0 ? { context_tokens: acc.contextTokens } : {}),
        ...(acc.baseTokens > 0 ? { base_tokens: acc.baseTokens } : {}),
      },
      stopReason: outcome.status === 'completed' ? 'end_turn' : 'error',
      contextChars,
      codexThreadId: threadId,
      codexToolSignature: signature,
    }
    if (outcome.status === 'failed') {
      const message = redactString(outcome.errorMessage ?? 'The Codex turn failed')
      // Nothing reached the user → there is no partial reply to preserve, so
      // surface the failure as a TYPED error. That is what gets an expired login
      // its AUTH_EXPIRED code (and therefore a re-auth prompt) instead of a bare
      // "retry" on a turn that can never succeed. With text already streamed, the
      // soft error wins: the partial answer is worth more than the code.
      if (!acc.text) throw mapErrorToRpc(new Error(message))
      result.stopReason = 'error'
      result.errorMessage = message
    }
    return result
  } catch (err) {
    throw mapErrorToRpc(err)
  } finally {
    await runCleanup()
  }
}

async function startThread(
  daemon: CodexDaemon,
  common: Record<string, unknown>,
  specs: ReturnType<typeof toDynamicToolSpecs>,
): Promise<string> {
  const res = (await daemon.request('thread/start', {
    ...common,
    modelProvider: 'openai',
    dynamicTools: specs,
  })) as CodexThreadResponse
  return res.thread.id
}

// ── Server → client requests ────────────────────────────────────────────────
// Every one of these MUST be answered: an unanswered request parks the turn on
// the server until it gives up. The shapes differ per family and the server
// validates them, so each branch returns its own.

async function handleServerRequest(ctx: {
  method: string
  params: Record<string, unknown>
  args: RunNonStreamArgs
  dispatch: ReturnType<typeof createToolDispatch>
  account: string
}): Promise<unknown> {
  const { method, params, args } = ctx
  switch (method) {
    case 'item/tool/call': {
      const p = params as unknown as CodexDynamicToolCallParams
      return ctx.dispatch.call({ callId: p.callId, tool: p.tool, arguments: p.arguments })
    }

    // Codex's own shell, gated by AWOG's rules. Presenting it as `Bash` is what
    // makes an existing `Bash(git status)` allow-rule keep working on this
    // runtime — the rule is about the command, not about whose shell ran it.
    case 'item/commandExecution/requestApproval': {
      const p = params as unknown as CodexCommandApprovalParams
      const decision = await askPermission(args, 'Bash', {
        command: p.command ?? '',
        ...(p.cwd ? { cwd: p.cwd } : {}),
        ...(p.reason ? { description: p.reason } : {}),
      })
      return { decision: decision ? 'accept' : 'decline' }
    }

    case 'item/fileChange/requestApproval': {
      const p = params as unknown as CodexFileChangeApprovalParams
      const decision = await askPermission(args, 'Edit', {
        file_path: p.grantRoot ?? args.cwd ?? '',
        ...(p.reason ? { description: p.reason } : {}),
      })
      return { decision: decision ? 'accept' : 'decline' }
    }

    // "Grant this turn more than its sandbox allows." Answering with an empty
    // profile is the protocol's way of granting nothing — there is no `decline`
    // variant — so the turn continues inside the sandbox it already has. A
    // widening grant is a security decision AWOG has no UI for yet; silently
    // saying yes would be the wrong default to ship.
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' }

    // AskUserQuestion, asked by the harness instead of by a tool. Routed to the
    // SAME park the AWOG tool uses, so the user sees one kind of question card.
    case 'item/tool/requestUserInput': {
      const p = params as unknown as CodexUserInputParams
      if (!args.askUserQuestion) return { answers: {} }
      const questions: SessionQuestion[] = p.questions.map((q) => ({
        header: q.header,
        question: q.question,
        multiSelect: false,
        options: (q.options ?? []).map((o) => ({
          label: o.label ?? '',
          ...(o.description ? { description: o.description } : {}),
        })),
      }))
      const reply = await args.askUserQuestion(`codex-${p.itemId}`, questions)
      // AWOG keys an answer by the question's HEADER (there is no id in its
      // schema); Codex keys it by the question id it generated. Join on header.
      const byHeader = new Map(reply.answers.map((a) => [a.header, a.selected]))
      const answers: Record<string, { answers: string[] }> = {}
      for (const q of p.questions) answers[q.id] = { answers: byHeader.get(q.header) ?? [] }
      return { answers }
    }

    // An MCP server asking the user something. AWOG routes MCP through its own
    // bridge, so an elicitation here comes from a server Codex loaded on its
    // own — which, with an AWOG-owned CODEX_HOME, should be none.
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null }

    case 'currentTime/read':
      return { currentTimeAt: Math.floor(Date.now() / 1000) }

    // The daemon's ChatGPT token expired. AWOG owns that credential, so
    // re-resolve it (pi refreshes under the hood) rather than making the user
    // log in again inside Codex.
    case 'account/chatgptAuthTokens/refresh': {
      const { account, cred } = await resolveCredential('openai', args.settings.accountId)
      if (cred.kind !== 'apikey' || !cred.codex) throw new Error('no ChatGPT credential to refresh')
      const accountId = account.piOAuth?.chatgpt_account_id
      return {
        accessToken: cred.apiKey,
        chatgptAccountId: typeof accountId === 'string' ? accountId : '',
        chatgptPlanType: null,
      }
    }

    default:
      log.info('codex: unhandled server request', { method })
      return {}
  }
}

// Ask AWOG's permission layer about a NATIVE Codex action. Returns true to allow.
//
// This is the canUseTool gate directly rather than the BeforeToolCall wrapper:
// the wrapper's job is to decide WHETHER to ask (deny rules, plan mode,
// auto-approve), and here the server has already decided to ask — Codex only
// sends an approval request when its own policy says the action needs one.
async function askPermission(
  args: RunNonStreamArgs,
  toolName: string,
  input: Record<string, unknown>,
): Promise<boolean> {
  if (args.autoApprove) return true
  if (!args.canUseTool) return false
  const controller = new AbortController()
  const res = await args.canUseTool(toolName, input, {
    signal: args.abortController?.signal ?? controller.signal,
    toolUseID: `codex-${toolName}-${Date.now()}`,
  })
  return res.behavior === 'allow'
}

// Per-segment prompt sizes for the usage panel. Same itemisation the other
// runtimes report, measured on what we actually sent.
function buildContextChars(
  args: RunNonStreamArgs,
  developerInstructions: string,
  tools: { name: string; description: string; parameters: unknown }[],
  promptText: string,
): ContextChars {
  const mcp = tools.filter((t) => t.name.startsWith('mcp__'))
  const system = tools.filter((t) => !t.name.startsWith('mcp__'))
  const jsonLen = (ts: typeof tools): number =>
    ts.reduce((n, t) => n + JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length, 0)
  const items = args.contextItems
  return {
    systemPrompt: (args.systemPrompt ?? '').length,
    instructions: Math.max(0, developerInstructions.length - (args.systemPrompt ?? '').length),
    systemTools: jsonLen(system),
    mcpTools: jsonLen(mcp),
    history: promptText.length,
    ...(items
      ? {
          memoryFiles: items.memoryFilesChars,
          customAgents: items.customAgentsChars,
          skills: items.skillsChars,
          wiki: items.wikiChars,
          memory: items.memoryChars,
          memoryFilesList: items.memoryFilesList,
          customAgentsList: items.customAgentsList,
          skillsList: items.skillsList,
          wikiList: items.wikiList,
          memoryList: items.memoryList,
        }
      : {}),
  }
}
