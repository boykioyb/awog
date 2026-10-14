# One-shot trên Claude SDK

Các helper one-shot ở `apps/desktop/sidecar/src/runtime/complete.ts` chọn runtime **theo provider**, cùng quy tắc với chat (ADR 0058):

|Provider (đã resolve)|Runtime|
|---|---|
|`anthropic`|Claude Agent SDK — `runtime/claude-sdk/complete.ts`|
|`anthropic` + account `api: 'openai-completions'` (gateway nằm trong bucket anthropic)|Pi|
|`google`, `openai` (custom `baseURL`)|Pi|

Provider = `args.provider ?? providerOfAccount(accountId) ?? 'anthropic'`.

## API (trung lập provider)

- `complete(args)` / `completeWithUsage(args)` — văn bản thuần, không tool; `completeWithUsage` trả thêm `usage` thật.
- `streamComplete(args, onDelta)` — như trên, đẩy từng delta text.
- `author(args, cb)` — agentic: `Write`/`Read`/`Edit` dưới `bypassPermissions`, callback `onText`/`onToolUse`/`onToolResult`.
- `isModelRefusal(err)` — không đổi.

Hợp đồng lỗi giữ nguyên cho mọi runtime: `-32020 AUTH_EXPIRED`, `-32021 model error: …` / `completion failed: …`, `-32022` rate limit.

## Cấu hình query() cho one-shot

- `systemPrompt` là **chuỗi thuần** (không preset `claude_code`).
- `settingSources: []` (không nạp CLAUDE.md/skill/hook), `strictMcpConfig`, `persistSession: false`, `thinking: disabled`, `effort: low`.
- Pure-text: `tools: []`, `maxTurns: 1`, cwd = `$TMPDIR/awog-oneshot` (trống — CLI không quét project của user).
- `author`: `tools: ['Write','Read','Edit']` (cùng bộ với bản Pi; Bash/Grep/Glob bị loại vì model dò shell trong môi trường headless), `includePartialMessages` để stream.
- Credential/env qua `buildSdkEnv` (token đóng băng vào env tiến trình con → `FROZEN_TOKEN_MIN_LIFETIME_MS`).

## Spare process (prewarm) cho pure-text

Cold `query()` trả phí khởi động CLI trước khi prompt đi (ADR 0099: SDK chậm hơn Pi ~1,9s). `runClaudeComplete` nay chạy trên **một tiến trình CLI dự phòng** đã `prewarm()` — module `runtime/claude-sdk/one-shot-spare.ts`.

- **Hợp đồng SDK** (`sdk.d.ts` `prewarm`/`ClaimOptions`): lúc prewarm bị đóng băng mọi option host-level — env (token, base URL), executable, `settingSources`, `tools`, `systemPrompt`, `maxTurns`, thinking/effort, `includePartialMessages`. Lúc `claim()` chỉ đặt được `cwd`, `model`, `appendSystemPrompt`, `permissionMode`, `maxThinkingTokens`, `settings`, `agents`, 3 biến env OAuth.
- **Cách dùng**: spare đậu với `systemPrompt: ''` + `includePartialMessages: true` (+ các option chung của pure-text); mỗi lượt `claim({ cwd: ONE_SHOT_CWD, model, appendSystemPrompt: <systemPrompt của caller> })`. Đo 504 vs 499 input token so với `systemPrompt` thay thẳng — tương đương.
- **Một spare duy nhất**, khoá theo SHA-256 của credential (OAuth token, hoặc api key + baseURL). Đổi tài khoản/refresh token ⇒ spare cũ bị `close()`, lượt đó chạy cold, spare mới prewarm theo credential mới.
- **Vòng đời**: lượt one-shot đầu tiên chạy cold rồi prewarm (lazy). Sau MỖI lượt (kể cả claim hỏng/lỗi model; trừ `-32020`) `ensure()` prewarm lại — *sau* lượt chứ không song song để tiến trình mới không tranh CPU với lượt đang chạy. Nhàn rỗi `SPARE_IDLE_MS` = 10 phút thì đóng (đậu ≈ 230–260MB RSS); `index.ts` `gracefulShutdown` gọi `closeAllOneShotSpares`. Spare chết khi đang đậu (`spare.exited`) tự nhả chỗ.
- **Fallback cold**: `claim()` ném đồng bộ, hoặc claim bị từ chối (Query ném `not_claimed…` và `spare.claimed` reject: `cwd_not_found`, `spare_exited`, `claim_failed`…) ⇒ đóng spare, chạy lại bằng `query()` như cũ (prompt chưa chạy nên không phát đôi). `option_not_applied` (prompt ĐÃ chạy, chỉ model bị từ chối) thì KHÔNG chạy lại, chỉ log warn. Prewarm lỗi ⇒ lượt sau cold, không ném.
- **Hợp đồng lỗi không đổi**: lỗi của chính lượt chạy đi qua `createCollector`/`resultToError`/`mapOneShotError` như đường cold (`-32020`, `-32021 model error: …`, rate limit).
- **`author` KHÔNG dùng spare**: cần `tools: ['Write','Read','Edit']` + `allowDangerouslySkipPermissions` (đóng băng lúc prewarm ⇒ phải có spare riêng) và cwd tuỳ ý; do người dùng mở thủ công, không phải đường nóng. Spare thứ hai chỉ để đậu thêm ~250MB.

### Số đo (haiku-4-5, prompt cỡ commit message, 5 lượt, trung vị, máy dev)

|Đường|Thời gian tới text cuối|
|---|---|
|Cold `query()` (trước đây)|2779 ms (spike thô 2838)|
|Spare, cách nhau ≥4s (qua `runClaudeComplete`)|**2014 ms** (spike thô 1941)|
|Spare, gọi liên tiếp không nghỉ|2773 ms — spare chưa kịp khởi động xong, ngang cold|
|Gọi thẳng `POST /v1/messages` (header OAuth như Pi, tham khảo, KHÔNG xây)|885 ms|
|Pi cũ (ADR 0099)|838 ms|

`prewarm()` tự nó resolve sau ~200ms, trước khi tiến trình thật sự sẵn sàng: claim ngay sau prewarm (`parkedMs` ≈ 100) chỉ cắt cold xuống ~2,5s (spike thô), còn đậu ≥4s mới ra ~1,9–2,0s. Spare cắt ~0,8s; ~1,1s còn lại so với Pi là chi phí của chính lượt CLI [INFERENCE: claim + đăng ký phiên + git/CLAUDE.md context — chưa tách đo]. Khoảng cách 1,1s < ngưỡng 1,2s nên KHÔNG xây đường `fetch` thẳng: nó cần thêm system block giả danh "You are Claude Code…" cho OAuth và đẻ lại một đường anthropic ngoài CLI, ngược ADR 0099 (anthropic = 100% CLI). Số 885ms ở trên là bản đo thô để cha quyết định nếu muốn đổi.

## Test kết nối account

`accounts.test` với account Anthropic (OAuth, API key, endpoint Anthropic-compatible) chạy `complete()` qua đường mới thay vì `fetch` thẳng `/v1/messages`.
