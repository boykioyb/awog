# Feature — Session background exec + reactive wake

> ADR: [0066](../decisions/0066-session-background-exec-and-wake.md). Runtime: [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md). Bối cảnh vì sao cần: xem phần "Bối cảnh" của ADR.

## Mục tiêu

Cho phép model trong một **Session** chạy lệnh shell **dài** ở chế độ nền và **được đánh thức** để tiếp tục khi lệnh xong — thay cho hành vi hiện tại (Bash one-shot cap 600s, không có background, model confabulate "sẽ được báo khi xong" rồi turn chết).

Hai primitive:
- **A. Background exec** — `Bash(run_in_background:true)` + tool `BashOutput`. Chạy detached, ghi kết quả ra đĩa, poll theo yêu cầu.
- **B. Reactive wake** — khi tiến trình nền exit, đánh thức session (notify-only mặc định, hoặc auto-continue theo toggle Settings).

**Không** phải Task/Workflow (đã có RunWorkflow cho pipeline nhiều phase). Đây là "chạy 1 lệnh nền rồi tiếp tục **chính session này**".

## IPC / contract

### Tool `Bash` (mở rộng)
Thêm param:
- `run_in_background?: boolean` (default `false`). `false` → **giữ nguyên** đường đồng bộ hiện tại (không đổi gì). `true` → detached, trả ngay.

Kết quả khi `run_in_background:true`:
```
{ shellId: "bg_<hex>", status: "running", command } // + text: "Chạy nền. Dùng BashOutput({shellId}) để xem tiến độ. Đừng chờ."
```

### Tool `BashOutput` (mới)
`BashOutput({ shellId })` → đọc `log` file tích luỹ + trạng thái:
```
{ shellId, status: "running" | "exited", exitCode: number | null, output } // output cap giống Bash (64KB)
```
Read-only (chỉ đọc file trong session dir) → **không** gate exec.

### Lưu trữ trên đĩa (restart-safe)
`~/.awog/sessions/<sid>/bg/<shellId>/`:
- `meta.json` — `{ shellId, command, pid, startedAt, sessionId }`
- `log` — stdout+stderr gộp (wrapper redirect)
- `exit` — chứa exit code, **chỉ xuất hiện khi lệnh xong** (wrapper `echo $? > exit`) → là tín hiệu "done" cho watcher.

### Event UI (mới)
- `session.background-started` — `{ sessionId, shellId, command }` → UI thêm chip bg-shell (running).
- `session.background-done` — `{ sessionId, shellId, command, exitCode, outputTail }` → UI cập nhật chip + (nếu notify-only) hiện card "Tiếp tục".

### Setting (mới, toàn cục)
`Settings → Sessions`: toggle `autoContinueOnBackground: boolean` (default `false`).
- `false` (notify-only) — bg xong → card + nút "Tiếp tục"; user bấm mới chạy turn kế.
- `true` (auto-continue) — bg xong + session idle → tự `startSystemTurn`.

## User flows

### Flow 1 — Model chạy build nền (happy path, notify-only)
1. User: "build docker image rồi smoke-test". Session mode `execute` (hoặc user duyệt Bash ở `ask`).
2. Model gọi `Bash({ command:"docker build …", run_in_background:true })` → trả `{ shellId:"bg_ab12", status:"running" }`. Chip "bg_ab12 • running" hiện ở session. Model kết thúc turn ("Build đang chạy nền, tôi quay lại khi xong").
3. (Có thể) model gọi `BashOutput({shellId:"bg_ab12"})` giữa chừng để xem log — vẫn `running`.
4. Build xong (exit 0). Card hiện: "Build bg_ab12 xong (exit 0)" + nút **Tiếp tục**.
5. User bấm **Tiếp tục** → `startSystemTurn` inject `Background shell bg_ab12 exited (code 0). Output: …` → model tiếp tục smoke-test.

### Flow 2 — Auto-continue (toggle bật)
Như Flow 1 nhưng bước 4→5 tự động: session idle + `autoContinueOnBackground:true` → sidecar tự chạy turn kế ngay khi có file `exit`, không cần bấm.

