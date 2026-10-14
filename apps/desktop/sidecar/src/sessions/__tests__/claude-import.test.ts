// Tests cho ADR 0102 — nhập phiên Claude Desktop/CLI: scanner (`claudeSessions.list`), import
// idempotent, làm tươi hoạt động cho Logtime, cổng CLAUDE_SESSION_BUSY, upsert giữ importedFrom.
// Mọi thứ chạy trên HOME + CLAUDE_CONFIG_DIR tạm — không đụng ~/.claude, ~/.awog thật.
//
// Run: `npx vitest run src/sessions/__tests__/claude-import.test.ts`
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  utimes,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ClaudeImportModule from "../claude-import.js";
import type * as StoreModule from "../store.js";
import type * as GuardModule from "../claude-busy-guard.js";
import type * as SuggestionsModule from "../../logtime/suggestions.js";
import type * as RollupModule from "../../usage/rollup.js";
import type * as RpcModule from "../../transport/rpc.js";

const h = vi.hoisted(() => ({ live: new Set<string>() }));
vi.mock("../../runtime/claude-sdk/live-process.js", () => ({
  liveFor: (id: string) => (h.live.has(id) ? {} : undefined),
}));
vi.mock("../../transport/stdio.js", () => ({ emit: vi.fn() }));

let home: string;
let claude: string;
let projectDir: string;
let otherDir: string;

// Module dưới test đọc HOME/CLAUDE_CONFIG_DIR lúc chạy và sessionManager cache thư mục phiên
// ở lần nạp đầu — nên env PHẢI đặt trước khi nạp chúng ⇒ import động trong beforeAll (đây là
// lý do import tĩnh không dùng được).
let m: {
  list: ClaudeImportModule;
  store: StoreModule;
  guard: GuardModule;
  suggestions: SuggestionsModule;
  rollup: RollupModule;
  rpc: RpcModule;
};

// Phiên có thể đã được nhập ở test trước (module singleton, file transcript dựng lại mỗi test).
async function ensureImported(id: string): Promise<string> {
  const r = await m.list.importClaudeSessions([id]);
  if (r.imported[0]) return r.imported[0].sessionId;
  const listed = await m.list.listClaudeSessions({ days: 30 });
  return listed.items.find((i) => i.id === id)!.importedSessionId!;
}

const A = "11111111-1111-4111-8111-111111111111"; // desktop
const B = "22222222-2222-4222-8222-222222222222"; // cli
const C = "33333333-3333-4333-8333-333333333333"; // sdk-ts (AWOG's own)
const D = "44444444-4444-4444-8444-444444444444"; // desktop, cwd ngoài project
const E = "55555555-5555-4555-8555-555555555555"; // desktop, dòng hỏng
const BAD_ENTRY = "66666666-6666-4666-8666-666666666666"; // entrypoint hỏng hoàn toàn

function entry(
  type: "user" | "assistant",
  ts: string,
  text: string,
  extra: { entrypoint?: string; cwd?: string; branch?: string } = {},
): string {
  const base = {
    parentUuid: null,
    isSidechain: false,
    type,
    uuid: `u-${ts}-${type}`,
    timestamp: ts,
    ...(extra.entrypoint
      ? { entrypoint: extra.entrypoint, cwd: extra.cwd }
      : {}),
    ...(extra.branch ? { gitBranch: extra.branch } : {}),
    message:
      type === "user"
        ? { role: "user", content: text }
        : {
            role: "assistant",
            model: "claude-opus-5",
            content: [{ type: "text", text }],
          },
  };
  return JSON.stringify(base);
}

async function writeTranscript(
  dir: string,
  id: string,
  lines: string[],
  mtime?: Date,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  await writeFile(file, `${lines.join("\n")}\n`);
  if (mtime) await utimes(file, mtime, mtime);
  return file;
}

// Mốc TƯƠNG ĐỐI với hôm nay: cửa sổ "N ngày" lọc theo lượt cuối thật trong transcript, nên
// ngày cứng (vd 2026-10-10) sẽ tự rơi khỏi cửa sổ 30 ngày sau một tháng và làm test đỏ.
const MIN = 60_000;
const DAY = 86_400_000;
const BASE = Math.floor((Date.now() - 4 * DAY) / MIN) * MIN;
const at = (offsetMs: number): string =>
  new Date(BASE + offsetMs).toISOString();
