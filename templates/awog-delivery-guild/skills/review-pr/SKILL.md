---
name: review-pr
description: Conduct a code review on an AWOG diff/PR — verify architecture fit, AWOG invariants (local-first, no key leak, restart-safe), coding-guide compliance, security, performance. Outputs file:line comments tagged Block/Nit/Suggestion. Used by code-reviewer agent.
---

# Skill: Review PR

Review code change theo checklist 5 nhóm + format output chuẩn.

## Khi nào dùng

- Developer báo PR ready.
- Pre-merge gate cuối cùng.

## Workflow

### 1. Đọc context

- Spec + ADR mà PR claim implement.
- Diff: `git diff main...HEAD` hoặc PR diff UI.
- File chạm nhiều nhất → đọc full, không skim.

### 2. Chạy lint/typecheck độc lập

**Không tin developer claim.** Chạy lại:

```bash
cd apps/desktop/ui
pnpm lint
pnpm typecheck
pnpm format:check
```

Ghi kết quả vào output. Nếu lint fail → ⛔ block.

### 3. Đi qua 5 nhóm checklist

#### A. Architecture fit
- [ ] Không vi phạm ADR nào.
- [ ] Không dependency mới ngoài ADR.
- [ ] Không backend service / port mạng / database.
- [ ] Layer boundary đúng (UI không biết FS, store không format trình bày).
- [ ] Không vi phạm two-process model (UI ⇆ sidecar qua IPC).

#### B. AWOG invariants (CRITICAL — hard block nếu fail)
- [ ] **API key không leak** vào UI/log/event/trace.
- [ ] **Local-first**: không assume mạng (trừ feature explicit cần).
- [ ] **Restart-safe**: state ghi xuống đĩa, có thể resume sau crash.
- [ ] **Event sourcing**: action quan trọng append vào `events.log`.
- [ ] **Approval gate**: pause/resume đúng chỗ.
- [ ] **Path sanitize** khi nhận input user/file (path traversal).
- [ ] **Git auto-commit chỉ trong workspace**, không touch repo khác.

#### C. Code quality
- [ ] KISS / YAGNI / DRY (≥ 3 lần) / SRP.
- [ ] Tên nói nghĩa, không cần comment thừa.
- [ ] Component < ~250 dòng, function < ~50 dòng (mềm).
- [ ] Không `any`, `@ts-ignore` thiếu lý do, `console.log` còn sót.
- [ ] Props readonly, không mutate.
- [ ] `<script setup lang="ts">` cho Vue.
- [ ] Theme color qua `useTheme()`, không hex hardcode.
- [ ] Composable trả interface tối thiểu.
- [ ] Pinia store: state expose readonly, mutation đi qua action.

#### D. Bảo mật (handoff infosec nếu nặng)
- [ ] Không log API key, password, token.
- [ ] Không `v-html` từ input user (chỉ source kiểm soát).
- [ ] Validate input ở biên (server route, IPC, user input, file đọc).
- [ ] Không SQL/command injection ở sidecar (sau MVP).
- [ ] Không gửi telemetry ra ngoài.

#### E. Performance
- [ ] Không `watch` deep object lớn (ưu tiên `computed`).
- [ ] `shallowRef`/`shallowReactive` cho object lớn không cần reactivity sâu.
- [ ] VueFlow > 500 node có cluster/virtual.
- [ ] Lazy load route nặng.

### 4. Format comment

Mỗi nhận xét **phải có** `file:line` và mức độ:

```
[BLOCK] components/TaskListItem.vue:42 — API key in console.warn.
Fix: bỏ log, hoặc redact key trước khi log.
Reason: vi phạm invariant "API key không leak".

[NIT] stores/workspace.ts:104 — tên `doIt()` không nói nghĩa.
Suggest: `runSelectedTask()`.

[SUGGEST] composables/useTheme.ts — cân nhắc cache token computed.
Optional, không block.
```

### 5. Verdict

```markdown
# Review: <PR / feature>

## Verdict
[ ] ✅ Approve
[x] 🟡 Request changes
[ ] ⛔ Block

## Comments

### ⛔ Block (must fix)
- [path:line] ...

### 🟡 Nit (should fix)
- ...

### 💡 Suggestion (optional)
- ...

## Lint / Typecheck
- `pnpm lint`: PASS / FAIL <N errors>
- `pnpm typecheck`: baseline <N> → now <M>
- `pnpm format:check`: PASS / FAIL

## Spec/ADR conformance
- AC1: ✅ implemented as specified
- AC2: ❌ deviates — see [BLOCK] above
```

## Mức độ

- **⛔ Block** — phải fix mới merge (security, invariant violation, lint error, ADR conflict).
- **🟡 Nit** — nên fix, không block (naming, small DRY).
- **💡 Suggestion** — ý tưởng cải thiện, optional.

## Anti-pattern (reviewer side)

- ❌ "LGTM" không căn cứ.
- ❌ Approve khi còn ⛔.
- ❌ Sửa code trực tiếp (đề xuất, không commit).
- ❌ Block vì sở thích cá nhân (subjective → SUGGEST, không BLOCK).

## Liên kết với role khác

- **Trước:** developer + QA done.
- **Sau:** developer fix block → reviewer re-review → merge.
- **Khi nghi vấn security nặng** → handoff sang **infosec** agent.
