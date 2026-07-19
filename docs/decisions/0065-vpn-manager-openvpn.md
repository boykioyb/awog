# ADR 0065 — VPN Manager: spawn OpenVPN + prompt-elevation + SSH dependency

- **Trạng thái:** Proposed
- **Ngày:** 2026-07-17
- **Liên quan:** [ADR 0063](0063-ssh-manager-ssh2-runtime.md) (SSH runtime — VPN là tiền đề reachability cho SSH), [ADR 0064](0064-session-ssh-link.md) (Session↔SSH), [ADR 0018](0018-mcp-secret-keychain.md) (keychain), [ADR 0019](0019-pty-terminal-in-sidecar.md) (spawn/detect binary pattern), [security.md](../../.claude/rules/security.md)
- **Spec:** [docs/features/vpn-manager.md](../features/vpn-manager.md)

## Context

Nhiều server chỉ **SSH được sau khi lên OpenVPN**. Người dùng muốn AWOG: tạo kết nối OpenVPN, **keepalive** nó, và cho **nhiều SSH host dùng chung một VPN** (không phải mỗi host một VPN). Ba câu hỏi cốt lõi:

1. **Runtime VPN chạy bằng gì?** Không có OpenVPN client thuần-JS thực tế (khác `ssh2`): OpenVPN tạo `tun`/`tap` + sửa **bảng route của OS**, chỉ **binary `openvpn` chính thức** làm được.
2. **Nâng quyền ra sao?** `openvpn` cần **root/admin** để tạo tun + route. Electron app không tự làm im lặng.
3. **Tích hợp SSH thế nào?** Khi tunnel đã lên, routing OS tự đưa mọi kết nối tới IP nội bộ qua VPN → `ssh2` **không cần sửa**; chỉ cần đảm bảo VPN "up" trước khi `ssh.connect`.

User đã chốt: **AWOG tự spawn `openvpn`**, chạy trên **macOS/Linux/Windows**, Phase 1 nâng quyền **prompt-based** (không privileged helper).

## Decision

1. **Runtime = spawn binary `openvpn` của OS** (`child_process`), **không** viết client JS. Detect binary path (mirror `getPty()`/keychain `getModule()` graceful fallback [ADR 0063 §1](0063-ssh-manager-ssh2-runtime.md)); thiếu → RPC `vpn.up` throw `"OpenVPN unavailable"` + hint cài đặt, CRUD metadata vẫn chạy.

2. **SSH-qua-VPN là tự động qua routing OS.** VpnManager chỉ đảm bảo tunnel "up"; `ssh2` connect tới private IP đi qua VPN mà **không sửa ssh runtime**. Đây là lý do 1 VPN phục vụ được N host.

