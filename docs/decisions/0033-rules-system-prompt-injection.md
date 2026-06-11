# 0033 — Rules: workspace instruction injection into system prompt

- **Trạng thái:** Accepted — v1 implemented (2026-06-11)
- **Ngày:** 2026-06-11
- **Người quyết định:** Tech Lead

## Bối cảnh

Người dùng muốn AWOG có "rules" tự động nạp vào ngữ cảnh agent — tương tự cách Claude Code đọc `CLAUDE.md` / `.claude/rules/*.md`. Trước đó sidecar **không** tự đọc bất kỳ file instruction nào của project; systemPrompt chỉ đến từ `agent.systemPrompt` (REPLACE, [ADR 0015](./0015-agents-persisted-runtime-systemprompt.md)) + vài append cứng (MCP nudge, plan-mode, TodoWrite).

ADR này chốt contract cho **Rules** — entity mới: file Markdown người dùng soạn, tự động chèn vào system prompt mọi session + task. Mirror pattern Skills/Hooks (per-file 2-tier). Phải tuân thủ [ADR 0015](./0015-agents-persisted-runtime-systemprompt.md) (không phá quan hệ systemPrompt) + [`.claude/rules/security.md`](../../.claude/rules/security.md).

## Quyết định

| # | Vấn đề | Quyết định | Rationale |
|---|--------|------------|-----------|
| D-1 | Lưu trữ | **Per-file Markdown, 2 tier** như Skills/Hooks: global `~/.awog/rules/<id>.md` + project `{project}/.awog/rules/<id>.md`. Frontmatter `name`/`description`/`enabled`; body = instruction. `source`/`projectId` location-derived. | Đồng nhất convention; project rule đi theo repo. Tái dùng [`skills/frontmatter.ts`](../../apps/desktop/sidecar/src/skills/frontmatter.ts). |
| D-2 | Cơ chế inject | **Append vào `systemPromptAppend`** (augment, KHÔNG replace) — bọc trong `<workspace-rules>`. Chèn ở [`run-stream.ts`](../../apps/desktop/sidecar/src/runtime/run-stream.ts) (session) + [`invoke.ts`](../../apps/desktop/sidecar/src/runtime/invoke.ts) (task). | Rule là policy xuyên suốt, không phải identity của agent; phải cộng thêm chứ không đè `agent.systemPrompt` (ADR 0015). |
| D-3 | Phạm vi | **Sessions + Tasks.** Global rule áp mọi nơi; project rule áp session/task thuộc project đó (resolve theo `args.projectId` / `args.projectIds[0]`). | User chốt scope. Nhất quán với cách hook anchor lấy projectId. |
| D-4b | Edit imported (Amended 2026-06-11) | Imported rule **edit được trong app**, ghi `body` verbatim về file gốc (CLAUDE.md / .claude/rules) — KHÔNG thêm frontmatter. Chỉ body editable; name/source/enabled khoá. (User đảo quyết định read-only ban đầu.) |
| D-4 | Nguồn | **AWOG-native + import read-only Claude Code** (*Amended 2026-06-11*, đảo quyết định ban đầu "native only"). Editable: `~/.awog/rules`, `{project}/.awog/rules`. Imported read-only (`readOnly:true`, luôn enabled): `{project}/CLAUDE.md` (`claude-project`), `{project}/.claude/rules/*.md` (`claude-rules`), `~/.claude/CLAUDE.md` (`claude-user`). **Ưu tiên** CLAUDE.md → đặt trước AWOG-native trong prompt (thứ tự: claude-project → claude-rules → claude-user → project → global). | User yêu cầu đọc + ưu tiên CLAUDE.md/.claude/rules. Imported read-only (edit qua file gốc) để tránh AWOG ghi đè cú pháp `@import` của CLAUDE.md. |
| D-5 | Applicability | v1: **mọi rule `enabled` đều áp** (không glob/path-scope). | KISS/YAGNI — runtime chưa có per-file context để match glob; thêm sau là additive. |
| D-6 | RPC + cache | Per-command `rules.{list,upsert,delete,toggle}`; inject helper [`rules/inject.ts`](../../apps/desktop/sidecar/src/rules/inject.ts) cache theo projectId, `invalidateRulesCache()` ở mọi mutation. | Mirror `hooks.*`; tránh đọc đĩa mỗi turn. |
| D-7 | fs-watcher | Watch `~/.awog/rules` + `{project}/.awog/rules` → `rules.fs-changed` → UI re-hydrate ([`watcher.ts`](../../apps/desktop/sidecar/src/watcher.ts)). | Parity Skills/Hooks; sửa file ngoài app vẫn cập nhật. |

## Phương án đã cân nhắc

- **AWOG-native only (không đọc CLAUDE.md)** — quyết định ban đầu, **đã đảo** (D-4 amended): user muốn ưu tiên đọc CLAUDE.md/.claude/rules. Import dưới dạng read-only thay vì editable để giữ ownership + tránh ghi đè `@import` của CLAUDE.md.
- **Replace systemPrompt bằng rules** — bị từ chối: phá `agent.systemPrompt` (ADR 0015); rule là augment.
- **Inject vào user prompt mỗi turn** — bị từ chối: tốn token lặp lại; systemPrompt là chỗ đúng cho instruction bền.
- **Glob/path-scoped rules (kiểu Cursor)** — defer (D-5): cần per-file context, chưa có.

## Hệ quả

- **Tích cực:** Tái dùng frontmatter + pattern 2-tier + watcher + cache đã chín → ít code mới. Rule là entity edit-được trong app, đi theo repo. Augment đúng (không phá agent identity).
- **Tiêu cực / Trade-off:**
  - **Prompt injection (rủi ro chính):** project rule từ repo clone về có thể chèn chỉ thị độc vào system prompt. Mức độ thấp hơn hook (rule là text, không execute; agent vẫn dưới permission gate) nên v1 **chưa** có trust-gate như hook ([ADR 0032](./0032-hook-execution-engine-ipc-contract.md) D-8) — nhưng cần cân nhắc thêm trust/preview cho project rule trước release (infosec).
  - Token: mọi turn cộng thêm body rule → khuyến nghị rule ngắn gọn; chưa có budget/trim.
  - Cache module-level không tự thấy file sửa tay ngoài app cho tới khi mutation/restart (UI list vẫn fresh qua `rules.list`).
- **Việc cần làm tiếp:** infosec review project-rule trust + token budget; cân nhắc glob-scope (D-5) và import CLAUDE.md read-only (D-4) như layer additive.

## Tham chiếu

- [ADR 0015](./0015-agents-persisted-runtime-systemprompt.md), [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md), [ADR 0032](./0032-hook-execution-engine-ipc-contract.md)
- Feature: [rules](../features/rules.md)
- Security: [`.claude/rules/security.md`](../../.claude/rules/security.md)
