# Feature — VPN Manager (OpenVPN) + SSH dependency

- **Trạng thái:** Proposed (chưa code)
- **ADR:** [0065 — VPN Manager: spawn OpenVPN + prompt-elevation](../decisions/0065-vpn-manager-openvpn.md)
- **Route:** `/ssh` (thêm tab **VPN**) — VPN là tiền đề reachability cho SSH nên gom cùng trang, không tách route riêng.

## Mục tiêu

Cho phép AWOG **tạo + keepalive kết nối OpenVPN** và cho **nhiều SSH host dùng chung một VPN**: mở host nằm sau VPN mà không phải tự bật VPN ngoài app. Local-first, cred trong OS keychain, tuân thủ 8 invariant AWOG. Khi tunnel lên, SSH đi qua VPN **tự động qua routing OS** (không sửa `ssh2`).

## Mô hình dữ liệu

### VpnProfile (`~/.awog/vpn-profiles/<id>.json`)
| Field | Kiểu | Ghi chú |
|---|---|---|
| `id` | string | `[a-z0-9][a-z0-9_-]{0,120}` — filename + keychain account |
| `name` | string | Tên hiển thị |
| `type` | `'openvpn'` | v1 chỉ OpenVPN (mở rộng WireGuard sau) |
| `configPath` | string | Đường dẫn `.ovpn` (**plaintext**, không phải secret; validate absolute + tồn tại) |
| `authMode` | `'none'\|'user-pass'` | `none` = cred nằm trong `.ovpn`/cert; `user-pass` = đẩy qua management |
| `hasUserPass` | boolean | Cờ UI: có `{username,password}` trong keychain |
| `hasKeyPassphrase` | boolean | Cờ UI: có passphrase key |
| `keepalive` | boolean | Auto-restart khi tunnel/pid chết (default true) |
| `autoDown` | boolean | Hạ VPN khi refCount về 0 (default false — giữ up) |
| `folder?` / `tags?` | string / string[] | Nhóm + lọc (mirror SshHost) |
| `status?` | `'up'\|'connecting'\|'down'\|'error'` | persisted last status |
| `statusError?` | string | sanitized |
| `lastUpAt?` | string | ISO |
| `createdAt`/`updatedAt` | string | ISO |

**Secret (keychain `awog-vpn`, account `vpn/<id>`):** `{ username?, password?, keyPassphrase? }`. Nạp vào openvpn **qua management-query-passwords** — không ghi ra đĩa.

### SshHost — thêm field
| Field | Kiểu | Ghi chú |
|---|---|---|
| `vpnId?` | string | Ref `VpnProfile`. Có → `ssh.connect` gọi `vpn.ensureUp(vpnId)` trước; ref-count chia sẻ cho mọi host cùng `vpnId`. |

## Runtime — VpnManager (sidecar, anh em `SshManager`)

- Spawn `openvpn --config <ovpn> --management 127.0.0.1 <randomPort> --management-hold --management-query-passwords --auth-nocache` **qua elevation adapter theo OS** (§ADR 0065 §4).
- Sidecar connect **management socket** (localhost + password) → `state on` → chờ `CONNECTED` = ready; đẩy cred khi được hỏi; `signal SIGTERM` để stop; poll `state` + pid cho health.
- **Ref-count** per VPN: `ensureUp` (park chờ ready/prompt) tăng count; `release` giảm; 0 → giữ up hoặc auto-down.
- **Keepalive**: `--keepalive` native + auto-restart backoff khi pid chết (nếu `profile.keepalive`).

## RPC (`vpn.*`)

| Method | Vào | Ra |
|---|---|---|
| `vpn.list` | — | `{ profiles }` |
| `vpn.upsert` | `{ profile, mode }` | `{ profile }` |
| `vpn.delete` | `{ id }` | `{ ok }` (down nếu up + purge secret) |
| `vpn.setCredential` | `{ id, username?, password?, keyPassphrase? }` | `{ ok }` (**không echo**) |
| `vpn.up` | `{ id }` | `{ status }` — elevate + connect, **park** chờ admin prompt/ready |
| `vpn.down` | `{ id }` | `{ ok }` |
| `vpn.status` | `{ id? }` | `{ states }` |
| `vpn.importOvpn` | `{ path }` | `{ candidate }` (dry-run parse) — **P4** |

Events: `vpn:status-changed`, `vpn:log` (sanitized), `vpn-profiles.fs-changed`.

