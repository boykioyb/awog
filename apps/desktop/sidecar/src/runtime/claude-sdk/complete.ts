// One-shot helpers trên Claude Agent SDK — nhánh Anthropic của runtime/complete.ts.
//
// Khác chat/task: KHÔNG dùng preset `claude_code`, KHÔNG nạp CLAUDE.md/skill/hook
// (`settingSources: []`), KHÔNG lưu transcript (`persistSession: false`), cwd là thư
// mục tạm trống để CLI không quét project của người dùng. Ba hình dạng:
//   - runComplete: sinh văn bản thuần, không tool, tuỳ chọn stream delta.
//   - runAuthor: agentic (Write/Read/Edit) + bypass permission + callback tool.
// Hợp đồng lỗi giữ nguyên bản Pi: -32020 AUTH_EXPIRED, -32021 `model error`.

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  query,
  type ClaimOptions,
  type Options,
  type Query,
  type SDKMessage,
  type SpareProcess,
} from "@anthropic-ai/claude-agent-sdk";
import {
  FROZEN_TOKEN_MIN_LIFETIME_MS,
  resolveCredential,
  type Credential,
} from "../../credentials/credential-resolver.js";
import { normalizeModelId } from "../../providers/anthropic/models-map.js";
import { RpcError } from "../../transport/rpc.js";
import { log } from "../../util/logger.js";
import type { ProviderName } from "../../types/shared.js";
import { resolveClaudeBinary } from "./binary.js";
import { ensureOneShotSpare, takeOneShotSpare } from "./one-shot-spare.js";
import {
  buildSdkEnv,
  mapClaudeErrorToRpc,
  resultErrorMessage,
  toSdkModel,
} from "./shared.js";
import { diagnosticsOptions } from "./tuning.js";

export interface ClaudeOneShotArgs {
  accountId?: string | undefined;
  modelId: string;
  systemPrompt: string;
  prompt: string;
}

export interface ClaudeAuthorArgs extends ClaudeOneShotArgs {
  cwd?: string | undefined;
}

export interface ClaudeOneShotResult {
  text: string;
  modelUsed: string;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
}

export interface ClaudeAuthorCallbacks {
  onText: (delta: string) => void;
  onToolUse: (use: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  }) => void;
  onToolResult: (res: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    content: unknown;
    isError: boolean;
  }) => void;
}

const PROVIDER: ProviderName = "anthropic";

// Cùng bộ tool với bản Pi: author chỉ cần ghi MỘT file cấu hình .md. Bash/Grep/Glob
// bị loại vì model sẽ dò shell (pwd/ls) trong môi trường headless này rồi kể lể
// "shell unavailable", làm hỏng chat author. Cổng ghi thật là các path systemPrompt cho phép.
const AUTHOR_TOOLS = ["Write", "Read", "Edit"];

function toInputRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)
    : {};
}

// Lỗi ném ra từ query(): dùng bảng mã chung, nhưng lỗi "khác" mang nhãn của one-shot
// (`completion failed:` / `authoring failed:`) thay vì `chat failed:`.
function mapOneShotError(err: unknown, what: string): RpcError {
  const mapped = mapClaudeErrorToRpc(err);
  if (err instanceof RpcError || mapped.code !== -32021) return mapped;
  const message = err instanceof Error ? err.message : String(err);
  return new RpcError(-32021, `${what} failed: ${message}`);
}

// `result` không thành công (hoặc is_error) → RpcError. Auth/rate-limit đi qua bảng
// mã chung; còn lại là `model error: …` như bản Pi (isModelRefusal bắt trên chuỗi này).
function resultToError(why: string): RpcError {
  const mapped = mapClaudeErrorToRpc(new Error(why));
  return mapped.code === -32021
    ? new RpcError(-32021, `model error: ${why}`)
    : mapped;
}

// Thư mục trống dùng chung cho mọi lượt không cần cwd: CLI đọc git status/CLAUDE.md
// theo cwd, nên cwd của sidecar (repo AWOG) sẽ bị quét vô ích.
const ONE_SHOT_CWD = join(tmpdir(), "awog-oneshot");

// Khoá credential của spare: băm để không giữ thêm một bản token dạng rõ trong pool.
// Gồm baseURL vì env `ANTHROPIC_BASE_URL` cũng bị đóng băng lúc prewarm.
function credentialKey(cred: Credential): string {
  const raw =
    cred.kind === "oauth"
      ? `oauth\0${cred.accessToken}`
      : `key\0${cred.baseURL ?? ""}\0${cred.apiKey}`;
  return createHash("sha256").update(raw).digest("hex");
}

interface BuiltOptions {
  options: Options;
  credKey: string;
}

