# Plan: Connection Quota Handling

> Spec: [connection-quota-handling.md](./connection-quota-handling.md) (Ready for PM, khoá Open Questions 2026-05-25)
> ADR: [0010-pause-on-quota-for-connection-switch.md](../decisions/0010-pause-on-quota-for-connection-switch.md) (Accepted)

## Bối cảnh decompose

- **Sidecar Node.js chưa có khung sườn** ([CLAUDE.md](../../CLAUDE.md) — "Engine wiring — chưa"). Mọi task ở **M2** đều `Blocked by: sidecar bootstrap chưa có`. M1 đi trước bằng mock state trong workspace store.
- 11 AC + 19 TS đã khoá, không còn ambiguity. PM **không** đề xuất thêm OQ mới.
- Mọi task code đi kèm lint/format gate ([.claude/rules/lint-format.md](../../.claude/rules/lint-format.md)) — không tách task riêng cho `pnpm lint:fix`, coi như nằm trong "Definition of Done" mặc định.

## Bảng tổng

| Milestone | Số task | Mục tiêu |
|---|---|---|
| M1 — UI scaffolding (mock engine) | 10 | Port toàn bộ UI surface, mock state transition trong workspace store |
| M2 — Sidecar engine wiring | 9 | Sidecar adapter + engine state machine + IPC + persist + restart-load |
| M3 — Polish + tests + docs | 6 | Native notification, accessibility, automated tests, doc updates |
| **Tổng** | **25** | |

---

## M1 — UI scaffolding (mock engine)

> Tất cả task M1 có `Blocked by: none`. Mock state transition (đẩy task vào `waiting_connection`) bằng dev helper action trong workspace store, không cần sidecar.

- [ ] **CQ-01. Mở rộng types: TaskStatus / PhaseStatus / Run.triggeredBy / WaitingConnectionInfo** — S
  - **Surface:** UI-types
  - **Owner:** developer
  - **Depends on:** none
  - **Blocked by:** none
  - **AC references:** AC-2, AC-3, mục "Types" của spec
  - **Acceptance per task:**
    - Thêm `'waiting_connection'` vào `TaskStatus` và `PhaseStatus`; `Task.waitingConnection: WaitingConnectionInfo | null`; `Run.triggeredBy?: 'rerun' | 'resume-connection'`.
    - Export `WaitingConnectionInfo` discriminated theo `kind: 'quota' | 'rate_limit' | 'invalid_key'`.
    - `pnpm typecheck` xanh trên toàn UI sau khi cập nhật initial-data nếu cần.

- [ ] **CQ-02. Workspace store: thêm getter & mock dev-action cho waiting_connection** — M
  - **Surface:** UI-store
  - **Owner:** developer
  - **Depends on:** CQ-01
  - **Blocked by:** none
  - **AC references:** AC-2, AC-11 (getter)
  - **Acceptance per task:**
    - Getter `tasksWaitingConnectionByProvider` trả `Record<provider, Task[]>`.
    - Dev-only action `mockPauseTaskForQuota(taskId, provider, kind)` để FE test luồng UI mà không cần sidecar — chuyển task + phase hiện tại sang `waiting_connection`, set `waitingConnection`.
    - Action `resumeTask(taskId)` ở M1 chỉ thực hiện optimistic update (status → `running`, `waitingConnection = null`) — chưa gọi IPC; comment TODO M2.

- [ ] **CQ-03. Settings store: bump providerKeyVersion khi API key đổi** — S
  - **Surface:** UI-store
  - **Owner:** developer
  - **Depends on:** none
  - **Blocked by:** none
  - **AC references:** AC-7
  - **Acceptance per task:**
    - Khi `providers.<name>.apiKey` thay đổi, store tăng `providerKeyVersion[provider]++`.
    - Expose getter `keyFingerprint(provider): string` (SHA-256 4-byte hex prefix) để dùng cho Resume guard. Hash chạy trong UI vẫn an toàn vì raw key đã ở settings store (chưa qua sidecar boundary ở MVP UI).
    - Không lưu raw key vào log/event.

