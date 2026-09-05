# 0029 — Migrate LLM runtime sang Pi SDK (single runtime, multi-provider)

- **Trạng thái:** Accepted — Phase C hoàn tất (C0–C4 implement xong 2026-06-05); bảng mapping thinking của **item 6** amended by [0078](./0078-reasoning-effort-parity.md) (mapping 1:1 toàn thang, không còn dịch xuống một nấc — phần degrade của item 6 giữ nguyên)
- **Ngày:** 2026-06-05
- **Người quyết định:** Tech Lead + user (chốt hướng X — migrate toàn bộ sang Pi, 2026-06-05)
- **Liên quan:** [0026](./0026-per-agent-multi-provider-llm.md) (multi-provider — ADR này **thay** lựa chọn runtime của 0026), [0023](./0023-sdk-session-resume-and-compact.md) (resume — **amend**), [0014](./0014-mcp-servers-stdio-runtime.md) (MCP Q4 — **amend**), [0018](./0018-mcp-secret-keychain.md) (secret keychain), [0008](./0008-stdio-ipc-for-sidecar.md) (stdio IPC)

## Bối cảnh

[ADR 0026](./0026-per-agent-multi-provider-llm.md) Phase A/B đã ship API key Anthropic + custom endpoint **Anthropic-compatible**. Nhưng **OpenAI / OpenAI-compatible (Ollama/vLLM/LM Studio/OpenAI thật) / Google chưa chạy** vì runtime bám cứng `@anthropic-ai/claude-agent-sdk`: vòng lặp agentic (tool-use → tool-result → turn kế), MCP bridge, permission (`canUseTool`), streaming SSE, resume ([ADR 0023](./0023-sdk-session-resume-and-compact.md)), thinking budget — tất cả **nằm trong** `query()`, Anthropic-only. ADR 0026 Option A (gateway dịch Anthropic↔OpenAI/Google trong sidecar) là cách giữ SDK nhưng **thêm một lớp dịch API** phải bảo trì + dễ lệch hành vi.

Khảo sát **Craft Agents** (theo yêu cầu user) cho thấy hướng sạch hơn: craft **không** dùng claude-agent-sdk. Nó dùng **Pi SDK** (`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`) làm **runtime DUY NHẤT** cho mọi provider — Anthropic chỉ là 1 provider trong nhiều. Một bộ tool thống nhất + một agent loop (`runAgentLoop`) + một permission hook (`beforeToolCall`).

**Facts đã verify (C0 spike — `apps/desktop/sidecar/scripts/pi-spike.mts`, chạy thật với tài khoản Claude Max OAuth):**

