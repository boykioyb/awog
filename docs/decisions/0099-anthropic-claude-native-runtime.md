# 0099 — Provider Anthropic chạy 100% trên Claude SDK/CLI; Pi chỉ còn cho Google + gateway tuỳ chỉnh

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-13
- **Người quyết định:** kyro
- **Supersedes:** [ADR 0047](0047-auto-compact-context.md) cho provider `anthropic` (Pi/Codex giữ nguyên); phần "one-shot luôn qua Pi" của [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md); cơ chế "giữ lượt mở tối đa 30 phút cho việc nền" của nhánh Claude ([ADR 0058](0058-claude-agent-sdk-vs-pi-runtime-revisit.md) + [ADR 0066](0066-session-background-exec-and-wake.md))

## Bối cảnh

ADR 0058 đã đưa chat + task của `anthropic` sang Claude Agent SDK, nhưng bốn đường vẫn chạy kiểu cũ:

1. `/compact` của MỌI provider chạy qua Pi (ADR 0047), checkpoint của AWOG xoá `sdkSessionId` rồi re-seed một phiên SDK mới từ bản tóm tắt.
2. 26 method gọi model một lần (tiêu đề phiên, commit message, sinh skill/agent/hook, soạn logtime…) và nút test account chạy qua Pi.
3. Mỗi lượt chat spawn một tiến trình CLI mới; việc nền xong SAU lượt thì không ai nghe. Nhánh này phải giữ lượt mở tới 30 phút và dặn model "đừng kết thúc lượt mà chờ được báo".
4. AWOG tự chèn `<project_context_files>` / `<available_skills>` / `<available_agents>` trong khi CLI đã tự nạp chúng qua `settingSources`.

Đo trên 150 phiên gần nhất của người dùng (2026-10-13): 758/764 phiên dùng `anthropic`; 93% lượt có context > 200k token (trung vị ~404k); đọc cache chiếm 52% chi phí; AWOG không có ngưỡng tự nén nào.

## Quyết định

Mọi đường của `provider === 'anthropic'` chạy trên Claude Agent SDK / tính năng native của Claude CLI. Pi chỉ còn phục vụ `google` và account OpenAI-tương-thích có `baseURL` (kể cả account `anthropic` có `api: 'openai-completions'`), không đầu tư thêm. `openai` chuẩn vẫn ở Codex (ADR 0087).

