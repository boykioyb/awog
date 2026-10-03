# AWOG CLI Attach — `awog session attach <id>` trong terminal native bất kỳ

> Một binary `awog` chạy được trong **mọi terminal native** (Terminal.app, iTerm2, tmux, Alacritty…) — `awog session attach <sessionId>` mở phiên CLI của session AWOG ngay trong TTY thật, với đầy đủ busy-gate / linked resume / transcript import như pane embedded. Render + buffer rời hẳn Electron.

- **Trạng thái:** Đề xuất (phase 2), chưa implement
- **Ngày:** 2026-09-29
- **Phạm vi (dự kiến):** `apps/desktop/sidecar` (socket transport thứ hai, RPC external-cli) + binary `awog` (package mới hoặc script đi kèm desktop app) + docs cài đặt PATH
- **Quyết định kiến trúc:** [ADR 0093](../decisions/0093-awog-cli-attach.md)
- **Tiền đề:** [Session CLI Mode](session-cli-mode.md) / [ADR 0092](../decisions/0092-session-cli-mode.md)

## Vì sao cần

Pane CLI embedded ([spec](session-cli-mode.md)) render bằng xterm.js trong renderer Electron — mọi byte PTY đi qua IPC rồi repaint trong Chromium, scrollback 10k dòng nằm trong heap renderer. Khi người dùng chỉ muốn "một terminal thật của máy" (quen phím, tmux, iTerm…), chi phí đó là thừa — process vẫn chạy trong sidecar còn phần nặng nhất (render/buffer) bám theo Electron.

Mục tiêu: **cùng một PTY `cli:` của sidecar, thêm một "renderer" bên ngoài** — native terminal của user — mà không phải xây lại registry/importer/busy-gate.

## Mô hình: shim là ống byte (PTY-bridge)

```
Terminal.app/iTerm2/tmux
  └─ awog session attach <id>          (shim: stdin raw + SIGWINCH)
       │  unix socket ~/.awog/engine.sock
       ▼
  sidecar: sessions.attachCli          (RPC mới — kiểu terminal.attach có gate)
       └─ terminalManager PTY `cli:<sessionId>`   (y hệt pane embedded)
            └─ claude --resume <sdkSessionId>
```

Shim **không** spawn agent CLI và cũng không nhận credential env — nó chỉ:

1. Connect unix socket, gọi `sessions.attachCli {sessionId, kind?, cols, rows}`.
2. `stdin` → raw mode → mọi byte → `{type:'write', data}`; `SIGWINCH` → `{type:'resize', cols, rows}`.
3. Event `terminal.data` của terminalId đó → ghi thẳng `stdout`; `terminal.exit` → in thông báo, restore terminal, thoát.
4. Ctrl+] hoặc `~.` (chọn 1 escape) = detach local: đóng socket — PTY bên sidecar **tiếp tục sống** (pane embedded vẫn thấy, composer vẫn khoá) hay tuỳ flag `--detach-kills`.

Toàn bộ phần khó đã có từ CLI mode: resolve binary + resume args + env credentials (`cli-registry`), `links` map + busy-gate `sendMessage`, `onExit` → `importCliTranscript`, remote-egress containment. Shim chỉ là **một subscriber khác của `terminal.data`** — chính là mô hình remote-gateway đang dùng để stream terminal ra thiết bị ghép cặp, nay áp vào socket local.

## Phụ thuộc lớn nhất: transport thứ hai cho sidecar

Sidecar hôm nay là child process **stdio JSON-RPC** của Electron — không ai khác nói chuyện được. Shim cần một kênh tới engine đang sống:

- **Unix domain socket** `~/.awog/engine.sock` (Windows: named pipe `\\.\pipe\awog-engine`), server chạy song song stdio, cùng tập JSON-RPC method.
- **Discovery:** file `~/.awog/engine.endpoint` (chmod 600) ghi socket path + `engineToken` random mỗi boot → shim đọc, trình token trong handshake đầu. Token tồn tại để phân biệt engine mới/cũ khi socket file còn sót sau crash, và chặn script linh tinh cùng-UID gọi RPC — nó KHÔNG phải tuyến phòng thủ chống same-UID attacker đọc file (mô hình trust như Docker socket / LSP).
- **Quan hệ instance:** AWOG desktop là single-instance → một socket là đủ. Engine restart → shim thấy socket chết, báo rõ và thoát (PTY phía sidecar cũng đã chết theo `engine.crashed` semantics).

