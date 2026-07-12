# 0059 — Chạy luồng creator (*.author) qua session runtime

> **Status:** Proposed
> **Date:** 2026-07-09
> **Decision-makers:** Tech Lead + chủ dự án (chốt hướng: creator chạy qua session runtime)
> **Supersedes:** không (revisit + amend một phần [0029](./0029-migrate-llm-runtime-to-pi-sdk.md) C2)

## Context

Tính năng "New" (tạo mới) cho **Connection / Skill / Agent** hiện chạy qua một harness one-shot riêng — `runtime/complete.ts::authorPi` (đọc thẳng `runAgentLoop` của `pi-agent-core`). Ba method `methods/{mcp,skills,agents}.author.ts` đều gọi `authorPi`. Đây là quyết định [ADR 0029 C2](./0029-migrate-llm-runtime-to-pi-sdk.md) ("7 method one-shot generator/author qua Pi"): tách khỏi seam session để cutover nhanh.

Hệ quả của việc tách: `authorPi` **KHÔNG** đi qua `sessions/runner.ts::runStream` → `runtime/run-stream.ts::runStreamPi`, nên **thiếu** mọi thứ session có:

- **Persist JSONL** (source-of-truth trên đĩa — invariant artifact-driven / restart-safe của AWOG).
- **Resume** đúng nghĩa (rebuild Context từ JSONL). Hiện creator "multi-turn" bằng cách UI tự giữ history rồi render lại transcript dạng `User:/Assistant:` mỗi lần gửi (`renderTranscript`) — không có checkpoint, không restart-safe.
- **Permission gating thật** — `authorPi` `beforeToolCall: async () => undefined` (allow-all). Bảo vệ duy nhất là path-sanitize của chính tool (`assertInsideWorkspace(cwd)`) + lời dặn trong systemPrompt ("Write ONLY under …").
- **Cost/usage tracking** như session (`pricing/catalog.ts`, cost-breakdown), compaction, đăng ký entity Session, budget guard ([0057](./0057-session-budget-guard.md)).

Chủ dự án muốn **thống nhất**: coi mỗi lần "New" như một **mini-session thật**, tái dùng `runner.ts`/`run-stream.ts` để đồng nhất permission / persist / cost / resume, thay vì duy trì hai đường agentic loop song song (drift risk: mỗi lần sửa `run-stream.ts` phải nhớ port sang `authorPi`).

**Ràng buộc quan trọng đã verify từ code hiện trạng:**

- `runStreamPi(args, cb)` nhận `RunNonStreamArgs` giàu field (đã có sẵn `allowedTools`, `disabledTools`, `canUseTool`, `autoApprove`, `cwd`, `systemPrompt`, `budget`, `mcpServers`, `settings`, `history`). **Không cần đổi chữ ký** để đạt được toolset rút gọn + auto-approve theo scope.
- Permission bridge `makeBeforeToolCall` đã có nhánh `mode === 'execute' → no gate` và `autoApprove → allow`. Nghĩa là session runtime **đã** có sẵn cách chạy Write không prompt.
- `authorPi` cố tình chỉ inject `['Write','Read','Edit']` (comment: full set khiến model dò shell rồi kể "shell unavailable", làm hỏng chat). Đây là ràng buộc thiết kế phải giữ.
- Ba `*.author` method có logic riêng: `mcp.author` còn `verifyWritten` (handshake MCP → step `kind:'verify'`); `skills/agents.author` có `resolveTarget(scope)` (global vs projectId → dir + cwd). Streaming contract UI = `AuthorCallbacks` (onText / onToolUse / onToolResult) map sang event `<method>.chunk|step|done`, tiêu thụ bởi `LibraryCreatorPanel.vue` qua `usePromptCreator`.
- `completePi` (pure-text, no tool) khác hẳn `authorPi` — dùng bởi 4 `*.generate` + `git.generateCommitMessage`. **Ngoài phạm vi** ADR này.

## Options considered

