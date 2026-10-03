# 0093 — AWOG CLI Attach: shim ống-byte qua unix socket thay vì spawn-process từ xa

- **Trạng thái:** Proposed
- **Ngày:** 2026-09-29
- **Người quyết định:** kyro (chốt hướng "native terminal" = phase 2), devin (phác thảo)

## Bối cảnh

Pane CLI embedded ([ADR 0092](0092-session-cli-mode.md)) render PTY bằng xterm.js **trong renderer Electron**: mọi `terminal.data` đi qua IPC → repaint Chromium, scrollback nằm trong heap renderer, TUI redraw full-screen tốn CPU. Người dùng hỏi "có cách nào dùng terminal native của máy" — tức đưa *bề mặt hiển thị* ra ngoài Electron, dùng Terminal.app/iTerm2/tmux quen thuộc ([spec](../features/awog-cli-attach.md)).

Ràng buộc định hình:

- Giá trị lõi của CLI mode nằm ở **shared transcript + busy-gate + importer** — một phương án "mở terminal ngoài rồi thôi" (osascript `do script`, sentinel file) mất exit-event, mất detach, mất link registry, và kéo credential env ra khỏi sidecar vào process người khác viết.
- Sidecar chỉ có **stdio JSON-RPC** với Electron — chưa có kênh nào cho process ngoài. Bất kỳ shim nào cũng phải trả "giá nhập cảng" là một transport thứ hai.
- Remote-gateway đã chứng minh mô hình "stream `terminal.data` cho subscriber xa" chạy được trên chính registry PTY này.

## Quyết định

1. **Shim `awog session attach` là ống byte thuần** (PTY-bridge), KHÔNG phải spawn-process-từ-xa: sidecar giữ nguyên `terminalManager` PTY `cli:` (binary resolver, pinned env, `links`, `onExit`→importer), shim chỉ forward `stdin`→`terminal.write`, `terminal.data`→`stdout`, `SIGWINCH`→`terminal.resize`. Về bản chất shim là *renderer thứ hai* của cùng PTY — kế thừa toàn bộ gate và lifecycle đã kiểm chứng, phần mới chỉ là transport + per-connection subscription.
2. **Transport thứ hai = unix domain socket** `~/.awog/engine.sock` (Windows: named pipe), cùng codec JSON-RPC, song song stdio. Discovery qua `~/.awog/engine.endpoint` (chmod 600) chứa socket path + `engineToken` random mỗi boot — token phân biệt engine mới/cũ sau crash và ngăn gọi RPC linh tinh cùng-UID; KHÔNG coi là tuyến phòng thủ chống same-UID attacker (trust model của Docker socket).
3. **`awog session cli <id> --print` là mức rẻ không-socket**: in lệnh resume đúng (kể cả `CODEX_HOME`) để user tự chạy — không gate không attach, chấp nhận vì lệnh resume đúng hiện chỉ AWOG biết. Đây là lối cắt nhỏ phase 2 nếu socket chưa kịp làm.
4. Detach mặc định **giữ PTY sống** (giống đóng pane embedded — composer vẫn khoá, transcript vẫn sync được); `--detach-kills` là opt-in.

## Phương án đã cân nhắc

- **Shim tự spawn agent CLI trên TTY của mình** (`sessions.openExternalCli` trả `{bin,args,env,cwd}`): process thật sự sống ngoài sidecar, nhưng (a) credential env phải trao qua socket ra process khác — nới phạm vi rò rỉ token so với pinned-PTY, (b) cần kênh push ngược để "Ngắt CLI" từ app giết được process không-thuộc-sidecar, (c) phải reinvent exit-notify để importer chạy. Lợi ích duy nhất là process sống sót qua engine restart — không đủ đền.
- **Nút "Mở trong Terminal.app"** (`osascript do script "cd … && claude --resume …"` + sentinel file bắt exit): rẻ nhất nhưng mất attach-model — không busy-gate đáng tin (không biết khi nào đóng), không detach, không chọn được emulator của user. Ghi nhận là fallback thủ công: `--print` cho cùng kết quả mà không giả vờ có integration.
- **Daemon AWOG độc lập** (engine sống kể cả khi app đóng → attach bất cứ lúc nào): đúng đích xa nhưng là một quyết định lifecycle riêng (thay đổi ai-sở-hữu PTY khi renderer không còn). Ghi vào "việc mở", không trộn vào ADR này.

## Hệ quả

- **Tích cực:** render/buffer rời Electron hoàn toàn khi dùng shim; toàn bộ security posture của ADR 0092 (pinned env, remote containment, busy-gate) được kế thừa vì PTY vẫn thuộc sidecar; socket transport mở đường cho mọi client ngoài sau này (IDE plugin, CI notify…).
- **Tiêu cực / Trade-off:** thêm một đường vào engine → thêm mặt audit (RPC surface qua socket phải siết ngay từ đầu — whitelist method, không mở `fs.*`/credential methods cho shim); PTY vẫn tốn tài nguyên ở sidecar (nhỏ — buffer ring + process, không render); shim trên conhost cũ của Windows hạn chế (khuyên Windows Terminal).
- **Việc cần làm trước khi Accepted→implement:** chọn ngôn ngữ shim (Node script vs single-file binary), whitelist method trên socket, quyết `--detach-kills` semantics với `terminal.detach`.

## Tham chiếu

- [Spec: awog-cli-attach](../features/awog-cli-attach.md)
- [ADR 0092](0092-session-cli-mode.md) — CLI mode embedded: registry/importer/gate mà shim tái dùng
- [ADR 0019](0019-pty-terminal-in-sidecar.md) — PTY trong sidecar (giữ nguyên — shim không đổi ownership)
- Remote gateway (`sidecar/src/remote/`) — tiền lệ "terminal.data cho subscriber xa" mà socket subscription bắt chước
