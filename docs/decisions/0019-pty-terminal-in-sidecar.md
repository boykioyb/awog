# 0019 — Interactive PTY terminal trong sidecar

- **Trạng thái:** Proposed
- **Ngày:** 2026-05-31
- **Người quyết định:** Tech Lead (AWOG)

## Bối cảnh

Session Workspace Panel ([spec](../features/workspace-panel.md)) có tab **Terminal** tương tác — người dùng gõ lệnh thật trong workspace của project gắn với session (giống workspace switcher của Claude Code). Khác với các step `terminal` hiện có (chỉ là log read-only của lệnh Bash mà agent chạy), tab này cần một shell tương tác đầy đủ: con trỏ, màu ANSI, resize, lệnh long-running.

Ràng buộc AWOG:
- Local-first, không backend service mới ([CLAUDE.md](../../CLAUDE.md)) — terminal phải sống trong sidecar Node.js sẵn có.
- 8 invariant bảo mật ([.claude/rules/security.md](../../.claude/rules/security.md)), đặc biệt #1 (API key/OAuth không rời sidecar), #2 (path sanitize), #3 (git/exec scope = workspace), #6 (no port public, stdio IPC).
- Không thêm dependency lớn khi chưa có ADR.

## Quyết định

1. **Thêm `node-pty`** (sidecar) để spawn PTY thật, và **`@xterm/xterm` + `@xterm/addon-fit`** (UI) để render. Cả hai cần ADR này (đang là tài liệu đó).
2. **PTY manager** mới: `apps/desktop/sidecar/src/terminal/manager.ts` — `Map<terminalId, {pty, workspaceRoot, sessionId, createdAt, lastActivityAt}>`, idle-kill (mirror MCP idle-stop), cleanup ở `SIGTERM`/`SIGINT` (cùng chỗ `mcpManager.shutdown()`).
3. **RPC mới** (`terminal.*`, per-command như `git.*`):
   - `terminal.create {workspaceRoot, sessionId, cols, rows}` → `{terminalId}`
   - `terminal.write {terminalId, data}` → `{ok}`
   - `terminal.resize {terminalId, cols, rows}` → `{ok}`
   - `terminal.kill {terminalId}` → `{ok}`
   - `terminal.list {sessionId?}` → `{terminals: TerminalSessionRef[]}`
4. **Event mới** (qua `emit` trong `transport/stdio.ts`): `terminal.data {terminalId, sessionId, chunk}`, `terminal.exit {terminalId, sessionId, exitCode, signal?}`.
5. **node-pty nạp qua dynamic import + graceful fallback** (mirror `@napi-rs/keyring` trong [credentials/keychain.ts](../../apps/desktop/sidecar/src/credentials/keychain.ts)): nếu native module không nạp được, `terminal.create` trả lỗi rõ ràng, các tab khác không ảnh hưởng.

### Bất biến bảo mật (HARD — bắt buộc, infosec review trước merge)

- **cwd = workspaceRoot**, validate `isAbsolute`; **không** nhận `cwd`/shell từ payload UI.
- **Shell binary cố định** (`$SHELL` hoặc default theo nền tảng), arg array rỗng → không command-injection phía sidecar; `data` ở `terminal.write` là byte opaque đẩy vào stdin PTY, shell tự diễn giải.
- **Strip env nhạy cảm trước `pty.spawn`**: xoá `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, và mọi key khớp `/(_TOKEN|_KEY|_SECRET)$/i` — shell tương tác **không** được `echo` ra token (invariant #1).
- **Cap số PTY/session** + idle-kill để tránh shell mồ côi.
- PTY **không persist** (chết theo sidecar) — đúng restart-safe invariant; scrollback mất khi restart (chấp nhận ở MVP).

## Phương án đã cân nhắc

- **Read-only command log (không PTY)** — chỉ stream lại lệnh agent chạy. Không cần dep mới, an toàn nhất, nhưng không phải terminal tương tác user yêu cầu. → từ chối (đã chốt PTY với user).
- **Tự cuốn pseudo-terminal qua `child_process` + pipe** — không có cấp phát TTY thật → nhiều CLI (vim, top, prompt màu) hỏng. → từ chối.
- **Renderer tự viết thay xterm** — phi thực tế, xterm là chuẩn de-facto (Claude Code, VS Code dùng). → từ chối.
- **Tách terminal ra service riêng / WebSocket** — vi phạm "no new backend service" + "no port public". → từ chối.

## Hệ quả

- **Tích cực:** terminal tương tác đầy đủ trong workspace; tái dùng stdio IPC + emit sẵn có; không service/port mới.
- **Tiêu cực / Trade-off:**
  - `node-pty` là **native module** → cần prebuild/build cho macOS/Windows/Linux và **bundle cùng Node runtime** ([ADR 0007](0007-bundle-node-runtime.md) nếu có) — ảnh hưởng CI/release. Dynamic import giảm rủi ro runtime nhưng không xoá rủi ro build.
  - Tăng bề mặt bảo mật (spawn shell tuỳ ý) → bắt buộc infosec review + env-strip.
  - xterm là UI dep lớn (~) → tăng bundle size.
- **Việc cần làm tiếp:**
  - `pnpm add node-pty` (sidecar) + `pnpm add @xterm/xterm @xterm/addon-fit` (ui); chạy checklist dependency ([.claude/rules/security.md](../../.claude/rules/security.md)).
  - Verify native build trong pipeline bundle sidecar runtime.
  - Gọi agent `infosec` + skill `security-audit` trên diff terminal trước merge.

## Tham chiếu

- [docs/features/workspace-panel.md](../features/workspace-panel.md) — feature spec
- [ADR 0017](0017-git-manager-ipc-contract.md) — convention RPC per-command + workspaceRoot
- [ADR 0018](0018-mcp-secret-keychain.md) — pattern dynamic import native module + graceful fallback
- [.claude/rules/security.md](../../.claude/rules/security.md) — 8 invariant
