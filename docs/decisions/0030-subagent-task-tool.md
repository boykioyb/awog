# 0030 — Subagent `Task` tool dưới Pi runtime

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-10
- **Người quyết định:** Tech Lead + user (chốt phương án B — implement subagent thật, 2026-06-10)
- **Liên quan:** [0029](./0029-migrate-llm-runtime-to-pi-sdk.md) (Pi runtime — ADR này **bổ sung** tool còn thiếu sau migration), [0015](./0015-agents-persisted-runtime-systemprompt.md) (AGENT.md runtime injection), [0026](./0026-per-agent-multi-provider-llm.md) (per-agent provider/model — subagent honor frontmatter), [0024](./0024-task-execution-engine-ipc-contract.md) (Task Execution Engine — invoke path), [0016](./0016-deprecate-context-providers-fold-into-mcp.md) (per-agent MCP whitelist)

## Bối cảnh

Sau khi migrate sang Pi SDK ([ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md)), runtime AWOG chỉ đăng ký 6 built-in tool (`Read/Write/Edit/Bash/Grep/Glob`) + `ExitPlanMode` (plan mode) + MCP tools — xem [runtime/tools/index.ts](../../apps/desktop/sidecar/src/runtime/tools/index.ts). Claude Agent SDK cũ có tool `Task` (spawn subagent) nhưng **không được port** sang Pi.

**Triệu chứng:** khi session chạy bằng credential **OAuth (Claude.ai / Claude Code subscription)**, Pi auto-prepend block *"You are Claude Code…"* (xem chú thích [context-builder.ts](../../apps/desktop/sidecar/src/runtime/context-builder.ts)) → model bị điều kiện như Claude Code nên **tự gọi tool `Task`**. Vì `Task` không có trong `context.tools`, Pi `agent-loop.js` trả `createErrorToolResult("Tool Task not found")`. Lỗi không fatal (model thường tự re-plan) nhưng gây nhiễu, tốn vòng gọi, và bỏ lỡ năng lực delegate đúng tầm nhìn AWOG ("guild of agents").

Hạ tầng UI đã **sẵn sàng** cho subagent từ thời SDK cũ: `SessionStep.parentId` ([types/shared.ts](../../apps/desktop/sidecar/src/types/shared.ts)) để nest step con dưới step `Task`; [step-mapper.ts](../../apps/desktop/sidecar/src/sessions/step-mapper.ts) đã map `Task → 'task'`; trace task ([node-runner.ts](../../apps/desktop/sidecar/src/tasks/node-runner.ts)) đã nest qua `parentId`. Chỉ thiếu **tool runtime**.

## Quyết định

Implement tool `Task` thật cho **cả Sessions (chat) lẫn Tasks (workflow node)** dưới Pi runtime:

