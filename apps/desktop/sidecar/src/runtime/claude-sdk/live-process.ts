// One long-lived Claude CLI process per chat session (ADR 0099).
//
// Before this file every turn spawned a fresh `claude` process (`query()` + `resume`) and
// held it open until the turn's background work settled, with a 30-minute cap. Work that
// outlived the turn — a `Bash(run_in_background)` build, a background `Task` subagent —
// died with the process, and nothing could wake the agent when it finished.
//
// Now the process outlives the turn, like Claude Desktop's:
//
//   - a turn is a SPAN of the CLI's message stream, not a process lifetime: it starts when
//     the caller pushes a user message and ends at the CLI's own `session_state_changed:
//     idle` after `result`. The process stays up, with its background tasks;
//   - the next turn REUSES the process when nothing spawn-relevant changed (the caller
//     compares fingerprints, see acquireLive) and pushes its message into the same input;
//   - when a background task settles after the turn ended the CLI starts a model turn on
//     its own (measured: `task_notification` → `running` → assistant → `result` → `idle`).
//     No consumer is attached then, so the pump holds that turn (an UNSOLICITED turn),
//     fires `session.background-done {wake:true, native:true}`, and the next
//     `sessions.sendMessage {attachWake}` adopts the buffered messages as an ordinary
//     assistant turn — persistence comes from the CLI JSONL (ADR 0097), the live stream
//     from the replayed buffer plus everything after it;
//   - a reaper closes a process that has been idle with no live background task for
//     LIVE_IDLE_REAP_MS, and a spawn beyond LIVE_MAX_PROCESSES evicts the least-recently-
//     used one that owns no work; delete/archive/CLI-attach/sidecar shutdown close it
//     explicitly;
//   - model / effort / ultracode / thinking / the MCP server set are changed ON the live
//     process (LiveClaude.reconfigure) instead of respawning it, so background work
//     survives them; everything else spawn-relevant still respawns.
//
// Measured facts this design stands on (spike against CLI 2.1.2xx, claude-haiku-4-5):
//   - `idle` fires ~1ms after `result` even while a `local_bash` task is still running, so
//     idle means "not generating", never "background work is over";
//   - a user message pushed into the open input after `result` is simply the next turn;
//   - `Query.interrupt()` mid-turn yields `result/error_during_execution` + `idle`, keeps
//     the process, and (with perTaskStopAffordance) keeps the background tasks — which
//     still wake the agent afterwards.

