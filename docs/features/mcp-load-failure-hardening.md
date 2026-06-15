# Gia cố lỗi nạp MCP server (anti-fabrication) + PATH + secret keychain

## Bối cảnh

Trong session `ses-mqew3ayf-4`, user yêu cầu review một PR GitHub với MCP server
`sora-hoa` (`@modelcontextprotocol/server-github`) đã được attach. Model **bịa
hoàn toàn** bản review (AC, hằng số, tên hàm), rồi sau khi bị bắt lại **bịa lần
hai** ("đã lấy được dữ liệu thật", head sha, CI xanh).

Điều tra log Electron (`~/Library/Logs/@awog/desktop/main.log`) tìm ra chuỗi
nhân-quả thật:

1. App chạy từ Finder/Dock → `process.env.PATH` tối thiểu (thiếu
   `/opt/homebrew/bin`). MCP bridge `spawn('npx', …)` → `ENOENT`.
2. Bridge `runtime/tools/mcp-tools.ts` spawn per-turn, `initialize` + `tools/list`
   với timeout **hardcode 10s**; cold-start `npx -y` vượt 10s →
   `MCP request timeout: initialize`.
3. Fail chỉ `log.warn` rồi **`return []` (skip im lặng)** — không báo cho model
   lẫn UI. **0 tool `mcp__sora-hoa__*` được đăng ký.**
4. System-prompt nudge (`sessions.send-message.ts`) lại *hứa* với model rằng
   `mcp__sora-hoa__*` tồn tại và bảo ưu tiên dùng. Model gọi → "tool not found"
   trên mọi tên → **không dừng mà bịa kết quả.**

Phụ: 2 file `~/.awog/mcp-servers/*.json` chứa **GitHub PAT plaintext** — vi phạm
[ADR 0018](../decisions/0018-mcp-secret-keychain.md) (secret phải qua keychain).

## Thay đổi

Bốn phần, đều ở **sidecar** (không đổi IPC contract ra UI):

### A. Augment PATH tại boot — `util/spawn-path.ts`

`ensureUserPath()` gọi một lần ở đầu `index.ts`, trước mọi spawn. Đọc PATH của
login shell (`$SHELL -ilc`, best-effort, timeout 2s, marker chống nhiễu rc) rồi
union thêm các thư mục quen thuộc (`/opt/homebrew/bin`, `/usr/local/bin`, …).
Sửa root cause `npx`/`git`/`pty` ENOENT cho mọi consumer (đều forward
`process.env.PATH`). No-op trên Windows.

### B. Surface lỗi nạp MCP cho model (anti-fabrication) — `runtime/tools/`

- `createMcpToolDefinitions` / `createRuntimeToolDefinitions` trả `{ tools,
  failures }` thay vì chỉ `tools[]`. Mỗi server fail → `McpLoadFailure { serverId,
  reason }`.
- `buildMcpUnavailableNote()` sinh khối `<mcp-unavailable>` liệt kê server fail +
  lý do, **chỉ thị model KHÔNG gọi tool vắng mặt và KHÔNG bịa kết quả**, nếu cần
  thì báo user là server unavailable rồi dừng.
- Tiêm note vào systemPrompt ở cả 3 đường: `run-stream.ts` (Sessions),
  `invoke.ts` (Tasks), `task-tool.ts` (subagent delegate).

### C. Honor timeout cấu hình — `runtime/tools/mcp-tools.ts`

Bỏ hardcode 10s. Dùng `server.timeoutMs` (clamp `[20s, 60s]`, default 20s) cho
`initialize` + `tools/list`. `timeoutMs` được thêm vào resolved
`McpServerConfig` (`runtime/permission-types.ts`) và truyền từ
`sessions.send-message.ts` + `tasks/agent-context.ts`.

### E. Chỉ thị verify / anti-fabrication luôn-bật — `runtime/prompts.ts`

`VERIFY_PROMPT` (khối `<verification>`) được append **vô điều kiện** vào mọi turn
(Sessions `run-stream.ts`, Tasks `invoke.ts`, subagent `task-tool.ts`) — không
phụ thuộc agent/tool. Nội dung: chỉ khẳng định điều đã thực sự quan sát trong
turn; tool fail / nguồn thiếu → báo rõ và dừng, **không bịa** kết quả; review/đánh
giá chỉ dựa trên code/diff/output thật đã đọc (không bịa AC, hằng số, tên hàm,
path, kết quả CI). Lý do trực tiếp: "fabrication leads to wrong assessments and
wrong code". Append SAU prompt riêng của agent, không đè block identity của OAuth
(ADR 0029).

### D. Secret → keychain — `mcp/secrets.ts` + `mcp/store.ts`

- `isSecretKey(name)` (cùng pattern `SECRET_RE` của logger) +
  `keychainizeRecord(serverId, record)`: chuyển mọi value plaintext có key
  "secret-looking" vào keychain, thay bằng `secret:KEY`. Best-effort.
- `saveServer` gọi `keychainizeRecord` trên `env`+`headers` trước khi ghi →
  **boundary enforcement**: plaintext không bao giờ chạm đĩa.
- `migrateMcpPlaintextSecrets()` chạy ở boot: quét config cũ còn plaintext →
  chuyển keychain + rewrite ref. Idempotent.

## Kiểm chứng

Tái hiện đúng kịch bản GUI-launch trên dist build thật:

| Trạng thái | Kết quả |
|---|---|
| PATH tối thiểu (Finder) | `tools: 0`, `failures: [{sora-hoa, "MCP request timeout: initialize"}]` — đúng log gốc, nhưng nay **failure được trả về** (sinh note cho model) |
| Sau `ensureUserPath()` | PATH có `/opt/homebrew/bin`; `tools: 26`; `mcp__sora-hoa__get_pull_request` đăng ký OK |
| `keychainizeRecord` | token → `secret:GITHUB_PERSONAL_ACCESS_TOKEN`, non-secret pass-through, keychain round-trip khớp |

`pnpm typecheck` (sidecar): EXIT 0.

## Liên quan / chưa làm

- Implement đúng [ADR 0018](../decisions/0018-mcp-secret-keychain.md); gia cố bridge
  của [ADR 0014](../decisions/0014-mcp-servers-stdio-runtime.md) /
  [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md). Không cần ADR mới.
- **Follow-up (chưa làm):** banner UI cảnh báo "MCP server X unavailable" trong
  Session/Task (hiện chỉ surface cho model + log). Cần thêm event + handler UI.
- **Hành động vận hành (ngoài code):** 2 PAT đã lộ ra terminal khi điều tra → user
  **phải revoke + tạo lại**; migration chỉ chuyển token (đã lộ) vào keychain, không
  khôi phục được tính bí mật.
