// Spare cho one-shot văn bản thuần: dùng một lần rồi bổ sung, đổi credential thì bỏ,
// claim hỏng thì rơi về cold query, hợp đồng lỗi không đổi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  prewarm: vi.fn(),
  resolveCredential: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: h.query,
  prewarm: h.prewarm,
}));
vi.mock("../../../credentials/credential-resolver.js", () => ({
  FROZEN_TOKEN_MIN_LIFETIME_MS: 3_600_000,
  resolveCredential: h.resolveCredential,
}));
vi.mock("../binary.js", () => ({ resolveClaudeBinary: () => undefined }));

import { RpcError } from "../../../transport/rpc.js";
import { runClaudeComplete } from "../complete.js";
import { closeAllOneShotSpares, createSparePool } from "../one-shot-spare.js";

const ARGS = {
  modelId: "claude-haiku-4-5",
  systemPrompt: "be terse",
  prompt: "hi",
};

function successMessages(text: string): unknown[] {
  return [
    { type: "system", subtype: "init", model: "claude-haiku-4-5" },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 2 },
      modelUsage: {},
    },
  ];
}

async function* stream(msgs: unknown[]): AsyncGenerator<unknown> {
  for (const m of msgs) yield m;
}

interface FakeSpare {
  claim: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  claimed: Promise<unknown>;
  exited: Promise<void>;
}

function fakeSpare(opts: {
  text?: string;
  claimRejects?: string;
  claimThrows?: boolean;
}): FakeSpare {
  const claimed = opts.claimRejects
    ? Promise.reject(new Error(opts.claimRejects))
    : Promise.resolve({ cwd: "/x", sessionId: "s", sdkMcpSettled: true });
  claimed.catch(() => undefined);
  return {
    claimed,
    exited: new Promise<void>(() => undefined),
    close: vi.fn(),
    claim: vi.fn(() => {
      if (opts.claimThrows) throw new Error("spare closed");
      if (opts.claimRejects) {
        return (async function* () {
          throw new Error(
            "Claude Code returned an error result: not_claimed: ...",
          );
        })();
      }
      return stream(successMessages(opts.text ?? "from-spare"));
    }),
  };
}

function credential(token: string): { cred: unknown } {
  return {
    cred: {
      kind: "oauth",
      accessToken: token,
      refreshToken: "r",
      expiresAt: 0,
    },
  };
}

