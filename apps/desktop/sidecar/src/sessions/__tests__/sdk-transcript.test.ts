// Tests cho ADR 0097 replay path (sessions/sdk-transcript.ts): transcript CLI
// persist → SessionMessage[] qua parseClaudeTranscript + subagent adapter
// replay. Fixture dựng trong tmpdir — không cần mock vì readSdkTranscriptMessages
// nhận path trực tiếp (resolveSdkTranscriptPath chỉ lọc theo projects root).
//
// Run: `npx vitest run src/sessions/__tests__/sdk-transcript.test.ts`
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSdkTranscriptMessages,
  resolveSdkTranscriptPath,
  sdkTranscriptCoversSession,
} from "../sdk-transcript.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "awog-sdktrans-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SDK_ID = "11111111-2222-4333-8444-555566667777";

function userEntry(
  uuid: string,
  text: string,
  ts: string,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    uuid,
    timestamp: ts,
    sessionId: SDK_ID,
    message: { role: "user", content: text },
    ...extra,
  });
}

function assistantEntry(
  uuid: string,
  blocks: unknown[],
  ts: string,
  parentUuid: string,
): string {
  return JSON.stringify({
    parentUuid,
    isSidechain: false,
    type: "assistant",
    uuid,
    timestamp: ts,
    sessionId: SDK_ID,
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: blocks,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 5,
      },
      stop_reason: "end_turn",
    },
  });
}

function toolResultEntry(
  uuid: string,
  toolUseId: string,
  content: string,
  ts: string,
  parentUuid: string,
  toolUseResult?: Record<string, unknown>,
): string {
  return JSON.stringify({
    parentUuid,
    isSidechain: false,
    type: "user",
    uuid,
    timestamp: ts,
    sessionId: SDK_ID,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
    ...(toolUseResult ? { toolUseResult } : {}),
  });
}

async function writeTranscript(
  lines: string[],
  opts: { subagents?: Record<string, string[]> } = {},
): Promise<string> {
  const file = join(dir, `${SDK_ID}.jsonl`);
  await writeFile(file, `${lines.join("\n")}\n`);
  for (const [agentId, agentLines] of Object.entries(opts.subagents ?? {})) {
    const sub = join(dir, SDK_ID, "subagents");
    await mkdir(sub, { recursive: true });
    await writeFile(
      join(sub, `agent-${agentId}.jsonl`),
      `${agentLines.join("\n")}\n`,
    );
  }
  return file;
}