### Option A — Creator = "ephemeral session" đầy đủ (tạo Session entity, persist JSONL, đăng ký danh sách)

- **Mô tả:** Mỗi lần mở creator → `createSession()` một Session thật (có `kind: 'creator'`), gọi `sessions.send-message` như chat bình thường, persist JSONL vào `sessions/`, hiện/không hiện trong list tùy filter.
- **Pros:** Tái dùng 100% pipeline; resume/cost/persist "miễn phí"; một đường duy nhất.
- **Cons:** Rác danh sách session của user (phải filter `kind`); tạo entity + JSONL cho một hành động tạo-file dùng-một-lần vi phạm YAGNI; phải sửa `sessions.list`/index/search/tray để loại `kind:'creator'`; blast radius lớn (mọi consumer của Session shape). Cost tracking cho creator có ý nghĩa marginal (một turn ghi 1 file).

### Option B — Gọi thẳng `runStreamPi` từ `*.author` với `RunNonStreamArgs` cắt gọn, KHÔNG tạo Session entity, KHÔNG persist

- **Mô tả:** Bỏ `authorPi`. Ba `*.author` method dựng `RunNonStreamArgs` tối giản (sessionId ephemeral tạm để lock/abort registry, history=UI-owned rebuild, `allowedTools:['Write','Read','Edit']`, `settings.mode:'execute'` hoặc `autoApprove:true`, `cwd=scope dir`, `systemPrompt`) rồi gọi `runStream(args, cb)` với một `StreamCallbacks` adapter map `onChunk/onStep` → event `<method>.chunk|step|done` (giữ nguyên RPC contract + UI). Không `createSession`, không JSONL, không cost rollup — persistence "thật" của creator vẫn là **file entity model ghi ra** (`<slug>.json`/`SKILL.md`/`AGENT.md`), đúng triết lý artifact-driven.
- **Pros:** Một đường agentic loop duy nhất (`runStreamPi`) — hết drift; toolset rút gọn + auto-approve-theo-scope đạt được **không đổi chữ ký** (dùng field sẵn có); UI **không vỡ** (adapter giữ `*.author.*` events); KISS/YAGNI — không tạo entity cho hành động one-off; không rác danh sách session; per-session lock/abort của runner được tái dùng cho Stop/hủy.
- **Cons:** `RunNonStreamArgs` có nhiều field session-only (compaction, steering, refeedImages…) — creator để `undefined`, phải tài liệu hóa "creator subset". Cost creator không được rollup (chấp nhận — xem Decision §5). Cần một adapter `AuthorCallbacks`↔`StreamCallbacks` (nhỏ).

### Option C — Giữ `authorPi` nhưng "mượn" permission/persist của session (refactor nửa vời)

- **Mô tả:** Giữ harness riêng nhưng nhét thêm permission gate + JSONL vào `authorPi`.
- **Pros:** Ít đụng `*.author` method.
- **Cons:** Chính là nhân đôi logic mà chủ dự án muốn xóa — `authorPi` sẽ dần hội tụ thành bản sao thứ hai của `runStreamPi` (permission, budget, MCP, compaction…). Vi phạm DRY ở mức "tri thức" (một agentic-loop contract, hai nơi). Loại.

## Decision

**Chọn: Option B — creator chạy qua `runStreamPi` với `RunNonStreamArgs` cắt gọn, không tạo Session entity, không persist JSONL, giữ nguyên RPC contract `*.author` bằng adapter callback.**

Lý do: đạt đúng mục tiêu chủ dự án (một runtime, đồng nhất permission/toolset/abort) **mà không** kéo theo chi phí của Option A (entity + JSONL + rác list + sửa mọi consumer Session). Triết lý core AWOG là **artifact-driven**: source-of-truth của một creator là **file entity nó tạo ra** (`SKILL.md`/`AGENT.md`/`<slug>.json`), không phải transcript. Một transcript creator dùng-một-lần **không** cần là artifact bền — nên persist JSONL ở đây là YAGNI. `RunNonStreamArgs` đã đủ giàu để biểu diễn "phiên rút gọn" nên không cần chữ ký mới; chỉ cần một adapter callback nhỏ để giữ UI bất biến.

