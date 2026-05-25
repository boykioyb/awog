---
name: write-test-cases
description: Author manual and automated test cases for an AWOG feature based on its acceptance criteria — including edge cases, regression checks, and AWOG-specific invariants (offline, restart-safe, approval gates). Used by QA Tester agent.
---

# Skill: Write Test Cases

Viết test case có cấu trúc, phủ acceptance criteria + edge case + regression.

## Khi nào dùng

- Developer báo task done → QA verify.
- Cần regression suite cho feature đã có nhưng chưa có test.

## Template

```markdown
# Test Plan: <feature>

> **Spec:** [link]
> **Build:** <branch / commit>
> **Tester:** <name>
> **Last run:** YYYY-MM-DD

## Setup

- Workspace path: `<path>`
- Project test: `<name>`
- Pre-seed data: ...
- OS/theme: macOS + dark | Windows + light | ...

## Acceptance verification

| AC | Status | Note |
|---|---|---|
| AC1 | ✅ Pass | ... |
| AC2 | ❌ Fail | Bug #1 |
| AC3 | ⏭️  Blocked | depends on AC2 |

## Test case

### TC1 — Golden path
**Pre:** ...
**Steps:**
1. ...
2. ...
**Expected:** ...
**Actual:** ✅ / ❌

### TC2 — Empty input
**Steps:** ...
**Expected:** ...
**Actual:** ...

### TC3 — Special characters
- Tab, newline, emoji, Unicode RTL, slash, quote.

### TC4 — Max length
- Field text 10k char.
- Path 255 char.

### TC5 — Concurrent
- 2 task chạy song song chạm cùng artifact.

### TC6 — Restart
- Kill app giữa task → mở lại → resume đúng status?

### TC7 — Offline
- Cắt mạng (Wi-Fi off + ethernet off) → feature local-only vẫn chạy?

### TC8 — Theme switch
- Dark → Light giữa flow.

### TC9 — Regression
- Feature liên quan A vẫn chạy.
- Feature liên quan B vẫn chạy.

## Bug report

### #1 — <short title>
**Severity:** S1 / S2 / S3 / S4
**Repro:**
1. ...
**Expected:** ...
**Actual:** ...
**Logs:**
```
<paste relevant log/console>
```
**Screenshot:** <path>
**Workaround:** ...

## Sign-off

- [ ] Tất cả AC pass
- [ ] Không có bug S1/S2
- [ ] Regression check pass
- [ ] Document chính xác (spec match implementation)
```

## Severity

| Mức | Khi nào |
|---|---|
| **S1** | Crash, data loss, security leak, không thể bypass |
| **S2** | Block flow chính, có workaround khó |
| **S3** | Lỗi cosmetic / edge case, workaround dễ |
| **S4** | Đề xuất cải thiện UX |

## Edge case checklist AWOG (bắt buộc cân nhắc mọi feature)

- [ ] **Input**: empty, max length, Unicode (emoji + RTL), tab/newline, JSON injection.
- [ ] **Offline**: cắt mạng → feature local-only vẫn chạy?
- [ ] **Restart**: kill app giữa chừng → resume?
- [ ] **Concurrent**: 2 tab/window cùng workspace, 2 task song song.
- [ ] **File system**: file bị xóa thủ công, permission denied, disk full.
- [ ] **Git**: repo dirty, conflict, detached HEAD, không có git installed.
- [ ] **Theme**: dark + light đều render đúng.
- [ ] **Approval gate**: pause khi cần, resume khi user click.
- [ ] **Trace log**: event đúng format, không leak secret.
- [ ] **API key**: không lộ trong UI/log/event.
- [ ] **Performance**: list lớn (1k+ item) còn mượt?
- [ ] **Window**: minimize/maximize, đóng cửa sổ (tray giữ engine).

## Khi không thể test tự động

Một số AWOG check chỉ test thủ công:
- Tray icon + native notification (cần Tauri shell).
- System theme detection.
- File chooser dialog.

→ Viết test case **manual** rõ ràng để người thật làm theo. Đánh dấu `[manual]`.

## Liên kết với role khác

- **Trước:** developer báo done (skill `implement-feature`).
- **Sau:** nếu fail → quay lại developer; nếu pass → reviewer (skill `review-pr`).