async function buildOptions(
  args: ClaudeOneShotArgs,
  extra: Partial<Options>,
  cwd: string | undefined,
): Promise<BuiltOptions> {
  // Token bị đóng băng vào env của tiến trình con cho cả lượt → đòi đủ thời hạn.
  const { cred } = await resolveCredential(
    PROVIDER,
    args.accountId,
    FROZEN_TOKEN_MIN_LIFETIME_MS,
  );
  if (!cwd) await mkdir(ONE_SHOT_CWD, { recursive: true });
  const claudeBinary = resolveClaudeBinary();
  return {
    credKey: credentialKey(cred),
    options: {
      systemPrompt: args.systemPrompt,
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      thinking: { type: "disabled" },
      model: toSdkModel(normalizeModelId(args.modelId)),
      cwd: cwd ?? ONE_SHOT_CWD,
      env: buildSdkEnv(cred),
      ...diagnosticsOptions("task"),
      ...(claudeBinary ? { pathToClaudeCodeExecutable: claudeBinary } : {}),
      ...extra,
    },
  };
}

interface Collector {
  handle: (msg: SDKMessage) => void;
  result: () => ClaudeOneShotResult;
}

// Gom text/usage từ luồng SDKMessage. `onText` nhận mọi delta của agent chính
// (parent_tool_use_id null) khi includePartialMessages bật.
function createCollector(
  fallbackModel: string,
  onText: ((delta: string) => void) | undefined,
  author?: Pick<ClaudeAuthorCallbacks, "onToolUse" | "onToolResult">,
): Collector {
  let streamed = "";
  let finalText = "";
  let modelUsed = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  const toolInputs = new Map<
    string,
    { name: string; input: Record<string, unknown> }
  >();

  const handle = (msg: SDKMessage): void => {
    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init") modelUsed = msg.model;
        break;
      }
      case "stream_event": {
        const ev = msg.event;
        if (
          !msg.parent_tool_use_id &&
          ev.type === "content_block_delta" &&
          ev.delta.type === "text_delta" &&
          ev.delta.text
        ) {
          streamed += ev.delta.text;
          onText?.(ev.delta.text);
        }
        break;
      }
      case "assistant": {
        for (const block of msg.message.content) {
          if (block.type !== "tool_use") continue;
          const input = toInputRecord(block.input);
          toolInputs.set(block.id, { name: block.name, input });
          author?.onToolUse({ id: block.id, name: block.name, input });
        }
        break;
      }
      case "user": {
        const content = msg.message.content;
        if (typeof content === "string") break;
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const meta = toolInputs.get(block.tool_use_id) ?? {
            name: "tool",
            input: {},
          };
          author?.onToolResult({
            id: block.tool_use_id,
            name: meta.name,
            input: meta.input,
            content: block.content,
            isError: block.is_error === true,
          });
        }
        break;
      }
      case "result": {
        if (msg.subtype !== "success" || msg.is_error) {
          const text = msg.subtype === "success" ? msg.result : undefined;
          throw resultToError(resultErrorMessage(msg.subtype, text));
        }
        finalText = msg.result;
        stopReason = msg.stop_reason ?? "end_turn";
        inputTokens = msg.usage.input_tokens;
        outputTokens = msg.usage.output_tokens;
        if (!modelUsed) modelUsed = Object.keys(msg.modelUsage)[0] ?? "";
        break;
      }
      default:
        break;
    }
  };

  return {
    handle,
    result: () => ({
      // `result` là văn bản của lượt cuối (giống Pi "last assistant message");
      // với pure-text chỉ có một lượt nên trùng với phần đã stream.
      text: finalText || streamed,
      modelUsed: modelUsed || fallbackModel,
      usage: { inputTokens, outputTokens },
      stopReason,
    }),
  };
}

async function drain(
  options: Options,
  prompt: string,
  collector: Collector,
  what: string,
): Promise<void> {
  try {
    for await (const msg of query({ prompt, options })) collector.handle(msg);
  } catch (err) {
    throw mapOneShotError(err, what);
  }
}

// Khi claim bị từ chối, SDK làm Query ném lỗi `not_claimed` và `spare.claimed` reject
// với lý do (`cwd_not_found`, `spare_exited`, `claim_failed`…) — prompt CHƯA chạy.
// Ngoại lệ duy nhất: `option_not_applied` = prompt đã chạy, chỉ model bị từ chối.
const OPTION_NOT_APPLIED = /^option_not_applied/;
const CLAIM_SETTLE_MS = 250;

