# Feature — SSH Manager

- **Trạng thái:** Đang xây (P0/P1)
- **ADR:** [0063 — ssh2 runtime](../decisions/0063-ssh-manager-ssh2-runtime.md)
- **Route:** `/ssh` (ui-next)

## Mục tiêu

Trang quản lý SSH đầy đủ tính năng kiểu Termius: quản lý host inventory, kết nối terminal tương tác, duyệt/chuyển file qua SFTP, port-forwarding, quản lý key/identity, import từ `~/.ssh/config`. Local-first, secret nằm trong OS keychain, tuân thủ 8 invariant AWOG.

## Mô hình dữ liệu

### SshHost (`~/.awog/ssh-hosts/<id>.json`)
| Field | Kiểu | Ghi chú |
|---|---|---|
| `id` | string | `[a-z0-9][a-z0-9_-]{0,120}` — filename + keychain account |
| `name` | string | Tên hiển thị |
| `host` | string | Hostname / IP |
| `port` | number | Default 22 |
| `user` | string | Username |
| `authMethod` | `'password'\|'key'\|'agent'` | `agent` = dùng ssh-agent (`SSH_AUTH_SOCK`) |
| `identityId?` | string | Ref `SshIdentity` khi `authMethod='key'` |
| `folder?` | string | Nhóm cây (vd `prod/web`) |
| `tags?` | string[] | |
| `jumpHostId?` | string | Ref host khác làm bastion (ssh2 native chaining) |
| `portForwards?` | PortForward[] | Tunnel định nghĩa sẵn |
| `options?` | object | `keepaliveIntervalMs?`, `compression?`, `strictHostKey?` |
| `connectionStatus?` | `'connected'\|'disconnected'\|'error'\|'unknown'` | persisted last status |
| `connectionError?` | string | sanitized |
| `lastConnectedAt?` | string | ISO |
| `createdAt`/`updatedAt` | string | ISO |

**Secret (keychain `awog-ssh`, account `host/<id>`):** password (khi `authMethod='password'`).

### SshIdentity (`~/.awog/ssh-identities/<id>.json`)
| Field | Kiểu | Ghi chú |
|---|---|---|
| `id` | string | filename + keychain account |
| `name` | string | |
| `keyType?` | `'ed25519'\|'rsa'\|'ecdsa'\|'other'` | metadata |
| `keyPath?` | string | Đường dẫn file private key (**plaintext**, không phải secret) |
| `inlineStored` | boolean | true nếu nội dung key lưu trong keychain (paste key thay vì file) |
| `hasPassphrase` | boolean | Cờ để UI biết có passphrase |
| `createdAt`/`updatedAt` | string | ISO |

**Secret (keychain `awog-ssh`, account `identity/<id>`):** `{ type:'passphrase' }` cho keyPath file, hoặc `{ type:'inline-key', privateKey, passphrase? }` khi paste key.

### PortForward (discriminated union `type`)
- `local`: `{ id, type, bindHost?, bindPort, destHost, destPort, label? }` — bind mặc định `127.0.0.1`.
- `remote`: `{ id, type, bindHost?, bindPort, destHost, destPort, label? }`.
- `dynamic`: `{ id, type, bindHost?, bindPort, label? }` — SOCKS proxy.

## RPC (`ssh.*`)

| Method | Vào | Ra |
|---|---|---|
| `ssh.list` | — | `{ hosts, identities }` |
| `ssh.upsert` | `{ host, mode }` | `{ host }` |
| `ssh.delete` | `{ id }` | `{ ok }` (purge secret) |
| `ssh.identityUpsert` | `{ identity, mode }` | `{ identity }` |
| `ssh.identityDelete` | `{ id }` | `{ ok }` |
| `ssh.setCredential` | `{ scope:'host'\|'identity', id, ...secret }` | `{ ok }` (**không echo**) |
| `ssh.importConfig` | — | `{ candidates }` (dry-run, đọc `~/.ssh/config`) |
| `ssh.importConfigApply` | `{ ids }` | `{ imported }` |
| `ssh.test` | `{ id }` | `{ status, error? }` (connect+auth rồi disconnect) — **P2** |
| `ssh.connect` | `{ id, cols, rows }` | `{ connId }` — **P2** |
| `ssh.write`/`resize`/`disconnect`/`connections`/`confirmHostKey`/`exec` | | **P2** |
| `ssh.sftp.*` | | **P3** |
| `ssh.forward.*` | | **P4** |

Events: `ssh:data`, `ssh:exit`, `ssh:status-changed`, `ssh:host-key-prompt`, `ssh:sftp-progress`, `ssh:forward-changed`, `ssh-hosts.fs-changed`.

## User flow chính

1. **Thêm host:** `+` → form (host/port/user, auth method, identity/password, folder/tags/jump/forwards) → save → card xuất hiện trong list.
2. **Import:** `Import from ~/.ssh/config` → chọn candidates → apply → seed hosts.
3. **Connect:** chọn host card → `Connect` → (host lạ) prompt fingerprint TOFU → terminal mở trong detail pane; đa tab qua connections bar.
4. **SFTP:** `SFTP` trên host connected → browser dual-pane → upload/download/rename/delete.
5. **Forward:** `Forward` → thêm tunnel → start → trạng thái active; `curl 127.0.0.1:<port>` thấu qua.

## Acceptance criteria (rút gọn — QA mở rộng ở P5)

- **AC1 CRUD:** tạo/sửa/xoá host + identity persist ra `~/.awog/ssh-hosts|ssh-identities/*.json`; reload app vẫn còn.
- **AC2 Secret:** password/passphrase/key **không** xuất hiện trong file JSON, RPC response, hay log. Xoá host/identity purge keychain (không orphan).
- **AC3 Import:** đọc `~/.ssh/config` read-only, không ghi đè file gốc; candidates map đúng Host/HostName/User/Port/IdentityFile.
- **AC4 Host-key TOFU:** host lạ → prompt fingerprint; reject → không connect; accept → ghi known_hosts, lần sau im lặng; key đổi → cảnh báo "changed".
- **AC5 Connect/terminal:** connect thành công mở shell, gõ lệnh nhận output; disconnect kill channel; auth fail surface lỗi rõ.
- **AC6 SFTP:** list/upload/download/rename/delete đúng; local path validate `assertInsideWorkspace`.
- **AC7 Forward:** local bind `127.0.0.1` mặc định; start/stop; list active.
- **AC8 UI card:** list + detail theo phong cách card, theme token, dark/light, empty/loading/error state đầy đủ.

## Edge case

- Dep `ssh2` thiếu → RPC connect/test throw "SSH unavailable" rõ ràng, CRUD vẫn chạy.
- Keychain unavailable → setCredential throw hint `pnpm install`; CRUD metadata vẫn lưu.
- Host không resolve / timeout → status `error` + message sanitized.
- Jump host lỗi → surface lỗi chuỗi (jump → target).
- Passphrase sai → auth fail rõ, không loop.
- Port bind trùng → lỗi `EADDRINUSE` surface, không crash.

## Bảo mật (xem ADR 0063 §Decision)

Secret keychain-only; host-key TOFU; local-forward 127.0.0.1; jump native (no ProxyCommand shell); SFTP local path guard. **Infosec audit bắt buộc trước release** (surface network + exec + keychain + FS).