- [ ] **CQ-04. Mock initial-data: thêm 1 task ở waiting_connection làm fixture** — S
  - **Surface:** UI-store (mock)
  - **Owner:** developer
  - **Depends on:** CQ-01
  - **Blocked by:** none
  - **AC references:** AC-4, AC-11
  - **Acceptance per task:**
    - `INITIAL_TASKS` có ≥ 1 task `waiting_connection` provider `anthropic` (kind `quota`) và 1 task khác cùng provider để demo Resume all.
    - Run fail tương ứng có status `failed` + `triggeredBy` ban đầu, để verify "Aborted (kind)" label.

- [ ] **CQ-05. Component TaskCard: badge "Needs key" + indicator cam + hide progress** — M
  - **Surface:** UI-component
  - **Owner:** developer
  - **Depends on:** CQ-01, CQ-04
  - **Blocked by:** none
  - **AC references:** AC-4, TS-12
  - **Acceptance per task:**
    - Khi `task.status === 'waiting_connection'`: chấm tròn `theme.warning` + pulse chậm; badge `KeyRound` + text "Needs key" (nền `theme.warningBg`, viền `theme.warningBorder`).
    - Progress bar ẩn cho `waiting_connection` (giống `waiting_approval`).
    - Phân biệt visual rõ với `waiting_approval` (icon + màu khác).

- [ ] **CQ-06. Component ConnectionBanner trong task detail header** — M
  - **Surface:** UI-component
  - **Owner:** developer
  - **Depends on:** CQ-01, CQ-03, CQ-04
  - **Blocked by:** none
  - **AC references:** AC-4, AC-7, AC-9
  - **Acceptance per task:**
    - Banner render khi `task.waitingConnection != null`, copy đổi theo `kind` (quota / rate_limit / invalid_key) — đúng câu chữ ở spec UI section.
    - CTA: `[Open Settings]` (navigate `/settings?focus=provider:<name>`) + `[Resume]` (disabled khi `keyFingerprint(provider) === waitingConnection.keyFingerprintAtPause`).
    - Khi disabled, tooltip "Key chưa thay đổi. Cập nhật key mới trước khi Resume." (AC-7).
    - Nếu có thuộc tính "last attempt" trong fixture (lần resume thứ 2 trở đi) → hiển thị dòng "Last attempt: {time} — {kind label}" (AC-9).

- [ ] **CQ-07. Task detail timeline: phase badge "Waiting for connection" + trace label "Aborted (kind)"** — M
  - **Surface:** UI-component
  - **Owner:** developer
  - **Depends on:** CQ-01, CQ-04
  - **Blocked by:** none
  - **AC references:** AC-2, AC-9, TS-19
  - **Acceptance per task:**
    - Phase card có status `waiting_connection` hiển thị badge nhỏ "Waiting for connection" + nền nhạt cam.
    - Trace của run `failed` do quota: header trace có label "Aborted ({kind label})" màu cam, không clickable.
    - Trace **không bị ẩn** (OQ-7).

- [ ] **CQ-08. Settings page: counter "{N} task waiting" + nút Resume all + deeplink highlight** — M
  - **Surface:** UI-component
  - **Owner:** developer
  - **Depends on:** CQ-02, CQ-06
  - **Blocked by:** none
  - **AC references:** AC-11, TS-14, "Settings deeplink + Resume all"
  - **Acceptance per task:**
    - Card provider hiển thị "{N} task waiting" khi getter trả N ≥ 1.
    - Nút **Resume all** hiện khi N ≥ 2; click → gọi `resumeTasksForProvider(provider)` (mock ở M1, real ở M2).
    - Toast "Resumed N tasks ({successCount} running, {pausedAgainCount} still waiting)" — M1 fake counter (vd. resumed = N, pausedAgain = 0).
    - Settings page parse query `?focus=provider:<name>` → scroll vào card + class highlight 2s pulse.