## Surface

### CLI (binary `awog`)

| Lệnh | Việc |
|---|---|
| `awog session attach <id> [--kind claude|codex] [--detach-kills]` | Attach PTY `cli:` của phiên vào TTY hiện tại |
| `awog session cli <id>` | Alias ngắn của `attach` |
| `awog session cli <id> --print` | **Mức rẻ nhất, không cần socket:** in ra lệnh resume đúng (`claude --resume …` / `codex resume …` kèm `CODEX_HOME`) để user tự chạy — đọc `~/.awog` trực tiếp, không gate, không import (user tự chịu trách nhiệm) |

Phân phối: desktop app bundle script `awog` + mục Settings "Install CLI to PATH" (`~/.awog/bin/awog`, gợi ý export PATH như `claude`/`devin` làm).

### RPC (phía sidecar, qua socket)

| Method | Params | Trả về | Ghi chú |
|---|---|---|---|
| `sessions.attachCli` | `{sessionId, kind?, cols, rows}` | `{terminalId, linked}` | Tái dùng `cli-registry.spawnCli` — cùng gate với `openCli` (busy, provider, kind) + re-check TOCTOU |
| `terminal.write` | `{terminalId, data}` | — | Method sẵn có, chạy trên `cli:` id |
| `terminal.resize` | `{terminalId, cols, rows}` | — | Sẵn có |
| `terminal.detach` | `{terminalId}` | — | Giữ PTY sống, chỉ ngắt subscription của shim |

Event `terminal.data` / `terminal.exit` flow qua socket cho đúng subscription đó — server socket cần per-connection subscription table (khuôn `sc.onEvent` của renderer).

## Bảo mật

- **Credentials KHÔNG rời sidecar** — khác phương án "shim tự spawn": env vẫn pin vào PTY bên trong sidecar; shim chỉ thấy byte output (đã là L1 untrusted, đi qua `redactString` nếu qua `read_terminal`… stream socket là raw — ghi rõ shim là bề mặt tin cậy cùng-UID như pane embedded).
- Socket dir `~/.awog` chmod 700 sẵn có; endpoint file chmod 600; token bắt buộc trong frame đầu.
- `attachCli` kế thừa mọi gate của `openCli` — shim không có đường vòng nào.
- Remote gateway **không** thay đổi: `cli:` vẫn tường hoá egress — shim local là kênh duy nhất lấy được byte CLI ra ngoài renderer, và nó vẫn ở trên chính máy.

## Giới hạn / không làm

- **Không** stream PTY qua mạng — socket local-only; attach từ máy khác (SSH vào máy chạy AWOG thì `ssh -t … awog attach` vẫn chạy được vì shim vẫn là process local).
- **Không** chọn terminal emulator giúp user — shim dùng đúng TTY nó được gọi trong.
- **Không** attach vào phiên Pi/không handle (cùng gate `openCli`).
- Detach-mà-giữ-PTY (pane embedded hiện cũng vậy — PTY sống tới khi `exit`/`Ngắt CLI`) là mặc định; `--detach-kills` là opt-in.
- Khi app AWOG đóng → engine chết → socket chết → shim thoát. Không có daemon độc lập (đó là phase xa hơn nữa).

## Việc mở

1. Socket server + endpoint discovery + handshake token (module `transport/` mới — tái dùng codec JSON-RPC hiện có).
2. Binary shim (Node script bundle hay Bun/Deno one-file? — quyết khi làm; cần raw-mode TTY + SIGWINCH, Node thuần làm được cả hai).
3. `sessions.attachCli` + per-connection event subscription.
4. Nút "Copy lệnh `awog`" trong ⋯ menu pane để giới thiệu shim; `--print` cho mức không-socket.
5. Windows named-pipe + raw-mode trên conhost (xterm sequences hỗ trợ từ Windows Terminal; cmd cũ thì khuyên dùng WT).