### Flow 3 — Bg xong trong lúc turn khác đang chạy
1. bg_ab12 đang chạy; user gửi tin nhắn mới → turn T2 chạy.
2. bg_ab12 exit giữa T2 → completion **buffer** (không steer mid-turn).
3. T2 kết thúc → áp chính sách idle: auto → wake turn cho bg_ab12; notify → card.

### Flow 4 — Restart giữa build
1. bg_ab12 running; user tắt app.
2. Mở lại: `bg-registry` reload `meta.json`. Nếu build vẫn sống (pid alive) → resume watcher. Nếu `exit` đã ghi trước khi tắt → xử lý như done. Nếu pid chết (OS kill khi tắt máy) → chip "bg_ab12 • exited-unknown", `BashOutput` trả tail log + `exitCode:null`; model re-check thủ công.

## Acceptance Criteria

- **AC1 (background exec):** Given session mode execute, When model gọi `Bash(run_in_background:true)` với lệnh chạy ~30s, Then tool trả ngay (<1s) `{shellId,status:'running'}`; turn kết thúc mà lệnh **vẫn chạy**; `~/.awog/sessions/<sid>/bg/<shellId>/log` tăng dần.
- **AC2 (không dính cap 600s):** Given lệnh nền chạy > 600s, When chờ, Then KHÔNG bị `SIGKILL` ở mốc 600s (cap chỉ áp đường đồng bộ); chạy tới khi tự xong.
- **AC3 (BashOutput):** Given bg_x đang chạy, When model gọi `BashOutput({shellId:'bg_x'})`, Then trả output tới thời điểm hiện tại + `status:'running'`; sau khi xong → `status:'exited'` + đúng `exitCode`.
- **AC4 (wake notify-only):** Given `autoContinueOnBackground:false` + session idle, When bg_x exit, Then hiện card + nút "Tiếp tục"; session **không** tự chạy; bấm "Tiếp tục" → turn mới với context exit code + output; model tiếp tục kế hoạch.
- **AC5 (wake auto):** Given `autoContinueOnBackground:true` + session idle, When bg_x exit, Then session **tự** chạy turn kế (message tag `origin:'system'`) không cần bấm.
- **AC6 (single-turn invariant):** Given turn T đang chạy, When bg_x exit, Then KHÔNG mở turn thứ 2 song song; completion buffer, xử lý khi T xong.
- **AC7 (restart-safe):** Given bg_x running, When restart app trong lúc build còn sống, Then chip vẫn hiện; `BashOutput` đọc lại được log; khi build xong (dù qua restart) → wake/notify đúng.
- **AC8 (budget):** Given auto-continue bật, When nhiều bg xong liên tiếp, Then số wake-turn/session bị **cap** (budget guard) — không loop vô hạn đốt token.

## Edge cases

- Lệnh nền exit **ngay lập tức** (vd sai lệnh, exit 127) → `exit` xuất hiện gần như tức thì → wake/notify với exitCode ≠ 0; model xử lý lỗi.
- `BashOutput` với `shellId` không tồn tại (bịa/đã cleanup) → trả lỗi mềm "unknown shellId", không crash.
- Session **không có project / cwd = home** (no-project session) → bg exec vẫn chạy với cwd = home (như Bash đồng bộ); `<dir>` vẫn trong `~/.awog/sessions/<sid>/bg/`.
- User **xoá session** khi còn bg chạy → kill process group + cleanup `<dir>`.
- bg cũ đã done nhưng chưa ai đọc, rồi user reload → chip "exited", card "Tiếp tục" vẫn còn (persist completion tới khi user hành động hoặc xoá).
- Nhiều bg chạy đồng thời → cap số bg shell/session (chốt ở Open questions); vượt cap → tool báo "đạt giới hạn tiến trình nền".
- Session bị `abortSession` (user cancel turn) trong lúc có bg → bg **không** bị cancel (nó độc lập turn); chỉ turn dừng. (Cần nút kill bg riêng ở chip.)
- Wake turn gặp permission-park (bg xong, auto-continue, model gọi tool cần duyệt ở mode ask) → park như turn thường; card gate hiện bình thường.

## File chạm (dự kiến)