### Chốt từng điểm 1–8

**1. Mô hình session cho creator.** KHÔNG tạo Session entity, KHÔNG thêm `kind` mới, KHÔNG hiện trong danh sách. Creator là "phiên rút gọn" chỉ tồn tại trong RAM trong lúc `runStreamPi` chạy. `sessionId` truyền cho runner là một **id ephemeral** (`randomBytes` prefix `creator:`), chỉ dùng cho `PER_SESSION_LOCKS` + `ACTIVE_ABORTERS` (Stop/hủy). Vòng đời = một lần gọi RPC `*.author`; không có gì để "dọn" vì không ghi Session ra đĩa. Multi-turn trong cùng lần mở creator vẫn dùng lại cùng `sessionId` ephemeral (UI giữ, gửi kèm) để lock tuần tự các turn — nhưng đây là điểm cần chủ dự án xác nhận (xem Open question O1).

**2. Permission.** Giữ "auto-approve Write vào đúng file đích" bằng **hai lớp phòng vệ** thay cho allow-all:
   - **Lớp scope path (đã có, giữ):** `cwd = scope dir` truyền vào `createRuntimeToolDefinitions` → tool `Write/Edit` chạy qua `assertInsideWorkspace(cwd)`. Đây là gate cứng: model không thể ghi ngoài dir tier đã chọn dù prompt injection.
   - **Lớp toolset whitelist (đã có, dùng):** `allowedTools: ['Write','Read','Edit']` → model không thấy Bash/Grep/Glob/Task/RunWorkflow/MCP, nên không có bề mặt để prompt approve.
   - **Auto-approve prompt:** đặt `autoApprove: true` (hoặc `settings.mode:'execute'`) để `makeBeforeToolCall` không park UI permission prompt — creator là hành động user chủ động mở, implicit consent, đúng như `authorPi` bypass cũ. **Khác biệt an toàn so với `authorPi`:** không còn `beforeToolCall: () => undefined` mù; giờ đi qua `makeBeforeToolCall` thật (vẫn honor budget guard qua `withTurnBudget`, vẫn fail-safe-block khi lỗi). Kết quả: "auto-approve Write vào đúng file đích" = whitelist tool (chỉ Write/Read/Edit) ∩ scope path (chỉ trong dir tier) ∩ auto-approve (không prompt) — chặt hơn bypass cũ.

**3. Toolset.** Inject qua field `allowedTools` có sẵn của `RunNonStreamArgs` = `['Write','Read','Edit']`. Giữ nguyên ràng buộc chống-dò-shell của `authorPi` (không Bash/Grep/Glob). Task/RunWorkflow tự động bị loại vì không nằm trong `allowedTools` (`isToolAllowed` chặn). MCP: creator không truyền `mcpServers` → không bridge tool nào. **Không** cần API mới; chỉ set field.

**4. Streaming contract.** GIỮ NGUYÊN RPC `mcp.author` / `skills.author` / `agents.author` + event `<method>.chunk|step|done`. Ba method dựng một **adapter** `StreamCallbacks → AuthorCallbacks`:
   - `cb.onChunk(delta)` → `emit('<m>.chunk', {messageId, delta})`.
   - `cb.onStep(step)` → `emit('<m>.step', {messageId, step})` — lưu ý `runStreamPi` emit `SessionStep` (đã qua `step-mapper`/`event-adapter`), trong khi `authorPi` cũ emit tool-use/tool-result thô rồi `*.author` method tự gọi `stepFromToolUse/stepFromToolResult`. Adapter phải map `SessionStep` của runner sang shape `CreatorStepRow` UI đang render. Đây là điểm hợp đồng cần kiểm kỹ (xem Open question O2). UI `LibraryCreatorPanel.vue` / `usePromptCreator` **không đổi** — ưu tiên ít vỡ UI nhất. `mcp.author` giữ nguyên `verifyWritten` (chạy sau khi runner kết thúc, trước event `done`).

