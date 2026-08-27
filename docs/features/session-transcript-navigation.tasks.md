# Plan: Điều hướng transcript dài — Bookmark (A1) + Find-in-session (A2)

> **Spec:** [session-transcript-navigation.md](./session-transcript-navigation.md) · **Brief:** [session-transcript-navigation.brief.md](./session-transcript-navigation.brief.md)
> **ADR ràng buộc:** [0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) + **[0075](../decisions/0075-transcript-surface-scoping.md)** (amend T0a của 0074)
> **Spec anh em:** [session-destructive-action-guard.md](./session-destructive-action-guard.md) — plan tại [session-destructive-action-guard.tasks.md](./session-destructive-action-guard.tasks.md)
> Vai trò tạo: Project Manager. Tài liệu **chỉ chia task + dependency + ước lượng + owner + acceptance**, KHÔNG chứa code.
> **Spec + ADR đã chốt hoàn toàn — 0 open question.** Task nào phát sinh câu hỏi mới ⇒ dừng, quay lại BA/TL, không tự quyết.
> **Sửa đổi 2026-08-27:** (1) **task A1.5 "Đưa vào ngữ cảnh ghim" đã bị gỡ** khỏi plan — cầu nối bookmark → ngữ cảnh ghim bị loại có chủ đích (code gỡ ở commit `79e00e5`, lý do ở [spec §16](./session-transcript-navigation.md)); ID `A1.5` **không tái sử dụng**, các task còn lại **không đánh số lại**. (2) Sửa danh sách đường cắt trong A1.1 / QA-B / QA-P từ "5 đường" về **đúng 3** — `/compact` **không** cắt transcript nên **không** prune bookmark ([spec §5.4](./session-transcript-navigation.md), **AC-P10**).

> **Đóng plan 2026-08-27.** Toàn bộ checkbox dưới đây đã tick. Nguồn verify:
> **static + grep + `pnpm lint` / `pnpm typecheck` (0 error) + prod `pnpm build`** — do assistant chạy lại từ đầu
> ở bước Z2, không dựa vào báo cáo cũ; **các ca cần bấm tay trong app** (QA-N / QA-F / QA-B / QA-P) —
> **user tự verify 2026-08-27**. Chi tiết từng điều kiện Z2 nằm ở phần Acceptance của Z2 và đều pass.

## Cách đọc plan

- **Effort:** S (< 0.5d) · M (0.5–2d) · L (2–5d). Không task nào XL.
- **Owner:** `developer` (impl) · `qa-tester` (verify AC) · `infosec` (audit) · `code-reviewer` (review) · `tech-lead` (chốt kiến trúc — plan này **không có** task TL vì ADR 0074 + 0075 đã chốt hết).
- **Depends on:** ID task upstream phải merge trước.
- **Acceptance** trỏ thẳng tới AC trong [spec §8](./session-transcript-navigation.md); QA tham chiếu bằng ID.
- **DoD chung cho MỌI task code** (không lặp lại ở từng task): `cd apps/desktop/ui-next && pnpm lint:fix && pnpm format && pnpm lint && pnpm typecheck` — **0 error** trước khi báo xong (`.claude/rules/lint-format.md`). Task chạm sidecar chạy thêm typecheck của package sidecar.
- Không thêm dependency mới (spec §15: **0 dependency mới**), không backend/DB mới, mọi màu qua token theme, mọi nhãn qua `t()`.

---

## ⚠ Cạm bẫy tài liệu — đọc trước khi code T0a

**Ai chỉ đọc [ADR 0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) mà bỏ qua [ADR 0075](../decisions/0075-transcript-surface-scoping.md) sẽ code SAI:**

| Sai nếu chỉ đọc 0074 | Đúng theo 0075 (thắng khi mâu thuẫn) |
|---|---|
| `registerTranscriptRevealer(fn)` — nhận một hàm trần | `registerTranscriptRevealer(entry)` với `entry = { root: () => HTMLElement \| null; reveal: (i) => Promise<void> }` |
| Registry **singleton cấp module**, "bản activate sau cùng thắng" | `provide`/`inject` theo **surface** — composable mới `useTranscriptSurface.ts`, 1 injection key |
| Đăng ký ở `onMounted` **+ `onActivated`**, huỷ ở `onUnmounted` **+ `onDeactivated`** | **Chỉ** `onMounted` / `onUnmounted`. Cặp `onActivated`/`onDeactivated` là **thừa** — phạm vi là **cấu trúc**, không phải thời gian |
| Query `document.querySelector('[data-mi="i"]')` | `entry.root()?.querySelector(...)`; không có entry ⇒ `'not-found'` ngay |
| — | Phần tử tìm được nhưng `el.getClientRects().length === 0` ⇒ **`'not-found'`**, không `scrollIntoView` no-op |

⇒ Kết quả thực tế: **T0a ĐƠN GIẢN HƠN** bản mô tả trong 0074, không phức tạp hơn.

---

## DAG phụ thuộc

```
T0b (rename FindBar — COMMIT RIÊNG, 0 logic)  ─────────────┐
                                                           │
T0a.1 → T0a.2 → T0a.3 ──────────────┬──────────────────────┼→ A2.1 → A2.2 → A2.3 → QA-F
   (surface + scroll async)         │                      │
                                    │                      │
T0c.1 → T0c.2 → T0c.4 (infosec) ────┼→ T0c.3 ──────────────┴→ A1.1 → A1.2 → A1.3 ─┬→ QA-B → QA-P
   (sidecar: types/RPC/param)       │      (store: eid + mint)          → A1.4 ────┘
                                    │
                                    └→ QA-N (nền tảng, sau T0a.3)
                                                                        ↓
                                              (chéo feature)  B2 của session-destructive-action-guard
                                                              ─── DEPENDENCY CỨNG: B2 → T0c ───
                                                              B2 KHÔNG được bắt đầu trước khi T0c.3 merge

B1 (feature guard) — ĐỘC LẬP HOÀN TOÀN, chạy song song T0a/T0b/T0c
```

**Cạnh phụ thuộc chéo feature (bắt buộc ghi ở cả 2 plan):**

| Cạnh | Nghĩa |
|---|---|
| **`B2 → T0c`** | Lát **B2** (vá persist `rewind`, §4.8 spec B) **không được bắt đầu** trước khi **T0c.3** (`eid` cho user/system + mint `userMessageId`) merge. Chốt TL-1, [spec B §12.2 + §16](./session-destructive-action-guard.md). |
| `B1 ⟂ tất cả` | Lát **B1** không phụ thuộc gì ở plan này — song song được. |
| `A1 ⟷ B1/B2` | Cả hai chạm `SessionMessageItem.vue` và `stores/sessions.ts` ⇒ **rủi ro cùng-file**, xem §"Rủi ro cùng-file". |

