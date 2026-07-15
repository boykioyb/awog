# ADR 0063 — SSH Manager runtime: `ssh2` pure-JS client

- **Trạng thái:** Accepted
- **Ngày:** 2026-07-14
- **Liên quan:** [ADR 0019](0019-pty-terminal-in-sidecar.md) (PTY terminal), [ADR 0018](0018-mcp-secret-keychain.md) (keychain), [ADR 0060](0060-connections-adopt-craft-sources-model.md) (Sources/keychain namespacing), [security.md](../../.claude/rules/security.md)
- **Spec:** [docs/features/ssh-manager.md](../features/ssh-manager.md)

## Context

AWOG cần một trang **SSH Manager đầy đủ tính năng** (host inventory + terminal tương tác + SFTP + port-forwarding + quản lý key/identity + import `~/.ssh/config`). Câu hỏi runtime cốt lõi: engine SSH chạy bằng gì?

- **(A) Wrap binary `ssh` của OS qua node-pty** (tái dùng [terminal manager](../../apps/desktop/sidecar/src/terminal/manager.ts)). Zero dependency mới. Nhưng: SFTP, port-forward, và password-auth **rất hạn chế / phải hack** (sshpass, parse prompt); không có control programmatic để làm file browser hay tunnel manager.
- **(B) `ssh2` (pure-JS SSH2 client, npm `ssh2` của mscdex).** Control programmatic đầy đủ: shell channel, exec, SFTP subsystem, local/remote/dynamic forwarding, jump host chaining, host-key verifier callback. Là dependency mới lớn.

User đã chốt **(B)** vì scope v1 gồm SFTP + port-forward + key mgmt — những thứ (A) không làm sạch được.

## Decision

1. **Runtime = `ssh2`** trong sidecar. Nạp qua **dynamic import + graceful fallback** mirror `getPty()` ([terminal/manager.ts](../../apps/desktop/sidecar/src/terminal/manager.ts)) và keychain `getModule()` → sidecar vẫn boot nếu dep thiếu; RPC connect throw `"SSH unavailable"`. `ssh2` chạy pure-JS (native `cpu-features` chỉ optional-perf), không kéo native binding bắt buộc.

2. **Host-key verification bắt buộc (TOFU).** `hostVerifier` callback so fingerprint với `~/.ssh/known_hosts`. Host lạ / key đổi → **park** connect + emit `ssh:host-key-prompt`, chờ user quyết định qua `ssh.confirmHostKey`; chỉ append known_hosts khi user accept. **Không bao giờ auto-accept** (chống MITM). Đây là surface bảo mật mới so với codebase.

3. **Secret không rời sidecar** (invariant #1). Password / key passphrase / nội dung private key inline → OS keychain, **service mới `awog-ssh`**, account `host/<id>` hoặc `identity/<id>` (tách biệt `awog-mcp`, `awog-source-*`). Config JSON chỉ chứa metadata + cờ, **không plaintext secret**. RPC ghi secret trả `{ ok }`, không echo. `keyPath` (đường dẫn file key) là **plaintext** — không phải secret.

4. **Jump host = ssh2 native chaining** (mở connection tới jump host rồi `forwardOut` sang đích), **KHÔNG** dùng `ProxyCommand` shell-string (tránh command injection từ config).

5. **Port-forward local bind `127.0.0.1` mặc định** (invariant #6 — no port public). Remote-forward + dynamic SOCKS ghi rõ cảnh báo phơi cổng.

6. **Storage = file-per-entity, store song song** (SRP — SSH là bounded-context riêng, không nhồi vào Sources union): `~/.awog/ssh-hosts/<id>.json` + `~/.awog/ssh-identities/<id>.json`, atomic write (tmp → `chmod 0o600` → rename, dir `0o700`) clone [mcp/store.ts](../../apps/desktop/sidecar/src/mcp/store.ts).

## Consequences

- (+) Mở khoá full-featured SFTP/forward/key-mgmt; tái dùng plumbing keychain/store/watcher/RPC có sẵn.
- (+) Model bảo mật nhất quán với Sources (keychain-only, write-only RPC).
- (−) Dependency mới `ssh2` → cần `pnpm audit` clean + theo dõi CVE (pure-JS, maintained, downloads cao).
- (−) Surface bảo mật mới (host-key verify, network egress tới host tuỳ ý user, port-forward) → **bắt buộc infosec audit** trước release.
- SSH manager v1 **user-driven UI only** — connect không expose ra model tool; nếu sau này expose phải gate mutating như `RunWorkflow`.
