# ADR 0066 — Session background exec + reactive wake

- **Trạng thái:** Accepted
- **Ngày:** 2026-07-24
- **Người quyết định:** hoatq (product owner) + Claude Code
- **Liên quan:** [ADR 0029](0029-migrate-llm-runtime-to-pi-sdk.md) (Pi runtime), [ADR 0055](0055-session-task-link.md) (RunWorkflow — spawn-and-return-immediately + link-back pattern để mirror), [ADR 0019](0019-pty-terminal-in-sidecar.md) (PTY — vì sao KHÔNG dùng), [ADR 0057](0057-session-budget-guard.md) (budget guard), [security.md](../../.claude/rules/security.md)

## Bối cảnh

Tool `Bash` của session ([runtime/tools/bash-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/bash-tool.ts)) là **one-shot đồng bộ**: `spawn('sh', ['-c', cmd])`, chờ `close`, capture output cap 64KB, **timeout tối đa 600s** rồi `SIGKILL`. Không có `run_in_background`, không có tool poll output, không có cơ chế **đánh thức session** khi tiến trình nền kết thúc.

Hệ quả quan sát thực tế: khi được yêu cầu chạy việc dài (vd `docker build`), model (Claude — training từ Claude Code, nơi `Bash run_in_background:true` **thật sự** re-invoke agent lúc lệnh exit) **giả định** nó có background exec. Nó nói *"Build chạy nền (ID …); tôi sẽ được báo khi xong"* rồi **kết thúc turn chờ một notification không bao giờ tới**. Turn đóng → session "gián đoạn". Lượt sau model phải tự dò lại trạng thái (`docker images …`) vì không biết build đã xong chưa. Đây là **confabulation do thiếu primitive**, không phải bug lẻ.

Thứ gần nhất đang có: `RunWorkflow` (ADR 0055) spawn một **Task** (workflow DAG) nền từ session và trả ngay — nhưng đó là pipeline nhiều phase trên Task engine, KHÔNG phải "chạy một lệnh shell nền rồi tiếp tục **chính session này** khi nó xong". `steering.ts` cũng không cứu được: steer chỉ tác động **giữa turn** (in-memory, keyed theo `messageId`, `enqueueSteer` trả `null` khi không còn turn sống) — turn đã đóng thì không có gì để steer.

Bài toán tách làm 2 primitive độc lập:
- **(A) Background exec** — chạy lệnh dài detached, không dính cap 600s, không block turn; poll output theo yêu cầu.
- **(B) Reactive wake** — khi tiến trình nền exit, **đánh thức session** để model tiếp tục kế hoạch.

## Quyết định

### A. Background exec — mở rộng `Bash` + tool `BashOutput`

1. **`Bash` thêm param `run_in_background?: boolean`** (default `false` → giữ nguyên hành vi one-shot hiện tại; **không đổi** đường đồng bộ). Khi `true`:
   - Spawn **detached** (`{ detached: true }`, tách process group) với `cwd = workspaceRoot`, env allowlist y hệt đường đồng bộ.
   - **Bọc wrapper ghi ra đĩa** thay vì buffer trong RAM: `sh -c '<cmd>; echo $? > <dir>/exit'` với `stdout+stderr` redirect vào `<dir>/log`. `<dir>` = `~/.awog/sessions/<sid>/bg/<shellId>/` (trong AWOG home, qua `assertInsideHome`).
   - **Không** dính `MAX_TIMEOUT_MS`/`SIGKILL` (đó là cơ chế của đường đồng bộ).
   - Trả **ngay**: `{ shellId, status:'running', command }` (mirror thông điệp RunWorkflow: "chạy nền, đừng chờ, dùng BashOutput để xem tiến độ").
2. **Registry per-session** (`sessions/bg-registry.ts`, mới): manifest `<dir>/meta.json` (`shellId`, `command`, `pid`, `startedAt`, `sessionId`) + watcher poll sự tồn tại của file `exit` (fs.watch + fallback poll) → khi có → đọc `exit` code + tail `log` → emit completion tới wake layer (B).
3. **Tool `BashOutput`** (`runtime/tools/bash-output-tool.ts`, mới): `BashOutput({ shellId })` → trả output tích luỹ (đọc `log`, cap giống Bash) + `status` (`running`/`exited` + exit code). Model chủ động poll khi cần; **read-only, không gate exec** (chỉ đọc file trong session dir).
4. **Restart-safe by construction:** vì exit code + output ghi thẳng ra đĩa, sidecar restart giữa chừng KHÔNG mất kết quả. Lúc khởi động, `bg-registry` **reload mọi `meta.json`**:
   - `exit` tồn tại → đã xong, giữ nguyên (chờ wake nếu chưa xử lý).
   - `exit` chưa có + `process.kill(pid, 0)` sống → resume watcher.
   - `exit` chưa có + pid chết (child detached bị OS kill khi máy tắt) → mark `exited-unknown`, tail `log`, để model re-check. (Đây là fail-mode duy nhất không tránh được — nhưng **có nhãn rõ ràng** thay vì im lặng như hiện tại.)