const T0 = at(0);
const T1 = at(5 * MIN);

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "awog-claude-import-"));
  claude = join(home, "claude-home");
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = claude;
  const repo = join(home, "work", "repo");
  await mkdir(join(repo, "apps", "web"), { recursive: true });
  otherDir = join(home, "elsewhere");
  await mkdir(otherDir, { recursive: true });
  projectDir = repo;
  await mkdir(join(home, ".awog", "projects"), { recursive: true });
  await writeFile(
    join(home, ".awog", "projects", "prj-1.json"),
    JSON.stringify({ id: "prj-1", name: "Repo", path: repo, createdAt: T0 }),
  );
  m = {
    list: await import("../claude-import.js"),
    store: await import("../store.js"),
    guard: await import("../claude-busy-guard.js"),
    suggestions: await import("../../logtime/suggestions.js"),
    rollup: await import("../../usage/rollup.js"),
    rpc: await import("../../transport/rpc.js"),
  };
  await import("../../methods/sessions.upsert.js");
  await import("../../methods/claude-sessions.list.js");
  await import("../../methods/claude-sessions.import.js");
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  h.live.clear();
  const dir = join(claude, "projects");
  await rm(dir, { recursive: true, force: true });
  const slugA = join(dir, "-work-repo");
  const now = new Date();
  await writeTranscript(
    slugA,
    A,
    [
      JSON.stringify({
        type: "queue-operation",
        operation: "enqueue",
        timestamp: T0,
      }),
      entry("user", T0, "Fix the login bug", {
        entrypoint: "claude-desktop",
        cwd: join(projectDir, "apps", "web"), // thư mục CON của project
        branch: "feat/login",
      }),
      entry("assistant", T1, "Done."),
      JSON.stringify({ type: "custom-title", customTitle: "old title" }),
      JSON.stringify({ type: "custom-title", customTitle: "Login fix" }),
    ],
    now,
  );
  await writeTranscript(
    slugA,
    B,
    [
      entry("user", at(DAY + 60 * MIN), "terminal prompt", {
        entrypoint: "cli",
        cwd: projectDir,
      }),
      entry("assistant", at(DAY + 61 * MIN), "ok"),
    ],
    now,
  );
  await writeTranscript(
    slugA,
    C,
    [
      entry("user", T0, "own sdk session", {
        entrypoint: "sdk-ts",
        cwd: projectDir,
      }),
    ],
    now,
  );
  await writeTranscript(
    join(dir, "-elsewhere"),
    D,
    [
      entry("user", T0, "outside", {
        entrypoint: "claude-desktop",
        cwd: otherDir,
      }),
    ],
    now,
  );
  await writeTranscript(
    slugA,
    E,
    [
      '{"typ": broken json "entrypoint":"cli"',
      "not json at all",
      entry("user", at(-DAY), "survivor", {
        entrypoint: "cli",
        cwd: projectDir,
      }),
      entry("assistant", at(-DAY + MIN), "reply"),
    ],
    now,
  );
  await writeTranscript(
    slugA,
    BAD_ENTRY,
    ['{"type":"user","entrypoint":"cli", broken', "{{{"],
    now,
  );
});