- [ ] **CQ-09. Action resumeTasksForProvider trong workspace store (mock)** — S
  - **Surface:** UI-store
  - **Owner:** developer
  - **Depends on:** CQ-02
  - **Blocked by:** none
  - **AC references:** AC-11
  - **Acceptance per task:**
    - Lọc task theo provider, loop tuần tự gọi `resumeTask`. Trả `{ resumed, stillWaiting }`.
    - M1 mock: tất cả resume thành công (stillWaiting = 0).
    - Catch lỗi từng task không làm chết loop.

- [ ] **CQ-10. Dev affordance: nút "Mock: pause for quota" trong task detail (dev mode only)** — S
  - **Surface:** UI-component
  - **Owner:** developer
  - **Depends on:** CQ-02, CQ-06
  - **Blocked by:** none
  - **AC references:** none (dev helper)
  - **Acceptance per task:**
    - Trong dev (`import.meta.dev`), task detail có nút discreet "Mock: pause for quota (anthropic)" để trigger `mockPauseTaskForQuota`.
    - Cho phép QA/developer reproduce visual luồng quota mà không cần sidecar.
    - Build production không render nút này.

---

## M2 — Sidecar engine wiring

> **Blocked by: sidecar bootstrap chưa có.** Trước khi unblock M2, cần task riêng (ngoài plan này) tạo khung sườn Node.js sidecar + IPC bus + Model Adapter base. PM đề xuất TL clarify timeline sidecar bootstrap trước khi đặt M2 lên sprint.

- [ ] **CQ-11. ADR follow-up: contract Sidecar IPC commands & events cho quota handling** — S
  - **Surface:** docs (ADR)
  - **Owner:** tech-lead
  - **Depends on:** none (có thể song song M1)
  - **Blocked by:** none
  - **AC references:** Sidecar contract section của spec
  - **Acceptance per task:**
    - ADR mới (NNNN) ghi rõ schema `task.resume`, `task.resumeProvider`, event `task.waiting_connection`, `task.resumed`, `notification.show`.
    - Định nghĩa rõ sanitization rule cho payload IPC (không chứa key, request ID, raw error body).
    - Ghi rõ liên hệ với ADR 0010 (mở rộng phạm vi `invalid_key`).

- [ ] **CQ-12. Sidecar: định nghĩa ConnectionUnavailableError + mapping Anthropic 429/401** — M
  - **Surface:** sidecar-adapter
  - **Owner:** developer
  - **Depends on:** CQ-11
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-1 (Anthropic case)
  - **Acceptance per task:**
    - Class `ConnectionUnavailableError(provider, kind, retryAfterMs?)`; message **không** embed raw response.
    - Anthropic adapter map: 429 + `rate_limit_error` / `overloaded_error` → `kind: 'rate_limit'`; 429 + `insufficient_quota` → `'quota'`; 401 + `authentication_error` → `'invalid_key'`.
    - Lỗi network / 5xx / schema mismatch **không** ném ConnectionUnavailableError (đi nhánh failed).
    - Unit test fixture cho từng mã.

- [ ] **CQ-13. Sidecar: mapping OpenAI 429/401** — S
  - **Surface:** sidecar-adapter
  - **Owner:** developer
  - **Depends on:** CQ-12
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-1 (OpenAI case)
  - **Acceptance per task:**
    - Map 429 + `insufficient_quota` / `rate_limit_exceeded` → đúng kind; 401 + `invalid_api_key` → `'invalid_key'`.
    - Test fixture từng case.

