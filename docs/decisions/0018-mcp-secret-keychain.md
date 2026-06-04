# 0018 — MCP secret storage: OS keychain via `@napi-rs/keyring`

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-29
- **Người quyết định:** Tech Lead

## Bối cảnh

MCP servers cần nhận credential từ user — env vars (`GITHUB_PERSONAL_ACCESS_TOKEN`, `NOTION_TOKEN`...) cho stdio transport, header values (`Authorization: Bearer xxx`) cho http transport.

Pha 1-2A lưu plaintext trong `~/.awog/mcp-servers/<id>.json`:

```json
{
  "id": "github",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxx"
  }
}
```

Vấn đề:
- **Plaintext on disk** — chỉ chmod 0600 bảo vệ khỏi user khác trên cùng máy, không bảo vệ khỏi accidental git commit, log leak, dotfile sync (Dropbox/iCloud nếu user để `~/.awog/` trong sync), debug bundle.
- **Audit pain** — `mcp.test`/`mcp.author` log gọi RPC có thể vô tình dump config kèm token nếu developer thêm `JSON.stringify(config)`.
- **Backup risk** — `~/.awog/` được copy/clone giữa máy → token cũng theo.

Cần móc credential ra khỏi file JSON.

## Quyết định

### Q1. Dùng OS keychain, dep `@napi-rs/keyring`

Sử dụng API native của hệ điều hành để lưu secret:
- **macOS**: Keychain Services
- **Linux**: Secret Service / KWallet (qua libsecret)
- **Windows**: Credential Manager (DPAPI)

Chọn package: **`@napi-rs/keyring`** thay vì `keytar`:

| Tiêu chí | `keytar` | `@napi-rs/keyring` |
|---|---|---|
| Maturity | Established, Atom team, 7+ năm | 2-3 năm, napi-rs ecosystem |
| Prebuilt binaries | Có (node-gyp fallback nếu fail) | Có (napi-rs prebuilt, không cần node-gyp) |
| Install footprint | ~10MB (gyp + binding) | ~3MB (prebuilt .node only) |
| Maintenance | Slow lately | Active, modern napi v3 |
| API | callback/promise | promise (cleaner async) |

`@napi-rs/keyring` win vì cài đặt nhẹ hơn, không cần Python/node-gyp khi user lần đầu chạy app (giảm friction onboard).

### Q2. Placeholder syntax: `secret:KEY_NAME` prefix

Saved values trong JSON dùng prefix `secret:` để đánh dấu là keychain reference:

```json
{
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "secret:GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "headers": {
    "Authorization": "secret:notion_bearer"
  }
}
```

Khi spawn/fetch, sidecar lookup `getSecret(serverId, KEY_NAME)` từ keychain, expand thay chuỗi gốc.

Lý do prefix:
- **Round-trip safe** — value plaintext (vd. `"endpoint=https://..."`) không bị nhầm là secret.
- **Đơn giản hơn `${secret:...}`** — không cần regex parser; chỉ check `startsWith('secret:')`.
- **Forward-compat** — pha 3 có thể thêm `env:VAR_NAME` (đọc từ process env) hoặc `1password:item` (nếu user yêu cầu) cùng pattern.

### Q3. Keychain key namespacing

Service name (top-level grouping in OS keychain): `awog-mcp`. Account name (per-secret key) follows `<server-id>/<env-or-header-name>`:

```
awog-mcp · github/GITHUB_PERSONAL_ACCESS_TOKEN → ghp_xxx
awog-mcp · notion-cloud/notion_bearer → secret_xxx
```

User xem trong Keychain Access (macOS) thấy rõ thuộc về AWOG, server nào, env name nào.

### Q4. Lifecycle: extract on save, expand on use

- **Save (`mcp.upsert`)**: UI mark value là secret → sidecar `setSecret(serverId, key, plaintextValue)` → trong JSON ghi `secret:<key>`. Nếu user gỡ mark → đảo ngược: `getSecret` ra plaintext, ghi vào JSON, `deleteSecret`. Atomicity acceptable trade-off (race window nhỏ; failure = secret vẫn trong keychain + JSON có cả hai → UI re-render sẽ thấy plaintext lộ → user redo).
- **Use (spawn/fetch)**: `mcp/secrets.ts expandSecrets(record, serverId)` chạy ngay trước `spawn`/`fetch`. Không cache (cheap call, OS-level).
- **Delete (`mcp.delete`)**: enumerate env/headers, gọi `deleteSecret` cho mỗi `secret:` placeholder, rồi `unlink` JSON file.

