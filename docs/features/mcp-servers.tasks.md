# Plan: MCP Servers (Pha 1 — stdio only)

> Spec: [mcp-servers.md](./mcp-servers.md) (Approved, Pha 1 stdio-only)
> ADR: [0014-mcp-servers-stdio-runtime.md](../decisions/0014-mcp-servers-stdio-runtime.md)
>
> Trạng thái codebase đầu vào: UI scaffold (page + 3 component) + type `MCPServer` + mock CRUD trong `workspace` store đã có. Sidecar chưa có module `mcp/`, chưa có RPC `mcp.*`, chưa wire vào `sessions.send-message.ts`.

## DAG ngắn

```
T1 (schema) ─┬─> T2 (store FS) ─┬─> T3 (manager) ─┬─> T4 (RPC methods) ─┬─> T6 (store wire) ─┬─> T7 (events sub)
             │                  │                 │                     │                    │
             │                  │                 │                     ├─> T8a (mcp.author) ┤
             │                  │                 │                     │                    │
             │                  │                 │                     └─> T8c (Editor verify wire)
             │                  │                 │
             │                  │                 └─> T5 (presets) ─────┴─> T8a ─> T8b (PromptCreator Skills-style)
             │
             └────────────────────────────────────> T9 (SDK wire send-message)

T1..T9 ─> T10 (QA) ─> T11 (docs) ─> T12 (review)
```

## MVP scope

- [ ] **T1. Define zod schema + ID validator cho `MCPServer`** — S
  - **Role:** developer
  - **Depends on:** none
  - **Files:** `apps/desktop/sidecar/src/mcp/schema.ts` (new)
  - **Acceptance:** Export `mcpServerSchema` (zod), `mcpServerIdRegex = /^[a-z0-9][a-z0-9-]{0,62}$/`, helper `parseMcpServer(unknown): MCPServer`. Match type `MCPServer` ở [types/index.ts:330](../../apps/desktop/ui/types/index.ts). Reject `transport !== 'stdio'` với message `transport-not-supported` (ADR Q1). Reject id sai regex.
  - **Phục vụ AC:** nền cho AC-1, AC-2, AC-7.