---

## T0a — Nền tảng điều hướng: `scrollToMessage` async + surface registry + `revealMessage`

> Ship độc lập được. Sửa luôn 2 bug sẵn có: anchor follow-up thất bại im lặng (AC-N6) và chọn nhầm transcript khi nhiều surface cùng mount (AC-N9).

- [x] **T0a.1. Tạo `useTranscriptSurface` + đổi `scrollToMessage` sang async có kết quả** — **M**
  - **Mô tả:** Composable mới giữ **đúng một** injection key + `provideTranscriptSurface()` (tạo `shallowRef<TranscriptEntry | null>(null)` rồi `provide`). `useSessionScroll` `inject` cùng ref; `scrollToMessage(i)` thành `async` trả `'ok' | 'not-found'` theo đúng thứ tự: `await entry.reveal(i)` → `await nextTick()` → `entry.root()?.querySelector('[data-mi="i"]')` → không có ⇒ `'not-found'` → `getClientRects().length === 0` ⇒ `'not-found'` → còn lại ⇒ `scrollIntoView({ block: 'center' })` + flash accent (giữ nguyên đoạn flash hiện có). **Không entry ⇒ `'not-found'` ngay, không bao giờ rơi về `document`.**
  - **File chạm:** `apps/desktop/ui-next/composables/useTranscriptSurface.ts` (**mới**) · `apps/desktop/ui-next/composables/useSessionScroll.ts`
  - **Depends on:** none
  - **Owner:** developer
  - **Acceptance:** **AC-N4** (`'not-found'` không throw/không cuộn/không flash) · **AC-N10** — grep `apps/desktop/ui-next/composables/useSessionScroll.ts` **không còn chuỗi `document.querySelector`** (điều kiện review, grep được) · chữ ký đúng [ADR 0075 §1](../decisions/0075-transcript-surface-scoping.md) (`entry` có `root`, không phải hàm trần).
  - **Risk:** đọc nhầm ADR (xem §"Cạm bẫy tài liệu"). `scrollToMessage` giờ trả Promise ⇒ call site cũ trong template có thể bị lint kêu floating promise (thêm `void`, không đổi hành vi).

- [x] **T0a.2. `SessionTranscript`: `revealMessage` + đăng ký entry + prop `suppressAutoScroll`** — **M**
  - **Mô tả:** `SessionTranscript` **sở hữu** `windowStart`; đăng ký entry `{ root: () => msgsEl, reveal: revealMessage }` ở **`onMounted`**, clear ở **`onUnmounted`** (chỉ clear khi con trỏ vẫn là chính nó). **KHÔNG** thêm `onActivated`/`onDeactivated`. `revealMessage(i)`: ngoài `[0, messages.length)` ⇒ return; `target = turnStartFor(i)`; `target >= windowStart` ⇒ return (**chỉ nới, không co**); nới thì neo viewport bằng **đúng phép toán của `loadOlder`** (`prevH`/`prevTop` → đổi `windowStart` → `nextTick` → `scrollTop = prevTop + (scrollHeight - prevH)` → `updateEdges()`). Thêm prop `suppressAutoScroll?: boolean`; watcher `scrollSig` đổi thành `if (grew && !props.suppressAutoScroll) stick.value = true`.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionTranscript.vue`
  - **Depends on:** T0a.1
  - **Owner:** developer
  - **Acceptance:** **AC-N1** (nhảy tới turn đầu của session 200 tin nhắn, `'ok'` + căn giữa + flash) · **AC-N2** (`windowStart` mới = `turnStartFor(i)`, **không** = 0) · **AC-N3** (neo viewport: nội dung đang đọc không dịch một pixel **trước** `scrollIntoView`) · **AC-N5** (window chỉ nới, không co; không unmount thứ đang đọc).
  - **Risk:** phép neo `loadOlder` sai một bước ⇒ màn hình giật — AC-N3 là ca dễ trượt nhất.

- [x] **T0a.3. Gắn `provideTranscriptSurface()` vào 2 surface + sửa call site** — **S**
  - **Mô tả:** `SessionDetail.vue` và `SshSessionPanel.vue` mỗi cái gọi `provideTranscriptSurface()` đúng **một lần** ở setup (hai — và chỉ hai — surface hợp lệ hiện nay). Sửa call site anchor follow-up + follow-up card ở composer cho khớp chữ ký async (`void` nếu lint kêu).
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionDetail.vue` · `apps/desktop/ui-next/components/ssh/SshSessionPanel.vue` · `apps/desktop/ui-next/components/session/SessionMessageItem.vue` · `apps/desktop/ui-next/components/session/SessionComposer.vue`
  - **Depends on:** T0a.2
  - **Owner:** developer
  - **Acceptance:** **AC-N6** (anchor follow-up sau `<KeepAlive>` restore vẫn nhảy đúng) · **AC-N9** (2 tab SSH co-pilot: chỉ transcript của `SessionDetail` cuộn) · anchor follow-up trong SSH co-pilot **không** trả `'not-found'` (thiếu `provideTranscriptSurface()` ở `SshSessionPanel` là bug chết người, ADR 0075 §"Việc cần làm tiếp").
  - **Risk:** quên `SshSessionPanel.vue` ⇒ SSH co-pilot mất hoàn toàn khả năng nhảy — im lặng ở dev, lộ ở QA-N.

### Checklist PR cho T0a (reviewer bám sát)

- [x] Đã đọc **cả** ADR 0074 **và** ADR 0075 — 0075 **thắng** ở phần T0a/§Q2.
- [x] `registerTranscriptRevealer` nhận **entry có `root`**, không phải hàm trần.
- [x] **Không** có `onActivated` / `onDeactivated` **cho việc đăng ký revealer** trong `SessionTranscript.vue` (thừa theo 0075 — phạm vi là **cấu trúc**, `onMounted`/`onUnmounted` là đủ). *(Lưu ý khi verify: `onActivated(windowAndScrollToBottom)` ở `SessionTranscript.vue:302` là code **có sẵn từ trước** cho việc khôi phục scroll sau `<KeepAlive>`, **không** liên quan revealer — đừng gỡ.)*
- [x] `grep -n 'document.querySelector' apps/desktop/ui-next/composables/useSessionScroll.ts` ⇒ **rỗng** (**AC-N10**).
- [x] Guard `getClientRects().length === 0` chạy **sau** reveal + `nextTick`, không phải trước.
- [x] `provideTranscriptSurface()` xuất hiện đúng **2 nơi**: `SessionDetail.vue`, `SshSessionPanel.vue`.
- [x] `pnpm lint` + `pnpm typecheck` = 0 error.

