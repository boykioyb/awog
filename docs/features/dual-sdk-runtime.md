# Feature: Dual-runtime "full craft" — Claude Agent SDK (native binary) + Pi subprocess

> **Trạng thái:** Accepted — chốt **"full craft literal"** (user, 2026-07-01), [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md). Implement phân kỳ P0–P5, **chưa bắt đầu code**.
>
> **Quyết định:** nhân bản đúng mô hình đa-subprocess của [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss) (`packages/shared/src/agent/backend/`). Chọn runtime **theo provider** (Anthropic → `ClaudeAgent` + native `claude` binary; còn lại → `PiAgent` + subprocess). **Path SDK dùng THUẦN tool/prompt/permission/loop native của SDK — KHÔNG custom tool nào.**
>
> **✅ Đã implement + test slice luồng session Anthropic (2026-07-01)** — in-process trong sidecar, native tool, resume qua SDK session store; test headless 2 turn (tool-call + resume) PASS. Chi tiết + phần chưa làm: [ADR 0058 §Trạng thái implement](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md#trạng-thái-implement-2026-07-01--luồng-session-anthropic-đã-chạy--test).

Mục tiêu chính: **giảm confabulation** ("kể thay vì làm") trên đường Anthropic bằng **tool-harness first-party** của Claude Agent SDK, mà không vứt bỏ multi-provider của [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md). Bằng chứng động cơ: session `ses-mqzzhzec` (6 turn cuối 0 tool-call, model bịa code + log; confab-guard Pi không bắt được — trần cấu trúc của mitigation prompt/guard). Xem [ADR 0058 §Cập nhật](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md#cập-nhật-2026-07-01--chốt-full-craft-literal--đính-chính-s0).

## 1. Nguyên tắc (đã chốt)

- **Chọn theo provider, không toggle**: `account.provider === 'anthropic'` → `ClaudeAgent`; còn lại (openai/google/pi/custom) → `PiAgent`. Thêm **1 kill-switch global** ép toàn bộ về Pi cho tình huống regression.
- **KHÔNG custom tool trên path SDK.** ClaudeAgent chỉ dùng **built-in của SDK** (Read/Write/Edit/Bash/Grep/Glob/TodoWrite/WebFetch/WebSearch/ExitPlanMode/Task). Không port ~15 file `runtime/tools/*` của AWOG sang path này. Đây là **nguồn** đề kháng confab — nhồi custom tool sẽ pha loãng.
- **MCP = cơ chế native SDK, không phải custom tool.** MCP external của user vẫn vào Claude qua `options.mcpServers`. **KHÔNG** dùng `createSdkMcpServer()` gói hàm AWOG (nghiêm hơn craft — đúng "SDK quyết định").
- **Sidecar giữ vai orchestrator/backend-host.** Electron main **vẫn spawn 1 sidecar như cũ**; cây subprocess (Pi bun + native claude) treo dưới sidecar. Không đập electron/renderer/IPC.
- **History**: đường **Pi** rebuild Context từ **JSONL** mỗi turn (source-of-truth, [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md)). Đường **Claude DÙNG session store của SDK** cho turn thường (`resume: sdkSessionId`, bám craft) → history; JSONL vẫn ghi message cho UI + seed context turn Claude đầu của session cũ. **Compaction KHÔNG dùng native-SDK** mà đi Pi `runCompact` → checkpoint → clear `sdkSessionId` → re-seed [summary+kept] (§8).
- **Không đập UI/mapping**: tên + arg-key tool đã giữ kiểu Claude Code → `step-mapper`/`trace-mapper`/Workspace Panel/`SessionStep` union không đổi. Chỉ thêm event-adapter mới cho SDK.
- **Parity có chủ đích**, chấp nhận **bất đối xứng hành vi** (đường Anthropic mất vài tool AWOG-native — xem §8).

## 2. Kiến trúc đích

Sidecar = "main process" của craft. Electron main không đổi.

```
electron main ──spawn(ELECTRON_RUN_AS_NODE)──► SIDECAR  (orchestrator + credential store — GIỮ NGUYÊN vai)
                                                 │  stdio JSON-RPC ⇄ electron ⇄ renderer (không đổi)
                                                 │
                                                 ├─ RuntimeAdapter: createBackend(config) switch theo provider
                                                 │
                                                 ├─ ClaudeAgent (in-proc)         [provider = anthropic]
                                                 │     └─ SDK query() ──spawn──► claude NATIVE BINARY (child)
                                                 │        · creds: env CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
                                                 │        · tools: THUẦN built-in SDK ; MCP external qua options.mcpServers
                                                 │        · resume: rebuild từ JSONL (bỏ session store SDK)
                                                 │
                                                 ├─ PiAgent (in-proc)             [provider ≠ anthropic]
                                                 │     └─ spawn(bun) ──► pi-agent-server SUBPROCESS
                                                 │        · transport: JSONL over stdio (init → prompt → events)
                                                 │        · preload: --require interceptor.cjs
                                                 │        · creds: gửi trong init message
                                                 │        · tool cần credential/session (call_llm/spawn/browser) → reverse-RPC về sidecar
                                                 │
                                                 └─ McpManager  → CHỈ còn UI (test/start/restart/list); KHÔNG phục vụ runtime turn
```

- **`RuntimeAdapter`** = giữ chữ ký `runStream(args, cb)` + `invoke(args, cb)` hiện có → call-site `sessions.send-message.ts` / `tasks/node-runner.ts` **không đổi**. Bên trong: resolve provider trước → dispatch `ClaudeAgent` hoặc `PiAgent`.
- **Cây process treo dưới sidecar**: native `claude` là child do SDK spawn; `pi-agent-server` là child do `PiAgent` spawn. Electron main chỉ biết sidecar.

## 3. `AgentBackend` interface + factory (bám craft)

Craft: `AgentBackend` (`packages/shared/src/agent/backend/types.ts:337`) + `createBackend()` (`factory.ts:133`). Port sang sidecar:

```ts
// sidecar/src/runtime/backend/types.ts
export interface AgentBackend {
  chat(args: RunStreamArgs, cb: StreamCallbacks): Promise<RunStreamResult> // = runStream hiện có
  invoke(args: InvokeArgs, cb: InvokeCallbacks): Promise<InvokeResult>     // one-shot task
  abort(reason?: string): void
}

// sidecar/src/runtime/backend/factory.ts
export function createBackend(provider: LlmProvider): AgentBackend {
  return provider === 'anthropic' ? new ClaudeAgent() : new PiAgent()
}
```

- Provider resolve **trước** switch: hiện `runStreamPi` resolve credential/model bên trong → hoist ra `runner.ts`/adapter (peek `args.settings.accountId` → provider) rồi mới dispatch.
- Non-Anthropic đi `PiAgent` → **không đổi hành vi** so với hôm nay.

## 4. `ClaudeAgent` (Anthropic)

Bọc `@anthropic-ai/claude-agent-sdk` `query()` (craft `claude-agent.ts:1423`).

- **Tools = thuần built-in SDK.** Không truyền custom `tools`. `systemPrompt: { preset: 'claude_code', append: <AGENT.md + rules + commands> }` (S0 xác nhận append chạy).
- **Permission 4-mode** map qua `canUseTool` + `permissionMode` + `allowedTools`/`disallowedTools`. ⚠️ S0: `canUseTool` KHÔNG fire khi tool đã pre-approve/allowlist — khác `beforeToolCall` (fire mọi call). Map cẩn thận: allowlist pre-approve (accept-edits/execute) vs `canUseTool` fallback (ask) vs mode.
- **MCP**: `options.mcpServers` chỉ chứa **external server của user** (đã expand secret ở sidecar). Không `createSdkMcpServer` gói hàm AWOG.
- **Credentials** (craft `claude-agent.ts:666-707`): sidecar resolve rồi set `process.env` **trước query đầu** → native binary (child) kế thừa. `CLAUDE_CODE_OAUTH_TOKEN` (OAuth) / `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`. Clear env cũ trước khi set.
- **Native binary**: `setPathToClaudeCodeExecutable(<resolved>)` trước lần dùng đầu (craft `runtime-resolver.ts` → `applyAnthropicRuntimeBootstrap`).
- **Resume**: dùng session store native của SDK — `resume: sdkSessionId` (bám craft `claude-agent.ts:1336`). AWOG lưu `Session.sdkSessionId`, bắt `session_id` từ SDKMessage → persist qua `updateSessionMetadata`. Session cũ (có JSONL, chưa có `sdkSessionId`): turn Claude đầu prepend `<conversation_so_far>` từ history làm seed, các turn sau `resume`.
- **Vị trí store**: SDK mặc định ghi transcript/resume/compaction vào `~/.claude/projects/<cwd-hash>/<uuid>.jsonl` (trùng chỗ Claude Code CLI). AWOG set `env.CLAUDE_CONFIG_DIR = ~/.awog/claude-sdk` để store **nằm trong data-layer của AWOG**, không trộn với session CLI thật của user. ⚠️ Đây là **store thứ 2** song song JSONL của AWOG (JSONL = bản ghi UI; SDK store = nguồn context/resume) — fork/regenerate/edit/xoá ở UI cần đồng bộ sang SDK store (dùng `forkSession`/`resumeSessionAt` + cleanup file khi xoá session) — follow-up.
- **Event-adapter mới** `SDKMessage → StreamCallbacks` (`onChunk`/`onStep`/`onThinking`/`onToolUse`/`onToolResult`). Tên tool trùng nên `step-mapper` phần lớn tái dùng; mở rộng cho tool native chưa map (TodoWrite/Task/WebSearch/ExitPlanMode).

## 5. `PiAgent` (mọi provider còn lại)

Đưa Pi **in-process hiện tại ra subprocess** (craft `pi-agent.ts`). Đây là phần nặng nhất — đảo phần in-process của [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md).

- **Spawn** (craft `pi-agent.ts:451`): `spawn(runtimePath, ['--require', interceptorPath, piServerPath], { stdio:['pipe','pipe','pipe'], env:{...creds-free..., CRAFT_SESSION_DIR}})`. Lazy trên `chat()` đầu tiên.
- **`pi-agent-server`** = entry mới đóng gói `runtime/run-stream.ts` + `runtime/invoke.ts` + `runtime/tools/*` + `event-adapter.ts` hiện có (chạy dưới subprocess, KHÔNG dưới sidecar). Xem [§10 P0](#10-task-breakdown-nhánh-featdual-sdk-runtime) về package layout.
- **Transport = JSONL over stdio**: init handshake (`init` → `init_response`) → `prompt` → stream events (`agent_tool_use`/`agent_message`/`agent_end`/`agent_error`). Sidecar đọc line, re-emit qua stdio của nó lên electron (chú ý **backpressure** — §9).
- **Interceptor** (`--require`, craft `pi-agent.ts:417-420`): patch `globalThis.fetch` (metadata tool-schema, SSE, error capture). Chỉ áp cho Pi (native binary Claude không nhận `--require`).
- **Credentials**: sidecar resolve → gửi trong **init message** (`piAuth: { provider, credential }`, craft `pi-agent.ts:508-535`). Tool cần credential/session (`call_llm`/`spawn_session`/`browser`) chạy **ở sidecar** qua reverse-RPC `tool_execute_request/response` (không cho subprocess đọc credential store).
- **Runtime của subprocess (open Q)**: craft chạy `pi-agent-server` trên **bun** (target bun + koffi FFI). AWOG's Pi hiện chạy **node in-process, không koffi**. → Verify AWOG's Pi stack có cần bun/koffi không; nếu không, chạy subprocess trên **node bundled** (vẫn "Pi là subprocess", bỏ bun+koffi khỏi bundle). Chốt ở P0/P3.

## 6. Đóng gói (electron-builder) — hồi sinh ADR 0027

**P3-A đã làm (native binary, KHÔNG subprocess-hoá Pi).** Native `claude` binary self-contained là cơ chế thật của SDK (không có JS-only fallback đơn giản). **Ship qua pipeline sẵn có, KHÔNG cần đổi build/electron-builder**:

| Thành phần | Cách ship trong AWOG | Kích thước |
|---|---|---|
| SDK core `@anthropic-ai/claude-agent-sdk` | dep của sidecar → `pnpm deploy` → `sidecar/dist/node_modules` → `resources/sidecar` | ~4MB |
| **native `claude`** (`claude-agent-sdk-{platform}-{arch}`) | optional-dep → `pnpm deploy --prod` include → `cp verbatimSymlinks:false` (file thật) → ship verbatim. `resolveClaudeBinary()` → `pathToClaudeCodeExecutable` (packaged); dev auto-discover | **~227MB/OS-arch** |

- **KHÔNG thay đổi** `electron-builder.yml`/`pack.mjs`/`build.mjs` — `sidecar/dist`→`resources/sidecar` (extraResources, file thật) đã cuốn theo binary; `pnpm deploy` đã include optional-dep (verified). Chỉ thêm [binary.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/binary.ts) (resolver) + wire `pathToClaudeCodeExecutable` vào 2 options. Test: explicit path chạy; dev không đổi.
- **Giới hạn**: Windows **x64-only**, Linux **glibc-only** (theo ma trận optional-dep của SDK).
- **CI cross-arch (chưa làm)**: build per-OS mới tự có binary của OS đó; mac universal/x64 cần fetch binary arch kia (như craft `npm pack @anthropic-ai/claude-agent-sdk-{platform}-{arch}`). Đo size packaged 3 OS khi lên release.
- **KHÔNG dùng** (khác craft): bun, ripgrep vendored, `pi-agent-server`/`session-mcp-server`/`bridge-mcp-server`, network interceptor — vì **Pi giữ in-process** (P0 bỏ) nên không cần subprocess bundles. Đây là điểm AWOG cố tình đơn giản hơn craft.

## 7. Bảo mật (invariant AWOG)

- **Token KHÔNG lên UI/log/trace** (invariant #1 giữ nguyên). Sidecar là **nơi duy nhất** đọc keychain/credential store.
- **Nới có kiểm soát**: token vào tiến trình con (Claude native binary qua `env`; Pi qua init message) — **xuống** subprocess do sidecar spawn, **không lên** renderer. Craft làm vậy. **Cần infosec review**: chắc token không vào stderr/log ring-buffer/diagnostics, không vào JSONL/trace.
- **MCP**: giữ SSRF guard + secret expand + whitelist **ở sidecar** trước khi truyền map (đã-expand) cho path tương ứng.
- **Tools built-in SDK** (Read/Write/Bash) — verify vẫn bị chặn ngoài workspace (SDK có `cwd`/permission; cân nhắc `disallowedTools` hoặc `canUseTool` gate cho path traversal).

## 8. Parity & bất đối xứng hành vi (chấp nhận)

| Khả năng | Pi path | Claude (SDK) path |
|---|---|---|
| Coding tools (Read/Write/Edit/Bash/Grep/Glob) | custom AgentTools | **built-in SDK** |
| Subagent | AWOG Task tool ([ADR 0030](../decisions/0030-subagent-task-tool.md), depth=1) | **Task native SDK** |
| Plan mode | plan-tool AWOG (`ExitPlanMode` stub) | **ExitPlanMode native SDK** |
| Permission 4-mode | `beforeToolCall` | **PreToolUse hook + `bypassPermissions`** (reuse `makeBeforeToolCall` — `canUseTool` SDK không tin cậy) |
| MCP | in-process bridge | `options.mcpServers` (external only) |
| Resume | rebuild JSONL | **SDK session store** (`resume: sdkSessionId`) |
| `/compact` | Pi `runCompact` (checkpoint) | **cùng Pi `runCompact`** (runner route compact→Pi mọi provider) → checkpoint `{summary,firstKeptMessageId}` **clear `sdkSessionId`** (fold `session.compacted`) → turn kế **re-seed SDK session mới từ [summary + kept turns]**. LUÔN nén (không dựa adaptive-compact của SDK) — verified |
| Confab-guard | có (`getFollowUpMessages`) | **không** (dựa harness first-party — đúng mục tiêu) |
| RunWorkflow / session↔task ([ADR 0055](../decisions/0055-session-task-link.md)) | có | **KHÔNG** (là custom tool → loại theo "SDK quyết định") |
| AskUserQuestion (park mid-turn) | có | **KHÔNG** (park-based là custom) — dùng cơ chế SDK nếu có |

**Hệ quả UX**: session Anthropic (path SDK) hành xử khác OpenAI/Google (path Pi) cho tới khi (nếu) parity thêm. Ghi rõ cho user; kill-switch cho ai cần đủ tính năng AWOG-native → ép về Pi.

**`/compact` là workstream riêng, runtime-agnostic** (đã bàn): ngưỡng `shouldAutoCompact` hiện fire ở `used > limit − 16384` → với model 1M là ~983k → gần như không chạy. Sửa sang ngưỡng phần trăm (~80%) trong [context-window.ts](../../apps/desktop/ui/utils/context-window.ts) — lợi cho cả 2 path, làm độc lập P0–P5.

## 9. Cạm bẫy đã biết

1. **Bundle 600–900MB** — cái giá lớn nhất; đo lại vs [ADR 0027](../decisions/0027-tauri-vs-electron-revisit.md).
2. **Windows x64-only, Linux glibc-only** — thu hẹp target so với hiện tại.
3. **bun+koffi** — chỉ thêm nếu Pi thật sự cần (open Q §5); nếu không, node bundled đơn giản hơn.
4. **`canUseTool` ≠ `beforeToolCall`** (S0) — permission mapping cần spike riêng.
5. **Backpressure Pi→sidecar→electron**: subprocess stdout đầy → block event loop Pi. Dùng ring-buffer decouple ở sidecar.
6. **Subprocess lifecycle**: Pi/native binary exit giữa turn → reject pending + error rõ + backoff/restart. Mỗi subprocess có exit handler + stderr tag riêng.
7. **Confab-guard mất trên path Claude** — chủ ý; nếu cần lưới, dựng cơ chế "no-tool-call → re-prompt" qua hook SDK (không phải `getFollowUpMessages`).
8. **Token vào subprocess** — §7, cần infosec review.

## 10. Task breakdown (nhánh `feat/dual-sdk-runtime`)

Mỗi phase build/typecheck/lint xanh, không hồi quy non-Anthropic.

- [x] **S0 — Spike** (2026-07-01): `query()` + OAuth + prompt-cache + systemPrompt preset/append chạy. (Đính chính: native binary CÓ ~210MB — xem ADR §Cập nhật.)
- [ ] **P0 — Tách Pi ra subprocess** (behavior-neutral, vẫn Pi-only): tạo entry `pi-agent-server` (package mới `apps/desktop/pi-runtime` **hoặc** entry thứ 2 build từ `sidecar/src/runtime/*` — chốt bun vs node ở đây); sidecar spawn + JSONL stdio + init handshake + reverse-RPC creds/`call_llm`; ring-buffer backpressure. `runStream`/`invoke` giữ chữ ký, bên trong thành RPC client. **Mục tiêu: mọi thứ chạy y như cũ nhưng Pi ở subprocess.**
- [ ] **P1 — `AgentBackend` + factory + `PiAgent`**: bọc subprocess sau interface; hoist provider-resolve lên adapter; kill-switch global. Non-Anthropic không đổi.
- [ ] **P2 — `ClaudeAgent` + SDK + native binary** (dev, chưa bundle): `query()` thuần built-in tool + `systemPrompt` preset/append; event-adapter `SDKMessage→StreamCallbacks`; resume rebuild JSONL; creds env. **Anthropic chat/coding chạy end-to-end trong UI.**
- [ ] **P3 — Packaging 3 OS**: native claude binary (+bun/koffi nếu chốt) + ripgrep + interceptor + pi-agent-server bundle; electron-builder extraResources + `runtime-resolver` cho AWOG; đo size; launch mac/win/linux.
- [ ] **P4 — Parity path SDK**: (a) permission 4-mode qua `canUseTool`; (b) rules/commands qua `systemPrompt.append`; (c) MCP external qua `options.mcpServers`; (d) `/compact` + usage token; (e) trace/step cho tool native mới. (Subagent/plan = native SDK, không port.)
- [ ] **P5 — QA A/B confab + docs**: tái hiện kịch bản `ses-mqzzhzec` trên cả 2 runtime, đo confab rate (turn 0-tool claim việc); cập nhật [tech-stack.md](../architecture/tech-stack.md) + đóng phase ADR 0058.

**Song song (độc lập runtime):** sửa ngưỡng auto-compact (§8).

## 11. Definition of Done

- **P2 (MVP):** account Anthropic chạy chat/coding qua Claude SDK (native binary) end-to-end trong UI, step/trace đúng, **thuần tool SDK**; non-Anthropic qua Pi subprocess không hồi quy; token không rò log/trace/UI.
- **P3:** bundle đo được + launch xanh 3 OS.
- **P4:** parity theo lộ trình hoạt động ngang Pi (trừ tool AWOG-native cố ý bỏ — §8).
- **P5:** số liệu confab A/B chứng minh path SDK giảm "kể thay vì làm".

## 12. Open questions còn lại

- **Pi subprocess runtime**: bun (100% craft, +koffi) hay node bundled (nhẹ hơn, nếu Pi không cần bun)? — verify + chốt P0.
- **Package layout Pi**: package riêng `apps/desktop/pi-runtime` hay entry thứ 2 trong sidecar build? — chốt P0.
- **Kill-switch**: UI setting hay env ẩn? — chốt P1.
- **Token vào subprocess**: init-message (craft) đủ an toàn, hay reverse-RPC lấy theo turn (conservative hơn)? — infosec review P0/P1.
- **`disallowedTools` cho path-traversal** trên tool built-in SDK (Bash/Write ngoài workspace)? — chốt P4.