3. **Điều khiển qua OpenVPN management interface** — KHÔNG sở hữu stdout của child. Khi elevate, tiến trình con bị **tách security context** (osascript trả output cuối cùng; UAC `Start-Process` mất handle) → không parse được stdout live. Nên spawn `openvpn --management 127.0.0.1 <randomPort> --management-hold --management-query-passwords` (có **management password file** chmod 600) và sidecar (không đặc quyền) **connect vào socket localhost** để:
   - **Readiness** = poll `state` → `CONNECTED`.
   - **Đẩy credential qua management** (`--management-query-passwords`) → **cred KHÔNG bao giờ ghi ra đĩa**.
   - **MFA/OTP**: hỗ trợ **static-challenge** (`SC:` → reply `SCRV1:base64(pass):base64(otp)`) và **dynamic CRV1** (server-initiated → reply `CRV1::<state>::<otp>`). Sidecar park kết nối, emit `vpn:auth-challenge` (prompt sanitize, **không** kèm mã), UI nhập → `vpn.submitChallenge` → đẩy vào socket. Mã OTP đi **một chiều** UI → sidecar → openvpn, không log/emit/lưu (invariant #1).
   - **Stop** = `signal SIGTERM`; **health** = `state` + kiểm pid; **log** đọc qua management (sanitize trước khi lên UI). **Fail/timeout** cũng phải `signal SIGTERM` (`ManagementClient.terminate()`) — nếu chỉ đóng socket, openvpn root thành **zombie** giữ tun/route, phá mọi VPN client khác.
   - Management socket bind `127.0.0.1` + password (invariant #6 — no port public; chống tiến trình local khác chiếm quyền điều khiển VPN).

4. **Nâng quyền = prompt-based, tách adapter theo OS** (Phase 1, không helper):
   - **macOS:** `osascript -e 'do shell script "…" with administrator privileges'` (AppleScript string phải **escape kỹ** — surface injection).
   - **Linux:** `pkexec openvpn …` (polkit GUI), fallback `sudo`.
   - **Windows:** `Start-Process openvpn -Verb RunAs` (UAC); có thể chuyển sang **OpenVPN service + management** ở Phase sau.
   - **1 prompt / lần VPN lên.** VPN giữ kết nối + keepalive → N phiên SSH sau đó **dùng chung, không hỏi lại**. Phase 2 (tùy chọn, sau) = privileged helper (`SMAppService`/systemd+polkit/Windows service) để bỏ prompt hẳn.

5. **Lifecycle + ref-count = "1 VPN nhiều SSH".** VpnManager giữ `{ pid, mgmtPort, refCount, status }` per VPN. `ssh.connect` với host có `vpnId` → `vpn.ensureUp(vpnId)` (park chờ ready/prompt) rồi mới ssh2 connect; `ssh.disconnect` giảm count; count=0 → **giữ up** (mặc định) hoặc auto-down nếu `profile.autoDown`. **Keepalive** = openvpn `--keepalive` native + sidecar auto-restart (backoff) khi pid chết.

6. **Secret không rời sidecar** (invariant #1): keychain **service mới `awog-vpn`**, account `vpn/<id>` — `{ username, password }` và/hoặc `{ keyPassphrase }`. Nạp vào openvpn **qua management-query-passwords** (không temp file). Config JSON chỉ metadata + cờ; RPC ghi cred trả `{ ok }`, **không echo**.

7. **Command-execution surface** (invariant #8 + sink `execFile`): spawn bằng **arg array** (không shell string); **allowlist** binary `openvpn`; validate `configPath` (`.ovpn` absolute, tồn tại, đọc được; **không** cho phép inject thêm arg/`ProxyCommand`/`up`/`down` script từ config chưa duyệt); management password random per-run. → **infosec bắt buộc trước release**.

8. **Storage = file-per-entity** song song SSH (SRP): `~/.awog/vpn-profiles/<id>.json` (metadata, no secret), atomic write (tmp → `chmod 0o600` → rename, dir `0o700`) clone [mcp/store.ts](../../apps/desktop/sidecar/src/mcp/store.ts). `SshHost` thêm field `vpnId?`.

9. **v1 user-driven UI only** — `vpn.up`/`down` **không** expose ra model tool (mirror [ADR 0063 §consequences](0063-ssh-manager-ssh2-runtime.md)); nếu sau expose phải gate mutating như `RunWorkflow`.

## Consequences

- (+) Mở khoá SSH tới server nằm sau OpenVPN; tái dùng plumbing keychain/store/RPC/events/watcher có sẵn.
- (+) **1 VPN dùng chung N host** qua ref-count; keepalive tự phục hồi khi rớt.
- (+) Management-interface giữ **cred off-disk** và điều khiển được tiến trình elevated (giải quyết vấn đề mất stdout).
- (~) **Bundle `openvpn` kèm app** để user khỏi tự cài (2026-07-18): exec một binary GPL là aggregation (hợp lệ), nên ship openvpn **relocatable** per platform+arch qua `extraResources` (`vendor/openvpn/<plat>-<arch>/`), chuẩn bị bằng `scripts/vendor-openvpn.mjs` (copy dylib + `install_name_tool`→@loader_path trên mac / `patchelf $ORIGIN` Linux / DLL cạnh exe Windows). Electron main set `AWOG_OPENVPN_BIN` → `resolveOpenvpnBinary` ưu tiên bản bundled, **fallback allowlist system** nếu chưa vendor. **Build machine** vẫn cần openvpn làm nguồn (brew/…); **end user thì không**. Bundle bỏ được bước *cài* NHƯNG **không bỏ được prompt admin** (openvpn cần root tạo tun). Lưu ý: khi bật signing/notarize macOS, binary + dylib nhúng phải được ký cùng app.
- (−) **Prompt admin mỗi lần VPN lên** (chấp nhận vì 1 lần/phiên); chỉ Phase-2 helper mới bỏ hẳn.
- (−) Surface bảo mật lớn: **spawn tiến trình đặc quyền + sửa route OS + cred VPN + socket điều khiển** → **infosec audit bắt buộc**. macOS `osascript` AppleScript string cần escape cẩn thận.
- (−) **Windows** prompt-based (UAC `Start-Process`) khó theo dõi tiến trình elevated → dựa vào management + pidfile; có thể phải chuyển OpenVPN service ở Phase sau (ghi rõ risk trong spec).
- (−) Sidecar restart giữa chừng: v1 **mark down** rồi bring-up lại theo yêu cầu (hoặc adopt qua pidfile+management nếu còn reachable) — không tự nhận diện phức tạp ở v1.