**Sidecar:**
- `runtime/tools/bash-tool.ts` — thêm `run_in_background` branch (detached + wrapper + đăng ký registry).
- `runtime/tools/bash-output-tool.ts` — **mới**.
- `sessions/bg-registry.ts` — **mới** (manifest, watcher `exit` file, reload-on-startup, pid probe, cleanup).
- `methods/sessions.send-message.ts` — factor turn-core → `startSystemTurn(sessionId, injectedPrompt, {origin})` gọi được nội bộ.
- `runtime/run-stream.ts` — đăng ký `BashOutput` tool; đảm bảo `Bash` nhận param mới.
- `runtime/prompts.ts` — mô tả `run_in_background` + `BashOutput` + "session sẽ được wake".
- `sessions/store.ts` / `types/shared.ts` — `origin` trên message; (nếu cần) list bg shells cho UI.
- `settings` (get/set) — `autoContinueOnBackground`.
- Budget guard — áp cap wake-turn/session.

**ui-next:**
- `stores/sessions.ts` — subscribe `session.background-started`/`.done`; state bg shells per-session; action "Tiếp tục" → gọi turn.
- `components/session/…` — chip bg-shell (running/exited/exited-unknown + kill), card "Background xong · Tiếp tục".
- `components/session/SessionDetail.vue` — render message `origin:'system'` phân biệt.
- Settings page — toggle `autoContinueOnBackground` (mục Sessions).
- i18n `sessions` / `settings`.

## Phân pha

- **P1 — Background exec (A). ✅ Done (2026-07-24).** `Bash.run_in_background` + `bg-registry.ts` (detached **subshell** wrapper, manifest, log/exit file, reload-on-startup, pid probe, TTL sweep, list/kill) + `BashOutput` tool + `BACKGROUND_EXEC_PROMPT`. RPC `sessions.backgroundList`/`backgroundKill`. UI: `SessionBackgroundChips.vue` (running/exited/interrupted + stop) + store events + hydrate. **Chưa** wake: turn kết thúc, model poll `BashOutput` / user poke thủ công. Smoke-test PASS (live running → exited + exit code + output). **Gotcha đã fix:** wrapper phải là subshell `( … )` — brace group `{ … }` chạy trong shell hiện tại nên `exit N` trong lệnh model giết wrapper trước khi ghi exit file (→ 'exited-unknown').
- **P2 — Reactive wake (B). ✅ Done (2026-07-24). RENDERER-DRIVEN** (không factor `startSystemTurn` ở sidecar — session vốn renderer-driven, xem ADR cập nhật). Store `ui-next/stores/sessions.ts`: `pendingWakes` (theo engineId) + `maybeAutoContinue` (auto-continue khi setting ON + idle; hook vào `drainQueue` để flush khi turn bận xong) + `continueFromBackground`/`dismissBackgroundWakes` (card) + latch `autoWakeStarting` chống double-turn khi 2 bg xong gần đồng thời + clear card khi turn mới bắt đầu. Card `SessionBackgroundWakeCard.vue` (chỉ hiện ở notify-only). Toggle `autoContinueOnBackground` ở Settings→Sessions (default OFF). Reuse 100% `sendMessage` pipeline. Prompt inject = `[background task finished]` + output tail.
- **P3 — Polish (còn lại).** Render wake message dạng `origin:'system'` (hiện đang là user bubble), cap số wake-turn/session (chống loop token khi auto), i18n rà soát, edge-case còn lại.
- **infosec** — pass bắt buộc trước release (detached exec + auto-continue loop + đọc log path-sanitize).

## Open questions

1. **Cap số bg shell đồng thời/session?** Đề xuất: 4 (khớp scheduler cap của Task engine).
2. **Cap số wake-turn/session (auto-continue)?** Đề xuất: dựa budget guard ADR 0057; thêm cap cứng vd 10 wake/session/giờ để chặn loop.
3. **TTL cleanup `<dir>`?** Đề xuất: xoá bg dir khi done + đã surface > 24h, hoặc khi session xoá.
4. **Message wake hiển thị thế nào?** Card riêng vs message `origin:'system'` inline trong transcript — chốt ở P2/P3 khi làm UI.
5. **Auto-continue có nên bật được per-session** (override toggle global) không? YAGNI cho v1 — chỉ global; mở lại nếu có nhu cầu.