### Q5. UI surface

`McpEditor.vue` KV editor cho env + headers thêm trạng thái per-row:
- **Plaintext** (default): input field bình thường, value visible.
- **🔒 Keychain**: input field show `••••••` mask, user phải re-enter để thay đổi. Toggle button "🔓 Convert to plaintext" + "🔒 Store in keychain" để chuyển.

Khi tạo MCP từ chat creator (`mcp.author`): LLM mặc định ghi env name + value plaintext (vì LLM không có context "user muốn keychain"). Sau khi save, user vào McpEditor toggle 🔒 cho từng row nhạy cảm.

## Phương án đã cân nhắc

### Lưu file riêng `~/.awog/mcp-secrets/<id>.json` chmod 0600

- **Từ chối**: vẫn plaintext on disk, chỉ tách bằng tên file. Không gain gì so với chmod 0600 trên file gốc. Không bảo vệ khỏi backup/sync.

### Encrypt file với master key

- **Từ chối**: master key vẫn phải lưu đâu đó. Lưu trong keychain → đã dùng keychain rồi, kéo dài chain mà không lợi ích.

### Shell-out tới `security` (macOS) / `secret-tool` (Linux) / PowerShell DPAPI

- **Từ chối**: fragile cross-OS, dependency on user PATH having those binaries, parse output → easy to break. Native binding của keychain library handle robust.

### Skip keychain, document "don't commit ~/.awog/ to git"

- **Từ chối**: trade UX safety cho user (mistakes happen) lấy implementation simplicity. AWOG nói "local-first" → phải lo cho user khỏi self-inflicted leak.

## Hệ quả

- **Tích cực:**
  - Token không bao giờ chạm disk dưới dạng plaintext.
  - `~/.awog/` an toàn để backup/share JSON file (chỉ placeholder).
  - Tương thích với Anthropic OAuth pattern đã dùng (credentials.json + token-manager) — same security mindset.
- **Tiêu cực / Trade-off:**
  - **Native dep**: `@napi-rs/keyring` cần prebuilt binary cho platform. Nếu user chạy CPU/OS hiếm gặp (BSD, ARM Linux non-glibc) sẽ phải build manually. Chấp nhận — AWOG hỗ trợ macOS + Linux + Windows mainstream.
  - **Cross-machine portability mất**: user move `~/.awog/` sang máy khác → JSON còn nguyên `secret:` placeholder, keychain thì không → MCP servers fail. Phải re-enter qua McpEditor. Document rõ.
  - **Linux Secret Service requirement**: cần `gnome-keyring` hoặc `kwallet` running. Headless server không có DBus → fail. Pha 2 acceptable (target: desktop user). Pha 3 cân nhắc fallback file-encrypted.
  - **UI complexity**: McpEditor KV row có 2 mode, edge case "value đã keychain nhưng user xóa key name" cần xử lý → cleanup orphan.
- **Việc cần làm tiếp:**
  - Pha 2 B2 implement.
  - Pha 3: migration command "import all keychain secrets to/from encrypted file" cho headless server use case.
  - Pha 3: UI hint khi sync `~/.awog/` giữa máy ("re-enter secret on new machine").

## Tham chiếu

- [ADR 0014 — MCP Servers stdio runtime](./0014-mcp-servers-stdio-runtime.md) — pha 1 spawn env, pha 2A B3 http headers.
- [ADR 0011 — Anthropic subscription OAuth](./0011-anthropic-subscription-oauth.md) — pattern lưu credential local-first (credentials.json chmod 0600). Keychain extend pattern này cho per-server secrets.
- [`.claude/rules/security.md`](../../.claude/rules/security.md) — invariant 1 (API key không rời sidecar).
- [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring) — npm package.