- [ ] **T2. Implement `mcp/store.ts` — per-file JSON CRUD** — M
  - **Role:** developer
  - **Depends on:** T1
  - **Files:** `apps/desktop/sidecar/src/mcp/store.ts` (new)
  - **Acceptance:** `list()`, `read(id)`, `upsert(server)`, `remove(id)` đọc/ghi `~/.awog/mcp-servers/<id>.json`. Reuse atomic write helper từ [`projects/store.ts`](../../apps/desktop/sidecar/src/projects/store.ts) (tmp + rename, mode 0700 dir / 0600 file). `sanitizeChild(id)` chống traversal. File hỏng → skip + log warn, không throw (ADR Q2). `cwd` nếu có phải `path.resolve` + `startsWith(os.homedir())`.
  - **Phục vụ AC:** AC-1 (persist), AC-3 (load lại sau restart), AC-7 (reject path-out-of-scope tại upsert nếu args[*] path nằm ngoài `~`).
  - **Risk:** Cẩn thận sanitize `cwd` + path-like args cho preset filesystem (security invariant #2).

- [ ] **T3. Implement `McpManager` singleton + lifecycle** — L
  - **Role:** tech-lead + developer
  - **Depends on:** T2
  - **Files:** `apps/desktop/sidecar/src/mcp/manager.ts` (new), event bus tích hợp [`transport/rpc.ts`](../../apps/desktop/sidecar/src/transport/rpc.ts) hoặc tương đương để emit `sidecar.event`.
  - **Acceptance:**
    - `start(id)` / `stop(id)` (SIGTERM → 2s → SIGKILL) / `restart(id)` (reset backoff) / `test(serverConfig)` (ephemeral spawn → `initialize` + `tools/list` + `resources/list` → kill ≤ 5s) / `callTool(id, name, args)` (chưa cần dùng pha 1 nhưng expose) / `getSnapshot()` / `shutdown()` (gọi khi sidecar SIGTERM).
    - Spawn dùng `execFile` (không shell), env whitelist (`PATH`, `HOME`, `USER`, `LANG`, `TZ`) merge với `config.env`, lọc `ANTHROPIC_API_KEY` + OAuth token (ADR Q3).
    - Backoff 1s/3s/5s, max 3 crash / 60s → status `error` cứng (AC-5).
    - Emit `mcp.status` khi state đổi; emit `mcp.stderr-line` cho mỗi dòng stderr (ring buffer 100 dòng in-memory per server).
    - Process group: child inherit, dọn sạch khi sidecar exit (POSIX detached: false; Windows windowsHide: true).
  - **Phục vụ AC:** AC-3 (restart-safe), AC-5 (crash backoff), AC-6 (disable kills process), AC-8 (stderr buffer).
  - **Risk:** Windows process group lifecycle chưa test (ghi rõ TODO + để dx-ops verify trước release — đã noted trong ADR).

- [ ] **T4. Thêm 7 RPC methods `mcp.*`** — M
  - **Role:** developer
  - **Depends on:** T3
  - **Files:** `apps/desktop/sidecar/src/methods/mcp.list.ts`, `mcp.upsert.ts`, `mcp.delete.ts`, `mcp.toggle.ts`, `mcp.restart.ts`, `mcp.test.ts`, `mcp.discoverPreset.ts`. Register vào [`index.ts`](../../apps/desktop/sidecar/src/index.ts).
  - **Acceptance:**
    - Mỗi method validate input qua zod ở RPC boundary (security invariant #4, trust level L1).
    - `mcp.list` trả `store.list()` trộn với `manager.getSnapshot()` (status, tools, lastError, lastStartedAt).
    - `mcp.upsert` validate → `store.upsert` → nếu `enabled && autoStart` → `manager.start`.
    - `mcp.delete` → `manager.stop` (nếu running) → `store.remove`.
    - `mcp.toggle` → stop hoặc start tuỳ flag.
    - `mcp.test` không ghi file, chỉ `manager.test()` trả `{ ok, tools?, resources?, error? }` ≤ 5s.
    - `mcp.discoverPreset` đọc preset (T5), không spawn.
  - **Phục vụ AC:** AC-1, AC-2, AC-3, AC-6.

- [ ] **T5. Định nghĩa preset cứng `github` + `filesystem`** — S
  - **Role:** developer
  - **Depends on:** T1
  - **Files:** `apps/desktop/sidecar/src/mcp/presets.ts` (new)
  - **Acceptance:** Export `PRESETS: Record<'github' | 'filesystem', Partial<MCPServer>>`. Mỗi preset có `command`, `args` template (placeholder cho path/env user fill), `env` keys cần (ví dụ `GITHUB_PERSONAL_ACCESS_TOKEN`), `description`, `transport: 'stdio'`, `timeoutMs: 30000`, `trust: 'prompt'`. Hoàn toàn static — không gọi remote (AC-9 offline-safe).
  - **Phục vụ AC:** AC-2, AC-9.

- [ ] **T6. Wire `workspace` store mcpServers section vào sidecar RPC** — M
  - **Role:** developer
  - **Depends on:** T4
  - **Files:** [`apps/desktop/ui/stores/workspace.ts`](../../apps/desktop/ui/stores/workspace.ts) (replace mock CRUD ở dòng 578-610), composable [`useSidecar`](../../apps/desktop/ui/composables/useSidecar.ts).
  - **Acceptance:**
    - `fetchMcpServers()` action gọi `mcp.list` hydrate state khi mount Settings → MCP Servers page.
    - `upsertMCPServer`, `deleteMCPServer`, `toggleMCPServer`, `restartMCPServer` gọi RPC tương ứng, cập nhật cache in-memory sau khi sidecar trả về (giữ snappy UI).
    - Bỏ `setTimeout` giả lập.
  - **Phục vụ AC:** AC-1, AC-2, AC-6.

- [ ] **T7. Subscribe `sidecar.event` cho `mcp.status` + `mcp.stderr-line`** — S
  - **Role:** developer
  - **Depends on:** T6
  - **Files:** `apps/desktop/ui/stores/workspace.ts` (hoặc tách `composables/useMcpEvents.ts` nếu sạch hơn).
  - **Acceptance:** Status badge cập nhật ngay khi event đến (không refetch). Mỗi `mcp.stderr-line` push vào ring buffer 100 dòng per server (trim FIFO) cho tab Logs.
  - **Phục vụ AC:** AC-8 (realtime stderr append).

- [ ] **T8a. Sidecar method `mcp.author` (LLM-driven creator, Skills-style)** — L
  - **Role:** tech-lead + developer
  - **Depends on:** T4, T5
  - **Files:** `apps/desktop/sidecar/src/methods/mcp.author.ts` (new) — pattern reuse từ [`skills.author.ts`](../../apps/desktop/sidecar/src/methods/skills.author.ts).
  - **Acceptance:**
    - Streaming RPC: nhận `{ messageId, prompt, history? }`, drive 1 query agent (Claude Sonnet/Haiku) với tool set `mcp.discoverPreset`, `mcp.test`, `mcp.upsert` exposed.
    - Phát events `mcp.author.chunk`, `mcp.author.step`, `mcp.author.done` qua transport channel.
    - Done payload trả `createdServerId` khi LLM thành công ghi config.
    - Agent system prompt instruct: ưu tiên preset cứng (GitHub/Filesystem) khi match; tự suy `command/args/env` từ mô tả khi user paste config JSON; **bắt buộc** `mcp.test` trước khi `mcp.upsert`.
    - Reuse helper streaming từ `skills.author.ts` (chunk/step emitter) — tách thành `mcp/author-runtime.ts` nếu shared logic > 50 dòng.
  - **Phục vụ AC:** AC-1, AC-2, AC-9 (preset path).
  - **Risk:** LLM có thể gen config sai → mitigated bởi mandatory `mcp.test` step trước `mcp.upsert`.

- [ ] **T8b. Refactor `McpPromptCreator` theo pattern Skills-style** — M
  - **Role:** developer
  - **Depends on:** T8a, T6
  - **Files:** [`apps/desktop/ui/components/mcp/McpPromptCreator.vue`](../../apps/desktop/ui/components/mcp/McpPromptCreator.vue) (rewrite từ wrap `PromptCreatorPanel` sang chat-style log giống [`SkillPromptCreator.vue`](../../apps/desktop/ui/components/skill/SkillPromptCreator.vue)), [`pages/mcp-servers/index.vue`](../../apps/desktop/ui/pages/mcp-servers/index.vue) (`onNew`/`onClose` gọi `fetchMcpServers()` refresh disk-truth sau khi modal đóng).
  - **Acceptance:**
    - Modal anchor tại nút "+ New" với `cardPos` logic tương đương `SkillPromptCreator`.
    - Chat log: user messages + agent streaming text (markdown-rendered) + step list với running/done/error icons.
    - Subscribe `sidecar.event` cho `mcp.author.*`, dispatch đúng `messageId`.
    - Backdrop click bỏ qua khi `isStreaming`.
    - Close modal → page gọi `ws.fetchMcpServers()` → server vừa tạo xuất hiện trong list, auto-select.
    - Toast feedback (success/error) giống Skills page (reuse `pushToast` helper hoặc extract `useToasts` composable nếu cần).
  - **Phục vụ AC:** AC-1, AC-2 (conversational entry vào cả 2).
  - **Lưu ý:** Bỏ wizard 3-step trong spec gốc — pattern Skills-style thay thế. `McpEditor` form vẫn giữ nguyên cho manual edit từ detail view.

- [ ] **T8c. Wire `McpEditor` "Verify" với `mcp.test`** — S
  - **Role:** developer
  - **Depends on:** T6
  - **Files:** [`apps/desktop/ui/components/mcp/McpEditor.vue`](../../apps/desktop/ui/components/mcp/McpEditor.vue)
  - **Acceptance:** Khi user manual edit + click "Verify" → gọi `mcp.test`, hiển thị tool/resource ≤ 5s; fail → show stderr.
  - **Phục vụ AC:** AC-1 (Verify step).

- [ ] **T9. Wire `mcpServers` vào Claude Agent SDK `query()` trong `sessions.send-message.ts`** — M
  - **Role:** developer + tech-lead
  - **Depends on:** T3
  - **Files:** [`apps/desktop/sidecar/src/methods/sessions.send-message.ts`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts)
  - **Acceptance:**
    - Filter `manager.getSnapshot()` → chỉ server `enabled && transport === 'stdio'` và nằm trong `agent.mcpServers` whitelist.
    - Build `mcpServersForSdk` theo signature SDK option (ADR Q4 code sample).
    - Pass vào `query({ mcpServers })`.
    - Trace ghi `tool` node với `mcpServerId` (AC-4).
  - **Phục vụ AC:** AC-4.
  - **Risk:** SDK spawn process per-session → status `running` từ McpManager phản ánh `mcp.test` gần nhất, không phải session live. Đã accepted trong ADR Q4 trade-off — không cần fix pha 1.

- [ ] **T10. QA — viết test case + verify 9 AC** — M
  - **Role:** qa-tester
  - **Depends on:** T1..T9
  - **Files:** `docs/features/mcp-servers.test-cases.md` (new) — checklist manual test theo 9 AC + edge cases trong spec.
  - **Acceptance:**
    - Test happy path AC-1, AC-2 với preset filesystem thật (`npx -y @modelcontextprotocol/server-filesystem /tmp`).
    - Test AC-3: kill sidecar, restart, verify 2 server tự lên trong ≤ 2s.
    - Test AC-5: chạy command bad (`command=false`) → verify 3 retry rồi `error` cứng.
    - Test AC-6: toggle disable → SIGTERM trong ≤ 2s.
    - Test AC-7: nhập args = `["/etc/passwd"]` hoặc `../../etc` → reject `path-out-of-scope`.
    - Test AC-8: trigger stderr → verify Logs tab có 100 dòng đảo ngược, realtime.
    - Test AC-9: tắt mạng, click preset → form fill ok.
    - Edge cases: command ENOENT, env-missing var, duplicate id, stdout non-JSON.
  - **Phục vụ AC:** all 9.

- [ ] **T11. Doc-sync** — S
  - **Role:** developer (boy scout)
  - **Depends on:** T1..T9
  - **Files:**
    - [`apps/desktop/ui/README.md`](../../apps/desktop/ui/README.md) — đánh dấu route `mcp-servers` đã wire (bỏ "mock" tag).
    - [`CLAUDE.md`](../../CLAUDE.md) — thêm `~/.awog/mcp-servers/` vào folder map (sau dòng "Storage").
    - [`docs/architecture/data-model.md`](../architecture/data-model.md) — thêm entity `MCPServer` + path storage nếu chưa có.
    - [`docs/features/mcp-servers.md`](./mcp-servers.md) — đổi status từ "Approved" thành "Implemented (Pha 1)".
  - **Acceptance:** Grep `~/.awog/mcp-servers` ra trong CLAUDE.md + data-model.md. README không còn note "mock".

- [ ] **T12. Code review pass** — S
  - **Role:** code-reviewer (+ infosec gate)
  - **Depends on:** T1..T11
  - **Acceptance:**
    - Infosec check: 8 invariant pass — đặc biệt #2 path sanitize (T2, T7-spec), #4 IPC boundary (UI không import `child_process`), #8 no eval trên payload args (T3 dùng `execFile` không shell).
    - `pnpm lint && pnpm typecheck` xanh ở `apps/desktop/ui`.
    - Sidecar build xanh.
    - Không có `any`, không `@ts-ignore`, không hardcode secret.

## Backlog (sau MVP / Pha 2)

- [ ] **B1. Transport `http` + `sse`** — L — với SSRF allowlist host, OAuth flow ngoài.
- [ ] **B2. Secret injection `${secret:...}` qua OS keychain** — M — phụ thuộc [settings.md](./settings.md) keychain wire.
- [ ] **B3. Per-agent / per-tool trust override** — M — phụ thuộc human-approval feature.
- [ ] **B4. Sandbox stdio (macOS sandbox-exec / Linux namespace)** — L.
- [ ] **B5. Hot reload schema khi tool list đổi** — M.
- [ ] **B6. Idle stop sau 5 phút (autoStart=false lazy)** — S — defer trong ADR Q3.
- [ ] **B7. McpManager giữ persistent process, bridge transport tới SDK** — L — fix UI status không 100% live (ADR Q4 trade-off).
- [ ] **B8. Remote registry discovery thay cho preset cứng** — M.

## Open questions (đã liệt kê trong spec, chưa giải quyết — defer pha 2)

- Force re-init khi tool list đổi giữa các phiên?
- Per-tool trust granularity?
- Sandbox: bắt buộc hay opt-in?
- Pin version qua `npx -y pkg@x.y.z` hay latest?
- Registry: Anthropic list, tự maintain, hay cả hai?

## Missing from spec

Không có. Spec + ADR đủ chi tiết để decompose. Nếu trong quá trình implement phát sinh thắc mắc (ví dụ format exact của `mcpServersForSdk` khi SDK version bump), quay lại BA + TL trước khi tự quyết.
