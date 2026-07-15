# ADR 0064 — Session ↔ SSH link + agent SSH tools

- **Trạng thái:** Accepted
- **Ngày:** 2026-07-15
- **Liên quan:** [ADR 0063](0063-ssh-manager-ssh2-runtime.md) (SSH runtime — **ADR này ĐẢO một invariant của nó**), [ADR 0055](0055-session-task-link.md) (Session↔Task link — pattern mirror), [ADR 0030](0030-subagent-task-tool.md) (in-process agent tool), [security.md](../../.claude/rules/security.md)

## Context

Đã có SSH Manager (ADR 0063) và Sessions (agent chat, Pi SDK runtime). Người dùng muốn **liên kết 2 chiều**:
- **Chiều B (SSH → Session):** từ một SSH host mở một session agent "về" host đó để nhờ agent hỗ trợ.
- **Chiều A (Session → SSH):** agent trong session **chạy lệnh + đọc/ghi file** trên host remote.

Đây là mở rộng lớn, chạm runtime + **bảo mật** (LLM chạy lệnh trên máy remote).

## Decision

**Mô hình link** (mirror ADR 0055 Session↔Task):
- Thêm `Session.aboutSshHostId?` (session gắn 1 SSH host). Chiều ngược (host → sessions) derive client-side.
- Chiều B: action "Open in session" trên host → `createForSshHost(hostId)` (clone `createForTask`), điều hướng `/sessions`. Chip header trong `SessionDetail` (clone `.aboutbar`).
- Mỗi turn inject `<linked_ssh_host>` (tên, `user@host:port`, folder/tags) — `sessions/linked-ssh-host.ts` mirror `linked-task.ts`, append sau block linked_task.

**Chiều A — agent SSH tools** (`runtime/tools/ssh-tools.ts`, shape như `mcp-tools.ts` synthTool, push top-level ở `run-stream.ts` như `RunWorkflow`):
- `ssh_exec({ command })` → `sshManager.exec(connId, cmd)` (channel headless, cap 5MB/60s sẵn có).
- `ssh_read_file`/`ssh_list_dir` → SFTP read/list.
- `ssh_write_file` → SFTP write.
- **connId:** tái dùng kết nối live (`sshManager.list()` khớp hostId); nếu chưa có → **headless-connect variant mới** của SshManager (`establishChain` KHÔNG `openShell`, không emit `ssh:data`). Target host = `session.aboutSshHostId`.

**Bảo mật (bắt buộc):**
1. **Đảo invariant ADR 0063** ("SSH không expose ra model tool"). Chấp nhận có kiểm soát; **cần infosec pass** trước release.
2. **Permission gate `beforeToolCall`** (`runtime/permission.ts`): **cả 4 SSH tool đều gated** theo `sshApprovalMode`. `ssh_exec` + `ssh_write_file` (mutating) thêm bị chặn ở plan mode; `ssh_read_file` + `ssh_list_dir` (read) cũng gated ở `prompt`/`session` (user chốt 2026-07-15 — read có thể exfil file remote nhạy cảm lên model) nhưng vẫn chạy được ở plan mode (hỗ trợ điều tra). Đường park/RPC (`session.permission-request` + `sessions.permission`) tái dùng nguyên.
3. **Per-session approval mode** `Session.settings.sshApprovalMode: 'prompt' | 'session' | 'auto'` (default `prompt`), luồng như `autoApprove`:
   - `prompt` — duyệt từng lệnh (park + `SessionGateCard`).
   - `session` — duyệt 1 lần/host/tool rồi nhớ trong session (`allowSessionTool`/`isSessionToolAllowed`).
   - `auto` — chạy ngay (cảnh báo rõ ràng ở UI khi bật).
4. **Host-key:** headless connect **KHÔNG auto-accept** key lạ (giữ TOFU) → fail, yêu cầu user Connect 1 lần trong UI SSH trước. Secret không bao giờ lộ cho agent (chỉ sidecar). Budget guard (`withTurnBudget`) chống agent spam.
5. SFTP local path vẫn `assertInsideHome`.

## Consequences

- (+) Agent vận hành server thật (debug, deploy, đọc log) ngay trong session; và từ SSH nhờ agent.
- (+) Tái dùng toàn bộ hạ tầng: SshManager/SFTP, permission park, linked-entity pattern, SessionGateCard.
- (−) Surface bảo mật lớn (LLM → remote exec) → gate bắt buộc + infosec + default `prompt`.
- (−) Cần headless-connect variant + thread thêm 1 session setting qua nhiều lớp.

## Cập nhật 2026-07-15 — Unify sang mô hình MCP dùng chung (đảo hướng host-scoped)