1. **Tool mới** [runtime/tools/task-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/task-tool.ts) — `createTaskTool(deps)` trả một `AgentTool` tên đúng `Task`, schema `{ description, prompt, subagent_type }` (khớp convention Claude Code). Tool **không** đặt `executionMode: 'sequential'` (xem [Cập nhật 2026-06-17](#cập-nhật-2026-06-17--song-song-hoá-task) — nhiều `Task` trong một turn fan-out song song).

2. **subagent_type → AWOG Agent.** Tool nhận sẵn danh sách agent (`listAgents(projectIds)`) để (a) liệt kê trong `description` cho model chọn đúng, (b) resolve theo `id` rồi `name` (case-insensitive). Resolve config qua `resolveAgentContext` ([tasks/agent-context.ts](../../apps/desktop/sidecar/src/tasks/agent-context.ts)) → `systemPrompt` + `allowedTools` + `mcpServers` (secrets expand) + `provider/model/accountId`.

   **MCP kế thừa từ parent (sửa sau khi ship):** subagent dùng **union** MCP của turn cha (`TaskToolDeps.parentMcpServers`, đã resolve whitelist ∩ enabled + secret expand) với MCP riêng của AGENT.md (`mergeMcpServers`). Trước đây chỉ build từ `agent.mcpServerIds` → subagent có whitelist hẹp hơn parent mất luôn server của session (gọi `mcp__<id>__*` báo "not found", subagent báo "không có MCP access"). Nay bảo đảm subagent luôn với tới ≥ MCP của parent. `allowedTools` (nếu agent khai `tools`) vẫn lọc theo tên tool như cũ.

3. **Subagent honor AGENT.md frontmatter** (chốt với user): subagent dùng `provider/model/accountId` của agent khi có, **fallback** về settings của parent. Tool tự `resolveCredential` + `resolveModel` cho subagent → mỗi subagent có thể chạy provider/account riêng. Credential **không bao giờ rời sidecar**.

4. **Depth = 1 (chống đệ quy).** Toolset của subagent build qua `createRuntimeToolDefinitions` **không** kèm `Task` (và không `ExitPlanMode`). Subagent không thể spawn subagent — giống Claude Code. Không cần biến đếm depth.

5. **Streaming nested.** Tool chạy `runAgentLoop` lồng bên trong `execute()`; event của subagent được forward về callback của parent với `parentId = toolCallId` của lời gọi `Task` (reuse `createEventAdapter`/`createInvokeAdapter` có thêm tham số `parentId`). Text của subagent **không** đổ vào reply chính của parent — chỉ accumulate để trả làm kết quả tool. Step con hiện nested dưới step `Task` trong UI.

6. **Permission.** Lời gọi `Task` đi qua permission gate của parent như mọi tool. Bên trong subagent, **reuse cùng `beforeToolCall`**: session 'ask' → vẫn prompt cho Write/Bash của subagent (an toàn); task → bypass như node hiện tại ([ADR 0024](./0024-task-execution-engine-ipc-contract.md) D-7).

7. **Luôn đăng ký (graceful).** `Task` được thêm ở **top-level** (ngoài `createRuntimeToolDefinitions`) cho chat non-plan + task, tôn trọng `allowedTools/disabledTools`. Nếu `subagent_type` sai/không có agent nào → tool trả content hướng dẫn (liệt kê type hợp lệ / "tự làm"), **không** ném "Tool Task not found". Điều này khử lỗi gốc kể cả khi workspace chưa có agent.

8. **Không bật trong plan mode.** Plan mode là read-only investigation; không spawn subagent (có thể ghi file). `Task` chỉ thêm khi `mode !== 'plan'`.

## Phương án đã cân nhắc

- **A. Stub `Task` tool** (trả message "subagent không khả dụng") — rẻ, khử lỗi ngay nhưng bỏ lỡ năng lực delegate. *Từ chối:* user chọn B; hành vi graceful của B (điểm 7) đã bao trùm lợi ích của A.
- **C. Nudge system prompt bảo model đừng gọi Task** — fragile, phụ thuộc model tuân thủ, không khử lỗi triệt để. *Từ chối.*
- **Depth > 1 (subagent spawn subagent)** — phức tạp, dễ runaway/cháy token, lệch Claude Code. *Từ chối:* chốt depth = 1.
- **Subagent luôn kế thừa model của parent** (bỏ frontmatter) — đơn giản hơn nhưng mất khả năng "agent A dùng Opus, agent B dùng Haiku". *Từ chối:* user chốt honor AGENT.md, fallback parent.

## Hệ quả

- **Tích cực:**
  - Hết lỗi `Tool Task not found` ở cả Sessions lẫn Tasks (kể cả khi 0 agent).
  - Model delegate được sang AWOG agent chuyên trách (đúng tầm nhìn guild). Subagent có systemPrompt/tools/MCP/model riêng theo AGENT.md.
  - Reuse tối đa: `resolveAgentContext`, `createRuntimeToolDefinitions`, `buildContext`, `resolveModel` + adapter sẵn có (chỉ thêm tham số `parentId`). UI không đổi (parentId nesting đã có).
- **Tiêu cố / Trade-off:**
  - Mỗi `Task` là một vòng `runAgentLoop` lồng → tốn token/thời gian. ~~Chạy `sequential` nên không song song.~~ **Cập nhật:** nhiều `Task` trong cùng một turn nay chạy **song song** ([Cập nhật 2026-06-17](#cập-nhật-2026-06-17--song-song-hoá-task)). Vẫn có guard số lần spawn / turn (soft cap) để chặn runaway.
  - Session 'ask' mode: subagent có thể sinh nhiều permission prompt nested — đánh đổi cho an toàn.
  - Cross-provider subagent chạm vùng credential mà [ADR 0026](./0026-per-agent-multi-provider-llm.md) vẫn còn mở; ở đây chỉ tái dùng `resolveCredential` per-account hiện hữu, không mở rộng gateway.
- **Việc cần làm tiếp:**
  - ~~Cập nhật chú thích `<mcp-preference>`~~ ✅ subagent **nay kế thừa** MCP của session (union với MCP riêng AGENT.md); nudge trong [sessions.send-message.ts](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) đã đổi sang "subagent inherits these MCP servers automatically".
  - Cân nhắc surface text/summary của subagent thành 1 step `note` nested (hiện chỉ trả về model + hiện ở result của step `Task`).
  - infosec review path mới (spawn loop lồng + credential per-subagent).

## Cập nhật 2026-06-17 — song song hoá `Task`

Bản đầu chạy `Task` **tuần tự** (`executionMode: 'sequential'` trên tool + `toolExecution: 'sequential'` ở vòng lặp cha) cho ổn định thứ tự step. Thực tế: khi model spawn nhiều subagent trong một turn, chúng chạy lần lượt (agent đầu xong mới sang agent sau) → mất lợi thế wall-clock của fan-out.

**Đổi:** cho **nhiều `Task` trong cùng một turn fan-out song song**, giữ mọi tool khác tuần tự như cũ.

- Pi quyết định parallel/sequential ở **mức cả batch** ([agent-loop `executeToolCalls`](../../apps/desktop/sidecar/src/runtime/tools/index.ts)): batch chạy song song chỉ khi `toolExecution: 'parallel'` **và** không tool nào trong batch mang `executionMode: 'sequential'`.
- [run-stream.ts](../../apps/desktop/sidecar/src/runtime/run-stream.ts) + [invoke.ts](../../apps/desktop/sidecar/src/runtime/invoke.ts): vòng lặp cha đổi sang `toolExecution: 'parallel'`.
- [createRuntimeToolDefinitions](../../apps/desktop/sidecar/src/runtime/tools/index.ts): đánh dấu **mọi** tool non-Task (built-in + MCP) là `executionMode: 'sequential'`. `Task` thêm ở top-level (ngoài hàm này) nên **không** bị đánh dấu → parallel-eligible.
- [task-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/task-tool.ts): bỏ `executionMode: 'sequential'` khỏi tool `Task`. **Giữ** `toolExecution: 'sequential'` cho vòng lặp **nội bộ** mỗi subagent (tool bên trong một subagent vẫn chạy tuần tự).

**Hệ quả:** batch chỉ-`Task` → song song; batch chạm bất kỳ tool thường nào → vẫn tuần tự (step/permission deterministic). Mỗi subagent stream dưới `parentId` riêng nên nested step vẫn gom đúng card. **Lưu ý:** Session `ask` mode — hai subagent song song có thể cùng park permission một lúc (prompt resolve tuần tự ở `prepare` phase nhưng phần thực thi đan xen); Tasks bypass permission nên không ảnh hưởng.

## Tham chiếu

- [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md), [ADR 0024](./0024-task-execution-engine-ipc-contract.md), [ADR 0015](./0015-agents-persisted-runtime-systemprompt.md), [ADR 0026](./0026-per-agent-multi-provider-llm.md)
- Feature spec: [docs/features/subagent-task-tool.md](../features/subagent-task-tool.md)
