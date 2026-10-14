// Replay path for ADR 0097: for a session whose `transcriptSource === 'sdk'`,
// the message transcript lives ONLY in the Claude CLI file
// (`~/.claude/projects/<cwd-hash>/<sdkSessionId>.jsonl`) — AWOG's own
// session.jsonl carries just the index header. This module resolves that file
// and folds it into SessionMessage[] on load.
// Reuse: the main file AND subagent transcripts (`<sessionDir>/subagents/
// agent-*.jsonl`) both fold through `parseClaudeTranscript` — the same entry
// shapes the "Open in CLI" importer reads — with Task children tagged
// parentId = the Task call's tool_use_id (the nesting the UI builds from live
// `session.step` events). The parser lives in claude-transcript.ts, a LEAF
// module: this file hangs off session-manager's hydration path, so pulling in
// cli-import.ts or the live event adapter would drag cli-registry/node-pty/
// bridged-tools into that graph and corrupt module init order (observed:
// run-root test suite crashing in bridged.ts).
//
// Deterministic ids: messages get `sdk-<index>` (file order), not the parser's
// random `msg_cli_*` mints — a reload must reproduce the same ids or bookmarks
// and destructive anchors (rewind/resend cut points) would dangle. Live turns
// keep their runtime-minted ids; on reload the replayed id wins, so a bookmark
// placed mid-turn may not survive a restart (accepted, ADR 0097 cons).

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { log } from "../util/logger.js";
import type { SessionMessage, SessionStep } from "../types/shared.js";
import { sdkStoreDir } from "../runtime/claude-sdk/store.js";
import { parseClaudeTranscript } from "./claude-transcript.js";