---

## T0b — Rename `PreviewFindBar.vue` → `common/FindBar.vue`

- [x] **T0b. Rename FindBar + đổi khoá i18n — COMMIT/PR RIÊNG, 0 dòng logic** — **S**
  - **Mô tả:** Rename thuần component; i18n `common.preview.find.{matchCase,noResults,next,prev,close}` → `common.find.*` (en + vi). Khoá `placeholder` **KHÔNG** đi theo: `FindBar` nhận **prop `placeholder: string` bắt buộc**; preview giữ `common.preview.find.placeholder`. **`usePreviewFind.ts` KHÔNG đụng, KHÔNG generalize.**
  - **File chạm:** `apps/desktop/ui-next/components/common/PreviewFindBar.vue` → `apps/desktop/ui-next/components/common/FindBar.vue` · `apps/desktop/ui-next/components/common/PreviewModal.vue` · `apps/desktop/ui-next/i18n/locales/en/common.json` · `apps/desktop/ui-next/i18n/locales/vi/common.json`
  - **Depends on:** none (song song T0a / T0c / B1)
  - **Owner:** developer
  - **Acceptance:**
    - **AC-N8** — diff **chỉ** gồm: đổi tên file + đổi khoá i18n (trừ `placeholder`) + thêm prop `placeholder` + sửa call site. **0 dòng logic mới.**
    - **Commit riêng, PR riêng, không trộn tính năng** — theo `.claude/rules/git-commit.md` ("tách commit theo loại"). Message: `refactor(ui): rename PreviewFindBar to common FindBar`. Reviewer **từ chối PR** nếu có bất kỳ hunk nào thuộc A2/A1 lọt vào.
    - **AC-N7** — 14 AC của [preview-modal-find.md](./preview-modal-find.md) **vẫn pass nguyên**, placeholder preview vẫn là "Tìm trong tài liệu…".
  - **Risk:** cám dỗ "tiện tay generalize `usePreviewFind`" — cấm; transcript dùng `useSessionFind` mới (A2.2).

---

## T0c — Neo bằng id bền: `eid` cho user/system + `userMessageId` + `sessions.updateBookmarks`

> Chạm **sidecar**. Đây là **điểm infosec bắt buộc DUY NHẤT** của cả 3 issue (2 spec).

- [x] **T0c.1. Sidecar: type `SessionBookmark` + `Session.bookmarks` + `SessionMetadataPatch`** — **S**
  - **Mô tả:** `SessionBookmark = { id: string; at: string }`; `Session.bookmarks?: SessionBookmark[]` vào **header session**. Thêm `bookmarks` vào `SessionMetadataPatch` (+ patch union ở `store.ts` nếu bản sao thứ hai còn tồn tại). **KHÔNG** thêm vào `SessionSummary`. **KHÔNG persist excerpt** (ngân sách probe 8KB). Header parse phải **bỏ qua phần tử sai shape**, không throw (L2 → re-validate khi load).
  - **File chạm:** `apps/desktop/sidecar/src/types/shared.ts` · `apps/desktop/sidecar/src/sessions/session-manager.ts` · `apps/desktop/sidecar/src/sessions/store.ts`
  - **Depends on:** none
  - **Owner:** developer
  - **Acceptance:** **AC-B12** (header chỉ chứa `{ id, at }`, ≤ ~1.8KB ở 30 mục) · **AC-B18** (`sessions.list` → `SessionSummary` **không** có `bookmarks`) · §10.3 spec: file sửa tay có phần tử sai shape ⇒ bỏ qua, không throw.

