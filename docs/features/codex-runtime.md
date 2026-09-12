# Feature — Runtime Codex cho account OpenAI

> **Trạng thái:** Đã land (2026-09-12) · **ADR:** [0087](../decisions/0087-codex-app-server-as-openai-runtime.md)
> **Phạm vi:** `apps/desktop/sidecar/src/runtime/codex/**`, `runtime/chat-toolset.ts`, `runtime/history-prefix.ts`, dispatch trong `sessions/runner.ts`
> **KHÔNG đụng:** nhánh Anthropic (Claude Agent SDK, [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md)), `/compact` ([ADR 0047](../decisions/0047-on-demand-compaction.md)), Tasks + 20 method one-shot.

## Một câu

Phiên chat của account **OpenAI** không còn chạy vòng lặp agent tự viết của AWOG (Pi) nữa — nó chạy trên **harness hạng nhất của Codex** qua daemon `codex app-server`, còn AWOG giữ nguyên cổng quyền, bộ tool, các khối context, timeline step và sổ usage.

## Vì sao

Cùng một lý do [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md) đưa nhánh Anthropic sang Claude Agent SDK: vòng lặp tự viết là nguồn confabulation, và nó là lý do AWOG phải nuôi [`confabulation-guard.ts`](../../apps/desktop/sidecar/src/runtime/confabulation-guard.ts) + `VERIFY_PROMPT`. Nhà thứ hai giờ cũng có harness hạng nhất của chính nó.

