// Chọn runtime của one-shot theo provider (ADR 0099): anthropic → Claude SDK;
// google + endpoint tuỳ chỉnh nói OpenAI chat-completions → Pi.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  providerOfAccount: vi.fn(),
  resolveAccount: vi.fn(),
  resolveCredential: vi.fn(),
  runClaudeComplete: vi.fn(),
  runClaudeAuthor: vi.fn(),
  completeSimple: vi.fn(),
  getApiKey: vi.fn(),
}));

vi.mock("../claude-sdk/complete.js", () => ({
  runClaudeComplete: h.runClaudeComplete,
  runClaudeAuthor: h.runClaudeAuthor,
}));
vi.mock("../../credentials/credential-resolver.js", () => ({
  providerOfAccount: h.providerOfAccount,
  resolveAccount: h.resolveAccount,
  resolveCredential: h.resolveCredential,
}));
vi.mock("../model-resolver.js", () => ({
  resolveModel: () => ({ model: { id: "m" }, getApiKey: h.getApiKey }),
}));
vi.mock("@earendil-works/pi-ai/compat", () => ({
  completeSimple: h.completeSimple,
  streamSimple: vi.fn(),
}));
vi.mock("@earendil-works/pi-agent-core", () => ({ runAgentLoop: vi.fn() }));
vi.mock("../tools/index.js", () => ({ createAwogToolDefinitions: () => [] }));

import { complete } from "../complete.js";

const ARGS = { modelId: "some-model", systemPrompt: "s", prompt: "p" };

describe("complete — dispatch theo provider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.runClaudeComplete.mockResolvedValue({
      text: "from-claude",
      modelUsed: "m",
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "end_turn",
    });
    h.resolveCredential.mockResolvedValue({ account: { id: "acc" } });
    h.getApiKey.mockResolvedValue("key");
    h.completeSimple.mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text: "from-pi" }],
      usage: { input: 1, output: 1 },
      model: "m",
    });
  });

  it("anthropic (account thường) → Claude SDK, không chạm Pi", async () => {
    h.resolveAccount.mockResolvedValue({ id: "acc" });
    expect(
      await complete({ ...ARGS, provider: "anthropic", accountId: "acc" }),
    ).toBe("from-claude");
    expect(h.completeSimple).not.toHaveBeenCalled();
  });

  it("chỉ có accountId → suy provider từ bucket sở hữu", async () => {
    h.providerOfAccount.mockResolvedValue("google");
    expect(await complete({ ...ARGS, accountId: "g1" })).toBe("from-pi");
    expect(h.runClaudeComplete).not.toHaveBeenCalled();
  });

  it("google → Pi", async () => {
    expect(
      await complete({ ...ARGS, provider: "google", accountId: "g1" }),
    ).toBe("from-pi");
    expect(h.runClaudeComplete).not.toHaveBeenCalled();
  });

  it("anthropic bucket nhưng endpoint openai-completions → Pi", async () => {
    h.resolveAccount.mockResolvedValue({
      id: "acc",
      baseURL: "http://x",
      api: "openai-completions",
    });
    expect(
      await complete({ ...ARGS, provider: "anthropic", accountId: "acc" }),
    ).toBe("from-pi");
    expect(h.runClaudeComplete).not.toHaveBeenCalled();
  });

  it("openai (custom baseURL) → Pi", async () => {
    expect(
      await complete({ ...ARGS, provider: "openai", accountId: "o1" }),
    ).toBe("from-pi");
    expect(h.runClaudeComplete).not.toHaveBeenCalled();
  });
});
