# Tham chiếu: toàn bộ `Options` của Claude Agent SDK

> Đo trên **`@anthropic-ai/claude-agent-sdk@0.3.260`** (bản đang khoá trong [apps/desktop/sidecar/package.json](../../apps/desktop/sidecar/package.json)) — 66 option cấp 1 của type `Options` trong `sdk.d.ts`.
>
> **Cột AWOG:** 💬 = phiên chat ([claude-sdk/run-stream.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts)) · ⚙️ = node của task ([claude-sdk/invoke.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/invoke.ts)) · **—** = chưa dùng.
>
> **Làm mới khi bump SDK:** `Options` nằm trong `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`; hai object thật AWOG truyền vào `query()` là `const options: Options = {` trong hai file trên. So hai danh sách đó là ra bảng này.

## Model & suy nghĩ

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `model` | `string` | Model chính | 💬⚙️ |
| `fallbackModel` | `string` | Model dự phòng khi model chính quá tải/không có. Nhận danh sách phẩy, thử lần lượt; model chính được thử lại ở đầu mỗi lượt user nên sự cố tạm thời không hạ cấp vĩnh viễn | 💬⚙️ |
| `thinking` | `ThinkingConfig` | Bật/tắt extended thinking | 💬⚙️ |
| `effort` | `EffortLevel` | Độ "chịu khó" của lượt | 💬⚙️ |
| `maxThinkingTokens` | `number` | Trần token cho phần suy nghĩ | — |
| `betas` | `SdkBeta[]` | Bật beta (vd `context-1m-2025-08-07`) | — |

## System prompt

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `systemPrompt` | `string \| string[] \| {type:'custom'} \| {type:'preset', preset:'claude_code', append?, snapshot?}` | Prompt hệ thống, hoặc preset Claude Code + phần append | 💬⚙️ |

## Phiên & lưu trữ

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `resume` | `string` | Session id để resume | 💬 |
| `sessionId` | `string` | Ép session id thay vì để SDK sinh | — |
| `resumeSessionAt` | `string` | Resume CHỈ tới message UUID này (cắt phần sau) | — |
| `resumeDropsTurn` | `string` | Đi kèm `resumeSessionAt`: khai UUID của lượt mà lần resume-cắt này định bỏ | — |
| `forkSession` | `boolean` | Resume nhưng tách sang session id mới | — |
| `continue` | `boolean` | Tiếp hội thoại gần nhất ở cwd (xung khắc `resume`) | — |
| `title` | `string` | Tiêu đề cho session mới | — |
| `persistSession` | `boolean` | `false` = không ghi transcript xuống đĩa | — |
| `sessionStore` | `SessionStore` | Mirror transcript ra store ngoài | — |
| `sessionStoreFlush` | `SessionStoreFlush` | Nhịp flush xuống store đó | — |
| `loadTimeoutMs` | `number` | Timeout mỗi `sessionStore.load()` khi dựng lại lúc resume | — |

## Luồng sự kiện trả về

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `includePartialMessages` | `boolean` | Phát sự kiện streaming từng phần | 💬⚙️ |
| `includeHookEvents` | `boolean` | Phát cả sự kiện vòng đời của hook | — |
| `forwardSubagentText` | `boolean` | Đẩy text + thinking của subagent ra ngoài dưới dạng message kèm `parent_tool_use_id` | — |
| `outputFormat` | `{type:'json_schema', schema}` | Ép model trả dữ liệu đúng JSON Schema | ⚙️ |
| `agentProgressSummaries` | `boolean` | Cứ ~30s fork hội thoại subagent để sinh một câu tiến độ ("Analyzing authentication module"), gửi qua `task_progress.summary`. Dùng lại model + prompt cache của subagent nên gần như không tốn | 💬⚙️ |
| `promptSuggestions` | `boolean` | Sau mỗi lượt phát một message `prompt_suggestion` đoán prompt kế tiếp của user (đi nhờ prompt cache của lượt cha ⇒ gần như miễn phí). Tắt ở lượt đầu, sau lỗi API, trong plan mode, và khi tài khoản chạm hạn mức | 💬 |