⚠️ **Đây KHÔNG phải phương án ADR 0087 đề xuất.** ADR khuyến nghị opt-in + kill-switch về Pi cho tới khi đo xong F8 (resume, compaction, fork/revert, daemon chết giữa lượt). Người dùng chốt **thay hẳn** (2026-09-12). Hệ quả: phần F8 nào không đo được thì phải có **đường lùi đo được**, không phải một cờ để tắt — xem [Khi mọi thứ hỏng](#khi-mọi-thứ-hỏng).

## Đường đi của một lượt

```
resolveCredential('openai')      → key/bearer của account
ensureCodexHome(account)         → ~/.awog/codex/<accountId>   (KHÔNG BAO GIỜ ~/.codex)
getCodexDaemon(home)             → một daemon cho mỗi account, N thread
buildChatToolset(args)           → bộ tool dùng chung với nhánh Pi
thread/start | thread/resume     → một thread cho mỗi phiên AWOG
turn/start                       → lượt; sự kiện về bằng notification
turn/completed                   → hết lượt
```

| File | Vai trò |
|---|---|
| [`binary.ts`](../../apps/desktop/sidecar/src/runtime/codex/binary.ts) | Tìm binary native (env → optional dep → PATH) |
| [`protocol.ts`](../../apps/desktop/sidecar/src/runtime/codex/protocol.ts) | Lát cắt protocol AWOG thật sự nói |
| [`app-server.ts`](../../apps/desktop/sidecar/src/runtime/codex/app-server.ts) | Client JSON-RPC + pool daemon |
| [`home.ts`](../../apps/desktop/sidecar/src/runtime/codex/home.ts) | `CODEX_HOME` riêng cho mỗi account |
| [`dynamic-tools.ts`](../../apps/desktop/sidecar/src/runtime/codex/dynamic-tools.ts) | Tool AWOG → `dynamicTools`, và dispatch ngược |
| [`event-adapter.ts`](../../apps/desktop/sidecar/src/runtime/codex/event-adapter.ts) | `item/*` → `SessionStep` + `onChunk` |
| [`run-stream.ts`](../../apps/desktop/sidecar/src/runtime/codex/run-stream.ts) | Điều phối lượt |

## Ai sở hữu cái gì

| Của Codex | Của AWOG |
|---|---|
| Vòng lặp agent + system prompt của harness | Cổng quyền (`makeBeforeToolCall`) |
| Shell / sửa file / tìm kiếm + sandbox seatbelt | Bộ tool (wiki, memory, sources, surfaces, subagent, ssh, browser, MCP) |
| Lịch sử hội thoại trong thread, compaction trong thread | Transcript JSONL, bookmark, rewind, `/compact` |
| Steering (`turn/steer`), usage, rate-limit window | Timeline step, gauge context, budget guard |

### Bộ tool: **danh sách LOẠI TRỪ, không phải danh sách cho phép**

`Read`/`Write`/`Edit`/`MultiEdit`/`Bash`/`BashOutput`/`KillShell`/`Grep`/`Glob` **để cho Codex** — harness của nó đã có, đã gắn sandbox và luồng duyệt riêng, mà đó chính là lý do sang đây. Mọi tool khác bắc cầu qua `dynamicTools`. Loại trừ chứ không cho phép: thêm một tool mới vào AWOG tháng sau thì nó tự tới được Codex, không cần ai nhớ sửa file này.

Đưa thêm một `Read` thứ hai và một `Bash` thứ hai vào là cách chắc chắn nhất làm harness phải đoán xem nó nên dùng cái nào.

## Ba cái bẫy đã dính thật

**1. `mcp__` là tiền tố DÀNH RIÊNG.** Gửi `mcp__github__create_issue` làm tên dynamic tool thì `thread/start` **hỏng nguyên lượt**: `dynamic tool name is reserved`. Nghĩa là mọi phiên có Source/MCP đính kèm đều không mở được thread — tức gần như mọi phiên. Đo trên codex-cli 0.154.0; thử 20 tên khác (`shell`, `apply_patch`, `exec_command`, `Task`, `browser`…) thì không tên nào bị cấm, nên đây là **một luật hẹp, không phải một namespace**. Cách xử lý giống hệt vụ Anthropic chiếm tiền tố `mcp_`: đổi tên **trên dây** (`awogmcp__…`) rồi **trả lại tên gốc trước khi bất cứ thứ gì trong AWOG nhìn thấy** — luật quyền của người dùng, nhãn transcript và phạm vi per-source đều viết theo `mcp__<id>__<tool>`.

**2. Content item là `inputText`, KHÔNG phải `text`.** Trả sai shape thì server **không ném lỗi** — nó đưa chuỗi `dynamic tool response was invalid` cho model làm **kết quả tool**. Spike mất một lượt vì đúng cái này, không có exception nào bắn ra.

**3. `thread/resume` KHÔNG nhận `dynamicTools`.** Bộ tool bị ràng vào thread lúc `thread/start` (bảng `thread_dynamic_tools` phía server). Nếu cứ resume thì một MCP server người dùng vừa đính kèm giữa phiên sẽ **im lặng không tồn tại** suốt phần còn lại của phiên. Nên `Session.codexToolSignature` lưu chữ ký bộ tool mà thread được tạo cùng; lệch chữ ký ⇒ **mở thread mới** (và nạp lại lịch sử qua `renderHistoryPrefix`) thay vì resume một thread mù.

## `CODEX_HOME` — biên cô lập, không phải tiện nghi

Không set `CODEX_HOME` thì thread **thừa kế cấu hình Codex cá nhân của người dùng**. Spike vô tình nạp 8 MCP server của họ và model của họ (một model Claude qua custom provider) vào thread mà AWOG tưởng là mình đã cấu hình. Đây đúng là bài toán `CLAUDE_CONFIG_DIR` của [ADR 0070](../decisions/0070-share-claude-home-for-config.md) nhưng **kết luận ngược**: skills/agents/commands dùng chung là CỐ Ý; nhà runtime của Codex thì không.

- Mỗi account AWOG = một `~/.awog/codex/<accountId>` (chmod 700). Đây cũng chính là cơ chế multi-account của Codex — trong một home không có chỗ đổi account.
- Credential cài bằng cách chạy `codex login` với secret trên **stdin** (`--with-api-key` cho API key, `--with-access-token` cho bearer ChatGPT), **không** tự ghi `auth.json`: shape của file đó là của Codex, bản tự chế sẽ mục ra ở bản sau.
- Chỉ đăng nhập lại khi credential ĐỔI (so bằng SHA-256, không lưu secret). Đổi rồi thì daemon đang chạy bị hạ — nó đọc `auth.json` lúc khởi động.

## Tên tool native → luật quyền cũ vẫn chạy

Lệnh shell của Codex về dưới dạng `item/commandExecution/requestApproval`; AWOG hỏi cổng quyền dưới tên **`Bash`**, còn sửa file dưới tên **`Edit`**. Nhờ vậy một luật `Bash(git status)` người dùng viết từ trước **vẫn khớp** trên runtime mới — luật nói về câu lệnh, không nói về shell của ai chạy nó.

`item/permissions/requestApproval` (xin quyền RỘNG hơn sandbox giữa lượt) trả về profile **rỗng**: protocol không có nhánh `decline`, nên "không cấp gì" là cách nói không. Nới sandbox là một quyết định bảo mật AWOG chưa có UI, mà mặc định "ừ" thì không được phép ship.

## Khi mọi thứ hỏng

| Hỏng | Chuyện gì xảy ra |
|---|---|
| Không có binary | `CODEX_UNAVAILABLE` kèm đúng lệnh cần chạy |
| Daemon chết giữa lượt | Mọi request đang bay bị reject; thread đang sống nhận `awog/daemonExited` ⇒ lượt kết thúc bằng lỗi thay vì **treo vĩnh viễn** chờ `turn/completed` (đây là câu trả lời cho F8 của ADR) |
| `thread/resume` hỏng | Mở thread mới + nạp lại lịch sử. Người dùng KHÔNG mất tin nhắn |
| Model gọi một tool không còn dựng | Kết quả tool báo thẳng "không có trong phiên này", không giả vờ đã chạy |
| Lượt fail mà **chưa** ra chữ nào | Ném lỗi có MÃ (`AUTH_EXPIRED` → UI mời đăng nhập lại) |
| Lượt fail mà **đã** ra chữ | Trả lỗi mềm + giữ nguyên phần đã trả lời (phần trả lời đáng giá hơn cái mã) |
| Một dòng stdout không phải JSON | Bỏ qua + warn. Giết daemon vì một dòng in lạc còn tệ hơn |

## Cái gì KHÔNG chạy Codex

| Đường | Runtime | Vì sao |
|---|---|---|
| `/compact` | Pi | [ADR 0047](../decisions/0047-on-demand-compaction.md): compaction phải provider-agnostic và checkpoint là của AWOG |
| Account openai có `baseURL` | Pi | Đó là gateway **tương thích OpenAI** (Ollama, LM Studio, router) nằm nhờ trong bucket openai. Codex nói Responses API với bảng provider của chính nó, không chĩa vào một endpoint chat/completions được — đẩy sang đây là **làm hỏng** chúng, không phải nâng cấp |
| Tasks + ~20 method one-shot | Pi | Còn nợ. Một one-shot qua thread Codex kéo theo cả system prompt + tool catalogue của harness (đo được: 23.7k input token cho một prompt 20 từ) |
| Provider google / custom | Pi | Không đổi |

## Đóng gói

`@openai/codex` là dependency thật của sidecar. Cấu trúc giống hệt Claude Agent SDK (shim JS + optional dep theo platform), nên `pnpm deploy --prod` → `build.mjs` → electron-builder mang nó đi **không cần thêm bước nào**. Đo được: `dist/` đi từ ~344MB lên **633MB**, trong đó 289MB là platform package.

Ứng viên prune chưa làm (cần đo trước, đừng đoán): `codex-code-mode-host` (62MB) — AWOG không gọi, nhưng chưa chứng minh app-server cũng không.

⚠️ macOS: thêm **hai** file thực thi lồng nhau chưa ký. Bản mặc định của AWOG là unsigned nên hôm nay không sao; ngày bật ký + notarize thì hai file này phải nằm trong danh sách.

## Kiểm chứng

Đo thật trên codex-cli 0.154.0 (không phải suy từ tài liệu):

- `initialize` 133ms · `thread/start` 259ms · daemon giữ N thread trong MỘT process
- `thread/start` nhận `dynamicTools` sau khi đổi tên tiền tố; từ chối trước khi đổi
- binary resolve đúng ở **cả hai** bố cục: store symlink của pnpm lúc dev, và cây phẳng trong `dist/` sau khi đóng gói
- một lượt thật đi hết đường: credential → home → daemon → toolset (có `Task`) → `thread/start` → `turn/start` → HTTP tới OpenAI → 401 với key giả → nổi lên UI thành `AUTH_EXPIRED`
- 36 unit test: framing NDJSON (chia đôi / gộp dòng / dòng rác), bắt buộc trả lời server request + đúng shape "không", daemon chết giữa lượt, round-trip tên tool, shape `inputText`, cộng dồn usage, bốn bất biến của adapter

**Chưa đo** (đừng coi là đã chạy): một lượt model THẬT end-to-end (cần account thật), `thread/resume` sau khi thread đã có rollout, Windows + Linux, subagent chạy dưới thread Codex.
