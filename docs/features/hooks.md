# Feature: Hooks

**Trạng thái:** v1 implemented — execution/IPC contract: [ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md)

> **Trạng thái implement (v1, 2026-06-11):** engine đã wired thật.
> - **Sidecar:** [`hooks/store.ts`](../../apps/desktop/sidecar/src/hooks/store.ts) (2-tier JSON + run-log JSONL + trust), [`hooks/dispatcher.ts`](../../apps/desktop/sidecar/src/hooks/dispatcher.ts) (match/template/spawn/secret/audit/emit + cache), [`hooks/tool-anchor.ts`](../../apps/desktop/sidecar/src/hooks/tool-anchor.ts); RPC `hooks.{list,upsert,delete,toggle,run-once,trust}`.
> - **Anchor đã wire:** `tool.before-call`/`tool.after-call` + `artifact.before-write`/`artifact.after-write` (wrap tool factory — session + task, gồm MCP tool) + `task.after-complete` + `phase.after-approve` (engine). **Defer follow-up:** `task.before-start`, `phase.before-run`/`after-run`, `phase.before-approve`, `agent.*`, `mcp.server-error`, `session.reset`.
> - **Import Claude Code hooks (parity với Rules):** ngoài 2 tier AWOG-native, tự đọc read-only hook từ `~/.claude/settings.json` (`claude-user`) + `{project}/.claude/settings.json[.local]` (`claude-project`/`claude-local`). Map `PreToolUse→tool.before-call`, `PostToolUse→tool.after-call`; chạy với **stdin shape Claude Code** + `$CLAUDE_PROJECT_DIR` (script CC chạy nguyên trạng); imported project **trust-gated**; dispatch **ưu tiên project trước global**.
> - **UI (parity với Skills/Agents):** [`stores/workspace.ts`](../../apps/desktop/ui/stores/workspace.ts) hook actions gọi sidecar (bỏ mock; `INITIAL_HOOKS` chỉ còn fallback browser-dev) + `hookScanReports`; [`HookEditor.vue`](../../apps/desktop/ui/components/hook/HookEditor.vue) có **source picker global/project**; trust banner + badge nguồn/`⚠`/Lock ở [`HookDetail.vue`](../../apps/desktop/ui/components/hook/HookDetail.vue) / list (imported read-only); **gom theo project + collapse** như Skills; **Refresh + scan-report toast + empty state**; live `hook.run`; **fs-watcher** `hooks.fs-changed`.
> - **Defer:** `hooks.set-secret` cho env `secret:KEY`; live-watch `.claude/settings.json` (refresh-driven); các anchor lifecycle còn lại.

## Overview

Hook là **script do user định nghĩa** chạy tự động khi một **event** trong AWOG xảy ra: trước/sau agent chạy, sau khi artifact ghi, khi task complete, khi cần approval, … Hook là điểm mở rộng cho phép user gắn logic custom (gửi notification, validate artifact, format code, push lên remote) mà không sửa core.

Cảm hứng từ Claude Code hooks: hook nhận event payload qua stdin, có thể block hành động bằng exit code khác 0, có thể inject context bằng stdout.

## User Stories

- Là người dùng, tôi muốn chạy `prettier` mỗi khi agent ghi file `.ts` → đảm bảo style nhất quán.
- Là người dùng, tôi muốn gửi notification tới Slack khi task `completed` hoặc `failed`.
- Là người dùng, tôi muốn block agent ghi đè file nằm trong `.gitignore` (tránh leak secret).
- Là người dùng, tôi muốn auto-commit artifact sau mỗi phase approved.
- Là người dùng, tôi muốn log mọi tool call ra file riêng để audit.

## Event taxonomy

| Event | Khi | Payload chính | Block được? |
|---|---|---|---|
| `task.before-start` | Trước khi task chuyển từ `queued` → `running` | task | ✓ |
| `task.after-complete` | Khi task chuyển sang `completed`/`failed` | task, result | ✗ |
| `phase.before-run` | Trước khi phase chạy (mỗi run version) | phase, runIndex | ✓ |
| `phase.after-run` | Sau khi phase ra output | phase, output | ✗ |
| `phase.before-approve` | Trước khi user click Approve | phase | ✓ |
| `phase.after-approve` | Sau khi approve thành công | phase | ✗ |
| `artifact.before-write` | Trước khi sidecar ghi artifact ra đĩa | path, contentPreview | ✓ |
| `artifact.after-write` | Sau khi ghi xong | path, size, hash | ✗ |
| `agent.before-prompt` | Trước khi gửi prompt tới LLM | agent, messages, model | ✓ (có thể edit prompt) |
| `agent.after-response` | Sau khi LLM trả response | agent, response, usage | ✗ |
| `tool.before-call` | Trước khi gọi tool (built-in hoặc MCP) | toolName, args, agent | ✓ |
| `tool.after-call` | Sau khi tool trả | toolName, args, result, durationMs | ✗ |
| `mcp.server-error` | Khi MCP server crash | serverId, exitCode, stderr | ✗ |
| `session.reset` | Khi session bị reset | sessionId, agentId | ✗ |

