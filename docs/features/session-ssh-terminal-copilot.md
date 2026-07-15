# Feature — Session ↔ SSH "lái terminal" (co-pilot trong màn SSH)

- **Trạng thái:** P1–P3 built (typecheck/lint/build xanh; chờ QA runtime Electron)
- **Ngày:** 2026-07-15
- **Liên quan:** [ADR 0064](../decisions/0064-session-ssh-link.md) (Session↔SSH link — feature này mở rộng chiều A sang chế độ "visible terminal"), [ADR 0063](../decisions/0063-ssh-manager-ssh2-runtime.md) (SSH runtime), [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md) (PTY/terminal).

## Bối cảnh

Chiều A của ADR 0064 (đã build) cho agent chạy `ssh_exec`/SFTP qua **kết nối headless vô hình** — kết quả trả vào chat, user KHÔNG thấy lệnh chạy. Người dùng muốn thêm mô hình **"AI lái terminal của tôi"**: trong màn `/ssh`, mở một **session chat docked bên phải** cạnh terminal; agent **gõ/chạy thẳng vào terminal đang mở** để user xem live; có thể cho agent dùng **nhiều terminal** hoặc **ghim 1 terminal chỉ định**.

Quyết định đã chốt (2026-07-15):
- **Cách chạy:** agent **gõ thẳng vào PTY terminal đang mở** (không phải channel riêng), bắt kết quả bằng sentinel marker.
- **Quan hệ với headless:** **coexist theo ngữ cảnh** — trong `/ssh` (session docked) = lái terminal hiển thị; trong `/sessions` (Attach host) = headless (đã có).

## Mô hình

Mỗi tab SSH = 1 host; `WorkspaceTerminal` có thể nhiều pane, **mỗi pane = 1 shell = 1 `connId`**. Session docked được gắn với host + tập `connId` terminal của tab; agent thao tác trên `connId` **được chỉ định** (mặc định = terminal active của tab).

## Thiết kế theo pha

### P1 — Sidecar: chạy lệnh trong shell tương tác + capture (lõi enabler)
- `ssh/manager.ts`: `runInShell(connId, command) → { output, exitCode }`.
  - Chỉ chạy trên connection có `.stream` (shell tương tác); headless → throw (agent sẽ dùng đường headless riêng).
  - Ghi vào PTY: `command\n` rồi marker `printf '\n__AWOG_END_<nonce>_%d__\n' $?\n` (một cụm) → user thấy lệnh + output chạy **live**.
  - Tap **cùng** `stream.on('data')` đang emit `ssh:data`: gom buffer tới khi khớp regex marker → resolve `{ output (đã lược dòng lệnh echo + marker), exitCode }`. Cap 5MB / timeout 60s (như `exec`). Một `runInShell`/connId tại một thời điểm (queue/reject).
  - **Lọc dòng marker** khỏi chunk emit lên UI (user thấy sạch, không thấy dòng `__AWOG_END__`).
- `methods/ssh.run-in-shell.ts`: RPC (dùng nội bộ cho tool; validate connId + command).

### P2 — Agent tool "lái terminal" + coexist
- `runtime/tools/ssh-tools.ts`: thêm core `runSshTerminal(connId, command)` (gọi `runInShell`). Tool `ssh_terminal_run({ command })` bind sẵn `connId` mục tiêu.
- **Coexist resolve:** khi session có **terminal binding** (mở từ SSH workspace) → dùng `ssh_terminal_run` (visible). Khi chỉ có `aboutSshHostId` (Attach ngoài /sessions) → giữ `ssh_exec` headless. Thread `sshTerminalConnId(s)` qua send-message → run-stream (cả Pi + Claude-SDK bridge) như `aboutSshHostId`.
- Gate: dùng lại `sshApprovalMode` (visible-run là mutating → gated; `prompt` đặc biệt hợp vì user thấy trước lệnh).

### P3 — UI: session docked trong SshWorkspace + targeting
- `SshWorkspace.vue`: nút **"Open session"** trong `.sshx-tbar` (cạnh SFTP) → toggle `sessionOpen[tabId]`; thêm split phải `.sshx-tsession` trong `.sshx-tbody` (terminal trái | chat phải), mirror pattern SFTP (terminal luôn mounted, chỉ đổi flex-basis).
- Session bind: tạo/nối session `aboutSshHostId` = host tab + `sshTerminalConnId` = pane active; UI cập nhật target khi user đổi pane. **Targeting**: mặc định active terminal; cho **ghim** 1 terminal / **cho phép nhiều** (picker nhỏ trong panel).
- Chat component: tái dùng UI session hiện có (nhẹ) trong panel docked.

## Bảo mật
- Lái terminal = mutating → luôn qua `sshApprovalMode`. `runInShell` chỉ nhận `connId` của connection tương tác đang mở (user đã tự connect + trust host key ở `/ssh`) → không mở connection mới, không đụng TOFU headless.
- Secret không rời sidecar (chỉ ghi command vào PTY; không đụng credential). Cap output.

## Verify
- Sidecar `pnpm typecheck && build`; ui-next `typecheck && lint`.
- E2E (Electron thật): mở host → terminal → Open session → chat "chạy `uname -a`" → thấy lệnh gõ live vào terminal trái, output + exit trả về chat; đổi pane → target đổi; ghim terminal; lệnh tương tác (vim) → xử lý/né.
