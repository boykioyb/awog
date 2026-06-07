# 0026 — Per-agent multi-provider LLM (provider + account + model)

- **Trạng thái:** Accepted — Phase 1 + A + B đã implement (2026-06-05); Phase C (gateway OpenAI/Google) còn lại
- **Ngày:** 2026-06-04 (cập nhật 2026-06-05)
- **Người quyết định:** Tech Lead + user (hướng A, làm cả ba scope, phân kỳ)

## Bối cảnh

Hiện mỗi agent chỉ có field `model` (frontmatter AGENT.md). **Không** có cách gán LLM provider/account riêng cho agent. Account (credential) được resolve **ngoài agent**:

- Session: gửi `{ provider, modelId, accountId? }`; `accountId` mặc định = active account của provider ([sessions.send-message.ts:36-40](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts#L36)).
- Task: node dùng `agent.model` làm model, account lấy từ settings của task.

**Ràng buộc quan trọng (từ khảo sát code):**

1. **Runtime bám cứng `@anthropic-ai/claude-agent-sdk`.** Toàn bộ vòng lặp agentic — tool-use → tool-result → turn kế, MCP bridging, permission callback (`canUseTool`), streaming SSE, `resume` (ADR 0023), thinking budget — nằm **bên trong** `query()`. AWOG chỉ tiêu thụ stream `SDKMessage` và build `Options`.
2. **`resolveAccount` + `ensureFreshAccessToken` throw `provider not supported yet` cho non-anthropic** ([runner.ts:99-101](../../apps/desktop/sidecar/src/sessions/runner.ts#L95), [token-manager.ts:63](../../apps/desktop/sidecar/src/credentials/token-manager.ts)). → model GPT/Gemini/Local trong picker hiện tại **chưa wire**, chọn vào sẽ lỗi.
3. **credentials.json đã sẵn cấu trúc đa-provider** (`providers.{anthropic,openai,google}.accounts[]`, `authMode: oauth|apikey`). Chỉ code đang guard về anthropic.
4. Không có hook base-URL/custom-transport nào đang dùng. Env duy nhất truyền vào SDK là `CLAUDE_CODE_OAUTH_TOKEN`.

Bài toán: cho phép **mỗi agent chọn provider + account + model bất kỳ** (Claude/GPT/Gemini/custom) và chạy đúng ở cả session lẫn task.

## Quyết định

> Đề xuất (chờ chốt). Hai phần: (1) data model + UI — chung cho mọi hướng; (2) runtime — chọn hướng A hoặc B.

### Phần 1 — Data model + UI (chung, làm trước)

- **Agent thêm field:** `provider: ProviderName` (mặc định `'anthropic'`) + `accountId?: string` (optional override) + giữ `model`. **Quyết định (user 2026-06-04): CÓ override account per-agent.** `accountId` lưu vào frontmatter; vì account id là local-machine (AGENT.md commit được → có thể không tồn tại trên máy khác), runtime **fallback về active account của provider** nếu id không còn → graceful, không vỡ portability.
- **AgentEditor:** picker **Provider → Account → Model**: chọn provider lọc model + reset account; dropdown Account liệt kê account của provider đó + "Active account (default)"; **chỉ provider đã connect mới chọn được** (disable provider chưa có account).
- Frontmatter AGENT.md thêm `provider: openai` (cạnh `model:`); vắng = `anthropic` (backward-compat).

### Phần 2 — Runtime: trừu tượng hoá `ModelProvider` (open-closed, [principles](../../.claude/rules/principles.md))

Gom các điểm dispatch (khảo sát đã xác định đúng tập tối thiểu) vào interface:

```
interface ModelProvider {
  resolveAccount(accountId?): Promise<AccountRecord>
  ensureToken(accountId): Promise<Credential>          // oauth refresh | apikey
  buildOptions(settings, cred, ctx): QueryOptions
  query(prompt, options): AsyncIterable<SDKMessage>     // phải emit cùng shape SDKMessage
  mapError(err): RpcError
  models(): ModelDescriptor[]                            // id, supportsThinking, betas
}
```

Call-site (`runStream`, `invokeSdk`, mọi `*.generate.ts`) gọi qua `getProvider(settings.provider)` thay vì `query` trực tiếp. **`AnthropicProvider` = wrap code hiện tại, không đổi hành vi.** Non-anthropic provider hiện thực qua **hướng A hoặc B** dưới đây.

## Phương án đã cân nhắc

### Option A — Gateway tương thích Anthropic trong sidecar (ĐỀ XUẤT)

- **Mô tả:** Một translation layer **trong sidecar** (bind localhost, không port public — [security inv. #6](../../.claude/rules/security.md)) expose Anthropic Messages API; SDK trỏ vào qua `ANTHROPIC_BASE_URL`. Layer dịch request Anthropic ↔ OpenAI/Google API + stream SSE ngược lại theo shape Anthropic. **Tái dùng nguyên vòng lặp agentic + MCP + permission + resume của claude-agent-sdk.**
- **Pros:** Ít code nhất; giữ MCP/tool-use/permission/thinking/resume "miễn phí"; bề mặt dịch chỉ là *shape request/response* (LiteLLM/claude-code-router đã chứng minh khả thi); thêm provider mới = thêm 1 bộ map.
- **Cons:** Phải map tool-use/streaming/thinking giữa các API (Gemini tool format khác); một số tính năng Anthropic-only (thinking, một số beta) có thể degrade trên provider khác; thêm 1 lớp dịch cần test kỹ; OAuth-only của Anthropic vs API-key của OpenAI/Google → cần thêm `authMode: apikey` flow + lưu key qua keychain ([ADR 0018](./0018-mcp-secret-keychain.md)).

### Option B — Native adapter per-provider (dùng SDK chính chủ)

- **Mô tả:** `OpenAIProvider`/`GoogleProvider` dùng SDK của hãng; **tự reimplement** vòng lặp agentic: tool-use loop, bridge MCP tool → function-calling, permission gating, streaming, (resume nếu có).
- **Pros:** Native, không lớp dịch, kiểm soát đầy đủ; không phụ thuộc behavior gateway.
- **Cons:** **Rất lớn** — nhân bản orchestration mà claude-agent-sdk cho sẵn (MCP bridge + permission + stream + resume) cho từng provider; bảo trì cao; dễ lệch hành vi giữa các provider. Vi phạm KISS/YAGNI cho nhu cầu single-user.

### Option C — Gateway ngoài (LiteLLM/OpenRouter SaaS)

- **Mô tả:** Trỏ SDK tới gateway bên thứ ba.
- **Lý do từ chối:** Vi phạm local-first + no-telemetry (traffic + key qua SaaS bên thứ ba); SSRF/allowlist phức tạp. Nếu self-host LiteLLM thì thành "backend service mới" (trái quy ước repo). Option A là bản self-contained của ý tưởng này.

### Option D — Chỉ hỗ trợ provider Anthropic-compatible (Ollama/vLLM/OpenRouter qua base URL)

- **Mô tả:** Không dịch; chỉ cho phép endpoint vốn đã nói Anthropic Messages API (vài local runner, OpenRouter Anthropic-compat).
- **Lý do từ chối (một phần):** Phủ sóng hẹp (không có GPT/Gemini "chính chủ"), nhưng **chi phí gần như 0** → có thể là **Phase 0** (chỉ cần thêm `baseURL` + `authMode: apikey` + SSRF guard) để mở "custom provider" trước, rồi A bổ sung GPT/Gemini sau.

## Hệ quả

- **Tích cực:** Agent gắn provider/account/model riêng; mở rộng provider qua adapter (OCP); credentials.json đã sẵn sàng; UI hết tình trạng hiển thị model không chạy được.
- **Tiêu cực / Trade-off:** Thêm lớp trừu tượng + (hướng A) lớp dịch API; một số tính năng Anthropic-only có thể không 1-1 trên provider khác; tăng bề mặt test + security (API-key flow, SSRF cho custom base URL).
- **Việc cần làm tiếp (phân kỳ đề xuất):**
  1. **Phase 0** (nhỏ): API-key auth (`authMode: apikey`) + custom base URL + SSRF guard ([security #7](../../.claude/rules/security.md)) → mở Ollama/vLLM/OpenRouter (Option D). Lưu key qua keychain.
  2. **Phase 1:** Data model + UI (Phần 1) + interface `ModelProvider` + `AnthropicProvider` (refactor không đổi hành vi). Spec ở `docs/features/`.
  3. **Phase 2:** Gateway dịch trong sidecar cho OpenAI rồi Google (Option A). Test tool-use/stream/thinking từng provider.
  4. Cập nhật [models-and-accounts.md](../features/models-and-accounts.md), [tech-stack.md](../architecture/tech-stack.md).
- **Đã chốt (user 2026-06-04):** Hướng **A** (gateway trong sidecar); **CÓ** override account per-agent (`accountId` optional, fallback active); **bỏ Phase 0**. Phase 1 (data model + UI picker Provider/Account/Model + interface) đã implement.
- **Đã implement (user 2026-06-05) — Phase C (Pi SDK single runtime multi-provider):** thay vì gateway dịch API, **migrate toàn bộ sang Pi SDK** làm single runtime cho mọi provider — xem [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md). Phần Phase A/B (API-key + custom Anthropic-compat endpoint) giữ lại cho legacy, nhưng mọi session/task hiện dùng Pi runtime. Phase C Phase A + B (API key + custom Anthropic-compatible endpoint) + native **OpenAI, Google, custom OpenAI-protocol** via Pi SDK (một `model-resolver` + cred flow). Sidecar module `apps/desktop/sidecar/src/runtime/`: model-resolver, context-builder, tools, permission (beforeToolCall), event-adapter, thinking, run-stream, invoke, complete. Multi-provider `AccountRecord.api` discriminate (`'anthropic-messages'|'openai-completions'`). Task engine + Sessions + 7 one-shot method (`generate`, `author`, ...) dùng Pi. Azure/custom OpenAI-compatible supported qua `api` field + custom `baseURL`. OAuth Anthropic verified; OpenAI/Google = API key. `@anthropic-ai/claude-agent-sdk` gỡ khỏi sidecar deps (phase C4).

## Tham chiếu

- [ADR 0015](./0015-agents-persisted-runtime-systemprompt.md) — Agent persistence + runtime (nơi thêm `provider`).
- [ADR 0023](./0023-sdk-session-resume-and-compact.md) — resume nằm trong `query()` cần bảo toàn.
- [ADR 0018](./0018-mcp-secret-keychain.md) — pattern lưu API-key qua OS keychain.
- [docs/features/models-and-accounts.md](../features/models-and-accounts.md) — roadmap multi-provider + `ModelAdapter`.
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #1 (key không rời sidecar), #6 (no port public), #7 (no SSRF).
