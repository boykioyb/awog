// Nhập phiên từ Claude Desktop / Claude CLI (terminal) vào AWOG — ADR 0102,
// docs/features/claude-session-import.md.
//
// Hai việc, cùng một nguồn dữ liệu (`<claudeHome>/projects/<cwd-slug>/<uuid>.jsonl`):
//
//   1. `listClaudeSessions` — quét transcript, chỉ giữ file do Desktop (`entrypoint`
//      `claude-desktop`) hoặc CLI terminal (`cli`) viết VÀ có cwd nằm trong một project AWOG.
//      `sdk-ts` bị loại: đó là chính phiên Agent-SDK của AWOG (đã là phiên AWOG, khoá bằng
//      `Session.sdkSessionId`); các entrypoint lạ khác (sdk-cli, sdk-py…) cũng loại.
//   2. `importClaudeSessions` — tạo phiên AWOG ở chế độ pointer (ADR 0097): header chỉ là chỉ
//      mục, transcript CLI là nguồn thật. Vì vậy Desktop/CLI làm tiếp ở bên kia thì AWOG
//      thấy lượt mới; `refreshImportedSessions` kéo `updatedAt`/messages theo mtime file.
//
// Transcript là dữ liệu L2 (tool khác viết, người dùng sửa được) — mọi dòng parse phòng thủ,
// một dòng hỏng chỉ bị đếm + bỏ qua, không bao giờ làm đổ cả lần quét.
//
// Hiệu năng: file KHÔNG khớp (sdk-ts chiếm đa số) chỉ bị đọc tới dòng đầu có `entrypoint`
// rồi bỏ; file khớp được quét tuần tự theo dòng bằng kiểm tra chuỗi con (JSON.parse chỉ cho
// vài dòng cần: tiêu đề, dòng đầu/cuối, dòng user đầu). Kết quả cache theo
// (path, size, mtime) nên lần mở hộp thoại sau gần như tức thì.

