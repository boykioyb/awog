# Plan: Bugfix — lượt Claude SDK treo khi `prompt_suggestion` tới sau `result`

> Spec + quyết định TL: [claude-sdk-idle-settle-prompt-suggestion.md](./claude-sdk-idle-settle-prompt-suggestion.md) (D-1…D-6 là nguồn tham chiếu duy nhất; plan này chỉ chia việc, không thêm quyết định).

Kích thước tổng: S (~1–1.5 ngày công). Không ADR (TL đã chốt), không đổi IPC/event/data/UI, không migration/config. Ngoài MVP: không có — toàn bộ là P0.

DAG: T1 → T2 → T3 → T4 → T5 (T5 chạy song song với T4 được khi đã có build từ T3).

## MVP scope

- [ ] **T1. Sửa vòng `for await` theo D-1/D-4/D-5** — S
  - **Role:** developer
  - **Depends on:** none
  - **Acceptance:** `run-stream.ts` có `PASSIVE_AFTER_RESULT` (`Set<SDKMessage['type']>` đúng 2 loại `prompt_suggestion`, `rate_limit_event`) + `export function isPassiveAfterResult`; `export` `IDLE_SETTLE_MS`, `BACKGROUND_GRACE_MS` với giá trị KHÔNG đổi (AC-11); khối clearTimeout `graceTimer`/`idleTimer` đầu vòng bọc trong `if (!passive)`; `adapter.handle(msg)` vẫn chạy cho mọi message (AC-4); log `info` `'claude-sdk settle cancelled — turn continues'` chỉ khi `settleCancelled && !closed` (D-5); 5 comment liệt kê ở mục "Task cho developer" #1 của spec được cập nhật cho khớp luật mới (gồm comment `prompt_suggestion` ở `event-adapter.ts`).
  - **Risk:** thấp — diff một khối; sai lầm dễ mắc là lỡ bỏ qua `adapter.handle` cho message thụ động (mất chip, vỡ AC-4).

- [ ] **T2. Viết test hồi quy `run-stream-settle.test.ts` (S1–S7 + U1) và chứng minh AC-2** — M
  - **Role:** developer
  - **Depends on:** T1 (cần các export mới)
  - **Acceptance:** file `apps/desktop/sidecar/src/runtime/claude-sdk/__tests__/run-stream-settle.test.ts` dựng đúng harness D-6 (5 mock, HOME tạm, `fakeCli` với `started`/`emit`/`inputClosed`, fake timer cài sau `started`, `afterEach` abort trước khi `await run`); đủ 8 kịch bản S1–S7 + U1 với assert mốc thời gian CHÍNH XÁC (`N−1` ms chưa đóng, `N` ms đã đóng — D-3) và đúng `reason`; map AC: S1 → AC-1/AC-3 (phần runtime)/AC-4, S2 → AC-10, S3 → AC-5, S4 → AC-6, S5 → AC-7, S6 → AC-8 + D-4, S7 → AC-9, U1 → D-1. Bằng chứng AC-2: tạm gỡ phần sửa của T1 (giữ export), S1 + S2 + phần D-4 của S6 FAIL ở assert (không treo tới timeout), ghi kết quả vào mô tả PR; khôi phục sửa ⇒ toàn bộ PASS.
  - **Risk:** đây là phần có thể phình S → M: chưa có tiền lệ test cho vòng `for await` của `claude-sdk/run-stream.ts`; fixture tối thiểu có thể thiếu field mà adapter đọc (bổ sung đúng field đó, không nới assert); S6 dài nhất, dễ lệch mốc nếu `emit` không chờ `next()` kế tiếp. Nếu vượt 1 ngày → báo TL trước khi tách state machine (TL đã bác refactor đó cho bugfix này).

- [ ] **T3. Chạy typecheck + lint + toàn bộ test claude-sdk** — S
  - **Role:** developer
  - **Depends on:** T2
  - **Acceptance:** `pnpm typecheck` và `pnpm lint` của sidecar 0 lỗi; `npx vitest@2 run src/runtime/claude-sdk/__tests__/` xanh (không vỡ test adapter/artifact/effort hiện có); test mới chạy ổn định 3 lần liên tiếp (không flaky do timer).
  - **Risk:** none.

- [ ] **T4. Review diff** — S
  - **Role:** code-reviewer
  - **Depends on:** T3
  - **Acceptance:** diff chỉ chạm `runtime/claude-sdk/run-stream.ts`, comment ở `event-adapter.ts` và file test mới (AC-11 — Pi/Codex không đổi, hằng số không đổi); predicate chỉ xét `msg.type`, không xét `subtype`, loại lạ trả `false` (chiều an toàn D-1); log D-5 không lọt vào event/trace/UI; không đụng logic followups (`sawFollowups`, E-9) của nhánh hiện tại; có bằng chứng AC-2 trong PR.
  - **Risk:** nhánh `fix/followups-duplicate-answer` đang có thay đổi followups — reviewer cần tách bạch hai mảng (cân nhắc commit riêng cho bugfix này).

- [ ] **T5. Kiểm tay AC-12 + AC-3 phần persist** — S
  - **Role:** qa-tester
  - **Depends on:** T3 (cần build từ bản sửa)
  - **Acceptance:** app build từ bản sửa, provider `anthropic`, `promptSuggestions` bật: 10 lượt chat liên tiếp (≥1 lượt dùng tool) — không lượt nào pending quá 10s sau reply cuối, không lượt nào lưu `canceled`; message assistant có `completedAt` + usage; gửi được lượt kế tiếp không cần Stop (lock nhả — AC-3); chip gợi ý vẫn hiện khi lượt không có `suggest_followups` (AC-4); ghi chú lượt nào thấy log `'claude-sdk settle cancelled'` kèm `type`/`subtype`.
  - **Risk:** CLI có thể bắt đầu gửi `idle` ở phiên bản khác ⇒ lỗi không tái hiện được bằng tay; khi đó dựa vào S1/S2 của T2 làm bằng chứng chính, ghi phiên bản CLI vào báo cáo QA.

## Backlog (sau bugfix)

- [ ] **T6. Theo dõi log D-5 sau release** — S · Role: developer · Depends on: T5 · Acceptance: nếu log cho thấy một loại message thụ động mới huỷ settle rồi lượt treo ⇒ thêm đúng một dòng vào `PASSIVE_AFTER_RESULT` + một case U1 (theo D-2, không thêm trần cứng).

## Open questions

- Không có câu hỏi chặn — Q-1…Q-5 đã chốt ở D-1…D-6.
- Ghi changelog cho bugfix thuộc quy trình release (không tách task ở đây); E-12 (phiên đã treo/lưu sai `canceled`) cố ý ngoài phạm vi.
