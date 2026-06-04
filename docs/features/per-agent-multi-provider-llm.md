# Feature: Per-agent multi-provider LLM

**Trạng thái:** Draft (chờ duyệt) · ADR: [0026](../decisions/0026-per-agent-multi-provider-llm.md)

## Overview

Mỗi agent gắn **provider + model riêng** để dùng song song nhiều LLM trong cùng workspace — ví dụ **agent A chạy Claude, agent B chạy GPT**. Hiện agent chỉ có `model` và runtime chỉ chạy Anthropic; các model GPT/Gemini trong picker chưa wire.

**Mục tiêu (đã chốt cùng user 2026-06-04):**

- Agent chọn được provider (Anthropic / OpenAI / Google) + model của provider đó.
- Account = **active account của provider** (chưa làm override account per-agent — YAGNI).
- Runtime cho non-Anthropic qua **Option A** (gateway dịch Anthropic-compatible trong sidecar) — tái dùng vòng lặp agentic của claude-agent-sdk.
- **Bỏ Phase 0** (custom/local provider): đi thẳng OpenAI rồi Google.

## Personas

- **Builder** dựng đội agent đa dạng, muốn mỗi vai trò dùng model hợp nhất (vd reasoning → Claude, code-gen rẻ → GPT-mini).

## Scope

### Phase 1 — Data model + UI + abstraction (độc lập runtime)

- `Agent` thêm field `provider: ProviderName` (default `'anthropic'`); giữ `model`.
- Frontmatter AGENT.md thêm `provider:` (vắng = anthropic, backward-compat). **`accountId` KHÔNG vào frontmatter** (local-machine, AGENT.md commit được → mất portability).
- AgentEditor: picker phân tầng **Provider → Model** — chọn provider lọc danh sách model theo provider; **provider chưa connect hiển thị disabled** + hint "Connect in Connections/Settings".
- Sidecar: interface `ModelProvider` (OCP); `AnthropicProvider` = wrap code hiện tại (`resolveAccount`/`ensureToken`/`buildOptions`/`query`/`mapError`/`models`), **0 đổi hành vi**. Call-site (`runStream`, `invokeSdk`, `*.generate.ts`) gọi qua `getProvider(settings.provider)`.

### Phase 2 — OpenAI (rồi Google) chạy thật

- Account OpenAI/Google: `authMode: 'apikey'`, key lưu qua **OS keychain** ([ADR 0018](../decisions/0018-mcp-secret-keychain.md)) — không vào file/git/UI.
- Gateway dịch trong sidecar: bind localhost (no port public — [security #6](../../.claude/rules/security.md)); SDK trỏ `ANTHROPIC_BASE_URL` → gateway; dịch Anthropic Messages ↔ OpenAI/Google + stream tool-use/text ngược về shape Anthropic.
- `resolveAccount`/`ensureFreshAccessToken` bỏ guard anthropic-only, dispatch theo provider.

## Out of scope (MVP feature này)

- Override account per-agent (chỉ active account của provider).
- Custom/local provider (Ollama/vLLM/OpenRouter) — Phase sau, cần SSRF guard.
- Per-agent thinking/beta đặc thù provider khác Anthropic.
- Đổi provider của session chat (feature này về **agent**; session vẫn picker riêng).

## User flows

### Flow 1 — Tạo agent dùng GPT (golden path)
1. Mở Agent editor → khối **Provider**: chọn `OpenAI` (đã connect ở Connections/Settings).
2. Danh sách **Model** lọc còn model OpenAI → chọn `gpt-5`.
3. Lưu → AGENT.md ghi `provider: openai`, `model: gpt-5`.
4. Dùng agent này trong session/task → chạy qua gateway → GPT trả lời, tool-use/MCP vẫn hoạt động.

### Flow 2 — Provider chưa connect
1. Chọn provider `Google` nhưng chưa có account.
2. Provider hiện **disabled** + hint "Connect Google in Settings". Không lưu được agent với provider chưa connect (hoặc lưu nhưng cảnh báo runtime).

### Flow 3 — Agent Anthropic cũ (backward-compat)
1. AGENT.md cũ không có `provider` → load mặc định `anthropic`. Chạy y như trước.

## Acceptance criteria

- **AC1** — Given agent có `provider: openai` + `model: gpt-5` và OpenAI account active, When chạy session/task, Then request đi tới OpenAI và stream về UI; tool-use + MCP + permission prompt hoạt động.
- **AC2** — Given agent `provider: anthropic` (hoặc không có field), When chạy, Then hành vi **không đổi** so với hiện tại (regression-free).
- **AC3** — Given provider chưa connect, When mở picker, Then provider đó disabled + hint; không thể lưu agent trỏ provider chưa connect.
- **AC4** — API key OpenAI/Google **không** xuất hiện trong UI/log/event/trace/AGENT.md/git (invariant #1).
- **AC5** — Gateway bind localhost, không mở port public (invariant #6).
- **AC6** — Model picker chỉ hiện model của provider đã chọn (không lẫn provider khác).

## Edge cases

- Provider active account bị xoá sau khi agent đã trỏ → runtime báo `NO_ACTIVE_ACCOUNT` rõ ràng, không crash.
- OpenAI tool-call streaming khác Anthropic → gateway phải gom + dịch đúng `tool_use` block (điểm rủi ro chính, cần test).
- Model id không thuộc provider đã chọn (frontmatter sửa tay) → validate khi load, fallback model mặc định của provider + cảnh báo.
- Resume (ADR 0023): gateway non-Anthropic có thể không hỗ trợ resume → degrade về re-seed, không lỗi.
- Thinking/beta Anthropic-only → bỏ qua khi provider khác, không gửi field không hợp lệ.

## Dependencies

- [ADR 0026](../decisions/0026-per-agent-multi-provider-llm.md) (quyết định kiến trúc).
- [ADR 0015](../decisions/0015-agents-persisted-runtime-systemprompt.md) (Agent persistence — nơi thêm `provider`).
- [ADR 0018](../decisions/0018-mcp-secret-keychain.md) (lưu API key).
- [ADR 0023](../decisions/0023-sdk-session-resume-and-compact.md) (resume).
- [models-and-accounts.md](./models-and-accounts.md) (account/credential UI — cần thêm OpenAI/Google API-key connect flow).

## Open questions

- Gateway: tự viết translator hay nhúng lib (vd port logic LiteLLM)? → quyết ở Phase 2 design.
- Connect OpenAI/Google: chỉ API-key, hay cả OAuth (Google)? → MVP chỉ API-key.
- Model list per-provider: hardcode hay fetch từ provider API? → MVP hardcode (như Anthropic hiện tại).
