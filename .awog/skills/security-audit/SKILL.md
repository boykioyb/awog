---
name: security-audit
description: Perform a security audit on an AWOG diff/PR/branch — apply a 21-rule vulnerability catalog (adapted from vbsec) plus AWOG-specific invariants (API key isolation, IPC boundary, workspace path sanitize, git scope, no telemetry). Outputs findings with severity, file:line, repro, and fix. Used by the infosec agent.
---

# Skill: Security Audit (AWOG)

Quét lỗ hổng bảo mật theo catalog 21 rule generic + invariant đặc thù AWOG. Tham chiếu workflow từ [vbsec](https://github.com/tanviet12/vbsec) (MIT).

## Khi nào dùng

- PR đụng filesystem, network, IPC, exec, parse.
- Thêm/đổi dependency.
- Trước release.
- Theo lịch (weekly full scan).

## Khi nào KHÔNG dùng (delegate khác)

- Quality / architecture / coding style → [skills/review-pr](../review-pr/SKILL.md) (code-reviewer agent).
- Functional / test → [skills/write-test-cases](../write-test-cases/SKILL.md) (qa-tester agent).

## Workflow

### Step 0 — Parse scope

```bash
# Trong git repo
git diff --name-only HEAD              # uncommitted
git diff main...HEAD --name-only       # branch vs main
git log --since='7 days ago' --name-only --pretty=format: | sort -u
git diff-tree -r --name-only <SHA>     # 1 commit
gh pr diff <PR#> --name-only           # PR
```

Phân loại file:
- **Code** (`.ts`, `.vue`, `.js`, `.cjs`): full scan.
- **Config** (`nuxt.config.ts`, `.eslintrc.cjs`): scan misconfig.
- **Lockfile / package.json**: scan dependency.
- **Markdown / spec**: skip (trừ khi chứa link/example code).

### Step 1 — Route theo size

| Size | Mode |
|---|---|
| ≤ 20 file code chính | **Inline** — Claude tự scan trong session |
| > 20 file HOẶC > 14 ngày commit history | **Delegate** — spawn subagent per chunk |

### Step 2 — Áp catalog 21 rule

Đọc từng file, đối chiếu với catalog dưới. **Reasoning, không pattern-match thuần** — đọc context để xác định trust level và thực sự có exploit không.

### Step 3 — Đối chiếu invariant AWOG

Bắt buộc check 8 invariant ở [.claude/agents/infosec.md](../../agents/infosec.md#awog-specific-invariants-hard-block-nếu-vi-phạm).

### Step 4 — Output report

Theo template ở [infosec.md](../../agents/infosec.md#output).

---

## Catalog 21 rule (tailor cho AWOG)

> **Cảnh báo:** chưa phải tất cả áp dụng cho MVP UI thuần. Khi sidecar được wire (xem [ADR 0008](../../../docs/decisions/0008-stdio-ipc-for-sidecar.md)), nhiều rule mới có context để áp.

### #01 — Hardcoded Secret

- **Áp:** UI, sidecar.
- **Tìm:** chuỗi giống API key / token / DSN trong source/config/log.
- **AWOG nhạy cảm:** Anthropic / OpenAI / Gemini API key. **Phải** ở settings store local-only, không commit, không log.
- **Sink nguy:** `console.log`, `JSON.stringify` toàn store, event log, error message.
- **Fix:** redact (`key.slice(0,4) + '***'`), không log toàn object chứa key.

### #02 — SQL Injection

- **Áp:** sau khi sidecar có DB/SQLite layer (chưa có trong MVP).
- **Tìm:** string concat trong query, `query(f"... {var}")`.
- **Fix:** parameterized query.

### #03 — XSS

- **Áp:** UI Vue.
- **Tìm:** `v-html` với input không kiểm soát; render markdown chứa script.
- **AWOG nhạy cảm:** [SessionMarkdownHtml.vue](../../../apps/desktop/ui-next/components/session/SessionMarkdownHtml.vue), [MermaidView.vue](../../../apps/desktop/ui-next/components/common/MermaidView.vue). Mermaid SVG output kiểm soát được; markdown input từ user/file workspace là **L1**, KHÔNG được render qua `v-html` thẳng.
- **Fix:** dùng renderer parse → AST → Vue node; sanitize HTML (DOMPurify) nếu bắt buộc inject.

### #04 — IDOR / Broken Object Access

- **Áp:** sidecar route khi có (MVP chưa có auth multi-user).
- **Tìm:** truy cập object theo id từ user input mà không check ownership.
- **AWOG:** task/project id từ UI → sidecar không validate có thuộc workspace hiện tại.
- **Fix:** validate id thuộc current workspace trước mọi action.

### #05 — Slopsquatting (typo-squatted / hallucinated dep)

- **Áp:** mọi `package.json`.
- **Tìm:** package có tên giống nổi tiếng nhưng author lạ, downloads thấp, mới publish.
- **AWOG:** check trước khi merge bất kỳ PR thêm dependency.
- **Tool:** `npm view <pkg>`, kiểm tra `repository`, `weeklyDownloads` qua npmjs.org.

### #06 — Brute Force

- **Áp:** auth endpoint (chưa có trong MVP).
- **AWOG note:** local-first nên ít rủi ro brute force qua mạng; nhưng nếu thêm passphrase mã hóa workspace → cần KDF chậm (Argon2).

### #07 — Mass Assignment

- **Áp:** UI store → sidecar boundary.
- **Tìm:** spread `...payload` vào entity store mà payload có field không kiểm soát.
- **AWOG:** action `updateTask({ ...input })` không whitelist field.
- **Fix:** explicit pick field cho phép.

### #08 — Insecure Deserialization

- **Áp:** parse JSON/YAML từ workspace.
- **Tìm:** `JSON.parse(content)` trên file user-editable mà không validate schema.
- **AWOG:** mọi file `.json`, `.yaml` trong workspace là **L1**. Phải validate schema trước khi đưa vào store / engine.
- **Fix:** schema validation (planned: zod), reject bất hợp lệ.

### #09 — SSRF (Server-Side Request Forgery)

- **Áp:** sidecar model client / context provider.
- **Tìm:** fetch URL lấy từ workspace/UI mà không whitelist host.
- **AWOG nhạy cảm:** ContextProvider trong tương lai có thể fetch URL — bị abuse để probe metadata endpoint (`169.254.169.254`), localhost ports.
- **Fix:** allowlist host của provider; chặn private IP range; chặn redirect không kiểm soát.

### #10 — Path Traversal

- **Áp:** mọi nơi đụng filesystem.
- **Tìm:** `path.join(workspace, userInput)` mà userInput chứa `..` hoặc absolute path.
- **AWOG:** workspace I/O của sidecar; file name của artifact; load file trong markdown editor.
- **Fix:** resolve về absolute, check `startsWith(workspaceRoot)`, reject `..` literal.

### #11 — CSRF

- **Áp:** Nuxt server API khi có (sau Tauri shell).
- **AWOG:** sidecar IPC không qua HTTP nên CSRF không áp; dev HTTP fallback ([ADR 0009](../../../docs/decisions/0009-dev-mode-http-fallback.md)) phải dùng dev token.

### #12 — Broken Access Control

- **Áp:** sidecar route khi có multi-tenant (MVP single-user).
- **AWOG note:** MVP single-user local nên không cần; nhưng workspace switch phải clear state cũ để không leak data giữa workspace.

### #13 — Weak Password Hashing

- **Áp:** nếu thêm passphrase mã hóa workspace.
- **Fix:** Argon2id / scrypt. Không MD5/SHA-256/PBKDF2 < 600k.

### #14 — JWT None-Algorithm

- **Áp:** nếu thêm JWT (chưa có).
- **Fix:** verify alg ≠ "none", hardcode alg expected.

### #15 — CORS Misconfig

- **Áp:** dev HTTP mode ([ADR 0009](../../../docs/decisions/0009-dev-mode-http-fallback.md)).
- **Fix:** allowlist origin cố định (`http://localhost:3030`), không `*` + credentials.

### #16 — Unrestricted File Upload

- **Áp:** chưa có MVP. Khi có import workspace từ file → check size, mime, extension allowlist.

### #17 — Verbose Error / Debug Mode

- **Áp:** UI + sidecar.
- **Tìm:** `console.error(err)` in stack trace có path nhà / token / payload nhạy cảm.
- **AWOG:** error popup UI không được hiển thị stack raw; sidecar log không được dump request body.
- **Fix:** message sanitized cho UI, full trace chỉ trong sidecar log file local.

### #18 — Missing Rate Limit

- **Áp:** sidecar model client.
- **AWOG nhạy cảm:** runaway loop gọi model → cháy tiền của user.
- **Fix:** budget per task (max tokens, max calls, max wallclock), kill switch UI.

### #19 — Race Condition

- **Áp:** sidecar khi nhiều task chạy song song.
- **Tìm:** đọc-sửa-ghi file workspace không atomic, share state không khóa.
- **AWOG:** 2 task cùng append vào `events.log` của 1 task, 2 task ghi cùng artifact.
- **Fix:** write atomic (write-temp + rename), single-writer per file, append-only event log.

### #20 — Outdated Dependency

- **Áp:** `package.json` + `pnpm-lock.yaml`.
- **Tool:** `pnpm audit`, `pnpm outdated`.
- **AWOG note:** ESLint 8.57 đã chốt (xem [ADR planned] / docs/coding/nuxt-frontend.md). Khi nâng major → ADR.

### #21 — Command Injection

- **Áp:** sidecar khi shell-out (git, ffmpeg, ...).
- **Tìm:** `exec(\`git \${input}\`)` với input không escape.
- **AWOG nhạy cảm:** sidecar gọi `git` để auto-commit workspace, clone repo. Branch name / commit msg / repo URL **là L1**.
- **Fix:** dùng `execFile`/`spawn` với arg array, không shell string; allowlist subcommand; validate ký tự (`^[a-zA-Z0-9._/-]+$` cho branch).

---

## AWOG-specific extra (ngoài 21)

### AX1 — API Key Leak (CRITICAL)

- **Invariant #1:** key KHÔNG bao giờ rời sidecar.
- **Sink check:**
  - IPC payload từ sidecar → UI: không chứa key.
  - Event log / trace: không chứa key.
  - Error message bubble lên UI: không chứa key.
  - Git auto-commit: workspace settings file chứa key **không** được commit (check `.gitignore` workspace).
- **Test:** grep `process.env.ANTHROPIC_API_KEY|OPENAI_API_KEY` trong code UI → must be 0.

### AX2 — IPC Boundary Violation

- **Invariant #4:** UI không gọi `fs`, `child_process`, model SDK trực tiếp.
- **Check:** trong `apps/desktop/ui-next/`, không được có `import fs from 'fs'`, `child_process`, `@anthropic-ai/sdk`, etc.
- **Phải:** đi qua sidecar IPC.

### AX3 — Workspace Path Escape

- **Invariant #2.** Mọi path đi từ UI/workspace file qua sidecar phải:
  1. Normalize (`path.resolve`).
  2. Check `startsWith(workspaceRoot + path.sep)`.
  3. Reject symlink ra ngoài workspace (`fs.realpath` rồi check lại).

### AX4 — Git Scope Escape

- **Invariant #3.** Mọi git command spawn từ sidecar phải có `cwd = workspaceRoot`.
- **Cấm:** `git -C <user-path>`, `git --git-dir=<user-path>` từ payload UI.

### AX5 — Telemetry Leak

- **Invariant #5.** Không có code gửi data ra ngoài trừ model API call.
- **Check:** grep `fetch(`, `http.request`, `XMLHttpRequest` trong sidecar → mỗi destination phải allowlist.

### AX6 — Dev HTTP Token

- **Invariant #6 + [ADR 0009](../../../docs/decisions/0009-dev-mode-http-fallback.md).**
- Dev HTTP loopback chỉ bật khi `AWOG_DEV_HTTP=1`.
- Phải có dev token; reject request thiếu/sai token.
- Không bind ra `0.0.0.0` hoặc IPv6 dual-stack public.

---

## Quick scan one-liners

```bash
cd apps/desktop/ui

# 1. Hardcoded secret patterns
rg -i '(sk-[a-z0-9]{20,}|api[_-]?key.*=.*["\047][a-z0-9]{20,})' --type ts --type vue

# 2. v-html usage (XSS surface)
rg 'v-html' --type vue

# 3. UI calling forbidden modules (IPC boundary)
rg "^import .* from ['\"](fs|child_process|@anthropic-ai|openai)" --type ts --type vue

# 4. console.log với object lớn (verbose error)
rg 'console\.(log|error|warn)\(' --type ts --type vue

# 5. eval / Function constructor (insecure)
rg '\beval\(|new Function\(' --type ts --type vue

# 6. Outdated deps
pnpm outdated
pnpm audit --prod

# 7. parseInt thiếu radix (đã catch bởi ESLint nhưng quét lại)
rg 'parseInt\([^,]+\)' --type ts --type vue
```

---

## Severity rubric

| Mức | Tiêu chí AWOG | SLA |
|---|---|---|
| ⛔ **Critical** | Vi phạm invariant #1 (key leak), RCE, auth bypass | Block merge, hotfix |
| 🔴 **High** | XSS có exploit, path traversal, command injection, SSRF | Block merge |
| 🟡 **Medium** | Info disclosure, race condition hiếm, missing hardening | Fix trong sprint |
| 🟢 **Low** | Defense-in-depth, best practice | Backlog |

## Output

Theo template ở [.claude/agents/infosec.md](../../agents/infosec.md#output).

## Liên kết role khác

- **Trigger từ:** code-reviewer (skill `review-pr`) khi thấy red flag, hoặc theo lịch.
- **Sau finding:** developer fix → infosec re-audit chỉ trên finding cụ thể.
- **Khi cần đổi kiến trúc:** gọi tech-lead viết ADR (skill `write-adr`).