### B. Reactive wake — primitive `startSystemTurn` + chính sách notify/auto

Đây là phần mới hẳn: **sidecar tự khởi động một turn** (không do RPC user).

1. **Factor turn-core** khỏi `methods/sessions.send-message.ts` thành entry gọi được nội bộ: `startSystemTurn(sessionId, injectedPrompt, { origin:'background' })` tái dùng nguyên pipeline (context-builder, run-stream, permission gate, persist, emit). Message được **tag `origin:'system'`** để UI render phân biệt (không phải user gõ).
2. **Khi bg process exit** (từ A), wake layer đọc **chính sách** (mục dưới) + trạng thái turn (`isTurnActive`):
   - **Session idle:**
     - *notify-only* (default) → emit `session.background-done` (`shellId`, `command`, `exitCode`, tail output). UI hiện **card notification + nút "Tiếp tục"**; bấm → `startSystemTurn(...)`.
     - *auto-continue* → gọi thẳng `startSystemTurn(...)` với prompt injected kiểu `Background shell <id> exited (code N). Output:\n<tail>\nContinue your plan.`
   - **Session đang có turn chạy** → **buffer** completion vào hàng đợi per-session (KHÔNG steer mid-turn — tránh nhiễu + steering là Pi-only). Trong `finally` của turn hiện tại, nếu còn completion pending → áp lại chính sách idle (auto → wake turn kế; notify → surface card). Tôn trọng **single-turn invariant** (mỗi session 1 turn tại 1 thời điểm).
3. **Chính sách = toggle Settings toàn cục** `autoContinueOnBackground: boolean` (default `false` → **notify-only**). Đặt ở `Settings → Sessions`. Lý do chọn toggle (không hardcode 1 hành vi): auto-continue giống Claude Code nhất nhưng **tốn token khi user không để ý** + có thể bất ngờ; notify-only an toàn nhưng thêm 1 cú bấm. User chốt 2026-07-24: làm cả hai, default notify-only.

### C. Cập nhật system prompt

`runtime/prompts.ts`: mô tả `Bash.run_in_background` + `BashOutput` cho model, và note "session **sẽ** được đánh thức khi tiến trình nền xong" — để model dùng đúng primitive **thật** thay vì confabulate (giảm tải cho `confabulation-guard.ts`).

## Phương án đã cân nhắc

- **Dùng PTY terminal (ADR 0019) làm background runner** — model chạy build trong node-pty ở Workspace Panel rồi watch. **Bỏ:** PTY là kênh **tương tác cho người**, không có contract kết-quả-máy-đọc (exit code, output structured cho model); và không restart-safe (pty chết theo sidecar). Trộn 2 mục đích vi phạm SRP.
- **Reuse `RunWorkflow`/Task engine cho lệnh shell nền** — wrap mỗi lệnh thành 1 Task. **Bỏ:** Task = pipeline DAG nhiều phase, event-sourced, git auto-commit per node — quá nặng cho "chạy 1 lệnh". Và Task tách khỏi session (không "tiếp tục chính session này"). Over-engineering (YAGNI).
- **Steer mid-turn khi bg xong** — inject completion qua `enqueueSteer`. **Bỏ:** chỉ hoạt động nếu turn đang sống (đa số case bg xong lúc **idle** → `enqueueSteer` trả null); và steering Pi-only. Wake phải **tự bắt đầu turn**, không phụ thuộc turn sẵn có.
- **Auto-continue cứng (không toggle)** — luôn tự chạy tiếp. **Bỏ:** tốn token khi user không nhìn + bất ngờ; user chốt để toggle, default notify-only.
- **Buffer bg output trong RAM (như đường đồng bộ)** — **Bỏ:** không restart-safe, mất output nếu sidecar restart. Ghi đĩa (log + exit file) là điều kiện của restart-safety.

## Hệ quả

- **(+)** Model có primitive **thật** khớp mental-model Claude Code → hết confabulation "sẽ được báo khi xong". Việc dài (build/test/deploy) chạy nền, session tiếp tục đúng lúc.
- **(+)** Restart-safe by construction (kết quả ở đĩa) — kể cả app tắt giữa build, lượt sau đọc lại được exit code + output.
- **(+)** Tái dùng hạ tầng: turn pipeline, event bus `session.*`, permission gate, aborter registry, `assertInsideHome`.
- **(−)** Primitive mới `startSystemTurn` = turn **không do user khởi**: phải cẩn thận single-turn invariant + không auto-continue vô hạn (budget guard ADR 0057 bắt buộc áp cho wake turn). Cần cap số wake/session.
- **(−)** Child detached: phải quản lý orphan (manifest + pid probe) + **cleanup** (xoá `<dir>` khi session xoá / bg cũ quá hạn) để không rác `~/.awog/sessions/*/bg/`.
- **(−)** Surface exec mới (detached, chạy dài) → **infosec pass bắt buộc** trước release (dù chung posture execute-mode với Bash hiện tại).

