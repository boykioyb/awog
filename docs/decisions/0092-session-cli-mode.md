# 0092 — Session CLI Mode: PTY-linked `claude`/`codex`, unlinked `devin`, transcript importer ngược

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-29
- **Người quyết định:** kyro (chốt phạm vi + UX), devin (implement)

## Bối cảnh

Người dùng muốn trong một session AWOG có "chế độ CLI" — mở `claude`/`codex`/`devin` thật trong pane, đảo qua đảo lại với chat hiện tại ([spec](../features/session-cli-mode.md)). Ba câu hỏi kiến trúc: (1) đặt toggle ở đâu, (2) làm sao CLI resume đúng cuộc hội thoại thay vì fork, (3) message CLI-side quay về transcript AWOG thế nào.

Ràng buộc định hình:

- **Shared transcript là con dao hai lưỡi.** `claude --resume <sdkSessionId>` đi vào đúng file `~/.claude/projects/<hash>/<id>.jsonl` mà lượt AWOG cũng ghi ([ADR 0070](0070-share-claude-home-for-config.md)). Cho phép hai writer cùng lúc = fork lặng lẽ vĩnh viễn (CLI mở copy mới khi id đang attach, không báo).
- **Invariant #1** (credential không rời sidecar): CLI không chạy được nếu thiếu credential → token phải vào env của một PTY **tương tác, sống lâu** — khác hẳn subprocess SDK ngắn hạn của mỗi lượt.
- Pi runtime không có handle native nào (rebuild context từ JSONL AWOG mỗi lượt) → không CLI ngoài nào resume được.

## Quyết định

1. **Toggle nằm trên chat pane** (`⋯` → "Open in CLI"), KHÔNG phải tab mới trong Workspace Panel. Lý do: "đảo qua đảo lại" là giữa *chat* và *CLI* của cùng một cuộc hội thoại — để ở workspace tab thì CLI trở thành "một terminal nữa", mất ngữ nghĩa. Pane giữ mount qua `v-show` để PTY sống xuyên toggle.
2. **Ba mức khả năng, phân theo runtime** (`SessionCliKind`): `claude` linked qua `sdkSessionId`/`--session-id` mint sẵn; `codex` linked qua `codex resume <codexThreadId>` + `CODEX_HOME` per-account; `devin` unlinked (AWOG không có devin runtime — người dùng tự `/resume`). **Pi session không offer CLI mode.**
3. **Mutual exclusion là bắt buộc ở sidecar**, không chỉ UI: `openCli` gate `activeSessionIds()`, `sendMessage` gate `isCliAttached()`, `compact`/`truncate`/`rewind` gate, `delete` kill-then-remove, và re-check hai phía ngay trước commit point (TOCTOU).
4. **Importer thay vì banner**: transcript CLI fold về `session.jsonl` bằng cursor persist trên `Session.cliImport[kind]` — importer chạy sau PTY exit, khi bấm Sync now, và khi đảo về chat. Dedupe file shared bằng `spawnFloor` (persist trong cursor) + multiset `role+text` với **suffix-match cho entry user** (vì `promptText` bọc scaffold nên text lưu ≠ text trong file — text user luôn là block cuối).
5. **Env PTY là pinned, không verbatim**: `sanitizedBaseEnv()` + đúng tập biến `buildSdkEnv` set. Chấp nhận `CLAUDE_CODE_OAUTH_TOKEN` trong env PTY (cần thiết, cùng lớp exposure với lượt SDK) nhưng **từ chối** kéo theo mọi `*_KEY/_TOKEN/_SECRET` của môi trường sidecar.
6. **Remote gateway tường hoá `cli:`**: subscription `cli:*` từ chối, `terminal.data` của CLI PTY không ra egress, remote `terminal.write/resize/kill` chặn trên PTY `cli:`. `cli:` chỉ là khoá gom nhóm, nhưng nội dung PTY mang credential → không được rời máy.

## Phương án đã cân nhắc

- **Tab `CLI` trong Workspace Panel** (cạnh Terminal/Browser) — ít đụng layout nhất, nhưng sai ngữ nghĩa: CLI là *bề mặt khác của cùng conversation*, không phải tool rời. Người dùng chốt chat pane.
- **Chỉ hiện banner "phiên có thêm message ở CLI"** thay vì importer — transcript UI đơ thiếu lượt, phải tự suy đoán đã nói gì trong CLI. Người dùng chốt importer ngay.
- **`codex`/`devin` trên mọi phiên kể cả Pi (unified picker)** — mở được nhưng không resume được state AWOG; trên Pi cả ba đều chỉ là "conversation khác trong cùng folder" → nhiễu. Chốt: Pi không có CLI mode; devin unlinked chỉ hiện trên phiên anthropic/openai.
- **Không mutual-exclusion, tin vào `claude` tự xử** — nó "xử" bằng cách fork lặng lẽ. Không chấp nhận được.
- **Persist `promptText` đã bọc scaffold lên message để dedupe exact** — đúng nhất nhưng phình header message cho mọi lượt; suffix-match đạt cùng kết quả vì pendingText luôn cuối scaffold.
- **Không cho token vào env PTY** (vd: `CLAUDE_CONFIG_DIR` riêng với credentials file) — xung đột thiết kế shared-home (ADR 0070): claude CLI đọc `~/.claude` chung, tách config dir làm mất settings/MCP/skills chung của user. Chấp nhận residual + siết mặt xung quanh (pinned env, remote egress).

## Hệ quả

- **Tích cực:** một conversation xuyên suốt hai bề mặt; importer cho phép "xem lại" gồm cả devin; hạ tầng PTY/monitor (`--resume` classification) tái dùng gần trọn vẹn.
- **Tiêu cực / Trade-off:**
  - Token OAuth nằm trong env của tiến trình tương tác sống lâu → `!env` echo, `/proc/environ`, crash dump. Đã siết bằng pinned env + chặn remote egress + `read_terminal` có `redactString`; residual được chấp nhận và ghi tại đây.
  - Trong CLI mode **mất** các feature AWOG: permission gate UI, checklist, plan mode, attachments, budget cap, steering — CLI dùng permission/MCP của chính nó.
  - Message import từ CLI **sẽ** vào context rebuild của các lượt sau (kể cả khi sang runtime khác) — đây là feature (cross-agent memory), không phải bug.
  - Hai map module-global (`links`/`lastLinks`) là state-sidecar mới cần restart-safe → phần cần thiết (`pendingSdkSessionId`, `spawnedAt`, cursor) persist lên `Session.cliImport`.
- **Việc cần làm tiếp:** codex fresh-session (mở fresh + adopt thread), devin trên Pi (nếu nới), `queue` drain khi attach, Windows `.cmd` shim, e2e test thật trên app.

## Tham chiếu

- [Spec: session-cli-mode](../features/session-cli-mode.md)
- [ADR 0019](0019-pty-terminal-in-sidecar.md) — PTY trong sidecar
- [ADR 0070](0070-share-claude-home-for-config.md) — shared `~/.claude` home (nền của linked-claude)
- [ADR 0087](0087-codex-app-server-as-openai-runtime.md) — `codexThreadId` + `CODEX_HOME` per-account
- [ADR 0090](0090-activity-monitor-process-attribution.md) — sổ `owned.ts` + argv classification (CLI PTY quy về phiên nhờ `--resume`)