- [ ] **CQ-14. Sidecar: transient retry ≤ 5s × 2 trong adapter** — S
  - **Surface:** sidecar-adapter
  - **Owner:** developer
  - **Depends on:** CQ-12
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-8, TS-3, TS-4
  - **Acceptance per task:**
    - Khi response có `retry-after` ≤ 5s và kind `rate_limit`: adapter retry tối đa 2 lần (tổng ≤ 10s) trước khi throw.
    - `retry-after` > 5s hoặc kind `quota` / `invalid_key` → throw ngay.
    - Provider không trả `retry-after` → throw ngay (theo edge case).

- [ ] **CQ-15. Engine: state transition Running → WaitingConnection (pause + persist atomic)** — L
  - **Surface:** sidecar-engine
  - **Owner:** developer
  - **Depends on:** CQ-11, CQ-12
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-2, AC-6 (persist), OQ-6 (failed not superseded)
  - **Acceptance per task:**
    - Bắt `ConnectionUnavailableError` ở node execution → set Run = `failed`, Phase = `waiting_connection`, Task = `waiting_connection`.
    - Set `task.waitingConnection = { provider, phaseNodeId, failedRunVersion, kind, at, keyFingerprintAtPause }`.
    - Persist `task.json` atomic (write tmp + rename). Restart load lại đúng state (AC-6 → verify trong CQ-22 test).
    - Không chạy phase kế tiếp; không đụng artifact phase upstream.

- [ ] **CQ-16. Engine: action task.resume (re-run từ đầu node, tạo Run v_{n+1})** — M
  - **Surface:** sidecar-engine
  - **Owner:** developer
  - **Depends on:** CQ-15
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-3, AC-9
  - **Acceptance per task:**
    - IPC command `task.resume` validate task ở `waiting_connection`, tạo Run mới `triggeredBy: 'resume-connection'`, status `running`.
    - Phase + Task → `running`; `waitingConnection = null`.
    - Nếu Run mới lại fail quota → tự động quay về luồng CQ-15 (waiting_connection lần 2). Banner cập nhật "Last attempt" (UI từ CQ-06).

- [ ] **CQ-17. Engine: action task.resumeProvider (batch resume) tuần tự** — S
  - **Surface:** sidecar-engine
  - **Owner:** developer
  - **Depends on:** CQ-16
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-11, TS-14
  - **Acceptance per task:**
    - Loop qua tất cả task có `waitingConnection.provider === provider`; tuần tự (1 worker MVP); thu thập kết quả → emit event response chứa `{ resumed, stillWaiting }`.
    - Một task fail không làm dừng loop.

- [ ] **CQ-18. Sidecar: event log sanitizer cho phase.quota_exhausted** — S
  - **Surface:** sidecar-engine
  - **Owner:** developer
  - **Depends on:** CQ-15
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-5, TS-9, security invariant #1
  - **Acceptance per task:**
    - Event chỉ chứa whitelist field: `type`, `provider`, `phaseNodeId`, `runVersion`, `at`.
    - Unit test confirm raw response body, request ID, header `x-request-id`, organization ID, key fragment đều bị strip.
    - Trace label cố định "Provider quota exhausted".

- [ ] **CQ-19. UI ↔ Sidecar wiring: hoán đổi mock resume sang IPC thật** — M
  - **Surface:** UI-store, sidecar-engine (bridge)
  - **Owner:** developer
  - **Depends on:** CQ-02, CQ-09, CQ-16, CQ-17
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-3, AC-11, TS-10 (no key in IPC)
  - **Acceptance per task:**
    - `resumeTask` / `resumeTasksForProvider` gọi IPC; rollback optimistic update nếu sidecar reject.
    - Subscribe event `task.waiting_connection` để cập nhật state khi sidecar pause task.
    - Subscribe `task.resumed` để cập nhật Run mới.
    - Verify payload IPC không chứa raw key / fingerprint của key mới (chỉ provider name + counters).

---

## M3 — Polish + tests + docs