describe("claudeSessions.list", () => {
  it("keeps desktop+cli inside a project, drops sdk-ts, counts skips", async () => {
    const r = (await m.rpc.dispatch("claudeSessions.list", {
      days: 30,
    })) as ClaudeImportModule.ClaudeSessionListResult;
    const ids = r.items.map((i) => i.id);
    expect(ids).toEqual([B, A, E]); // lastAt desc; C (sdk-ts) và D (ngoài project) vắng
    expect(r.skipped).toEqual({ noProject: 1, unreadable: 1 });
    const a = r.items.find((i) => i.id === A)!;
    expect(a).toMatchObject({
      entrypoint: "claude-desktop",
      title: "Login fix", // custom-title CUỐI thắng
      gitBranch: "feat/login",
      projectId: "prj-1",
      projectName: "Repo",
      userTurns: 1,
      firstAt: T0,
      lastAt: T1,
    });
    expect(r.items.find((i) => i.id === B)).toMatchObject({
      entrypoint: "cli",
      title: "terminal prompt",
    });
    // dòng hỏng bị bỏ qua, phiên vẫn đọc được từ các dòng còn lại
    expect(r.items.find((i) => i.id === E)).toMatchObject({
      userTurns: 1,
      title: "survivor",
    });
  });

  it("honours the days window by file mtime", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    await utimes(
      join(claude, "projects", "-work-repo", `${A}.jsonl`),
      old,
      old,
    );
    const r = await m.list.listClaudeSessions({ days: 30 });
    expect(r.items.map((i) => i.id)).not.toContain(A);
    const wide = await m.list.listClaudeSessions({ days: 90 });
    expect(wide.items.map((i) => i.id)).toContain(A);
  });

  it("judges the window by the last real turn, not a fresh mtime", async () => {
    // Desktop/CLI chạm file (custom-title, last-prompt) hoặc file được chép lại ⇒ mtime mới
    // tinh nhưng lượt cuối đã 40 ngày: không được lọt vào cửa sổ 30 ngày.
    const dir = join(claude, "projects", "-work-repo");
    const stale = "33333333-3333-4333-8333-333333333333";
    await writeTranscript(dir, stale, [
      entry("user", at(-36 * DAY), "old work", {
        entrypoint: "claude-desktop",
        cwd: projectDir,
      }),
      entry("assistant", at(-36 * DAY + MIN), "done"),
      JSON.stringify({ type: "custom-title", customTitle: "Old work" }),
    ]);
    const r = await m.list.listClaudeSessions({ days: 30 });
    expect(r.items.map((i) => i.id)).not.toContain(stale);
    const wide = await m.list.listClaudeSessions({ days: 90 });
    expect(wide.items.map((i) => i.id)).toContain(stale);
  });
});

describe("claudeSessions.import", () => {
  it("imports pointer-mode sessions, is idempotent, skips non-importable ids", async () => {
    const r1 = (await m.rpc.dispatch("claudeSessions.import", {
      ids: [A, C, D, "nope", A],
    })) as ClaudeImportModule.ClaudeImportResult;
    expect(r1.imported.map((i) => i.id)).toEqual([A]);
    expect(Object.fromEntries(r1.skipped.map((s) => [s.id, s.reason]))).toEqual(
      {
        [C]: "not-desktop-or-cli",
        [D]: "no-project",
        nope: "invalid-id",
      },
    );

    const sessionId = r1.imported[0]!.sessionId;
    const summary = (await m.store.listSessionSummaries()).find(
      (s) => s.id === sessionId,
    )!;
    expect(summary).toMatchObject({
      title: "Login fix",
      projectId: "prj-1",
      createdAt: T0,
      updatedAt: T1,
      importedFrom: { kind: "claude-desktop" },
    });
    expect(summary.messageCount).toBeGreaterThan(0);
    const full = (await m.store.loadSession(sessionId))!;
    expect(full.transcriptSource).toBe("sdk");
    expect(full.sdkSessionId).toBe(A);
    expect(full.importedFrom?.cwd).toBe(join(projectDir, "apps", "web"));
    expect(full.messages.length).toBeGreaterThan(0);

    const r2 = await m.list.importClaudeSessions([A]);
    expect(r2.imported).toEqual([]);
    expect(r2.skipped).toEqual([{ id: A, reason: "already-imported" }]);
    const listed = await m.list.listClaudeSessions({ days: 30 });
    expect(listed.items.find((i) => i.id === A)?.importedSessionId).toBe(
      sessionId,
    );
  });

  it("never creates two sessions for one uuid — concurrent calls or different case", async () => {
    const before = (await m.store.listSessionSummaries()).filter(
      (s) => s.importedFrom,
    ).length;
    const [r1, r2] = await Promise.all([
      m.list.importClaudeSessions([E]),
      m.list.importClaudeSessions([E.toUpperCase()]),
    ]);
    const created = [...r1.imported, ...r2.imported];
    expect(created).toHaveLength(1);
    expect([...r1.skipped, ...r2.skipped]).toEqual([
      { id: E, reason: "already-imported" },
    ]);
    const after = (await m.store.listSessionSummaries()).filter(
      (s) => s.importedFrom,
    ).length;
    expect(after - before).toBe(1);
  });

  it("sessions.upsert update-metadata preserves importedFrom", async () => {
    const sessionId = await ensureImported(B);
    const before = (await m.store.listSessionSummaries()).find(
      (s) => s.id === sessionId,
    )!;
    await m.rpc.dispatch("sessions.upsert", {
      mode: "update-metadata",
      session: {
        id: sessionId,
        title: "Renamed in UI",
        projectId: "prj-1",
        createdAt: before.createdAt,
        updatedAt: before.updatedAt,
        invitedAgentIds: [],
        messages: [],
        pendingAgentIds: [],
        settings: before.settings,
      },
    });
    const after = (await m.store.loadSession(sessionId))!;
    expect(after.title).toBe("Renamed in UI");
    expect(after.importedFrom).toMatchObject({ kind: "cli" });
    expect(after.transcriptSource).toBe("sdk");
    expect(after.sdkSessionId).toBe(B);
  });
});

