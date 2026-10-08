# AWOG CLI — binary `awog` trong terminal bất kỳ

> `apps/cli` (`@awog/cli`) — client terminal của engine AWOG. Nói chuyện với engine qua **socket attach** (ưu tiên) hoặc **spawn engine tạm thời** khi app không chạy. Không phải daemon, không phải service mới.

- **Trạng thái:** Implemented (2026-10-08) — transport socket + `chat`/`session`/`task`/`login`; `session attach` (PTY bridge) = việc mở
- **Quyết định kiến trúc:** [ADR 0093](../decisions/0093-awog-cli-attach.md)
- **Thư mục:** `apps/cli/` — bin `awog` (Node ≥20, zero dep)

## Mô hình kết nối

```
awog chat
  ├─ Đọc ~/.awog/engine.endpoint (socket path + token per-boot, chmod 600)
  │    ├─ ok  → connect unix socket → engine.hello {token} → engine CHUNG với app
  │    └─ mất/stale → spawn engine tạm (stdio JSON-RPC), AWOG_ATTACH_SOCKET=0
  │                   để con này KHÔNG đè endpoint của app
  └─ engine child chết theo CLI (SIGTERM + SIGKILL fallback)
```

Socket transport ở `sidecar/src/transport/socket.ts`; allowlist method ở `transport/socket-policy.ts` (default-deny — `fs.*`, credential write, `ssh.*`/`infra.*`/`monitor.kill` không qua socket). Event subscribe opt-in qua `events.subscribe {prefixes}` — socket connection mặc định **không nhận event nào** (tránh hút cả firehose của app).

## Lệnh

| Lệnh | Việc |
|---|---|
| `awog chat` | REPL tương tác trên session mới (`-s <id>` tiếp tục session cũ) |
| `awog chat -p "…"` | One-shot: stream reply ra stdout, thoát. `--json` cho NDJSON event |
| `awog session ls` | Bảng session gần nhất (id, thời gian, model, title) |
| `awog session cli <id>` | In lệnh resume native (`claude --resume …` / `codex resume …`) — đường `--print` của ADR 0093, không cần socket |
| `awog session set <id>` | Đặt `llmOverride` trên session: `--model` `--provider` `--account` `--level` `--mode` |
| `awog account ls` | Liệt kê account mọi provider (`*` = active) |
| `awog account use <id>` | Đổi active account **toàn cục** (ghi `credentials.json`, ảnh hưởng app) |
| `awog models ls` | Catalog model theo provider (`--provider anthropic` mặc định) |
| `awog task run <workflow> --project <id> --watch` | Tạo + chạy task, stream `task.run.output`, hỏi/`--approve` phase approval |
| `awog login` | OAuth paste-code (anthropic) hoặc `--api-key <key>` mọi provider |
| `awog project ls` / `use <ref>` / `add <path>` | Liệt kê / đặt project mặc định / đăng ký mới. Default persist ở `~/.awog/cli.json`; `chat`/`task` resolve theo `--project` → `AWOG_PROJECT` → cli.json → cwd |
| `awog source ls` | Liệt kê source (mcp/api/local) + trạng thái kết nối — alias `mcp` |
| `awog source add <slug>` | Tạo source: `--command/--args/--env` cho stdio, `--url/--headers/--bearer` cho http; bare `KEY` trong env/headers → hỏi giá trị rồi cất keychain (`secret:KEY` ref) |
| `awog source rm|on|off|test|tools <slug>` | Xoá / bật-tắt / test handshake / liệt kê tool |
| `awog source secret <slug> <KEY> [value]` | Ghi secret vào keychain sau khi tạo |

**Slash trong REPL `awog chat`** — đổi qua `sessions.setLlmOverride` (persist trên header, áp dụng turn SAU, broadcast `session.llm-override` để app attach hội tụ):

- `/model <id>` — đổi model (không arg = liệt kê model của provider hiện tại)
- `/account <id>` — đổi account **của session này** (không arg = liệt kê; khác `account use` là global)
- `/level <l>` — `low|medium|high|extra-high|max`
- `/mode <m>` — `ask|accept-edits|plan|execute`
- `/status` — xem cấu hình hiện tại · `/quit` thoát

## Quy ước đầu ra

- **stdout** = output của model / dữ liệu (`-p` stream verbatim, `--json` = NDJSON `session.chunk`/`session.step`/…).
- **stderr** = prompt (permission, AskUserQuestion, OAuth), status line (`· …`), log engine relay.
- Không TTY → permission auto-deny có log; `login` OAuth báo lỗi, dùng `--api-key`.
- ANSI màu/style tự tắt khi không có TTY hoặc `NO_COLOR` — piped output luôn là text trần.
- `AWOG_VERBOSE=1` mở relay log JSON của engine spawn (mặc định giấu; RPC error vẫn hiện).

## Giới hạn v1

- `awog session attach` (PTY bridge thật) chưa có — `sessions.attachCli` + `terminal.*` trên socket đã được allowlist sẵn trong `socket-policy.ts` để plug vào.
- Spawn-path chỉ đọc được engine đã build (`dist-dev` hoặc `dist`) của checkout này, hoặc `AWOG_ENGINE_PATH` — kèm app/bundle npm là bước packaging.
- `host-request` (browser tool) trả lỗi `unavailable` trên cả hai đường — headless by design.
- AskUserQuestion hỗ trợ choice/text/number; `followUp` (xin hỏi thêm vòng nữa) chưa expose trên CLI.

## Phát triển

```bash
cd apps/cli && pnpm build            # tsc → dist/
node dist/cli.js --help
AWOG_NO_ATTACH=1 node dist/cli.js session ls   # ép spawn engine riêng
```

Khi app AWOG đang chạy (bản có socket transport), mọi lệnh attach vào engine của app — session/task của app hiện và thao tác chung.