**5. Persist/JSONL & cost.** KHÔNG ghi JSONL, KHÔNG rollup cost cho creator. Lý do: (a) source-of-truth là file entity ghi ra, transcript one-off không phải artifact; (b) ghi JSONL cần một `sessions/<id>.jsonl` → rác thư mục session + phải quét/loại khi list; (c) cost một turn ghi-một-file là marginal, không đáng phần phức tạp. Nếu sau này cần đo chi phí creator → gom vào Activity rollup ([0054](./0054-activity-usage-cost-rollup.md)) bằng một event nhẹ, KHÔNG bằng persist Session. (Open question O3 nếu chủ dự án muốn cost.)

**6. Multi-turn/resume.** Trong cùng một lần mở creator: multi-turn giữ **nguyên cơ chế hiện tại** — UI owns history, mỗi turn rebuild transcript và truyền vào `RunNonStreamArgs.history`. `runStreamPi` resume = rebuild Context từ `args.history` (đúng như session, chỉ khác nguồn history là RAM-của-UI thay vì JSONL). Vì KHÔNG persist (§5), resume **xuyên lần-mở/xuyên-restart KHÔNG hỗ trợ** — đóng creator = mất transcript (giống hành vi hiện tại; `LibraryCreatorPanel` đã reset `messages=[]` mỗi lần mở). "Sửa lại đi" trong cùng phiên = gửi thêm một turn với history tích lũy → hoạt động sẵn. Không cần thêm gì.

**7. Số phận `authorPi`.** GỠ HẲN `authorPi` + `AuthorArgs` + `AuthorCallbacks` + `AuthorResult` khỏi `complete.ts`. GIỮ `completePi` (+ `CompleteArgs`, `resolveForRun`, `toSettings`, `mapErr`) — nó phục vụ 4 `*.generate` + `git.generateCommitMessage` (pure-text, no-tool, no-permission), không nằm trong phạm vi hợp nhất này. File `complete.ts` sau đó chỉ còn nhánh `completePi`; đổi comment đầu file để phản ánh (không còn "two shapes").

**8. Backward-compat & migration.** ADR này **amend** [ADR 0029 C2](./0029-migrate-llm-runtime-to-pi-sdk.md): phần "7 method one-shot" của 0029 chia làm hai — 4 `*.generate` + `git.generateCommitMessage` GIỮ đường `completePi` one-shot; 3 `*.author` CHUYỂN sang `runStreamPi` (không còn "one-shot author helper `authorPi`"). Không đổi RPC contract → **không migration phía UI**, không migration dữ liệu (creator chưa từng persist). ADR 0029 vẫn Accepted; chỉ mục C2 được điều chỉnh (ghi cross-reference tại đây, không sửa nội dung 0029 đã Accepted — theo quy tắc immutable).

## Consequences

### Positive

- Một đường agentic loop duy nhất (`runStreamPi`) — hết nguy cơ drift giữa `authorPi` và session runtime khi sửa permission/budget/tool.
- Permission creator **chặt hơn** bypass cũ: whitelist tool ∩ scope path ∩ auto-approve có kiểm soát (qua `makeBeforeToolCall` thật + budget guard), thay cho `beforeToolCall: () => undefined` mù.
- UI không đổi (RPC contract giữ nguyên) → không vỡ `LibraryCreatorPanel`, `ConnectionPromptCreator`, `usePromptCreator`.
- Stop/hủy creator được tái dùng miễn phí qua `ACTIVE_ABORTERS`/`abortSession` của runner.
- Giảm code: xóa `authorPi` (~150 dòng) + logic trùng.

### Negative / cost

- `RunNonStreamArgs` gánh thêm một use-case "creator subset" (nhiều field để `undefined`); phải tài liệu hóa để tránh nhầm creator là session đầy đủ.
- Cost/usage của creator không được đo (chấp nhận — §5).
- Adapter `SessionStep` → shape step UI cần map cẩn thận; rủi ro lệch hiển thị step (Open question O2). `mcp.author.verifyWritten` phải được móc lại đúng thời điểm (sau runner, trước `done`).