import type { Dirent } from "node:fs";
import {
  open,
  readdir,
  realpath,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { log } from "../util/logger.js";
import { claudeHome } from "../util/path.js";
import { listProjects } from "../projects/store.js";
import { emit } from "../transport/stdio.js";
import type {
  Session,
  SessionImportedFrom,
  SessionSettings,
} from "../types/shared.js";
import { sessionManager } from "./session-manager.js";
import {
  readSdkTranscriptMessages,
  resolveSdkTranscriptPath,
} from "./sdk-transcript.js";

export type ClaudeSessionSource = SessionImportedFrom["kind"];

// Entrypoint trong transcript → nguồn. Chỉ hai nguồn này được nhập (quyết định của user).
const SOURCE_BY_ENTRYPOINT: Readonly<Record<string, ClaudeSessionSource>> = {
  "claude-desktop": "claude-desktop",
  cli: "cli",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LIST_DEFAULT_DAYS = 30;
export const LIST_MAX_DAYS = 180;
export const LIST_MAX_ITEMS = 300;
export const IMPORT_MAX_IDS = 50;

// Đã đọc quá chừng này byte mà chưa gặp dòng nào có `entrypoint` ⇒ không phải transcript hội
// thoại (chỉ queue-operation/file-history…) — thôi, đừng đọc cả file.
const HEAD_SCAN_CAP_CHARS = 8 * 1024 * 1024;
// Quét song song vài file; I/O tuần tự theo từng file.
const SCAN_CONCURRENCY = 4;
const READ_CHUNK_BYTES = 1024 * 1024;
const TAIL_READ_BYTES = 1024 * 1024;
// Hai mốc thời gian lệch nhau dưới ngưỡng này coi là cùng một lần ghi (đồng hồ/độ phân giải
// mtime) — dùng khi so mtime transcript với `updatedAt` của phiên.
const STALE_SLACK_MS = 2000;
const DEFAULT_IMPORT_MODEL = "claude-opus-5";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClaudeSessionItem {
  id: string;
  entrypoint: ClaudeSessionSource;
  title: string;
  cwd: string;
  gitBranch?: string;
  projectId: string;
  projectName: string;
  firstAt: string;
  lastAt: string;
  userTurns: number;
  importedSessionId?: string;
}

export interface ClaudeSessionListResult {
  items: ClaudeSessionItem[];
  skipped: { noProject: number; unreadable: number };
}

export interface ClaudeImportResult {
  imported: { id: string; sessionId: string }[];
  skipped: { id: string; reason: string }[];
}

interface TranscriptFacts {
  entrypoint: ClaudeSessionSource;
  cwd: string;
  gitBranch?: string;
  title: string;
  firstAt: string;
  lastAt: string;
  userTurns: number;
  model?: string;
}

type ScanOutcome =
  | { status: "ok"; facts: TranscriptFacts }
  | { status: "foreign" } // entrypoint khác desktop/cli (sdk-ts…)
  | { status: "empty" } // không có lượt hội thoại / không có entrypoint
  | { status: "unreadable" }; // lỗi I/O, hoặc dòng entrypoint hỏng và không có dòng nào khác

// ─── Line reader ─────────────────────────────────────────────────────────────

// Đọc file theo khối 1MB, tách dòng ở mức Buffer rồi mới decode UTF-8 (khối có thể cắt giữa
// một ký tự đa byte). `fn` trả `false` ⇒ dừng sớm.
async function forEachLine(
  file: string,
  fn: (line: string) => boolean | void,
): Promise<void> {
  const fh = await open(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let carry: Buffer[] = [];
    let pos = 0;
    for (;;) {
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
      if (bytesRead === 0) break;
      pos += bytesRead;
      const view = chunk.subarray(0, bytesRead);
      let start = 0;
      for (;;) {
        const nl = view.indexOf(10, start);
        if (nl < 0) {
          carry.push(Buffer.from(view.subarray(start)));
          break;
        }
        const part = view.subarray(start, nl);
        const line = carry.length
          ? Buffer.concat([...carry, part]).toString("utf8")
          : part.toString("utf8");
        carry = [];
        if (fn(line) === false) return;
        start = nl + 1;
      }
    }
    if (carry.length) fn(Buffer.concat(carry).toString("utf8"));
  } finally {
    await fh.close();
  }
}

function parseObject(line: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(line) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function isValidIso(s: unknown): s is string {
  return typeof s === "string" && Number.isFinite(Date.parse(s));
}

// Dòng user đếm là "lượt người dùng": loại kết quả tool, meta, sidechain (subagent), tóm tắt
// compact. Kiểm tra chuỗi con — KHÔNG parse — nên là số ƯỚC LƯỢNG (đủ cho cột "N lượt" +
// điều kiện "có hoạt động"), không phải đếm tuyệt đối. Chuỗi trong nội dung bị JSON-escape
// (`\"tool_result\"`) nên không khớp nhầm.
function isCountableUserLine(line: string): boolean {
  return (
    !line.includes('"tool_result"') &&
    !line.includes('"isMeta":true') &&
    !line.includes('"isSidechain":true') &&
    !line.includes('"isCompactSummary":true')
  );
}

// Đọc một field của giá trị chưa biết kiểu (L2) mà không bịa shape.
function prop(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function firstUserText(obj: Record<string, unknown>): string | undefined {
  const content = prop(obj.message, "content");
  let text: string | undefined;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    for (const b of content) {
      const t = prop(b, "text");
      if (prop(b, "type") === "text" && typeof t === "string") {
        text = t;
        break;
      }
    }
  }
  if (!text) return undefined;
  const clean = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, 80) : undefined;
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

async function scanTranscript(file: string): Promise<ScanOutcome> {
  let entrypoint: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let customTitle: string | undefined;
  let turns = 0;
  let bad = 0;
  let consumed = 0;
  let foreign = false;
  let firstActivity: string | undefined;
  let lastActivity: string | undefined;
  let lastAssistant: string | undefined;
  const userCandidates: string[] = []; // vài dòng user đầu: dòng đầu có thể hỏng, thử tiếp

  try {
    await forEachLine(file, (line) => {
      consumed += line.length;
      if (entrypoint === undefined) {
        if (line.includes('"entrypoint":"')) {
          const obj = parseObject(line);
          if (!obj) bad += 1;
          else if (typeof obj.entrypoint === "string") {
            entrypoint = obj.entrypoint;
            if (typeof obj.cwd === "string") cwd = obj.cwd;
            if (typeof obj.gitBranch === "string" && obj.gitBranch)
              gitBranch = obj.gitBranch;
            if (!(entrypoint in SOURCE_BY_ENTRYPOINT)) {
              foreign = true;
              return false;
            }
          }
        } else if (consumed > HEAD_SCAN_CAP_CHARS) {
          return false;
        }
      }

      if (line.startsWith('{"type":"custom-title"')) {
        const obj = parseObject(line);
        if (
          obj &&
          typeof obj.customTitle === "string" &&
          obj.customTitle.trim()
        ) {
          customTitle = obj.customTitle.trim();
        } else if (!obj) bad += 1;
        return;
      }
      const isUser = line.includes('"type":"user"');
      const isAssistant = !isUser && line.includes('"type":"assistant"');
      if (!isUser && !isAssistant) return;
      firstActivity ??= line;
      lastActivity = line;
      if (isAssistant) lastAssistant = line;
      else if (isCountableUserLine(line)) {
        turns += 1;
        if (userCandidates.length < 3) userCandidates.push(line);
      }
      return;
    });
  } catch (err) {
    log.warn("claude-import: failed to read transcript", {
      file,
      err: err instanceof Error ? err.message : String(err),
    });
    return { status: "unreadable" };
  }

  if (foreign) return { status: "foreign" };
  if (entrypoint === undefined || cwd === undefined) {
    return bad > 0 ? { status: "unreadable" } : { status: "empty" };
  }
  if (turns === 0) return { status: "empty" };

  // Timestamp ở hai đầu parse CHÍNH XÁC (dòng nhiều MB chỉ parse đúng 2–3 lần mỗi file).
  const tsOf = (line: string | undefined): string | undefined => {
    const ts = line ? parseObject(line)?.timestamp : undefined;
    return isValidIso(ts) ? ts : undefined;
  };
  const st = await stat(file).catch(() => undefined);
  const mtimeIso = st
    ? new Date(st.mtimeMs).toISOString()
    : new Date(0).toISOString();
  const firstAt = tsOf(firstActivity) ?? mtimeIso;
  const lastAt = tsOf(lastActivity) ?? mtimeIso;

  let fallbackTitle: string | undefined;
  for (const line of userCandidates) {
    fallbackTitle = firstUserText(parseObject(line) ?? {});
    if (fallbackTitle) break;
  }
  const modelRaw = prop(
    prop(lastAssistant ? parseObject(lastAssistant) : undefined, "message"),
    "model",
  );
  const model =
    typeof modelRaw === "string" && modelRaw && !modelRaw.startsWith("<")
      ? modelRaw
      : undefined;

  const facts: TranscriptFacts = {
    entrypoint: SOURCE_BY_ENTRYPOINT[entrypoint]!,
    cwd,
    title: customTitle ?? fallbackTitle ?? "Claude session",
    firstAt,
    lastAt,
    userTurns: turns,
  };
  if (gitBranch) facts.gitBranch = gitBranch;
  if (model) facts.model = model;
  return { status: "ok", facts };
}

// Cache theo (path,size,mtime): file đã đổi thì tự mất hiệu lực. Giữ cả kết quả "foreign" để
// 350 file sdk-ts không bị mở lại mỗi lần.
const scanCache = new Map<
  string,
  { size: number; mtimeMs: number; outcome: ScanOutcome }
>();

async function scanCached(
  file: string,
  size: number,
  mtimeMs: number,
): Promise<ScanOutcome> {
  const hit = scanCache.get(file);
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.outcome;
  const outcome = await scanTranscript(file);
  scanCache.set(file, { size, mtimeMs, outcome });
  return outcome;
}

// ─── Project resolution ──────────────────────────────────────────────────────

interface ProjectRoot {
  id: string;
  name: string;
  root: string;
}

async function realOrResolved(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return resolve(p);
  }
}

// Longest-prefix: project lồng nhau (monorepo con) thắng project cha.
async function loadProjectRoots(): Promise<ProjectRoot[]> {
  const projects = await listProjects();
  const roots = await Promise.all(
    projects
      .filter((p) => typeof p.path === "string" && p.path.length > 0)
      .map(async (p) => ({
        id: p.id,
        name: p.name,
        root: await realOrResolved(p.path),
      })),
  );
  return roots.sort((a, b) => b.root.length - a.root.length);
}

function matchProject(
  roots: ProjectRoot[],
  cwdReal: string,
): ProjectRoot | undefined {
  return roots.find(
    (r) => cwdReal === r.root || cwdReal.startsWith(r.root + sep),
  );
}

// ─── list ────────────────────────────────────────────────────────────────────

interface Candidate {
  file: string;
  id: string;
  size: number;
  mtimeMs: number;
}

async function listCandidates(cutoffMs: number): Promise<Candidate[]> {
  const projectsRoot = join(claudeHome(), "projects");
  let dirs: Dirent[];
  try {
    dirs = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Candidate[] = [];
  await Promise.all(
    dirs
      // isDirectory()/isFile() trên Dirent KHÔNG theo symlink ⇒ symlink bị bỏ, không cần
      // realpath để chặn thoát khỏi projects/.
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dir = join(projectsRoot, d.name);
        let files: Dirent[];
        try {
          files = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
          const id = f.name.slice(0, -".jsonl".length);
          if (!UUID_RE.test(id)) continue;
          const file = join(dir, f.name);
          try {
            const st = await stat(file);
            if (st.mtimeMs >= cutoffMs)
              out.push({ file, id, size: st.size, mtimeMs: st.mtimeMs });
          } catch {
            // biến mất giữa lúc quét
          }
        }
      }),
  );
  return out;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export async function listClaudeSessions(opts?: {
  days?: number;
}): Promise<ClaudeSessionListResult> {
  const days = Math.min(
    Math.max(Math.floor(opts?.days ?? LIST_DEFAULT_DAYS), 1),
    LIST_MAX_DAYS,
  );
  const cutoffMs = Date.now() - days * 86_400_000;
  await sessionManager.ensureLoaded();
  const [candidates, roots] = await Promise.all([
    listCandidates(cutoffMs),
    loadProjectRoots(),
  ]);
  const imported = sessionManager.getSdkSessionIndex();
  const realCwd = new Map<string, Promise<string>>();
  const cwdReal = (cwd: string): Promise<string> => {
    let p = realCwd.get(cwd);
    if (!p) {
      p = realOrResolved(cwd);
      realCwd.set(cwd, p);
    }
    return p;
  };

  const skipped = { noProject: 0, unreadable: 0 };
  const items: ClaudeSessionItem[] = [];
  const outcomes = await mapPool(candidates, SCAN_CONCURRENCY, async (c) => ({
    c,
    outcome: await scanCached(c.file, c.size, c.mtimeMs),
  }));
  for (const { c, outcome } of outcomes) {
    if (outcome.status === "unreadable") skipped.unreadable += 1;
    if (outcome.status !== "ok") continue;
    const f = outcome.facts;
    // mtime chỉ là lọc thô cho rẻ: Desktop/CLI còn chạm file (last-prompt, custom-title,
    // file-history) mà không có lượt mới, và file chép lại mang mtime mới tinh. Cửa sổ
    // "N ngày" người dùng chọn là theo LƯỢT CUỐI thật.
    if (Date.parse(f.lastAt) < cutoffMs) continue;
    const project = matchProject(roots, await cwdReal(f.cwd));
    if (!project) {
      skipped.noProject += 1;
      continue;
    }
    const item: ClaudeSessionItem = {
      id: c.id,
      entrypoint: f.entrypoint,
      title: f.title,
      cwd: f.cwd,
      projectId: project.id,
      projectName: project.name,
      firstAt: f.firstAt,
      lastAt: f.lastAt,
      userTurns: f.userTurns,
    };
    if (f.gitBranch) item.gitBranch = f.gitBranch;
    const existing = imported.get(c.id);
    if (existing) item.importedSessionId = existing.id;
    items.push(item);
  }
  items.sort((a, b) =>
    a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0,
  );
  return { items: items.slice(0, LIST_MAX_ITEMS), skipped };
}

// ─── import ──────────────────────────────────────────────────────────────────

function mintImportedSessionId(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}-claude-${randomBytes(4).toString("hex")}`;
}

// Chống trùng dựa trên `index` (uuid phiên Claude → phiên AWOG) — nhưng `index` là bản CHỤP
// tại đầu lượt và giữa bước kiểm `has` với `registerImported` có nhiều `await` (stat, quét,
// realpath). Hai lượt nhập chạy song song (bấm đúp, hai cửa sổ) vì thế cùng thấy "chưa có"
// và tạo HAI phiên cho một uuid. Xếp hàng các lượt nhập: lượt sau chụp index SAU khi lượt
// trước đã đăng ký xong.
let importChain: Promise<unknown> = Promise.resolve();

export function importClaudeSessions(
  ids: string[],
): Promise<ClaudeImportResult> {
  const run = importChain.then(() => importClaudeSessionsSerial(ids));
  importChain = run.catch(() => undefined);
  return run;
}

async function importClaudeSessionsSerial(
  ids: string[],
): Promise<ClaudeImportResult> {
  await sessionManager.ensureLoaded();
  const roots = await loadProjectRoots();
  const index = sessionManager.getSdkSessionIndex();
  const result: ClaudeImportResult = { imported: [], skipped: [] };
  const skip = (id: string, reason: string): void => {
    result.skipped.push({ id, reason });
  };

  // uuid so khớp KHÔNG phân biệt hoa thường: tên file CLI viết thường, nhưng RPC là biên L1
  // — `ABC…` và `abc…` không được thành hai phiên.
  for (const id of new Set(ids.map((i) => i.toLowerCase()))) {
    if (!UUID_RE.test(id)) {
      skip(id, "invalid-id");
      continue;
    }
    if (index.has(id)) {
      skip(id, "already-imported");
      continue;
    }
    // resolveSdkTranscriptPath quét <claudeHome>/projects/*/<id>.jsonl và kiểm realpath nằm
    // trong projects/ — id đã khớp UUID nên không có đường thoát path.
    const file = resolveSdkTranscriptPath(id);
    if (!file) {
      skip(id, "not-found");
      continue;
    }
    const st = await stat(file).catch(() => undefined);
    if (!st) {
      skip(id, "not-found");
      continue;
    }
    const outcome = await scanCached(file, st.size, st.mtimeMs);
    if (outcome.status !== "ok") {
      skip(
        id,
        outcome.status === "foreign" ? "not-desktop-or-cli" : outcome.status,
      );
      continue;
    }
    const f = outcome.facts;
    const project = matchProject(roots, await realOrResolved(f.cwd));
    if (!project) {
      skip(id, "no-project");
      continue;
    }
    const messages = readSdkTranscriptMessages(file);
    if (messages.length === 0) {
      skip(id, "empty");
      continue;
    }

    const sessionId = mintImportedSessionId();
    const settings: SessionSettings = {
      provider: "anthropic",
      modelId: f.model ?? DEFAULT_IMPORT_MODEL,
      level: "high",
      mode: "ask",
    };
    const session: Session = {
      id: sessionId,
      title: f.title,
      projectId: project.id,
      createdAt: f.firstAt,
      updatedAt: f.lastAt,
      invitedAgentIds: [],
      pendingAgentIds: [],
      messages,
      settings,
      sdkSessionId: id,
      sdkSessionPath: file,
      transcriptSource: "sdk",
      importedFrom: {
        kind: f.entrypoint,
        at: new Date().toISOString(),
        cwd: f.cwd,
      },
    };
    await sessionManager.registerImported(session);
    index.set(id, { id: sessionId, title: f.title });
    syncedMtime.set(sessionId, st.mtimeMs);
    result.imported.push({ id, sessionId });

    const summary = sessionManager
      .getSessions()
      .find((s) => s.id === sessionId);
    if (summary) emit("session.created", { session: summary });
  }
  return result;
}

// ─── activity refresh ────────────────────────────────────────────────────────

// mtime đã đồng bộ cho từng phiên (chỉ trong RAM): sau khi khởi động lại, lần làm tươi đầu
// tiên đọc đuôi file một lần rồi thôi.
const syncedMtime = new Map<string, number>();

// Timestamp của dòng user/assistant CUỐI trong 1MB cuối file. mtime một mình không dùng được:
// CLI còn ghi last-prompt/custom-title/file-history sau lượt cuối, và Desktop đôi khi chạm file
// mà không có lượt mới — dùng mtime sẽ kéo `updatedAt` sang một ngày không có việc.
export async function readLastActivityAt(
  file: string,
): Promise<string | undefined> {
  let fh: FileHandle | undefined;
  try {
    fh = await open(file, "r");
    const { size } = await fh.stat();
    const len = Math.min(size, TAIL_READ_BYTES);
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    // Dòng đầu của khối có thể bị cắt giữa chừng (parse hỏng ⇒ bỏ qua tự nhiên).
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]!;
      if (
        !line.includes('"type":"user"') &&
        !line.includes('"type":"assistant"')
      )
        continue;
      const ts = parseObject(line)?.timestamp;
      if (isValidIso(ts)) return ts;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await fh?.close();
  }
}

// Làm tươi các phiên nhập theo transcript. Gọi trước khi liệt kê cho Logtime/danh sách và khi
// mở phiên. Chi phí thường: một `stat` mỗi phiên nhập; chỉ khi mtime đổi VÀ vượt `updatedAt`
// mới đọc đuôi file. Phiên đã nạp messages thì replay lại (để transcript đang mở thấy lượt mới);
// phiên chưa nạp chỉ cập nhật `updatedAt` trong RAM.
export async function refreshImportedSessions(onlyId?: string): Promise<void> {
  await sessionManager.ensureLoaded();
  for (const ref of sessionManager.listImported()) {
    if (onlyId !== undefined && ref.id !== onlyId) continue;
    try {
      const file = resolveSdkTranscriptPath(
        ref.sdkSessionId,
        ref.sdkSessionPath,
      );
      if (!file) continue;
      const { mtimeMs } = await stat(file);
      if (syncedMtime.get(ref.id) === mtimeMs) continue;
      syncedMtime.set(ref.id, mtimeMs);
      const knownMs = Date.parse(ref.updatedAt);
      if (mtimeMs <= knownMs + STALE_SLACK_MS) continue;
      const lastAt = await readLastActivityAt(file);
      // Chỉ housekeeping (không có lượt mới sau mốc đã biết) ⇒ giữ nguyên.
      if (!lastAt || Date.parse(lastAt) <= knownMs + STALE_SLACK_MS) continue;
      if (ref.messagesLoaded) {
        await sessionManager.refreshImportedMessages(
          ref.id,
          readSdkTranscriptMessages(file),
          lastAt,
        );
      } else {
        sessionManager.touchActivity(ref.id, lastAt);
      }
    } catch (err) {
      log.warn("claude-import: refresh failed", {
        sessionId: ref.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