// Chạy prompt trên spare. `true` = đã chạy xong trên spare (collector đầy đủ);
// `false` = claim bị từ chối, CHƯA có gì phát ra ⇒ caller chạy lại bằng cold query.
// Lỗi của chính lượt chạy (auth, model error, refusal) ném ra như đường cold.
async function drainClaimed(
  spare: SpareProcess,
  prompt: string,
  claim: ClaimOptions,
  collector: Collector,
  what: string,
): Promise<boolean> {
  // Luôn gắn handler ngay để `claimed` reject không thành unhandledRejection.
  const claimFailure: Promise<Error | undefined> = spare.claimed.then(
    () => undefined,
    (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
  );
  let q: Query;
  try {
    q = spare.claim({ prompt, options: claim });
  } catch (err) {
    log.warn("one-shot spare claim threw; falling back to cold query", {
      err: err instanceof Error ? err.message : String(err),
    });
    spare.close();
    return false;
  }
  try {
    for await (const msg of q) collector.handle(msg);
  } catch (err) {
    // `claimed` thường đã settle; chờ tối đa CLAIM_SETTLE_MS cho ca nó chưa kịp.
    const failure = await Promise.race([
      claimFailure,
      sleep(CLAIM_SETTLE_MS, undefined, { ref: false }),
    ]);
    if (failure && !OPTION_NOT_APPLIED.test(failure.message)) {
      log.warn("one-shot spare claim refused; falling back to cold query", {
        reason: failure.message,
      });
      spare.close();
      return false;
    }
    throw mapOneShotError(err, what);
  }
  const failure = await claimFailure;
  if (failure)
    log.warn("one-shot spare option not applied", { reason: failure.message });
  return true;
}

// Options "host-level" của spare. Chỉ phần claim đặt được (model, system prompt) bị lấy
// ra: spare đậu với systemPrompt rỗng, claim bổ sung bằng `appendSystemPrompt` (đo:
// 504 vs 499 input token so với systemPrompt thay thẳng — tương đương). Luôn bật
// includePartialMessages vì claim không đặt được nó; lượt không stream bỏ qua event đó.
function spareHostOptions(options: Options): Options {
  const { systemPrompt: _systemPrompt, model: _model, ...host } = options;
  return { ...host, systemPrompt: "", includePartialMessages: true };
}

// Pure-text one-shot. `onDelta` (nếu có) nhận từng đoạn text khi nó đến.
//
// Chạy trên spare đã prewarm khi có (ADR 0099 follow-up), cold `query()` khi không có /
// claim hỏng. Sau mỗi lượt (trừ lỗi auth) prewarm lại spare cho lượt kế — SAU lượt, không
// song song, để tiến trình khởi động không tranh CPU với chính lượt đang chạy.
export async function runClaudeComplete(
  args: ClaudeOneShotArgs,
  onDelta?: (delta: string) => void,
): Promise<ClaudeOneShotResult> {
  const { options, credKey } = await buildOptions(
    args,
    {
      tools: [],
      maxTurns: 1,
      effort: "low",
      ...(onDelta ? { includePartialMessages: true } : {}),
    },
    undefined,
  );
  log.info("one-shot complete (claude-sdk)", {
    model: args.modelId,
    stream: !!onDelta,
  });
  let replenish = true;
  try {
    const spare = await takeOneShotSpare(credKey);
    if (spare) {
      const collector = createCollector(args.modelId, onDelta, undefined);
      const claim: ClaimOptions = {
        cwd: ONE_SHOT_CWD,
        ...(options.model ? { model: options.model } : {}),
        ...(args.systemPrompt ? { appendSystemPrompt: args.systemPrompt } : {}),
      };
      if (
        await drainClaimed(spare, args.prompt, claim, collector, "completion")
      ) {
        return collector.result();
      }
    }
    const collector = createCollector(args.modelId, onDelta, undefined);
    await drain(options, args.prompt, collector, "completion");
    return collector.result();
  } catch (err) {
    // Credential hỏng: prewarm tiếp chỉ đẻ thêm tiến trình sẽ lại hỏng.
    if (err instanceof RpcError && err.code === -32020) replenish = false;
    throw err;
  } finally {
    if (replenish) ensureOneShotSpare(credKey, spareHostOptions(options));
  }
}

// Agentic one-shot: Write/Read/Edit dưới bypassPermissions (người dùng chủ động mở
// luồng author ⇒ đồng ý ngầm; path systemPrompt cho phép là cổng thật).
//
// Luôn cold: cần `tools` + `allowDangerouslySkipPermissions` (đóng băng lúc prewarm, nên
// phải có spare riêng mang bộ đó) và cwd tuỳ ý. Author do người dùng mở thủ công, không ở
// đường nóng như tiêu đề phiên/commit message; một spare thứ hai chỉ để đậu thêm
// ~250MB cho thứ hiếm dùng — không đáng.
export async function runClaudeAuthor(
  args: ClaudeAuthorArgs,
  cb: ClaudeAuthorCallbacks,
): Promise<ClaudeOneShotResult> {
  const { options } = await buildOptions(
    args,
    {
      tools: AUTHOR_TOOLS,
      effort: "low",
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
    args.cwd,
  );
  log.info("one-shot author (claude-sdk)", { model: args.modelId });
  const collector = createCollector(args.modelId, cb.onText, cb);
  await drain(options, args.prompt, collector, "authoring");
  return collector.result();
}
