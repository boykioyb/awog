# Feature Spec: Mobile Remote Control (P1 — View + Send + Approve + Pairing)

> **P2 (2026-08-09):** steer/cancel/checklist/session-create + PWA parity đã code — xem
> [§P2](#p2--session-control--create-code-landed-2026-08-09-chờ-infosec-re-audit).
> Mở rộng allowlist ⇒ **infosec re-audit bắt buộc** trước release.
>
> **Status:** P1 code landed (2026-07-29) — chờ **infosec re-audit** + test chức năng end-to-end.
> Đã implement: Remote Gateway (F1–F8) + Settings→Devices UI + PWA (`apps/desktop/remote-pwa`);
> typecheck sạch. **Chưa chạy thử thật** (cần bật Tailscale + pair). Xem
> [§Yêu cầu bảo mật](#yêu-cầu-bảo-mật-release-gate--infosec-pre-review) cho điều kiện release.
> Nền: đã merge **infosec pre-review 2026-07-28** (không blocker kiến trúc).
> **Last updated:** 2026-07-28
> **ADR transport:** [ADR 0067](../decisions/0067-mobile-remote-control-transport.md) (đã CHỐT — spec này KHÔNG thiết kế lại kiến trúc).
> **Phạm vi tài liệu:** **CHỈ P1**. P2 (Steer/Cancel/Session-create) và P3 (Web Push/Audit log) = **ngoài phạm vi lần này** — xem [§Phạm vi](#phạm-vi-p1).

---

## Problem

Người dùng kick-off các session/task agent chạy dài trên desktop rồi rời bàn (đi họp,
di chuyển, việc vặt). Công việc **đứng lại tại các gate human-in-the-loop** —
permission park, plan mode, `AskUserQuestion`, approval gate của workflow — agent chờ,
wall-clock trôi vô ích, cho tới khi user quay lại đúng cái máy đó. Tín hiệu "away from
desk" hiện chỉ là tray/OS notification **không hành động được**: user không thể approve,
steer, hay trả lời từ điện thoại. Điều này bào mòn chính trụ cột human-in-the-loop — vì
"human in the loop" hôm nay thực chất là "human phải ngồi trước máy đó".

## Target user

- **Persona:** Solo orchestrator / power-user chạy các task AWOG nhiều phase và session
  agent dài, di chuyển nhiều trong ngày (commute, họp). Thứ cấp: team-lead nhỏ giám sát run.
- **Tần suất gặp problem:** Hằng ngày với người dùng nặng hay để run dài.
- **Workaround hiện tại:** Remote-desktop vào máy (VNC/TeamViewer/Tailscale + screen
  share) — nặng, UX cảm ứng tệ, mirror nguyên desktop, không có push; hoặc đơn giản là
  chờ đến khi về bàn.

## Why now

- **Tailscale/WireGuard** là mesh trưởng thành, phổ biến, user tự cài như app hệ thống →
  transport gần như miễn phí, khỏi tự dựng relay. (Độc lập VPN Manager ADR 0065 — xem
  §Dependencies.)
- **Session storage JSONL event-sourced (ADR 0062/0066)** → resume stream sau mạng
  chập chờn về cơ bản đã được giải quyết ở phía server.
- **ui-next là SPA (`ssr: false`)** → port PWA là tái sử dụng, không phải viết lại.
- **Background exec + wake (ADR 0066)** + tray status đã biến "away from desk" thành
  kịch bản hạng nhất; remote control là nửa còn thiếu: **input**.

## Hypothesis

Nếu user có thể approve gate / gửi follow-up / steer từ điện thoại qua tailnet của
chính mình, thì **thời gian idle tại các gate human-in-the-loop giảm mạnh** và các run
dài hoàn tất mà không cần user quay về máy. Đo bằng: % gate-wait được resolve từ mobile;
mức giảm median thời lượng gate-wait.

## Success criteria

- Từ điện thoại trên **4G (khác mạng desktop)** cùng tailnet, user có thể: mở session
  live, thấy transcript stream + todo + diff + cost, gửi message/follow-up, và
  approve/reject một gate (permission-park / plan / `AskUserQuestion`) — round-trip vài giây.
- Stream **resume không mất event** sau khi rớt mạng / app background ~30s (qua offset JSONL).
- Remote Gateway **không bao giờ bind interface public**: listener chỉ thấy trên IP
  tailnet, không phải `0.0.0.0`; scan từ mạng ngoài không thấy gì.
- **Không** API key / credential nào xuất hiện trong bất kỳ payload gửi xuống phone
  (invariant #1 giữ nguyên).
- Phone chỉ pair qua **device token tường minh**; revoke token trên desktop cắt truy cập
  của phone ngay lập tức.

## Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | Partial — remote surface phủ lên công việc artifact-driven; approve/inspect artifact từ phone, không đổi mô hình source-of-truth. |
| Workflow-based | Yes — unblock gate của workflow/task từ xa, cho phase DAG chạy tiếp. |
| Human-in-the-loop | **Yes (mạnh)** — gỡ ràng buộc "human phải ở máy"; biến loop thành độc lập vị trí. Đây là lý do biện minh cốt lõi. |
| Local-first | **Giữ nguyên** — desktop vẫn là brain; phone là control surface mỏng; không cloud, dữ liệu không rời các thiết bị của chính user; traffic ở trong mesh riêng tư. |

---

## Tóm tắt

P1 cho phép user, từ **điện thoại (PWA)** trên **cùng tailnet** với desktop (kể cả khi
phone đang ở 4G), làm 4 việc:

1. **Pair** thiết bị một lần bằng **QR** ở `Settings → Devices` (desktop hiện QR → phone
   quét → nhận device token). Xem danh sách thiết bị đã ghép và **revoke**.
2. **View** một session đang chạy: transcript stream live + todo + diff + cost.
3. **Send** message / follow-up vào session đó.
4. **Approve / Reject** 3 loại gate human-in-the-loop: **permission park**, **plan mode**,
   **`AskUserQuestion`**.

Điện thoại là **"một UI nữa"** đi qua đúng đường renderer hiện tại nhưng bằng transport
WebSocket: `phone ⇆ (tailnet) ⇆ Remote Gateway (Electron main) ⇆ engine.request ⇆ sidecar`.
Gateway **chỉ forward một allowlist tĩnh** các RPC nghiệp vụ; **không** mở raw fs/exec cho
phone. Toàn bộ nghiệp vụ tái dùng RPC + event stream có sẵn (không nhân đôi logic).

## Phạm vi (P1)

### Trong phạm vi lần này

| Nhóm | Nội dung |
|---|---|
| Pairing | QR pairing ở `Settings → Devices` (desktop generate, phone scan), device list, revoke. |
| View | Session list; session view live (transcript stream + todo + diff read-only + cost); trạng thái kết nối tailnet. |
| Send | Gửi message / follow-up (`sessions.send-message`). |
| Approve | Approve/Reject 3 gate: permission park (`sessions.permission`), plan mode (approve→execute), `AskUserQuestion` (`sessions.answer-question`). |
| Resume | Reconnect resume stream qua con trỏ offset JSONL (ADR 0062/0024). |
| Bind | Gateway bind **tailnet-only, fail-closed** (không thấy tailnet → không bind). |
| Opt-in | Công tắc **Remote control** ở `Settings → Devices` — **mặc định TẮT**; tắt = không bind cổng nào dù tailnet đang lên. |

### Ngoài phạm vi lần này (không đặc tả ở đây)

- **P2** — steer mid-turn (`sessions.steer`), cancel turn (`sessions.cancel`), tạo session
  mới, chọn agent/model, task approve-phase/rerun từ phone. *(Allowlist ADR 0067 đã liệt
  kê các method này nhưng P1 KHÔNG bật handler UI cho chúng.)*
- **P3** — Web Push wake-ping khi PWA nền/đóng; audit log hành động remote; device
  management nâng cao (đổi tên, giới hạn quyền per-device).
- Native iOS/Android app (P1 chỉ PWA).
- Relay/cloud tunnel; transport ngoài tailnet; multi-user/RBAC; filesystem write tùy ý /
  terminal PTY exec trực tiếp từ phone (chặn cứng ở allowlist — defense in depth).

---

## User flows

> Ký hiệu: **[D]** = màn hình desktop (ui-next); **[P]** = PWA trên phone.

### Flow A — Pairing lần đầu (golden path)

0. **[D]** User bật công tắc **Remote control** (mặc định TẮT). Trạng thái persist ở
   `~/.awog/remote-devices.json` (`{ enabled, devices }`); chỉ khi bật, main mới dò
   interface tailnet và bind. Tắt lại → `closeServer()` ngắt mọi socket đang mở ngay
   (tương đương revoke-all tạm thời, device token vẫn giữ) và `createPairing` bị từ chối.
1. **[D]** User mở `Settings → Devices`. Panel hiện **trạng thái tailnet**:
   - Nếu phát hiện interface tailnet → badge "Tailnet: connected" + IP tailnet của máy.
   - Nếu **không** phát hiện → banner fail-closed "Chưa thấy Tailscale — không thể ghép
     thiết bị" + CTA hướng dẫn cài (xem [Flow lỗi: chưa cài Tailscale](#edge--error--empty-state)).
2. **[D]** User bấm **"Pair new device"**. Desktop gọi tạo **pairing challenge** một lần
   (nonce + hạn ngắn, mặc định **≤ 2 phút**) và render **QR** chứa payload: `{ gatewayHost
   (IP tailnet), port, pairingCode một-lần, expiresAt }`. Modal hiện đồng hồ đếm ngược +
   **mã text fallback** để gõ tay.
3. **[P]** User mở PWA (URL = địa chỉ tailnet của desktop, đã bookmark hoặc gõ), chọn
   **"Scan to pair"**, quét QR (hoặc nhập mã tay).
4. **[P] → [D]** Phone gửi frame `pair` (kèm pairingCode + tên thiết bị do OS/phone cung
   cấp) tới gateway. Gateway verify code còn hạn + chưa dùng, phát hành **device token**,
   lưu **token phía desktop trong OS keychain** (token KHÔNG ghi ra file/git), tạo metadata
   thiết bị (id, label, platform, pairedAt).
5. **[D]** Danh sách Devices refresh: thiết bị mới xuất hiện (label, platform, "paired vừa
   xong", status online). Pairing code bị **đánh dấu đã dùng** (one-time).
6. **[P]** PWA lưu token cục bộ (storage của trình duyệt phone), chuyển sang màn session
   list — sẵn sàng dùng.

> **Không API key/credential nào** đi qua QR hay frame `pair`: QR chỉ chứa địa chỉ tailnet
> + mã ghép nối một-lần; device token do gateway phát hành và giữ ở desktop keychain.

### Flow B — Mở session + xem stream từ 4G

1. **[P]** Phone đang ở 4G (khác LAN với desktop) nhưng **cùng tailnet** (Tailscale lo NAT
   traversal / DERP). PWA mở → thanh trạng thái hiện "Tailnet: reachable".
2. **[P]** PWA gọi (qua WS, kèm token) `sessions.list` → hiện danh sách session, đánh dấu
   session đang có **turn active** / đang chờ **gate**.
3. **[P]** User chọn một session đang chạy. PWA gọi `sessions.get` với **con trỏ offset**
   (turn/offset đã thấy — lần đầu = 0) → gateway replay phần transcript đã có, rồi
   **subscribe** live event (`session.*`) của đúng session đó qua `engine.onEvent`.
4. **[P]** Transcript **stream** hiện dần (assistant text, steps, tool run). Song song hiện:
   **todo banner** (nếu turn đang chạy), **diff** (đọc qua `git.diff`/`git.status`), **cost**
   (`sessions.cost-breakdown`).
5. **[P]** Nếu tới một gate (permission/plan/question) → hiện **approval card** (xem Flow C).

### Flow C — Approve một permission gate từ phone

1. **[D/engine]** Trong session, agent gọi một tool cần duyệt (vd `Bash`, `Write`). Sidecar
   `beforeToolCall` **park** request → emit step gate → live event tới mọi client đang
   subscribe (renderer desktop **và** phone).
2. **[P]** PWA render **SessionInlinePermission card**: tên tool + tham số (input đã được
   sidecar chuẩn bị cho hiển thị), 2 nút **Allow** / **Deny** (+ tùy chọn "Always allow"
   nếu có suggestion).
3. **[P]** User bấm **Allow**. PWA gọi (qua allowlist) `sessions.permission` với
   `{ requestId, decision:'allow', alwaysAllow?, updatedInput? }`. Param **được sidecar
   re-validate ở biên** (zod) như mọi input L1.
4. **[engine]** `resolvePermissionRequest(requestId, result)` unpark → tool tiếp tục →
   turn chạy tiếp. Trả về `{ resolved: true }`.
5. **[P] + [D]** Cả hai client thấy gate biến mất (event step cập nhật) và transcript chạy
   tiếp. Nếu desktop đã resolve trước đó → `resolved:false`, card trên phone tự **dismiss
   như stale** (xem edge case concurrent approve).

> Plan mode: gate là step `kind:'plan'` (do `ExitPlanMode` terminate turn). Approve trên
> phone = chuyển session sang execute mode + kick run tiếp (đi qua đúng cơ chế approve-plan
> desktop dùng). `AskUserQuestion`: card có radio/checkbox + "Other"; submit gọi
> `sessions.answer-question` `{ requestId, answers }`.

### Flow D — Revoke device

1. **[D]** User mở `Settings → Devices`, chọn một thiết bị, bấm **Revoke** (confirm).
2. **[D/engine]** Desktop xoá device token khỏi keychain + đánh dấu metadata `revoked` +
   **đóng ngay WS đang mở** của thiết bị đó (nếu đang kết nối).
3. **[P]** PWA trên thiết bị bị revoke: WS đóng, mọi request tiếp theo bị gateway từ chối
   (token không còn hợp lệ) → PWA rơi về màn "Thiết bị đã bị thu hồi — cần pair lại".
4. **[D]** Danh sách Devices bỏ thiết bị đó (hoặc hiện trạng thái "revoked").

---

## Acceptance criteria

Viết theo **Given / When / Then**. ID để PM/QA tham chiếu.

### Pairing (`Settings → Devices`)

- **AC-PAIR-1.** Given panel Devices và tailnet đã connected, when user bấm "Pair new
  device", then desktop hiện một **QR** + **mã text fallback** + **đồng hồ đếm ngược** tới
  hạn (mặc định ≤ 2 phút).
- **AC-PAIR-2.** Given một QR đang hiện, when phone quét và gửi mã hợp lệ **trong hạn**,
  then gateway phát hành device token, thiết bị xuất hiện trong danh sách với label +
  platform + `pairedAt`, và phone chuyển sang màn session list.
- **AC-PAIR-3.** Given một pairing code đã được dùng một lần, when cùng code đó được gửi
  lại, then gateway **từ chối** (one-time) và không phát hành token thứ hai.
- **AC-PAIR-4.** Given một pairing code đã **quá hạn**, when phone gửi mã đó, then gateway
  từ chối với thông báo "mã hết hạn", và desktop cho phép generate mã mới.
- **AC-PAIR-5.** Given màn Devices, when có ≥ 1 thiết bị đã pair, then mỗi dòng hiện:
  label, platform, `pairedAt`, `lastSeenAt`, trạng thái online/offline, nút **Revoke**.

### Bind tailnet-only, fail-closed (invariant #6)

- **AC-BIND-1.** Given máy **có** interface tailnet (IP thuộc `100.64.0.0/10` /
  `fd7a:115c:a1e0::/48` hoặc IP interface Tailscale), when gateway khởi động, then listener
  **chỉ** bind vào IP tailnet đó, **không** `0.0.0.0` và **không** IP LAN/public.
- **AC-BIND-2.** Given máy **không** phát hiện interface tailnet, when gateway khởi động,
  then gateway **KHÔNG bind bất kỳ port nào** (fail-closed) và desktop hiện banner "Chưa
  thấy Tailscale — remote control tắt".
- **AC-BIND-3.** Given gateway đang bind IP tailnet, when scan port từ một máy **ngoài
  tailnet** (LAN thường / internet công cộng), then **không thấy** cổng nào của gateway mở.
- **AC-BIND-4.** Given gateway đang chạy, when interface tailnet **biến mất** (user tắt
  Tailscale), then gateway **ngừng nhận kết nối mới** và desktop cập nhật trạng thái tailnet
  = disconnected. *(Cách xử lý session WS đang mở lúc mất tailnet: xem Open question Q6.)*

### View + stream

- **AC-VIEW-1.** Given phone đã pair và tailnet reachable, when mở PWA, then thấy danh sách
  session (từ `sessions.list`), đánh dấu session có **turn active** và session **đang chờ gate**.
- **AC-VIEW-2.** Given user mở một session đang chạy, when PWA subscribe, then transcript
  **stream dần** (assistant text + steps) khớp với những gì desktop hiển thị cho cùng session.
- **AC-VIEW-3.** Given session view mở, then hiển thị đồng thời **todo banner** (khi turn
  đang chạy chưa xong), **diff** (read-only, qua `git.diff`/`git.status`) và **cost** (qua
  `sessions.cost-breakdown`).
- **AC-VIEW-4.** Given session đang stream trên phone, then diff/cost/todo cập nhật khi có
  event mới **mà không cần** user refresh thủ công.

### Send

- **AC-SEND-1.** Given một session đang mở trên phone, when user gõ và gửi message, then
  PWA gọi `sessions.send-message` và transcript hiện message của user + phản hồi agent
  stream về, y như gửi từ desktop.
- **AC-SEND-2.** Given user gửi message rỗng hoặc chỉ khoảng trắng, when bấm gửi, then PWA
  **không** phát request (chặn ở client) — không tạo turn rỗng.

### Approve 3 gate

- **AC-GATE-1.** Given session dừng ở **permission park**, when user bấm Allow trên phone,
  then PWA gọi `sessions.permission {decision:'allow'}`, gate được unpark, turn chạy tiếp,
  và card biến mất trên **cả** phone lẫn desktop.
- **AC-GATE-2.** Given session dừng ở **permission park**, when user bấm Deny trên phone,
  then tool bị từ chối (`behavior:'deny'`), agent nhận kết quả deny và tiếp tục/kết thúc
  turn theo logic hiện có.
- **AC-GATE-3.** Given session dừng ở **plan mode** (step `kind:'plan'`), when user Approve
  plan trên phone, then session chuyển execute mode và run tiếp; when user Reject, then
  session ở lại plan mode (không sửa file nào).
- **AC-GATE-4.** Given session dừng ở **`AskUserQuestion`**, when user chọn đáp án + Submit
  trên phone, then PWA gọi `sessions.answer-question {requestId, answers}`, park được
  resolve, và loop tiếp **cùng lượt** (mid-turn, không tạo turn mới).
- **AC-GATE-5.** Given một gate đã được resolve từ **desktop** trước đó, when phone gửi
  quyết định cho **cùng** `requestId`, then RPC trả `resolved:false` và card trên phone tự
  dismiss như stale (idempotent — không double-apply).

### Ràng buộc bảo mật (security — infosec pre-review 2026-07-28)

- **AC-SEC-1.** Given bất kỳ payload nào gateway gửi xuống phone (session get, event stream,
  cost, diff, danh sách), then **không** chứa API key / OAuth token / secret keychain /
  device token của thiết bị khác — kiểm bằng grep trên payload thực tế.
- **AC-SEC-2.** Given một frame WS từ phone, when tới gateway, then frame **phải** kèm
  device token hợp lệ (chưa revoke, chưa hết hạn) **và** method nằm trong **allowlist**;
  nếu không → gateway từ chối, **không** forward xuống sidecar.
- **AC-SEC-3.** Given phone gửi RPC không thuộc allowlist (vd `fs.write-file`, `terminal.*`,
  `settings.set`, `source.set-secret`), when tới gateway, then gateway **chặn cứng** tại
  biên, không đạt tới sidecar dispatch.
- **AC-SEC-4.** Given phone gửi param bất kỳ (vd `updatedInput` của permission,
  `answers` của question), when đi vào sidecar, then handler **re-validate** (zod) ở biên
  như nguồn L1 — param dị dạng bị reject, không crash loop.
- **AC-SEC-5.** Given user Revoke một thiết bị, when thiết bị đó có **WS đang mở**, then WS
  bị đóng **ngay lập tức** và mọi request tiếp theo của token đó bị từ chối (không cần chờ
  hết hạn token / không cần phone reconnect).
- **AC-SEC-6 (F1 — Critical).** Given origin remote gọi `sessions.sendMessage`, when gateway
  forward, then gateway **param-pick** (chỉ field cho phép, default-deny field lạ), **ép
  `autoApprove=false`**, **loại bỏ** `workspacePath`/`contextFolders`/`systemPrompt`/
  `instructions`/`history`, **pin** `accountId`/`provider`/`modelId` theo session server-side,
  và cwd chỉ đặt qua `projectId` (resolve server-side). Phone **không thể** tự đặt cờ
  `autoApprove` hay cwd tùy ý.
  > **Sửa 2026-08-30 (user chốt):** vế "phone không thể tắt permission gate" **KHÔNG còn
  > đúng**. Phone chọn được **cả 4 mode** như desktop, kể cả `execute` — mode này skip
  > permission park ở runtime, tức **có** tắt gate. Xem AC-SEC-6b.
- **AC-SEC-6b (mode parity — thay clamp F-1, 2026-08-30).** Given phone chọn mode ở composer
  hoặc session config, when gửi turn, then gateway forward đúng mode đó nếu nó thuộc
  `REMOTE_ALLOWED_MODES` = `ask`/`plan`/`accept-edits`/`execute`; chuỗi lạ ⇒ fallback `ask`.
  Given mode là `accept-edits` hoặc `execute`, then PWA **phải** hiện cảnh báo tại chỗ chọn
  (chip composer đổi màu warn/danger + hint trong sheet + hint dưới ô Mode ở config) vì tool
  sẽ chạy **không xin duyệt**.
- **AC-SEC-7 (F2 — High).** Given gateway stream event xuống phone, then chỉ forward
  **type trong allowlist** (`session.chunk/step/message.done/permission-request`, `task.*`
  tối thiểu) **và** chỉ event của session/task device **đang subscribe**; **chặn cứng**
  `auth.oauth-url`/`source.oauth-url`/`terminal.data`/`ssh:*`/`vpn:*` và event session khác.
- **AC-SEC-8 (F3 — High).** Given phone gọi `git.status`/`git.diff`/`git.log`, when có
  `workspaceRoot`, then gateway **ràng buộc `workspaceRoot` vào tập path project đã biết**
  (từ `projects.list` server-side) và reject path không khớp — không đọc repo tùy ý trên đĩa.
- **AC-SEC-9 (F4 — High).** Given gateway khởi động, then allowlist là **exact-match,
  default-deny**, và **mọi entry được validate vs registry thực** (fail-fast nếu tên method
  không tồn tại). Có unit test khóa danh sách allowlist.
- **AC-SEC-10 (F5 — High).** Given phát hiện interface tailnet, then dùng **định danh
  interface** (utun + xác nhận Tailscale, không chỉ CIDR `100.64/10`) **và** kiểm
  `socket.remoteAddress ∈ CIDR tailnet` **mỗi kết nối**; interface đổi (up/down) → re-verify,
  tuyệt đối không fallback `0.0.0.0`.

### Resume

- **AC-RES-1.** Given phone đang xem session live rồi **mất mạng ~30s** (background / đổi
  4G↔Wi-Fi), when kết nối lại và gửi con trỏ offset đã thấy, then gateway **replay phần
  event thiếu** (không trùng, không sót) rồi stream tiếp live.
- **AC-RES-2.** Given phone reconnect, then **không** xuất hiện event **trùng lặp** đã render
  trước khi rớt mạng (idempotent theo id/offset).

### Revoke

- **AC-REV-1.** Given thiết bị đã pair, when user bấm Revoke + confirm, then token bị xoá
  khỏi keychain, metadata đánh dấu revoked, và dòng thiết bị rời danh sách active.
- **AC-REV-2.** Given thiết bị bị revoke, when PWA của nó gọi bất kỳ RPC nào, then bị từ
  chối và PWA hiện màn "đã bị thu hồi — cần pair lại".

---

## Yêu cầu bảo mật (release-gate — infosec pre-review)

Nguồn: infosec pre-review 2026-07-28 trên ADR 0067 + code hiện tại. Kết luận: **không có
blocker kiến trúc**, nhưng đây là **điều kiện release BẮT BUỘC** — gap requirement, không
phải gap kiến trúc. **F1–F5 phải vào code P1**; F6–F8 fix-trước-release; F9–F10 backlog.

> **Re-audit implementation (2026-07-29):** F2–F8 verify PASS trong code. F1 phát hiện
> **residual Critical**: phone gửi `settings.mode:'execute'` → runtime skip gate TRƯỚC check
> `autoApprove` → RCE quay lại. **Đã vá:** gateway clamp remote mode về `ask`/`plan`
> (execute/accept-edits hạ cấp `ask`) → gate luôn bật; kèm hardening F-2 (cap+timeout unauth
> conn), F-3 (`maxPayload` 1MB), F-4 (lockout auth per-IP), F-6 (gate rpc tới khi validated),
> F-7 (strip `attachments.path`), F-8 (clear deviceId trước terminate). **Còn lại (backlog):**
> unit test khoá allowlist (cần test-runner — chưa có vitest ở apps/desktop), IPv6 tailnet,
> schema-validate store khi load. Re-audit hẹp lại F-1 path nên chạy lại sau khi test thật.

> **Nới F-1 theo quyết định user (2026-08-30):** clamp `ask`/`plan` **đã gỡ** —
> `REMOTE_ALLOWED_MODES` giờ gồm đủ 4 mode desktop. Lý do: phone thiếu `execute` so với
> desktop, user chốt ưu tiên parity hơn clamp. **Hệ quả cần ghi rõ:** một turn remote ở mode
> `execute` chạy Bash/Write **không có approval card** → RCE qua tailnet; `autoApprove:false`
> vẫn ép nhưng **không** chặn được vì `execute` short-circuit nằm trước cờ đó
> (`sidecar/src/runtime/permission.ts`). Phòng thủ còn lại: bind tailnet-only + fail-closed,
> toggle opt-in mặc định TẮT, pairing thiết bị, allowlist method, param-pick, rate limit (F8),
> cộng cảnh báo UI ở PWA (AC-SEC-6b). **infosec re-audit BẮT BUỘC trước release kế tiếp.**

| ID | Sev | Vấn đề | Fix bắt buộc | AC |
|---|---|---|---|---|
| **F1** | ⛔ Critical | Param của `sessions.sendMessage` (`autoApprove`/`workspacePath`/`systemPrompt`/`accountId`/`history`) cho remote **lái agent → RCE + đọc/ghi file toàn máy + tự tắt gate**. Allowlist tên method KHÔNG đủ. | Param-pick per-method (default-deny field lạ); ép `autoApprove=false`; cấm `workspacePath`/`contextFolders`/`systemPrompt`/`instructions`/`history`; pin account/model server-side; cwd chỉ qua `projectId`. ⚠ Phần "clamp mode về `ask`/`plan`" **đã gỡ 2026-08-30** theo quyết định user — xem AC-SEC-6b. | AC-SEC-6, AC-SEC-6b |
| **F2** | 🔴 High | `engine.onEvent` forward **global** → rò `auth.oauth-url` (state/PKCE), `terminal.data`, `ssh:data`, `vpn:*`, event **session khác** xuống phone. | Event egress allowlist theo **type** + lọc theo **subscription** của device; chặn cứng oauth/terminal/ssh/vpn + session không subscribe. | AC-SEC-7 |
| **F3** | 🔴 High | `git.status/diff/log` nhận `workspaceRoot` L1 tùy ý → đọc **mọi repo** trên đĩa từ 4G ("read-only" ≠ "scoped"). | Ràng `workspaceRoot` vào tập project đã biết (`projects.list` server-side); reject path lạ. | AC-SEC-8 |
| **F4** | 🔴 High | Tên method ADR dùng **gạch nối** nhưng registry là **camelCase** (`sendMessage`…); prefix/denylist sẽ fail-open (`sessions.upsert/delete/compact/rewind`). | Allowlist exact-match/default-deny; validate vs registry lúc boot (fail-fast); unit test khóa list; revoke **force-close WS**. | AC-SEC-9, AC-SEC-5 |
| **F5** | 🔴 High | Fail-closed bind cần nhưng **chưa đủ**: CIDR `100.64/10` cũng gặp ở 4G-tethering/carrier-NAT; và **mọi peer tailnet** reach được (tailnet chia sẻ, subnet-router, ACL sai). | Nhận diện interface theo **định danh** (utun+Tailscale API) không CIDR-only; kiểm `socket.remoteAddress ∈ tailnet` mỗi kết nối; xử lý race up/down. | AC-SEC-10, AC-BIND-* |
| **F6** | 🟡 Med | Pairing/token: entropy, at-rest, one-time, replay. | Token ≥128-bit CSPRNG, so sánh constant-time; lưu **hash** ở keychain (không plaintext/không log); QR mang **pairing-code one-time TTL 60–120s** (KHÔNG long-lived token — ảnh QR rò token); **auth-at-handshake** bind identity vào connection, KHÔNG token-mỗi-frame; rate-limit + lockout. | AC-PAIR-3/4, AC-SEC-5 |
| **F7** | 🟡 Med | Approve gate hủy hoại từ remote: `updatedInput` cho **rewrite arg** lúc duyệt; `alwaysAllow` tắt gate cả session. | Origin remote: **cấm `updatedInput`**; cấm/ẩn `alwaysAllow` hoặc confirm bậc cao; xét **destructive-tier typed-confirm** cho `Bash`/`fs.delete`/`git push`. (Payload gate đã gồm `input` verbatim → phone thấy đủ command — tốt.) | Q3 |
| **F8** | 🟡 Med | Remote spam `sendMessage`/`rerunPhase` → cháy tiền (vòng gọi model). | Budget per-device (max concurrent turns, turns/giờ, token/ngày); cap kích thước message + số connection/device; đảm bảo `cancel` luôn reachable. | Non-functional |
| **F9** | 🟢 Low | Transcript có thể chứa secret agent vô tình surface — nay rời máy qua 4G. | Residual, accept; cân nhắc redaction pass ở egress (F2). Không block. | — |
| **F10** | 🟢 Low | Web Push (post-MVP): VAPID = push bên thứ ba (lệch nhẹ local-first). | Notification chỉ "wake ping" opaque, **không** nội dung/command/secret; tách ADR riêng ở P3. | — |

**Open cần TL/PO chốt (từ infosec):** (a) truyền cờ `origin:'remote'` xuống sidecar để
handler tự-từ-chối (defense-in-depth) **hay** sanitize hoàn toàn ở gateway/main (KISS) —
infosec khuyến nghị **sanitize ở main + param-pick**; (b) có làm destructive-tier
typed-confirm (F7/Q3) không. **Re-audit** bắt buộc sau khi F1–F5 vào spec, và mỗi lần mở
rộng allowlist ở P2 (steer/cancel/session-create).

---

## UI behavior

### Desktop — `Settings → Devices` (mới)

- **Component liên quan:** trang/section mới trong Settings (ref
  [components/settings/](../../apps/desktop/ui-next/components/) + [pages/settings](../../apps/desktop/ui-next/pages/)).
  Dùng `AppSelect`/`AppInput` theo convention, QR render qua thư viện QR (cần ADR/đồng thuận
  nếu thêm dependency — xem Open question Q7). Theme color qua `useTheme()`, badge/count
  `text-[12px]`.
- **Trạng thái tailnet:** badge trên đầu panel — `connected` (kèm IP tailnet) /
  `disconnected` (fail-closed). Khi disconnected → banner + CTA hướng dẫn cài Tailscale,
  nút "Pair new device" **disabled**.
- **Pairing modal:** QR lớn + đồng hồ đếm ngược + mã text fallback + nút "Generate new
  code" (khi hết hạn). Đóng modal → challenge bị huỷ (không để nonce treo).
- **Device list:** mỗi dòng = label + platform icon + `pairedAt` + `lastSeenAt` +
  chip online/offline + nút **Revoke** (icon-only, style destructive theo convention detail
  header buttons). Revoke có confirm.
- **Empty state:** chưa có thiết bị nào → "Chưa ghép thiết bị nào" + mô tả ngắn + nút Pair.

### Phone — PWA (port tập con ui-next)

- **Kết nối:** thanh trạng thái tailnet trên cùng (`reachable` / `reconnecting…` /
  `disconnected`). Reconnect tự động khi mạng trở lại (xem Resume).
- **Session list:** danh sách session (`sessions.list`), chip turn-active / đang-chờ-gate,
  tap để mở.
- **Session view:** transcript stream (render read-only các message/steps y ui-next),
  **todo banner** (dùng logic chung `useSessionTodo`), **diff** (read-only), **cost tab**.
- **Composer:** gửi message/follow-up (P1 KHÔNG có steer/cancel — ẩn nút đó ở P1).
- **Approval card:** 3 biến thể tái dùng component ui-next: `SessionInlinePermission`
  (Allow/Deny/Always), plan card (Approve/Reject), `SessionQuestionCard` (radio/checkbox +
  Other + Submit). Card **luôn hiện**, không bị collapse (bắt buộc để mở khoá loop).
- **Empty/loading/error state:**
  - Loading: skeleton list / transcript.
  - Tailnet down: overlay "Không tới được desktop — kiểm tra Tailscale".
  - Token revoked/expired: màn "cần pair lại".
  - Session đã kết thúc: view read-only, composer disabled + hint "session đã đóng".

## Data shape

> BA **đề xuất** shape; storage/RPC contract cụ thể do TL/ADR chốt (Open question Q8).

- **Entity mới — `RemoteDevice`** (metadata, KHÔNG chứa token):
  - `id: string` — device id.
  - `label: string` — tên do phone/OS cung cấp lúc pair.
  - `platform: string` — vd `ios` / `android` / `web`.
  - `pairedAt: string` (ISO), `lastSeenAt?: string` (ISO).
  - `revoked?: boolean`.
  - Mirror ở [ui-next/types/index.ts](../../apps/desktop/ui-next/types/index.ts) cho Settings UI.
- **Device token:** lưu **OS keychain** phía desktop (qua
  [credentials/keychain.ts](../../apps/desktop/sidecar/src/credentials/keychain.ts) pattern);
  **không** ghi ra file, **không** vào git, **không** vào payload xuống phone khác. Phone giữ
  token trong storage trình duyệt của nó.
- **PairingChallenge (in-memory, ngắn hạn):** `{ code, nonce, expiresAt, used }` — one-time,
  hết hạn ≤ 2 phút, huỷ khi modal đóng.
- **File trên đĩa:** metadata thiết bị đề xuất `~/.awog/remote-devices.json` (chỉ metadata,
  không token). *(Vị trí/format chính xác → TL.)*
- **Event log candidate:** `device.connected` / `device.disconnected` / `device.revoked`
  (để `lastSeenAt` + trạng thái online cập nhật ở Settings). **Audit log hành động remote =
  P3** (không đặc tả P1), nhưng khuyến nghị ghi `origin:'remote'` + `deviceId` khi gate
  được resolve từ phone (xem Open question Q4).

## Edge case / error / empty state

- **Mất mạng giữa stream.** Phone giữ con trỏ offset (turn/offset đã thấy); reconnect →
  gateway replay phần thiếu qua `sessions.get`/`sessions.search` rồi stream tiếp
  (AC-RES-1/2). Không mất/không trùng event.
- **Token hết hạn / bị revoke giữa chừng.** Frame WS tiếp theo bị từ chối → PWA rơi về màn
  "cần pair lại". Nếu đang giữa lúc gửi approve → quyết định KHÔNG được áp dụng (fail-closed);
  gate vẫn chờ, desktop/thiết bị khác vẫn resolve được.
- **Chưa cài Tailscale.** Gateway fail-closed không bind (AC-BIND-2); `Settings → Devices`
  hiện banner + CTA hướng dẫn cài (tái dùng pattern detect-binary / hướng dẫn của VPN
  Manager ADR 0065). Nút Pair disabled. PWA (nếu mở) hiện "không tới được desktop".
- **Session đã kết thúc khi phone mở.** `sessions.get` trả session ở trạng thái đã đóng →
  PWA hiện transcript read-only, composer disabled, không có gate treo.
- **2 thiết bị approve cùng lúc một gate (idempotent — ai thắng).** `resolvePermissionRequest`
  / `resolveQuestionRequest` là **idempotent**: request đầu tới **thắng** (unpark), các
  request sau cho **cùng** `requestId` nhận `resolved:false`. Client thua tự dismiss card
  như stale (AC-GATE-5). Không có double-apply, không deadlock. Áp dụng đồng nhất cho
  desktop-vs-phone và phone-vs-phone.
- **Phone approve gate hủy hoại (Bash `rm -rf` / delete) mà preview thiếu.** P1: gateway
  **không** mở raw fs/exec, nhưng agent **bên trong** session vẫn có thể chạy Bash/Write qua
  permission gate — và phone có thể Allow gate đó. Preview trên phone có thể **thiếu** so với
  desktop (màn nhỏ, diff dài cắt bớt). **P1 behavior:** phone hiển thị **đầy đủ tham số
  tool** (command/path) như desktop; **không** tự động thêm confirm bậc hai. Việc có nên có
  **tier "trusted action" / xác nhận thêm** cho gate hủy hoại approve-từ-remote → **Open
  question Q3** (chờ user/TL + infosec). Rủi ro này được ghi nhận là **có chủ đích để ngỏ**
  cho P1, không phải bug.
- **Input rỗng / dị dạng từ phone.** Message rỗng bị chặn ở client (AC-SEND-2); param gate
  dị dạng bị sidecar zod-reject ở biên (AC-SEC-4).
- **Empty state:** chưa pair thiết bị (Settings) / chưa có session (PWA list) → empty state
  mô tả rõ + CTA.
- **App restart giữa chừng.** Metadata thiết bị + token (keychain) restart-safe. **Park gate
  (permission/question) là in-memory** — sidecar restart lúc đang chờ gate → gate mất, step
  persisted vẫn `running` nhưng không resolve được nữa (giống giới hạn hiện tại của
  permission/AskUserQuestion). Phone reconnect sẽ thấy session ở trạng thái này; **không**
  giả vờ resolve được. *(Không phải regression P1 giới thiệu.)*
- **Hai client cùng session.** Desktop + phone cùng mở một session → cả hai nhận cùng event
  stream; gửi message từ phone hiện cả trên desktop và ngược lại (single source ở sidecar).

## Dependencies

- **ADR 0067** (transport — đã chốt): Remote Gateway ở Electron main, bind tailnet-only,
  allowlist, device-token pairing QR, resume JSONL. Spec này **không** thiết kế lại.
- **Tailscale đã cài** trên **cả desktop + phone** — dependency **thật** duy nhất về mạng
  (dependency mềm, user tự cài như app hệ thống; AWOG chỉ detect interface tailnet, **không**
  spawn/quản lý). Detect logic self-contained (`os.networkInterfaces()` lọc `utun`/`100.64`).
- **VPN Manager (ADR 0065) — KHÔNG phải dependency.** ADR 0065 là OpenVPN (AWOG-làm-client,
  spawn+elevation) — feature khác hẳn, không share runtime/code. Chỉ *có thể* tái dùng pattern
  UX "banner hướng dẫn cài binary" **nếu** nó tồn tại sẵn — nice-to-have, **không gate**.
  Mobile Remote kick-off được độc lập, bất kể VPN Manager land hay chưa.
- **JSONL resume (ADR 0062 / ADR 0024)** — session storage header+messages + task
  event-sourced → nền cho resume offset.
- **Permission gate hiện có:** `sessions.permission` + `parkPermissionRequest`/
  `resolvePermissionRequest` ([sessions/permissions.ts](../../apps/desktop/sidecar/src/sessions/permissions.ts));
  `AskUserQuestion` + `sessions.answer-question` ([ask-user-question.md](./ask-user-question.md));
  plan mode `ExitPlanMode` + step `kind:'plan'`.
- **Entity hiện có liên quan:** Session (transcript/steps/todo/cost), Task (phase/approve —
  P2), Project (git diff scope), Artifact/Git (diff read-only).
- **Engine bridge:** `engine.request(method, params)` + `engine.onEvent(listener)` ở Electron
  main ([engine.ts](../../apps/desktop/electron/src/engine.ts),
  [ipc.ts](../../apps/desktop/electron/src/ipc.ts)) — gateway là "một client nữa" của engine.
- **External:** Tailscale / WireGuard (transport), OS keychain (`@napi-rs/keyring`), thư
  viện QR (chờ ADR nếu là dep mới — Q7).
- **Bị phụ thuộc bởi:** P2 (steer/cancel/session-create), P3 (Web Push/audit) đều xây trên
  gateway + pairing của P1.
- **Gate release:** **infosec HARD gate BẮT BUỘC** trước khi release (network + IPC + exec
  surface). Pre-review 2026-07-28 đã merge (xem [§Yêu cầu bảo mật](#yêu-cầu-bảo-mật-release-gate--infosec-pre-review)):
  không blocker kiến trúc; **F1–F5 phải vào code P1**. Re-audit sau khi F1–F5 landed.

## Non-functional

| Tiêu chí | Mục tiêu |
|---|---|
| Latency round-trip (approve từ phone → gate resolve) | vài giây trên 4G cùng tailnet |
| Offline (phone mất mạng) | Resume không mất/không trùng event sau ~30s (AC-RES) |
| Offline (desktop tắt) | **Không hoạt động** — đúng bản chất local-first (accept) |
| Restart-safe (desktop) | Device token/metadata: **có**. Park gate in-memory: **không** (giới hạn hiện có) |
| Bind surface | Chỉ IP tailnet; fail-closed nếu không có tailnet (invariant #6) |
| Secret exposure | Zero credential/API key trong payload xuống phone (invariant #1) |
| Storage | Metadata thiết bị nhỏ (JSON); token ở keychain |

## Contract kỹ thuật (P1 — gateway protocol + devices)

> Chốt Q5 (approve-plan) + Q8 (devices) + hiện thực F1–F5. Dev code theo mục này.
> Deps: [ADR 0068](../decisions/0068-mobile-remote-control-dependencies.md).

### Vị trí & lưu trữ

- **Remote Gateway** = `apps/desktop/electron/src/remote-gateway.ts` (main). Bridge `ws` ↔
  `engine.request`/`engine.onEvent`. Wire vào `main.ts` cạnh `registerIpc`.
- **Device store** ở **main** (không sidecar): metadata `~/.awog/remote-devices.json` =
  `RemoteDevice[]` với **`tokenHash` (sha256 của token)** — KHÔNG lưu token gốc, không secret
  at-rest. Token gốc chỉ phone giữ. Verify = sha256(token) so constant-time với `tokenHash`.
- **Pairing** ở main: mã one-time in-memory `{ code, expiresAt, used }`, TTL 120s, single-use.
- **F4 boot-validate:** thêm sidecar method **`system.methods`** → `{ methods: string[] }` =
  `[...registry.keys()]` (export `listMethods()` từ `transport/rpc.ts`). Gateway gọi lúc boot,
  assert mọi entry allowlist tồn tại; lệch → log fatal + không phục vụ remote (fail-closed).

### WS frame protocol (JSON)

**Phone → gateway:**
| type | payload | ghi chú |
|---|---|---|
| `pair` | `{ code, label, platform }` | chỉ hợp lệ trên kết nối chưa auth; verify code → mint token, trả `paired` |
| `auth` | `{ token }` | **handshake-level** (F6 — auth 1 lần khi mở WS, KHÔNG token mỗi frame); sai/revoked → close |
| `rpc` | `{ id, method, params }` | method phải ∈ allowlist; gateway param-pick rồi `engine.request` |
| `subscribe` | `{ sessionId }` | đăng ký nhận event của session này |
| `unsubscribe` | `{ sessionId }` | |
| `resume` | `{ sessionId, cursor }` | replay event thiếu qua `sessions.get` từ `cursor` rồi stream tiếp |
| `ping` | `{}` | keepalive |

**Gateway → phone:**
| type | payload |
|---|---|
| `paired` | `{ token, device: RemoteDevice }` |
| `rpc-result` | `{ id, ok, value? , error? }` |
| `event` | `{ type, payload }` — chỉ type ∈ egress-allowlist & thuộc session đã subscribe |
| `error` | `{ code, message }` (auth fail, method chặn…) |
| `pong` | `{}` |

> **Implement note (P1):** `resume` được làm bằng **full-refetch** — reconnect → PWA `auth`
> lại + `subscribe` lại + gọi `sessions.get` (fold JSONL) → không mất/không trùng event
> (AC-RES). **Delta-replay theo offset** (frame `resume` riêng) hoãn P2. Gateway bind cổng
> **47600**; QR = `http://{host}:{port}/#pair={code}` (phone quét bằng camera hệ điều hành →
> mở thẳng PWA + auto-pair; KHÔNG cần scanner trong app nên `jsqr` chưa dùng ở P1).

### Method allowlist (exact-match, camelCase — F4)

```
sessions.sendMessage  sessions.steer  sessions.cancel
sessions.permission   sessions.answerQuestion
sessions.list  sessions.get  sessions.search  sessions.costBreakdown  sessions.turnActive  sessions.activeTurns
tasks.list  tasks.get  tasks.approvePhase  tasks.rerunPhase  tasks.discuss  tasks.cancel  tasks.pause  tasks.resume
git.status  git.diff  git.log
account.usage  dashboard.usage  ping
```
P1 **bật handler UI** cho: `sendMessage`, `permission`, `answerQuestion`, `list/get/search/costBreakdown`, `git.*`. Còn lại nằm trong allowlist nhưng UI để P2 (steer/cancel/tasks). **Approve-plan (Q5):** KHÔNG method riêng — reuse `sessions.sendMessage` với continuation text + `settings.mode='execute'` (giống desktop `stores/sessions.ts approvePlan`). Đây là override **một lượt**: mode của session không đổi.

### Param-pick per-method (F1 — default-deny field lạ)

| Method | Field cho phép từ phone | Ép / bỏ (server-side) |
|---|---|---|
| `sessions.sendMessage` | `sessionId`, `messageId`, `text`, `attachments` (đã strip `path`), `settings.mode` (đủ 4 mode desktop), `settings.level` | **ép `autoApprove:false`**; **validate mode** theo `REMOTE_ALLOWED_MODES` = `ask`/`plan`/`accept-edits`/`execute`, chuỗi lạ ⇒ `ask` (⚠ 2026-08-30 gỡ clamp: `execute` TẮT gate ở runtime, user chấp nhận — AC-SEC-6b); **pin** `settings.provider/modelId/accountId` + `projectId` từ `sessions.get`; **DROP** `workspacePath`, `contextFolders`, `systemPrompt`, `instructions`, `history`, `disabledTools`, `mcpServerIds`, `attachments.path`, `budget` (F8 = rate-limit ở gateway, **KHÔNG** ép dollar-cap session) |
| `sessions.permission` | `requestId`, `decision` | **DROP `updatedInput` + `alwaysAllow`** (F7 — remote không rewrite arg / không always-allow) |
| `sessions.answerQuestion` | `requestId`, `answers` | — (sidecar zod re-validate) |
| `git.status/diff/log` | mọi field TRỪ `workspaceRoot` | **`workspaceRoot` ép = project.path** map từ `projectId` (client gửi) qua `projects.list` (F3); reject nếu không khớp |
| `sessions.list/get/search`, `*.costBreakdown` | passthrough (read-only) | — |

Field ngoài bảng → **default-deny** (loại bỏ trước khi forward). Sidecar vẫn zod-validate ở biên (lớp 2).

### Event egress allowlist (F2) + scope

Forward xuống phone **chỉ** type: `session.chunk`, `session.step`, `session.permission-request`,
`session.message.done`, `session.background-started`, `session.background-done`, `task.status`,
`task.phase.status`, `task.run.output`, `task.message`. **Và** chỉ khi `payload.sessionId`/`taskId`
∈ set device đã `subscribe`. **Chặn cứng** (không bao giờ forward): `auth.oauth-url`,
`source.oauth-url`, `terminal.data`, `terminal.exit`, `ssh:*`, `vpn:*`, `source.tools-log`,
`fs:changed`, `git:status:changed`, và mọi type không thuộc allowlist trên.

### Bind tailnet-only (F5)

1. `os.networkInterfaces()` → tìm địa chỉ IPv4 thuộc `100.64.0.0/10` **trên interface tên**
   `/^(utun|tailscale|ts)/i` (định danh interface + CIDR, không CIDR-only).
2. Không có → **không bind** (fail-closed), emit `gateway:status-changed {tailnet:'disconnected'}`.
3. Có → bind `ws` vào **đúng IP tailnet đó** (không `0.0.0.0`), port cố định (vd 47600, configurable).
4. **Mỗi kết nối:** `socket.remoteAddress` phải ∈ `100.64.0.0/10`, ngược lại `terminate()`.
5. Poll `networkInterfaces` mỗi ~15s: interface biến mất → đóng mọi WS + ngừng listen; xuất hiện lại → re-bind.

### devices IPC (main ↔ renderer, cho Settings → Devices) — Q8

Đăng ký cạnh `registerIpc`, expose qua preload `window.awog.gateway.*`:
| IPC | Trả | Việc |
|---|---|---|
| `gateway:status` | `{ tailnet:'connected'|'disconnected', host?, port?, bound }` | trạng thái bind |
| `gateway:createPairing` | `{ code, expiresAt, host, port }` | tạo mã one-time (lỗi nếu chưa bound) |
| `gateway:listDevices` | `RemoteDevice[]` | đọc metadata (không token) |
| `gateway:revokeDevice` | `void` | xoá device + **force-close WS đang mở** của nó (F4/AC-SEC-5) |

Event main → renderer: `gateway:devices-changed`, `gateway:status-changed` (Settings live-update
`lastSeenAt`/online + banner tailnet). `RemoteDevice` = `{ id, label, platform, pairedAt, lastSeenAt?, revoked? }` (KHÔNG `tokenHash` ra renderer).

### F8 budget per-device

Gateway đếm per-device: max 2 concurrent turn, ≤ 30 sendMessage/giờ, cap `text` ≤ 100KB,
≤ 3 WS connection/device. Vượt → `error {code, message}`, không forward. `sessions.cancel` luôn
reachable (không tính budget).

---

## P2 — Session control + create (code landed 2026-08-09, **chờ infosec re-audit**)

> Mục tiêu: PWA **gần desktop hơn** — điều khiển lượt đang chạy, sửa checklist, tạo/đổi
> tên/xoá session, đính kèm ảnh, tìm kiếm. **KHÔNG** mở Tasks (`tasks.*` vẫn ngoài allowlist).

### Allowlist mở rộng (bắt buộc re-audit — quy tắc §Yêu cầu bảo mật)

| Method | Param phone gửi | Gateway ép / bỏ |
|---|---|---|
| `sessions.steer` | `sessionId`, `messageId`, `text` (≤100KB) | cap độ dài; tính vào budget *sends* |
| `sessions.updateTodos` | `sessionId`, `todos` | shape/cap do zod sidecar (200 × 2000 ký tự) |
| `sessions.upsert` | `mode`, `sessionId?`, `title?`, `projectId?`, `settings.{provider,accountId,modelId,level,mode,responseStyle,responseStyleNoMarkdown}` | **gateway TỰ dựng `Session`** — phone không gửi object session. `projectId` phải khớp `projects.list`; field bỏ trống ⇒ **kế thừa** desktop defaults + `project.llmDefaults`; `accountId` **phải tồn tại trong `accounts.list` của provider đã chọn** (`null` = bỏ ghim), đổi provider ⇒ **xoá `accountId`**; `level` phải ∈ enum; `responseStyle` charset `[A-Za-z0-9-]{1,64}` (slug lạ → sidecar degrade "no style"); `settings.mode` validate theo `REMOTE_ALLOWED_MODES` (đủ 4 mode, lạ ⇒ `ask`); `messages: []`. **Không thể** đặt `workspaceFolder`, `budget`, `pinnedContext`, `disabledTools`, `mcpServerIds`, fork lineage |
| `sessions.delete` | `id` | chỉ `id` |
| `sessions.generateTitle` | `sessionId`, `userText?` (≤4000) | **pin** `provider`/`modelId`/`accountId` từ session server-side |

**Gateway-local (KHÔNG forward xuống sidecar):** `remote.bootstrap` →
`{ projects:[{id,name,color?}], providers:[{provider, models:[{id,name}], accounts:[{id,label,status?,models?}], activeAccountId}], defaults }`.
Compose từ `projects.list` + `accounts.list` + `models.list` + `settings.get` **ở main**, chỉ
trả field đã pick — phone **không** thấy path trên đĩa, credential blob, `baseURL`, hay settings
blob (account chỉ lộ **định danh** id/label/status). Cache 60s. Code:
[remote-gateway-catalog.ts](../../apps/desktop/electron/src/remote-gateway-catalog.ts).

**Budget (F8):** tách 2 cửa sổ trượt 1 giờ / device — *sends* (`sendMessage` + `steer`, 600/h,
text ≤100KB) và *writes* (`upsert`/`delete`/`updateTodos`/`generateTitle`, 300/h).

### PWA (apps/desktop/remote-pwa)

- **Điều khiển lượt:** nút **Stop** (`sessions.cancel`) + gửi khi đang chạy = **steer** vào
  lượt hiện tại. Reconnect giữa lượt (chưa biết `messageId`) → tin nhắn **xếp hàng**, gửi khi
  lượt settle — không bao giờ mở lượt song song.
- **Step mở rộng được:** chạm một step → xem `detail` thật (unified diff tô màu / nội dung file
  / lệnh + output + exit code / danh sách kết quả / reasoning). Mặc định đóng như desktop; cắt
  ở 160 dòng và **ghi rõ còn bao nhiêu dòng**.
- **Checklist ghim (ADR 0069):** banner `done/total`, chạm một dòng để xoay trạng thái →
  `sessions.updateTodos` (shared state, không bị model ghi đè).
- **Composer:** chip mode mở sheet chọn **Ask / Plan / Accept Edits / Execute** (2 mode sau tô warn/danger vì chạy tool không xin duyệt — AC-SEC-6b), đính kèm **ảnh** (chụp hoặc chọn — downscale 1280px/JPEG
  0.8 trước khi gửi vì frame WS cap 1MB) và tệp văn bản (`preview`), textarea tự giãn.
- **Session config đầy đủ như desktop** (`SessionConfigFields.vue` dùng chung cho New session +
  sheet của session): **provider · account · model · thinking level · mode · response style ·
  no-markdown**. Ở New session mỗi field có lựa chọn *Mặc định* = bỏ trống ⇒ kế thừa
  `project.llmDefaults` rồi desktop defaults (gateway resolve). Account đổi ⇒ model list theo
  account (custom endpoint/Codex có catalog riêng). `sendMessage` mang `responseStyle` persisted
  của session xuống mỗi lượt.
- **Session mới từ phone:** chọn project + config ở trên; tiêu đề trống → tự sinh sau lượt đầu
  (`sessions.generateTitle` → persist qua `upsert`). Đổi tên / đổi config / xoá trong sheet của
  session; header session hiện `project · model`.
- **Danh sách:** tìm toàn văn (`sessions.search`, debounce 350ms), lọc theo project (tên + màu
  thật), badge tổng số gate đang chờ, chip background shell (ADR 0066).
- **RPC timeout:** `sendMessage` chạy **không timeout** (trước đây 30s ⇒ lượt dài hiện "Hết thời
  gian chờ" dù vẫn đang chạy); các call khác giữ 30s.
- **Bàn phím ảo (`viewport.ts`):** Enter = **xuống dòng** (⌘/Ctrl+Enter mới gửi — phím return
  trên bàn phím ảo không được phép bắn một lượt). Bàn phím ảo **không** thu layout viewport
  (iOS không bao giờ; Android chỉ khi `interactive-widget=resizes-content`) ⇒ composer bị che.
  Fix: `visualViewport` → biến `--kb` (chiều cao bàn phím) + `--sab` (safe-area khi bàn phím mở
  = 0); `.app` cao `calc(100% - var(--kb))`, bottom sheet/FAB/toast cũng trừ `--kb`; transcript
  tự cuộn xuống đáy khi bàn phím lên.

### Desktop — `Settings → Devices` bổ sung

- Card **"Địa chỉ truy cập"** (`SettingsDeviceAccess.vue`) hiện khi remote control bật + tailnet
  connected: URL `http://{tailnetIP}:47600/` + nút **Chép** + **QR** (toggle). Đây là cách thiết
  bị **đã ghép** quay lại PWA sau khi đóng tab — device token nằm trong storage của trình duyệt
  đó nên KHÔNG cần ghép lại. QR này **không chứa pairing code** (khác QR của modal ghép nối), nên
  để trên màn hình cũng không cấp quyền gì.

### PWA-native (thông báo + offline shell)

- Service worker `public/sw.js`: cache **chỉ app shell** (navigation network-first, `/assets/*`
  cache-first vì Vite hash tên file). **Không** cache dữ liệu session. Có luồng "có bản mới →
  Cập nhật" trong Settings sheet.
- Notification khi có **gate** hoặc **lượt xong** lúc app ở nền + badge số gate chờ.
- ⚠️ **Giới hạn thật:** gateway phục vụ **HTTP** trên IP tailnet ⇒ trang **không phải secure
  context** ⇒ trình duyệt **chặn** service worker + Notification + `setAppBadge`. Code đã
  feature-detect: hiện tại degrade về **rung + badge in-app**, và tự bật đầy đủ khi PWA chạy sau
  một tên **HTTPS** (vd `tailscale serve`). Settings sheet nói rõ trạng thái này thay vì để
  toggle chết. *Cấp HTTPS cho gateway = việc riêng, chưa làm ở P2.*

### Còn lại của P2 (chưa làm)

- `tasks.*` từ phone (approve-phase/rerun/pause/resume) — **vẫn ngoài allowlist**.
- Unit test khoá allowlist (chưa có test-runner ở `apps/desktop`).
- Infosec re-audit cho 5 method mới + `remote.bootstrap` — **bắt buộc trước release**.

---

## Out of scope (nhắc lại)

- P2 phần **Tasks** (approve-phase/rerun từ phone), P3 (Web Push/audit log/device
  management nâng cao).
- Native app; relay/cloud; transport ngoài tailnet; multi-user/RBAC; raw fs write / terminal
  exec trực tiếp từ phone.

## Open questions

Đánh dấu rõ, **không tự bịa** — cần user/TL (một số overlap với ADR 0067, giữ lại để track):

- **Q1 (user/TL).** **Tailscale hard-dependency** hay **generic trusted-interface** (cho
  user tự đánh dấu một interface WireGuard/LAN-only là "trusted" để bind)? P1 hiện giả định
  Tailscale cụ thể (detect dải CGNAT). Ảnh hưởng AC-BIND-1 (cách phát hiện interface).
- **Q2 (user).** Thiết bị có quyền approve gate có cần **MFA / bước xác nhận bổ sung** lúc
  pair hoặc lúc approve không? (Hiện P1: device token là đủ.)
- **Q3 (user/TL + infosec).** Gate **hủy hoại** (shell command / delete) approve từ phone
  mà preview thiếu — có cần **tier "trusted action" / confirm bậc hai** riêng cho remote
  approve không? Ảnh hưởng edge case "phone approve gate hủy hoại".
- **Q4 (PO/infosec).** Có ghi `origin:'remote'` + `deviceId` vào trace/approval record ngay
  P1 (để về sau audit) hay để hẳn tới P3 (audit log)? Human-approval hiện có `approvedBy`.
- **Q5 (TL).** **Plan approve từ phone** đi qua RPC nào trong allowlist — reuse
  `sessions.send-message` (resume execute mode) hay cần một method approve-plan tường minh?
  Cần chốt để đưa vào allowlist chính xác.
- **Q6 (TL).** Khi **tailnet biến mất** lúc có WS đang mở: đóng ngay các WS hiện có hay để
  chúng tự chết theo interface? (AC-BIND-4 để ngỏ hành vi với WS đang mở.)
- **Q7 (TL/infosec).** **Thư viện QR** cho desktop generate (và scanner cho PWA) — thêm
  dependency mới cần ADR/đồng thuận (quy tắc "không thêm dep lớn khi chưa có ADR").
- **Q8 (TL).** Contract chính xác của các RPC quản lý thiết bị (desktop-local, KHÔNG trên
  allowlist remote): `devices.create-pairing` / `devices.list` / `devices.revoke` + vị
  trí/format file metadata (`~/.awog/remote-devices.json`?).
- **Q9 (PO/TL — UX).** **Vị trí QR pairing:** đặt trong `Settings → Devices` (giả định hiện
  tại) hay có thêm entry-point nhanh (tray / onboarding)? Brief để ngỏ "QR từ Settings vs
  token thủ công" — P1 chọn QR ở Settings + fallback mã text.

## Liên kết

- **ADR transport:** [ADR 0067](../decisions/0067-mobile-remote-control-transport.md)
- **Nền tảng:** [ADR 0062](../decisions/0062-adopt-craft-session-storage-model.md),
  [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md) (resume JSONL),
  [ADR 0065](../decisions/0065-vpn-manager-openvpn.md) (VPN Manager — onboarding UX),
  [ADR 0008](../decisions/0008-stdio-ipc-for-sidecar.md) (sidecar stdio-only),
  [ADR 0009](../decisions/0009-dev-mode-http-fallback.md) (bind loopback + token tiền lệ).
- **Gate cơ chế:** [Human Approval](./human-approval.md), [AskUserQuestion](./ask-user-question.md),
  plan mode (`ExitPlanMode`).
- **Security:** [.claude/rules/security.md](../../.claude/rules/security.md) — invariant
  #1/#4/#6/#7 (infosec security-requirements merge sau).
- **Architecture:** [system-overview](../architecture/system-overview.md) (cần cập nhật thêm
  đường phone⇆gateway), [data-model](../architecture/data-model.md),
  [execution-model](../architecture/execution-model.md).
- **VISION:** [VISION](../../artifacts/VISION.md) · **MVP scope:** [mvp-scope](../requirements/mvp-scope.md).