> **Block được** = exit code ≠ 0 → AWOG abort hành động đi kèm và show stderr cho user.

## Hook list view

- Search box, **event filter** (multi-select), enabled/disabled filter.
- Item: name + event badge + matcher tóm tắt + dot trạng thái (xanh = enabled, xám = disabled, đỏ = last run failed).
- "+ New Hook" mở editor.

## Hook detail view

- Name + event badge + description.
- 3 action: **Edit**, **Run once** (manual trigger với mock payload), **Delete**.
- **Matcher** — điều kiện chi tiết (xem dưới).
- **Command** — code block, executable.
- **Execution stats** — last run, success rate (7 ngày), avg duration.
- **Recent runs** — 20 dòng gần nhất: timestamp, duration, exit code, stderr snippet.

## Hook editor

- **Name** (slug auto kebab-case).
- **Description**.
- **Event** dropdown (event taxonomy ở trên).
- **Matcher** — JSON path expression filter payload, ví dụ:
  - `artifact.before-write` matcher `path: "*.ts"` → chỉ chạy cho file TypeScript.
  - `phase.after-run` matcher `phase.status: "failed"` → chỉ chạy khi phase fail.
- **Command** — shell command. Hỗ trợ template `{{event.payload.path}}` thay vào trước khi chạy.
- **Working dir** — default = workspace root.
- **Timeout (ms)** — default 30000, max 300000.
- **Run mode**:
  - `blocking` — AWOG đợi hook xong rồi mới tiếp.
  - `background` — fire-and-forget, không block, không thể abort hành động.
- **Enabled** toggle.

## Thuộc tính Hook

| Field | Kiểu | Mô tả |
|---|---|---|
| `id` | string | Slug duy nhất |
| `name` | string | Tên hiển thị |
| `description` | string | Mô tả ngắn |
| `event` | enum | Một trong event taxonomy ở trên |
| `matcher` | object | Map `jsonPath` → giá trị/glob filter (AND giữa các key) |
| `command` | string | Shell command, hỗ trợ `{{...}}` template |
| `cwd` | string | Default workspace root |
| `timeoutMs` | number | Default 30000 |
| `runMode` | enum | `blocking` / `background` |
| `enabled` | boolean | |
| `env` | Record<string,string>? | Env vars bổ sung, hỗ trợ `${secret:...}` |

### Ví dụ cấu hình

```json
{
  "id": "prettier-ts",
  "name": "Prettier on TS files",
  "event": "artifact.after-write",
  "matcher": { "path": "**/*.{ts,vue,json}" },
  "command": "pnpm exec prettier --write {{event.payload.path}}",
  "cwd": "${workspace}",
  "timeoutMs": 10000,
  "runMode": "background",
  "enabled": true
}
```

```json
{
  "id": "block-gitignored",
  "name": "Block write to .gitignored paths",
  "event": "artifact.before-write",
  "matcher": {},
  "command": "node ./.awog/hooks/check-gitignore.mjs",
  "timeoutMs": 5000,
  "runMode": "blocking",
  "enabled": true
}
```

## Cách hook chạy

1. Sidecar fire event với payload (object JSON).
2. Sidecar match hook theo `event` + `matcher`.
3. Với mỗi hook match:
   - Render `command` (thay `{{...}}`).
   - Spawn process: stdin = `JSON.stringify(payload)`, env = merged, cwd = resolved.
   - `blocking` → await exit code; `background` → fire-and-forget.
4. Xử lý kết quả:
   - **Exit 0** + event block được + stdout có JSON → merge stdout vào payload (cho phép hook *modify* payload, ví dụ inject context vào prompt).
   - **Exit ≠ 0** + event block được → abort hành động, show stderr trong UI.
   - **Exit ≠ 0** + event không block được → log warning, không abort.
   - **Timeout** → kill process, log, treat as exit 124.