- [ ] **CQ-20. Native notification (Tauri shell) + click-to-focus** — M
  - **Surface:** sidecar-engine, UI (Tauri shell glue)
  - **Owner:** developer
  - **Depends on:** CQ-15, CQ-19
  - **Blocked by:** sidecar bootstrap + Tauri shell chưa wire (xem [ADR 0006](../decisions/0006-tauri-shell-for-nuxt.md))
  - **AC references:** AC-10, TS-16, TS-17, TS-18
  - **Acceptance per task:**
    - Sidecar emit `notification.show` khi pause **và** window không focus **và** `settings.notificationsEnabled === true`.
    - Tauri shell hiện notification với title prefix "AWOG — Task needs key", click → focus + navigate `/tasks/{taskId}`.
    - App focus hoặc notifications disabled → không gửi.

- [ ] **CQ-21. Accessibility check: badge waiting_connection distinguishable không chỉ bằng màu** — S
  - **Surface:** UI-component, test
  - **Owner:** qa-tester
  - **Depends on:** CQ-05, CQ-06
  - **Blocked by:** none
  - **AC references:** AC-4, TS-12
  - **Acceptance per task:**
    - Verify icon `KeyRound` + text "Needs key" có mặt cho mọi badge waiting_connection.
    - Verify contrast ratio đạt WCAG AA trên theme dark + light.
    - Verify visual diff rõ với `waiting_approval` khi mô phỏng colorblind (deuteranopia screenshot).

- [ ] **CQ-22. Automated test: unit test adapter error mapping (Anthropic + OpenAI)** — M
  - **Surface:** test
  - **Owner:** qa-tester
  - **Depends on:** CQ-12, CQ-13, CQ-14
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-1, AC-8, TS-2..TS-4, TS-15
  - **Acceptance per task:**
    - Test fixture cho từng mã response (429 quota, 429 rate_limit + retry-after 2s / 30s, 401 invalid_key, 500, network timeout).
    - Assert đúng kind và retry behavior.
    - Assert error message **không** chứa raw body, request ID, key fragment.

- [ ] **CQ-23. Automated test: engine state transition + restart-load** — M
  - **Surface:** test
  - **Owner:** qa-tester
  - **Depends on:** CQ-15, CQ-16
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** AC-2, AC-3, AC-6, AC-9, TS-1, TS-5, TS-6, TS-7, TS-8
  - **Acceptance per task:**
    - Test scenarios: pause → resume happy path; resume khi key cũng fail → quay lại waiting_connection; restart sidecar → task vẫn waiting_connection; phase upstream artifact không mất.

- [ ] **CQ-24. Manual QA pass: chạy TS-1..TS-19 trên build dev** — M
  - **Surface:** test
  - **Owner:** qa-tester
  - **Depends on:** CQ-19, CQ-20, CQ-21
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** toàn bộ AC
  - **Acceptance per task:**
    - Chạy đủ TS-1..TS-19; ghi kết quả pass/fail vào QA log.
    - Báo lại bug nếu có, mở issue follow-up.

- [ ] **CQ-25. Cập nhật tài liệu: execution-model + task-execution-engine + settings + apps/desktop/ui/README** — S
  - **Surface:** docs
  - **Owner:** developer
  - **Depends on:** CQ-15, CQ-19
  - **Blocked by:** sidecar bootstrap chưa có
  - **AC references:** "Tài liệu cập nhật" của spec
  - **Acceptance per task:**
    - [execution-model.md](../architecture/execution-model.md): thêm state `waiting_connection` vào lifecycle diagram (cả Task và Phase) + mô tả transition + checkpoint.
    - [task-execution-engine.md](./task-execution-engine.md): thêm `waiting_connection` vào danh sách Status Task & Status Phase.
    - [settings.md](./settings.md): note deeplink `?focus=provider:<name>` và Resume all.
    - [apps/desktop/ui/README.md](../../apps/desktop/ui/README.md): note feature đã port (badge + banner + Settings counter).

---

## Task ordering (Gantt-style ASCII)

Mũi tên `>` = depends on. Block dấu `[]` ngắn = S, dài hơn = M/L. M2/M3 ghi chú `*` = blocked by sidecar bootstrap.