## Tool & quyền

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `tools` | `string[] \| {type:'preset',preset:'claude_code'}` | Tập tool built-in **có sẵn** — đây mới là thứ giới hạn năng lực | 💬⚙️ |
| `allowedTools` | `string[]` | Tool **tự duyệt, không hỏi**. KHÔNG hạn chế gì (một hiểu nhầm cũ của AWOG) | — |
| `disallowedTools` | `string[]` | Gỡ hẳn tool khỏi context model | 💬⚙️ |
| `toolAliases` | `Record<string,string>` | Đổi hướng tên tool model gọi sang tool khác (một chặng, không nối chuỗi) | — |
| `toolConfig` | `ToolConfig` | Cấu hình tool built-in. Nay mới có `askUserQuestion.previewFormat`; runtime còn đọc `askUserQuestion.extendedQuestions` (chưa khai trong type) | — ¹ |
| `canUseTool` | `CanUseTool` | Callback duyệt từng lời gọi tool. **Cũng là công tắc bật `AskUserQuestion`** (SDK dịch thành `--permission-prompt-tool stdio`) | 💬 |
| `permissionMode` | `PermissionMode` | `default` / `acceptEdits` / `plan` / `bypassPermissions` | 💬⚙️ |
| `permissionPrompts` | `'host' \| 'none'` | Ai trả lời prompt quyền. `none` = từ chối thẳng mọi thứ cần hỏi | — |
| `permissionPromptToolName` | `string` | Định tuyến prompt quyền qua một MCP tool — **xung khắc** `canUseTool` | — |
| `allowDangerouslySkipPermissions` | `boolean` | Bắt buộc khi dùng `permissionMode: 'bypassPermissions'` | 💬⚙️ |
| `planModeInstructions` | `string` | Ghi đè hướng dẫn quy trình của plan mode | — |
| `sandbox` | `SandboxSettings` | Cô lập lệnh chạy trong sandbox | — |
| `additionalDirectories` | `string[]` | Thư mục ngoài cwd mà model được truy cập | 💬 |
| `enableFileCheckpointing` | `boolean` | Sao lưu file trước khi sửa ⇒ bật `Query.rewindFiles()` | — |
| `perTaskStopAffordance` | `boolean` | Khai rằng host có nút dừng TỪNG background task (thiếu ⇒ CLI fail-closed, một lần huỷ giết sạch) | 💬 |

## Mở rộng: MCP · agent · skill · plugin · hook

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `mcpServers` | `Record<string, McpServerConfig>` | MCP server, kể cả in-process qua `createSdkMcpServer` | 💬⚙️ |
| `strictMcpConfig` | `boolean` | Chỉ dùng MCP truyền vào, bỏ qua mọi nguồn cấu hình khác trên máy | 💬⚙️ |
| `agents` | `Record<string, AgentDefinition>` | Khai subagent bằng code cho tool `Agent` | — ⁴ |
| `agent` | `string` | Chọn agent cho luồng chính | — |
| `skills` | `string[] \| 'all'` | Skill bật cho phiên chính | 💬⚙️ |
| `plugins` | `SdkPluginConfig[]` | Nạp plugin | — |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | Hook vòng đời (`PreToolUse`, …) | 💬⚙️ |
| `onElicitation` | `OnElicitation` | MCP server xin input người dùng: `mode:'form'` (kèm `requestedSchema` JSON Schema) hoặc `mode:'url'` (auth qua trình duyệt). **Không khai ⇒ mọi request bị từ chối tự động** | 💬 |
| `onUserDialog` | `OnUserDialog` | CLI nhờ host vẽ hộp thoại chặn | — |
| `supportedDialogKinds` | `string[]` | Khai loại dialog host vẽ được. Thiếu ⇒ CLI không bao giờ gửi loại đó (fail-closed) | — |

## Ngân sách & giới hạn

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `maxTurns` | `number` | Trần số lượt (một lượt = user message + assistant response) | 💬⚙️ ³ |
| `maxBudgetUsd` | `number` | Trần chi phí USD; vượt thì query DỪNG với result `error_max_budget_usd` | 💬⚙️ |
| `taskBudget` | `{ total: number }` | Ngân sách token phía API; model **biết** phần còn lại để tự liệu cơm gắp mắm (gửi kèm beta header `task-budgets-2026-03-13`, `@alpha`) | ⚙️ ³ |

## Tiến trình & môi trường

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `cwd` | `string` | Thư mục làm việc | 💬⚙️ |
| `env` | `{[k]: string \| undefined}` | Biến môi trường — **THAY THẾ hẳn** `process.env`, không merge | 💬⚙️ |
| `executable` | `'bun' \| 'deno' \| 'node'` | Runtime JS chạy CLI (tự dò nếu bỏ trống) | 💬⚙️ ³ |
| `executableArgs` | `string[]` | Cờ thêm cho runtime đó | 💬⚙️ ³ |
| `extraArgs` | `Record<string, string \| null>` | Cờ CLI thô, không cần `--`; `null` = flag boolean. Lối thoát cho cờ chưa có option | 💬⚙️ ³ |
| `pathToClaudeCodeExecutable` | `string` | Đường dẫn binary `claude` | 💬⚙️ |
| `spawnClaudeCodeProcess` | `(SpawnOptions) => SpawnedProcess` | Tự spawn tiến trình CLI — chạy trong VM/container/máy khác. `signal` đã là bản forward (chỉ abort SAU khi SDK đóng stdin + ~2s ân hạn) | — |
| `abortController` | `AbortController` | Huỷ query | 💬⚙️ |
| `stderr` | `(data: string) => void` | Nhận stderr của tiến trình CLI | 💬⚙️ |
| `debug` | `boolean` | Bật log verbose (tương đương `--debug`) | 💬⚙️ ³ |
| `debugFile` | `string` | Ghi log debug ra file (ngầm bật debug) | 💬⚙️ ³ |