- [x] **T0c.2. Sidecar: RPC `sessions.updateBookmarks` + param `userMessageId` cho `sessions.sendMessage`** — **M**
  - **Mô tả:** Method mới theo đúng mô hình [`sessions.update-todos.ts`](../../apps/desktop/sidecar/src/methods/sessions.update-todos.ts) — schema **là biên validate**, unknown field bị strip, mảng rỗng hợp lệ (= xoá hết), **cap `MAX_BOOKMARKS = 30` tại schema**, mỗi phần tử `id` khớp `/^[A-Za-z0-9_-]{1,64}$/`, `at` max 40. Đăng ký import ở `index.ts`. Song song: `sessions.sendMessage` nhận `userMessageId?: string` với **`z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional()`**, dùng thay `randomBytes(...)` khi persist message user; **không truyền ⇒ hành vi cũ (`msg_u_<hex>`)**. `sessions/jsonl.ts` **KHÔNG sửa**.
  - **File chạm:** `apps/desktop/sidecar/src/methods/sessions.update-bookmarks.ts` (**mới**) · `apps/desktop/sidecar/src/index.ts` · `apps/desktop/sidecar/src/methods/sessions.send-message.ts` (~dòng 1149)
  - **Depends on:** T0c.1
  - **Owner:** developer
  - **Acceptance:** **AC-B11** (payload 31 phần tử ⇒ zod reject, không ghi đĩa) · **AC-P5** (payload `userMessageId = "../../etc/passwd"` / chứa `/`, `\`, khoảng trắng, hoặc > 64 ký tự ⇒ **reject tại biên**) · **AC-P6** (`userMessageId` hợp lệ + có ảnh đính kèm ⇒ file trong `attachments/` tên `${userMessageId}-${att.id}` và **nằm trong** thư mục session) · **AC-P8** (kill app ngay sau RPC ⇒ header vẫn parse được, ghi atomic tmp → rename).
  - **Risk:** **BLOCKER bảo mật** — thiếu regex là mở path traversal, xem T0c.4.

- [x] **T0c.3. UI/store: `eid` cho user/system + mint `userMessageId` + hydrate `bookmarks`** — **M**
  - **Mô tả:** `engineMessageToSessionMessage` gắn `eid: m.id` cho **cả `user` và `system`** (hiện chỉ assistant, `sessions.ts:1050-1063`). Type UI: `UserMessage.eid?`, `SystemMessage.eid?`, `Session.bookmarks?`. `msgsToEngineMessages` dùng lại `eid` cho user/system thay vì mint `fm-<i>-<seq>`. `sendMessage` mint id lượt user theo mẫu `mu-<base36>-<base36>` và gửi kèm param `userMessageId`. `ensureLoaded` hydrate `full.bookmarks`.
  - **File chạm:** `apps/desktop/ui-next/composables/useSessionsData.ts` · `apps/desktop/ui-next/stores/sessions.ts` (~1000 `ensureLoaded`, ~1050 `engineMessageToSessionMessage`, ~2807 `msgsToEngineMessages`, ~2958/3046 `sendMessage`)
  - **Depends on:** T0c.2
  - **Owner:** developer
  - **Acceptance:** **AC-P4** (tin nhắn user vừa gửi **trong phiên hiện tại** đã có nút "Đánh dấu" dùng được — không phải chờ reload) · sau `ensureLoaded`, **mọi** message trong `s.msgs` có `eid` **trừ** message hệ thống cục bộ `ENGINE_UNAVAILABLE` (`sessions.ts:2934/3632/3647`) — đây chính là tiền đề **AC-R7** mà lát **B2** của feature guard sẽ verify.
  - **Risk:** **`markRaw`** — `ensureLoaded` `markRaw` mọi message trừ cái cuối ⇒ **cấm** để bookmark thành field trên message (sẽ không reactive). Bookmark là **mảng cấp session**.
  - **Ghi chú chéo feature:** merge task này là **điều kiện mở khoá B2** (dependency cứng).

- [x] **T0c.4. Infosec audit: `userMessageId` (L1) → path sink `sanitizeChild`** — **S**
  - **Mô tả:** Audit đúng **một** điểm mở bề mặt của cả 3 issue. `userMessageId` là input **L1** (từ UI qua IPC) và `message.id` chảy vào path sink `sanitizeChild(\`${message.id}-${att.id}\`)` tại **`apps/desktop/sidecar/src/sessions/jsonl.ts:223`**. `sanitizeChild` **chỉ** chặn `/`, `\`, `..` ⇒ **không được coi là lớp bảo vệ duy nhất**. Xác nhận schema zod **bắt buộc** `.regex(/^[A-Za-z0-9_-]{1,64}$/)` tại biên `sessions.sendMessage` và regex `id` ở `sessions.updateBookmarks`.
  - **File chạm (đọc, không sửa):** `apps/desktop/sidecar/src/methods/sessions.send-message.ts` · `apps/desktop/sidecar/src/methods/sessions.update-bookmarks.ts` · `apps/desktop/sidecar/src/sessions/jsonl.ts:223`
  - **Depends on:** T0c.2
  - **Owner:** infosec
  - **Acceptance:** **AC-P5** verify bằng payload độc (`../../etc/passwd`, `a/b`, `a\b`, chuỗi 65 ký tự, chuỗi rỗng, unicode) ⇒ **reject 100%**; **AC-P6** path resolve nằm trong `~/.awog/sessions/{id}/`; **AC-P9** (`sessions.updateBookmarks` **không** nằm trong allowlist remote gateway ⇒ PWA gọi bị default-deny) · xác nhận **không** chạm [`remote-gateway-policy.ts`](../../apps/desktop/electron/src/remote-gateway-policy.ts) / [`remote-gateway-catalog.ts`](../../apps/desktop/electron/src/remote-gateway-catalog.ts) trong PR.
  - **Risk:** **Điều kiện merge cứng.** T0c.2 **không được merge** nếu task này chưa PASS. Nếu ai đó mở allowlist gateway ⇒ **re-audit bắt buộc** (spec §7.2).

---

## A2 — Tìm trong phiên (find-in-session)

> Ship **trước** A1: ít câu hỏi mở hơn và tự nó giải phần lớn nỗi đau. **Hai lớp DATA / DOM không được trộn** (spec §4).

- [x] **A2.1. `utils/transcript-text.ts` — bề mặt tìm kiếm `searchableSegments`** — **S**
  - **Mô tả:** Hàm thuần `searchableSegments(m): { segIndex, text }[]`. **Vào bề mặt:** text của `UserMessage`, text của `SystemMessage`, block `kind === 'text'` của `AssistantMessage`. **KHÔNG vào:** `thinking` / `step` / `detail` / diff / terminal output / `plan` / `question` / `perm` / `steer` / `error` (**quyết định cuối**). Chuẩn hoá **giống hệt** `buildTextIndex`: gộp `\s+ → ' '` + `.normalize('NFC')` cho **cả text lẫn query**. Tìm literal substring bằng `indexOf`, **không regex**.
  - **File chạm:** `apps/desktop/ui-next/utils/transcript-text.ts` (**mới**)
  - **Depends on:** none (nhưng chỉ hữu ích khi A2.2 dùng)
  - **Owner:** developer
  - **Acceptance:** **AC-F11** (NFC: "phân tích" match, "phan tich" **không** match) · **AC-F16** (chuỗi chỉ có trong tool detail/diff/terminal/thinking ⇒ `0/0`).

- [x] **A2.2. `useSessionFind` — lớp DATA (nguồn sự thật) + điều phối DOM (trang trí)** — **L**
  - **Mô tả:** Lớp **DATA** tính `matches: { msgIndex, segIndex, occurrence }[]` trên **`s.msgs`** (toàn session, kể cả chưa mount) — quyết định `n/N`, next/prev, wrap-around; **thất bại không được phép**. Lớp **DOM** wrap `<mark class="findmatch">` + `findmatch--current` cho **một** message — **được phép degrade**. Session chưa `loaded` ⇒ `await ensureLoaded(s.id)` trước, hiện trạng thái nạp. Debounce ~120ms. `clearMatches` trước mỗi lần đổi match / đổi query / đóng thanh / đổi session / `msgs.length` đổi. Dùng lại `utils/find-in-dom.ts` **nguyên trạng, không sửa một dòng**; `usePreviewFind.ts` **KHÔNG đụng**.
  - **File chạm:** `apps/desktop/ui-next/composables/useSessionFind.ts` (**mới**) · `apps/desktop/ui-next/utils/find-in-dom.ts` (**chỉ đọc**) · `apps/desktop/ui-next/composables/usePreviewFind.ts` (**KHÔNG đụng**)
  - **Depends on:** T0a.3, A2.1
  - **Owner:** developer
  - **Acceptance:** **AC-F2** (chưa `loaded` ⇒ "Đang nạp…", **tuyệt đối không** `0/0`) · **AC-F3** (`N` tính trên toàn session: 7 match trong đó 6 ngoài render-window ⇒ `1/7`) · **AC-F4** (gõ ⇒ counter đổi, **viewport giữ nguyên**) · **AC-F5** (Next ⇒ nới window + cuộn + wrap + counter +1) · **AC-F6** wrap-around 2 chiều · **AC-F7** toggle `Aa` live, không cuộn · **AC-F8** `0/0` + viền `--danger` + Next/Prev disabled · **AC-F9** xoá input ⇒ gỡ sạch `<mark>`, không lỗi console · **AC-F12** (DOM lệch DATA ⇒ **vẫn reveal + cuộn**, chỉ bỏ `<mark>`; `N` **không đổi**) · **AC-F13** (chỉ message chứa match hiện tại được wrap) · **AC-F15** (message đang `streaming` ⇒ reveal + cuộn, **không wrap**) · **AC-F20** debounce ≤ 1 lần `runFind` sau ~120ms · **AC-F21** (`msgs.length` tăng ⇒ `clearMatches` **trước** re-render, tính lại matches, không `<mark>` mồ côi) · **AC-F22** (mọi match `'not-found'` ⇒ duyệt **tối đa một vòng** rồi dừng + toast `sessions.find.notFoundJump`, **không lặp vô hạn**).
  - **Risk:** trộn hai lớp là lỗi kiến trúc nặng nhất của A2 — reviewer soi kỹ: `n/N` **không bao giờ** được đếm `<mark>` trong DOM. `root.normalize()` có thể gộp text node của `<mark>` quote-highlight ⇒ `clearMatches` phải chạy **trước** khi quote-highlight áp lại và ngược lại.

- [x] **A2.3. Wiring `SessionDetail`: `⌘F` / `Esc` + mount `FindBar` + `suppressAutoScroll` + i18n** — **M**
  - **Mô tả:** Mount `common/FindBar.vue` **overlay absolute góc trên-phải vùng `.chat`** (không đẩy layout, không đè nút fold-all). `⌘/Ctrl+F` (capture, `preventDefault` + `stopPropagation`) mở/focus thanh find; **nhường** khi focus trong `.monaco-editor` / `.xterm` hoặc PreviewModal đang mở; **không nhường** composer textarea. Thứ tự `Esc`: modal/popover > thanh find > hành vi Esc hiện có. Bật `suppressAutoScroll` khi thanh mở, **tắt khi đóng**. Thêm khoá i18n `sessions.find.*` (§11.2) en + vi.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionDetail.vue` · `apps/desktop/ui-next/i18n/locales/en/sessions-transcript.json` · `apps/desktop/ui-next/i18n/locales/vi/sessions-transcript.json`
  - **Depends on:** T0b, A2.2
  - **Owner:** developer
  - **Acceptance:** **AC-F1** (thanh mở, input focus, **browser-find KHÔNG bung**) · **AC-F10** (`Esc` đóng thanh, **session vẫn mở**, workspace panel không đổi, giữ vị trí cuộn) · **AC-F14** (đang stream + thanh find mở ⇒ transcript **không** tự kéo về đáy) · **AC-F17** (đổi session / release sang popout ⇒ đóng thanh + `clearMatches` **trước** re-render + reset query, không sót `<mark>` rác) · **AC-F18** (Monaco/xterm nhận phím như trước) · **AC-F19** (PreviewModal mở ⇒ chỉ handler preview chạy) · mọi nhãn qua `t()`, **không literal string**.
  - **Risk:** `suppressAutoScroll` **rò rỉ** ⇒ gửi tin mới không tự cuộn xuống đáy nữa (hồi quy bắt buộc #1 ở QA-F).

---

## A1 — Đánh dấu (Bookmark)

> **Từ vựng bắt buộc:** tên UI "Đánh dấu", icon `bookmark`, tiền tố `sessions.bookmark.*`. **CẤM** chữ `pin*` / icon `pin` cho A1 ở **mọi** nơi — không có ngoại lệ nào (cầu nối "Đưa vào ngữ cảnh ghim" đã bị loại, [spec §16](./session-transcript-navigation.md)). Bookmark **không vào prompt**, **không rời `.awog`**, **không tới remote gateway**.

- [x] **A1.1. Store: actions bookmark + prune 3 đường cắt + fork filter tường minh** — **M**
  - **Mô tả:** Actions mới `toggleBookmark(id, msgIndex)` / `removeBookmark(id, bookmarkId)` / **`pruneBookmarksTo(s, survivingIds)`** (một hàm duy nhất, dùng lại ở **đúng 3 đường**: `rewind`, `resend` — gồm cả "edit & resend" vì đó chính là `resend` có `overrideText` — và `regenerate`). **`/compact` KHÔNG prune, KHÔNG đụng `bookmarks`** — nó chỉ cắt ngữ cảnh gửi model, transcript còn nguyên (spec §5.4, **AC-P10**). Ghi **optimistic** + `pushRequest` (như `setTodos`), lỗi ⇒ log `console.warn` + toast, **không rollback** (payload là toàn bộ mảng nên thao tác kế tiếp tự chữa). Thứ tự cắt bắt buộc: tính `survivingIds = new Set(idsOf(msgs.slice(0, index)))` **TRƯỚC** khi cắt → prune → `sessions.updateBookmarks` → **rồi mới** `msgs.slice(...)` + cắt trên đĩa. `fork` (~3695): **lọc `bookmarks` tường minh** theo `msgs.slice(0, index + 1)` — **không dựa vào `...s` spread**.
  - **File chạm:** `apps/desktop/ui-next/stores/sessions.ts` (~3651 `rewind`, ~3667 `resend`, ~3595 `regenerate` + `retryModel` ở nhánh browser-dev, ~3695 `fork`) · `apps/desktop/ui-next/composables/useSessionsData.ts`
  - **Depends on:** T0c.3
  - **Owner:** developer
  - **Acceptance:** **AC-P1** (bookmark #5 còn, #40 bị dọn, `sessions.updateBookmarks` gọi **trước** khi cắt đĩa; sau reload đúng 1 bookmark) · **AC-P2** (fork tại 20 ⇒ bản fork chỉ mang #5; **session gốc giữ nguyên cả hai**) · **AC-P10** (`/compact` ⇒ `s.msgs` không đổi, `sessions.updateBookmarks` **KHÔNG** được gọi, thanh giữ đủ số bookmark) · **AC-B17** (bookmark **không** xuất hiện trong payload `sendMessage` hay system prompt).
  - **Risk:** **Rủi ro cùng-file với B1/B2** (`stores/sessions.ts`) — xem §"Rủi ro cùng-file". Thứ tự với feature guard: `confirm()` chạy **trước** cả bước tính `survivingIds` ([spec B §6](./session-destructive-action-guard.md)) — huỷ hộp thoại ⇒ **bookmark KHÔNG bị prune**.

- [x] **A1.2. `useSessionBookmarks` — resolve `O(1)` + rows sort + excerpt + dangling** — **M**
  - **Mô tả:** Một `computed` dựng `Map<eid, index>` từ `s.msgs`; mọi bookmark tra map — **không** `findIndex` trong `v-for`. **Bất biến tuyệt đối:** đường resolve là `map.get(b.id)`; `undefined` ⇒ **return sớm**, không fallback index cũ, không "gần đúng". Rows sort theo `at` **ASC** (tie-break: index đã resolve ASC; dangling xếp **sau**). Excerpt derive lúc render từ `searchableSegments(m)` — đoạn text non-empty đầu tiên, `\s+ → ' '`, trim, cắt **100 ký tự** + `…` (đây là **độ dài duy nhất** của feature); turn không có text ⇒ `sessions.bookmark.noText`. State expand/collapse **ephemeral, không persist**, reset khi đổi session.
  - **File chạm:** `apps/desktop/ui-next/composables/useSessionBookmarks.ts` (**mới**)
  - **Depends on:** A1.1, A2.1 (dùng lại `searchableSegments`)
  - **Owner:** developer
  - **Acceptance:** **AC-B4** (đánh dấu #80 trước, #12 sau ⇒ hiển thị **#12 rồi #80**, sort theo thời gian tạo tin nhắn, **không** theo lúc bấm) · **AC-B13** (id không resolve ⇒ hàng dangling, **app không crash**, console không exception) · §14 spec: tie-break `at` trùng.

- [x] **A1.3. `SessionBookmarkBar.vue` + mount trong `SessionDetail`** — **M**
  - **Mô tả:** Thanh "Đã đánh dấu (N)" đặt **ngay trên** `<SessionTranscript>` trong `SessionDetail`, cạnh `SessionTodoPanel`. **KHÔNG** đặt bên trong `SessionTranscript` (để `SshSessionPanel` không kéo theo). **Rỗng ⇒ không render** (`v-if`, 0px). Chỉ hiện khi `session.loaded`. Rút gọn = 1 hàng (mục có `at` lớn nhất) + chip đếm `N` + nút mở rộng; mở rộng = danh sách sort ASC, mỗi hàng có excerpt + thời gian tương đối + nút `×`. Click hàng ⇒ `await scrollToMessage(i)`; `'not-found'` ⇒ toast `sessions.bookmark.notFound` + hàng chuyển hiển thị dangling **trong phiên hiện tại** (không ghi đĩa). Màu qua token (`--bgEl`, `--border`, `--text`, `--textDim`, `--accent`, `--accentBorder`, `--bgHover`, `--danger`); excerpt/tiêu đề `text-[1em]`, chip `N` = `text-[12px]` fixed + `font-mono leading-none`. Thêm khoá i18n `sessions.bookmark.*` (§11.2) en + vi.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionBookmarkBar.vue` (**mới**) · `apps/desktop/ui-next/components/session/SessionDetail.vue` · `apps/desktop/ui-next/i18n/locales/en/sessions-transcript.json` · `apps/desktop/ui-next/i18n/locales/vi/sessions-transcript.json`
  - **Depends on:** A1.2, T0a.3
  - **Owner:** developer
  - **Acceptance:** **AC-B5** (4 bookmark ⇒ rút gọn hiện đúng 1 mục có `at` lớn nhất + chip `4`) · **AC-B6** (mở rộng đủ 4 hàng ASC; thu lại; **không persist**) · **AC-B7** (không bookmark ⇒ **không tồn tại trong DOM**, `clientHeight` của `.msgs` **không giảm một pixel**) · **AC-B8** (click bookmark ngoài render-window ⇒ nới window + cuộn + flash, **không im lặng**) · **AC-B9** (chưa `loaded` ⇒ chưa render; sau `ensureLoaded` hiện đủ excerpt) · **AC-B13/AC-B14** (dangling: mờ, **không bấm được**, nhãn + nút "Gỡ đánh dấu"; click ⇒ **tuyệt đối không** cuộn tới tin nhắn khác).
  - **Risk:** đặt nhầm thanh vào trong `SessionTranscript` ⇒ SSH co-pilot mọc thêm thanh bookmark (sai spec §6.1).

- [x] **A1.4. Nút "Đánh dấu" trong footer action row (assistant + user bubble)** — **S**
  - **Mô tả:** Icon-only `p-1.5 rounded transition`, icon size `13`, `title` bắt buộc (`.claude/rules/nuxt-vue.md` §UI patterns). **Ẩn** khi `streaming === true` hoặc message **không có `eid`**. **Disabled** (mờ + tooltip "Tối đa 30 đánh dấu mỗi phiên") khi đã đủ `MAX_BOOKMARKS` và message chưa được đánh dấu. Trạng thái bật: màu `--accent`, tooltip "Bỏ đánh dấu". Icon **bắt buộc là `bookmark`**, cấm `pin`.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionMessageItem.vue` (`msgActions` ~503-518 cho assistant; hàng action user bubble ~46-63)
  - **Depends on:** A1.1
  - **Owner:** developer
  - **Acceptance:** **AC-B1** · **AC-B2** (streaming hoặc không `eid` ⇒ nút **không hiện**) · **AC-B3** (click ⇒ thanh cập nhật trong **cùng một frame**, optimistic; click lần nữa gỡ) · **AC-B10** (đủ 30 ⇒ disabled, click **không gửi RPC**).
  - **Risk:** **Rủi ro cùng-file với B1** (`SessionMessageItem.vue`) — serialize, xem §"Rủi ro cùng-file".

> **A1.5 (cũ) — "Đưa vào ngữ cảnh ghim": ĐÃ GỠ 2026-08-27.** Cầu nối bookmark → ngữ cảnh ghim bị loại **có chủ đích** (code gỡ ở commit `79e00e5`); ID `A1.5` **không tái sử dụng**. Lý do + ranh giới: [spec §16](./session-transcript-navigation.md). Ai muốn AI ghi nhớ nội dung thì dùng trực tiếp ngữ cảnh ghim ở composer — **không** mở lại task này để "cho đủ".

---

## QA

- [x] **QA-N. Verify nhóm N — nền tảng điều hướng (gồm ca multi-surface)** — **M**
  - **Mô tả:** Chạy toàn bộ AC-N1…AC-N10. **Ca bắt buộc không được bỏ:**
    1. **Multi-surface:** mở **SSH co-pilot ở 2 tab** (cả hai mount `SessionTranscript` của **cùng** session, 1 tab đang ẩn vì `v-show`) → ở `SessionDetail` click một bookmark/anchor trỏ tới tin nhắn **ngoài render-window**.
    2. Session 200 turn, nhảy tới turn đầu tiên (đo thời gian, kỳ vọng ~≤500ms + có flash phản hồi thị giác).
    3. `SessionDetail` restore từ `<KeepAlive>` rồi click anchor follow-up.
    4. **Grep review:** `useSessionScroll.ts` không còn `document.querySelector`.
    5. **Hồi quy:** gửi tin nhắn mới khi thanh find **đóng** ⇒ transcript vẫn tự cuộn xuống đáy.
  - **Depends on:** T0a.3
  - **Owner:** qa-tester
  - **Acceptance:** **AC-N1 … AC-N6**, **AC-N9** (chỉ transcript của `SessionDetail` cuộn; **không** tác động tab ẩn; **không** trả `'ok'` cho phần tử trong subtree ẩn), **AC-N10** — tất cả PASS, có ghi chú kết quả từng AC.

- [x] **QA-T0b. Hồi quy PreviewModal sau rename** — **S**
  - **Mô tả:** Chạy lại **14 AC** của [preview-modal-find.md](./preview-modal-find.md) trên PreviewModal markdown-render; kiểm tra placeholder preview không đổi; đọc diff xác nhận 0 dòng logic.
  - **Depends on:** T0b
  - **Owner:** qa-tester
  - **Acceptance:** **AC-N7** (14 AC pass nguyên) · **AC-N8** (diff chỉ rename + i18n + prop + call site; **commit riêng**).

- [x] **QA-F. Verify nhóm F — Tìm trong phiên** — **M**
  - **Mô tả:** Chạy AC-F1…AC-F22. **Ca bắt buộc nhấn:**
    1. **Search message NGOÀI render-window** — session 200 turn mount 5 turn cuối, chuỗi chỉ xuất hiện ở turn #1 ⇒ counter đúng **ngay lập tức**, Enter nhảy tới đúng nơi (đây chính là con bug `⌘F` của Chromium mà feature tồn tại để sửa).
    2. Chuỗi xuất hiện 7 lần, 6 lần ngoài phần render ⇒ `1/7`.
    3. Session **chưa `loaded`** ⇒ "Đang nạp…", **không bao giờ** `0/0`.
    4. **`<mark>` chồng `<mark>`:** một message **vừa được quote-highlight vừa là match hiện tại** ⇒ không nuốt/nhân bản mark.
    5. Match trong message đang **stream** ⇒ reveal + cuộn, không wrap.
    6. `⌘F` khi focus trong Monaco / xterm / PreviewModal mở ⇒ nhường đúng.
    7. Đổi session + release sang popout khi thanh find đang mở.
    8. Popout window: `⌘F` vẫn chạy (handler cục bộ của `SessionDetail`).
  - **Depends on:** A2.3
  - **Owner:** qa-tester
  - **Acceptance:** **AC-F1 … AC-F22** PASS + hồi quy "gửi tin ⇒ tự cuộn đáy" (`suppressAutoScroll` không rò rỉ).

- [x] **QA-B. Verify nhóm B — Đánh dấu (gồm ca dangling)** — **M**
  - **Mô tả:** Chạy AC-B1…AC-B19 — **trừ AC-B15 / AC-B16 đã bỏ cùng A1.5, không chạy, không tái sử dụng số**. **Ca bắt buộc nhấn — bookmark DANGLING sau khi transcript bị cắt:**
    1. Bookmark **dangling sau `rewind`** — kiểm tra bookmark thuộc phần bị cắt **được tự dọn** (không sinh hàng dangling), bookmark còn sống vẫn nguyên.
    2. Bookmark **sau `fork`** — bản fork chỉ mang bookmark trong `msgs.slice(0, index + 1)`; **session gốc giữ nguyên cả hai**.
    3. Bookmark **KHÔNG bị dọn sau `/compact`** (**AC-P10**) — chạy `/compact` thành công (đồng hồ ngữ cảnh tụt), rồi verify: `s.msgs` không đổi, `sessions.updateBookmarks` **không** được gọi (spy/log RPC), thanh giữ **đủ** số bookmark, **cả bookmark nằm trước `firstKeptMessageId` vẫn nhảy đúng**; sau reload app header vẫn đủ. `/compact` chỉ tóm tắt ngữ cảnh model trong `buildContext` — transcript trên đĩa nguyên vẹn (spec §5.4).
    4. Dangling **thật** (id không resolve được, ví dụ transcript đang reload / session vừa cắt ở cửa sổ khác): hàng mờ, **không bấm được**, click/Enter **tuyệt đối không** cuộn tới tin nhắn khác, có nút "Gỡ đánh dấu", **không tự xoá**.
    5. Đếm 30 bookmark ⇒ nút disabled; payload 31 phần tử ⇒ RPC reject.
    6. Thanh rỗng ⇒ đo `clientHeight` của `.msgs` trước/sau khi thêm rồi gỡ hết bookmark ⇒ **không lệch một pixel**.
  - **Depends on:** A1.4
  - **Owner:** qa-tester
  - **Acceptance:** **AC-B1 … AC-B14**, **AC-B17 … AC-B19**, **AC-P10** PASS, kèm số đo `clientHeight` cho AC-B7.

- [x] **QA-P. Verify nhóm P — persistence, popout round-trip, offline** — **M**
  - **Mô tả:** Chạy AC-P1…AC-P9. **Ca bắt buộc:**
    1. Prune bookmark ở **đúng 3 đường** cắt (`rewind`, `resend` — gồm "edit & resend" — `regenerate`) — verify `sessions.updateBookmarks` gọi **trước** khi cắt đĩa, và sau **reload app** số bookmark đúng. *(`/compact` **không** phải đường cắt; ca AC-P10 nằm ở QA-B ca 3.)*
    2. **Round-trip popout 2 chiều:** tạo bookmark trong popout → "Đưa về đây" → cửa sổ chính hiển thị **đúng** số bookmark, **không mất, không nhân đôi**; và chiều ngược lại.
    3. Nút "Đánh dấu" dùng được **ngay** trên tin nhắn user vừa gửi (chưa reload app).
    4. Đọc thẳng `~/.awog/sessions/{id}/session.jsonl` dòng header: `bookmarks` chỉ có `{ id, at }`.
    5. **Offline** (ngắt mạng): A1 + A2 hoạt động đầy đủ, **0 request mạng**.
    6. Kill app ngay sau khi bấm "Đánh dấu" ⇒ mở lại: header parse được, transcript mở bình thường.
  - **Depends on:** A1.4, T0c.4
  - **Owner:** qa-tester
  - **Acceptance:** **AC-P1 … AC-P9** PASS (AC-P5/P6 đối chiếu kết quả của T0c.4; **AC-P10** thuộc QA-B ca 3).

---

## Đóng gói

- [x] **Z1. Cập nhật tài liệu** — **S**
  - **Mô tả:** Gỡ dòng limitation *"Chưa search trong nội dung message (chỉ filter trên title)"* ở [sessions.md](./sessions.md) — nay đúng một nửa: **có** find trong phiên, **chưa** có cross-session (giữ lại phần cross-session như limitation còn hiệu lực). Đánh dấu spec `Status: Draft → Implemented` khi toàn bộ QA pass.
  - **File chạm:** `docs/features/sessions.md` · `docs/features/session-transcript-navigation.md` (chỉ dòng Status)
  - **Depends on:** QA-F, QA-B, QA-P
  - **Owner:** developer
  - **Acceptance:** không còn câu limitation sai; link chéo tới spec này đúng. *(`docs/decisions/README.md` đã được TL cập nhật cho 0074 + 0075 — không làm lại.)*

- [x] **Z2. Code review tổng** — **S**
  - **Mô tả:** Review theo checklist PR của T0a + ranh giới DATA/DOM của A2 + bất biến resolve của A1.
  - **Depends on:** Z1
  - **Owner:** code-reviewer
  - **Acceptance:** xác nhận (a) `useSessionScroll.ts` sạch `document.querySelector`; (b) `n/N` **không** đếm DOM; (c) đường resolve bookmark là `map.get(b.id)`, `undefined` ⇒ return sớm — **không** fallback index; (d) `fork` lọc `bookmarks` **tường minh**; (e) không dependency mới; (f) `usePreviewFind.ts` + `find-in-dom.ts` **không bị sửa một dòng**; (g) **không** còn dấu vết cầu nối bookmark → ngữ cảnh ghim (không `toPinned`, không icon `pin` trong `SessionBookmarkBar.vue`, không khoá `sessions.bookmark.toPinned*`).

---

## Thứ tự ship / chia PR

| PR | Gồm task | Phụ thuộc PR | Ghi chú |
|---|---|---|---|
| **PR-0** | **T0b** + QA-T0b | — | **PR RIÊNG, COMMIT RIÊNG, 0 dòng logic.** `refactor(ui): rename PreviewFindBar to common FindBar`. **Không trộn** bất kỳ hunk nào của A2/A1. Merge sớm nhất để mở đường cho PR-3. |
| **PR-1** | T0a.1 → T0a.2 → T0a.3 + QA-N | — | Ship độc lập được; đã tự nó sửa 2 bug sẵn có (AC-N6, AC-N9). Chạy song song PR-0 và PR-2. |
| **PR-2** | T0c.1 → T0c.2 → **T0c.4 (infosec, chặn merge)** → T0c.3 | — | Chạm sidecar. **Không merge khi infosec chưa PASS.** Merge PR này **mở khoá lát B2** của feature guard. |
| **PR-3** | A2.1 → A2.2 → A2.3 + QA-F | PR-0, PR-1 | Find-in-session. |
| **PR-4** | A1.1 → A1.2 → A1.3 → A1.4 + QA-B + QA-P | PR-1, PR-2 | Bookmark. Đụng `SessionMessageItem.vue` + `stores/sessions.ts` ⇒ **serialize với PR của B1**. |
| **PR-5** | Z1 + Z2 | PR-3, PR-4 | Docs + review đóng. |

**Feature guard (plan riêng):** **B1** chạy **song song** PR-0/PR-1/PR-2 (độc lập hoàn toàn). **B2** chỉ bắt đầu **sau khi PR-2 (T0c.3) merge** — **DEPENDENCY CỨNG `B2 → T0c`**.

### Rủi ro cùng-file (đọc trước khi chia người)

| File | Task đụng | Khuyến nghị |
|---|---|---|
| `components/session/SessionMessageItem.vue` | **A1.4** (nút bookmark) · T0a.3 (call site anchor) · **B1.1/B1.2** (gate + danger hover, feature guard) | **Một dev cầm file**, làm tuần tự `T0a.3 → B1.1/B1.2 → A1.4`. Song song = conflict gần như chắc chắn. |
| `stores/sessions.ts` | T0c.3 · **A1.1** · **B1.4** (Boy Scout comment) · **B2.1** (vá persist `rewind`) | Serialize theo thứ tự ship: `T0c.3 → B1.4 → A1.1 → B2.1`. Rebase sau mỗi merge. |
| `components/session/SessionDetail.vue` | T0a.3 · A2.3 · A1.3 | Cùng dev hoặc serialize `T0a.3 → A2.3 → A1.3`. |

---

## Ngoài phạm vi (không tạo task)

Giữ nguyên [spec §16](./session-transcript-navigation.md): search liên session + palette `⌘K`; tìm trong tool call/diff/terminal/thinking; regex / whole-word / tìm-không-dấu; virtual scroll thật; bookmark có ghi chú/nhãn/nhóm/kéo-thả; **đồng bộ bookmark ra mobile remote** (mở allowlist ⇒ **infosec re-audit bắt buộc**); xuất bookmark ra artifact/Wiki; persist trạng thái mở/thu của thanh; prefill selection vào ô tìm; đổi `SshWorkspace` sang `v-if`; **cầu nối bookmark → ngữ cảnh ghim** (đã **loại có chủ đích**, không phải "chưa làm" — spec §16).

## Missing from spec

**Không có.** Spec §17 + ADR 0074 §Q1/Q2/Q3 + ADR 0075 đã đóng toàn bộ open question; §14 chốt hết câu hỏi phụ của BA. Nếu dev gặp câu hỏi mới trong lúc implement ⇒ **dừng, quay lại BA/TL**, không tự quyết trong PR.