describe("readSdkTranscriptMessages", () => {
  it("replays a plain turn: user + assistant text/thinking/tool step", async () => {
    const file = await writeTranscript([
      userEntry("u1", "làm gì đây?", "2026-10-01T00:00:00Z"),
      assistantEntry(
        "a1",
        [
          { type: "thinking", thinking: "đang nghĩ" },
          { type: "text", text: "Để tôi xem." },
          {
            type: "tool_use",
            id: "tu1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
        "2026-10-01T00:00:01Z",
        "u1",
      ),
      toolResultEntry(
        "r1",
        "tu1",
        "a.txt\nb.txt",
        "2026-10-01T00:00:02Z",
        "a1",
      ),
      assistantEntry(
        "a2",
        [{ type: "text", text: "Có 2 file." }],
        "2026-10-01T00:00:03Z",
        "r1",
      ),
    ]);

    const msgs = readSdkTranscriptMessages(file);
    expect(msgs.map((m) => m.role)).toEqual(["user", "agent"]);
    expect(msgs[0]!.id).toBe("sdk-0");
    expect(msgs[0]!.text).toBe("làm gì đây?");
    const agent = msgs[1]!;
    expect(agent.id).toBe("sdk-1");
    expect(agent.text).toContain("Để tôi xem.");
    expect(agent.text).toContain("Có 2 file.");
    expect(agent.modelUsed).toBe("claude-opus-5");
    expect(agent.usage?.inputTokens).toBe(20); // two requests summed
    const tool = agent.steps?.find((s) => s.kind === "tool");
    expect(tool?.tool).toBe("terminal"); // Bash → 'terminal' SessionStepTool
    expect(tool?.target).toContain("ls");
    expect(agent.steps?.some((s) => s.kind === "thinking")).toBe(true);
  });

  it("strips AWOG turn scaffolds from the persisted user text", async () => {
    const file = await writeTranscript([
      userEntry(
        "u1",
        "<background-work>\nscaffold\n</background-work>\n\n<current_state>\nsnap\n</current_state>\n\nlệnh thật",
        "2026-10-01T00:00:00Z",
      ),
      assistantEntry(
        "a1",
        [{ type: "text", text: "ok" }],
        "2026-10-01T00:00:01Z",
        "u1",
      ),
    ]);
    const msgs = readSdkTranscriptMessages(file);
    expect(msgs[0]!.text).toBe("lệnh thật");
  });

  // Native compaction của CLI (ADR 0099). Shape lấy từ JSONL thật do CLI 0.3.296 ghi:
  // `system/compact_boundary` (+ compactMetadata camelCase), user `isCompactSummary`
  // (bản tóm tắt dài để nuôi model), và hai dòng echo của `/compact` thủ công.
  it("compact thủ công: marker `system` sau lượt cuối, bỏ summary + echo của /compact", async () => {
    const file = await writeTranscript([
      userEntry("u1", "nhớ từ PINEAPPLE", "2026-10-01T00:00:00Z"),
      assistantEntry(
        "a1",
        [{ type: "text", text: "ok" }],
        "2026-10-01T00:00:01Z",
        "u1",
      ),
      JSON.stringify({
        type: "system",
        subtype: "compact_boundary",
        isMeta: false,
        timestamp: "2026-10-01T00:00:10Z",
        compactMetadata: {
          trigger: "manual",
          preTokens: 17181,
          durationMs: 15221,
        },
      }),
      userEntry(
        "s1",
        "This session is being continued from a previous conversation…",
        "2026-10-01T00:00:10Z",
        {
          isCompactSummary: true,
          isVisibleInTranscriptOnly: true,
        },
      ),
      userEntry(
        "c1",
        "<command-name>/compact</command-name>\n<command-args></command-args>",
        "2026-10-01T00:00:11Z",
      ),
      userEntry(
        "c2",
        "<local-command-stdout>Compacted </local-command-stdout>",
        "2026-10-01T00:00:12Z",
      ),
      userEntry("u2", "từ nào?", "2026-10-01T00:00:20Z"),
      assistantEntry(
        "a2",
        [{ type: "text", text: "PINEAPPLE" }],
        "2026-10-01T00:00:21Z",
        "u2",
      ),
    ]);
    const msgs = readSdkTranscriptMessages(file);
    expect(msgs.map((m) => m.role)).toEqual([
      "user",
      "agent",
      "system",
      "user",
      "agent",
    ]);
    expect(msgs[2]!.compaction).toEqual({
      trigger: "manual",
      preTokens: 17181,
      durationMs: 15221,
    });
    expect(msgs.map((m) => m.text).join("|")).not.toContain(
      "This session is being continued",
    );
    expect(msgs.map((m) => m.text).join("|")).not.toContain("command-name");
  });

  it("tự nén giữa lượt: marker đứng TRƯỚC bubble agent của lượt (khớp chỗ UI chèn lúc live)", async () => {
    const file = await writeTranscript([
      userEntry("u1", "việc dài", "2026-10-01T00:00:00Z"),
      assistantEntry(
        "a1",
        [
          {
            type: "tool_use",
            id: "tu1",
            name: "Bash",
            input: { command: "ls" },
          },
        ],
        "2026-10-01T00:00:01Z",
        "u1",
      ),
      JSON.stringify({
        type: "system",
        subtype: "compact_boundary",
        timestamp: "2026-10-01T00:00:02Z",
        compactMetadata: { trigger: "auto", preTokens: 171719 },
      }),
      toolResultEntry("r1", "tu1", "a", "2026-10-01T00:00:03Z", "a1"),
      assistantEntry(
        "a2",
        [{ type: "text", text: "xong" }],
        "2026-10-01T00:00:04Z",
        "r1",
      ),
    ]);
    const msgs = readSdkTranscriptMessages(file);
    expect(msgs.map((m) => m.role)).toEqual(["user", "system", "agent"]);
    expect(msgs[1]!.compaction).toEqual({ trigger: "auto", preTokens: 171719 });
    expect(msgs[2]!.text).toContain("xong");
  });

  // Tiến trình CLI sống lâu (ADR 0099): task nền xong SAU lượt ⇒ CLI tự chèn một
  // user-entry `origin.kind = 'task-notification'` rồi chạy lượt model. Sau khi tải
  // lại, nó phải là dòng hệ thống đọc được — không phải bubble người dùng chứa XML.
  it("task-notification của CLI thành dòng hệ thống mang summary, lượt đánh thức tách riêng", async () => {
    const note =
      "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n" +
      '<summary>Background command "sleep 18" completed (exit code 0)</summary>\n</task-notification>';
    const file = await writeTranscript([
      userEntry("u1", "chạy nền đi", "2026-10-01T00:00:00Z"),
      assistantEntry(
        "a1",
        [{ type: "text", text: "đã chạy" }],
        "2026-10-01T00:00:01Z",
        "u1",
      ),
      userEntry("n1", note, "2026-10-01T00:00:20Z", {
        origin: { kind: "task-notification" },
      }),
      assistantEntry(
        "a2",
        [{ type: "text", text: "lệnh nền xong" }],
        "2026-10-01T00:00:21Z",
        "n1",
      ),
    ]);
    const msgs = readSdkTranscriptMessages(file);
    expect(msgs.map((m) => m.role)).toEqual([
      "user",
      "agent",
      "system",
      "agent",
    ]);
    expect(msgs[2]!.text).toBe(
      'Background command "sleep 18" completed (exit code 0)',
    );
    expect(msgs.map((m) => m.text).join("|")).not.toContain(
      "<task-notification>",
    );
  });

  it("nests subagent steps under the Task call that spawned them", async () => {
    const file = await writeTranscript(
      [
        userEntry("u1", "dùng subagent", "2026-10-01T00:00:00Z"),
        assistantEntry(
          "a1",
          [
            {
              type: "tool_use",
              id: "tuTask",
              name: "Task",
              input: { prompt: "điều tra" },
            },
          ],
          "2026-10-01T00:00:01Z",
          "u1",
        ),
        toolResultEntry("r1", "tuTask", "done", "2026-10-01T00:00:05Z", "a1", {
          agentId: "agentabc",
        }),
        assistantEntry(
          "a2",
          [{ type: "text", text: "xong" }],
          "2026-10-01T00:00:06Z",
          "r1",
        ),
      ],
      {
        subagents: {
          agentabc: [
            JSON.stringify({
              isSidechain: true,
              agentId: "agentabc",
              type: "assistant",
              uuid: "s1",
              timestamp: "2026-10-01T00:00:02Z",
              message: {
                role: "assistant",
                model: "claude-opus-5",
                content: [
                  {
                    type: "tool_use",
                    id: "stu1",
                    name: "Grep",
                    input: { pattern: "x" },
                  },
                ],
                usage: {},
              },
            }),
          ],
        },
      },
    );
    const msgs = readSdkTranscriptMessages(file);
    const agent = msgs[1]!;
    const nested = agent.steps?.filter((s) => s.parentId === "tuTask");
    expect(nested?.length).toBeGreaterThan(0);
    expect(nested?.[0]?.tool).toBe("search");
    expect(nested?.[0]?.id.startsWith("tuTask:")).toBe(true);
  });
});

describe("sdkTranscriptCoversSession", () => {
  it("accepts a transcript carrying every persisted user message", async () => {
    const file = await writeTranscript([
      userEntry(
        "u1",
        "<current_state>\nx\n</current_state>\n\nhỏi đi",
        "2026-10-01T00:00:00Z",
      ),
      assistantEntry(
        "a1",
        [{ type: "text", text: "trả lời" }],
        "2026-10-01T00:00:01Z",
        "u1",
      ),
    ]);
    const existing = [
      {
        id: "m1",
        role: "user" as const,
        text: "hỏi đi",
        at: "2026-10-01T00:00:00Z",
      },
      {
        id: "m2",
        role: "agent" as const,
        text: "trả lời",
        at: "2026-10-01T00:00:01Z",
      },
    ];
    expect(sdkTranscriptCoversSession(file, existing)).toBe(true);
  });

  it("rejects when the transcript is missing a user turn", async () => {
    const file = await writeTranscript([
      userEntry("u1", "first", "2026-10-01T00:00:00Z"),
      assistantEntry(
        "a1",
        [{ type: "text", text: "r" }],
        "2026-10-01T00:00:01Z",
        "u1",
      ),
    ]);
    const existing = [
      {
        id: "m1",
        role: "user" as const,
        text: "first",
        at: "2026-10-01T00:00:00Z",
      },
      {
        id: "m2",
        role: "user" as const,
        text: "second",
        at: "2026-10-01T00:00:02Z",
      },
    ];
    expect(sdkTranscriptCoversSession(file, existing)).toBe(false);
  });
});

describe("resolveSdkTranscriptPath", () => {
  it("rejects malformed ids", () => {
    expect(resolveSdkTranscriptPath("../etc")).toBeUndefined();
  });
});