1. **Compact native.** `/compact` thủ công và phục hồi khi tràn context gửi `/compact` nguyên văn vào chính phiên SDK đang `resume`. `sdkSessionId` giữ nguyên, AWOG KHÔNG persist `SessionCompaction` cho nhánh này; vạch "đã nén" lấy từ `system/compact_boundary` (live) và từ JSONL của CLI khi replay (ADR 0097). `runner.ts` ném `COMPACT_NATIVE_ONLY` nếu ai gửi compact kiểu Pi cho Anthropic.
2. **Ngưỡng tự nén.** Settings → Sessions có `compactAtTokens` (mặc định 300k, `0` = mặc định của CLI, tắt `autoCompact` = `DISABLE_AUTO_COMPACT=1`), đi theo từng lượt qua `contextConfig` (sidecar không đọc settings.json) và snapshot vào `Task.compactConfig`. Sidecar đặt `CLAUDE_CODE_AUTO_COMPACT_WINDOW = clamp(N + 13000, 100000, 1e6)`.
3. **One-shot.** `runtime/complete.ts` thành dispatcher trung lập (`complete`, `completeWithUsage`, `streamComplete`, `author`); nhánh Anthropic ở `runtime/claude-sdk/complete.ts`: system prompt dạng chuỗi (không preset `claude_code`), `settingSources: []`, `persistSession: false`, không tool cho text thuần (`maxTurns: 1`, thinking tắt), `author` có Read/Write/Edit + bypass. **CLI dự phòng (bổ sung 2026-10-13):** `runtime/claude-sdk/one-shot-spare.ts` giữ MỘT spare `prewarm()` cho mỗi credential; one-shot text thuần `claim()` nó (model + system prompt đưa vào lúc claim qua `appendSystemPrompt`), xong thì nạp spare mới; spare tự đóng sau 10 phút không có one-shot, đổi credential thì đóng spare cũ, claim lỗi thì chạy lạnh. `author` vẫn chạy lạnh (tool + bypass + cwd tuỳ ý bị đóng băng lúc prewarm).
4. **Tiến trình CLI sống lâu cho mỗi phiên chat** (`runtime/claude-sdk/live-process.ts`). Lượt = một đoạn của luồng message, kết thúc ở `session_state_changed: idle` sau `result`. Lượt sau dùng lại tiến trình khi phần HARD của "dấu vân tay spawn" không đổi (xem bổ sung bên dưới); lệch thì đóng và spawn lại bằng `resume`. Task nền xong sau lượt ⇒ CLI TỰ mở lượt model; sidecar giữ buffer và phát `session.background-done {wake:true, native:true}`, renderer gọi `sendMessage {attachWake}` để nhận lượt đó (không đẩy gì vào CLI ⇒ không lượt đôi). Wake native **luôn** tự hiện, bỏ qua `autoContinueOnBackground` — token đã tiêu. Stop = `interrupt()`, giữ tiến trình + task nền. Đóng khi rảnh 5 phút không còn task nền, khi bị LRU đẩy ra, khi xoá/lưu trữ phiên, gắn CLI tương tác, truncate/rewind, tắt sidecar, lỗi auth.
   - Lệnh native (`/compact`, `/context`…) dùng LẠI tiến trình đang sống bất kể dấu vân tay (`acquireLive({ anyConfig })`): nó đọc trạng thái của chính CLI, còn `sessions.compact` dựng cấu hình tối giản không bao giờ khớp lượt chat. Không có luật này thì mỗi `/compact` spawn lại CLI hai lần và giết task nền (smoke thật bắt được; sau sửa: cùng pid qua compact, `sleep 40` vẫn đánh thức agent sau đó).
   - **Trần + LRU (bổ sung 2026-10-13):** tối đa 4 tiến trình sống; vượt trần thì đóng tiến trình lâu nhất chưa dùng mà KHÔNG có task nền và không có lượt đang chạy (`lru evicted`); nếu tất cả đều được bảo vệ thì vượt trần và ghi log. Reaper đóng tiến trình rảnh sau **5 phút** (trước: 10) khi không còn task nền. Đóng tiến trình rảnh rẻ: CLI khởi động tới `system/init` đo 543/536/537ms (lần đầu 1.513ms), 0 token, cache prompt nằm ở server nên `resume` vẫn trúng cache.
   - **Đổi cấu hình giữa phiên KHÔNG spawn lại (bổ sung 2026-10-13):** dấu vân tay tách HARD (cwd, bộ tool allow/deny, agent, env, executable…) ⇒ vẫn spawn lại; SOFT ⇒ áp lên tiến trình đang sống trước khi đẩy message: model `setModel`, effort/ultracode `applyFlagSettings`, thinking `setMaxThinkingTokens`, bộ MCP `setMcpServers`. Áp lỗi ⇒ lùi về đóng + spawn lại. Spike thật (CLI 2.1.296): cùng pid, hiệu lực thấy trên `init`/assistant `model`, `output_config.effort`, danh sách tool; `sleep 40` chạy từ trước vẫn đánh thức agent. `fallbackModel` KHÔNG đổi được giữa chừng (flag thắng settings) ⇒ giữ như lúc spawn.
5. **Bỏ nạp trùng.** Nhánh Anthropic không chèn `<project_context_files>`, `<available_skills>`, `<available_agents>`; whitelist skill của agent cưỡng chế bằng option `skills` của SDK. Chỉ giữ một câu `<skill_mentions>` cho token `@skill:<id>` của composer.

## Phương án đã cân nhắc