describe("runClaudeComplete — spare", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.resolveCredential.mockResolvedValue(credential("tok-A"));
    h.query.mockImplementation(() => stream(successMessages("from-cold")));
    h.prewarm.mockImplementation(async () => fakeSpare({}));
  });
  afterEach(() => closeAllOneShotSpares("test"));

  it("lượt đầu chạy cold rồi prewarm; lượt sau claim spare đúng một lần và prewarm lại", async () => {
    const spare1 = fakeSpare({ text: "from-spare-1" });
    const spare2 = fakeSpare({});
    h.prewarm.mockResolvedValueOnce(spare1).mockResolvedValueOnce(spare2);

    const first = await runClaudeComplete(ARGS);
    expect(first.text).toBe("from-cold");
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.prewarm).toHaveBeenCalledTimes(1);

    const second = await runClaudeComplete(ARGS);
    expect(second.text).toBe("from-spare-1");
    expect(h.query).toHaveBeenCalledTimes(1); // không thêm cold query
    expect(spare1.claim).toHaveBeenCalledTimes(1);
    expect(spare1.claim.mock.calls[0]?.[0]).toMatchObject({
      prompt: "hi",
      options: { model: "claude-haiku-4-5", appendSystemPrompt: "be terse" },
    });
    expect(h.prewarm).toHaveBeenCalledTimes(2); // bổ sung ngay sau lượt claim

    // Option đóng băng lúc prewarm: systemPrompt rỗng, luôn bật partial messages, không model.
    const host = h.prewarm.mock.calls[0]?.[0].options;
    expect(host).toMatchObject({
      systemPrompt: "",
      includePartialMessages: true,
      tools: [],
    });
    expect(host.model).toBeUndefined();

    const third = await runClaudeComplete(ARGS);
    expect(third.text).toBe("from-spare"); // spare2
  });

  it("đổi credential: đóng spare cũ, chạy cold, prewarm theo credential mới", async () => {
    const spareA = fakeSpare({ text: "from-A" });
    const spareB = fakeSpare({ text: "from-B" });
    h.prewarm.mockResolvedValueOnce(spareA).mockResolvedValueOnce(spareB);

    await runClaudeComplete(ARGS); // cold + prewarm(A)
    h.resolveCredential.mockResolvedValue(credential("tok-B"));
    const r = await runClaudeComplete(ARGS);

    expect(r.text).toBe("from-cold");
    expect(spareA.claim).not.toHaveBeenCalled();
    expect(spareA.close).toHaveBeenCalledTimes(1);
    expect(h.prewarm).toHaveBeenCalledTimes(2);
    expect(
      h.prewarm.mock.calls[1]?.[0].options.env.CLAUDE_CODE_OAUTH_TOKEN,
    ).toBe("tok-B");

    const next = await runClaudeComplete(ARGS);
    expect(next.text).toBe("from-B");
  });

  it("claim bị từ chối: đóng spare và rơi về cold query", async () => {
    const bad = fakeSpare({ claimRejects: "cwd_not_found: nope" });
    h.prewarm.mockResolvedValueOnce(bad).mockResolvedValue(fakeSpare({}));
    await runClaudeComplete(ARGS); // cold, prewarm → bad
    h.query.mockClear();

    const r = await runClaudeComplete(ARGS);
    expect(bad.claim).toHaveBeenCalledTimes(1);
    expect(bad.close).toHaveBeenCalledTimes(1);
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(r.text).toBe("from-cold");
  });

  it("claim() ném đồng bộ: cũng rơi về cold query", async () => {
    const dead = fakeSpare({ claimThrows: true });
    h.prewarm.mockResolvedValueOnce(dead).mockResolvedValue(fakeSpare({}));
    await runClaudeComplete(ARGS);
    h.query.mockClear();

    const r = await runClaudeComplete(ARGS);
    expect(dead.close).toHaveBeenCalledTimes(1);
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(r.text).toBe("from-cold");
  });

  it("prewarm lỗi: lượt kế vẫn chạy cold, không ném", async () => {
    h.prewarm.mockRejectedValue(new Error("spawn failed"));
    await runClaudeComplete(ARGS);
    const r = await runClaudeComplete(ARGS);
    expect(r.text).toBe("from-cold");
  });

  it("hợp đồng lỗi trên spare: result auth → -32020, result lỗi khác → -32021 model error; không prewarm lại khi auth hỏng", async () => {
    const authSpare = fakeSpare({});
    authSpare.claim.mockImplementation(() =>
      stream([
        {
          type: "result",
          subtype: "success",
          is_error: true,
          result: "authentication_error: invalid token",
        },
      ]),
    );
    h.prewarm.mockResolvedValueOnce(authSpare);
    await runClaudeComplete(ARGS);
    h.prewarm.mockClear();
    const err = await runClaudeComplete(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(-32020);
    expect(authSpare.close).not.toHaveBeenCalled(); // lỗi của lượt chạy, không phải claim
    expect(h.prewarm).not.toHaveBeenCalled();
  });

  it('result lỗi khác trên spare → -32021 "model error: …" (chuỗi vẫn khớp regex của isModelRefusal)', async () => {
    const spare = fakeSpare({});
    spare.claim.mockImplementation(() =>
      stream([
        {
          type: "result",
          subtype: "success",
          is_error: true,
          result: "violative cyber content",
        },
      ]),
    );
    h.prewarm.mockResolvedValueOnce(spare);
    await runClaudeComplete(ARGS);
    const err = await runClaudeComplete(ARGS).catch((e: unknown) => e);
    expect((err as RpcError).code).toBe(-32021);
    expect((err as RpcError).message).toMatch(/^model error: /);
    expect((err as RpcError).message).toMatch(/violative/i);
  });
});

describe("createSparePool", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (): {
    close: ReturnType<typeof vi.fn>;
    exited: Promise<void>;
  } => ({
    close: vi.fn(),
    exited: new Promise<void>(() => undefined),
  });

  it("nhàn rỗi quá idleMs thì đóng spare", async () => {
    const spare = make();
    const pool = createSparePool({
      prewarm: vi.fn().mockResolvedValue(spare),
      idleMs: 1000,
    });
    pool.ensure("k", {});
    await vi.advanceTimersByTimeAsync(999);
    expect(spare.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(spare.close).toHaveBeenCalledTimes(1);
    expect(await pool.take("k")).toBeNull();
  });

  it("ensure cùng key không prewarm lần hai; take rút spare ra khỏi pool", async () => {
    const spare = make();
    const prewarm = vi.fn().mockResolvedValue(spare);
    const pool = createSparePool({ prewarm, idleMs: 1000 });
    pool.ensure("k", {});
    pool.ensure("k", {});
    expect(prewarm).toHaveBeenCalledTimes(1);
    expect(await pool.take("k")).toBe(spare);
    expect(await pool.take("k")).toBeNull();
  });

  it("spare chết khi đang đậu thì nhả chỗ để ensure prewarm lại", async () => {
    let die: () => void = () => undefined;
    const dying = {
      close: vi.fn(),
      exited: new Promise<void>((r) => (die = r)),
    };
    const prewarm = vi
      .fn()
      .mockResolvedValueOnce(dying)
      .mockResolvedValue(make());
    const pool = createSparePool({ prewarm, idleMs: 1000 });
    pool.ensure("k", {});
    await vi.advanceTimersByTimeAsync(0);
    die();
    await vi.advanceTimersByTimeAsync(0);
    expect(await pool.take("k")).toBeNull();
  });
});