## Settings

| Option | Kiểu | Nghĩa | AWOG |
|---|---|---|---|
| `settings` | `string \| Settings` | Settings bổ sung (AWOG dùng cho `attribution` của commit) | 💬⚙️ |
| `managedSettings` | `Settings` | Settings tầng policy do tiến trình cha áp | — |
| `settingSources` | `SettingSource[]` | Chọn nguồn settings trên đĩa được nạp | 💬⚙️ |

---

¹ AWOG bật schema mở rộng của `AskUserQuestion` bằng biến môi trường `CLAUDE_CODE_QUESTION_EXTENDED` (thứ mà SDK dịch `toolConfig.askUserQuestion.extendedQuestions` ra), vì `ToolConfig` bản 0.3.260 chưa khai field đó. Xem [ask-user-question.md](../features/ask-user-question.md).

² `skills` chưa dùng — trùng đúng gap "Skill không resolve trên nhánh Claude SDK".

**8 khoá chỉ có trong runtime (`sdk.mjs`), KHÔNG khai trong `.d.ts`** — dùng là đi ngoài hợp đồng, bump SDK có thể gãy im lặng: `getOAuthToken`, `getHostAuthToken`, `workload`, `channels`, `resumeConfigDir`, `deferSpawn`, `resolvePermissionModeInCli`, `queryInstance`.

## Trạng thái triển khai (2026-09-09)

Đợt này bật gần hết những gì đánh giá là đáng, trên **cả hai** điểm gọi `query()`, kèm hành vi tương ứng ở nhánh Pi khi có thể.

### Đã bật

| Option | Làm gì trong AWOG | Đồng bộ nhánh Pi |
|---|---|---|
| `stderr` | stderr của tiến trình CLI → `log.warn` (cap 200 dòng/lần chạy, cắt 2000 ký tự/dòng, KHÔNG đẩy lên UI vì có thể chứa path/prompt) | N/A — Pi chạy in-process, log đã chung một chỗ |
| `debug`, `debugFile`, `executable`, `executableArgs`, `extraArgs` | Đồ nghề khi có sự cố, bật bằng env (`AWOG_CLAUDE_*`), mặc định tắt — [tuning.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/tuning.ts) | N/A |
| `fallbackModel` | Bảng hạ MỘT bậc (opus→sonnet→…); `AWOG_FALLBACK_MODEL` ghi đè, chuỗi rỗng = tắt | **Có**: `runWithModelFallback` trong `sessions/runner.ts` chạy lại lượt IM LẶNG bằng `AWOG_FALLBACK_MODEL` khi lỗi trông như quá tải. Cố ý chỉ đọc env — bảng hạ bậc là của Anthropic, Pi chạy provider khác |
| `maxBudgetUsd` | USD **còn lại** của phiên (trần cứng − đã tiêu) và của task (trần task − `taskSpentUsd`) ⇒ dừng NGAY khi cán trần thay vì chỉ từ chối lượt sau / phát hiện giữa các node | **Có**: `withTurnBudget` thêm chiều `maxCostUsd`, quy usage đo được ra tiền qua `pricing/effective.ts` và chặn ở biên tool call |
| `settingSources`, `strictMcpConfig` | Khai đúng bộ ba `user/project/local` (giữ nguyên hành vi, nhưng SDK đổi mặc định sẽ không âm thầm đổi hành vi AWOG) + cấm CLI tự nhặt MCP ngoài danh sách Source | N/A — Pi không đọc config của CLI |
| `agentProgressSummaries` | Câu tiến độ ~30s/lần cho subagent → `task_progress.summary` | N/A — Pi stream thẳng từng tool step của subagent, đã "sống" hơn một câu tóm tắt |
| `skills` | `'all'` — khai tường minh để khớp catalogue `<available_skills>` AWOG tự bơm vào prompt | Pi chưa có tool `Skill` (gap cũ, ngoài phạm vi đợt này) |
| `onElicitation` | MCP elicitation → chính thẻ câu hỏi của AskUserQuestion: schema `form` ánh xạ theo kiểu field (enum→chọn, boolean→Có/Không, number→thanh trượt, còn lại→ô chữ), `url` → một câu xác nhận sau khi cấp quyền ([elicitation.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/elicitation.ts)). Trước đó: **từ chối tự động** | **Chưa**: MCP client của Pi chưa khai capability elicitation — server không hỏi được. Việc riêng ở `mcp/` |
| `promptSuggestions` | Gợi ý prompt kế tiếp → surface follow-up sẵn có, và CHỈ khi model không tự gọi `suggest_followups` trong lượt | Đã có sẵn: tool `suggest_followups` |
| `outputFormat` | Gate node của task ép JSON Schema `{status, summary, report}`; node-runner bóc `report` ra làm output nên artifact vẫn là markdown như cũ, `status` thì hết phải dò fenced block | **Không**: Pi không có structured output ⇒ giữ nguyên đường fenced block (`parseVerdict`) |
| `additionalDirectories` | Thư mục người dùng đính kèm vào phiên nay ĐỌC được thật (trước chỉ hiện cây thư mục trong prompt rồi mở ra là bị chặn) | **Không**: fs tool của Pi gate bằng `assertInsideWorkspace` — nới ra là sửa invariant #2, cần infosec |
| `maxTurns`, `taskBudget` | Bật bằng env, mặc định tắt: `maxTurns` đếm cả vòng tool nên đặt bừa là cắt ngang việc thật; `taskBudget` còn `@alpha` + beta header | N/A |