### Việc cần làm tiếp
- Feature spec chi tiết: [docs/features/session-background-tasks.md](../features/session-background-tasks.md).
- ~~Chốt cap~~ ✅ chốt (P1): bg shell = **4**/session; TTL cleanup dir = **24h**. Cap wake-turn/session → chốt ở P2.
- Infosec pass: detached exec + auto-continue loop + đọc log file (path sanitize).

## Cập nhật 2026-07-24 — Wake là RENDERER-DRIVEN (đảo "startSystemTurn" ở Decision B)

Khi triển khai P2, bỏ ý tưởng factor `startSystemTurn` ra khỏi `sessions.send-message.ts` (~1300 dòng, refactor rủi ro cao). Lý do: **session vốn đã renderer-driven** — store ui-next tự lắp `settings`/`budget`/`history`/`mode` rồi gọi RPC `sessions.sendMessage`; KHÔNG có đường chạy turn headless ở sidecar. Nên wake làm ở **renderer**: store subscribe `session.background-done` (đã có sẵn từ P1), rồi theo setting `autoContinueOnBackground` mà (a) tự gọi `sendMessage` với prompt inject, hoặc (b) hiện card "Tiếp tục". Tái dùng 100% turn pipeline, 0 refactor sidecar. Seam `setBackgroundWakeHandler` (định cho sidecar-driven) đã **gỡ** (YAGNI). Đánh đổi: nếu app **thoát hẳn** thì không wake (bg detached vẫn sống, boot sau adopt + chip hiện 'exited'); chấp nhận — session là interactive, không headless.

## Trạng thái triển khai

- **P1 — Background exec: ✅ Done (2026-07-24).** `Bash(run_in_background)` + `BashOutput` + `sessions/bg-registry.ts` (detached subshell wrapper ghi `log`/`exit`, reload-on-boot, pid-probe orphan, per-session cap 4, TTL 24h, list/kill). Prompt `BACKGROUND_EXEC_PROMPT`. Event `session.background-started`/`.done`; UI chip (`SessionBackgroundChips.vue`) + RPC `sessions.backgroundList`/`backgroundKill`. Smoke-test PASS.
- **P2 — Reactive wake: ✅ Done (2026-07-24).** Renderer-driven (xem cập nhật trên). Store `ui-next/stores/sessions.ts`: `pendingWakes` + `maybeAutoContinue` (hook vào `drainQueue` khi idle+queue rỗng, + gọi ngay khi bg-done nếu idle) + `continueFromBackground`/`dismissBackgroundWakes` + latch chống double-turn (`autoWakeStarting`, xả khi placeholder push) + clear card khi turn mới bắt đầu. Card `SessionBackgroundWakeCard.vue` (notify-only). Setting UI `autoContinueOnBackground` (Settings→Sessions, default OFF=notify). Sidecar+UI typecheck/lint PASS. Chưa commit.
- **P3 (polish, còn lại):** render message wake dạng `origin:'system'` (giờ hiện như user bubble), cap wake-turn/session (chống loop token khi auto), i18n rà soát. **infosec** trước release.

**Bài học P1:** wrapper phải dùng **subshell `( … )`**, KHÔNG brace group `{ … }` — brace group chạy trong shell hiện tại nên `exit N` trong lệnh model giết luôn wrapper trước khi ghi exit code (smoke-test bắt được: status 'exited-unknown' thay vì exit 7).

**Race P2 đã xử:** dưới auto-continue, 2 bg xong gần như đồng thời có thể cùng lọt qua khe async trong `sendMessage` (nó `await` usage read TRƯỚC khi push placeholder streaming) → 2 turn. Fix: latch đồng bộ `autoWakeStarting` bắc cầu qua khe, xả ngay khi placeholder được push.

## Tham chiếu

- Feature spec: [session-background-tasks.md](../features/session-background-tasks.md)
- Pattern spawn-return-immediately + link-back: [ADR 0055](0055-session-task-link.md), [run-workflow-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/run-workflow-tool.ts)
- Bash hiện tại: [bash-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/bash-tool.ts)
- Turn lifecycle: [runner.ts](../../apps/desktop/sidecar/src/sessions/runner.ts), [steering.ts](../../apps/desktop/sidecar/src/sessions/steering.ts)
- Budget guard cho wake turn: [ADR 0057](0057-session-budget-guard.md)
