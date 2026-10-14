// Parser for the Claude Code/Agent-SDK persisted JSONL transcript — extracted
// from cli-import.ts so BOTH consumers share one fold without dragging each
// other's dependencies into their module graph:
//
//   - cli-import.ts ("Open in CLI" importer) — async, heavy deps (cli-registry,
//     store facade, codex home…)
//   - sdk-transcript.ts (ADR 0097 session-source replay) — SYNC, hangs directly
//     off session-manager's hydration path, so it must stay a leaf.
//
// Contents: the Claude entry fold (TurnAcc → SessionMessage), the small
// as*/mint helpers it needs, and nothing else. step-mapper is the only
// non-trivial dependency (tool/thinking/question step shapes).

import { randomBytes } from "node:crypto";
import {
  stepFromThinking,
  stepFromToolResult,
  stepFromToolUse,
} from "./step-mapper.js";
import type {
  NativeCompaction,
  SessionCliKind,
  SessionMessage,
  SessionMessagePart,
  SessionStep,
} from "../types/shared.js";

export type JsonObject = Record<string, unknown>;

export function asObject(v: unknown): JsonObject | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as JsonObject)
    : undefined;
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function mintCliMessageId(): string {
  // Charset [a-z0-9_-] thỏa MESSAGE_ID_RE — message id đi vào sink đường dẫn
  // attachments (sessions/ids.ts), không được mang ký tự lạ.
  return `msg_cli_${randomBytes(6).toString("hex")}`;
}

// Entry timestamp: ISO string (cả 'Z' lẫn '+00:00') → ms; không parse được →
// undefined thay vì NaN rò vào filter.
export function entryMs(v: unknown): number | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : undefined;
}

export interface CliParseResult {
  messages: SessionMessage[];
  // Entry bị bỏ qua, đếm theo lý do — importer log MỘT lần; một dòng hỏng/lạ
  // không bao giờ được làm cả lần sync đổ.
  skipped: Map<string, number>;
}

export function bump(skipped: Map<string, number>, key: string): void {
  skipped.set(key, (skipped.get(key) ?? 0) + 1);
}

// Tích luỹ MỘT lượt agent: các entry assistant/response-item liên tiếp gộp
// thành MỘT SessionMessage — cùng khuôn với một turn AWOG (text + steps +
// usage + modelUsed). `parts` giữ thứ tự text↔step để UI render đan xen đúng
// thứ tự thay vì dồn text lên đầu; `pendingCalls` nhớ tool_use chưa thấy
// output để *_output/tool_result gập vào ĐÚNG step thay vì thành message rời.
export interface TurnAcc {
  parts: SessionMessagePart[];
  texts: string[];
  steps: SessionStep[];
  pendingCalls: Map<
    string,
    { name: string; input: JsonObject; step: SessionStep }
  >;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  // Prompt size of the LAST request (input+cacheRead+cacheWrite — SessionMessage
  // .usage.contextTokens) and of the FIRST (baseTokens): keeps the context gauge
  // meaningful on a replayed transcript, where no `result` frame exists.
  contextTokens: number;
  baseTokens: number;
  model?: string;
  at?: string;
}

export function newTurn(): TurnAcc {
  return {
    parts: [],
    texts: [],
    steps: [],
    pendingCalls: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextTokens: 0,
    baseTokens: 0,
  };
}

export function appendTurnText(t: TurnAcc, text: string): void {
  t.texts.push(text);
  const last = t.parts[t.parts.length - 1];
  if (last && last.kind === "text") {
    last.text = `${last.text}\n${text}`;
  } else {
    t.parts.push({ kind: "text", text });
  }
}

export function pushTurnStep(t: TurnAcc, step: SessionStep): void {
  t.steps.push(step);
  t.parts.push(step);
}