### Cố ý chưa bật, kèm lý do

| Option | Lý do |
|---|---|
| `agents` | **Đo rồi mới biết là thừa.** Sau ADR 0070, agent của AWOG nằm ở `~/.claude/agents` + `{project}/.claude/agents` — đúng hai thư mục CLI tự quét. Probe với `cwd` = repo AWOG cho thấy `product-owner`, `infosec`, `tech-lead` đã có sẵn trong danh sách agent của message `init` mà không cần truyền gì. Truyền thêm chỉ là bản ánh xạ NGHÈO HƠN (rụng `mcpServers`, `disallowedTools`, và tự suy lại model) đè lên bản CLI đọc từ file |
| `forwardSubagentText` | Nhánh Pi cũng KHÔNG stream chữ của subagent vào transcript (nó trả về như kết quả tool), nên bật ở đây là lệch parity theo chiều ngược + nhân đôi lượng chữ persist vào JSONL. `agentProgressSummaries` đã cấp tín hiệu sống với chi phí nhỏ hơn nhiều. Đã đặt sẵn **cổng an toàn**: frame stream mang `parent_tool_use_id` không được cộng vào câu trả lời chính (event-adapter.ts) |
| `enableFileCheckpointing` + `Query.rewindFiles()` | Rewind của AWOG xảy ra SAU lượt, còn `rewindFiles()` cần chính đối tượng `query` đang sống. Bật cờ mà không có handle thì chỉ tốn đĩa sao lưu chứ không rewind được gì |
| `onUserDialog` + `supportedDialogKinds` | Khai kind nào là hứa vẽ được dialog đó, mà payload của `refusal_fallback_prompt` không có trong typings — trả lời mò còn tệ hơn để nó degrade như hiện tại |
| `sandbox` | Là chính sách bảo mật, không phải công tắc: cần chọn profile + infosec review |
| `spawnClaudeCodeProcess` | Chạy CLI trong VM/container — chỉ có nghĩa khi có môi trường đích; viết trước là code chết |
| `includeHookEvents` | Phát thêm sự kiện mà hiện chưa có gì tiêu thụ |
| `allowedTools`, `permissionPromptToolName`, `permissionPrompts` | Xung khắc hoặc thừa với cổng quyền hiện có (`canUseTool` + PreToolUse hook) |
| `sessionStore`, `persistSession`, `continue`, `sessionId`, `forkSession`, `resumeSessionAt`, `resumeDropsTurn`, `title`, `managedSettings`, `betas`, `maxThinkingTokens`, `loadTimeoutMs`, `sessionStoreFlush`, `agent`, `plugins` | Chưa có nhu cầu; AWOG đã tự lo phần tương ứng (JSONL của chính nó, resume qua `sdkSessionId`, tiêu đề phiên, thinking theo `level`…) |

³ Bật bằng biến môi trường, mặc định tắt.

⁴ Không cần: CLI đã tự đọc `~/.claude/agents` + `{project}/.claude/agents` (ADR 0070) — xem hàng `agents` ở bảng lý do bên dưới.
