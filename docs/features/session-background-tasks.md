# Feature — Session background exec + reactive wake

> ADR: [0066](../decisions/0066-session-background-exec-and-wake.md). Runtime: [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md). Bối cảnh vì sao cần: xem phần "Bối cảnh" của ADR.

## Mục tiêu

Cho phép model trong một **Session** chạy lệnh shell **dài** ở chế độ nền và **được đánh thức** để tiếp tục khi lệnh xong — thay cho hành vi hiện tại (Bash one-shot cap 600s, không có background, model confabulate "sẽ được báo khi xong" rồi turn chết).

Hai primitive:
- **A. Background exec** — `Bash(run_in_background:true)` + tool `BashOutput`. Chạy detached, ghi kết quả ra đĩa, poll theo yêu cầu.
- **B. Reactive wake** — khi tiến trình nền exit, đánh thức session (notify-only mặc định, hoặc auto-continue theo toggle Settings).

**Không** phải Task/Workflow (đã có RunWorkflow cho pipeline nhiều phase). Đây là "chạy 1 lệnh nền rồi tiếp tục **chính session này**".

> Phần dưới mô tả thiết kế của runtime **Pi**. Nhánh Claude SDK có cơ chế khác — xem [mục cuối tài liệu](#nhánh-claude-sdk--background-trong-phạm-vi-turn-2026-08-15).

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
- `session.background-done` — `{ sessionId, shellId, command, exitCode, outputTail, read, wake }` → UI cập nhật chip + (nếu notify-only) hiện card "Tiếp tục". `wake:false` = runtime tự nối lại turn (nhánh Claude SDK) nên renderer **không** được bắn turn thứ hai; `read:true` = model đã cầm kết quả rồi.
- `session.background-read` — `{ sessionId, shellId }` → model vừa đọc kết quả của một shell **đã xong** (`BashOutput`); chip thành công tự rút lui.

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
- **P3a — Vòng đời chip + parity 2 runtime. ✅ Done (2026-08-16).** Strip chip trước đây chỉ mọc thêm, không bao giờ bớt (registry giữ shell đã exit để `BashOutput` còn đọc được, TTL 24h chỉ quét lúc boot). Hai luật mới, áp **chung cho cả hai runtime**:
  - **Chip xong + model đã đọc thì rút lui** — `read` flag trên `BgShellState`; `readBackground()` bật cờ khi shell **đã settle** (đọc lúc đang chạy chỉ là poll tiến độ, không tính) và emit `session.background-read`; store bật thêm cờ khi wake được tiêu thụ (`markWakesRead` — output đã nằm trong prompt). **Chip lỗi thì giữ** (exit ≠ 0 / interrupted): đó mới là cái đáng quay lại. Boot reload coi shell đã exit từ process trước là `read` (cờ chỉ nằm trong RAM) để restart không dựng lại đống chip của hôm qua.
  - **Từ 2 chip trở lên thì gộp** — `SessionBackgroundChips.vue` hiện một chip summary `2 đang chạy · 1 lỗi`, bấm mới bung danh sách (mặc định đóng, reset khi đổi session). Một chip thì hiện thẳng.
  - **Parity nhánh Claude SDK** — bg-registry nhận thêm lớp *external* (`registerExternalBackground`/`settleExternalBackground`/`settleAllExternalBackground` + `setExternalKiller`): [claude-sdk/run-stream.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts) mirror việc nền của CLI vào **cùng** registry nên UI đọc **một** danh sách và vẽ **cùng** bộ chip dù session chạy runtime nào. Đăng ký theo tín hiệu **level** `background_tasks_changed` (chỉ task CLI thật sự đẩy xuống nền mới lên chip — subagent foreground đã nằm trong transcript rồi), settle theo edge `task_notification` (`completed`→exit 0, `failed`→exit 1, `stopped`→interrupted) với `read:true, wake:false`. Nút stop route qua `sessions.backgroundKill` → registry → `Query.stopTask` vì chỉ CLI mới dừng được task của nó; `finally` của turn settle nốt task còn treo (process CLI chết theo turn).
- **P3b — Polish (còn lại).** Render wake message dạng `origin:'system'` (hiện đang là user bubble), cap số wake-turn/session (chống loop token khi auto), edge-case còn lại.
- **infosec** — pass bắt buộc trước release (detached exec + auto-continue loop + đọc log path-sanitize).

## Open questions

1. **Cap số bg shell đồng thời/session?** Đề xuất: 4 (khớp scheduler cap của Task engine).
2. **Cap số wake-turn/session (auto-continue)?** Đề xuất: dựa budget guard ADR 0057; thêm cap cứng vd 10 wake/session/giờ để chặn loop.
3. **TTL cleanup `<dir>`?** Đề xuất: xoá bg dir khi done + đã surface > 24h, hoặc khi session xoá.
4. **Message wake hiển thị thế nào?** Card riêng vs message `origin:'system'` inline trong transcript — chốt ở P2/P3 khi làm UI.
5. **Auto-continue có nên bật được per-session** (override toggle global) không? YAGNI cho v1 — chỉ global; mở lại nếu có nhu cầu.

## Nhánh Claude SDK — background trong phạm vi turn (2026-08-15)

Nhánh Anthropic ([ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md)) không dùng bg-registry: Bash/Task là built-in của CLI. Trước bản này mọi việc nền ở đó **chết im lặng**, và vì tool `Task` của CLI **mặc định `run_in_background: true`** nên subagent mặc định rơi vào bẫy — transcript ghi nguyên văn *"The agent is running in the background and will notify me when it completes, so I'll wait for the result"* rồi turn kết thúc, không bao giờ có gì thêm.

**Nguyên nhân gốc** nằm ở SDK, không phải CLI: `query()` đặt `isSingleUserTurn = typeof prompt === 'string'`, và với single-turn nó **đóng stdin ngay khi `result` đầu tiên về** (`sdk.mjs`: *"First result received for single-turn query, closing stdin"*) → process CLI bị hạ, subagent nền chết giữa chừng, `system/task_notification` không bao giờ được gửi. Đây là chỗ duy nhất `isSingleUserTurn` được đọc trong SDK.

**Cách chữa** — [claude-sdk/run-stream.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts):

| Thành phần | Cách làm |
|---|---|
| Input stream | `openClaudePrompt()` luôn trả **async generator** (không bao giờ trả string): yield message của turn rồi `await` một promise. Stdin chỉ đóng khi AWOG gọi `close()` — quyền quyết định turn kết thúc lúc nào thuộc về AWOG |
| Theo dõi việc nền | `system/background_tasks_changed` là tín hiệu **level** (thay nguyên set); `task_started`/`task_notification` là cặp bookend dự phòng. Set bắt đầu rỗng vì mỗi turn có process CLI riêng. Quyết định "có phải việc user đang chờ không" đọc từ **cờ `ambient` trong chính payload level** (CLI mô tả: *"tasks that are not activity … hosts should exclude them from activity indicators"*); danh sách `task_type` (`local_bash`/`local_agent`/`local_workflow` vs ambient) chỉ còn là **fallback** cho task học từ edge `task_started` (edge không mang cờ) hoặc CLI cũ. Type lạ mà không có cờ → `log.warn` một lần/turn (chống trôi từ vựng CLI, xem bug 2026-08-17 bên dưới) |
| Điều kiện đóng | **Chỉ `session_state_changed: idle` mới đóng** — CLI định nghĩa đây là *authoritative turn-over signal* (phát sau khi held-back result flush **và** vòng lặp bg-agent thoát). `result` KHÔNG phải turn-over: nó chỉ arm timer settle 4s (mọi message sau đó huỷ timer) khi không còn task nào phải chờ, còn task sống thì **park** — tiếp tục đọc stream, model được CLI đánh thức và phần trả lời tiếp theo chảy vào **cùng turn đó**. Chỉ nhận `idle` **sau** khi đã thấy `result` của turn này: CLI vừa resume phát `session_state_changed: running` trước cả `init`, và một báo cáo idle sớm sẽ đóng stdin ngay đầu turn |
| Bật tín hiệu idle | `session_state_changed` **chỉ được phát khi có env `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`** — [shared.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/shared.ts) `buildSdkEnv()` đặt cờ này. Thiếu nó thì nhánh xử lý `idle` là code chết (đo trên CLI 2.1.261: không cờ ⇒ không có message nào; có cờ ⇒ `running` trước `init`, `idle` sau `result`) |
| Không cắt ngang tool call | `closeInput` **hoãn** khi còn `tool_use` chưa có `tool_result`, và bắn ngay khi call cuối trả lời. Chỉ abort (user cancel) và lúc stream kết thúc mới `force`. Backstop 5 phút cho call không bao giờ trả lời. Đây là mấu chốt: đóng stdin dưới chân một call đang bay chính là cách sinh ra "denial ảo" |
| Van an toàn | Cap cứng 15 phút (hoặc `budget.maxWallclockMs`) để task treo không giữ session lock mãi — cap bắn thì **`Query.stopTask()` từng task còn sống** rồi để notification dẫn tới `idle` theo đường thường, chỉ khi 15s sau vẫn chưa xong mới đóng thẳng; grace 45s khi task cuối settle mà CLI không đánh thức model (task ambient/`skip_transcript`, task fail); abort → đóng ngay; `finally` luôn đóng |
| Nút stop | `perTaskStopAffordance: true` trong Options — AWOG có chip stop thật (`SessionBackgroundChips` → registry → `Query.stopTask`). CLI fail-closed khi thiếu khai báo: interrupt sẽ **giết sạch task nền**; có khai báo thì cancel chỉ kết thúc turn hiện tại |
| UI | Adapter map `task_started`/`task_progress`/`task_notification` → **một step upsert theo `task_id`** (`bgtask-<id>`), nên subagent nền hiện ra trong lúc chạy thay vì biến mất sau một dòng Task đã 'done'. Label/`subagent_type` nhớ theo `task_id` xuyên các bookend vì `task_notification` chỉ mang `summary` |
| Một row duy nhất (2026-08-17) | Step của background task **key theo `tool_use_id` đã launch nó**, không phải `task_id`. Vì step con của subagent mang chính `tool_use_id` đó ở `parentId`, nên key trùng ⇒ **list step con + log tiến độ + kết quả nằm CHUNG một row** (trước đó tách 2 row: row `Agent` giữ step con, row `Background task` giữ progress). Kèm đó, tool_result của tool bị đẩy xuống nền chỉ là *launch ack* (`Async agent launched successfully`, `Command running in background with ID …`) nên bị bỏ qua, khỏi ghi đè row. **Phân biệt nền/foreground:** subagent foreground phát y hệt `task_started`/`task_progress`/`task_notification`, chỉ KHÁC là không có trong tín hiệu level ⇒ run-stream gọi `adapter.markBackgroundTask(taskId)` từ level, adapter mới dám ghi chữ "Background"; row foreground vẫn kết thúc bằng tool_result (report thật) như trước, chỉ được thêm log tiến độ lúc đang chạy. Task còn chạy mà turn kết thúc → `settleBackgroundRow` đóng row (`error` + lý do) thay vì để spinner treo trong transcript đã persist |
| Nội dung row (2026-08-17) | Bung row ra xem được việc nền đang làm gì, không còn echo lại đúng cái label. **Subagent:** log tiến độ từ `task_progress` (`description` mỗi tool call, giữ 12 dòng cuối) + dòng thống kê `last_tool_name · N tool calls · thời gian · token`, kết thúc thì thêm `summary`. **Shell:** detail kiểu `terminal` với output thật — `task_notification.output_file` lúc xong, và **live trong lúc chạy** vì CLI KHÔNG phát `task_progress` cho shell: path lấy từ tool_result của Bash nền (*"Output is being written to: …"*), run-stream poll tail mỗi 5s, adapter bỏ qua tail không đổi nên không spam step. Đọc file qua [task-output.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/task-output.ts): chỉ tail 4KB (step được persist), và path phải thoả CẢ BA — basename đúng `<taskId>.output`, nằm trong thư mục `tasks/`, realpath thư mục nằm trong `os.tmpdir()`/`/tmp`/`~/.awog` (macOS: `/tmp` là symlink → `/private/tmp`, phải realpath cả hai đầu mới so được) |

### Bug 2026-08-17 — sai từ vựng `task_type` ⇒ tool call bị "cancelled" giữa turn

Danh sách waitable ban đầu viết theo tên **tự đặt** (`subagent`/`shell`/`workflow`/`agent`/`bash`) nhưng CLI phát tên khác: `local_bash`, `local_agent`, `local_workflow` (xác nhận trên CLI 2.1.218). Không tên nào khớp ⇒ `waitingCount()` **luôn 0** ⇒ nhận `result` là đóng stdin ngay trong khi việc nền còn chạy.

stdin đó cũng là **control stream** chở callback hook `PreToolUse`. Đóng nó ⇒ mọi tool call còn lại của turn trả về `toolDenialKind: "cancelled"` kèm câu mặc định của CLI *"The user doesn't want to take this action right now. STOP what you are doing…"* ⇒ subagent tưởng hệ thống lỗi và bịa ra *"Xin lỗi, hệ thống có vấn đề tạm thời"* thay vì trả findings; main agent sau khi được đánh thức cũng mất sạch tool. Chip P3a cũng không bao giờ hiện (`registerExternalBackground` gate cùng set đó).

Sửa: dùng đúng từ vựng CLI + `log.warn` khi gặp type lạ. Kiểm chứng: turn không có việc nền vẫn đóng ngay tại `result` (không chờ thêm), turn có Bash nền thì park → continuation gọi tool bình thường → 0 denial ảo.

### Bug 2026-09-06 — tái phát: đóng stdin sớm ⇒ vẫn "denial ảo"

Từ vựng `task_type` đã đúng, nhưng "denial ảo" quay lại. Bằng chứng (session `260903-swift-bay-sgg` đối chiếu `~/Library/Logs/@awog/*/main.log`): **mọi** tool call dính câu canned đều nằm SAU dòng `claude-sdk closing input`, trong khoảng trống giữa lúc đóng và lúc turn thật sự kết thúc — 4/4 lượt (cap 00:21:05 → turn end 00:22:16; cap 00:41:26 → 00:42:13; `turn complete` 01:42:12 → 01:42:49; `turn complete` 09:24:48 → 09:25:57).

Hai nguồn đóng sớm, cả hai đều là hệ quả của việc coi `result` là turn-over:

1. **Cap 15 phút.** Task nền không bao giờ settle (điển hình `npm run dev` — dev server chạy mãi) ⇒ cap luôn bắn ⇒ giật stdin trong khi CLI vẫn đang làm việc.
2. **`result` đến sớm với `waitingCount() === 0` vì task nền là *orphan của process CLI lượt trước*.** AWOG spawn một process CLI mỗi lượt rồi `resume`, nên lượt kế CLI báo *"No completion record was found for this background shell command from the previous session"* và tự restart/notify task đó. Task ấy chưa nằm trong `background_tasks_changed` của process hiện tại tại thời điểm `result` ⇒ đóng stdin ⇒ vài giây sau model bị đánh thức và mọi tool call của continuation trả về canned text.

Nhánh xử lý `session_state_changed: idle` viết từ 2026-08-15 **chưa từng chạy**: message đó bị gate sau env `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`.

**Giải mã câu canned (CLI 2.1.261):** `"The user doesn't want to take this action right now…"` được trả kèm `toolDenialKind: "cancelled"` **chỉ khi** `signal.reason === "background"` (đường checkpoint/adopt của CLI). Trên nhánh này một denial thật chỉ có thể đến từ gate PreToolUse của AWOG (luôn kèm `res.reason`) hoặc hook của project (có message riêng) ⇒ đúng chuỗi này **không bao giờ** là user từ chối. Họ hàng: `[Request interrupted by user]`, `[Request interrupted by user for tool use]`, `[Tool call did not complete: the turn was ended…]`, `[Tool call skipped: the turn ended…]` — 4 câu này đã trung thực nên giữ nguyên.

**Sửa:** đóng theo `idle` (+ bật env) · không đóng dưới tool call đang bay · cap thì `stopTask` trước · `ambient` thay danh sách hardcode · khai `perTaskStopAffordance` · adapter viết lại câu canned trước khi vào transcript ([event-adapter.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/event-adapter.ts) `rewriteCancelledContent`). **Lưu ý phạm vi:** viết lại chỉ đổi thứ **user** thấy — tool_result do CLI đúc bên trong subprocess nên **model vẫn đọc câu gốc**; chống confabulation phải dựa vào việc không đóng sớm nữa.

**Giới hạn:** background sống trong phạm vi **một turn**, không sống qua turn như Pi (bg-registry ghi ra đĩa, restart-safe). Sidecar chết giữa chừng = mất việc nền. Muốn parity đầy đủ phải giữ process CLI ngoài vòng đời turn — việc lớn hơn nhiều, cần ADR riêng. **Parity ở đây là parity hiển thị** (P3a): cùng chip, cùng luật ẩn/gộp, cùng nút stop — vòng đời bên dưới vẫn khác vì primitive khác nhau.

**Tasks (workflow node) thì ngược lại:** node là one-shot, không có chỗ để park, nên [claude-sdk/invoke.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/invoke.ts) ép `Task` về đồng bộ qua `forceForegroundSubagent` + `makeForegroundOnlyHook` và nói rõ ràng buộc bằng `NO_BACKGROUND_PROMPT` ([shared.ts](../../apps/desktop/sidecar/src/runtime/claude-sdk/shared.ts)).