export function flushTurn(
  t: TurnAcc,
  via: SessionCliKind | undefined,
  out: SessionMessage[],
): void {
  // Transcript là lịch sử: mọi step còn treo 'running' (tool_use chưa có
  // tool_result trong phần file đã đọc) kết là 'done' — không có "đang chạy"
  // khi xem lại, và step treo sẽ quay spinner mãi trong UI.
  for (const s of t.steps) {
    if (s.status === "running") s.status = "done";
  }
  const text = t.texts.join("\n").trim();
  if (!text && t.steps.length === 0) return; // turn trống (entry assistant rỗng)
  const msg: SessionMessage = {
    id: mintCliMessageId(),
    role: "agent",
    text,
    at: t.at ?? new Date().toISOString(),
    ...(via ? { via } : {}),
  };
  if (t.steps.length > 0) msg.steps = t.steps;
  if (t.parts.length > 0) msg.parts = t.parts;
  if (
    t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens >
    0
  ) {
    msg.usage = {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      ...(t.cacheReadTokens > 0 ? { cacheReadTokens: t.cacheReadTokens } : {}),
      ...(t.cacheWriteTokens > 0
        ? { cacheWriteTokens: t.cacheWriteTokens }
        : {}),
      ...(t.contextTokens > 0 ? { contextTokens: t.contextTokens } : {}),
      ...(t.baseTokens > 0 ? { baseTokens: t.baseTokens } : {}),
    };
  }
  if (t.model) msg.modelUsed = t.model;
  out.push(msg);
}

export function cliUserMessage(
  text: string,
  at: string | undefined,
  via: SessionCliKind | undefined,
): SessionMessage {
  return {
    id: mintCliMessageId(),
    role: "user",
    text,
    at: at ?? new Date().toISOString(),
    ...(via ? { via } : {}),
  };
}

// Trừ multiset các message transcript AWOG ĐÃ có (key = role + text bỏ hết
// whitespace — khoảng trắng/newline khác nhau giữa hai nguồn không được đánh
// lừa dedupe). Chỉ áp dụng trên file "shared history": file đó chứa nguyên
// các lượt AWOG đã chạy nên text trùng CHẮC CHẮN là bản sao.
//
// Ngoại lệ USER: runtime prepend scaffold (history prefix `<conversation_so_far>`
// / `<summary_of_earlier_conversation>`, `<current_state>`, style/checklist/plan
// prompt…) TRƯỚC chữ thô user gõ — file transcript giữ bản scaffold còn AWOG
// chỉ persist text thô. Vì scaffold luôn nằm TRƯỚC, text thô là SUFFIX của bản
// transcript → khớp đuôi (sau khi exact miss) cho role 'user' khi text stored
// đã chuẩn hoá ≥ 3 ký tự. Assistant giữ exact-only: scaffold không đụng text
// của nó, và suffix trên assistant sẽ nuốt cả các câu trả lời CLI thật tình cờ
// trùng đuôi (không có bound nào để phân biệt).
const SUFFIX_DEDUPE_MIN_LEN = 3;

export function subtractKnownMessages(
  imported: SessionMessage[],
  existing: SessionMessage[],
): SessionMessage[] {
  const norm = (s: string): string => s.replace(/\s+/g, "");
  const keyOf = (m: SessionMessage): string => `${m.role}:${norm(m.text)}`;
  const pool = new Map<string, number>();
  // Text user đã persist — pool suffix (mỗi entry vẫn bị cùng multiset đếm qua
  // `pool`, nên bản trùng stored không khớp quá số lần nó xuất hiện).
  const userTexts: { norm: string; key: string }[] = [];
  for (const m of existing) {
    const key = keyOf(m);
    pool.set(key, (pool.get(key) ?? 0) + 1);
    if (m.role === "user") userTexts.push({ norm: norm(m.text), key });
  }
  const out: SessionMessage[] = [];
  for (const m of imported) {
    const key = keyOf(m);
    const left = pool.get(key) ?? 0;
    if (left > 0) {
      pool.set(key, left - 1);
      continue; // bản sao của một lượt AWOG đã có — không append lần hai
    }
    if (m.role === "user") {
      const n = norm(m.text);
      const hit = userTexts.find(
        (u) =>
          u.norm.length >= SUFFIX_DEDUPE_MIN_LEN &&
          n.endsWith(u.norm) &&
          (pool.get(u.key) ?? 0) > 0,
      );
      if (hit) {
        pool.set(hit.key, (pool.get(hit.key) ?? 0) - 1);
        continue; // bản scaffold của một user-turn AWOG đã lưu — bỏ
      }
    }
    out.push(m);
  }
  return out;
}

