# 0058 — Dual-runtime: Claude Agent SDK (Anthropic) cạnh Pi SDK (còn lại) — revisit ADR 0029

- **Trạng thái:** Accepted (hướng chốt với user 2026-07-01) — implement phân kỳ, **chưa bắt đầu**
- **Ngày:** 2026-07-01
- **Người quyết định:** Tech Lead + user (hướng chốt 2026-07-01)
- **Liên quan:** [0029](./0029-migrate-llm-runtime-to-pi-sdk.md) (migrate sang Pi — ADR này **revisit / supersede phần single-runtime**), [0026](./0026-per-agent-multi-provider-llm.md) (multi-provider), [0027](./0027-tauri-vs-electron-revisit.md) (Electron + bundle size), [0030](./0030-subagent-task-tool.md) (subagent Task tool), [feature dual-sdk-runtime](../features/dual-sdk-runtime.md) (thiết kế + task breakdown)

## Bối cảnh

**Confab problem.** Session `ses-mqvoiivy`: model kể "giao cr/qa/dev subagent → APPROVED + bảng review" nhưng **0 tool call** — bịa. Đã xác định là **confabulation model-side**, khuếch đại bởi pattern orchestration nhiều subagent + transcript dài (không phải bug thiếu tool: Task tool chạy thật ở các turn khác). Đã ship mitigation **trên Pi**: `TOOL_DISCIPLINE_PROMPT` + `VERIFY_PROMPT` (hardened) + confabulation-guard ([confabulation-guard.ts](../../apps/desktop/sidecar/src/runtime/confabulation-guard.ts) qua Pi hook `getFollowUpMessages`).

**Khảo sát craft-agents-oss (README hiện tại, 2026-06/07).** Nguyên văn: *"Craft Agents uses the **Claude Agent SDK** and the Pi SDK side by side."* — `@anthropic-ai/claude-agent-sdk` là **engine chính** cho phần lớn kết nối; Pi SDK chỉ cho vài provider (Google AI Studio, ChatGPT OAuth, GitHub Copilot, OpenAI key). Sức đề kháng confab của craft (nếu có) đến **gián tiếp** từ harness first-party + **system prompt Claude Code** trên đường Anthropic — **không** phải một cơ chế anti-confab (đã đọc harness pi-agent-core: `getFollowUpMessages`/`getSteeringMessages` chỉ drain hàng đợi user, không guard). Trên **đường Pi** của craft (non-Anthropic) confab vẫn có thể xảy ra → craft **không miễn nhiễm**, chỉ resistant có điều kiện.

**Lệch với ADR 0029.** ADR 0029 (2026-06-05) khảo sát craft và ghi *"craft **không** dùng claude-agent-sdk, dùng Pi làm runtime DUY NHẤT"*. README craft **hiện tại** nói ngược lại (dual). → craft **đã đổi kiến trúc** sau thời điểm đó (hoặc ADR đọc giản lược). ADR 0029 rời claude-agent-sdk sang Pi **vì claude-agent-sdk Anthropic-only** — toàn bộ agent loop/MCP/permission/stream/resume nằm trong `query()`, chặn OpenAI/Google.

**Câu hỏi user.** Có nên đổi để `@anthropic-ai/claude-agent-sdk` làm engine chính (như craft), Pi chỉ cho vài provider?

**Ràng buộc kế thừa từ ADR 0029 (giữ chi phí chuyển thấp):** AWOG **đã giữ tên + arg-key tool kiểu Claude Code** (`Read/Write/Edit/Bash/Grep/Glob`, `file_path/old_string/...`) → `step-mapper`/`trace-mapper`/Workspace Panel không phụ thuộc runtime. Đây là điểm khiến Option C/A **khả thi mà không đập UI**.

## S0 spike — facts đã verify (2026-07-01)