### Knock-on

- **File chạm:** `sidecar/src/methods/mcp.author.ts`, `skills.author.ts`, `agents.author.ts` (đổi `authorPi` → `runStream` + adapter callback); `sidecar/src/runtime/complete.ts` (gỡ `authorPi` + type liên quan, sửa comment); có thể thêm một helper adapter nhỏ `sessions/creator-run.ts` (dựng `RunNonStreamArgs` cắt gọn + map callback) để DRY ba method.
- **Không chạm:** UI (`LibraryCreatorPanel.vue`, `usePromptCreator`, `ConnectionPromptCreator.vue`), `runner.ts`, `run-stream.ts` (dùng nguyên chữ ký hiện có).
- **ADR/spec refresh:** cross-ref amend tại [0029](./0029-migrate-llm-runtime-to-pi-sdk.md) C2 (ghi ở ADR này); cập nhật index `docs/decisions/README.md`; cân nhắc một note ở `docs/features/` mô tả creator-as-mini-session nếu implement mở rộng.
- **Migration:** không có (không đổi contract, không đổi data).
- **Ai chịu ảnh hưởng:** sidecar dev (3 method + complete.ts); UI dev — không; user — không (hành vi giống, chỉ permission chặt hơn ngầm).

## Implementation pointers

- Module dự kiến: gom việc dựng `RunNonStreamArgs` creator + adapter `StreamCallbacks→emit('<m>.*')` vào một helper (vd `sessions/creator-run.ts` hoặc `runtime/creator-run.ts`) để ba `*.author` gọi chung (Rule of Three: đúng 3 call-site → tách helper hợp lý).
- `RunNonStreamArgs` creator tối thiểu: `{ sessionId: 'creator:<rand>', pendingText: userText, history: <UI rebuild>, settings: { provider, modelId, level:'low', mode:'execute', accountId }, systemPrompt: buildSystemPrompt(...), cwd: scopeDir, allowedTools: ['Write','Read','Edit'], autoApprove: true }`. Mọi field session-only để `undefined`.
- Test bổ sung: (1) Write ngoài scope dir bị `assertInsideWorkspace` chặn (path traversal); (2) model không gọi được Bash (không trong allowedTools); (3) step stream render đúng trong `LibraryCreatorPanel`; (4) `mcp.author` verify step vẫn xuất hiện trước `done`; (5) Stop giữa turn hủy sạch qua `abortSession`.
- Rollout: incremental — chuyển từng method (mcp → skills → agents), mỗi method là một PR nhỏ; gỡ `authorPi` ở PR cuối khi cả ba đã cắt.

## Reversibility

- **Reversible: dễ.** Không đổi data shape, không đổi RPC contract, không migration. Nếu `runStreamPi` gây regression cho creator, khôi phục `authorPi` từ git history và trỏ lại ba method. Blast radius giới hạn trong sidecar (3 method + 1 file helper).

## Liên kết

- ADR liên quan: [0029](./0029-migrate-llm-runtime-to-pi-sdk.md) (Pi runtime — amend C2), [0030](./0030-subagent-task-tool.md) (Task tool — loại khỏi creator toolset), [0057](./0057-session-budget-guard.md) (budget guard — creator hưởng), [0054](./0054-activity-usage-cost-rollup.md) (cost rollup — nếu sau cần đo creator).
- Code hiện trạng: `sidecar/src/runtime/complete.ts` (`authorPi`/`completePi`), `sidecar/src/runtime/run-stream.ts` (`runStreamPi`), `sidecar/src/sessions/runner.ts` (`runStream`/lock/aborter), `sidecar/src/methods/{mcp,skills,agents}.author.ts`, `sidecar/src/runtime/permission.ts` (`makeBeforeToolCall`), `ui-next/components/library/LibraryCreatorPanel.vue`.