const SDK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Scaffold blocks AWOG prepends to every turn prompt (run-stream.ts builds
// promptText = [plan-mode][background-work][todo-list][session_checklist]
// [response-style][current_state][history prefix] + raw user text). The CLI
// persists the WHOLE promptText on the user entry, so replayed user text needs
// the scaffold stripped — the user's own message is the suffix after the LAST
// scaffold close tag. All scaffolds are tag-wrapped; a turn without them keeps
// the whole text.
const SCAFFOLD_CLOSE_TAGS = [
  "</plan-mode>",
  "</background-work>",
  "</todo-list>",
  "</session_checklist>",
  "</response-style>",
  "</current_state>",
  "</summary_of_earlier_conversation>",
  "</conversation_so_far>",
];

// Everything after the last scaffold close tag; whole text when none matched.
function stripTurnScaffold(text: string): string {
  let cut = -1;
  for (const tag of SCAFFOLD_CLOSE_TAGS) {
    const idx = text.lastIndexOf(tag);
    if (idx >= 0) cut = Math.max(cut, idx + tag.length);
  }
  return (cut >= 0 ? text.slice(cut) : text).trim();
}

// Resolve `<projectsRoot>/<dir>/<sdkSessionId>.jsonl`, verifying the real path
// stays inside the projects root (a symlinked .jsonl pointing out is a
// read-anything surface — same guard as cli-import's insideRoot, sync because
// the cold-persist hydration path is sync).
function insideProjectsRoot(
  candidate: string,
  projectsRoot: string,
): string | undefined {
  try {
    const real = realpathSync(candidate);
    const root = realpathSync(projectsRoot);
    if (real !== root && !real.startsWith(root + sep)) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

// Locate the CLI transcript for one sdkSessionId. Fast path: the persisted
// `sdkSessionPath` header pointer (still re-validated inside projects/). Slow
// path: scan every project dir under the SDK store — the same scan
// cli-import's findClaudeTranscriptFile does, kept sync for the hydration
// boundary. Returns undefined when the transcript is gone (CLI cleanup,
// manual delete) — callers fall back to the AWOG body.
export function resolveSdkTranscriptPath(
  sdkSessionId: string,
  sdkSessionPath?: string,
): string | undefined {
  if (!SDK_ID_RE.test(sdkSessionId)) return undefined;
  const projects = join(sdkStoreDir(), "projects");
  if (sdkSessionPath) {
    const safe = insideProjectsRoot(sdkSessionPath, projects);
    if (safe) return safe;
  }
  let dirs: Dirent[];
  try {
    dirs = readdirSync(projects, { withFileTypes: true });
  } catch {
    return undefined; // no SDK store yet
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const candidate = join(projects, d.name, `${sdkSessionId}.jsonl`);
    try {
      if (!statSync(candidate).isFile()) continue;
    } catch {
      continue; // vanished mid-scan
    }
    const safe = insideProjectsRoot(candidate, projects);
    if (safe) return safe;
  }
  return undefined;
}

interface RawEntry {
  type?: string;
  isMeta?: boolean;
  uuid?: string;
  timestamp?: string;
  toolUseResult?: { agentId?: string };
  message?: { content?: unknown };
}

function contentBlocks(e: RawEntry): Record<string, unknown>[] {
  const c = e.message?.content;
  return Array.isArray(c) ? (c as Record<string, unknown>[]) : [];
}

// Replay one subagent transcript (`subagents/agent-<id>.jsonl`) through the
// shared parser with includeSidechain — every entry there is flagged
// sidechain — then flatten its steps tagged parentId = the Task call's
// tool_use_id (the nesting the UI builds from live `session.step` events).
// Subagent message TEXT stays on the subagent's own messages and is dropped
// here: it belongs to the subagent's bubble, not the parent's step list.
// (Replaces the old createClaudeEventAdapter replay: this module must stay a
// leaf — see the header note on init-order corruption.)
function replaySubagentSteps(
  agentFile: string,
  parentId: string,
): SessionStep[] {
  let text: string;
  try {
    text = readFileSync(agentFile, "utf-8");
  } catch {
    return [];
  }
  const { messages } = parseClaudeTranscript(text, undefined, {
    includeSidechain: true,
  });
  const steps: SessionStep[] = [];
  for (const m of messages) {
    for (const s of m.steps ?? []) {
      // Prefix ids with the parent Task call — ids minted per-file can collide
      // across subagents (think-<uuid> falls back to think-<index>), and the
      // steps array is flat across parents.
      steps.push({ ...s, id: `${parentId}:${s.id}`, parentId });
    }
  }
  return steps;
}

// Task tool_use_id → subagent transcript path, recovered from the Task call's
// tool_result (`toolUseResult.agentId`). The agent file sits in a sibling dir
// of the transcript: <dir>/<sessionId>.jsonl + <dir>/<sessionId>/subagents/.
function collectSubagentTargets(
  lines: string[],
  transcriptFile: string,
): Map<string, string> {
  const out = new Map<string, string>();
  const sessionStem = basename(transcriptFile).replace(/\.jsonl$/, "");
  const agentsRoot = join(dirname(transcriptFile), sessionStem, "subagents");
  for (const line of lines) {
    if (!line.includes('"tool_result"')) continue;
    let e: RawEntry;
    try {
      e = JSON.parse(line) as RawEntry;
    } catch {
      continue;
    }
    if (e.type !== "user") continue;
    const agentId = e.toolUseResult?.agentId;
    if (!agentId || !SDK_ID_RE.test(agentId)) continue;
    for (const b of contentBlocks(e)) {
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string")
        continue;
      const file = join(agentsRoot, `agent-${agentId}.jsonl`);
      if (existsSync(file)) out.set(b.tool_use_id, file);
    }
  }
  return out;
}

// Fold a CLI transcript file into SessionMessage[] (the session-store replay
// for transcriptSource === 'sdk'). Returns [] when the file is unreadable —
// the caller then falls back to whatever the AWOG body still holds.
export function readSdkTranscriptMessages(
  transcriptFile: string,
): SessionMessage[] {
  let lines: string[];
  try {
    lines = readFileSync(transcriptFile, "utf-8").split("\n");
  } catch (err) {
    log.warn("sdk-transcript: failed to read transcript", {
      file: transcriptFile,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  const parsed = parseClaudeTranscript(lines.join("\n"), undefined, {
    compactMarkers: true,
  });
  const subagents = collectSubagentTargets(lines, transcriptFile);
  const out: SessionMessage[] = [];
  let idx = 0;
  for (const m of parsed.messages) {
    // Deterministic id + strip the CLI-import badge (these are NATIVE session
    // messages now, not imported history) + strip prompt scaffolds off user text.
    const id = `sdk-${idx}`;
    if (m.role === "user") m.text = stripTurnScaffold(m.text);
    const { via: _via, ...rest } = m;
    const next: SessionMessage = { ...rest, id };
    // Attach subagent children to the Task step that spawned them.
    if (next.steps) {
      const children: SessionStep[] = [];
      for (const s of next.steps) {
        const file = s.kind === "tool" ? subagents.get(s.id) : undefined;
        if (file) children.push(...replaySubagentSteps(file, s.id));
      }
      if (children.length > 0) next.steps = [...next.steps, ...children];
    }
    out.push(next);
    idx += 1;
  }
  return out;
}

// Coverage probe for the pointer-mode cutover (ADR 0097 rollout): true when
// the CLI transcript already carries every user message the AWOG body holds —
// i.e. dropping the AWOG body loses nothing. Compared on raw (scaffold-
// stripped, whitespace-normalised) user text; agent text is a consequence of
// the user turn, so matching user turns is the meaningful invariant.
export function sdkTranscriptCoversSession(
  transcriptFile: string,
  existing: readonly SessionMessage[],
): boolean {
  const replayed = readSdkTranscriptMessages(transcriptFile).filter(
    (m) => m.role === "user",
  );
  const known = existing.filter((m) => m.role === "user");
  const norm = (s: string): string => s.replace(/\s+/g, "");
  // Multiset of REPLAYED user texts: every message AWOG persisted must be
  // present in the CLI transcript (existing ⊆ replayed) — extra replayed turns
  // (e.g. continued in the CLI) are fine, missing ones are not.
  const pool = new Map<string, number>();
  for (const m of replayed) {
    const k = norm(m.text);
    pool.set(k, (pool.get(k) ?? 0) + 1);
  }
  for (const m of known) {
    const k = norm(m.text);
    const left = pool.get(k);
    if (!left) return false;
    if (left === 1) pool.delete(k);
    else pool.set(k, left - 1);
  }
  return true;
}