describe("activity refresh → Logtime", () => {
  it("moves updatedAt to work done later in Desktop and surfaces it on the right day", async () => {
    const sessionId = await ensureImported(A);
    const file = join(claude, "projects", "-work-repo", `${A}.jsonl`);

    // Hoạt động mới ở Desktop sau lúc nhập (3 ngày sau), kèm dòng housekeeping SAU lượt cuối.
    const later = at(3 * DAY);
    await appendFile(
      file,
      [
        entry("user", later, "one more thing"),
        entry("assistant", at(3 * DAY + MIN), "sure"),
        JSON.stringify({ type: "custom-title", customTitle: "Login fix" }),
      ].join("\n") + "\n",
    );
    const touched = new Date();
    await utimes(file, touched, touched);

    const fresh = await m.store.listSessionSummariesFresh();
    const s = fresh.find((x) => x.id === sessionId)!;
    expect(s.updatedAt).toBe(at(3 * DAY + MIN)); // timestamp lượt cuối, KHÔNG phải mtime

    const day = m.rollup.localDayKey(Date.parse(s.updatedAt));
    const out = m.suggestions.buildLogtimeSuggestions({
      date: day,
      sessions: fresh,
      tasks: [],
      trackedProjectKeys: new Set(["prj-1"]),
    });
    expect(out.suggestions.map((x) => x.refId)).toContain(sessionId);
    // Ngày cũ lúc nhập KHÔNG còn gợi ý phiên này (updatedAt đã chuyển ngày).
    const oldDay = m.rollup.localDayKey(Date.parse(T1));
    if (oldDay !== day) {
      const old = m.suggestions.buildLogtimeSuggestions({
        date: oldDay,
        sessions: fresh,
        tasks: [],
        trackedProjectKeys: new Set(["prj-1"]),
      });
      expect(old.suggestions.map((x) => x.refId)).not.toContain(sessionId);
    }
  });
});

describe("CLAUDE_SESSION_BUSY guard", () => {
  async function imported() {
    return (await m.store.loadSession(await ensureImported(B)))!;
  }
  const file = () => join(claude, "projects", "-work-repo", `${B}.jsonl`);

  it("throws -32021 when the transcript was written <120s ago and AWOG owns no live CLI", async () => {
    const s = await imported();
    await utimes(file(), new Date(), new Date());
    await expect(m.guard.assertClaudeSessionIdle(s)).rejects.toMatchObject({
      code: -32021,
      message: expect.stringMatching(/^CLAUDE_SESSION_BUSY/),
    });
  });

  it("passes when AWOG owns a live CLI for the session", async () => {
    const s = await imported();
    await utimes(file(), new Date(), new Date());
    h.live.add(s.id);
    await expect(m.guard.assertClaudeSessionIdle(s)).resolves.toBeUndefined();
  });

  it("passes when the transcript has been quiet for >=120s", async () => {
    const s = await imported();
    const quiet = new Date(Date.now() - 121_000);
    await utimes(file(), quiet, quiet);
    await expect(m.guard.assertClaudeSessionIdle(s)).resolves.toBeUndefined();
  });

  it("ignores sessions that were not imported", async () => {
    await expect(
      m.guard.assertClaudeSessionIdle({ id: "x", sdkSessionId: B }),
    ).resolves.toBeUndefined();
  });
});