- Pi `@earendil-works/pi-ai` v0.78.1 + `pi-agent-core` v0.78.1, **ESM thuần JS, 0 native dep** (deps: `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@mistralai/mistralai`, `@aws-sdk/client-bedrock-runtime`, `@smithy/node-http-handler`, `partial-json`, `typebox`, http(s)-proxy-agent). Cảnh báo pnpm "ignored build scripts" của `@google/genai`/`protobufjs` **không ảnh hưởng** đường Anthropic/OpenAI (chỉ Google Vertex/gRPC dùng protobuf; ta wire Anthropic trước).
- API: `getModel(provider,id)` / `getModels(provider)` → `Model<TApi>` `{id,name,api,provider,baseUrl,reasoning,thinkingLevelMap?,maxTokens,...}`. `streamSimple(model, Context, SimpleStreamOptions)` → events `start/text_*/thinking_*/toolcall_*/done/error` + `await stream.result()` (final `AssistantMessage` với `usage{input,output,cacheRead,cacheWrite,cost}` + `stopReason`). `Context = {systemPrompt, messages, tools}` (serializable; `tools` = TypeBox `Type.Object`).
- `pi-agent-core` `runAgentLoop(prompts, AgentContext, AgentLoopConfig, emit, signal?, streamFn?)`: orchestration đầy đủ. `AgentLoopConfig extends SimpleStreamOptions` + `{model, convertToLlm, beforeToolCall?, afterToolCall?, getApiKey?, transformContext?, shouldStopAfterTurn?, prepareNextTurn?, toolExecution?}`. `AgentTool extends Tool` thêm `{label, execute(toolCallId,params,signal?,onUpdate?)}`. Events `AgentEvent`: `agent_start/turn_start/message_start/message_update/message_end/tool_execution_start/tool_execution_update/tool_execution_end/turn_end/agent_end`.
- **OAuth subscription giải quyết được** (xem [§Cơ chế OAuth](#cơ-chế-oauth-anthropic-subscription--đã-giải)).

**Đây là rewrite runtime lớn** → cần ADR mới (supersede lựa chọn claude-agent-sdk; amend ADR 0023 resume + ADR 0014 MCP Q4); làm **phân kỳ, sau cờ feature** để không vỡ path Anthropic đang chạy.

## Quyết định

> **Dùng Pi SDK làm runtime LLM DUY NHẤT cho mọi provider.** `pi-agent-core` `runAgentLoop` lo orchestration; AWOG TỰ cấp `AgentTool[]` (KHÔNG hand-roll loop, KHÔNG bê nguyên tool của pi-coding-agent). Bỏ `@anthropic-ai/claude-agent-sdk` (sau soak C4).

1. **Module mới `apps/desktop/sidecar/src/runtime/`** là seam duy nhất, giữ **nguyên chữ ký** `runStream(args,cb)` + `invokeSdk(args,cb)` để `sessions.send-message.ts` + `tasks/node-runner.ts` gần như không đổi. Gồm: `model-resolver` (`{provider,accountId,modelId}`+cred → Pi `Model`), `context-builder` (JSONL → Pi `Context`), `tools/` (`createAwogToolDefinitions` → Pi `AgentTool[]`), `permission` (`beforeToolCall` bridge), `event-adapter` (Pi events → `StreamCallbacks`/`InvokeCallbacks`), `thinking`, `run-stream`/`invoke`/`complete`.
2. **AgentTool của AWOG GIỮ tên + arg-key kiểu Claude Code** (`Read/Write/Edit/Bash/Grep/Glob`, `file_path/command/old_string/new_string`). Lý do KISS: `step-mapper.ts` + `trace-mapper.ts` + Workspace Panel + `SessionStepTool` union **không phải sửa**. **Bắt buộc bởi Pi dưới OAuth:** pi rewrite tool name về tên canonical Claude Code (case-insensitive, danh sách `Read/Write/Edit/Bash/Grep/Glob/...`) khi token là OAuth — đặt đúng tên ngay từ đầu để hành vi subscription đúng như mong đợi.
3. **`beforeToolCall` = permission gate**: bridge `parkPermissionRequest` ([sessions/permissions.ts](../../apps/desktop/sidecar/src/sessions/permissions.ts)); map 4 mode `ask/accept-edits/plan/execute`; `updatedInput`→mutate args; "always allow"→session allowlist; abort→reject parked. **Định nghĩa lại `PermissionResult/PermissionUpdate` thành type AWOG-local** (bỏ import từ claude-agent-sdk); RPC `sessions.permission` UI **không đổi**.
4. **MCP bridge in-process** (`runtime/tools/mcp-tools.ts`): bridge [mcp/manager.ts](../../apps/desktop/sidecar/src/mcp/manager.ts) thành Pi `AgentTool` (`mcp__<server>__<tool>`); thêm `mcpManager.callTool(serverId,tool,args)`. Giữ secret expand ([mcp/secrets.ts](../../apps/desktop/sidecar/src/mcp/secrets.ts)) + whitelist session∩agent + SSRF http guard. **Amend [ADR 0014](./0014-mcp-servers-stdio-runtime.md) Q4:** AWOG gọi MCP tool **in-process** qua `McpManager` thay vì để SDK tự spawn process MCP riêng — `McpManager` vẫn là chủ duy nhất của process MCP (status/log/restart như cũ).
5. **Resume = rebuild Context từ JSONL** (`context-builder.ts`): AWOG JSONL là source-of-truth → bỏ `sdkSessionId`/`CLAUDE_CONFIG_DIR`. **Amend [ADR 0023](./0023-sdk-session-resume-and-compact.md):** thay `resume` của SDK bằng dựng lại `Context.messages` theo role-tag từ JSONL mỗi lần gửi turn (Pi `Context` serializable, không state ẩn). `/compact` Pi không có sẵn → reimplement = one-shot summarize ghi đè JSONL (pi-agent-core có sẵn helper `compact`/`generateSummary` có thể tái dùng).
6. **Thinking qua `model.thinkingLevelMap`/`model.reasoning`** (`thinking.ts`): `ThinkingLevel` → `SimpleStreamOptions.reasoning` (`off|minimal|low|medium|high|xhigh`); Anthropic giữ budget 4k/8k/16k/32k (Pi tự map qua `thinkingBudgets`/effort); degrade khi `model.reasoning=false`. Thay hằng `SUPPORTS_THINKING` bằng `model.reasoning` từ Pi.
7. **Credentials: cấp thẳng vào Pi, KHÔNG env, KHÔNG subprocess.** Generalize `resolveCredential`/`resolveAccount` ([credential-resolver.ts](../../apps/desktop/sidecar/src/credentials/credential-resolver.ts)) bỏ guard `provider!=='anthropic'`; **bỏ `applyAuthEnv`** (không còn subprocess). Giữ `ensureFreshAccessToken` cho Anthropic OAuth; đẩy token qua `AgentLoopConfig.getApiKey(provider)` (resolve lại mỗi turn — đúng cho token ngắn hạn + retry 401→forceRefresh). OpenAI/Google = API key trước (OAuth Codex/Copilot/Vertex để sau). Custom OpenAI-protocol: thêm `api?: 'anthropic-messages'|'openai-completions'` vào `AccountRecord`.

### Cơ chế OAuth Anthropic subscription — ĐÃ GIẢI

**Câu hỏi sống-còn (ADR 0026 để mở):** làm sao đẩy OAuth access token (Claude Pro/Max) vào pi-ai để nó gọi Anthropic bằng `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`, KHÔNG `x-api-key`?

**Trả lời: truyền OAuth access token y nguyên qua `options.apiKey` (hoặc `AgentLoopConfig.apiKey` / `getApiKey`). Pi auto-detect OAuth.** Không cần object oauth riêng, không cần override headers.

Bằng chứng (file:line trong gói đã cài, `dist/providers/anthropic.js`):

- `anthropic.js:583-584` — `function isOAuthToken(apiKey) { return apiKey.includes("sk-ant-oat"); }`. Token OAuth của AWOG có prefix `sk-ant-oat0` (verify trong spike) → match.
- `anthropic.js:629-643` — nhánh OAuth dựng `new Anthropic({ apiKey: null, authToken: apiKey, baseURL: model.baseUrl, defaultHeaders: { "anthropic-beta": ["claude-code-20250219","oauth-2025-04-20", ...betaFeatures].join(","), "user-agent": "claude-cli/<ver>", "x-app": "cli", ... } })`. `authToken` của `@anthropic-ai/sdk` sinh `Authorization: Bearer <token>`; `x-api-key` **không** được set. `anthropic-version: 2023-06-01` do `@anthropic-ai/sdk` client gắn mặc định.
- `anthropic.js:669-685` — dưới OAuth, Pi **tự prepend** system block `"You are Claude Code, Anthropic's official CLI for Claude."` trước `context.systemPrompt` (bắt buộc cho subscription endpoint).
- `anthropic.js:920-934` + `893-914` + `661` — Pi **tự set `cache_control: {type:"ephemeral"}`** lên tool cuối, system prompt, và content cuối của user message (prompt caching out-of-the-box; `cacheRetention` mặc định `"short"`).

Trong `pi-agent-core`, `agent-loop.js:188` resolve `const resolvedApiKey = (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey` rồi đẩy vào `streamSimple` → cùng cơ chế. AWOG dùng `getApiKey` cho **refresh-per-turn** của OAuth token.

**Kết quả spike (chạy thật, HTTP 200):** STEP3 trả `text="OK"`, `stopReason=stop`, `usage{input:33,output:4,cost.total:0.000053}`. STEP4 (tool) thấy `toolcall_start/delta/end` + `ToolCall{name:'get_time',id:'toolu_...',arguments:{}}`, `stopReason=toolUse`. STEP5 `runAgentLoop` chạy full: `agent_start → turn_start → message_* → tool_execution_start → tool_execution_end(get_time, isError=false) → turn_end → turn_start → message_* → turn_end → agent_end`, `beforeToolCall` được gọi, tool execute, assistant trả text cuối.

## Phương án đã cân nhắc

### Option X — Migrate toàn bộ sang Pi (single runtime) — CHỌN
- **Pros:** 1 runtime cho mọi provider, hành vi nhất quán; bỏ được claude-agent-sdk + Claude CLI binary (extraResources nhẹ hơn); Pi ESM thuần JS 0 native (đóng gói đơn giản); OAuth subscription đã verify chạy; prompt-cache + thinking + tool-use Anthropic giữ nguyên; thêm provider mới = `getModel` + cred. Loại bỏ "lớp dịch gateway" của ADR 0026 Option A.
- **Cons:** rewrite orchestration seam (tool/permission/resume/`/compact` phải tái hiện đúng hợp đồng Claude Code); rủi ro tool-semantics drift + permission parity (xem §Hệ quả).

### Option A (ADR 0026) — Gateway dịch trong sidecar, giữ claude-agent-sdk
- **Loại:** vẫn 1 runtime Anthropic-only + thêm lớp dịch API phải bảo trì; OpenAI/Google chỉ là "Anthropic giả" → mất tính năng native + dễ lệch. Pi đã có sẵn provider chính chủ cho cả ba.

### Option B (ADR 0026) — Native adapter per-provider tự viết loop
- **Loại:** nhân bản orchestration (MCP/permission/stream/resume) cho từng provider — đúng thứ Pi cho sẵn. Vi phạm KISS/YAGNI.

### Giữ nguyên claude-agent-sdk (status quo)
- **Loại:** chính là vấn đề — multi-provider không khả thi.

## Hệ quả

- **Supersede:** lựa chọn runtime `@anthropic-ai/claude-agent-sdk` (ADR 0008/0026). Sau soak C4: gỡ dep (9 call-site `query()` + type-only import + Claude CLI binary khỏi extraResources), bỏ `sdkSessionId`/`SDK_CONFIG_DIR`/`applyAuthEnv`.
- **Amend ADR 0023:** resume = rebuild Context từ JSONL (bỏ `resume`/`sdkSessionId` của SDK); `/compact` reimplement bằng one-shot summarize.
- **Amend ADR 0014 Q4:** MCP tool gọi in-process qua `McpManager.callTool` (không để runtime tự spawn process MCP); ownership process MCP giữ ở `McpManager`.
- **Giữ nguyên nhờ giữ tên tool:** `step-mapper.ts`, `trace-mapper.ts`, Workspace Panel, `SessionStepTool`.
- **Phân kỳ thực hiện** (C0–C4 hoàn tất 2026-06-05):
  - **C0** (xong) — spike + ADR; thêm 2 dep Pi vào sidecar; ESM/typecheck xanh; xác nhận OAuth path + event shapes + deps thuần JS.
  - **C1** (xong) — `runtime/` foundation + Sessions; QA parity Anthropic (stream/permission 4 mode/MCP/resume/`/compact`/abort/prompt-cache).
  - **C2** (xong) — Tasks + 7 method one-shot qua Pi; trace tree + auto-commit.
  - **C3** (xong) — bật OpenAI + Google + OpenAI-compat (API key) qua `model-resolver`; reasoning-degrade per model.
  - **C4** (xong) — cutover Pi default; gỡ `@anthropic-ai/claude-agent-sdk` khỏi sidecar + electron-builder.yml + cập nhật ADR 0023/0026/0014 + [tech-stack.md](../architecture/tech-stack.md).
- **Bảo mật (invariant giữ nguyên):** OAuth token **chưa từng rời sidecar** (đẩy in-process vào Pi, không env subprocess, không vào trace/log UI — invariant #1); tool `Read/Write/Edit/Bash` của AWOG tôn trọng `assertInsideWorkspace` + path-sanitize (invariant #2); git cwd=workspaceRoot (invariant #3); MCP SSRF http guard giữ (invariant #7); model API host allowlist không nới (invariant #5). Pi gọi Anthropic trực tiếp HTTPS (no port public — invariant #6).
- **Rủi ro chính (mitigation):**
  1. **Tool-semantics drift (cao nhất):** Edit cần Read-trước + exact-match; Read kiểu `cat -n`; `pickDiffStats` đọc `old_string/new_string` → tool AWOG bám sát hợp đồng Claude Code, **giữ tên + arg-key**, test kỹ Edit ở C1.
  2. **Permission parity:** `beforeToolCall` phải tái hiện đúng 4 mode + `updatedInput` + always-allow + abort-reject — test từng mode C1.
  3. **Prompt-cache:** Pi **tự** set `cache_control` cho Anthropic (đã verify) → đo token C1 (parallel-runner dev-only) so với path `sdk`; thêm breakpoint nếu lệch.
  4. **`/compact`:** không có sẵn ở Pi → reimplement; test giữ ngữ cảnh sau compact.
  5. **OAuth delivery:** ĐÃ GIẢI — `apiKey`/`getApiKey` + auto-detect `sk-ant-oat`; giữ refresh-on-401 (forceRefresh khi 401).
  6. **ESM/bundling:** Pi ESM thuần JS 0 native → ship `sidecar/node_modules` (Pi) trong extraResources; bỏ Claude CLI binary. `tsconfig` `module:NodeNext` import Pi không lỗi CJS interop (verify C0).

## Cập nhật 2026-08-15 — nâng pi 0.79.9 → 0.84.2

Lý do: catalog `openai-codex` của 0.79.9 dừng ở `gpt-5.5`, nên model GPT-5.6 (Sol/Terra/Luna) của gói ChatGPT không resolve được ở runtime (`getModel('openai-codex', …)` throw). 0.84.2 có đủ 7 model codex.

0.84 tái cấu trúc API (breaking). Cách AWOG hấp thụ, giữ nguyên nguyên tắc **credential thuộc về AWOG** (multi-account/provider — mô hình `CredentialStore` 1-credential/provider của pi không diễn tả được):

| Thay đổi ở pi 0.84 | Cách xử lý ở AWOG |
|---|---|
| Root export bỏ `getModel`/`getModels`/`completeSimple`/`streamSimple` (chuyển sang collection `Models`) | Import từ `@earendil-works/pi-ai/compat` — cùng chữ ký, catalog tĩnh, không đụng `Models` |
| `runAgentLoop(...)` thêm tham số thứ 6 `streamFn` | Truyền `streamSimple` (compat) — đúng dispatcher loop dùng nội bộ trước đây |
| `/oauth` bỏ `loginOpenAICodex` + `getOAuthApiKey`, thay bằng object `OAuthAuth` (`login`/`refresh`/`toAuth`) lấy qua `openaiCodexProvider()` | [openai-codex-oauth.ts](../../apps/desktop/sidecar/src/auth/openai-codex-oauth.ts): login trả lời prompt `select` = `browser`, prompt `manual_code` chỉ dùng làm đòn bẩy huỷ; refresh khi `expires <= now + 60s` rồi `toAuth` → bearer. Header `chatgpt-account-id` pi tự trích từ JWT nên không cần plumb thêm |
| `generateSummary` nhận `Models` (tự resolve auth) thay vì `apiKey`/`headers` | `/compact` truyền một `Models` tối giản chỉ hiện thực `completeSimple`, uỷ quyền về compat kèm key + headers của AWOG ([run-stream.ts](../../apps/desktop/sidecar/src/runtime/run-stream.ts)) |

Union `AgentEvent` **không đổi** giữa 2 phiên bản (đã diff) → step/trace mapper giữ nguyên. Kèm theo: picker model của connection ChatGPT (Codex) nay đọc `account.models` như custom endpoint — trước đó chỉ custom endpoint được đọc, nên list curate trong "Sửa kết nối" không tới được chip session.

## Tham chiếu

- [ADR 0026](./0026-per-agent-multi-provider-llm.md) — multi-provider (ADR này thay lựa chọn runtime của 0026 Phase C).
- [ADR 0023](./0023-sdk-session-resume-and-compact.md) — resume/`/compact` (amend: rebuild Context từ JSONL).
- [ADR 0014](./0014-mcp-servers-stdio-runtime.md) — MCP Q4 (amend: gọi in-process).
- [ADR 0018](./0018-mcp-secret-keychain.md) — secret keychain (giữ).
- [ADR 0008](./0008-stdio-ipc-for-sidecar.md) — stdio IPC (lựa chọn SDK gốc, bị supersede phần runtime).
- Spike: `apps/desktop/sidecar/scripts/pi-spike.mts` (throwaway, không commit).
- `@earendil-works/pi-ai` + `pi-agent-core` v0.78.1 (MIT, ESM).
