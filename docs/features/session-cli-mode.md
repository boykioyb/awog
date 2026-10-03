# Session CLI Mode — mở phiên trong `claude` / `codex` / `devin` thật

> Một phiên AWOG có thể "đảo qua đảo lại" giữa chat pane hiện tại và một **CLI agent thật** chạy trong PTY ngay trong workspace của phiên — `claude --resume` / `codex resume` đi vào **đúng** cuộc hội thoại đang chạy, còn `devin` mở một phiên độc lập. Message gõ trong CLI được fold ngược về transcript AWOG.

- **Trạng thái:** Đã code (MVP), chưa release
- **Ngày:** 2026-09-29
- **Phạm vi:** `apps/desktop/sidecar` (`sessions/cli-registry.ts`, `sessions/cli-import.ts`, `methods/sessions.open-cli.ts`, `methods/sessions.sync-cli.ts`, gate trong `send-message`, hook `onExit` trong `terminal/manager.ts`) + `apps/desktop/ui-next` (`SessionCliPane.vue`, `cliMode` trong `SessionDetail.vue`, badge `via`, i18n en/vi)
- **Quyết định kiến trúc:** [ADR 0092](../decisions/0092-session-cli-mode.md)

## Vì sao cần

Có những việc TUI của chính các CLI làm tốt hơn UI AWOG: duyệt lại diff lớn trong `claude`, dùng `/resume` của `devin`, hoặc đơn giản là thói quen gõ phím. Người dùng muốn *một* phiên có thể nhảy qua lại giữa hai bề mặt mà **không đứt cuộc hội thoại** — không phải mở terminal ngoài rồi tự `cd` + tự resume.

Điều kiện thuận lợi đã có sẵn:

- Transcript của Claude SDK runtime nằm **chung nhà** `~/.claude/projects/<cwd-hash>/` với Claude Code CLI ([ADR 0070](../decisions/0070-share-claude-home-for-config.md)) → `claude --resume <sdkSessionId>` thấy toàn bộ lượt AWOG, và ngược lại.
- Codex có `codex resume <threadId>` và home riêng per-account `~/.awog/codex/<accountId>/` ([ADR 0087](../decisions/0087-codex-app-server-as-openai-runtime.md)).
- `terminalManager.spawnProcess` (vốn phục vụ `kube-exec`) đã là đường spawn lệnh tùy ý trong PTY, có ring buffer + resize + kill.

## Khái niệm

### Linked vs unlinked

| CLI | Điều kiện | Resume handle | `linked` |
|---|---|---|---|
| `claude` | `settings.provider === 'anthropic'` | `sdkSessionId` có sẵn → `--resume <id>`; chưa có → `--session-id <uuid mới>` (AWOG mint trước, "nhận nuôi" khi file transcript thật sự xuất hiện) | ✅ |
| `codex` | `provider === 'openai'` và **không** custom endpoint, đã có `codexThreadId` | `codex resume <codexThreadId>` với `CODEX_HOME` đúng account | ✅ |
| `devin` | engine hỗ trợ nhưng **đã ẩn khỏi picker** (không dùng) | — không có (AWOG không có devin runtime) | ❌ unlinked |

Phiên Pi (google/custom/openai-qua-endpoint-riêng) **không có** entry "Open in CLI" — cả ba CLI đều mở một conversation khác, không resume được state AWOG, để lộ ra chỉ gây hiểu nhầm.

### Mutual exclusion — bắt buộc, không phải UX

Hai writer cùng append một file transcript shared là cách chắc nhất để **fork** nó: `claude --resume` gặp session-id đang được attach sẽ *lặng lẽ* mở một bản copy — hai phía diverge vĩnh viễn mà không ai báo. Vì vậy:

- `sessions.openCli` từ chối `-32021` khi phiên có lượt đang chạy (`activeSessionIds()` — phủ `sendMessage`, `compact`, lượt steer-parented), và re-check một lần nữa ngay trước khi ghi link (cửa sổ TOCTOU giữa check và spawn).
- `sessions.sendMessage` từ chối `-32021` khi `isCliAttached(sessionId)` — check **trước** persist/abort-registration, re-check sau `registerAborter`.
- `sessions.compact` / `truncate` / `rewind` cũng bị gate (chúng clear `sdkSessionId`/`codexThreadId` — làm mồ côi CLI đang resume); `sessions.delete` **kill PTY trước** rồi mới xoá phiên.
- UI phủ thêm một lớp: composer disable + notice "đang mở trong CLI" (có nút Sync now + Detach).

### Importer — fold transcript CLI về AWOG

Message gõ trong CLI đi vào file của `claude`/`codex`/`devin`, không vào `session.jsonl` của AWOG → importer (`sessions/cli-import.ts`) là cầu nối:

- **Cursor persist** trên `Session.cliImport[kind]` (`{file, offset|step, spawnedAt, pendingSdkSessionId}`) → không double-import qua restart; cursor của kind này không đè kind khác.
- **Sống cùng file shared** (claude/codex): file chứa cả lượt AWOG cũ → hai lớp lọc: `spawnFloor` (bỏ entry trước lúc spawn — floor nằm trong cursor nên sống qua restart) + `subtractKnownMessages` (multiset role+text; entry user phía file match bằng **suffix** vì `promptText` đã bọc scaffold — text người dùng luôn là block cuối).
- **Devin** (unshared): discover file `.json` mới nhất trong `~/.local/share/devin/cli/transcripts` có mtime ≥ spawn floor; chỉ discover khi có bằng chứng phiên này từng mở devin (link/cursor) — một phiên chưa từng mở devin KHÔNG được húp transcript lạ.
- Message import gắn `via: 'claude'|'codex'|'devin'` → chip nhỏ trên `SessionMessageItem`.
- Chạy ở ba thời điểm: PTY exit (fire-and-forget, defer nếu phiên đang bận lượt), nút **Sync now** (`sessions.syncCli` — cũng bị busy-gate), và khi đảo từ CLI về chat.
- Emit `session.cli-synced {sessionId, imported}` → UI reload transcript.

### Nhận nuôi `--session-id` (claude fresh)

Phiên chưa từng chat không có `sdkSessionId` để resume. AWOG mint sẵn uuid, truyền `claude --session-id <uuid>` và giữ uuid ở `pendingSdkSessionId` (trong cursor, persist ngay lúc spawn). Khi file `<uuid>.jsonl` thật sự xuất hiện → importer ghi `sdkSessionId` vào session, **có race-guard**: reload session trong `withSessionLock`, từ chối adopt nếu một lượt AWOG xen vào đã tạo `sdkSessionId` mới hơn.

## Surface

### RPC

| Method | Params | Trả về |
|---|---|---|
| `sessions.openCli` | `{sessionId, cli?, cols, rows}` | `{terminalId, kind, linked, alreadyOpen?}` |
| `sessions.syncCli` | `{sessionId, cli?}` | `{imported}` |

`cli` bỏ trống → mặc định theo runtime (anthropic→claude, openai→codex). `openCli` **idempotent**: link còn sống → trả lại chính nó (`alreadyOpen:true`); đổi kind khi đang mở → `-32021`.

### UI

- Menu `⋯` của chat pane → **"Open in CLI"** → pane full-height gồm strip (CLI native của phiên + Sync now + Detach + nút `Aa` chỉnh cỡ/font/theme terminal + Back to chat), body là một xterm đơn. Devin vẫn được engine/importer hỗ trợ nhưng không hiện trên picker.
- Pane **giữ mount** qua `v-show` → PTY không chết khi đảo view; chỉ unmount khi rời phiên (khi đó PTY bị kill).
- `cliMode` và `gridMode` loại trừ nhau.
- PTY exit khi đang xem chat → notice mở khoá composer + reload transcript (import chạy server-side trong `onExit`).

## Bảo mật — các quyết định đáng nhớ

- **`cli:<sessionId>`** là khoá gom nhóm PTY: tách khỏi shell thường trong `terminal.list`, **không** phải ranh giới bảo mật. Remote gateway (F1/F2 fix): subscription `cli:*` bị từ chối, `terminal.data/exit` của `cli:` không ra egress, `terminal.write/resize/kill` từ remote bị chặn trên PTY `cli:`.
- **Env của claude PTY là pinned**: base đã lọc + đúng tập biến credential/flag cần thiết (`CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`, `CLAUDE_CODE_*`, AWS profile/region từ infra) — token trong env PTY là quyết định **cố ý** (CLI không chạy nếu thiếu; cùng lớp exposure với subprocess SDK mỗi lượt), nhưng KHÔNG kéo theo toàn bộ `process.env`. Codex/devin chạy trên env đã lọc hoàn toàn (codex auth nằm trong `CODEX_HOME/auth.json`).
- `sdkSessionId`/`codexThreadId` từ header được **validate charset** trước khi join path; file transcript phải `realpath` nằm trong root kỳ vọng.
- `transcriptFile` của importer là **test-only**, không RPC nào expose.

## Giới hạn MVP / việc còn lại

- Codex fresh session (chưa `codexThreadId`) → từ chối mở với gợi ý "gửi một tin trước" — mở fresh chấp nhận fork là phase 2.
- `devin` trên Pi session → hiện không mở (unified-picker-unlinked là hướng nới hợp lý duy nhất).
- Lượt queue drain khi đang attach → message mất khỏi queue (edge UX).
- Windows: `pathCandidate` chưa thử `.cmd` shim.
- `sessions.openCli`/`sessions.syncCli` không nằm trong remote allowlist — cố ý (remote không mở/sync được CLI).
