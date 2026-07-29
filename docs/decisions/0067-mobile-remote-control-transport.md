# ADR 0067 — Dùng Tailscale/WireGuard mesh VPN làm transport điều khiển session từ điện thoại

- **Trạng thái:** Accepted (P1 implement landed 2026-07-29 — đợi infosec re-audit + test chức năng trước khi release)
- **Ngày:** 2026-07-28 (implement 2026-07-29)
- **Người quyết định:** tech-lead (transport đã được user CHỐT; đợi infosec HARD gate trước khi release)
- **Liên quan:** [ADR 0008](0008-stdio-ipc-for-sidecar.md) (stdio IPC — sidecar không mở port), [ADR 0009](0009-dev-mode-http-fallback.md) (bind loopback + dev token — tiền lệ auth/bind), [ADR 0065](0065-vpn-manager-openvpn.md) (VPN Manager OpenVPN — phân biệt mục đích, tái dùng UX cài đặt), [ADR 0062](0062-adopt-craft-session-storage-model.md) (session storage header+messages — nền cho resume), [ADR 0024](0024-task-execution-engine-ipc-contract.md) (task JSONL event-sourced — resume), [security.md](../../.claude/rules/security.md) (invariant #1/#4/#6/#7)
- **Spec:** [docs/features/mobile-remote-control.md](../features/mobile-remote-control.md) (chưa tạo — sẽ viết khi vào implement)

## Bối cảnh

Người dùng muốn **điều khiển đầy đủ session AWOG từ điện thoại** — đọc transcript đang chạy, gửi tin nhắn / steer / cancel, duyệt permission (approval), theo dõi diff/todo/cost của task — và phải dùng được **cả khi phone đang ở 4G** (không cùng LAN với desktop).

Bài toán cốt lõi là **transport**: làm sao thiết bị di động chạm tới desktop qua internet mà **không phá các bất biến core của AWOG**:

- **Invariant #6 — No public inbound port.** Production chỉ dùng stdio IPC ([ADR 0008](0008-stdio-ipc-for-sidecar.md)); tuyệt đối không mở port ra internet công cộng, không bind `0.0.0.0`.
- **Invariant #1 — API key không rời sidecar.** Bất kỳ kênh mới nào cũng không được để credential/token lộ ra client remote.
- **Invariant #4 — IPC boundary.** Client remote (điện thoại) về bản chất là một "UI ở xa"; nó **không** được chạm filesystem / exec trực tiếp — mọi thứ phải đi qua RPC nghiệp vụ có sẵn.
- **Local-first.** Không được biến AWOG thành lệ thuộc một cloud service để hoạt động; state vẫn nằm trên đĩa desktop.

Desktop AWOG hiện có sẵn toàn bộ nghiệp vụ dưới dạng **JSON-RPC 2.0 (NDJSON)** trong sidecar (`transport/rpc.ts::dispatch`), và Electron main đã là **một client của engine đó**: `engine.request(method, params)` + `engine.onEvent(listener)` (xem [engine.ts](../../apps/desktop/electron/src/engine.ts), [ipc.ts](../../apps/desktop/electron/src/ipc.ts) — main forward RPC + event xuống renderer qua `contextBridge`). Nghĩa là "thêm một client nữa" (điện thoại) là bài toán **transport + auth**, không phải viết lại nghiệp vụ.

## Phương án đã cân nhắc

### Option A — Tailscale/WireGuard mesh VPN + Remote Gateway bind vào interface tailnet (đã chọn)

- **Mô tả:** Desktop và điện thoại tham gia **cùng một tailnet** (Tailscale, nền WireGuard). AWOG thêm một component **Remote Gateway** bind WebSocket **CHỈ** vào địa chỉ interface tailnet của máy (dải CGNAT `100.64.0.0/10` / `fd7a:115c:a1e0::/48`, hoặc IP của interface `tailscale`/`utun`), **không bao giờ** `0.0.0.0`. Gateway bridge WebSocket ↔ JSON-RPC engine có sẵn, kèm **method allowlist** + **device auth/pairing**.
- **Pros:**
  - **Giữ invariant #6:** không có port public inbound — listener chỉ nghe trên interface mesh riêng tư; traffic trong mesh được **WireGuard mã hoá đầu-cuối**.
  - **Dùng được trên 4G** vì Tailscale tự lo NAT traversal / DERP relay — desktop không cần IP tĩnh, không cần mở port router.
  - **Local-first còn nguyên:** AWOG không tự vận hành hạ tầng; state vẫn ở đĩa desktop; mesh chỉ là đường ống.
  - Tái dùng 100% nghiệp vụ qua RPC có sẵn; điện thoại chỉ là "một UI nữa".
- **Cons:**
  - Người dùng **phải cài Tailscale** (hoặc client WireGuard tự cấu hình) trên **cả desktop + phone** — thêm bước setup, phụ thuộc phần mềm ngoài AWOG.
  - Bảo mật một phần dựa vào tính đúng đắn của tailnet ACL của user → AWOG **không được** phó thác hết cho mesh, vẫn phải có auth tầng app (defense in depth).
  - Nếu user tự dựng WireGuard thuần thay vì Tailscale thì onboarding phức tạp hơn (không có magic NAT traversal).

### Option B — AWOG tự chạy relay + E2E broker

- **Mô tả:** AWOG vận hành một relay server; desktop và phone cùng kết nối ra relay; relay chuyển tiếp gói đã mã hoá đầu-cuối (broker không đọc được nội dung).
- **Pros:**
  - Turnkey — user không phải cài VPN, "just works" qua internet.
  - Kiểm soát được UX ghép nối, có thể làm push notification chuẩn.
- **Cons:**
  - Phải **vận hành hạ tầng** (uptime, chi phí, chống lạm dụng/abuse, DDoS) — lệch hẳn triết lý local-first, no-cloud-dependency.
  - Tăng blast radius: một dịch vụ trung tâm trở thành mục tiêu tấn công + điểm chết đơn (SPOF) cho tính năng.
  - Chi phí kỹ sư + vận hành liên tục cho một feature phụ.
  - → **Defer/Reject** cho MVP.

### Option C — LAN-only (bind LAN interface + TLS self-signed)

- **Mô tả:** Gateway bind vào IP LAN của máy; điện thoại chạm qua Wi-Fi cùng mạng; TLS self-signed để mã hoá.
- **Pros:**
  - Đơn giản nhất, không phụ thuộc phần mềm ngoài.
  - Latency thấp trong cùng mạng.
- **Cons:**
  - **Không dùng được trên 4G / khi ra khỏi nhà** → không đạt yêu cầu cốt lõi.
  - Bind LAN vẫn là "port nghe được từ mạng chung" (mọi thiết bị/khách trong LAN chạm được) — vi phạm tinh thần invariant #6; self-signed cert gây cảnh báo + dễ bị bỏ qua sai.
  - → **Reject** vì thiếu yêu cầu chính.

### Option D — Cloud broker giữ state thật (server-authoritative)

- **Mô tả:** Một server cloud giữ state session/task; desktop + phone đều là client của cloud.
- **Pros:**
  - Đồng bộ đa thiết bị "miễn phí"; phone hoạt động cả khi desktop tắt.
- **Cons:**
  - **Phá local-first triệt để** — source of truth rời khỏi đĩa desktop; ngược với [ADR 0001](0001-local-first-storage.md) + [ADR 0004](0004-artifacts-as-source-of-truth.md).
  - Đưa artifact + credential lên cloud → vi phạm nhiều invariant cùng lúc.
  - → **Reject.**

## Quyết định

**Chọn: Option A — Tailscale/WireGuard mesh VPN làm transport, cộng một component Remote Gateway đặt ở Electron main.**

### 1. Transport = mesh VPN riêng tư, không port public

Desktop + phone cùng tailnet. Traffic đi trong mesh WireGuard (mã hoá đầu-cuối); Tailscale lo NAT traversal nên **4G dùng được mà không mở port router**. Đây là lựa chọn duy nhất trong các phương án vừa **đạt yêu cầu 4G** vừa **giữ invariant #6** (không port public) vừa **giữ local-first** (AWOG không tự chạy hạ tầng).

**AWOG KHÔNG spawn/quản lý Tailscale** (khác hẳn [ADR 0065](0065-vpn-manager-openvpn.md), nơi AWOG tự spawn `openvpn` để *AWOG-làm-client* chạm server sau VPN). Ở ADR này Tailscale/WireGuard chạy như daemon/app **độc lập user tự cài**; AWOG chỉ **phát hiện interface tailnet và bind gateway vào đó**. (Có thể tái dùng pattern detect-binary / hướng dẫn cài đặt của VPN Manager cho phần onboarding UX.)

### 2. Remote Gateway = component mới ở **Electron main**, chỉ lo transport + auth

Gateway là **một client nữa của engine RPC**, đặt trong main (song song `registerIpc` hiện tại — main vốn đã bridge `engine.request`/`engine.onEvent` xuống renderer). Đặt ở main thay vì sidecar vì:

- **Củng cố invariant #1:** main **không giữ API key** (key chỉ sống trong sidecar). Đặt listener mạng ở main → tiến trình nghe mạng **không cùng process với secret**. Đồng thời **giữ nguyên tính chất "sidecar không mở port"** của [ADR 0008](0008-stdio-ipc-for-sidecar.md) (ngoại lệ duy nhất mở port của sidecar là dev-HTTP loopback ở [ADR 0009](0009-dev-mode-http-fallback.md)).
- **SoC:** main sở hữu các mối lo "shell/transport" (cửa sổ, tray, updater, protocol handler, network); sidecar giữ thuần nghiệp vụ trên stdio. Điện thoại = "một UI nữa" đi vào đúng đường renderer đang đi: `phone ⇆ (tailnet) ⇆ gateway(main) ⇆ engine.request ⇆ sidecar`.
- **KISS / two-process model:** không đẻ process thứ ba; tái dùng `engine.request()` + `engine.onEvent()` y hệt renderer.

Gateway bind WebSocket **chỉ vào địa chỉ interface tailnet** (kiểm bằng `os.networkInterfaces()` lọc dải `100.64.0.0/10` / IPv6 tailnet, hoặc IP của interface Tailscale), **không** `0.0.0.0`; nếu không tìm thấy interface tailnet thì **không bind** (fail-closed, báo user cần bật Tailscale).

### 3. Method allowlist — chặn fs write & exec tùy ý

Gateway **chỉ forward một allowlist tĩnh** các RPC nghiệp vụ, không forward chung. Allowlist là **mảng string exact-match, default-deny**, **validate vs registry thực lúc boot** (fail-fast nếu tên không tồn tại) — KHÔNG dùng prefix/denylist (`sessions.*` trừ vài cái) vì sẽ fail-open cho `sessions.upsert`/`delete`/`compact`/`rewind`. Tên method dùng **camelCase đúng registry** (`grep register('...')`), không phải gạch nối. Cho phép (điều khiển session/task + đọc trạng thái):

- `sessions.sendMessage`, `sessions.steer`, `sessions.cancel`
- `sessions.permission`, `sessions.answerQuestion` (duyệt/answer giữa turn)
- `sessions.list`, `sessions.get`, `sessions.search`, `sessions.costBreakdown`, `sessions.turnActive`, `sessions.activeTurns`
- `tasks.list`, `tasks.get`, `tasks.approvePhase`, `tasks.rerunPhase`, `tasks.discuss`, `tasks.cancel`, `tasks.pause`, `tasks.resume`
- Đọc-only: `git.status`, `git.diff`, `git.log`; `account.usage`, `dashboard.usage`; `ping`

**Chặn cứng** (không bao giờ expose cho client remote): `fs.write-file`/`fs.create-*`/`fs.rename`/`fs.delete`, `terminal.*`, `ssh.*` exec/sftp-write, `vpn.up/down`, `settings.set`, `accounts.*` mutations, `source.set-secret`/`source.set-api-credential`, và mọi surface chạm credential/keychain.

> Lưu ý quan trọng: **agent bên trong session vẫn được ghi file / chạy Bash như bình thường** (tool của nó, đi qua permission gate `beforeToolCall`). Điện thoại **không** RPC fs/exec trực tiếp — nó chỉ *gửi message* và *duyệt* permission qua `sessions.permission`.
>
> ⚠️ **Đính chính bảo mật (infosec pre-review 2026-07-28, F1 — Critical):** allowlist ở **tên method KHÔNG đủ**. Param của chính `sessions.sendMessage` là bề mặt tấn công thật: `autoApprove:true` **tắt permission gate**, `workspacePath` đặt cwd tùy ý (chỉ check `isAbsolute`, không containment), `systemPrompt`/`instructions` override guardrail, `settings.accountId/provider/modelId` chọn account, `history[]` bịa context. Phone không cần fs/exec trực tiếp — nó **lái agent** rồi **tự tắt gate** → RCE + đọc/ghi file toàn máy. Vì vậy gateway BẮT BUỘC:
> - **Param-pick allowlist per-method** (chọn tường minh field cho phép, **default-deny field lạ** — không denylist).
> - Với origin remote: **ép `autoApprove=false`**; **cấm** `workspacePath`/`contextFolders`/`systemPrompt`/`instructions`/`history`; **pin** `accountId`/`provider`/`modelId` theo giá trị server-side của session; cwd chỉ đặt qua **`projectId`** (resolve server-side), không raw path.
>
> Với 2 ràng buộc trên mới đúng "điều khiển đầy đủ session mà **không** mở raw fs/exec cho client remote".

### 4. Device auth + pairing (QR) — defense in depth, không phó thác cho tailnet

Bảo mật mesh (ai vào tailnet) **không thay thế** auth tầng app. Gateway yêu cầu **device token** per-thiết bị: ghép nối một lần bằng **QR** (desktop hiển thị mã pairing → phone quét → trao đổi token, token lưu keychain phía desktop, không rời máy). Quản lý ở **Settings → Devices** (liệt kê/thu hồi thiết bị đã ghép). Mọi frame WS phải kèm token hợp lệ; chống replay (nonce/timestamp), rate-limit, và **input remote coi là L1 không tin** — param vẫn được handler sidecar re-validate ở biên như mọi nguồn L1 khác.

### 5. Resume stream qua event-sourced JSONL

Client mất mạng/đổi 4G↔Wi-Fi rồi reconnect: tận dụng **session storage header+messages** ([ADR 0062](0062-adopt-craft-session-storage-model.md)) và **task JSONL event-sourced** ([ADR 0024](0024-task-execution-engine-ipc-contract.md)). Reconnect → client gửi con trỏ (turn/offset đã thấy) → gateway replay phần thiếu qua `sessions.get`/`sessions.search`, rồi stream tiếp live event qua `engine.onEvent` (lọc theo các session mà thiết bị đang subscribe). Không cần state riêng ở gateway ngoài mapping device↔subscription.

## Hệ quả

### Tích cực

- Đạt yêu cầu cốt lõi: full remote control session, **dùng được trên 4G**, mà **không mở port public** (invariant #6) và **không rời local-first** (không cloud giữ state).
- **Invariant #1 mạnh nhất có thể:** listener mạng nằm ở main — process **không giữ API key**; sidecar giữ nguyên thuần-stdio.
- Tái dùng toàn bộ RPC nghiệp vụ + event stream có sẵn; điện thoại = "một UI nữa" → không nhân đôi logic.
- Traffic mã hoá đầu-cuối bởi WireGuard, cộng device-token app-layer (defense in depth).

### Tiêu cực / trade-off

- **Setup phụ thuộc bên ngoài:** user phải cài Tailscale (hoặc tự cấu hình WireGuard) trên **cả 2 thiết bị**. UX onboarding cần rõ ràng; đây là cái giá của việc không tự chạy relay.
- **Không hoạt động khi desktop tắt** (khác cloud broker) — chấp nhận, đúng bản chất local-first.
- **Bề mặt bảo mật mới lớn:** thêm listener mạng + auth + allowlist + pairing → **infosec HARD gate BẮT BUỘC trước release**. Pre-review 2026-07-28 kết luận **không có blocker kiến trúc** nhưng **không được implement như câu chữ ban đầu**; 5 must-fix (điều kiện release, chi tiết ở [spec §Yêu cầu bảo mật](../features/mobile-remote-control.md#yêu-cầu-bảo-mật-release-gate--infosec-pre-review)):
  - **F1 (Critical):** param-pick allowlist per-method + ép `autoApprove=false`, cấm `workspacePath`/`systemPrompt`/`history`, pin account/model server-side (xem đính chính §3).
  - **F2 (High):** event egress **allowlist theo type + scope theo subscription** — chặn cứng `auth.oauth-url`/`terminal.data`/`ssh:*`/`vpn:*` và event của session device không subscribe (`engine.onEvent` hiện forward **global**).
  - **F3 (High):** `git.status/diff/log` nhận `workspaceRoot` L1 tùy ý → ràng vào tập project đã biết (server-side), reject path lạ.
  - **F4 (High):** allowlist exact-match/default-deny + validate vs registry lúc boot; revoke **force-close WS** đang mở.
  - **F5 (High):** bind theo **định danh interface** (utun+Tailscale API) không CIDR-only; kiểm `socket.remoteAddress ∈ CIDR tailnet` mỗi kết nối; xử lý race up/down.
  - Fix-trước-release (không block thiết kế): F6 pairing/token (token ≥128-bit, lưu **hash**, QR mang pairing-code one-time chứ không long-lived token, auth-at-handshake không per-frame), F7 destructive-approve tier, F8 budget per-device.
- Phụ thuộc mềm vào một hệ mesh cụ thể cho trải nghiệm 4G "just works" (Tailscale). WireGuard thuần vẫn chạy nhưng onboarding kém hơn.

### Việc cần làm tiếp (knock-on)

- **Component mới:** `apps/desktop/electron/src/remote-gateway.ts` (WS server + bind-tailnet-only + allowlist + device-token + subscription↔event bridge); wire vào `main.ts` cạnh `registerIpc`.
- **Settings → Devices:** UI quản lý pairing (QR generate/scan, list/revoke device); RPC/keychain lưu device token phía desktop.
- **Client PWA:** port một tập con giao diện từ [ui-next](../../apps/desktop/ui-next/) (Sessions transcript + composer + approval card + task view). **Native app để sau.**
- **Web Push (post-MVP):** thông báo khi app nền trên phone (khi cần permission-approval). Chỉ là "wake ping" không kèm nội dung; cần cân nhắc riêng vì đụng dịch vụ push (một chút lệch local-first cho **riêng** notification) — tách quyết định sau.
- **Docs:** viết [docs/features/mobile-remote-control.md](../features/mobile-remote-control.md); cập nhật [system-overview.md](../architecture/system-overview.md) (thêm đường phone⇆gateway); backfill bảng index [docs/decisions/README.md](README.md).
- **Ảnh hưởng:** UI dev (PWA + Settings→Devices), main dev (gateway), infosec (audit bắt buộc), user (cài Tailscale).

## Reversibility

- **Reversible.** Gateway là **thêm mới, không sửa** đường renderer⇆engine hiện có; gỡ gateway không đụng luồng desktop. Protocol WS của gateway độc lập với đường mạng bên dưới: nếu sau này muốn thêm relay (Option B) thì **giữ nguyên gateway + allowlist**, chỉ đổi lớp reachability. Phụ thuộc Tailscale là **dependency mềm** (user cài, không bundle) — bỏ được. Không phải 1-way door.

## Liên kết

- ADR: [0008](0008-stdio-ipc-for-sidecar.md) (sidecar stdio-only), [0009](0009-dev-mode-http-fallback.md) (bind loopback + token tiền lệ), [0065](0065-vpn-manager-openvpn.md) (VPN Manager — phân biệt mục đích), [0062](0062-adopt-craft-session-storage-model.md) + [0024](0024-task-execution-engine-ipc-contract.md) (nền resume).
- Security: [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #1 (key trong sidecar), #4 (IPC boundary), #6 (no public port), #7 (no SSRF), sink `fetch(urlFromUser)` / auth.
- Code chạm dự kiến: [electron/src/engine.ts](../../apps/desktop/electron/src/engine.ts), [electron/src/ipc.ts](../../apps/desktop/electron/src/ipc.ts), `electron/src/remote-gateway.ts` (mới), [sidecar/src/transport/rpc.ts](../../apps/desktop/sidecar/src/transport/rpc.ts) (dispatch — không đổi).
- External: [Tailscale](https://tailscale.com/) / [WireGuard](https://www.wireguard.com/).