```
Time ─────────────────────────────────────────────────────────────────────────>

M1 (UI mock, parallel-friendly)
  CQ-01 [S types]
    └> CQ-02 [M store] ────────┐
    └> CQ-04 [S fixture] ──┐    │
  CQ-03 [S settings] ─┐    │    │
                       │   ├──> CQ-05 [M TaskCard]
                       │   ├──> CQ-07 [M timeline/trace]
                       └───┴──> CQ-06 [M banner] ──┐
                                                    ├> CQ-08 [M Settings counter/Resume all]
                            CQ-02 ─────────────────┘
                            CQ-02 ──> CQ-09 [S resumeAll store]
                            CQ-06 + CQ-02 ──> CQ-10 [S dev helper]

M2 (Sidecar — blocked by sidecar bootstrap)
  CQ-11 [S ADR contract] (có thể bắt đầu song song M1)
    └> CQ-12* [M Anthropic adapter] ──┬> CQ-13* [S OpenAI]
                                       └> CQ-14* [S transient retry]
       CQ-12* ──> CQ-15* [L engine pause+persist] ──┬> CQ-16* [M task.resume]
                                                      ├> CQ-18* [S log sanitizer]
                                                      └> CQ-16* ──> CQ-17* [S resumeProvider]

  CQ-02 + CQ-09 + CQ-16 + CQ-17 ──> CQ-19* [M UI↔Sidecar wiring]

M3 (Polish)
  CQ-15 + CQ-19 ──> CQ-20* [M native notification] (cũng cần Tauri shell)
  CQ-05 + CQ-06 ──> CQ-21 [S a11y]
  CQ-12..14    ──> CQ-22* [M adapter unit test]
  CQ-15 + CQ-16 ──> CQ-23* [M engine state test]
  CQ-19 + CQ-20 + CQ-21 ──> CQ-24* [M manual TS pass]
  CQ-15 + CQ-19 ──> CQ-25* [S docs update]
```

Critical path khả thi sau khi sidecar bootstrap unblock: **CQ-11 → CQ-12 → CQ-15 → CQ-16 → CQ-19 → CQ-24**.

---

## Risks

- **R-1 (blocker timeline):** Sidecar bootstrap chưa có deadline rõ; toàn bộ M2 + đa số M3 phụ thuộc. TL cần confirm scope/owner cho sidecar skeleton trước khi commit M2 vào sprint.
- **R-2 (provider drift):** Mã lỗi quota của Anthropic/OpenAI có thể đổi shape giữa các version SDK. Cần pin SDK + viết test fixture từ response thật để tránh trượt AC-1.
- **R-3 (key fingerprint phạm trù tin cậy):** OQ-2 chốt SHA-256 4-byte prefix, nhưng FE phải tính fingerprint từ raw key trong settings store — cần TL clarify liệu hash chạy ở UI có vi phạm invariant "API key không rời sidecar" hay không. Nếu cần đẩy hash xuống sidecar thì CQ-03 + CQ-06 phải refactor.
- **R-4 (resume race condition):** Nếu user nhấn Resume khi sidecar đang trong transient retry (CQ-14) chưa kết thúc, có thể xảy ra double-run. Cần TL xác nhận lock cấp task khi implement CQ-16.
- **R-5 (notification deeplink):** AC-10 yêu cầu click notification → focus + navigate. Logic này cần share với feature `human-approval` (đã có pattern tương tự); nếu chưa có util chung thì CQ-20 phải tạo + có thể tăng effort lên L.

## Missing from spec

Không có. Spec đã khoá 7 OQ ngày 2026-05-25 và 11 AC + 19 TS đủ chi tiết. Mọi mục bất định ở trên thuộc **Risks** (cần TL clarify khi dev đụng) hoặc **Open follow-up cho ADR** (đã capture trong CQ-11), không phải gap spec.