import type {
  EffortLevel,
  McpServerConfig,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { log } from "../../util/logger.js";
import type { StreamCallbacks } from "../../sessions/runner.js";
import {
  clearExternalKiller,
  noteExternalOutputFile,
  notifyExternalWake,
  registerExternalBackground,
  settleAllExternalBackground,
  settleExternalBackground,
  setExternalKiller,
  type BgShellStatus,
} from "../../sessions/bg-registry.js";
import type { BeforeToolCall } from "../permission.js";
import type { AskUserQuestionFn } from "../permission-types.js";
import type { ClaudeEventAdapter } from "./event-adapter.js";
import { readTaskOutputTail } from "./task-output.js";

// How long we wait, after `result`, for the CLI's authoritative `session_state_changed:
// idle` before ending the turn ourselves. With `promptSuggestions` on the CLI has been
// observed to deliver `result` + `prompt_suggestion` and then never say `idle`
// (docs/features/claude-sdk-idle-settle-prompt-suggestion.md). Short, because on a
// genuinely finished turn this is dead time before the reply is released.
export const IDLE_SETTLE_MS = 4_000;

// A process with no turn, no unsolicited turn, no live background task and no pending
// question for this long is closed. Each CLI is 70–200 MB of RSS (measured: Claude
// Desktop's four sit at 66–195 MB each); a user hopping between projects all day must not
// accumulate them. Reaping is cheap to undo: the next turn resumes the CLI session by id
// (~0.5 s cold start, prompt cache is server-side so it survives the respawn).
export const LIVE_IDLE_REAP_MS = 5 * 60_000;

// Hard cap on simultaneously live CLI processes. A spawn that would exceed it first
// evicts the least-recently-used process that is safe to lose (see makeRoomForSpawn).
// A process that owns background work or is mid-turn is NEVER evicted — the cap yields
// instead (and says so in the log), because killing a build to save RAM is the worse trade.
export const LIVE_MAX_PROCESSES = 4;

// `Query.setMaxThinkingTokens` is the only live thinking switch: 0 = off, anything else
// = on, and the CLI maps "on" to what the model supports (measured on the wire: adaptive
// on sonnet-4-6, `enabled` + budget_tokens on haiku-4-5). 31_999 is Claude Code's own
// default budget, so models that take a budget get the same one a fresh spawn would.
const THINKING_ON_TOKENS = 31_999;

// After an interrupt the CLI answers with `result` + `idle` within a second or two. If
// nothing arrives in this long the CLI is wedged and the only way to honour "Stop" is to
// kill the process (background tasks included — they cannot be saved from a hung CLI).
export const ABORT_UNWIND_MS = 8_000;

// Held (unsolicited, not yet adopted) turns kept per session. Each one is a complete turn
// that is also in the CLI JSONL, so dropping the oldest loses live display only.
const HELD_TURNS_MAX = 8;
// Per held turn: beyond this many buffered messages `stream_event` deltas are dropped
// (the `result` text is the fallback) so an ignored runaway turn cannot eat the heap.
const HELD_MESSAGES_MAX = 6_000;

// Messages the CLI emits AFTER `result` that say nothing about the model waking up. They
// must not cancel the post-result settle timer. Everything else — including types this
// list has never heard of — still counts as activity, because missing a wake-up cuts a
// continuation off, while missing a passive type only leaves the turn waiting.
const PASSIVE_AFTER_RESULT = new Set<SDKMessage["type"]>([
  "prompt_suggestion",
  "rate_limit_event",
]);

export function isPassiveAfterResult(msg: SDKMessage): boolean {
  return PASSIVE_AFTER_RESULT.has(msg.type);
}

// The CLI's task_type vocabulary, VERBATIM (`system/background_tasks_changed` +
// `task_started`): `local_bash` = Bash(run_in_background), `local_agent` = a Task
// subagent, `local_workflow` = a Workflow run. A FALLBACK only: `background_tasks_changed`
// carries an `ambient` flag per task ("True for tasks that are not activity … hosts should
// exclude them from activity indicators") which decides whenever present.
const WAITABLE_TASK_TYPES = new Set([
  "local_bash",
  "local_agent",
  "local_workflow",
]);
const AMBIENT_TASK_TYPES = new Set([
  "monitor_ws",
  "monitor_mcp",
  "mcp_task",
  "dream",
  "auto_mode_scan",
  "remote_agent",
  "in_process_teammate",
]);

// ── Input channel ───────────────────────────────────────────────────────────

// The CLI's stdin. `close()` lets the generator finish, which is what makes the SDK close
// the CLI's stdin (and the process exit). Messages pushed after the first one are the
// following turns.
export interface PromptChannel {
  stream: AsyncIterable<SDKUserMessage>;
  push: (message: SDKUserMessage) => void;
  close: () => void;
}

export function createPromptChannel(): PromptChannel {
  const pending: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const stream = (async function* (): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      while (pending.length > 0) {
        const next = pending.shift();
        if (next) yield next;
      }
      if (closed) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
  return {
    stream,
    push: (message) => {
      if (closed) return;
      pending.push(message);
      wake?.();
    },
    close: () => {
      closed = true;
      wake?.();
    },
  };
}

// ── Per-turn state shared with the long-lived hooks ─────────────────────────

// What the hooks and in-process MCP servers — built ONCE, at spawn — must read FRESH every
// time they fire. The permission mode, the budget, the approval callback and the card
// callbacks all belong to the turn, not to the process.
export interface TurnContext {
  gate: BeforeToolCall;
  cb: StreamCallbacks;
  askUserQuestion?: AskUserQuestionFn;
  signal?: AbortSignal;
  // Called when an AskUserQuestion/elicitation park resolves, so the turn can re-arm its
  // settle timer (a question answered AFTER `result` may leave the CLI with nothing to say).
  onQuestionAnswered?: () => void;
}

// What a TurnState holds. A separate object so a TurnState can be pointed at another one's
// (forwardTo): the in-process MCP servers a turn builds capture ITS TurnState, but when
// that turn reuses a live process the live process's state is the real one — a server
// added to the live process mid-life must read that, not a state nobody will ever begin().
interface TurnCore {
  ctx: TurnContext | undefined;
  humanParks: number;
  memo: Map<string, unknown>;
  currentSignal: AbortSignal | undefined;
  onCard:
    | ((step: Parameters<NonNullable<StreamCallbacks["onStep"]>>[0]) => void)
    | undefined;
}

// Lives as long as the process. `once` memoises per-TURN objects (the in-process MCP
// servers carry per-reply caps in their closures: N session messages per turn, N surfaces
// per reply) — the factory runs again the first time it is asked after the next turn
// began, which is exactly the lifetime those caps had when the servers were rebuilt every
// turn.
export class TurnState {
  private readonly own: TurnCore = {
    ctx: undefined,
    humanParks: 0,
    memo: new Map(),
    currentSignal: undefined,
    onCard: undefined,
  };
  private core: TurnCore = this.own;

  get ctx(): TurnContext | undefined {
    return this.core.ctx;
  }

  get humanParks(): number {
    return this.core.humanParks;
  }

  set humanParks(n: number) {
    this.core.humanParks = n;
  }

  // Set by the owning LiveClaude: routes a card step (AskUserQuestion / elicitation) to
  // the attached turn, or holds it for the next one.
  get onCard(): TurnCore["onCard"] {
    return this.core.onCard;
  }

  set onCard(fn: TurnCore["onCard"]) {
    this.core.onCard = fn;
  }

  // Share `target`'s state (undefined: back to this one's own). Used while a reused live
  // process is being reconfigured, see LiveClaude.reconfigure.
  forwardTo(target: TurnState | undefined): void {
    this.core = target ? target.core : this.own;
  }

  begin(ctx: TurnContext): void {
    this.core.ctx = ctx;
    this.core.currentSignal = ctx.signal;
    this.core.memo.clear();
  }

  // The turn is over; its abort signal must not leak into a later unsolicited turn (a
  // cancelled turn's signal stays aborted forever).
  finish(): void {
    this.core.currentSignal = undefined;
  }

  once<T>(key: string, make: () => T): T {
    const { memo } = this.core;
    if (memo.has(key)) return memo.get(key) as T;
    const value = make();
    memo.set(key, value);
    return value;
  }

  signal(): AbortSignal | undefined {
    return this.core.currentSignal;
  }

  // A card step from a long-lived gate: to the attached turn's callbacks when there is
  // one, else (between turns) held — see LiveClaude.cardStep.
  card(step: Parameters<NonNullable<StreamCallbacks["onStep"]>>[0]): void {
    if (this.core.onCard) this.core.onCard(step);
    else this.core.ctx?.cb.onStep?.(step);
  }
}

// ── Turn plumbing ───────────────────────────────────────────────────────────

class MessageQueue {
  private items: SDKMessage[] = [];
  private waiter:
    | {
        resolve: (r: IteratorResult<SDKMessage>) => void;
        reject: (e: unknown) => void;
      }
    | undefined;
  private done = false;
  private failure: { err: unknown } | undefined;

  push(msg: SDKMessage): void {
    if (this.done) return;
    const w = this.waiter;
    if (w) {
      this.waiter = undefined;
      w.resolve({ value: msg, done: false });
    } else this.items.push(msg);
  }

  end(err?: unknown): void {
    if (this.done) return;
    this.done = true;
    if (err !== undefined) this.failure = { err };
    const w = this.waiter;
    if (!w) return;
    this.waiter = undefined;
    if (this.failure) {
      const f = this.failure;
      this.failure = undefined;
      w.reject(f.err);
    } else w.resolve({ value: undefined, done: true });
  }

  next(): Promise<IteratorResult<SDKMessage>> {
    const item = this.items.shift();
    if (item) return Promise.resolve({ value: item, done: false });
    if (this.done) {
      if (this.failure) {
        const f = this.failure;
        this.failure = undefined;
        return Promise.reject(f.err);
      }
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  drain(): SDKMessage[] {
    const rest = this.items;
    this.items = [];
    return rest;
  }
}

// A turn's view of the CLI stream. `messages` yields until the caller ends the turn
// (`end()`, or just leaving the `for await`) or the process dies (then it throws).
export class LiveTurn {
  readonly queue = new MessageQueue();
  // True when the turn adopted an unsolicited one instead of sending a message.
  readonly attached: boolean;
  private readonly release_: (turn: LiveTurn) => void;
  readonly messages: AsyncIterable<SDKMessage>;

  constructor(attached: boolean, release: (turn: LiveTurn) => void) {
    this.attached = attached;
    this.release_ = release;
    this.messages = {
      [Symbol.asyncIterator]: () => ({
        next: () => this.queue.next(),
        return: async () => {
          this.release_(this);
          return { value: undefined, done: true };
        },
      }),
    };
  }

  // The turn is over: stop delivering, hand any still-unread messages back to the pump.
  end(): void {
    this.queue.end();
    this.release_(this);
  }
}

interface HeldTurn {
  messages: SDKMessage[];
  sawResult: boolean;
  settleTimer?: NodeJS.Timeout | undefined;
  ended: boolean;
}

interface SettledTask {
  taskId: string;
  command: string;
  status: string;
  summary?: string;
}

// The part of a turn's config a live process can change WITHOUT a respawn — each field has
// a `Query` method that applies it to the running CLI (spike, docs/features/
// session-background-tasks.md §"Cấu hình đổi giữa chừng"). `run-stream.ts` derives it
// from the turn's `Options`; the rest of the options is the hard fingerprint.
export interface SoftConfig {
  model: string | undefined;
  // `undefined` = no explicit effort ⇒ the model's default.
  effort: EffortLevel | undefined;
  ultracode: boolean;
  // Extended thinking on/off (`Options.thinking` disabled | adaptive). Always defined:
  // a config whose thinking cannot be switched live carries it in the hard fingerprint.
  thinking: "on" | "off";
  // The backup model of the model the process was SPAWNED with. Not applicable live
  // (the CLI flag outranks the settings layer, so no `Query` call changes it) and not a
  // reason to respawn either — see LiveClaude.reconfigure. Informational.
  fallbackModel: string | undefined;
  // server name → digest of the config it was connected with: 'sdk:<hash>' for an in-process
  // server (hash of the source config it closes over, when the caller knows it; bare 'sdk'
  // when the server's inputs are fixed per session), else a hash of the resolved external
  // config. Hashed so no header/env secret sits in the registry. A changed digest under an
  // unchanged name makes reconfigure replace the server (see there).
  mcp: Record<string, string>;
}

export interface LiveSpawn {
  sessionId: string;
  // Everything about the spawn config that is NOT the resume handle or the credential
  // (see describeOptions in run-stream.ts). A turn whose HARD fingerprint differs cannot
  // reuse this process: those options are fixed at spawn. The soft part is `soft` below.
  fingerprint: string;
  // Identity of the frozen credential. Compared leniently — see acquireLive.
  tokenKey: string;
  state: TurnState;
  adapter: ClaudeEventAdapter;
  input: PromptChannel;
  lifeAbort: AbortController;
  query: Query;
  // The CLI session id when it is known before the first message (we minted it, or we
  // resumed it). Otherwise learned from the first message that carries one.
  cliSessionId: string | undefined;
  // What the CLI is running with right now; updated as reconfigure applies each field.
  soft: SoftConfig;
}

function isTurnStart(msg: SDKMessage): boolean {
  if (msg.type === "system") {
    const m = msg as { subtype?: string; state?: string };
    return m.subtype === "session_state_changed" && m.state === "running";
  }
  // Defensive: a CLI that never reports `running` (we ask for state events via env, but an
  // older binary ignores it) still announces a model turn by producing model output.
  // Subagent frames (parent_tool_use_id set) are nested inside a turn, never its start.
  if (msg.type === "assistant" || msg.type === "stream_event") {
    return !(msg as { parent_tool_use_id?: string | null }).parent_tool_use_id;
  }
  return false;
}

export const sessionStateOf = (msg: SDKMessage): string | undefined =>
  msg.type === "system" &&
  (msg as { subtype?: string }).subtype === "session_state_changed"
    ? (msg as { state?: string }).state
    : undefined;

const registry = new Map<string, LiveClaude>();
let reaper: NodeJS.Timeout | undefined;

export class LiveClaude {
  readonly sessionId: string;
  readonly fingerprint: string;
  soft: SoftConfig;
  readonly tokenKey: string;
  readonly state: TurnState;
  readonly adapter: ClaudeEventAdapter;
  readonly lifeAbort: AbortController;
  cliSessionId: string | undefined;
  closed = false;

  private readonly q: Query;
  private readonly input: PromptChannel;
  private consumer: LiveTurn | undefined;
  private gated: { turn: LiveTurn; message: SDKUserMessage } | undefined;
  private unsolicited: HeldTurn | undefined;
  private held: HeldTurn[] = [];
  private lastActivityAt = Date.now();
  private abortTimer: NodeJS.Timeout | undefined;
  private wakeSeq = 0;
  // Card steps (AskUserQuestion, elicitation) that fired while no turn was attached —
  // replayed into the next turn's callbacks instead of a bubble that is already final.
  private deferredSteps: Parameters<
    NonNullable<StreamCallbacks["onStep"]>
  >[0][] = [];

  // ── background work (survives turns) ──
  // id → task. Only waitable work (a background shell, a subagent, a workflow) counts as
  // "live"; ambient/housekeeping tasks the CLI runs on its own never keep a process alive.
  private readonly background = new Map<
    string,
    { type: string; ambient?: boolean }
  >();
  private readonly taskCommands = new Map<string, string>();
  private readonly settled: SettledTask[] = [];
  private readonly unknownTypesSeen = new Set<string>();
  private readonly shellTaskByToolUse = new Map<string, string>();
  private readonly bgOutputFiles = new Map<
    string,
    { file: string; misses: number }
  >();
  private outputPoll: NodeJS.Timeout | undefined;

  constructor(spawn: LiveSpawn) {
    this.sessionId = spawn.sessionId;
    this.fingerprint = spawn.fingerprint;
    this.tokenKey = spawn.tokenKey;
    this.state = spawn.state;
    this.adapter = spawn.adapter;
    this.input = spawn.input;
    this.lifeAbort = spawn.lifeAbort;
    this.q = spawn.query;
    this.cliSessionId = spawn.cliSessionId;
    this.soft = spawn.soft;
    this.state.onCard = (step) => this.cardStep(step);

    // Stop affordance: a chip's stop button goes through sessions.backgroundKill → the
    // registry → here, since only the CLI can stop a task it owns.
    setExternalKiller(this.sessionId, (taskId) => {
      void this.q.stopTask(taskId).catch((err: unknown) => {
        log.warn("claude-sdk stopTask failed", {
          taskId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    });
    registry.set(this.sessionId, this);
    ensureReaper();
    log.info("claude-sdk live process spawned", {
      sessionId: this.sessionId,
      cliSessionId: this.cliSessionId,
      liveCount: registry.size,
    });
    void this.pump();
  }

  // ── public surface ──────────────────────────────────────────────────────

  waitingCount(): number {
    let n = 0;
    for (const t of this.background.values()) if (this.isWaitable(t)) n += 1;
    return n;
  }

  // A turn is attached, queued, or the CLI is producing an unsolicited one.
  isBusy(): boolean {
    return !!this.consumer || !!this.gated || !!this.unsolicited;
  }

  // A wake the renderer can still adopt: a finished unsolicited turn or one in flight.
  hasPendingWake(): boolean {
    return this.held.length > 0 || !!this.unsolicited;
  }

  // Route a card step (question / elicitation) to the active turn, or hold it for the next.
  cardStep(step: Parameters<NonNullable<StreamCallbacks["onStep"]>>[0]): void {
    const cb = this.consumer ? this.state.ctx?.cb : undefined;
    if (cb?.onStep) cb.onStep(step);
    else this.deferredSteps.push(step);
  }

  // Start a turn.
  //   attach: adopt the unsolicited turn(s) the CLI started on its own (the wake). With
  //           nothing to adopt it falls back to sending `message`, so a wake whose live
  //           process was reaped/respawned in between still continues the conversation.
  //   else:   push `message` as the next user turn. A held turn nobody adopted is dropped
  //           (it is in the CLI JSONL already); one still RUNNING is interrupted first —
  //           the user typed something, they want to talk now, not after a turn they
  //           cannot see.
  begin(opts: { message: SDKUserMessage; attach?: boolean }): LiveTurn {
    if (this.closed) throw new Error("live claude process is closed");
    if (this.consumer || this.gated) {
      // The per-session lock makes this unreachable from runStream; a second consumer
      // would interleave two turns' messages, so fail loudly instead of guessing.
      throw new Error("a turn is already attached to this live claude process");
    }
    this.touch();
    this.flushDeferredSteps();

    if (opts.attach && (this.unsolicited || this.held.length > 0)) {
      const turn = new LiveTurn(true, (t) => this.release(t));
      const merged = this.takeHeldMessages();
      for (const m of merged) turn.queue.push(m);
      if (this.unsolicited) {
        // Still running: everything it has produced so far was just replayed, the rest
        // flows live from here on.
        for (const m of this.unsolicited.messages) turn.queue.push(m);
        this.dropTimer(this.unsolicited);
        this.unsolicited = undefined;
        this.consumer = turn;
      } else {
        // Complete turn(s): nothing more is coming; end after the replay.
        this.consumer = turn;
        turn.queue.end();
      }
      return turn;
    }

    const turn = new LiveTurn(false, (t) => this.release(t));
    if (this.unsolicited) {
      log.info(
        "claude-sdk: user turn arrived during an unsolicited turn — interrupting it",
        {
          sessionId: this.sessionId,
        },
      );
      this.gated = { turn, message: opts.message };
      this.armAbortTimer("interrupt of unsolicited turn did not unwind");
      void this.interrupt();
      return turn;
    }
    if (this.held.length > 0) {
      log.info(
        "claude-sdk: dropping unadopted wake turn(s) — the user moved on",
        {
          sessionId: this.sessionId,
          turns: this.held.length,
        },
      );
      this.held.length = 0;
    }
    this.consumer = turn;
    this.input.push(opts.message);
    return turn;
  }

  // The user pressed Stop on `turn`. If it never started (queued behind an unsolicited
  // turn) just withdraw it; otherwise interrupt the CLI — the process and its background
  // tasks stay — and arm the deadline that kills a wedged CLI.
  cancel(turn: LiveTurn): void {
    if (this.gated?.turn === turn) {
      turn.end();
      return;
    }
    this.armAbortTimer("interrupt did not unwind");
    void this.interrupt();
  }

  // Stop the current generation without killing the process or its background tasks.
  // The caller still has to drain the turn to its `result`/`idle`; if the CLI never answers
  // the deadline (armAbortTimer) closes the process, because Stop must always unblock the
  // session.
  async interrupt(): Promise<void> {
    try {
      await this.q.interrupt();
    } catch (err) {
      log.warn("claude-sdk interrupt failed", {
        sessionId: this.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  armAbortTimer(reason: string): void {
    if (this.abortTimer) return;
    this.abortTimer = setTimeout(() => {
      this.abortTimer = undefined;
      this.close(reason);
    }, ABORT_UNWIND_MS);
    this.abortTimer.unref();
  }

  clearAbortTimer(): void {
    clearTimeout(this.abortTimer);
    this.abortTimer = undefined;
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const lost = this.waitingCount();
    log.info("claude-sdk closing live process", {
      sessionId: this.sessionId,
      reason,
      cliSessionId: this.cliSessionId,
      backgroundTasksLost: lost,
    });
    if (registry.get(this.sessionId) === this) registry.delete(this.sessionId);
    log.info("claude-sdk live process closed", {
      sessionId: this.sessionId,
      liveCount: registry.size,
    });
    this.input.close();
    this.lifeAbort.abort();
    try {
      this.q.close();
    } catch {
      /* already gone */
    }
    // The pump unwinds on its own once the process exits; settle the mirrors now so the
    // UI doesn't show a task as running for a process that is being torn down.
    this.teardown(undefined);
  }

  // ── pump ────────────────────────────────────────────────────────────────

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.q) this.onMessage(msg);
      this.teardown(undefined);
    } catch (err) {
      this.teardown(err);
    }
  }

  private onMessage(msg: SDKMessage): void {
    this.touch();
    const sid = (msg as { session_id?: unknown }).session_id;
    if (typeof sid === "string" && sid) this.cliSessionId = sid;
    this.trackBackground(msg);
    this.trackShellOutputPath(msg);
    this.route(msg);
  }

  private route(msg: SDKMessage): void {
    if (this.consumer) {
      this.consumer.queue.push(msg);
      return;
    }
    if (this.unsolicited) {
      this.feedUnsolicited(this.unsolicited, msg);
      return;
    }
    if (isTurnStart(msg)) {
      this.beginUnsolicited(msg);
      return;
    }
    // Between turns: keep the adapter's row state current (task rows, checklist) with the
    // output parked on its sink.
    this.adapter.handle(msg);
  }

  // ── unsolicited turn ────────────────────────────────────────────────────

  private beginUnsolicited(first: SDKMessage): void {
    const turn: HeldTurn = {
      messages: [first],
      sawResult: false,
      ended: false,
    };
    this.unsolicited = turn;
    const batch = this.settled.splice(0);
    const last = batch.at(-1);
    log.info(
      "claude-sdk: the CLI started a turn on its own (background wake)",
      {
        sessionId: this.sessionId,
        trigger: first.type,
        tasks: batch.map((t) => t.taskId),
      },
    );
    this.wakeSeq += 1;
    notifyExternalWake({
      sessionId: this.sessionId,
      shellId: last?.taskId ?? `native-wake-${this.wakeSeq}`,
      command: last?.command ?? "background event",
      status: last ? statusOf(last.status) : "exited",
      exitCode: last ? exitCodeOf(last.status) : 0,
      outputTail: batch
        .map(
          (t) =>
            `${t.command}: ${t.status}${t.summary ? ` — ${t.summary}` : ""}`,
        )
        .join("\n"),
    });
  }

  private feedUnsolicited(turn: HeldTurn, msg: SDKMessage): void {
    if (!isPassiveAfterResult(msg)) this.dropTimer(turn);
    if (
      turn.messages.length < HELD_MESSAGES_MAX ||
      msg.type !== "stream_event"
    ) {
      turn.messages.push(msg);
    }
    if (msg.type === "result") {
      turn.sawResult = true;
      if (this.state.humanParks === 0) this.armUnsolicitedSettle(turn);
      return;
    }
    if (
      turn.sawResult &&
      sessionStateOf(msg) === "idle" &&
      this.state.humanParks === 0
    ) {
      this.endUnsolicited(turn);
    }
  }

  private armUnsolicitedSettle(turn: HeldTurn): void {
    if (turn.settleTimer) return;
    turn.settleTimer = setTimeout(() => {
      turn.settleTimer = undefined;
      if (this.unsolicited === turn) this.endUnsolicited(turn);
    }, IDLE_SETTLE_MS);
    turn.settleTimer.unref();
  }

  private endUnsolicited(turn: HeldTurn): void {
    this.dropTimer(turn);
    turn.ended = true;
    this.unsolicited = undefined;
    this.clearAbortTimer();
    if (this.gated) {
      // A user turn was waiting behind it (and had interrupted it). The unsolicited turn
      // is in the JSONL already; do not surface it as a second wake.
      const { turn: next, message } = this.gated;
      this.gated = undefined;
      this.held.length = 0;
      this.consumer = next;
      this.input.push(message);
      return;
    }
    this.held.push(turn);
    while (this.held.length > HELD_TURNS_MAX) this.held.shift();
  }

  private takeHeldMessages(): SDKMessage[] {
    const turns = this.held.splice(0);
    const out: SDKMessage[] = [];
    turns.forEach((t, i) => {
      const last = i === turns.length - 1;
      // One continuation, one bubble: only the LAST held turn keeps its `result`/`idle`
      // (the consumer's turn-over signal), earlier ones contribute content only.
      for (const m of t.messages) {
        if (!last && (m.type === "result" || sessionStateOf(m) !== undefined))
          continue;
        out.push(m);
      }
    });
    return out;
  }

  private dropTimer(turn: HeldTurn): void {
    clearTimeout(turn.settleTimer);
    turn.settleTimer = undefined;
  }

  // ── turn release ────────────────────────────────────────────────────────

  private release(turn: LiveTurn): void {
    if (this.gated?.turn === turn) {
      // Cancelled before it ever started — never push its message.
      this.gated = undefined;
      this.clearAbortTimer();
    }
    if (this.consumer !== turn) return;
    this.consumer = undefined;
    this.state.finish();
    this.adapter.endTurn();
    this.clearAbortTimer();
    this.touch();
    // Whatever the turn did not read still belongs to the process.
    for (const m of turn.queue.drain()) this.route(m);
  }

  private flushDeferredSteps(): void {
    // Delivered once the new turn's callbacks are in place (run-stream calls
    // adapter.beginTurn right after begin); this only parks them until then.
    const steps = this.deferredSteps.splice(0);
    if (steps.length === 0) return;
    queueMicrotask(() => {
      const cb = this.state.ctx?.cb;
      for (const s of steps) cb?.onStep?.(s);
    });
  }

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  // When this process last had a turn start/end or any CLI message (a wake included).
  // The LRU key of makeRoomForSpawn.
  lastUsedAt(): number {
    return this.lastActivityAt;
  }

  // Reaper input. A question parked on the human, a turn, an unsolicited turn, or live
  // background work all keep the process; the idle clock only runs on a truly quiet one.
  // `undefined` = protected (also what makeRoomForSpawn refuses to evict).
  idleForMs(now: number): number | undefined {
    if (this.isBusy() || this.waitingCount() > 0 || this.state.humanParks > 0)
      return undefined;
    return now - this.lastActivityAt;
  }

  // Bring the running CLI to `wanted` WITHOUT restarting it (a restart kills the background
  // tasks it owns). Only the fields that differ from `this.soft` are touched, so an
  // unchanged config costs nothing. Returns false — after CLOSING the process — when any
  // live apply fails; the caller then spawns a replacement via `resume`, i.e. exactly
  // what a config change did before this existed (history intact, background work lost).
  //
  //   model     setModel(). The CLI validates the id with a real API call, so this is
  //             also the one that fails when the network/credential is bad.
  //   thinking  setMaxThinkingTokens(0 | THINKING_ON_TOKENS, 'summarized').
  //   effort /  applyFlagSettings({ effortLevel, ultracode }). Both keys are sent whenever
  //   ultracode ultracode is, or was, in play: a bare effortLevel change turns ultracode
  //             off. `null` effort = the model's default.
  //   mcp       setMcpServers(full map). The CLI diffs by name: a missing server is removed,
  //             a new one connected, and a same-named one KEEPS its running instance — so
  //             a server whose config digest changed is first removed (one extra call) and
  //             then added back. A server that fails to connect is an error here.
  //
  // fallbackModel is deliberately NOT reconfigured: `--fallback-model` outranks the
  // settings layer, so nothing can change it live, and a stale backup model only matters
  // when the primary is overloaded — not worth killing a build for. It stays what the
  // process was spawned with (logged when it no longer matches the model's own).
  //
  // `adopt`: the TurnState the in-process MCP servers of THIS turn's map were built with.
  // Pointed at the live state before they are connected, so a server added here reads the
  // live process's turn context rather than a state nobody else will ever begin().
  async reconfigure(
    wanted: SoftConfig,
    servers: Record<string, McpServerConfig> | undefined,
    adopt: TurnState,
  ): Promise<{ ok: boolean; changed: string[] }> {
    const have = this.soft;
    const changed: string[] = [];
    try {
      if (wanted.model !== have.model) {
        await this.q.setModel(wanted.model);
        have.model = wanted.model;
        changed.push("model");
        if (wanted.fallbackModel !== have.fallbackModel) {
          log.info(
            "claude-sdk: model changed live — fallback model stays as spawned",
            {
              sessionId: this.sessionId,
              fallbackModel: have.fallbackModel,
              wouldBe: wanted.fallbackModel,
            },
          );
        }
      }
      if (wanted.thinking !== have.thinking) {
        await (wanted.thinking === "on"
          ? this.q.setMaxThinkingTokens(THINKING_ON_TOKENS, "summarized")
          : this.q.setMaxThinkingTokens(0));
        have.thinking = wanted.thinking;
        changed.push("thinking");
      }
      if (
        wanted.effort !== have.effort ||
        wanted.ultracode !== have.ultracode
      ) {
        const flags: Parameters<Query["applyFlagSettings"]>[0] = {
          effortLevel: wanted.effort ?? null,
        };
        if (wanted.ultracode || have.ultracode)
          flags.ultracode = wanted.ultracode;
        await this.q.applyFlagSettings(flags);
        have.effort = wanted.effort;
        have.ultracode = wanted.ultracode;
        changed.push("effort");
      }
      if (!sameRecord(wanted.mcp, have.mcp)) {
        adopt.forwardTo(this.state);
        // A server whose NAME survived but whose config digest changed (an edited Source:
        // URL, args, rotated secret, api endpoint…). The CLI diffs by name, and for an
        // in-process server a same-name entry keeps the OLD instance (measured), so one
        // call would leave the live process on the stale connection. Remove-then-add
        // replaces it (measured: same pid, new output), for external servers too.
        const edited = Object.keys(wanted.mcp).filter(
          (n) => n in have.mcp && have.mcp[n] !== wanted.mcp[n],
        );
        if (edited.length > 0) {
          const without = Object.fromEntries(
            Object.entries(servers ?? {}).filter(([n]) => !edited.includes(n)),
          );
          await this.q.setMcpServers(without);
          changed.push(`mcp-replaced:${edited.join(",")}`);
        }
        const res = await this.q.setMcpServers(servers ?? {});
        const failed = Object.entries(res.errors);
        if (failed.length > 0) {
          throw new Error(
            `MCP servers failed to connect: ${failed.map(([n, e]) => `${n} (${e})`).join("; ")}`,
          );
        }
        have.mcp = wanted.mcp;
        changed.push("mcp");
      }
    } catch (err) {
      adopt.forwardTo(undefined);
      log.warn("claude-sdk: live reconfigure failed — replacing the process", {
        sessionId: this.sessionId,
        applied: changed,
        err: err instanceof Error ? err.message : String(err),
      });
      this.close("live reconfigure failed");
      return { ok: false, changed };
    }
    if (this.closed) {
      // Died while we were applying (CLI crash, user deleted the session).
      adopt.forwardTo(undefined);
      return { ok: false, changed };
    }
    return { ok: true, changed };
  }

  // ── teardown ────────────────────────────────────────────────────────────

  private teardown(err: unknown): void {
    const wasClosed = this.closed;
    this.closed = true;
    if (registry.get(this.sessionId) === this) registry.delete(this.sessionId);
    this.stopOutputPoll();
    this.clearAbortTimer();
    if (this.unsolicited) this.dropTimer(this.unsolicited);
    for (const turn of this.held) this.dropTimer(turn);
    for (const taskId of this.background.keys())
      this.adapter.settleBackgroundRow(taskId);
    this.background.clear();
    clearExternalKiller(this.sessionId);
    settleAllExternalBackground(this.sessionId);
    if (this.gated) {
      this.gated.turn.queue.end(err);
      this.gated = undefined;
    }
    // A deliberate close (reaper, respawn, delete) must not read as a crash to the turn
    // that happened to be attached: it just ends.
    this.consumer?.queue.end(wasClosed ? undefined : err);
    if (err && !wasClosed) {
      log.warn("claude-sdk live process died", {
        sessionId: this.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── background bookkeeping (process-level: it outlives any turn) ────────

  private isWaitable(t: { type: string; ambient?: boolean }): boolean {
    return t.ambient !== undefined
      ? !t.ambient
      : WAITABLE_TASK_TYPES.has(t.type);
  }

  // Unknown types mean the CLI's task vocabulary moved and the fallback list needs
  // updating. Only worth saying when the CLI gave us no `ambient` flag.
  private noteTaskType(type: string, ambient?: boolean): void {
    if (ambient !== undefined) return;
    if (WAITABLE_TASK_TYPES.has(type) || AMBIENT_TASK_TYPES.has(type)) return;
    if (this.unknownTypesSeen.has(type)) return;
    this.unknownTypesSeen.add(type);
    log.warn(
      "claude-sdk: unknown background task_type — process will NOT wait for it",
      {
        sessionId: this.sessionId,
        taskType: type,
      },
    );
  }

  private trackBackground(msg: SDKMessage): void {
    if (msg.type !== "system") return;
    const m = msg as {
      subtype?: string;
      tasks?: {
        task_id: string;
        task_type?: string;
        description?: string;
        ambient?: boolean;
      }[];
      task_id?: string;
      tool_use_id?: string;
      task_type?: string;
      subagent_type?: string;
      status?: string;
      summary?: string;
    };
    switch (m.subtype) {
      // `background_tasks_changed` is a LEVEL signal (replace the set wholesale); the
      // task_started/task_notification bookends are the fallback for a CLI that doesn't
      // emit the level. Registration follows the LEVEL: only a task the CLI itself calls
      // background belongs on a chip — a foreground subagent is already in the transcript.
      case "background_tasks_changed":
        this.background.clear();
        for (const t of m.tasks ?? []) {
          const type = t.task_type ?? "unknown";
          const entry = {
            type,
            ...(t.ambient !== undefined ? { ambient: t.ambient } : {}),
          };
          this.background.set(t.task_id, entry);
          this.noteTaskType(type, t.ambient);
          this.taskCommands.set(t.task_id, t.description || type);
          this.adapter.markBackgroundTask(t.task_id);
          if (this.isWaitable(entry)) {
            registerExternalBackground({
              sessionId: this.sessionId,
              shellId: t.task_id,
              command: t.description || type,
            });
          }
        }
        break;
      case "task_started": {
        // A Task-tool subagent may arrive without task_type; subagent_type says it. No
        // `ambient` flag rides this edge, so the type list decides here.
        if (m.task_id) {
          const type =
            m.task_type ?? (m.subagent_type ? "local_agent" : "unknown");
          this.background.set(m.task_id, { type });
          this.noteTaskType(type);
          // A shell has no progress events — remember which tool_use announced it so we
          // can pick its output path out of the matching tool_result.
          if (type === "local_bash" && m.tool_use_id) {
            this.shellTaskByToolUse.set(m.tool_use_id, m.task_id);
          }
        }
        break;
      }
      case "task_notification":
        if (m.task_id) {
          const wasWaitable = this.isWaitable(
            this.background.get(m.task_id) ?? { type: "unknown" },
          );
          this.background.delete(m.task_id);
          // Only work the user could see as a chip can be what woke the agent.
          if (wasWaitable) {
            this.settled.push({
              taskId: m.task_id,
              command: this.taskCommands.get(m.task_id) ?? m.task_id,
              status: m.status ?? "completed",
              ...(m.summary !== undefined ? { summary: m.summary } : {}),
            });
            while (this.settled.length > 8) this.settled.shift();
          }
          // 'completed' | 'failed' | 'stopped' — map onto the shell vocabulary the chips
          // already speak (exit 0 / exit 1 / interrupted).
          settleExternalBackground({
            sessionId: this.sessionId,
            shellId: m.task_id,
            status: statusOf(m.status ?? "completed"),
            exitCode: exitCodeOf(m.status ?? "completed"),
            ...(m.summary !== undefined ? { summary: m.summary } : {}),
          });
        }
        break;
      default:
        break;
    }
  }

  // ── live output for a background SHELL ──────────────────────────────────
  //
  // The CLI emits `task_progress` for a subagent but NOTHING for a shell, so a long
  // `pytest` would sit in the transcript as a bare "running" row for minutes. The output
  // file is named in the backgrounded Bash tool_result ("Output is being written to: …"),
  // so we poll its tail while the task is live and push it into that row. Cheap by
  // construction: one stat+read per live shell every few seconds, and the adapter drops
  // an unchanged tail instead of re-emitting the step.
  private static readonly OUTPUT_POLL_MS = 5_000;
  // Stop polling a path that keeps failing to read (deleted file, rejected path).
  private static readonly OUTPUT_POLL_MAX_MISSES = 3;

  private stopOutputPoll(): void {
    if (!this.outputPoll) return;
    clearInterval(this.outputPoll);
    this.outputPoll = undefined;
  }

  private startOutputPoll(): void {
    if (this.outputPoll || this.closed) return;
    this.outputPoll = setInterval(() => {
      if (this.closed) {
        this.stopOutputPoll();
        return;
      }
      for (const [taskId, entry] of this.bgOutputFiles) {
        if (!this.background.has(taskId)) {
          this.bgOutputFiles.delete(taskId);
          continue;
        }
        const tail = readTaskOutputTail(entry.file, taskId);
        if (tail === undefined) {
          entry.misses += 1;
          if (entry.misses >= LiveClaude.OUTPUT_POLL_MAX_MISSES)
            this.bgOutputFiles.delete(taskId);
          continue;
        }
        entry.misses = 0;
        this.adapter.updateBackgroundOutput(taskId, tail);
      }
      if (this.bgOutputFiles.size === 0) this.stopOutputPoll();
    }, LiveClaude.OUTPUT_POLL_MS);
    // A poll must never be the reason this process stays alive.
    this.outputPoll.unref();
  }

  // Learn a backgrounded shell's output path from the tool_result that announced it.
  private trackShellOutputPath(msg: SDKMessage): void {
    if (msg.type !== "user" || this.shellTaskByToolUse.size === 0) return;
    const content = (msg as { message?: { content?: unknown } }).message
      ?.content;
    if (!Array.isArray(content)) return;
    for (const raw of content) {
      const block = raw as {
        type?: string;
        tool_use_id?: string;
        content?: unknown;
      };
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string")
        continue;
      const taskId = this.shellTaskByToolUse.get(block.tool_use_id);
      if (!taskId) continue;
      this.shellTaskByToolUse.delete(block.tool_use_id);
      const text =
        typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content ?? "");
      const file = /(\/[^\s"']+\.output)/.exec(text)?.[1];
      if (!file) continue;
      this.bgOutputFiles.set(taskId, { file, misses: 0 });
      // Same path, two readers: the poll above feeds the transcript row, the registry
      // keeps it for the user's "View output" modal.
      noteExternalOutputFile({
        sessionId: this.sessionId,
        shellId: taskId,
        file,
      });
      this.startOutputPoll();
    }
  }
}

function statusOf(taskStatus: string): BgShellStatus {
  return taskStatus === "stopped" ? "exited-unknown" : "exited";
}

function exitCodeOf(taskStatus: string): number | null {
  return taskStatus === "completed" ? 0 : taskStatus === "failed" ? 1 : null;
}

// ── registry ────────────────────────────────────────────────────────────────

export function liveFor(sessionId: string): LiveClaude | undefined {
  const live = registry.get(sessionId);
  return live && !live.closed ? live : undefined;
}

// The live process this turn can run on, or undefined (the caller spawns one). A process
// that cannot serve the turn is CLOSED here, not left running beside its replacement:
// two CLIs on one session id would write the same JSONL.
//
//   config  — the HARD part of the config (tools, cwd, env, agent…) is fixed at spawn;
//             the soft part (model, effort, thinking, MCP) is applied live by the caller
//             via reconfigure();
//   session — the persisted resume handle must be exactly the CLI session this process
//             holds in memory (truncate / rewind / fork / a failed first turn all change
//             it, and the process would then answer from history that no longer exists);
//   token   — the OAuth token is frozen into the process env. A token that has since been
//             refreshed means the live one is within an hour of expiry, so a QUIET process
//             is replaced; one that still owns background work is kept (killing the work
//             to dodge a risk that is hours away is the worse trade — a wake that finds a
//             dead token fails visibly and the next turn respawns).
//
// `anyConfig`: a CLI-native command (`/compact`, `/context`…) reads the CLI's OWN session
// state and never reaches the model with this turn's tools/mode, so the live process serves
// it whatever config the caller assembled — `sessions.compact` builds a minimal one (mode
// `ask`, no MCP/agent overlay) that never matches a chat turn's fingerprint, and comparing
// it would respawn the CLI twice per /compact and kill any background task still running.
export function acquireLive(
  sessionId: string,
  wanted: {
    fingerprint: string;
    tokenKey: string;
    resume: string | undefined;
    anyConfig?: boolean;
  },
): LiveClaude | undefined {
  const live = registry.get(sessionId);
  if (!live) return undefined;
  if (live.closed) {
    registry.delete(sessionId);
    return undefined;
  }
  const why =
    wanted.anyConfig !== true && live.fingerprint !== wanted.fingerprint
      ? "spawn config changed"
      : live.cliSessionId !== wanted.resume
        ? "resume handle changed"
        : live.tokenKey !== wanted.tokenKey && live.waitingCount() === 0
          ? "credential rotated"
          : undefined;
  if (why === undefined) return live;
  live.close(why);
  return undefined;
}

export function closeLive(sessionId: string, reason: string): void {
  registry.get(sessionId)?.close(reason);
}

// store.removeSdkSession deletes a CLI session's artifacts (truncate, rewind, delete): a
// process still holding that session would write a file nobody reads, and answer from a
// history the user just removed.
export function closeLiveForCliSession(
  cliSessionId: string,
  reason: string,
): void {
  for (const live of [...registry.values()]) {
    if (live.cliSessionId === cliSessionId) live.close(reason);
  }
}

export function closeAllLive(reason: string): void {
  for (const live of [...registry.values()]) live.close(reason);
  if (reaper) clearInterval(reaper);
  reaper = undefined;
}

export function liveCount(): number {
  return registry.size;
}

// A spawn is about to add one more process. While that would exceed LIVE_MAX_PROCESSES,
// close the least-recently-used process that is safe to lose: no turn, no unsolicited
// turn, no live background task, no question parked on the human (the same condition
// the idle reaper uses — `idleForMs` undefined = protected). If every other process is
// protected the cap is EXCEEDED and logged: a CLI running someone's build is not ours to
// kill, and the idle reaper brings the count back down once the work settles.
// Synchronous with the caller's `new LiveClaude`, so two spawns cannot both see room.
export function makeRoomForSpawn(sessionId: string): void {
  const others = (): LiveClaude[] =>
    [...registry.values()].filter(
      (l) => !l.closed && l.sessionId !== sessionId,
    );
  while (others().length >= LIVE_MAX_PROCESSES) {
    const now = Date.now();
    let victim: LiveClaude | undefined;
    for (const l of others()) {
      if (l.idleForMs(now) === undefined) continue;
      if (!victim || l.lastUsedAt() < victim.lastUsedAt()) victim = l;
    }
    if (!victim) {
      log.warn(
        "claude-sdk: live process cap exceeded — every process owns work or a turn",
        {
          sessionId,
          liveCount: others().length,
          cap: LIVE_MAX_PROCESSES,
        },
      );
      return;
    }
    log.info("claude-sdk: evicting least-recently-used live process", {
      sessionId,
      evicted: victim.sessionId,
      idleMs: now - victim.lastUsedAt(),
      liveCount: others().length,
      cap: LIVE_MAX_PROCESSES,
    });
    victim.close("lru evicted");
  }
}

function sameRecord(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function reapIdle(now: number): void {
  for (const live of [...registry.values()]) {
    const idle = live.idleForMs(now);
    if (idle !== undefined && idle >= LIVE_IDLE_REAP_MS)
      live.close("idle reaper");
  }
}

function ensureReaper(): void {
  if (reaper) return;
  reaper = setInterval(() => reapIdle(Date.now()), 60_000);
  reaper.unref();
}

// Test seam: the reaper's sweep without waiting for its interval.
export function reapIdleLive(now: number): void {
  reapIdle(now);
}