> ⚠️ **Điểm "không native binary" dưới đây đã bị đính chính** — xem [Cập nhật 2026-07-01](#cập-nhật-2026-07-01--chốt-full-craft-literal--đính-chính-s0). SDK ≥ 0.2.113 CÓ native binary per-platform (~210MB); spike rơi vào nhánh JS fallback vì không cài optional-dep native. Các fact còn lại (OAuth, prompt-cache, systemPrompt, canUseTool) vẫn đúng.

Chạy thật `@anthropic-ai/claude-agent-sdk@0.3.197` với account OAuth AWOG `hoatq` (script scratch, không đụng lockfile dự án; token KHÔNG log):

- **Package = JS bundle tự chứa** (`sdk.mjs` 899KB), **không `bin`, không native binary riêng** (khác mô hình cũ vendored `claude` CLI). `query()` **vẫn spawn subprocess** JS chạy bằng node (`executable:'node'`, `pathToClaudeCodeExecutable` built-in, có hook `spawnClaudeCodeProcess`). → Bundling **nhẹ hơn lo ngại** (không cần native binary theo OS) NHƯNG **tái lập mô hình subprocess** mà ADR 0029 đã bỏ.
- **OAuth subscription CHẠY** (rủi ro lịch sử #1 — đã giải): set env `CLAUDE_CODE_OAUTH_TOKEN` = access token resolve qua `resolveCredential('anthropic')`. Kết quả: model `claude-opus-4-8[1m]`, luồng `system→assistant→result`, text "OK", `subtype:success`, **prompt-cache hoạt động** (`cache_creation 16587`), `apiKeySource:none`.
- **systemPrompt preset + append CHẠY**: `{type:'preset', preset:'claude_code', append:'…'}` → chỉ thị chèn (token QZX9) được model tuân. ⇒ **inject AGENT.md của AWOG khả thi** trên nền prompt Claude Code first-party (đúng thứ ta muốn cho confab).
- **API surface đủ**: `canUseTool` (→ `{behavior:'allow',updatedInput}|{behavior:'deny',message}` map thẳng 4-mode AWOG), `permissionMode`, `mcpServers`, `allowedTools/disallowedTools`, `resume`(session id), `includePartialMessages`(stream), `continue`. 28 built-in tool.
- **⚠️ canUseTool KHÔNG fire** trong 2 test nhanh (tool trong `allowedTools` → auto-approve bỏ qua callback; `permissionMode:'default'` không allowlist → cũng không gọi). Điều kiện kích hoạt **phụ thuộc permission-mode, KHÁC Pi `beforeToolCall`** (fire MỌI tool call). ⇒ map 4-mode AWOG lên SDK cần thiết kế kỹ (allowlist pre-approve vs canUseTool fallback vs mode) — **chi phí tích hợp thực, không phải blocker**.
- **Resume**: SDK có session store riêng (`~/.claude/projects/`) — mâu thuẫn "JSONL là source-of-truth" của AWOG; sẽ phải **bỏ qua resume native, rebuild Context từ JSONL mỗi turn** (như đang làm với Pi).
- **Bẫy môi trường**: spike cần `HOME=/Users/kyro` để `awogHome()` trỏ đúng credential store (switcher, xem `project_awog_home_real_path`).

**Kết luận S0:** feasibility **CAO** — khâu khó nhất (OAuth delivery) đã chạy; API đủ; bundling không cần native binary. Chi phí thực còn lại: (1) **tái lập subprocess+env-token** (đảo lợi ích ADR 0029), (2) **parity permission** (`canUseTool` ≠ `beforeToolCall` — cần map cẩn thận), (3) **resume** phải tự rebuild từ JSONL (bỏ session store SDK), (4) **confab-guard hiện tại Pi-specific** (`getFollowUpMessages` không có ở SDK — nhánh này dựa system prompt first-party). Không đổi khuyến nghị **B trước**; nhưng nếu chọn C/A, đường đi đã rõ, **không có blocker chặn**.

## Quyết định

> **Chốt (user, 2026-07-01): xây dual-runtime TÁCH BIỆT** — `ClaudeSdkRuntime` (SDK first-party) phục vụ **provider Anthropic**; `PiRuntime` (code hiện tại) phục vụ **mọi provider còn lại**. **Fallback theo provider** (KHÔNG toggle per-account): Anthropic → SDK, khác → Pi. Path SDK **dùng native tool/prompt/permission/loop của SDK** (bỏ custom plumbing của AWOG), chỉ thêm **event-adapter** (SDKMessage → SessionStep) cho UI. **Parity dần**: reimplement feature AWOG-native lên path SDK qua cơ chế SDK (hooks/subagent/`mcpServers`/`systemPrompt.append`) theo lộ trình — [feature dual-sdk-runtime](../features/dual-sdk-runtime.md).

Đây là **Option A** (dual-SDK như craft) với tinh chỉnh "2 bộ code tách biệt + parity dần". **Supersede phần "single runtime" của [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md)** (Pi vẫn giữ nhưng KHÔNG còn là runtime duy nhất; claude-agent-sdk quay lại như runtime thứ hai cho Anthropic).

**Config đã chốt:** (1) chọn runtime **theo provider**; (2) phạm vi path SDK = **parity dần** (không "lean mãi").

**S0 đã de-risk** (xem §S0): OAuth delivery + prompt-cache + `systemPrompt` preset/append đều chạy.

**Interim (đang chạy):** mitigation trên Pi (`TOOL_DISCIPLINE_PROMPT` + `VERIFY_PROMPT` + confab-guard) tiếp tục phục vụ path Pi + như lưới trong lúc build path SDK.

### Cập nhật 2026-07-01 — chốt "full craft literal" + đính chính S0

Sau khi đọc thẳng source craft-agents-oss (`packages/shared/src/agent/backend/`) và khảo sát process/packaging thật, user **chốt nâng lên "full craft literal"** — nhân bản đúng mô hình đa-subprocess của craft, KHÔNG dừng ở "event-adapter mỏng":

- **`AgentBackend` interface + `createBackend(config)` switch theo `provider`** (craft `factory.ts:133`): `anthropic` → `ClaudeAgent`, còn lại → `PiAgent`.
- **`ClaudeAgent`** bọc SDK `query()` → **native `claude` binary**. **`PiAgent`** spawn **`pi-agent-server` subprocess bằng bundled bun**, transport JSONL over stdio + network interceptor `--require`; creds gửi qua init message; tool cần credential/session proxy ngược về host (`tool_execute_request/response`).
- **Sidecar giữ vai orchestrator/backend-host** (như "main process" của craft): electron main **vẫn spawn 1 sidecar như cũ**; cây subprocess (Pi bun + native claude) treo **dưới sidecar**. → change-surface chủ yếu trong sidecar + packaging, không phải electron/renderer.
- **KHÔNG custom tool nào trên path SDK** (user chốt 2026-07-01): ClaudeAgent dùng **thuần tool built-in của SDK** (Read/Write/Edit/Bash/Grep/Glob/TodoWrite/WebFetch/WebSearch/ExitPlanMode/Task). Không port ~15 file custom tool AWOG sang path Claude. Sức đề kháng confab đến từ tool-harness first-party — nhồi custom tool sẽ pha loãng chính điều đó. Hệ quả: **subagent = Task native SDK** (không phải ADR 0030), **plan = ExitPlanMode native** (không phải plan-tool AWOG); session Anthropic tạm **mất** tool AWOG-native (RunWorkflow/session-task-link ADR 0055, AskUserQuestion park). MCP external của user vẫn vào qua `options.mcpServers` (cơ chế native SDK, KHÔNG phải custom tool); **không** dùng `createSdkMcpServer` gói hàm AWOG trên path Claude (nghiêm hơn craft — đúng "SDK quyết định").

**Đính chính S0 (QUAN TRỌNG):** kết luận cũ *"SDK = JS bundle, không native binary"* **SAI/thiếu**. SDK ≥ 0.2.113 ship **native `claude` binary per-platform** (optional-dep `@anthropic-ai/claude-agent-sdk-{platform}-{arch}` ~210MB) và craft trỏ `pathToClaudeCodeExecutable` vào binary đó (`runtime-resolver.ts`). Spike AWOG rơi vào nhánh JS fallback vì không cài optional-dep native. ⇒ lo ngại bundle của ADR 0027 **hồi sinh mạnh**: full craft ship native claude (~210MB/OS) + bundled bun + ripgrep + koffi + interceptor → **DMG ~600–800MB, Win ~500–700MB, Linux ~700–900MB**. Windows chỉ x64; Linux chỉ glibc.

**Bằng chứng confab định lượng (thay/bổ sung citation ses-mqvoiivy):** session `ses-mqzzhzec` (15MB, 51 agent turn, 1 lần compact) — tool chạy nặng ở giữa (có turn 158 step) nhưng **6 turn cuối = 0 tool call**, model bịa nguyên code block (`_prepare_ai_inspection_folder` dòng 1063-1109) + timestamp log; user gõ thẳng "call tool đi" nhưng turn kế **vẫn 0 tool + vẫn khẳng định "đã đọc bằng tool thật"**. Confab-guard **không bắt** vì pattern thiếu động từ `đọc/grep/check log` + chỉ nudge 1 lần (soft). ⇒ mitigation prompt/guard có **trần cấu trúc** → củng cố quyết định harness first-party.

**Craft không nhân bản 100% được ở 2 điểm:** (a) `bridge-mcp-server` **không có trong OSS** (chỉ path resolved, không spawn) → bỏ; (b) `session-mcp-server` craft **packaged nhưng không spawn** (session tools chạy in-process) → AWOG không cần subprocess này.

**Đánh đổi mới nuốt thêm:** đảo **phần in-process của ADR 0029** (Pi → subprocess bun) + **phần MCP in-process của ADR 0014** (runtime MCP rời `McpManager`, còn UI); nới invariant #1 (token vào tiến trình con qua env/init message — không lên UI, cần infosec review); bundle phình 600–900MB.

**Đảo pitfall #5 (resume): đường Claude DÙNG session store của SDK cho turn thường.** Khi đọc source craft (`claude-agent.ts:1336`) mới thấy craft **không** rebuild từ JSONL — nó `resume: sdkSessionId` để SDK tự giữ history. AWOG bám theo: mỗi Session lưu thêm `sdkSessionId`, đường Claude `resume` qua đó; JSONL vẫn là bản ghi UI + seed context cho turn Claude ĐẦU TIÊN của session cũ.

**`/compact` KHÔNG dùng native-SDK — luôn qua Pi `runCompact` + re-seed (chốt user 2026-07-02, verified).** SDK auto-compact chỉ chạy khi context gần đầy (adaptive) → `/compact` thủ công thường no-op → user báo "Nothing to compact". Fix: `runner.ts` route `slashCommand==='compact'` **về Pi `runCompact` cho MỌI provider** (summarization provider-agnostic, ADR 0047) → luôn tạo checkpoint `{summary, firstKeptMessageId}`. Trên đường Claude, fold `session.compacted` **clear `sdkSessionId`** → turn kế `runStreamClaude` **re-seed SDK session mới từ [summary + kept turns]** (`renderHistoryPrefix` tôn trọng compaction). ⇒ `/compact` **deterministic, LUÔN nén** trên cả 2 runtime. (Auto-compact: ngưỡng `shouldAutoCompact` fire ~983k trên model 1M → gần như không chạy; sửa sang % (~80%) vẫn là follow-up UI độc lập.)

### Trạng thái implement (2026-07-01) — luồng session Anthropic ĐÃ chạy + test

Slice đầu tiên (luồng **session** cho provider `anthropic`) đã **implement + test PASS thật** với account OAuth `hoatq`:

- **Code**: `runtime/claude-sdk/run-stream.ts` (`runStreamClaude`) + `runtime/claude-sdk/event-adapter.ts` (SDKMessage → `StreamCallbacks`, tái dùng `step-mapper`); `sessions/runner.ts` route theo `provider` (anthropic → Claude SDK, còn lại → Pi); `Session.sdkSessionId` + `RunNonStreamArgs`/`RunStreamResult` + `sessions.send-message.ts` (đọc/persist `sdkSessionId`) + `SessionMetadataPatch`. Dep `@anthropic-ai/claude-agent-sdk@0.3.197`. Typecheck sạch.
- **In-process trong sidecar** (chưa subprocess-hoá Claude — SDK `query()` tự spawn native/JS-fallback binary con). **Thuần built-in tool SDK, không custom tool** (đúng chốt user). Credential đẩy qua `options.env` (`CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) — KHÔNG mutate `process.env` global (tránh race đa-session).
- **Session store của SDK**: `<claudeHome>/projects/`. ~~AWOG set `env.CLAUDE_CONFIG_DIR = ~/.awog/claude-sdk`~~ — **amend bởi [ADR 0070](./0070-share-claude-home-for-config.md) (2026-08-19)**: override bị gỡ vì nó làm `Skill` tool của SDK quét một config dir không có `skills/`; store giờ nằm chung `~/.claude/projects/` với CLI thật. Là **store thứ 2** song song JSONL (JSONL = UI record; SDK store = context/resume) — cần đồng bộ fork/regenerate/xoá (follow-up).
- **Test headless (2 turn)**: turn 1 fresh → gọi Read tool (native) + stream text đúng + prompt-cache chạy + bắt `sdkSessionId`; turn 2 `resume` → nhớ context turn 1 (`input_tokens:2`) → **resume/continuity OK**. Tất cả assertion PASS.
- **P4 (đã làm + test)**: **MCP qua `options.mcpServers`** (convert `McpServersConfig`, SSRF-guard http, `alwaysLoad`) — test end-to-end model gọi được external stdio MCP tool. **Permission 4-mode** qua **PreToolUse hook + `bypassPermissions`** (bỏ `canUseTool` SDK vì không fire tin cậy — S0 đúng), tái dùng `makeBeforeToolCall`+`withTurnBudget` của Pi + park `args.canUseTool` → ask fire+allow chạy / deny chặn; plan-mode prompt + gate block writes. `toolUseID` SDK == step id → UI approve correlate.
- **Thinking level (đã làm + test)**: map AWOG `level` → `options.thinking` (`low`→disabled, còn lại→`{type:'adaptive'}`) + `options.effort` (direct: extra-high→xhigh). ⚠️ **Trên OAuth subscription (Claude Max) thinking bị REDACT** — `thinking_delta` có `estimated_tokens` nhưng text rỗng; adapter emit thinking step "Thinking…" (báo model đang nghĩ) + mark done ở `content_block_stop`. API-key mode stream reasoning thật. `contextChars` breakdown: systemPrompt/instructions/memory/agents/skills + **`history` ước lượng từ transcript JSONL** (kept turns từ compaction cut + summary) — vì ui-next tính context gauge từ `contextChars` (KHÔNG từ API usage), nếu omit `history` thì gauge không tăng theo hội thoại NÊN cũng không giảm sau `/compact` (bug user báo 2026-07-02, đã fix + verified: 12577→684 chars sau compact). systemTools/mcpTools vẫn omit (SDK-internal, offset cố định). Gauge giảm ở **turn KẾ TIẾP** sau /compact (contextChars tính per-turn; /compact không chạy turn model).
- **Tasks path (đã làm + test)**: `sdk/invoke.ts` route theo provider → `runtime/claude-sdk/invoke.ts` (`invokeSdkClaude`): one-shot `query()` (no resume), bypass-permission (tasks unattended), native tool + `allowedTools`/`disallowedTools` whitelist, MCP, `parent_tool_use_id`→InvokeCallbacks `parentId` (nest subagent trace). Test: `invokeSdk` route đúng, tool call + usage + `onAssistantMeta`. Shared helper gom ở `claude-sdk/shared.ts`.
- **P3 native-binary bundling (đã làm + test)**: SDK dùng **native `claude` binary** self-contained (~227MB/OS-arch, optional-dep `claude-agent-sdk-{platform}-{arch}`) — KHÔNG có JS-only fallback đơn giản (đính chính giả định "Light không cần native"; binary ĐANG được dùng suốt). **Đã ship sẵn không cần đổi build**: `pnpm deploy --prod` (build.mjs) include optional-dep → cp `verbatimSymlinks:false` → `sidecar/dist/node_modules` file thật → electron-builder ship `sidecar/dist`→`resources/sidecar` verbatim. Thêm `resolveClaudeBinary()` ([binary.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/binary.ts)) → `pathToClaudeCodeExecutable` cho packaged (robustness, không dựa auto-discovery trong layout flat); dev → undefined → SDK auto-discover. Test: explicit path chạy + dev không đổi. **CI concern (chưa làm)**: build per-OS mới có binary của OS đó; mac universal/x64 cần fetch binary arch kia (như craft `npm pack`); Win x64-only, Linux glibc-only.
- **P0 subprocess-hoá Pi: KHÔNG làm (quyết định)** — Pi in-process (pure JS, không koffi) chạy tốt; subprocess-hoá là mimic craft, rủi ro hồi quy cao, lợi ích ~0 (động lực chống-confab đã đạt qua path Claude SDK). Bỏ khỏi phạm vi.

## Phương án đã cân nhắc

### Option B — Pi single-runtime + compensate (INTERIM — đã ship, chạy nền; KHÔNG phải đích)
Giữ Pi là runtime duy nhất; đóng gap tool-discipline của Claude Code bằng: `TOOL_DISCIPLINE_PROMPT` (act-don't-narrate, mọi provider) + `VERIFY_PROMPT` + confabulation-guard cấu trúc. Có thể port thêm phần thân system prompt Claude Code nếu cần.
- **Pros:** giữ single-runtime + multi-provider (ADR 0029); lợi cho **mọi** provider; không bloat bundle; **đã ship**, rẻ; Pi dưới OAuth **đã** tự gắn identity "You are Claude Code" + cache_control.
- **Cons:** không phải harness first-party; phụ thuộc độ trung thực của prompt+guard ta viết; confab là model-side → còn dư địa rủi ro (giảm chứ không triệt tiêu).

### Option C — RuntimeAdapter: Claude Agent SDK **opt-in** cho Anthropic, Pi mặc định (KHÔNG chọn — user chọn tách theo provider, không qua opt-in toggle)
Tách seam `RuntimeAdapter` (interface quanh `runStream`/`invoke`). Mặc định `pi`. Thêm backend `claude-agent-sdk` **bật theo cờ** cho account Anthropic. So sánh A/B confab thực nghiệm rồi mới quyết mở rộng.
- **Pros:** đạt hành xử craft trên đường Anthropic **mà không revert**; đo được lợi ích trước khi cam kết; OCP (thêm adapter, không sửa call-site); Pi vẫn phục vụ non-Anthropic.
- **Cons:** khi bật vẫn phải giữ **parity 2 runtime** (permission 4 mode, resume, /compact, trace, prompt-cache) cho nhánh Anthropic; thêm code seam; nguy cơ YAGNI nếu B đã đủ; tái phụ thuộc Claude CLI binary khi backend bật.

### Option A — Dual-SDK: Claude Agent SDK **primary** (Anthropic) + Pi cho providers (craft-exact) — **CHỌN** (tinh chỉnh: 2 bộ tách biệt + parity dần)
Đúng mô hình craft: claude-agent-sdk là engine chính cho Anthropic, Pi cho phần còn lại.
- **Pros:** đường Anthropic (được dùng nhiều nhất) chạy **harness + system prompt Claude Code first-party** → confab resistance mạnh nhất, sát craft nhất.
- **Cons:** **2 runtime phải bảo trì vĩnh viễn** (2 tool-semantics, 2 permission bridge, 2 resume, 2 event-adapter, 2 stream path) — đảo ngược lợi ích cốt lõi của ADR 0029; **tái thêm dep `@anthropic-ai/claude-agent-sdk` + Claude CLI binary** (bundle ↑, bug đã biết); re-port seam ~9 call-site; hành vi **phân đôi** Anthropic vs khác; confab vẫn xảy ra trên nhánh Pi; công lớn để đảo một migration đã hoàn tất + đang chạy.

### Giữ nguyên (không làm gì) — Loại
Chính là bỏ qua confab. Không chấp nhận; B đã là "làm gì đó" rẻ nhất.

## Hệ quả

- **Supersede phần "single runtime" của ADR 0029** — Pi giữ nguyên nhưng không còn duy nhất; `@anthropic-ai/claude-agent-sdk` quay lại làm runtime thứ hai cho Anthropic. Thêm seam `RuntimeAdapter` + chọn theo provider.
- **Đánh đổi đã chấp nhận (user biết):** **2 runtime maintain song song** (đảo lợi ích single-runtime của ADR 0029) + parity dần (feature AWOG-native làm lại lần 2 trên path SDK) — chi phí thực, đổi lấy tool-use discipline first-party cho đường Anthropic.
- **Bundle:** tái thêm `@anthropic-ai/claude-agent-sdk` + **native `claude` binary per-platform (~210MB/OS)** + bundled bun + ripgrep + koffi + interceptor → DMG ~600–800MB / Win ~500–700MB / Linux ~700–900MB (đính chính S0; Win x64-only, Linux glibc-only). Đo lại size ([ADR 0027](./0027-tauri-vs-electron-revisit.md)).
- **Bảo mật (giữ nguyên invariant):** OAuth token đẩy vào SDK subprocess **qua `env.CLAUDE_CODE_OAUTH_TOKEN` của child do sidecar spawn** (không rò ra ngoài process tree; không log; ⚠️ lưu ý đây là mô hình env-subprocess mà ADR 0029 từng bỏ — phải chắc token không vào trace/log UI); MCP giữ SSRF guard; tool `Read/Write/Edit/Bash` giữ `assertInsideWorkspace`.
- **Confab-guard hiện tại (Pi `getFollowUpMessages`) KHÔNG áp path SDK** — path SDK dựa system prompt Claude Code first-party (đúng mục tiêu); cân nhắc guard tương đương qua SDK hooks ở giai đoạn parity.
- **Không liên quan** tới [pi-sdk-0.80-migration](../features/pi-sdk-0.80-migration.md) (đó là nâng version trong cùng runtime Pi).

## Tham chiếu

- [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md) — migrate sang Pi (ADR này revisit)
- [Feature: Dual-SDK runtime](../features/dual-sdk-runtime.md) — thiết kế chi tiết + task breakdown
- craft-agents-oss README (github.com/craft-ai-agents/craft-agents-oss) — nguồn "side by side"