User chốt: SSH tool **không nên gắn cứng 1 host/session** (Attach thừa) mà là **capability dùng chung** — vì trên path Claude-SDK nó vốn đã là in-process MCP `awogssh` (secret vẫn trong sidecar, KHÔNG phạm invariant #1 — lý do "MCP phạm #1" chỉ đúng với server NGOÀI).

Thay đổi:
- **Host là tham số per-call.** Thêm `ssh_list_hosts` (liệt kê host id/name/user@host, không gate). `ssh_exec`/`ssh_read_file`/`ssh_list_dir`/`ssh_write_file` nhận `host` (id). Cores (`runSsh*`) giữ nguyên (vẫn theo hostId).
- **Đăng ký ở MỌI session khi có host cấu hình** (`listHosts().length>0`) — cả Pi (`run-stream.ts`) lẫn Claude-SDK (`buildSshToolsSdkServer(terminalConnId?)`). Không còn gate theo `aboutSshHostId`.
- **Gate key theo `host` arg** (`permission.ts` đọc `context.args.host`) thay vì host cố định của session. `ssh_terminal_run` (dock) không có host arg → key theo tên.
- **Bỏ Attach picker** khỏi `SessionConfigPopover` (thừa). `aboutSshHostId` giờ chỉ còn để inject `<linked_ssh_host>` (context hint) + dock set nó.
- **Dock co-pilot giữ nguyên:** vẫn thêm `ssh_terminal_run` bind `sshTerminalConnId` (lái terminal đang xem) — đây là phần KHÔNG stateless được.
- **Follow-up (P2 discovery):** hiện "SSH" built-in trong Sources + opt-in qua whitelist MCP (hiện chưa làm — tool đang bật khi có host).

## Phân pha
- **P1** — `aboutSshHostId` end-to-end (sidecar schema + `<linked_ssh_host>` + UI store/chip/menu). Chiều B, chưa exec. ✅ Done.
- **P2** — `ssh-tools.ts` + headless connect + permission gate + `sshApprovalMode`. Chiều A. + infosec. ✅ Done.
- **P3** — UI: selector approval-mode per-session (`SessionDetail`, AppSelect 3 mode + cảnh báo `auto`), context-menu "Open linked session (N)" trên host. ✅ Done.
- **P4 (Attach host)** — gắn/gỡ host vào session ĐANG CÓ (không chỉ "Open in session" tạo mới): `SessionConfigPopover` tab General có AppSelect (None + hosts) → `sessions.setAboutSshHost(id, hostId|null)`; clear persist bằng `''` (buildUpsert gửi field khi `!== undefined` → sidecar patch xoá). Tool xuất hiện/biến mất từ turn kế. ✅ Done.

### Alternatives considered — SSH → MCP bridge (DEFERRED)
Cân nhắc mô hình mỗi host thành một MCP source (dùng lại Connections/whitelist, đa host/session). **Bỏ** vì: (a) *external* ssh-mcp server phải đưa credential ra ngoài sidecar → **vi phạm invariant #1**; (b) gate MCP generic (trust + allowedMcpPatterns) thô hơn `sshApprovalMode` (3-mode + read/mutate + plan-block + TOFU nối `/ssh` known_hosts) → phải port lại hết hoặc regress bảo mật; (c) dễ đẻ subsystem SSH thứ 2 song song `/ssh`; (d) đa-host/session hiếm cần cho chat (fleet = địa hạt Task/Workflow). Kích hoạt lại CHỈ khi có nhu cầu đa-host thật, và khi đó làm **in-process, tái dùng SshManager + port gate SSH** (mở rộng bridge `awogssh`), không cắm server ngoài.

## Infosec pass (2026-07-15) — PASS, không HARD-BLOCK

Audit surface LLM → remote exec/write. 8 invariant AWOG PASS (secret không rời sidecar, host-key headless fail-closed, gate đặt trước short-circuit + fail-closed, `ssh_exec` không shell-concat, không SSRF/eval, hostId path-sanitize, agent tools không chạm local FS). Đã fix ngay trong P2/P3:
- **F2 (MEDIUM):** `session`-mode allowlist key theo `(sessionId, hostId, toolName)` (trước chỉ `(sessionId, toolName)` → duyệt host A carry sang host B khi re-link). Fix: thread `sshHostId` vào `makeBeforeToolCall`, key = `${toolName}@${hostId}`.
- **F3 (LOW):** `ssh_write_file` thêm cap 5MB (parity read cap).
- **F6 (INFO/UX):** ẩn nút "Always allow" cho SSH tool ở mode `prompt` (nó no-op vì gate keys off `sshApprovalMode`).

**Đã xử lý:**
- **F1 (MEDIUM) — RESOLVED (user chốt 2026-07-15):** gate luôn `ssh_read_file`/`ssh_list_dir` ở `prompt`+`session` (auto vẫn free, plan vẫn cho read). Đưa cả 4 tool vào `SSH_GATED_TOOLS`, tách `SSH_MUTATING_TOOLS` cho plan-mode block.

**Còn mở / documented (không block):**
- **F4 (LOW):** `auto` + không set budget → exec remote không giới hạn số call/turn (mỗi call vẫn cap 60s, tuần tự). Cùng posture với Bash auto-approve. Khuyến nghị đặt default `budget.maxToolCalls` khi bật `auto`.
- **F5/F8 (LOW/INFO):** `ensureConnId` tái dùng connection interactive (có thể trust lỏng hơn nếu user tự tắt strictHostKey); output lệnh remote gửi lên provider — trong biên tin cậy user đã link + duyệt.

**F7 — RESOLVED (2026-07-15):** SSH tool giờ chạy CẢ 2 runtime. Claude SDK path (provider `anthropic`) cầu nối 4 tool qua in-process SDK MCP server `awogssh` → `mcp__awogssh__ssh_*` (`runtime/claude-sdk/ssh-sdk-server.ts`, mirror `source-sdk-server.ts`). Cores (`runSshExec/List/Read/Write`) tách ra ở `ssh-tools.ts` dùng chung Pi + SDK. Gate `permission.ts` khớp cả tên bare lẫn dạng bridge (`sshToolName` match `__<tool>` suffix) → `sshApprovalMode` quản cả 2 path y hệt (KHÔNG để tool bridge lọt gate). `session`-mode key theo BARE name nên Pi + SDK share 1 allowance/host.