// `compact_metadata` (live SDK message, snake_case) / `compactMetadata` (CLI JSONL
// entry, camelCase) → NativeCompaction. Cả hai dạng cùng một hàm để marker live và
// marker replay không lệch nhau. Thiếu/ sai `trigger` hoặc `preTokens` ⇒ undefined
// (không bịa số).
export function nativeCompactionFromMetadata(
  raw: unknown,
): NativeCompaction | undefined {
  const m = asObject(raw);
  if (!m) return undefined;
  const trigger = m.trigger;
  if (trigger !== "manual" && trigger !== "auto") return undefined;
  const preTokens = asNumber(m.preTokens) ?? asNumber(m.pre_tokens);
  if (preTokens === undefined) return undefined;
  const postTokens = asNumber(m.postTokens) ?? asNumber(m.post_tokens);
  const durationMs = asNumber(m.durationMs) ?? asNumber(m.duration_ms);
  return {
    trigger,
    preTokens,
    ...(postTokens !== undefined ? { postTokens } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

// Hai dòng user mà `/compact` thủ công để lại trong JSONL của CLI (đo thật):
// `<command-name>/compact</command-name>…` và `<local-command-stdout>Compacted …`.
function isCompactCommandEcho(content: unknown): boolean {
  return (
    typeof content === "string" &&
    (content.startsWith("<command-name>/compact") ||
      content.startsWith("<local-command-stdout>Compacted"))
  );
}

// ─── Claude JSONL parser ─────────────────────────────────────────────────────

// Khuôn entry Claude Code: {type:'user'|'assistant'|'summary'|..., uuid,
// parentUuid, timestamp, isMeta?, isSidechain?, message:{role,content,model?,
// usage?}}. Lọc meta/tool_result; gộp các entry assistant liên tiếp thành một
// turn (text + tool_use steps + usage cộng dồn + model cuối).
//
// `includeSidechain`: file subagent (`subagents/agent-*.jsonl`) đánh dấu MỌI
// entry là sidechain — replay file đó cần bật cờ này, còn file chính giữ tắt.
export function parseClaudeTranscript(
  text: string,
  sinceMs?: number,
  opts?: { includeSidechain?: boolean; compactMarkers?: boolean },
): CliParseResult {
  const out: SessionMessage[] = [];
  const skipped = new Map<string, number>();
  let turn: TurnAcc | undefined;
  const openTurn = (): TurnAcc => (turn ??= newTurn());
  const flush = (): void => {
    if (turn) {
      flushTurn(turn, "claude", out);
      turn = undefined;
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      bump(skipped, "unparseable");
      continue;
    }
    const e = asObject(entry);
    if (!e) {
      bump(skipped, "non-object");
      continue;
    }
    if (e.isMeta === true) {
      bump(skipped, "meta");
      continue;
    }
    if (e.isSidechain === true && opts?.includeSidechain !== true) {
      bump(skipped, "sidechain");
      continue;
    }
    // Sàn spawn-time (chỉ khi mở file từ offset 0 trên shared history): entry
    // trước lúc CLI mở là lượt AWOG cũ — có timestamp thì lọc, không có thì giữ
    // (không định tuổi được thì không gán là "cũ").
    if (sinceMs !== undefined) {
      const ms = entryMs(e.timestamp);
      if (ms !== undefined && ms < sinceMs) {
        bump(skipped, "pre-spawn");
        continue;
      }
    }
    const ts = asString(e.timestamp);

    // Native compaction của CLI. Ba loại entry, ba cách xử lý:
    //  - `system/compact_boundary`: điểm nén → (nếu opts.compactMarkers) một message
    //    `system` mang số liệu để UI vẽ vạch ngăn. Lần nén thủ công đến SAU một lượt đã
    //    xong nên flush trước (marker nằm sau lượt đó); lần tự nén xảy ra GIỮA lượt đang
    //    mở nên không flush — marker đứng trước bubble agent của lượt, khớp chỗ UI chèn
    //    lúc live.
    //  - `isCompactSummary`: bản tóm tắt CLI tự sinh để nuôi model ("This session is
    //    being continued…") — không phải lời người dùng, bỏ.
    //  - hai dòng echo của `/compact` thủ công (`<command-name>/compact…`,
    //    `<local-command-stdout>Compacted…`) — nhiễu của CLI, bỏ.
    if (e.type === "system" && e.subtype === "compact_boundary") {
      if (opts?.compactMarkers === true) {
        const compaction = nativeCompactionFromMetadata(e.compactMetadata);
        if (compaction) {
          if (compaction.trigger === "manual") flush();
          out.push({
            id: mintCliMessageId(),
            role: "system",
            text: "Context compacted",
            at: ts ?? new Date().toISOString(),
            compaction,
          });
        }
      }
      continue;
    }
    if (e.isCompactSummary === true) {
      bump(skipped, "compact-summary");
      continue;
    }
    if (
      e.type === "user" &&
      isCompactCommandEcho(asObject(e.message)?.content)
    ) {
      bump(skipped, "compact-echo");
      continue;
    }

    // Thông báo task nền xong mà CLI tự chèn để đánh thức model (ADR 0099 — tiến
    // trình CLI sống lâu). Nó là user-entry nhưng KHÔNG phải lời người dùng: để
    // nguyên thì sau khi tải lại, transcript hiện một bubble XML `<task-notification>`
    // thô. Thu về một dòng hệ thống mang `<summary>` mà CLI đã viết sẵn.
    if (e.type === "user" && asObject(e.origin)?.kind === "task-notification") {
      flush();
      const raw = asObject(e.message)?.content;
      const body =
        typeof raw === "string"
          ? raw
          : asArray(raw)
              .map((b) => asString(asObject(b)?.text) ?? "")
              .join("\n");
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(body)?.[1]?.trim();
      out.push({
        id: mintCliMessageId(),
        role: "system",
        text: summary || "Background task finished",
        at: ts ?? new Date().toISOString(),
      });
      continue;
    }

    if (e.type === "user") {
      const message = asObject(e.message);
      const content = message?.content;
      if (typeof content === "string") {
        flush();
        if (content.trim()) out.push(cliUserMessage(content, ts, "claude"));
        else bump(skipped, "user:empty");
        continue;
      }
      const blocks = asArray(content);
      const isToolResults =
        blocks.length > 0 &&
        blocks.every((b) => asObject(b)?.type === "tool_result");
      if (isToolResults) {
        // tool_result nằm TRONG user-entry nhưng là output của tool_use lượt
        // trước → gập vào step đang treo, KHÔNG sinh user message.
        for (const b of blocks) foldClaudeToolResult(b, turn, skipped);
        continue;
      }
      if (blocks.length === 0) {
        bump(skipped, "user:empty");
        continue;
      }
      flush();
      const text = blocks
        .map((b) => asObject(b))
        .filter((b): b is JsonObject => b !== undefined && b.type === "text")
        .map((b) => asString(b.text) ?? "")
        .join("\n")
        .trim();
      if (text) out.push(cliUserMessage(text, ts, "claude"));
      else bump(skipped, "user:no-text"); // user entry chỉ có image/document
      continue;
    }

    if (e.type === "assistant") {
      const message = asObject(e.message);
      if (!message) {
        bump(skipped, "assistant:no-message");
        continue;
      }
      const t = openTurn();
      if (ts) t.at = ts; // timestamp CUỐI của turn thắng — gần lúc hoàn thành nhất
      const model = asString(message.model);
      if (model) t.model = model;
      const usage = asObject(message.usage);
      if (usage) {
        t.inputTokens += asNumber(usage.input_tokens) ?? 0;
        t.outputTokens += asNumber(usage.output_tokens) ?? 0;
        t.cacheReadTokens += asNumber(usage.cache_read_input_tokens) ?? 0;
        t.cacheWriteTokens += asNumber(usage.cache_creation_input_tokens) ?? 0;
        // Per-request prompt size: the LAST assistant entry's usage is the turn's
        // peak occupancy (contextTokens); the FIRST is the standing cost
        // (baseTokens). Mirrors the live adapter's accumulator.
        t.contextTokens =
          (asNumber(usage.input_tokens) ?? 0) +
          (asNumber(usage.cache_read_input_tokens) ?? 0) +
          (asNumber(usage.cache_creation_input_tokens) ?? 0);
        if (t.baseTokens === 0) t.baseTokens = t.contextTokens;
      }
      for (const b of asArray(message.content)) {
        const block = asObject(b);
        if (!block) continue;
        const type = block.type;
        if (type === "text") {
          const s = asString(block.text);
          if (s) appendTurnText(t, s);
        } else if (type === "thinking") {
          const s = asString(block.thinking);
          if (s) {
            const id = asString(e.uuid) ?? `think-${t.steps.length}`;
            pushTurnStep(t, stepFromThinking(`think-${id}`, s, true));
          }
        } else if (type === "tool_use") {
          addToolUseStep(t, block, asString(e.uuid), skipped);
        } else {
          bump(skipped, `block:${String(type)}`);
        }
      }
      continue;
    }

    bump(skipped, `type:${String(e.type)}`);
  }
  flush();
  return { messages: out, skipped };
}

function addToolUseStep(
  t: TurnAcc,
  block: JsonObject,
  entryUuid: string | undefined,
  skipped: Map<string, number>,
): void {
  const name = asString(block.name);
  if (!name) {
    bump(skipped, "tool_use:no-name");
    return;
  }
  const id = asString(block.id) ?? `${entryUuid ?? "cli"}-tu${t.steps.length}`;
  const input = asObject(block.input) ?? {};
  const step = stepFromToolUse({ id, name, input });
  t.pendingCalls.set(id, { name, input, step });
  pushTurnStep(t, step);
}

// tool_result của Claude gập vào step đang treo cùng tool_use_id (nhìn thấy
// ở phần file trước); mồ côi (turn trước đã flush hoặc file cắt giữa chừng)
// thì bỏ — một result không có call thì không render được thành step có nghĩa.
function foldClaudeToolResult(
  rawBlock: unknown,
  turn: TurnAcc | undefined,
  skipped: Map<string, number>,
): void {
  const block = asObject(rawBlock);
  if (!block) return;
  const toolUseId = asString(block.tool_use_id);
  const pending = toolUseId ? turn?.pendingCalls.get(toolUseId) : undefined;
  if (!pending || !toolUseId) {
    bump(skipped, "tool_result:orphan");
    return;
  }
  const done = stepFromToolResult({
    toolUseId,
    toolName: pending.name,
    toolInput: pending.input,
    content: block.content,
    isError: block.is_error === true,
  });
  // Object.assign giữ object identity — step đã nằm trong steps[] và parts[]
  // nên cập nhật tại chỗ giữ đúng vị trí timeline.
  Object.assign(pending.step, done);
  turn?.pendingCalls.delete(toolUseId);
}