- **Bỏ hẳn Pi** (kể cả Google + gateway) — gọn nhất nhưng làm chết account Google và Ollama/LM Studio/router; để sau khi xác nhận không ai cần.
- **Giữ nguyên** — tiếp tục nạp trùng ~35k token/request, không ngưỡng nén, việc nền bị cắt ở cuối lượt.
- **One-shot gọi thẳng `/v1/messages`** — nhanh hơn ~1,9s/lần nhưng lại là một client HTTP riêng cạnh SDK; chưa chọn vì độ trễ đo được dưới ngưỡng 2s đặt ra.
- **Wake qua bg-registry + `resume` (không giữ tiến trình)** — không khả thi: shell nền là con của tiến trình CLI, đóng CLI là giết nó.

## Hệ quả

- **Tích cực:**
  - `/context` cùng phiên đo trên repo này: 96,8k → 62,2k token mỗi request (−34,6k), CLI vẫn thấy đủ CLAUDE.md (+`@import`, `.claude/rules`), `~/.claude/CLAUDE.md`, AGENTS.md, skill, agent.
  - Nén tự động trong chính phiên CLI, không re-seed, `sdkSessionId` không bao giờ rơi vì compact.
  - Việc nền đánh thức agent sau khi lượt đã kết thúc (smoke: lượt 1 kết thúc ở 6,3s, `sleep 18` xong ⇒ wake ở 21,9s, cùng pid ở lượt sau).
- **Tiêu cực / Trade-off:**
  - One-shot qua SDK chậm hơn Pi: lạnh 2.779ms, claim spare 2.014ms (agent đo) / 1.299–1.356ms (smoke tích hợp, gọi cách 5s), Pi 838ms; gọi dồn liên tiếp thì spare chưa kịp khởi động nên vẫn ~2,8s. Gọi thẳng `/v1/messages` đo 885ms nhưng cần giả block "You are Claude Code…" dưới OAuth ⇒ chưa làm. Spare đậu sẵn đo ~255MB RSS cho tới khi tự đóng sau 10 phút.
  - Tiến trình sống: tối đa 4 không-có-việc-nền, đo 150–280MB RSS mỗi cái ⇒ trần + spare ≈ 1,1GB; tiến trình đang có task nền được vượt trần.
  - Vẫn spawn lại (mất task nền đang chạy, log `backgroundTasksLost`) khi đổi phần HARD: agent, bộ tool, cwd, env (vd đổi `compactAtTokens`).
  - Phiên có trần chi phí cứng vẫn spawn mỗi lượt (`maxBudgetUsd` của CLI tính từ lúc `query()` bắt đầu).
  - Ngưỡng nén không xuống dưới ~87k (CLI kẹp cửa sổ ≥ 100k) và bị kẹp theo cửa sổ thật của model.
  - Vạch "đã nén" sau khi tải lại chỉ có số trước nén (JSONL không ghi `postTokens`).
  - Phụ thuộc thêm vào hành vi nội bộ của CLI (`idle`, `task_notification`, `compact_boundary`, `origin.kind = 'task-notification'`) — phải kiểm lại mỗi lần bump `@anthropic-ai/claude-agent-sdk` (đo trên 0.3.296).
- **Việc cần làm tiếp:**
  - Quyết định bỏ hẳn Pi khi xác nhận không cần Google/gateway.
  - Phục hồi tràn context trên một phiên thật sự quá dài chưa chạy thật (chỉ có test mock).

## Tham chiếu

- [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md), [ADR 0047](0047-auto-compact-context.md), [ADR 0058](0058-claude-agent-sdk-vs-pi-runtime-revisit.md), [ADR 0066](0066-session-background-exec-and-wake.md), [ADR 0084](0084-wake-when-no-window-and-push-scope.md), [ADR 0087](0087-codex-app-server-as-openai-runtime.md), [ADR 0097](0097-claude-transcript-as-session-source.md)
- [docs/features/auto-compact.md](../features/auto-compact.md), [docs/features/one-shot-claude-sdk.md](../features/one-shot-claude-sdk.md), [docs/features/session-background-tasks.md](../features/session-background-tasks.md), [docs/features/sessions.md](../features/sessions.md)
