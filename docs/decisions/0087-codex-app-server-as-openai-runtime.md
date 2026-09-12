# 0087 — Codex `app-server` làm runtime cho account OpenAI

- **Trạng thái:** **Accepted** — đã triển khai 2026-09-12 ([spec](../features/codex-runtime.md)). Khác đề xuất ở một điểm, xem [§Quyết định đã chốt](#quyết-định-đã-chốt-2026-09-12)
- **Ngày:** 2026-09-11 (spike) · 2026-09-12 (chốt + land)
- **Người quyết định:** user (2026-09-12)
- **Liên quan:** [0029](./0029-migrate-llm-runtime-to-pi-sdk.md) (Pi single runtime), [0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (chọn runtime theo provider — ADR này mở rộng cùng cái seam `createBackend()`), [0070](./0070-share-claude-home-for-config.md) (nhà config dùng chung — ADR này kết luận **ngược** cho Codex), [0051](./0051-mcp-tool-progressive-disclosure.md), [0057](./0057-session-budget-guard.md), [0032](./0032-hook-execution-engine-ipc-contract.md)

## Bối cảnh

Nhánh non-Anthropic hiện chạy Pi SDK với agent loop tự viết — đúng loại harness mà [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) đã xác định là nguồn confabulation trên đường Anthropic, và là lý do AWOG phải nuôi [`confabulation-guard.ts`](../../apps/desktop/sidecar/src/runtime/confabulation-guard.ts) + `VERIFY_PROMPT`. Câu hỏi: **Codex CLI có thay được Pi cho account OpenAI không**, và giá phải trả là gì.

Trước spike có 4 câu chặn, tất cả đều là "không biết":

1. Format JSON của Codex có hợp đồng ổn định không?
2. Có chặn được tool call trước khi chạy không (permission gate của AWOG)?
3. Có nhận tool do host cung cấp in-process không, hay buộc phải đẻ MCP server ngoài process (đụng invariant #4/#6)?
4. OAuth ChatGPT có tách được nhiều account như account manager của AWOG không?

## S1 spike — facts đã verify (2026-09-11)

Đo bằng `@openai/codex@0.154.0` (npm, `codex-cli 0.154.0`), driver Node tự viết nói JSON-RPC 2.0 NDJSON qua stdio. Script tái lập: [`tools/codex-spike/`](../../tools/codex-spike/). Hai lượt model thật chạy trên account ChatGPT của user (planType `team`), prompt tối thiểu.

### F0 — Cổng vào ĐÚNG là `app-server`, không phải `codex exec --json`

Chuỗi trong binary: `dynamic tool calls are not supported in exec mode for thread`. `exec` cũng là **một process cho mỗi lượt**. `codex app-server` là **daemon** nói JSON-RPC qua stdio (`--listen stdio://` mặc định, hỗ trợ cả `unix://`).

Protocol **có binding sinh tự động từ source** (ts-rs):

```bash
codex app-server generate-ts          --out DIR [--experimental]
codex app-server generate-json-schema --out DIR
```

→ 95 type top-level + **617 type** trong namespace `v2`; ~100 client method, ~80 server notification, 10 server→client request. Bản OSS (npm 0.154.0) và bản nhúng trong ChatGPT.app (0.153.4) **cùng protocol** (lệch 4 type do lệch version) ⇒ không phải tính năng riêng của app desktop.

⇒ **Câu 1 trả lời: có hợp đồng máy sinh, không phải JSONL đoán mò.** Đổi lại, bề mặt phụ thuộc **lớn hơn nhiều** so với Claude Agent SDK.

### F1 — Tool do host cung cấp, in-process (thay `createSdkMcpServer`)

`ThreadStartParams.dynamicTools?: Array<DynamicToolSpec>` — trường **experimental**, chỉ hiện khi `generate-ts --experimental` và chỉ nhận khi handshake khai `capabilities.experimentalApi = true`.

Luồng: host khai tool khi `thread/start` → server gọi ngược **`item/tool/call`** (server→client request) → host trả `DynamicToolCallResponse`.

**Đo thật** — khai `awog_ping`, model gọi, host trả về:

```
8075ms  SERVER-REQ  item/tool/call  {"tool":"awog_ping","arguments":{"message":"hi"}, ...}
8079ms  item/completed  dynamicToolCall status=completed success=true durationMs=5
        contentItems=[{"type":"inputText","text":"PONG-FROM-AWOG-HOST"}]
10776ms agentMessage final_answer: "PONG-FROM-AWOG-HOST"
```

- **Bẫy đã dính**: content item là `inputText`, **không phải** `text`. Trả sai shape → server nuốt lỗi thành `dynamic tool response was invalid` và **đưa chuỗi đó cho model làm kết quả tool** (lượt đầu của spike hỏng đúng kiểu này, không có exception nào bắn ra).
- `DynamicToolFunctionSpec.deferLoading` + `DynamicToolNamespaceSpec` ⇒ có sẵn progressive disclosure, tương đương [ADR 0051](./0051-mcp-tool-progressive-disclosure.md).
- Dynamic tool persist theo thread (bảng SQLite `thread_dynamic_tools`).

⇒ **Câu 3 trả lời: KHÔNG cần MCP server ngoài process.** Đây là tương đương 1-1 của `createSdkMcpServer()` — cũng là lý do lo ngại "phải re-bridge ~4.100 LOC tool AWOG qua MCP out-of-process" **không còn đứng**.

### F2 — Permission gate: server hỏi, host quyết

`ServerRequest` có 10 nhánh, trong đó 5 nhánh là cổng:

| Method | Tương đương AWOG |
|---|---|
| `item/commandExecution/requestApproval` | permission park cho Bash |
| `item/fileChange/requestApproval` | permission park cho Write/Edit |
| `item/permissions/requestApproval` | nâng quyền trong lượt |
| `item/tool/requestUserInput` | `AskUserQuestion` ([ask-user-question](../features/ask-user-question.md)) — có `questions/options/isSecret/isOther` |
| `mcpServer/elicitation/request` | MCP elicitation |

**Đo thật** — approvalPolicy `on-request`, sandbox `read-only`, host **từ chối**:

```
21866ms  thread/status/changed  activeFlags=["waitingOnApproval"]
21866ms  SERVER-REQ  item/commandExecution/requestApproval
         command="/bin/zsh -lc 'touch /tmp/awog-spike-should-not-exist'"
21867ms  serverRequest/resolved
26833ms  agentMessage: "The command did not run: the approval request failed."
```

File **không** được tạo. `ReviewDecision` = `approved | approved_for_session | denied{rejection} | abort | timed_out` + amendment cho execpolicy/network.

Ngoài ra Codex có **hệ thống hook riêng**, đủ các mốc AWOG cần cho [ADR 0032](./0032-hook-execution-engine-ipc-contract.md): `pre_tool_use`, `permission_request`, `post_tool_use`, `pre_compact`, `post_compact`, `session_start`, `session_end`, `user_prompt_submit`, `subagent_start`, `subagent_stop` — kèm `hooks/list`, notification `hook/started`/`hook/completed`, và **trust gate** (`--dangerously-bypass-hook-trust`) — cùng luật đứng D-8 mà AWOG đã tự phát biểu.

⇒ **Câu 2 trả lời: có, và mịn hơn `canUseTool` của Claude SDK** (gate là request có id, không phải callback phụ thuộc permission-mode — xem bẫy S0 của ADR 0058).

### F3 — Steering giữa lượt là native

`turn/steer { threadId, input, expectedTurnId }` — có precondition turn id, lỗi `active_turn_not_steerable` khi không steer được.

**Đo thật**: chèn giữa lượt "đếm 1→40", server nhận (`{"turnId":"01a08e20-e55a-…"}`), lượt **cùng turn id** kết thúc bằng `"STEERED"`.

⇒ Giải được bất đối xứng "steering chỉ có ở Pi" mà không cần code AWOG.

### F4 — Multi-account = một `CODEX_HOME` cho mỗi account

```
CODEX_HOME=<dir mới>  codex login status   → "Not logged in"
CODEX_HOME mặc định   codex login status   → "Logged in using ChatGPT"
```

`login --with-api-key` / `--with-access-token` đọc stdin; `--device-auth` cho OAuth; `-p/--profile` layer thêm `$CODEX_HOME/<name>.config.toml`.

⚠️ **Mặt trái, và nó là lỗi bảo mật nếu bỏ sót**: không set `CODEX_HOME` thì AWOG **thừa kế toàn bộ cấu hình Codex của người dùng**. Spike vô tình nạp 8 MCP server của user (`gitnexus`, `codegraph`, `github`, `playwright`, `figma`, `codex_apps`, `node_repl`, `cua_repl`) và **model của user** — `cc/claude-opus-5` qua custom provider `9router` — vào thread của mình. Đây là đúng bài toán `CLAUDE_CONFIG_DIR` của [ADR 0070](./0070-share-claude-home-for-config.md) nhưng **kết luận ngược**: nhà Codex của AWOG phải **RIÊNG**, không dùng chung.

⇒ **Câu 4 trả lời: tách được, bằng CODEX_HOME — và bắt buộc phải tách.**

### F5 — Một daemon, N thread (bác bỏ lo ngại "spawn mỗi one-shot")

| Thao tác | Đo được |
|---|---|
| `initialize` | 222–295 ms |
| `thread/start` đầu tiên | 106 ms |
| `thread/start` thứ 2, 3 | **5 ms** |
| RPC local (`skills/list`, `hooks/list`, `getAuthStatus`) | 3–45 ms |
| `mcpServerStatus/list` (khởi động MCP thật) | 1962 ms |

`thread/loaded/list` liệt kê đủ 3 thread sống song song trong **một** process.

⇒ Lo ngại lớn nhất của đánh giá trước — "~20 method one-shot bị đội giá vì spawn process mỗi lần" — **sai với app-server**: daemon đã sẵn, một one-shot = một RPC. (Vẫn còn chênh so với `completeSimple` một HTTP request, vì mỗi thread kéo theo system prompt + tool catalogue của harness: lượt đầu của spike tốn **23.7k input token** cho một prompt 20 từ.)

### F6 — Usage / quota / context gauge là native

- `thread/tokenUsage/updated` → `inputTokens`, `cachedInputTokens`, `cacheWriteInputTokens`, `outputTokens`, `reasoningOutputTokens`, `totalTokens` + `model_context_window`.
- `account/rateLimits/updated` (push sau mỗi lượt) → `primary.windowDurationMins = 300` (**đúng bucket 5 giờ** của quota guard), `secondary = 10080` (7 ngày), `credits`, `individualLimit`, `planType`, `spendControlReached`.

⇒ [ADR 0054](./0054-activity-usage-cost-rollup.md) rollup, [ADR 0057](./0057-session-budget-guard.md) budget guard, quota guard 5h và context gauge map thẳng, không phải suy diễn.

### F7 — Provider: Codex KHÔNG khoá cứng OpenAI (đính chính đánh giá trước)

Bằng chứng mạnh nhất đến từ chính máy user: `~/.codex/config.toml` của họ đang route Codex qua custom provider `9router` tới model `cc/claude-opus-5`. Cộng thêm `--oss` + `--local-provider lmstudio|ollama` là cờ hạng nhất, và `modelProvider` là tham số của `thread/start`.

⇒ Nhận định "chuyển sang Codex thì mất Google + custom endpoint" trong đánh giá trước **quá bi quan**; mất mát thực tế giới hạn ở provider không nói được wire API mà Codex hỗ trợ. Vẫn cần đo riêng cho Google.

### F8 — Chưa verify (không được coi là đã chạy)

- `thread/resume` — spike trả `no rollout found` vì thread test rỗng (chưa có lượt nào ⇒ chưa có rollout file). Protocol có, đường đi chưa chứng minh.
- `thread/compact/start` + `thread/compacted` (compaction).
- `thread/fork`, `thread/revert`, `thread/rollback` (AWOG dùng cho rewind/fork transcript).
- Dynamic tool bên trong subagent / collab agent.
- Windows + Linux.
- Hành vi khi daemon chết giữa lượt (restart-safe resume của AWOG).
- **`dynamicTools` và `app-server` đều mang nhãn experimental** — trường bị ts-rs giấu nếu không `--experimental`.

## Quyết định (đề xuất ban đầu)

Thêm **`CodexAgent`** làm backend thứ 3 sau seam `createBackend()` của [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md), dùng cho account `provider === 'openai'`, **opt-in + kill-switch về Pi**. Ràng buộc:

1. **Chỉ dùng `codex app-server`**, không `codex exec`. Một daemon cho mỗi *account*, N thread = N session.
2. **`CODEX_HOME` riêng cho mỗi account AWOG**, không bao giờ mượn `~/.codex` của user.
3. Tool AWOG đi qua `dynamicTools` (in-process), **không** đẻ MCP server ngoài process.
4. Permission park nối vào `ServerRequest`; `AskUserQuestion` nối vào `item/tool/requestUserInput`.
5. Pi **giữ nguyên** cho google/custom, cho `/compact`, và cho ~20 method one-shot `completeSimple`.

## Quyết định đã chốt (2026-09-12)

Người dùng chốt **thay hẳn Pi cho provider `openai`** — KHÔNG opt-in, không kill-switch — và **đóng gói `@openai/codex`** vào sidecar.

Khác đề xuất ở ràng buộc (5): không có cờ để rơi về Pi. Ghi lại thẳng vì nó đảo trọng tâm rủi ro — mỗi hạng mục F8 chưa đo phải có **đường lùi đo được trong code**, chứ không phải một công tắc người dùng bật khi thấy hỏng:

| F8 | Đường lùi đã cài |
|---|---|
| `thread/resume` | Resume hỏng ⇒ mở thread mới + nạp lại lịch sử (`renderHistoryPrefix`). Người dùng không mất tin nhắn |
| Daemon chết giữa lượt | Reject mọi request đang bay + bắn `awog/daemonExited` cho thread đang sống ⇒ lượt kết thúc bằng lỗi, không treo |
| Compaction | Không dùng của Codex. `/compact` vẫn qua Pi (ADR 0047) |
| fork / revert / rollback | Không dùng. Ba đường cắt transcript của AWOG xoá `codexThreadId` như đã xoá `sdkSessionId` |
| Dynamic tool trong subagent | Subagent vẫn chạy vòng lặp Pi của chính nó; Codex chỉ là runtime của lượt CHA |
| Windows / Linux | Chưa đo. Bảng target triple trong `binary.ts` phủ đủ 6 platform, nhưng chỉ darwin-arm64 được chạy thật |

Hai ràng buộc thêm, phát sinh từ chính bản triển khai:

7. **Custom endpoint (`account.baseURL`) ở LẠI Pi.** Một account openai có baseURL là gateway tương thích-OpenAI (Ollama, LM Studio, router) nằm nhờ trong bucket openai; Codex nói Responses API với bảng provider của nó, nên đẩy sang đây là làm hỏng chứ không phải nâng cấp.
8. **Tên tool `mcp__*` phải đổi trên dây.** Xem F9.

### F9 — `mcp__` là tiền tố dành riêng (đo 2026-09-12, KHÔNG có trong spike)

`thread/start` **từ chối nguyên lượt** một dynamic tool tên `mcp__<server>__<tool>`: `dynamic tool name is reserved`. Vì mọi Source/MCP của AWOG đều mang đúng tên đó, lỗi này sẽ chặn gần như mọi phiên — và nó chỉ lộ ra khi có server đính kèm, tức không bao giờ lộ trong một test "hello world".

Thử thêm 20 tên khác (`shell`, `apply_patch`, `exec_command`, `unified_exec`, `update_plan`, `Task`, `browser`, `view_image`…): **không tên nào bị cấm**. Vậy đây là một luật hẹp, không phải một namespace.

Xử lý: đổi tên trên dây thành `awogmcp__…` và trả lại tên gốc **trước** cổng quyền và **trước** step mapper — luật của người dùng, nhãn transcript và phạm vi per-source đều viết theo tên gốc. Cùng lớp với việc Anthropic chiếm tiền tố `mcp_`.

### F10 — `thread/resume` không nhận `dynamicTools`

Bộ tool ràng vào thread lúc `thread/start` (bảng `thread_dynamic_tools`), và `ThreadResumeParams` **không có** trường đó. Cứ resume thì một MCP server đính kèm giữa phiên sẽ im lặng không tồn tại tới hết phiên. Nên `Session.codexToolSignature` lưu chữ ký bộ tool; lệch ⇒ mở thread mới. (`developerInstructions` thì resume NHẬN, nên system prompt không bị đóng băng như nhánh Claude SDK.)

## Phương án đã cân nhắc

- **`codex exec --json`** — từ chối: không có dynamic tool (chuỗi lỗi trong binary nói thẳng), một process cho mỗi lượt, không có gate.
- **`codex mcp-server`** — từ chối: biến Codex thành *tool của AWOG*, không phải runtime; không lấy được harness.
- **Thay luôn cả Pi lẫn Claude SDK bằng 2 CLI** — chưa đủ dữ kiện; phụ thuộc F8 và quyết định sản phẩm về Google/custom endpoint.
- **Giữ nguyên Pi cho OpenAI** — phương án nền; chi phí là tiếp tục nuôi agent loop tự viết + confab guard.

## Hệ quả

- **Tích cực:** harness first-party cho nhà thứ 2; steering/approval/usage/hook/skills/plan/compaction là protocol chứ là code AWOG; tool AWOG vẫn in-process; quota 5h map thẳng; một daemon phục vụ nhiều session.
- **Tiêu cực / trade-off:**
  - **Runtime thứ 3 ⇒ thuế parity tăng 50%.** Bằng chứng thuế này là thật: [ADR 0083](./0083-pi-subagent-parity.md) tồn tại chỉ để kéo 2 nhánh về ngang nhau, và CLAUDE.md đang phải ghi chú `TodoWrite`/`TaskCreate`, steering Pi-only, `/compact` Pi-only.
  - Bundle **289 MB/platform** (so với 189 MB của binary Claude).
  - Phụ thuộc một protocol 617 type mang nhãn experimental.
  - Sandbox seatbelt của Codex chồng lên permission gate + worktree isolation ([ADR 0081](./0081-task-node-worktree-isolation.md)) của AWOG.
- **Việc cần làm tiếp:**
  1. ~~Thiết kế `CodexAgent` + event-adapter~~ — đã land, xem [codex-runtime.md](../features/codex-runtime.md).
  2. ~~Hành vi daemon chết giữa lượt~~ — đã cài + có test.
  3. **Còn nợ**: một lượt model THẬT end-to-end; `thread/resume` sau khi thread đã có rollout; Windows + Linux.
  4. **Còn nợ**: sửa trạng thái [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (đang ghi *"chưa bắt đầu"* trong khi nhánh claude-sdk đã chạy production).
  5. **Infosec bắt buộc, chưa chạy**: `CODEX_HOME` isolation, sandbox seatbelt chồng lên cổng quyền + worktree isolation (ADR 0081), dynamic tool là bề mặt thực thi mới, và hai file thực thi lồng nhau chưa ký trong bundle macOS.
  6. Tasks + ~20 method one-shot vẫn ở Pi — quyết định riêng, chưa đo.

## Tham chiếu

- Script tái lập + log: [`tools/codex-spike/`](../../tools/codex-spike/)
- [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) §S0 — spike tương đương cho Claude Agent SDK
- `codex app-server generate-ts --out DIR --experimental` — nguồn sự thật của protocol