## Phân pha

- **P0** VpnProfile zod schema + store (`~/.awog/vpn-profiles/`) + `vpn.list/upsert/delete/setCredential` + UI tab VPN trên `/ssh` (list/add/edit, empty/loading/error).
- **P1** VpnManager spawn + **elevation adapter** (mac/Linux/Win) + **management-interface** control + `vpn.up/down/status` + `vpn:status-changed`.
- **P2** keepalive/auto-restart + health-check + reconnect + surface log sanitized.
- **P3** `SshHost.vpnId` + ref-count + `ensureUp` trước `ssh.connect` + auto-down → **"1 VPN nhiều host"**.
- **P4** import `.ovpn` + status chip trong Session (host attach) + integration Connections.
- **P5** infosec audit + QA (+ Phase-2 privileged helper no-prompt, tùy chọn).

## User flow chính

1. **Thêm VPN:** tab VPN → `+` → chọn `.ovpn` + authMode (+ user/pass nếu cần) → save → card VPN xuất hiện.
2. **Bật thủ công:** card VPN → `Connect` → (admin prompt 1 lần) → status `up`.
3. **Gắn vào host:** form SSH host → chọn `VPN` (dropdown VpnProfile) → save.
4. **Connect host:** `Connect` host có `vpnId` → AWOG tự `ensureUp` VPN (prompt nếu chưa lên) → chờ ready → SSH mở. Host thứ 2 cùng VPN → dùng chung, **không prompt lại**.
5. **Ngắt:** disconnect host cuối → VPN giữ up (mặc định) hoặc tự hạ nếu `autoDown`.

## Acceptance criteria (rút gọn — QA mở rộng ở P5)

- **AC1 CRUD:** tạo/sửa/xoá VpnProfile persist `~/.awog/vpn-profiles/*.json`; reload còn.
- **AC2 Secret:** username/password/passphrase **không** xuất hiện trong file JSON, RPC response, log, hay **trên đĩa** (đẩy qua management). Xoá profile purge keychain.
- **AC3 Up/Down:** `vpn.up` elevate + tới `CONNECTED`; `vpn.down` teardown sạch (không orphan process/pidfile).
- **AC4 Ref-count:** 2 host cùng `vpnId` → **một** tiến trình openvpn; prompt admin **1 lần**; disconnect 1 host không hạ VPN khi host kia còn.
- **AC5 SSH-qua-VPN:** host chỉ reachable sau VPN → connect thành công **sau khi** VPN up; VPN down → connect fail với lỗi rõ.
- **AC6 Keepalive:** kill openvpn ngoài app (hoặc rớt mạng) → auto-restart (nếu `keepalive`); status phản ánh đúng.
- **AC7 Elevation:** hủy prompt admin → VPN `down` + `ssh.connect` fail message rõ, không treo.
- **AC8 UI:** card list + detail theme token, dark/light, empty/loading/error đầy đủ; status chip live.

## Edge case

- `openvpn` không cài → `vpn.up` throw `"OpenVPN unavailable"` + hint cài; CRUD vẫn chạy.
- Keychain unavailable → `setCredential` throw hint; metadata vẫn lưu.
- User hủy admin prompt → `down`, không loop.
- Management port trùng → chọn port random khác / lỗi rõ.
- Cred sai (auth-failed từ management) → status `error` + message sanitized, không loop.
- VPN rớt giữa phiên SSH → keepalive restart; SSH có thể phải reconnect (ssh2 keepalive tự phát hiện).
- Sidecar restart khi VPN đang up → v1 mark `down`, bring-up lại theo yêu cầu (hoặc adopt qua pidfile+management nếu còn reachable).
- `.ovpn` chứa `up`/`down`/`ProxyCommand` script → **không** chạy tự động arg ngoài duyệt (chặn injection); cảnh báo nếu phát hiện directive nguy hiểm.
- Windows: tiến trình elevated qua UAC khó theo dõi → dựa management + pidfile; nếu không kiểm soát được → khuyến nghị OpenVPN service (Phase sau).

## Bảo mật (xem ADR 0065 §Decision)

Cred keychain-only + đẩy qua management (off-disk); spawn arg-array + allowlist binary + validate `.ovpn` path; management socket `127.0.0.1` + password; `osascript` AppleScript escape kỹ; elevation là user-consent. **Infosec audit bắt buộc trước release** (spawn đặc quyền + sửa route OS + cred + socket điều khiển).