### Payload contract

Payload là JSON với schema cố định per event. Ví dụ `artifact.before-write`:

```json
{
  "event": "artifact.before-write",
  "ts": "2026-05-25T10:00:00.000Z",
  "taskId": "task-abc",
  "phaseId": "design-arch",
  "payload": {
    "path": "/Users/alice/workspace/tasks/task-abc/artifacts/architecture.md",
    "contentPreview": "# Architecture\n\n...",
    "size": 4096,
    "agent": "solution-architect"
  }
}
```

> Schema chi tiết per event document trong code: `apps/desktop/sidecar/src/hooks/events.ts` (sau khi implement).

## Lưu trữ dữ liệu

> Chốt ở [ADR 0032 D-3/D-5](../decisions/0032-hook-execution-engine-ipc-contract.md): **2 tier** như Workflows (supersede layout `workspace/hooks/` ban đầu).

- Global (dùng chung): `~/.awog/hooks/<hook-id>.json`
- Project (đi theo repo, git-track): `{project.path}/.awog/hooks/<hook-id>.json`
- `source`/`projectId` suy ra từ vị trí file, không lưu trong JSON.

Recent runs (audit log) → `~/.awog/hooks/.runs/<hook-id>.jsonl` (rolling, giữ 1000 dòng, không commit Git).

Quyết định trust cho hook project-tier → `{project.path}/.awog/.trust.json` ([ADR 0032 D-8](../decisions/0032-hook-execution-engine-ipc-contract.md)).

Script tự viết (Node, Python, shell) đặt ở `{project}/.awog/hooks/` — user tự quản, AWOG không tạo template tự động.

## UI/UX Notes

- **Settings → Hooks** (section bổ sung).
- Khi hook block một hành động, hiển thị **banner top** trong Task view: tên hook + stderr + nút "Disable temporarily".
- Khi nhiều hook match cùng event, chạy **tuần tự theo `id` alphabet** (deterministic). Một fail → các hook sau vẫn chạy (trừ khi đó là blocking event → abort).
- Hook chạy trong **background** không nên log nhiều — tránh spam UI; chỉ surface khi exit ≠ 0.

## Bảo mật

- **Hook chạy với quyền user OS** — như terminal bình thường. **Cảnh báo rõ trong UI** khi tạo hook lần đầu: "Hook chạy code tùy ý, chỉ tạo hook từ nguồn bạn tin cậy".
- **Không expand `${secret:...}`** trong `command` (chỉ trong `env`) — tránh secret in vào process list.
- **Workspace path expansion** — `${workspace}` chỉ resolve qua sidecar, không phải shell variable.
- **Matcher không eval code** — JSON path + glob only, không regex để tránh ReDoS.
- **Audit log** ghi mọi hook run với exit code → user track được khi gì block cái gì.
- **Disabled state** giữ config nhưng không chạy — user có thể tạm tắt khi debug.

## Phụ thuộc

- [task-execution-engine](./task-execution-engine.md) — fire event task/phase.
- [artifact-system](./artifact-system.md) — fire event artifact.
- [agent-trace](./agent-trace.md) — fire event agent/tool, ngược lại nhận log hook run.
- [mcp-servers](./mcp-servers.md) — fire event `mcp.server-error`.
- [settings](./settings.md) — Hooks section.

## Out of Scope

- **JavaScript hook in-process** (như VS Code extension) — chỉ subprocess.
- **GUI builder cho matcher** phức tạp — text input JSON path là đủ trong MVP.
- **Hook chia sẻ qua marketplace** — sau MVP.
- **Conditional chain** (hook A success → hook B chạy) — dùng shell scripting để compose.

## Câu hỏi mở

> Phần lớn đã chốt ở [ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md):

- ~~**priority field** thay vì sort theo id?~~ → **Defer** (D-9): v1 sort theo `id` alphabet, deterministic.
- ~~Hook `agent.before-prompt` modify messages re-validate token?~~ → **Defer v2** (D-12): v1 chỉ block, không modify payload.
- ~~Auto-disable sau N fail (giống MCP)?~~ → **Không** ở v1 (D-10): chỉ surface, tránh tự tắt guard quan trọng.
- Hook có quyền gọi **AWOG API** ngược lại (đọc artifact, query store)? → **Out of scope v1**; hook nhận đủ payload qua stdin.
- Hook chạy khi sidecar đang start? → Hook chỉ fire trong vòng đời run đang active; **không** queue ở v1.
