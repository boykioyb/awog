# Feature Spec: Điều hướng transcript dài — Đánh dấu (A1) + Tìm trong phiên (A2)

> **Brief:** [session-transcript-navigation.brief.md](./session-transcript-navigation.brief.md) (PO, 2026-08-26)
> **ADR ràng buộc:** [ADR 0074 — Neo tin nhắn bền + hợp đồng điều hướng transcript](../decisions/0074-session-message-anchor-and-transcript-navigation.md) — **Accepted**, kèm [ADR 0075 — Phạm vi transcript theo surface](../decisions/0075-transcript-surface-scoping.md) (**amend phần T0a/§Q2 của 0074**). Mọi hợp đồng kỹ thuật trong spec này **suy ra từ 0074 + 0075**; spec không mở lại bất kỳ quyết định nào ở đó.
> **Status:** **Implemented** 2026-08-27 — nhánh `feature/session-navigation-and-guard` (T0a/T0b/T0c + A1 + A2). Cầu nối A1.5 loại có chủ đích (§16). Ràng buộc `/compact` **không** prune bookmark: [ADR 0076](../decisions/0076-compact-is-not-a-bookmark-prune-path.md), **AC-P10**.
> **Last updated:** 2026-08-27
> **Kế thừa AC:** [preview-modal-find.md](./preview-modal-find.md) (14 AC hành vi tìm kiếm — xem bảng ánh xạ §9)
> **Sửa đổi 2026-08-27 (BA, phản hồi từ dev khi implement A1):** (1) **`/compact` bị gỡ khỏi danh sách đường cắt** — nó không cắt transcript, prune ở đó sẽ xoá bookmark còn sống (§5.4, AC-P1, **AC-P10** mới); (2) bổ sung khoá `sessions.bookmark.saveFailed` vào §11.2; (3) chốt số `N` **chỉ hiện một lần** ở chip đếm, `barTitle` bỏ tham số `{n}` (§6.1, §11.2).
> **Sửa đổi 2026-08-27 (BA, quyết định sản phẩm — gỡ A1.5):** cầu nối **"Đưa vào ngữ cảnh ghim"** trong thanh bookmark **đã bị loại có chủ đích** và **code đã gỡ xong** (commit `79e00e5`). Kéo theo: §5.2 gỡ; **AC-B15 + AC-B16 bỏ, hai số này KHÔNG tái sử dụng**; 3 khoá i18n `sessions.bookmark.toPinned*` gỡ khỏi cả 2 locale; các cap chỉ phục vụ cầu nối (excerpt 500 ký tự, trần 8000 ký tự cho `pinnedContext.notes`) gỡ — excerpt **100 ký tự** của thanh giữ nguyên. Lý do + ranh giới chống scope-creep: **§16**. **Lập luận đặt tên ở §3 giữ nguyên và giờ càng quan trọng hơn** — không còn cầu nối nào để người dùng tự học ra khác biệt giữa "Đánh dấu" và "Ngữ cảnh ghim".

---

## 1. Tóm tắt

Feature cho phép người dùng **quay lại một tin nhắn quan trọng** và **tìm chữ trong phiên đang mở** của một session dài hàng trăm turn, thay vì chỉ có cuộn tay:

- **A1 — Đánh dấu (Bookmark):** đánh dấu một tin nhắn bất kỳ; thanh **"Đã đánh dấu (N)"** ở đầu transcript liệt kê chúng theo **thời gian tạo tin nhắn tăng dần**; click → nhảy tới đúng tin nhắn đó (kể cả khi nó chưa được mount); bỏ đánh dấu được. **Hết — bookmark làm đúng một việc: điều hướng transcript** (§16).
- **A2 — Tìm trong phiên:** `⌘/Ctrl+F` mở thanh tìm kiếm; tìm **literal substring** trên **toàn bộ** tin nhắn của session (không chỉ phần đang render); counter `n/N`, next/prev, wrap-around, match-case.

Cả hai kết thúc ở **một hành động chung**: *"nhảy tới tin nhắn thứ i"* — hành động này hiện **thất bại im lặng** khi tin nhắn nằm ngoài render-window. Nền tảng chung (§4) sửa đúng chỗ đó và là điều kiện tiên quyết cho cả A1 lẫn A2.

**Ranh giới sản phẩm (giữ nguyên từ Brief + VISION):** bookmark **không** đi vào prompt, **không** rời `.awog`, **không** tới remote gateway. Nó là công cụ đọc của **người**, không phải bộ nhớ của agent.

---

## 2. Persona chịu tác động

| Persona | Tác động |
|---|---|
| **Dev / tech-lead chạy session dài nhiều giờ** (persona chính của Brief) | Có 2 phương tiện điều hướng mới; giữ được session dài thay vì mở session mới để né cuộn. |
| **Người hỏi nhanh 3 câu rồi đóng** | **Vô hình.** Không có bookmark ⇒ thanh không tồn tại (0px). Thanh find chỉ hiện khi chủ động bấm `⌘F`. |
| **Người dùng đang phân vân "ghim" nghĩa là gì** | Được dẫn đường **chỉ bằng tên + icon**: "Đánh dấu" / `bookmark` ở đầu transcript khác hẳn "Ngữ cảnh ghim" / `pin` ở composer. Sau khi cầu nối "Đưa vào ngữ cảnh ghim" bị gỡ (§16), **không còn** chỗ nào trong UI dạy họ sự khác biệt ⇒ ranh giới từ vựng §3 là phương tiện dẫn đường **duy nhất** và phải giữ tuyệt đối. |
| **QA** | Thêm 2 bề mặt cần hồi quy: auto-scroll khi gửi tin, và tương tác `<mark>` find ↔ `<mark>` quote-highlight. |

---

## 3. Từ vựng — bắt buộc tuân thủ

| Khái niệm | Tên UI (vi) | Tên UI (en) | Tiền tố i18n / field | Ý nghĩa |
|---|---|---|---|---|
| **A1 (feature này)** | **Đánh dấu** | **Bookmark** | `sessions.bookmark.*`, `Session.bookmarks` | Neo đọc lại. **KHÔNG vào prompt.** |
| Ghim session lên đầu sidebar (đã có) | Ghim | Pin | `sessions.item.pin`, `Session.pinned` | Sắp xếp danh sách. |
| Ghim file/ghi chú vào ngữ cảnh LLM (đã có) | Ngữ cảnh ghim | Pinned context | `sessions.pinned.*`, `Session.pinnedContext` | **Nạp vào prompt mỗi turn ⇒ tốn token thật** ([spec](./session-pinned-context.md)). |

**Cấm** dùng chữ `pin*` / icon `pin` cho A1 ở bất kỳ đâu (khoá i18n, tên field, tên component, tooltip). Icon bắt buộc: `bookmark`.

> **Vì sao ranh giới này còn hiệu lực — và càng quan trọng hơn sau 2026-08-27:** chữ **"ghim"** mang **hai** nghĩa trong đúng một màn hình Session — ghim session lên đầu sidebar (miễn phí, chỉ là sắp xếp) và **ngữ cảnh ghim** (**nạp vào prompt mỗi turn ⇒ tốn tiền thật**). Bản đầu của spec còn có cầu nối "Đưa vào ngữ cảnh ghim" ngay trong thanh bookmark, tức người dùng có một chỗ để *tự học* ra rằng hai thứ này khác nhau. Cầu nối đó **đã bị gỡ** (§16) ⇒ **tên + icon giờ là phương tiện dẫn đường duy nhất**. Dùng lẫn `pin` cho A1 sẽ đẩy người dùng tới một trong hai kết luận sai, cả hai đều tốn kém: (a) tưởng đánh dấu cũng ngốn token nên không dám dùng; (b) tệ hơn — tưởng "ngữ cảnh ghim" cũng chỉ là cái đánh dấu vô hại rồi nhồi nội dung vào đó.

---

## 4. Nền tảng chung (T0) — hợp đồng đã chốt ở ADR 0074 + 0075

Phần này **không phải đề xuất của BA**; nó là diễn giải ADR 0074 (+ [ADR 0075](../decisions/0075-transcript-surface-scoping.md) amend T0a) ở mức hành vi để viết AC. Ba việc nền, làm **trước** A1 và A2:

### T0a — `scrollToMessage` async + registry (root-scoped) + `revealMessage`

- `useSessionScroll().scrollToMessage(i)` trở thành **async**, trả **`'ok' | 'not-found'`** (hết thất bại im lặng).
- Thứ tự cố định: `await entry.reveal(i)` → `await nextTick()` → **`entry.root()?.querySelector('[data-mi="i"]')`** → không có ⇒ `'not-found'` → có nhưng **`el.getClientRects().length === 0`** (nằm trong subtree `display:none`) ⇒ `'not-found'` → còn lại ⇒ `scrollIntoView({ block: 'center' })` + flash nền accent (giữ nguyên đoạn flash hiện có).
- **`useSessionScroll.ts` KHÔNG được chứa `document.querySelector` sau khi xong** — điều kiện review ([ADR 0075](../decisions/0075-transcript-surface-scoping.md)).
- **Chọn transcript bằng `provide`/`inject` theo *surface*, không bằng biến module.** Composable mới `useTranscriptSurface.ts` giữ **một** injection key + `provideTranscriptSurface()`; **`SessionDetail.vue` và `SshSessionPanel.vue`** mỗi cái gọi đúng **một lần** ở setup. Mọi caller (anchor badge, follow-up card ở composer, thanh bookmark, thanh find) tự phân giải về transcript **của surface chứa nó** — không caller nào phải biết mình ở surface nào.
- `SessionTranscript` **sở hữu** `windowStart` và đăng ký entry `{ root: () => msgsEl, reveal: revealMessage }` qua `registerTranscriptRevealer` ở **`onMounted`**; huỷ ở **`onUnmounted`** (chỉ clear khi con trỏ vẫn là chính nó). **Không** cần `onActivated`/`onDeactivated` — phạm vi là **cấu trúc**, không phải thời gian (ADR 0075).
- `revealMessage(i)`: ngoài `[0, messages.length)` ⇒ return; `target = turnStartFor(i)` (chỉ số user-message lớn nhất ≤ i, không có ⇒ 0); `target >= windowStart` ⇒ return (**chỉ nới, không co**); nới thì neo viewport bằng **đúng phép toán của `loadOlder`** (`prevH`/`prevTop` → đổi `windowStart` → `nextTick` → `scrollTop = prevTop + (scrollHeight - prevH)` → `updateEdges()`) **rồi mới** để `scrollToMessage` `scrollIntoView`.
- `SessionTranscript` nhận prop mới `suppressAutoScroll?: boolean`; watcher `scrollSig` đổi thành `if (grew && !props.suppressAutoScroll) stick.value = true`.

### T0b — Rename `PreviewFindBar.vue` → `common/FindBar.vue`

- **Rename thuần, commit riêng, 0 dòng logic mới** (`refactor(ui): rename PreviewFindBar to common FindBar`).
- i18n `common.preview.find.{matchCase,noResults,next,prev,close}` → `common.find.*`. Khoá `placeholder` **không** đi theo: `FindBar` nhận **prop `placeholder: string` bắt buộc**; preview giữ `common.preview.find.placeholder`, transcript dùng `sessions.find.placeholder` (mới).
- **`usePreviewFind` KHÔNG đụng tới, KHÔNG generalize.** Transcript dùng composable mới `useSessionFind`.

### T0c — Neo bằng id bền (chỉ A1 cần)

- `engineMessageToSessionMessage` gắn `eid: m.id` cho **cả `user` và `system`** (hiện chỉ gắn cho assistant). Type UI: `UserMessage`/`SystemMessage` thêm `eid?: string`.
- UI **mint id lượt user** và gửi kèm param **tuỳ chọn** `userMessageId` ở `sessions.sendMessage`; sidecar dùng nó thay `randomBytes(...)` khi persist. Không có param ⇒ hành vi cũ.
- `msgsToEngineMessages` dùng lại `eid` cho user/system thay vì mint `fm-<i>-<seq>`.
- RPC hẹp mới `sessions.updateBookmarks` (mô hình `sessions.updateTodos`); `Session.bookmarks?: SessionBookmark[]` vào header + `SessionMetadataPatch`. **KHÔNG** thêm vào `SessionSummary`.
- **Bảo mật (điều kiện merge):** `userMessageId` là input **L1** và `message.id` chảy vào path sink `sanitizeChild(\`${message.id}-${att.id}\`)` ([sessions/jsonl.ts:223](../../apps/desktop/sidecar/src/sessions/jsonl.ts)) → schema zod **phải** là `z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional()`. `sanitizeChild` chỉ chặn `/`, `\`, `..` nên **không** được coi là lớp bảo vệ duy nhất.

### Hai lớp của A2 (không được trộn)

| | Lớp **DATA** (nguồn sự thật) | Lớp **DOM** (trang trí) |
|---|---|---|
| Đầu vào | `s.msgs` — toàn session, kể cả phần chưa mount | `[data-mi="i"]` của **một** message |
| Đầu ra | `matches: { msgIndex, segIndex, occurrence }[]` | `<mark class="findmatch">` + `findmatch--current` |
| Quyết định | `n/N`, next/prev, wrap-around | không quyết định gì |
| Thất bại | **không được phép** | **được phép** → degrade |

**Quy tắc trục (ADR 0074):** *reveal + cuộn là **cam kết**; `<mark>` là **best-effort***. DOM lệch với data ⇒ vẫn reveal + cuộn tới message, chỉ bỏ phần highlight.

---

## 5. User flow

### 5.0. Flow nền — "Nhảy tới tin nhắn nằm NGOÀI render-window"

Dùng chung cho A1 (click bookmark), A2 (next/prev), và anchor follow-up sẵn có.

1. Caller gọi `await scrollToMessage(i)`.
2. `useSessionScroll` lấy entry transcript **của surface chứa caller** (inject) và gọi `await entry.reveal(i)`.
3. Transcript tính `target = turnStartFor(i)`:
   - `target >= windowStart` (đã mount) → **không làm gì**, sang bước 4.
   - ngược lại → chụp `prevH/prevTop`, set `windowStart = target`, `await nextTick()`, bù `scrollTop = prevTop + (scrollHeight - prevH)`, `updateEdges()`. **Màn hình không nhúc nhích một pixel** ở bước này.
4. `await nextTick()` → query `[data-mi="i"]` **trong `entry.root()`**, không phải trong `document`.
5. Có phần tử **và** phần tử đang hiển thị (`getClientRects().length > 0`) → `scrollIntoView({ block: 'center' })` + flash nền accent → trả `'ok'`.
6. Không có (hoặc đang ẩn) → trả **`'not-found'`**; caller tự xử lý (A1: toast + đánh dấu dangling; A2: bỏ qua match, đi tiếp).

> **Kỳ vọng đúng về hiệu năng:** window là **hậu tố** (`msgs.slice(windowStart)`), nên nhảy tới tin nhắn thứ 3 của session 200 tin nhắn *bắt buộc* mount 197 tin nhắn. Có thể khựng vài trăm ms trên session cực dài. Virtual scroll thật = **ngoài phạm vi** (Brief đã chốt).

### 5.1. A1 — Đánh dấu một tin nhắn (golden path)

1. Người dùng đọc transcript, thấy một câu trả lời quan trọng.
2. Hover/nhìn xuống **footer action row** của tin nhắn đó (hàng byline dưới bubble, chỗ đang có Copy/Quote/Rewind/Fork…) → có icon **`bookmark`**, tooltip **"Đánh dấu"**.
3. Click → icon chuyển sang trạng thái **đã đánh dấu** (accent, tooltip đổi thành "Bỏ đánh dấu"); thanh **"Đã đánh dấu (N)"** ở đầu transcript xuất hiện/cập nhật **ngay lập tức** (optimistic), rồi ghi xuống đĩa qua `sessions.updateBookmarks`.
4. Thanh ở trạng thái **rút gọn**: chỉ hiện **một** mục — mục **cuối theo thời gian tạo tin nhắn** (mục có `at` lớn nhất) — kèm chip đếm `N` và nút **mở rộng**.
5. Click nút mở rộng → hiện **toàn bộ** danh sách, sắp theo **thời gian tạo tin nhắn ASC** (cũ → mới). Click lần nữa (hoặc chọn một mục) → thu lại.
6. Click một mục → chạy **flow 5.0** → transcript mở rộng window nếu cần rồi cuộn tới tin nhắn, flash nền accent.
7. Muốn bỏ: click icon `bookmark` (đang bật) trên chính tin nhắn đó, **hoặc** nút `×` trên hàng bookmark trong thanh.

### 5.2. *(đã gỡ — flow "Đưa vào ngữ cảnh ghim")*

> Cầu nối bookmark → ngữ cảnh ghim **đã bị loại có chủ đích** (2026-08-27; code gỡ ở commit `79e00e5`). Lý do + ranh giới chống scope-creep: **§16**.
> Số mục **5.2 để trống, không tái sử dụng** — mọi tham chiếu §5.3 / §5.4 / §5.7 sẵn có (kể cả trong plan, commit message và spec anh em) vì thế vẫn trỏ đúng chỗ. Cùng cách repo xử lý số ADR đã dùng ([docs/decisions/README.md](../decisions/README.md)).

### 5.3. A1 — Bookmark dangling (không resolve được id)

1. Người dùng mở lại session; một bookmark trỏ tới tin nhắn không còn trong `s.msgs` (transcript đang reload, session vừa được cắt ở cửa sổ khác, v.v.).
2. Hàng bookmark render ở trạng thái **dangling**: mờ (opacity giảm), **không bấm được**, nhãn "Tin nhắn không còn tồn tại", và **nút "Gỡ đánh dấu" riêng**.
3. **Không tự xoá** (xoá nhầm là mất dữ liệu không hoàn tác). Người dùng tự gỡ khi muốn.

> Khác với **cắt có chủ đích** (§5.4) — ở đó bookmark được tự dọn vì tin nhắn đã mất vĩnh viễn trên đĩa.

### 5.4. A1 — Tự dọn khi transcript bị cắt có chủ đích

Áp dụng cho **đúng 3 hành động cắt thật**:

| Hành động | Ghi chú |
|---|---|
| `rewind` | Cắt `msgs[index..end]` trong bộ nhớ **và** trên đĩa. |
| `resend` | **Bao gồm luôn "edit & resend"** — đây không phải đường thứ tư mà chính là `resend` có thêm tham số `overrideText` ([stores/sessions.ts](../../apps/desktop/ui-next/stores/sessions.ts): `resend(id, index, overrideText?)`). |
| `regenerate` | Kể cả nhánh browser-dev `retryModel` (khi `useIpc === false`, hàm này tự `msgs.slice` nên cũng phải prune). |

Cộng thêm **`fork`** — không cắt gì của session gốc, nhưng bản clone phải **lọc bookmark tường minh** theo `msgs.slice(0, index + 1)` (§5.7, AC-P2).

1. Người dùng bấm một hành động cắt.
2. Store **tính tập id còn sống TRƯỚC khi cắt**: `new Set(idsOf(msgs.slice(0, index)))`.
3. `pruneBookmarksTo(s, survivingIds)` lọc `s.bookmarks` (một hàm duy nhất, dùng lại ở cả ba đường).
4. Nếu tập bookmark đổi → gọi `sessions.updateBookmarks`.
5. Chỉ **sau đó** mới `msgs.slice(...)` + cắt trên đĩa.
6. Thanh bookmark cập nhật; số `N` giảm; không có hàng dangling nào sinh ra từ đường này.

> **`/compact` KHÔNG phải đường cắt — và không được thêm lại vào danh sách này.**
> `/compact` chỉ cắt **ngữ cảnh gửi cho model**, **không** cắt transcript:
> - Sidecar: [`sessions.compact.ts`](../../apps/desktop/sidecar/src/methods/sessions.compact.ts) (comment đầu file, ADR 0047 amends ADR 0023) — *"The full transcript is left intact (the UI keeps showing it); only the model context is cut, in buildContext."* Method chỉ ghi checkpoint `session.compacted` `{ summary, firstKeptMessageId, tokensBefore }` qua `compactSession()` ([`sessions/store.ts`](../../apps/desktop/sidecar/src/sessions/store.ts)), và hàm đó lưu `{ ...rest, compaction }` — `session.messages` **không đổi một phần tử nào**. Chỗ cắt thật nằm ở [`runtime/context-builder.ts`](../../apps/desktop/sidecar/src/runtime/context-builder.ts) khi dựng history cho **lượt kế tiếp**.
> - UI: `runCompactRpc` trong [`stores/sessions.ts`](../../apps/desktop/ui-next/stores/sessions.ts) không đụng `s.msgs` — nó chỉ cập nhật `s.usage.contextChars.history` để đồng hồ ngữ cảnh tụt ngay.
>
> ⇒ Prune ở `/compact` sẽ **xoá bookmark còn sống**: tin nhắn vẫn nằm nguyên trong transcript, người dùng vẫn cuộn tới và đọc lại được — chỉ model là không còn thấy. Đó đúng là lúc bookmark **có giá trị nhất** (neo đọc lại phần vừa bị đẩy khỏi ngữ cảnh). Bản đầu của spec liệt kê nhầm `/compact` là đường cắt; sửa 2026-08-27 sau khi dev phát hiện lúc implement A1. **Hồi quy chống lỗi này: AC-P10.**

> **Thứ tự với Brief B:** [session-destructive-action-guard.brief.md](./session-destructive-action-guard.brief.md) chèn `await confirm()` **trước** cả bước 2. Prune chỉ chạy khi người dùng đã xác nhận.

### 5.5. A2 — Tìm trong phiên (golden path)

1. Người dùng đang ở `SessionDetail` (cửa sổ chính hoặc popout), nhấn **`⌘/Ctrl+F`**.
2. Thanh find (`common/FindBar.vue`) hiện **overlay góc trên-phải của vùng chat** (absolute, không đẩy layout), input được focus. Transcript bật `suppressAutoScroll`.
3. Nếu session **chưa `loaded`** → `await ensureLoaded(s.id)`; trong lúc chờ, counter hiện trạng thái nạp ("Đang nạp…"). **Cấm** hiện `0/0` khi chưa nạp.
4. Người dùng gõ từ khoá → debounce ~120ms → `runFind()` tính `matches` trên **`s.msgs`** (lớp DATA), đặt `currentIndex = 0`, cập nhật counter `1/N`. **KHÔNG reveal, KHÔNG cuộn.** Nếu message của match hiện tại **tình cờ đã mount** thì wrap `<mark>` luôn; chưa mount thì không đụng DOM.
5. Người dùng nhấn `Enter` / `›` → `clearMatches(root cũ)` → `await scrollToMessage(msgIndex)` → `'ok'` thì wrap mọi occurrence **trong message đó**, gắn class `findmatch--current` cho cái hiện tại, `scrollIntoView`.
6. `Shift+Enter` / `‹` → lùi một match. Wrap-around cả hai chiều.
7. Toggle `Aa` → tính lại `matches` live (không cuộn), counter cập nhật.
8. `Esc` → đóng thanh find, `clearMatches`, tắt `suppressAutoScroll`. **Session không đóng, workspace panel không đóng.**

### 5.6. A2 — Tìm chuỗi nằm ở turn đầu tiên của session 200 turn

1. Transcript đang mount 5 turn cuối.
2. `⌘F` → gõ chuỗi chỉ xuất hiện ở turn #1.
3. Counter hiện `1/1` **ngay lập tức** — vì lớp DATA đọc `s.msgs`, không đọc DOM. (Đây chính là con bug `⌘F` của Chromium mà feature này tồn tại để sửa.)
4. Nhấn `Enter` → flow 5.0 nới window về `turnStartFor(0)` = 0 → cuộn tới message → wrap `<mark>` → highlight current.

### 5.7. Flow phụ

- **Đổi session / đổi tab / session bị release sang popout:** đóng thanh find + `clearMatches` + reset query; thanh bookmark re-render theo session mới.
- **Round-trip popout:** bookmark tạo trong popout → "Đưa về đây" → `reclaimSession` đặt `loaded = false` → `ensureLoaded` → `sessions.get` → `bookmarks` nằm trong header nên hiện lại đầy đủ. **Không** cần event; event `session.metadata.updated` **không tồn tại** ở runtime.
- **Fork:** bookmark trong đoạn được clone (`msgs.slice(0, index + 1)`) đi theo bản fork; phần ngoài bị **lọc tường minh** (không dựa vào `...s` spread).
- **`/compact`:** **không đụng gì tới bookmark** — không prune, không gọi `sessions.updateBookmarks`, thanh giữ nguyên số `N` (§5.4, AC-P10).

---

## 6. UI behavior

### 6.1. Thanh "Đã đánh dấu"

- **Vị trí:** ngay **trên** `<SessionTranscript>` trong `SessionDetail`, cùng chỗ với `SessionTodoPanel` (banner cấp session). **KHÔNG** đặt bên trong `SessionTranscript` — để `SshSessionPanel` (cũng mount `SessionTranscript`) không kéo theo thanh này.
- **Rỗng ⇒ không tồn tại:** `v-if` trên số lượng bookmark. Không render div rỗng, **0px chiều cao**.
- **Chỉ hiện khi `session.loaded`** — excerpt derive từ `msgs`, chưa nạp thì chưa có nội dung để hiện.
- **Rút gọn (mặc định):** một hàng — icon `bookmark` + tiêu đề `Đã đánh dấu` + excerpt của **mục cuối theo `at`** + **chip đếm `N`** + nút mở rộng (`chev`).
- **Số `N` xuất hiện ĐÚNG MỘT LẦN, ở chip đếm.** Tiêu đề là chữ thuần — `sessions.bookmark.barTitle` **không** còn tham số `{n}` (§11.2), component **không** truyền `{ n: count }`. Lý do chọn chip thay vì để `N` trong tiêu đề: chip là badge số ⇒ theo UI pattern `.claude/rules/nuxt-vue.md` nó phải là `text-[12px]` fixed + `font-mono`, còn tiêu đề là text đọc được ⇒ `text-[1em]` scale theo Appearance. Nhét `N` vào tiêu đề sẽ khiến con số scale theo font-size setting và lệch khỏi mọi count chip khác trong app.
  > Ở các mục khác của spec, cách viết thanh **"Đã đánh dấu (N)"** là **cách gọi tắt** cho cặp *tiêu đề + chip*, không phải yêu cầu render đúng chuỗi đó.
- **Mở rộng:** danh sách dọc, sort `at` ASC; mỗi hàng: excerpt 1 dòng (≤100 ký tự, ellipsis) + thời gian tương đối + nút `×` ("Bỏ đánh dấu"). **Không có nút phụ nào khác** — mỗi hàng chỉ làm 2 việc: nhảy tới, hoặc gỡ (§16). Chip `N` vẫn ở hàng đầu (đếm tổng, không đổi theo trạng thái mở/thu).
- **Trạng thái mở/thu là ephemeral** — không persist (KISS, Brief đã chốt); reset khi đổi session.
- **Phân biệt thị giác với chip "Ngữ cảnh ghim":** thanh bookmark dùng nền `--bgEl` + viền `--border` + icon/accent màu `--accent`; chip pinned-context ở composer giữ nguyên. Hai thứ ở hai vị trí khác nhau (đầu transcript vs composer) và khác icon (`bookmark` vs `pin`). Vì **không còn cầu nối** giữa chúng (§16), khác biệt vị trí + icon + tên phải tự nói lên tất cả — xem lập luận ở §3.
- **Màu:** bắt buộc qua token theme (`--bgEl`, `--border`, `--text`, `--textDim`, `--accent`, `--accentBorder`, `--bgHover`, `--danger`). Không hardcode hex.
- **Font-size:** excerpt/tiêu đề `text-[1em]`; chip đếm `N` là badge → `text-[12px]` fixed + `font-mono leading-none`.

### 6.2. Nút "Đánh dấu" trên tin nhắn

- Nằm trong **footer action row** đã có (`msgActions` cho assistant; hàng action của user bubble cho user message).
- Icon-only, `p-1.5 rounded transition`, icon size `13`, `title` bắt buộc (theo `.claude/rules/nuxt-vue.md` §UI patterns).
- **Ẩn** khi: `streaming === true`, hoặc message **không có `eid`** (system message chèn cục bộ như `ENGINE_UNAVAILABLE` — không persist, không tồn tại sau reload).
- **Disabled** (hiện, mờ, tooltip "Tối đa 30 đánh dấu mỗi phiên") khi đã đủ `MAX_BOOKMARKS` và message hiện tại **chưa** được đánh dấu.
- Trạng thái bật: màu `--accent`, tooltip "Bỏ đánh dấu".

### 6.3. Thanh find

- **Component:** `common/FindBar.vue` (sau rename T0b), nhận `placeholder = t('sessions.find.placeholder')`.
- **Vị trí:** overlay absolute góc trên-phải của vùng `.chat` trong `SessionDetail` (không đẩy layout). Không đè lên nút fold-all của transcript (offset xuống/trái nếu cần).
- **Thành phần:** input → counter `n/N` (hoặc "Đang nạp…" / "Không có kết quả") → toggle `Aa` → `‹` → `›` → `×`. Giữ nguyên bố cục đã ship ở PreviewModal.
- **Trạng thái:**
  - *Đang nạp:* counter hiện `t('sessions.find.loading')`, `‹`/`›` disabled.
  - *Rỗng query:* counter ẩn, không highlight.
  - *Không match:* `0/0` (hoặc `t('common.find.noResults')`), input viền `--danger`, `‹`/`›` disabled.

### 6.4. Bàn phím

| Phím | Bối cảnh | Hành động |
|---|---|---|
| `⌘/Ctrl+F` | `SessionDetail` active, focus **không** trong Monaco (`.monaco-editor`) hay terminal (`.xterm`), **và** PreviewModal đang đóng | Mở/focus thanh find (`preventDefault` + `stopPropagation`) |
| `⌘/Ctrl+F` | Focus trong Monaco / xterm của Workspace Panel | **No-op** — nhường find native của Monaco / xterm |
| `⌘/Ctrl+F` | PreviewModal đang mở | **No-op** — `usePreviewModal.onKey` xử lý (đã ship) |
| `Enter` | thanh find focus | Next match (cuộn) |
| `Shift+Enter` | thanh find focus | Prev match (cuộn) |
| `Esc` | thanh find mở | Đóng thanh find. **Không** đóng session / workspace panel |

**Thứ tự ưu tiên `Esc` trong `SessionDetail`:** modal/popover đang mở (note modal của quote, popover dịch, context menu) > **thanh find** > hành vi Esc hiện có.

> Composer textarea **không** được coi là "vùng nhường": người dùng đang gõ trong composer mà bấm `⌘F` thì họ muốn tìm trong phiên (browser-find vô dụng ở đó).

### 6.5. Empty / loading / error

| Trạng thái | Hiển thị |
|---|---|
| Session chưa có bookmark | Thanh **không render** (0px) |
| Session có bookmark nhưng chưa `loaded` | Thanh **không render**; xuất hiện sau khi `ensureLoaded` xong |
| Bookmark dangling | Hàng mờ + nhãn "Tin nhắn không còn tồn tại" + nút "Gỡ đánh dấu" |
| `scrollToMessage` trả `'not-found'` (bookmark) | Toast `sessions.bookmark.notFound` + hàng đó chuyển hiển thị dangling **trong phiên hiện tại** (không ghi đĩa) |
| Find: session chưa `loaded` | Counter = "Đang nạp…" |
| Find: `'not-found'` ở mọi match trong một vòng | Dừng ở match ban đầu + toast `sessions.find.notFoundJump` |
| RPC `sessions.updateBookmarks` lỗi | Log `console.warn` + toast `sessions.bookmark.saveFailed`; **state UI giữ nguyên** (payload là **toàn bộ mảng** nên thao tác kế tiếp tự chữa) |

---

## 7. Data shape

### 7.1. Sidecar (`sidecar/src/types/shared.ts`)

```
SessionBookmark = { id: string; at: string }   // id message + thời điểm MESSAGE
Session.bookmarks?: SessionBookmark[]          // header session, KHÔNG vào SessionSummary
```

- **KHÔNG persist excerpt.** Header session đọc bằng **probe 8KB**; 30 bookmark × ~60 byte ≈ **1.8KB** nằm trong ngân sách, còn nhét excerpt 200 ký tự thì ≈ **7KB** và ăn hết probe một mình → mọi lần list session phải đọc vòng hai.
- Excerpt **derive lúc render** từ `s.msgs` (thanh chỉ hiện khi `loaded` nên nội dung luôn có sẵn).

### 7.2. RPC mới `sessions.updateBookmarks`

Mô hình y hệt [`sessions.update-todos.ts`](../../apps/desktop/sidecar/src/methods/sessions.update-todos.ts): schema **là biên validate**, unknown field bị strip, mảng rỗng hợp lệ (= xoá hết).

```
Params = {
  sessionId: string (min 1)
  bookmarks: Array<{ id: string /^[A-Za-z0-9_-]{1,64}$/ , at: string (max 40) }> (max 30)
}
→ updateSessionMetadata(sessionId, { bookmarks })
→ { ok: true }
```

`MAX_BOOKMARKS = 30` — cap **tại schema**, không chỉ ở UI.

**Remote gateway:** RPC mới **mặc định không với tới được** (allowlist exact-match + param-pick default-deny, [ADR 0067](../decisions/0067-mobile-remote-control-transport.md)). Giữ nguyên — Brief đã chốt "đồng bộ ra mobile remote" là *ngoài phạm vi*. Mở allowlist ⇒ **infosec re-audit bắt buộc**.

### 7.3. `sessions.sendMessage` — param mới

`userMessageId?: string` với `z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional()`. UI mint theo mẫu đã dùng cho assistant (`m-<base36>-<base36>`) → đề xuất `mu-<base36>-<base36>`. Không truyền ⇒ sidecar giữ `msg_u_<hex>` như cũ.

### 7.4. UI (`composables/useSessionsData.ts`)

- `UserMessage.eid?: string`, `SystemMessage.eid?: string` (mới).
- `Session.bookmarks?: SessionBookmark[]`.
- **Bookmark là mảng cấp session, KHÔNG phải field trên message** — `ensureLoaded` `markRaw` mọi message trừ cái cuối, field trên message sẽ **không reactive**. Dev không được "tối ưu" ngược lại.
- **Resolve `O(1)`:** một `computed` dựng `Map<eid, index>` từ `s.msgs`; mọi bookmark tra map. **Không** `findIndex` trong `v-for`.
- **Bất biến tuyệt đối:** đường resolve là `map.get(b.id)`; `undefined` ⇒ **return sớm**, không fallback sang index cũ, không "gần đúng".

### 7.5. Excerpt (derive, không lưu)

- Nguồn: `searchableSegments(m)` (§7.6) → đoạn text non-empty **đầu tiên**.
- Chuẩn hoá: `\s+ → ' '`, trim, cắt **100 ký tự** + `…`.
- Turn không có text (chỉ tool) → nhãn `sessions.bookmark.noText` = "(lượt không có phản hồi văn bản)".
- **100 ký tự là độ dài duy nhất của feature.** Bản đầu còn một excerpt 500 ký tự phục vụ cầu nối "Đưa vào ngữ cảnh ghim"; cầu nối đó đã bị gỡ (§16) nên hằng số đó — cùng trần 8000 ký tự cho `pinnedContext.notes` — **không còn tồn tại** trong spec lẫn code.

### 7.6. `utils/transcript-text.ts` (mới) — bề mặt tìm kiếm

```
searchableSegments(m: SessionMessage): { segIndex: number; text: string }[]
```

| Nội dung | Vào bề mặt tìm? |
|---|---|
| Text của `UserMessage` | ✅ |
| Text của `SystemMessage` | ✅ |
| Block `kind === 'text'` của `AssistantMessage` (final response) | ✅ |
| `thinking` / `step` / `detail` / diff / terminal output / `plan` / `question` / `perm` / `steer` / `error` | ❌ **Không** — quyết định cuối, không có giai đoạn sau |

Chuẩn hoá **giống hệt** `buildTextIndex`: gộp `\s+ → ' '`, cộng `.normalize('NFC')` cho **cả text lẫn query**. Tìm **literal substring** bằng `indexOf`, **không regex**.

### 7.7. File trên đĩa thay đổi

- `~/.awog/sessions/{id}/session.jsonl` — **dòng header** thêm khoá `bookmarks`. Định dạng JSONL **không đổi**, **không migration** (mọi message đã có `id` từ trước).
- Không thêm file mới, không thêm store, không thêm DB.

### 7.8. Event log

**Không thêm event nào.** Round-trip đi bằng re-read (`reclaimSession` → `loaded = false` → `sessions.get`), không bằng event.

---

## 8. Acceptance criteria

Ký hiệu nhóm: **N** = nền tảng (T0), **F** = find (A2), **B** = bookmark (A1), **P** = persistence & bảo mật.

### 8.1. Nhóm N — nền tảng điều hướng

- **AC-N1.** *Given* transcript đang mount 5 turn cuối của session 200 tin nhắn, *when* gọi `scrollToMessage(i)` với `i` thuộc turn đầu tiên, *then* hàm trả `'ok'` và tin nhắn `i` hiện trong viewport, căn giữa, có flash nền accent.
- **AC-N2.** *Given* target `i` nằm ngoài window, *when* reveal chạy, *then* `windowStart` mới bằng **`turnStartFor(i)`** (ranh giới turn chứa target), **không** bằng `0` (trừ khi `turnStartFor(i) === 0`).
- **AC-N3.** *Given* người dùng đang đọc ở giữa transcript, *when* reveal nới window (chèn nội dung lên trên), *then* **trước khi** `scrollIntoView` chạy, vị trí cuộn tương đối của nội dung đang đọc **không đổi** (đo: phần tử đang ở giữa viewport vẫn ở giữa viewport sau bước neo).
- **AC-N4.** *Given* một `msgIndex` không tồn tại phần tử `[data-mi]` sau reveal + `nextTick`, *when* gọi `scrollToMessage`, *then* hàm **trả `'not-found'`** (không throw, không cuộn, không flash).
- **AC-N5.** *Given* `windowStart = 10` và target nằm ở turn bắt đầu ở index 40, *when* reveal chạy, *then* `windowStart` **vẫn là 10** (window **chỉ nới, không co**) và tin nhắn đang đọc **không bị unmount**.
- **AC-N6.** *Given* `SessionDetail` được restore từ `<KeepAlive>` (`onActivated`), *when* click một anchor follow-up trỏ tới tin nhắn ngoài window, *then* nhảy đúng (entry vẫn đăng ký, phạm vi là cấu trúc chứ không phải thời gian) — anchor follow-up sẵn có **hết** thất bại im lặng.
- **AC-N7.** *Given* commit rename `FindBar` (T0b), *when* mở PreviewModal markdown-render và nhấn `⌘F`, *then* **14 AC của [preview-modal-find.md](./preview-modal-find.md) vẫn pass nguyên**, placeholder vẫn là "Tìm trong tài liệu…".
- **AC-N8.** *Given* commit rename `FindBar`, *when* review diff, *then* diff chỉ gồm: đổi tên file, đổi khoá i18n `common.preview.find.* → common.find.*` (trừ `placeholder`), thêm prop `placeholder`, sửa call site — **0 dòng logic mới**, và là **commit riêng** không trộn tính năng.
- **AC-N9.** *Given* mở co-pilot SSH ở **2 tab** (cả hai mount `SessionTranscript` của **cùng** session, 1 tab đang ẩn vì `v-show`), *when* ở `SessionDetail` click một bookmark/anchor trỏ tới tin nhắn ngoài render-window, *then* transcript **của `SessionDetail`** cuộn tới đúng tin nhắn + flash; **không** thao tác nào tác động lên transcript trong tab ẩn; và hàm **không** trả `'ok'` khi phần tử nằm trong subtree ẩn. *(chốt ở [ADR 0075](../decisions/0075-transcript-surface-scoping.md))*
- **AC-N10.** *Given* code T0a đã xong, *when* grep `useSessionScroll.ts`, *then* **không còn chuỗi `document.querySelector`** trong file (điều kiện review, [ADR 0075](../decisions/0075-transcript-surface-scoping.md)).

### 8.2. Nhóm F — Tìm trong phiên (A2)

- **AC-F1.** *Given* đang ở `SessionDetail`, focus ở vùng chat hoặc composer, *when* nhấn `⌘/Ctrl+F`, *then* thanh find mở, input focus, **browser-find KHÔNG bung**, chưa highlight cho tới khi gõ.
- **AC-F2.** *Given* session **chưa `loaded`** (`s.loaded === false`), *when* mở thanh find và gõ từ khoá, *then* counter hiển thị trạng thái **"Đang nạp…"** cho tới khi `ensureLoaded` xong; **tuyệt đối không** hiển thị `0/0` trong lúc chờ.
- **AC-F3.** *Given* session 200 turn chỉ mount 5 turn cuối, và chuỗi `"foo"` xuất hiện 7 lần trong đó **6 lần nằm ngoài phần đang render**, *when* gõ `"foo"`, *then* counter hiện **`1/7`** — tức `N` tính trên **toàn session** (`s.msgs`), không phải trên DOM đang mount.
- **AC-F4.** *Given* thanh find mở, *when* gõ từ khoá, *then* counter + current cập nhật nhưng **viewport GIỮ NGUYÊN** (không reveal, không cuộn). *(kế thừa AC-2 preview)*
- **AC-F5.** *Given* có ≥2 match và match kế nằm ngoài render-window, *when* nhấn `Enter` / `›`, *then* window nới tới turn chứa match, transcript cuộn tới tin nhắn đó, mọi occurrence **trong tin nhắn đó** được wrap `<mark class="findmatch">`, cái hiện tại thêm `findmatch--current`, counter tăng 1.
- **AC-F6.** *Given* current là match cuối, *when* Next, *then* current về match đầu (`1/N`); tương tự Prev ở match đầu → về match cuối. *(kế thừa AC-4)*
- **AC-F7.** *Given* từ khoá "Task", match-case off, *when* bật `Aa`, *then* danh sách match lọc lại live, counter cập nhật, current reset về match đầu hợp lệ, **không tự cuộn**. *(kế thừa AC-5)*
- **AC-F8.** *Given* thanh find mở trên session **đã `loaded`**, *when* gõ từ khoá không tồn tại, *then* counter `0/0` (hoặc "Không có kết quả"), input viền `--danger`, Next/Prev disabled, không highlight. *(kế thừa AC-6)*
- **AC-F9.** *Given* có từ khoá + highlight, *when* xoá hết input, *then* mọi `<mark class="findmatch">` bị gỡ, counter ẩn, không lỗi trong console. *(kế thừa AC-7)*
- **AC-F10.** *Given* thanh find mở, *when* `Esc`, *then* thanh đóng, highlight gỡ sạch, **session vẫn mở**, workspace panel không đổi, transcript giữ nguyên vị trí cuộn.
- **AC-F11.** *Given* transcript chứa "phân tích", *when* tìm "phân tích", *then* match (NFC); *when* tìm "phan tich", *then* **không** match. *(kế thừa AC-12)*
- **AC-F12.** *Given* lớp DATA báo có match ở message X nhưng lớp DOM không tìm thấy occurrence (drift chuẩn hoá / markdown render / `<mark>` quote chen vào), *when* nhấn Next tới match đó, *then* transcript **vẫn reveal + cuộn tới message X**, chỉ **bỏ phần `<mark>`**; counter **không** thay đổi giá trị `N`. *(reveal là cam kết, highlight là best-effort)*
- **AC-F13.** *Given* có match ở nhiều message khác nhau, *when* đang ở match thuộc message X, *then* **chỉ** message X có `<mark class="findmatch">`; các message khác **không** bị wrap (kể cả khi đã mount). *(sai khác CÓ Ý THỨC so với AC-2 của preview — "highlight mọi occurrence" là bất khả thi với render-window)*
- **AC-F14.** *Given* một lượt đang stream và thanh find **đang mở**, *when* reply nhận thêm delta, *then* transcript **không** tự kéo về đáy (người dùng giữ nguyên vị trí đang tìm).
- **AC-F15.** *Given* match nằm trong message có `role === 'assistant' && streaming === true`, *when* Next tới match đó, *then* transcript reveal + cuộn tới message nhưng **không wrap `<mark>`** (tránh Vue patch `v-html` nuốt/nhân bản mark).
- **AC-F16.** *Given* một chuỗi chỉ xuất hiện trong tool detail / diff / terminal output / thinking (activity đang collapse), *when* tìm chuỗi đó, *then* counter `0/0` — bề mặt tìm **không** bao gồm nội dung activity. *(quyết định cuối)*
- **AC-F17.** *Given* thanh find mở + có highlight, *when* đổi sang session khác (hoặc session bị release sang popout), *then* thanh đóng, `clearMatches` chạy **trước** khi Vue re-render, query reset, không sót `<mark>` rác trong DOM.
- **AC-F18.** *Given* focus đang ở trong Monaco (`.monaco-editor`) hoặc terminal (`.xterm`) của Workspace Panel, *when* nhấn `⌘/Ctrl+F`, *then* thanh find của session **không** mở; find widget của Monaco / xterm nhận phím như trước.
- **AC-F19.** *Given* PreviewModal đang mở phía trên session, *when* nhấn `⌘/Ctrl+F`, *then* chỉ handler của PreviewModal chạy (thanh find của session **không** mở).
- **AC-F20.** *Given* session 200 turn, *when* gõ nhanh 10 ký tự liên tiếp, *then* `runFind` chạy tối đa 1 lần sau khi ngừng gõ ~120ms (debounce), UI không đứng hình.
- **AC-F21.** *Given* thanh find mở với query có match, *when* một lượt mới nối thêm message (`msgs.length` tăng), *then* `clearMatches` chạy **trước** re-render và `matches` được tính lại; counter phản ánh nội dung mới; không có `<mark>` mồ côi.
- **AC-F22.** *Given* mọi match đều trả `'not-found'` khi reveal (trường hợp bệnh lý), *when* nhấn Next liên tiếp, *then* hệ thống duyệt **tối đa một vòng** rồi dừng ở match ban đầu + toast `sessions.find.notFoundJump` — **không** lặp vô hạn.

### 8.3. Nhóm B — Đánh dấu (A1)

- **AC-B1.** *Given* một tin nhắn assistant đã hoàn tất và **có `eid`**, *when* mở footer action row, *then* có nút icon `bookmark` với tooltip "Đánh dấu".
- **AC-B2.** *Given* một tin nhắn đang `streaming`, **hoặc** một tin nhắn **không có `eid`** (ví dụ system message cục bộ `ENGINE_UNAVAILABLE`), *when* nhìn footer, *then* nút "Đánh dấu" **không hiện**.
- **AC-B3.** *Given* tin nhắn chưa đánh dấu, *when* click nút, *then* nút chuyển trạng thái bật (accent, tooltip "Bỏ đánh dấu") và thanh "Đã đánh dấu (N)" cập nhật trong **cùng một frame** (optimistic, không chờ RPC). Click lần nữa → gỡ.
- **AC-B4.** *Given* đánh dấu tin nhắn #80 **trước**, rồi đánh dấu tin nhắn #12 **sau**, *when* mở rộng thanh, *then* thứ tự hiển thị là **#12 rồi #80** — sort theo **thời gian tạo tin nhắn ASC**, **không** theo thời điểm bấm đánh dấu.
- **AC-B5.** *Given* session có 4 bookmark, *when* transcript vừa mở, *then* thanh ở trạng thái **rút gọn**: hiển thị đúng **1 mục** — mục có **`at` lớn nhất** (mới nhất theo thời gian tạo tin nhắn) — kèm chip đếm `4`, và số `4` **chỉ xuất hiện một lần** trên thanh (tiêu đề là "Đã đánh dấu", không kèm số — §6.1).
- **AC-B6.** *Given* thanh đang rút gọn, *when* click nút mở rộng, *then* hiện đủ **4** hàng theo sort ASC; *when* click thu lại (hoặc chọn một mục), *then* về lại 1 hàng. Trạng thái này **không persist** — mở lại session thì thanh lại rút gọn.
- **AC-B7.** *Given* session **không có** bookmark nào, *when* xem transcript, *then* thanh **không tồn tại trong DOM** và chiều cao khả dụng của transcript **không giảm một pixel nào** (đo bằng `clientHeight` của `.msgs` trước/sau khi thêm rồi gỡ hết bookmark).
- **AC-B8.** *Given* một bookmark trỏ tới tin nhắn **nằm ngoài render-window**, *when* click hàng bookmark, *then* transcript nới window, cuộn tới đúng tin nhắn đó, flash nền accent. **Không im lặng không làm gì.**
- **AC-B9.** *Given* session có bookmark nhưng `s.loaded === false`, *when* transcript đang nạp, *then* thanh **chưa render**; sau khi `ensureLoaded` xong thanh xuất hiện với excerpt đầy đủ.
- **AC-B10.** *Given* session đã có **30** bookmark, *when* xem một tin nhắn chưa đánh dấu, *then* nút "Đánh dấu" ở trạng thái **disabled** với tooltip "Tối đa 30 đánh dấu mỗi phiên"; click không tạo thêm và **không** gửi RPC.
- **AC-B11.** *Given* một payload `sessions.updateBookmarks` chứa **31** phần tử (client lỗi / gọi trực tiếp), *when* RPC chạy, *then* schema **reject** (zod), không ghi đĩa, trả lỗi rõ ràng.
- **AC-B12.** *Given* đã đánh dấu 3 tin nhắn có nội dung dài, *when* mở file `~/.awog/sessions/{id}/session.jsonl` dòng header, *then* mảng `bookmarks` chỉ chứa **`{ id, at }`** cho mỗi mục — **không có excerpt / preview / text** nào; tổng kích thước phần `bookmarks` ≤ ~1.8KB ở mức 30 mục.
- **AC-B13.** *Given* một bookmark có `id` **không** resolve được trong `s.msgs` hiện tại, *when* thanh render, *then* hàng đó hiển thị **mờ, không bấm được**, có nhãn "Tin nhắn không còn tồn tại" + nút "Gỡ đánh dấu"; **app không crash**, console không có exception.
- **AC-B14.** *Given* một bookmark dangling, *when* người dùng thử click vào hàng (hoặc nhấn Enter khi focus vào nó), *then* **không có** thao tác cuộn nào xảy ra và **tuyệt đối không** cuộn tới một tin nhắn khác. *(ràng buộc không thương lượng của PO)*

> **AC-B15 và AC-B16 đã bỏ** (2026-08-27) cùng với hành động phụ "Đưa vào ngữ cảnh ghim" — code đã gỡ ở commit `79e00e5`, lý do ở **§16**.
> **Hai số này KHÔNG tái sử dụng.** Chúng đã được trích dẫn trong commit message và trong plan ([session-transcript-navigation.tasks.md](./session-transcript-navigation.tasks.md)); gán lại cho AC khác sẽ làm mọi tham chiếu sẵn có trỏ sai. Cùng cách repo xử lý số ADR đã dùng ([docs/decisions/README.md](../decisions/README.md)). AC kế tiếp trong nhóm B là **AC-B17**, và **QA không chạy** hai số đã bỏ.

- **AC-B17.** *Given* session có 5 bookmark, *when* gửi một lượt mới và kiểm tra prompt gửi đi (`sessions.sendMessage` payload + system prompt), *then* **không có** dữ liệu bookmark nào xuất hiện — bookmark **không vào prompt**.
- **AC-B18.** *Given* bookmark được lưu, *when* kiểm tra `SessionSummary` trả về từ `sessions.list`, *then* **không có** trường `bookmarks` (danh sách session không cần biết).
- **AC-B19.** *Given* RPC `sessions.updateBookmarks` lỗi (sidecar chết / reject), *when* người dùng vừa bấm "Đánh dấu", *then* toast hiện nội dung của khoá **`sessions.bookmark.saveFailed`** ("Không lưu được đánh dấu"), `console.warn` có log, và **state UI không rollback** — lần thao tác kế tiếp gửi lại toàn bộ mảng nên tự chữa.

### 8.4. Nhóm P — Persistence, cắt transcript, bảo mật

- **AC-P1.** *Given* session có bookmark ở tin nhắn #5 và #40, *when* người dùng `rewind` (hoặc `resend` — **kể cả "edit & resend"**, hoặc `regenerate`) tại index 20, *then* bookmark #5 **còn**, bookmark #40 **bị tự dọn**, và `sessions.updateBookmarks` được gọi **trước** khi transcript bị cắt trên đĩa. Sau reload: đúng 1 bookmark. *(danh sách đường cắt là **đúng 3** — `/compact` KHÔNG nằm trong đó, xem AC-P10)*
- **AC-P2.** *Given* session có bookmark ở tin nhắn #5 và #40, *when* `fork` tại index 20, *then* session fork chỉ mang bookmark #5; bookmark #40 **không** được kế thừa (lọc tường minh theo `msgs.slice(0, index + 1)`, không dựa vào `...s` spread). Session gốc giữ nguyên cả hai.
- **AC-P3.** *Given* người dùng pop out một session ra cửa sổ riêng và tạo 2 bookmark ở đó, *when* bấm "Đưa về đây" ở cửa sổ chính, *then* sau `reclaimSession` → `ensureLoaded` → `sessions.get`, cửa sổ chính hiển thị **đúng 2 bookmark đó** — không mất, **không nhân đôi**. Chiều ngược lại (tạo ở cửa sổ chính rồi pop out) cũng đúng.
- **AC-P4.** *Given* người dùng vừa gửi một tin nhắn trong **phiên hiện tại** (chưa reload app), *when* nhìn footer của chính tin nhắn user vừa gửi, *then* nút "Đánh dấu" **có sẵn và dùng được** — vì UI đã mint `userMessageId` và gửi kèm khi send.
- **AC-P5.** *Given* payload `sessions.sendMessage` mang `userMessageId = "../../etc/passwd"` (hoặc chứa `/`, `\`, khoảng trắng, hoặc dài > 64 ký tự), *when* RPC chạy, *then* schema zod **reject tại biên** với `regex(/^[A-Za-z0-9_-]{1,64}$/)`; **không** file nào được ghi ngoài `~/.awog/sessions/{id}/`. *(điều kiện merge — infosec review bắt buộc đúng điểm này)*
- **AC-P6.** *Given* `userMessageId` hợp lệ và lượt đó có đính kèm ảnh, *when* attachment được externalize, *then* tên file trong `attachments/` là `${userMessageId}-${att.id}` và nằm **trong** thư mục session (kiểm chứng path resolve).
- **AC-P7.** *Given* app đang chạy offline (không mạng), *when* dùng cả A1 và A2, *then* mọi chức năng hoạt động đầy đủ — find chạy client-side trên `s.msgs`, bookmark chỉ ghi filesystem local. Không có request mạng nào phát sinh.
- **AC-P8.** *Given* app bị kill ngay sau khi bấm "Đánh dấu" (RPC đã gửi), *when* mở lại app, *then* hoặc bookmark có mặt, hoặc không — **không** có trạng thái hỏng: header session vẫn parse được và transcript vẫn mở bình thường. *(ghi header là atomic tmp → rename)*
- **AC-P9.** *Given* `sessions.updateBookmarks` **không** nằm trong allowlist của remote gateway, *when* PWA remote gọi method này, *then* bị từ chối (default-deny), không ghi gì.
- **AC-P10.** *Given* session 60 tin nhắn có bookmark ở #5 và #40, *when* chạy `/compact` thành công (checkpoint `session.compacted` được ghi, đồng hồ ngữ cảnh tụt), *then* **`s.msgs` không đổi**, **`sessions.updateBookmarks` KHÔNG được gọi** (kiểm chứng bằng spy/log RPC), thanh vẫn hiện **đủ 2** bookmark, **cả hai vẫn nhảy đúng** — kể cả bookmark #5 nằm **trước** `firstKeptMessageId`; sau reload app, header vẫn có đúng 2 phần tử. *(hồi quy chống chính lỗi liệt kê `/compact` là đường cắt — §5.4)*

---

## 9. Ánh xạ 14 AC của `preview-modal-find.md`

| AC preview | Kế thừa? | AC tương ứng ở đây | Ghi chú |
|---|---|---|---|
| AC-1 mở thanh search | ✅ nguyên | AC-F1 | |
| AC-2 highlight tất cả + **không tự cuộn** | ⚠️ **tách đôi** | AC-F4 (không tự cuộn — **nguyên**) + AC-F13 (highlight **chỉ message chứa match hiện tại** — **sai khác có ý thức**) | "Mọi occurrence" bất khả thi với render-window ([ADR 0074 §Hệ quả](../decisions/0074-session-message-anchor-and-transcript-navigation.md)) |
| AC-3 next/prev cuộn | ✅ nguyên (+ reveal) | AC-F5 | Thêm bước reveal window trước khi cuộn |
| AC-4 wrap-around | ✅ nguyên | AC-F6 | |
| AC-5 match-case live | ✅ nguyên | AC-F7 | |
| AC-6 không có kết quả | ✅ nguyên | AC-F8 | Bổ sung điều kiện "đã `loaded`" (AC-F2) |
| AC-7 từ khoá rỗng | ✅ nguyên | AC-F9 | |
| AC-8 `Esc` đóng thanh, không đóng modal | ✅ nguyên (đổi ngữ cảnh) | AC-F10 | "không đóng modal" → "không đóng session/panel" |
| AC-9 Monaco find | ✅ tinh thần | AC-F18 | Ở transcript: **nhường** Monaco/xterm |
| AC-10 PDF find | n/a | — | Không có bề mặt PDF trong transcript |
| AC-11 đổi item reset search | ✅ nguyên (đổi ngữ cảnh) | AC-F17 | "đổi item" → "đổi session" |
| AC-12 NFC tiếng Việt | ✅ nguyên | AC-F11 | |
| AC-13 bề mặt không hỗ trợ = no-op | ✅ tinh thần | AC-F16, AC-F19 | Activity collapse = "không hỗ trợ" |
| AC-14 prefill selection | ❌ **KHÔNG kế thừa** (BA chốt) | — | Selection trong transcript **đã mang nghĩa khác** ("Quote & follow up" — nút nổi hiện ngay khi bôi đen). Prefill sẽ tạo hai hành vi tranh nhau trên cùng cử chỉ. KISS: v1 không prefill. |

---

## 10. Edge case

### 10.1. Điều hướng / render-window

- **Target là tin nhắn đầu tiên của session dài** → `turnStartFor(i) = 0` → suy biến về đúng `jumpTop`, mount toàn bộ. Chấp nhận (§5.0).
- **Target đã mount** → reveal **không làm gì** (early return), không có nhấp nháy.
- **Transcript SHRANK giữa lúc reveal** (fork/regenerate cắt trong lúc chờ `nextTick`) → watcher `scrollSig` re-window về `startForLastTurns(INITIAL_TURNS)`; `scrollToMessage` khi đó trả `'not-found'` → caller degrade theo hợp đồng.
- **Nhiều transcript cùng mount** — `SessionDetail` mount một cái, và `SshWorkspace` giữ **mọi** terminal tab bằng `v-show` ([SshWorkspace.vue:102-104](../../apps/desktop/ui-next/components/ssh/SshWorkspace.vue)) nên **nhiều `SshSessionPanel`** (mỗi tab có dock `session`) có thể cùng nằm trong document sống, tất cả bind `store.active` ⇒ **trùng dải `data-mi`**. Giải bằng **provide/inject theo surface + query trong `entry.root()`** (§4 T0a): mỗi caller phân giải về transcript của surface chứa nó; phần tử nằm trong subtree `display:none` trả `'not-found'` thay vì `scrollIntoView` no-op. Xem [ADR 0075](../decisions/0075-transcript-surface-scoping.md) và **AC-N9 / AC-N10**.
- **Surface mới quên `provideTranscriptSurface()`** → mọi lần nhảy trả `'not-found'` (có toast) thay vì im lặng. Fail loud — chấp nhận được; AC-N9 canh đúng chỗ này.
- **`scrollToMessage` gọi từ template** (`@click="scrollToMessage(i)"`) → giờ trả Promise; call site cũ không cần sửa, chỉ thêm `void` nếu lint kêu floating promise.

### 10.2. Streaming & `v-html`

- **Wrap `<mark>` trong message đang stream** → **cấm** (AC-F15). Vue patch từng frame sẽ nuốt hoặc nhân bản mark.
- **`<mark>` find sống chung với `<mark>` quote-highlight** → hai class khác nhau (`findmatch` vs class của quote) nên `clearMatches` không ăn nhầm; **nhưng** `root.normalize()` của bên này **có thể** gộp text node của bên kia. Bắt buộc: `clearMatches` **trước** khi quote-highlight áp lại, và ngược lại. **QA phải có ca riêng**: "message vừa được quote vừa đang là match hiện tại".
- **`msgs.length` đổi khi thanh find mở** → `clearMatches` **trước** khi Vue re-render (AC-F21).
- **Đánh dấu ngay khi lượt vừa xong** → nút chỉ hiện sau khi `streaming = false`; không có cửa sổ đua.

### 10.3. Dữ liệu / dangling

- **Session chưa `loaded`** → find: `ensureLoaded` trước, hiện trạng thái nạp, **cấm `0/0`** (AC-F2). Bookmark: thanh chưa render (AC-B9).
- **Bookmark trỏ tới message của bản fork/branch khác** → id không có trong `msgs` → dangling, không tự xoá.
- **Bookmark nằm TRƯỚC `firstKeptMessageId` sau `/compact`** → **vẫn hợp lệ, vẫn nhảy được**. `/compact` chỉ cắt ngữ cảnh gửi model, transcript trên đĩa và trong `s.msgs` còn nguyên (§5.4) ⇒ `map.get(b.id)` vẫn resolve. Đây là **trường hợp bookmark hữu ích nhất**, không phải trường hợp lỗi.
- **Bookmark tạo ở popout trong khi cửa sổ chính cắt cùng session** → `updateSessionMetadata` ghi cả header ⇒ last-write-wins ở mức field; hậu quả tối đa là **mất một bookmark**. Chấp nhận (hand-off đảm bảo mỗi lúc chỉ một renderer *điều khiển* session). Không thêm khoá.
- **Session bị xoá khi popout của nó vẫn mở** → hành vi hiện có không đổi; bookmark không thêm rủi ro mới.
- **File `session.jsonl` bị sửa tay ngoài app**, `bookmarks` chứa phần tử sai shape → header parse phải **bỏ qua phần tử không hợp lệ**, không throw (L2 → re-validate khi load).
- **`at` của bookmark khác `at` của message** (message được sửa/thay) → sort dùng `b.at`; sai lệch tối đa là thứ tự hiển thị, không bao giờ dẫn tới nhảy sai (resolve luôn theo `id`).

### 10.4. Bàn phím & tương tác panel

- **`⌘F` khi focus ở Monaco / xterm** → nhường (AC-F18).
- **`⌘F` khi PreviewModal mở** → nhường (AC-F19).
- **Người dùng rebind một global shortcut sang `⌘F`** ở Settings → Keyboard ([useKeymap](../../apps/desktop/ui-next/composables/useKeymap.ts) cho phép `mod+KeyF`) → handler global (window listener, app-lifetime) **thắng**; thanh find không mở. **Limitation đã biết**, ghi vào docs; không thêm cơ chế tránh né trong phạm vi này.
- **`Esc` khi cả note-modal của quote và thanh find đều mở** → note-modal đóng trước (§6.4).
- **Popout window** → không có shortcut app-wide, nhưng `⌘F` là handler cục bộ của `SessionDetail` nên **vẫn chạy** trong popout.

### 10.5. AWOG-specific (checklist bắt buộc)

| Hạng mục | Đánh giá |
|---|---|
| **Local-first / offline** | ✔ Find thuần client-side trên `s.msgs`; bookmark ghi filesystem local. Không network. (AC-P7) |
| **Restart-safe** | ✔ Bookmark nằm trong header JSONL, ghi atomic tmp→rename. Thanh find là ephemeral UI state, không cần persist. (AC-P8) |
| **Approval gate** | ✔ Không chạm. Không có tool call, không có permission request. |
| **Trace / event log** | ✔ **Không thêm event nào.** Round-trip đi bằng re-read, không bằng event. |
| **Git workspace** | ✔ Không chạm. Không auto-commit gì. |
| **Tray / notification** | ✔ Không chạm. Không phát notification. |
| **Multi-task concurrent** | ✔ Không dính task. Hai session chạy song song không tranh chấp — bookmark là per-session, ghi qua RPC hẹp per-session. |
| **Multi-window** | ⚠️ Popout + cửa sổ chính cùng ghi header session → last-write-wins ở mức field (§10.3). Rủi ro chấp nhận, đã ghi ở ADR 0074. |
| **Multi-surface (cùng renderer)** | ✔ `SessionDetail` + N `SshSessionPanel` cùng mount `SessionTranscript` → phân giải bằng provide/inject theo surface ([ADR 0075](../decisions/0075-transcript-surface-scoping.md), §10.1, AC-N9). |
| **Ngân sách header 8KB** | ⚠️ `todos` (ADR 0069) đã có thể vượt probe từ trước; bookmark thêm ≤1.8KB. Field thứ ba muốn vào header **phải đo lại tổng**. |
| **Chi phí token** | ✔ **Không có đường nào từ A1/A2 chảy vào prompt.** Cầu nối "Đưa vào ngữ cảnh ghim" — điểm duy nhất từng làm được việc đó — **đã bị gỡ** (§16). Muốn nạp nội dung vào prompt: dùng trực tiếp Ngữ cảnh ghim ở composer, nơi đã có đồng hồ chi phí. |
| **Security** | Chỉ **một** điểm mở bề mặt: `userMessageId` (L1 → path sink). Đã có AC-P5/P6 + infosec review bắt buộc. Không network, không exec, không path từ UI, không `v-html` mới (wrap bằng DOM Range như đã ship ở preview). |

---

## 11. i18n keys cần thêm

### 11.1. `common.json` — rename (T0b, commit riêng)

| Khoá cũ | Khoá mới | en | vi |
|---|---|---|---|
| `common.preview.find.matchCase` | `common.find.matchCase` | Match case | Phân biệt hoa thường |
| `common.preview.find.noResults` | `common.find.noResults` | No results | Không có kết quả |
| `common.preview.find.next` | `common.find.next` | Next result | Kết quả kế |
| `common.preview.find.prev` | `common.find.prev` | Previous result | Kết quả trước |
| `common.preview.find.close` | `common.find.close` | Close search | Đóng tìm kiếm |
| `common.preview.find.placeholder` | **giữ nguyên** | Find in document… | Tìm trong tài liệu… |

### 11.2. `sessions-transcript.json` — mới (en / vi)

| Khoá | en | vi |
|---|---|---|
| `sessions.bookmark.add` | Bookmark | Đánh dấu |
| `sessions.bookmark.remove` | Remove bookmark | Bỏ đánh dấu |
| `sessions.bookmark.barTitle` | Bookmarked | Đã đánh dấu |
| `sessions.bookmark.expand` | Show all bookmarks | Hiện tất cả đánh dấu |
| `sessions.bookmark.collapse` | Collapse | Thu gọn |
| `sessions.bookmark.jump` | Jump to message | Nhảy tới tin nhắn |
| `sessions.bookmark.dangling` | Message no longer exists | Tin nhắn không còn tồn tại |
| `sessions.bookmark.danglingRemove` | Remove this bookmark | Gỡ đánh dấu này |
| `sessions.bookmark.limit` | Up to 30 bookmarks per session | Tối đa 30 đánh dấu mỗi phiên |
| `sessions.bookmark.notFound` | Couldn't open that message | Không mở được tin nhắn đó |
| `sessions.bookmark.noText` | (turn has no text response) | (lượt không có phản hồi văn bản) |
| `sessions.bookmark.saveFailed` | Couldn't save bookmarks | Không lưu được đánh dấu |
| `sessions.find.placeholder` | Find in session… | Tìm trong phiên… |
| `sessions.find.open` | Find in session | Tìm trong phiên |
| `sessions.find.loading` | Loading transcript… | Đang nạp transcript… |
| `sessions.find.notFoundJump` | Couldn't open that result | Không mở được kết quả đó |

> **Đổi so với bản 2026-08-26 (dev cần sửa 2 file locale + 1 call site):** `sessions.bookmark.barTitle` **bỏ tham số `{n}`** — `Bookmarked ({n})` → **`Bookmarked`**, `Đã đánh dấu ({n})` → **`Đã đánh dấu`**; `SessionBookmarkBar.vue` bỏ luôn `{ n: count }` khi gọi `t()`. Số `N` chỉ còn ở chip đếm (§6.1).
> **Bổ sung:** `sessions.bookmark.saveFailed` — toast khi `sessions.updateBookmarks` lỗi (§6.5, AC-B19). Khoá này thiếu ở bản đầu dù §6.5 đã yêu cầu toast.
> **Gỡ 2026-08-27:** ba khoá `sessions.bookmark.toPinned`, `sessions.bookmark.toPinnedDone`, `sessions.bookmark.toPinnedFull` **đã xoá khỏi cả 2 locale** cùng với hành động phụ "Đưa vào ngữ cảnh ghim" (§16). **Không thêm lại.**

> Không được dùng literal string trong component — mọi nhãn đi qua `t()`.

---

## 12. File chạm

### 12.1. T0a — nền tảng scroll (không chạm sidecar)

- [`apps/desktop/ui-next/composables/useSessionScroll.ts`](../../apps/desktop/ui-next/composables/useSessionScroll.ts) — `scrollToMessage` async + `'ok' | 'not-found'` + `registerTranscriptRevealer(entry)` + query trong `entry.root()`. **Gỡ hết `document.querySelector`.**
- **`apps/desktop/ui-next/composables/useTranscriptSurface.ts` (mới)** — 1 injection key + `provideTranscriptSurface()` (`shallowRef<TranscriptEntry | null>`).
- [`apps/desktop/ui-next/components/session/SessionTranscript.vue`](../../apps/desktop/ui-next/components/session/SessionTranscript.vue) — `revealMessage`, đăng ký entry `{ root: () => msgsEl, reveal }` ở `onMounted` / huỷ ở `onUnmounted`, prop `suppressAutoScroll`, sửa 1 dòng watcher `scrollSig`.
- [`apps/desktop/ui-next/components/session/SessionDetail.vue`](../../apps/desktop/ui-next/components/session/SessionDetail.vue) — `provideTranscriptSurface()`.
- [`apps/desktop/ui-next/components/ssh/SshSessionPanel.vue`](../../apps/desktop/ui-next/components/ssh/SshSessionPanel.vue) — `provideTranscriptSurface()` (**bắt buộc**, nếu không anchor follow-up trong SSH co-pilot sẽ luôn trả `'not-found'`).
- [`apps/desktop/ui-next/components/session/SessionMessageItem.vue`](../../apps/desktop/ui-next/components/session/SessionMessageItem.vue) — call site anchor follow-up (`void` nếu lint kêu).
- [`apps/desktop/ui-next/components/session/SessionComposer.vue`](../../apps/desktop/ui-next/components/session/SessionComposer.vue) — call site follow-up card (`void`).

### 12.2. T0b — rename FindBar (commit riêng, 0 logic)

- `apps/desktop/ui-next/components/common/PreviewFindBar.vue` → **`apps/desktop/ui-next/components/common/FindBar.vue`** (+ prop `placeholder`).
- [`apps/desktop/ui-next/components/common/PreviewModal.vue`](../../apps/desktop/ui-next/components/common/PreviewModal.vue) — call site + truyền `placeholder`.
- [`apps/desktop/ui-next/i18n/locales/en/common.json`](../../apps/desktop/ui-next/i18n/locales/en/common.json), [`vi/common.json`](../../apps/desktop/ui-next/i18n/locales/vi/common.json) — đổi khoá.

### 12.3. T0c — id bền + RPC bookmark (sidecar)

- [`apps/desktop/sidecar/src/types/shared.ts`](../../apps/desktop/sidecar/src/types/shared.ts) — `SessionBookmark`, `Session.bookmarks`.
- [`apps/desktop/sidecar/src/sessions/session-manager.ts`](../../apps/desktop/sidecar/src/sessions/session-manager.ts) — thêm `bookmarks` vào `SessionMetadataPatch`.
- [`apps/desktop/sidecar/src/sessions/store.ts`](../../apps/desktop/sidecar/src/sessions/store.ts) — patch union (nếu bản sao thứ hai còn tồn tại). **`compactSession()` KHÔNG đụng `bookmarks`** — nó chỉ lưu `{ ...rest, compaction }` (§5.4).
- **`apps/desktop/sidecar/src/methods/sessions.update-bookmarks.ts` (mới)** — schema + cap 30 + regex id.
- [`apps/desktop/sidecar/src/index.ts`](../../apps/desktop/sidecar/src/index.ts) — `import './methods/sessions.update-bookmarks.js'`.
- [`apps/desktop/sidecar/src/methods/sessions.send-message.ts`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) — `userMessageId` (regex) + dùng thay `randomBytes` ở chỗ persist message user (~dòng 1149).
- [`apps/desktop/sidecar/src/sessions/jsonl.ts`](../../apps/desktop/sidecar/src/sessions/jsonl.ts) — **KHÔNG sửa** (chỉ là nơi cần bảo vệ; header đã serialize cả object session).

### 12.4. A1 — Bookmark (UI)

- [`apps/desktop/ui-next/composables/useSessionsData.ts`](../../apps/desktop/ui-next/composables/useSessionsData.ts) — `UserMessage.eid`, `SystemMessage.eid`, `SessionBookmark`, `Session.bookmarks`.
- [`apps/desktop/ui-next/stores/sessions.ts`](../../apps/desktop/ui-next/stores/sessions.ts) —
  - `engineMessageToSessionMessage`: gắn `eid` cho user/system (~dòng 1050);
  - `ensureLoaded`: hydrate `full.bookmarks` (~dòng 1000);
  - `msgsToEngineMessages`: dùng `eid` cho user/system (~dòng 2807);
  - `sendMessage`: mint + gửi `userMessageId` (~dòng 2958/3046);
  - actions mới `toggleBookmark(id, msgIndex)` / `removeBookmark(id, bookmarkId)` / `pruneBookmarksTo(s, survivingIds)` (dùng chung cho **ba** đường cắt);
  - `rewind` / `resend` (gồm cả "edit & resend" — cùng hàm, có `overrideText`) / `regenerate` (+ `retryModel` ở nhánh browser-dev): gọi prune **trước** khi cắt;
  - **`compactSession` / `runCompactRpc`: KHÔNG gọi prune, KHÔNG đụng `bookmarks`** — `/compact` không cắt transcript (§5.4, AC-P10);
  - `fork` (~dòng 3695): **lọc `bookmarks` tường minh** theo `msgs.slice(0, index + 1)`.
  - **KHÔNG chạm `pinnedContext`** — sau khi gỡ cầu nối (§16), A1 không có đường nào ghi vào `setPinnedNotes`.
- **`apps/desktop/ui-next/composables/useSessionBookmarks.ts` (mới)** — `Map<eid, index>`, rows đã sort + excerpt (**một** hằng số 100 ký tự), trạng thái dangling, expand/collapse.
- **`apps/desktop/ui-next/components/session/SessionBookmarkBar.vue` (mới)** — thanh "Đã đánh dấu" (tiêu đề không kèm số + chip đếm `N`, §6.1). Mỗi hàng chỉ có **nhảy tới** + nút `×`; **không** nút `pin`, **không** icon `pin` ở bất kỳ đâu trong file.
- [`apps/desktop/ui-next/components/session/SessionDetail.vue`](../../apps/desktop/ui-next/components/session/SessionDetail.vue) — mount `SessionBookmarkBar` ngay trên `SessionTranscript` (cạnh `SessionTodoPanel`).
- `SessionMessageItem.vue` — nút "Đánh dấu" trong `msgActions` (assistant) + hàng action của user bubble.

### 12.5. A2 — Find (UI)

- **`apps/desktop/ui-next/utils/transcript-text.ts` (mới)** — `searchableSegments`.
- **`apps/desktop/ui-next/composables/useSessionFind.ts` (mới)** — lớp DATA + điều phối DOM.
- [`apps/desktop/ui-next/utils/find-in-dom.ts`](../../apps/desktop/ui-next/utils/find-in-dom.ts) — **dùng lại nguyên trạng, không sửa một dòng**.
- [`apps/desktop/ui-next/composables/usePreviewFind.ts`](../../apps/desktop/ui-next/composables/usePreviewFind.ts) — **KHÔNG đụng**.
- `SessionDetail.vue` — wiring `⌘F` (capture) + `Esc` + mount `FindBar` + truyền `suppressAutoScroll` xuống transcript.
- [`apps/desktop/ui-next/i18n/locales/en/sessions-transcript.json`](../../apps/desktop/ui-next/i18n/locales/en/sessions-transcript.json), [`vi/sessions-transcript.json`](../../apps/desktop/ui-next/i18n/locales/vi/sessions-transcript.json).

### 12.6. Tài liệu

- [`docs/features/sessions.md`](./sessions.md) — gỡ dòng limitation *"Chưa search trong nội dung message (chỉ filter trên title)"* (nay đúng một nửa: có find **trong phiên**, chưa có cross-session).
- [`docs/decisions/README.md`](../decisions/README.md) — thêm dòng 0074 + 0075 (việc của TL, đã xong).

---

## 13. Dependencies + thứ tự triển khai

### 13.1. Phụ thuộc

| Loại | Chi tiết |
|---|---|
| **Entity hiện có** | `Session` (thêm `bookmarks`), `SessionMessage` (đọc `id` đã có). **Không** chạm Task / Project / Workflow / Agent / Skill / Artifact. |
| **Feature phụ thuộc vào** | [preview-modal-find](./preview-modal-find.md) (util `find-in-dom`, component `FindBar`), [session-popout-window](./session-popout-window.md) (đường reclaim + re-read), [workspace-panel](./workspace-panel.md) (Monaco/terminal nhường `⌘F`), [ADR 0064](../decisions/0064-session-ssh-link.md) (SSH co-pilot — surface thứ hai mount `SessionTranscript`). |
| **Feature liên quan nhưng KHÔNG chạm** | `/compact` ([ADR 0047](../decisions/0047-auto-compact-context.md) — chỉ cắt ngữ cảnh model, transcript nguyên vẹn) ⇒ bookmark **không** prune ở đó (§5.4, AC-P10). **[session-pinned-context](./session-pinned-context.md)** — sau khi gỡ cầu nối (§16), feature này **không đọc, không ghi** `pinnedContext`; quan hệ còn lại **chỉ là ranh giới đặt tên** (§3). |
| **Feature bị ảnh hưởng** | [session-destructive-action-guard.brief.md](./session-destructive-action-guard.brief.md) (Brief B) — thứ tự: `confirm()` → prune bookmark → cắt. Hai spec **phải** khớp ở điểm này. |
| **ADR** | [0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) (ràng buộc chính) + **[0075](../decisions/0075-transcript-surface-scoping.md)** (amend T0a: surface scoping), [0048](../decisions/0048-session-index-lazy-load.md) + [0062](../decisions/0062-adopt-craft-session-storage-model.md) (lazy-load / header), [0069](../decisions/0069-editable-session-checklist.md) (tiền lệ RPC hẹp), [0067](../decisions/0067-mobile-remote-control-transport.md) (allowlist remote), [0032](../decisions/0032-session-message-parts-model.md) (parts). |
| **External** | Không có. Không API model, không Git CLI, không OS notification. |

### 13.2. Thứ tự (giữ đúng yêu cầu ADR 0074 — "Việc cần làm tiếp / PM")

```
T0a (scroll async + surface registry + revealMessage)  ─┐
T0b (rename FindBar — COMMIT RIÊNG)                    ─┼→  A2 (find-in-session)  →  A1 (bookmark)
T0c (eid + userMessageId + updateBookmarks)            ─┘        ↑                      ↑
                                                            cần T0a, T0b          cần T0a, T0c
```

| Bước | Nội dung | Phụ thuộc | Ghi chú |
|---|---|---|---|
| **T0a** | `scrollToMessage` async + `'not-found'` + surface registry (provide/inject, root-scoped) + `revealMessage` + `suppressAutoScroll` | — | Sửa luôn bug thất bại im lặng của anchor follow-up (AC-N6) **và** bug chọn nhầm transcript (AC-N9). Có thể ship độc lập. |
| **T0b** | Rename `PreviewFindBar` → `common/FindBar` + i18n | — | **Commit riêng**, 0 logic (AC-N8). Chạy song song T0a. |
| **T0c** | `eid` cho user/system + `userMessageId` + `sessions.updateBookmarks` | — | Sidecar + store. **infosec review bắt buộc** cho regex (AC-P5). |
| **A2** | `transcript-text.ts` + `useSessionFind` + wiring `⌘F`/`Esc` + mount `FindBar` | T0a, T0b | A2 trước vì ít câu hỏi mở hơn và tự nó giải phần lớn nỗi đau. |
| **A1** | `useSessionBookmarks` + `SessionBookmarkBar` + nút trên message + prune **3 đường cắt** + fork filter. **Không** có hành động phụ nào (§16). | T0a, T0c | |
| **QA** | AC-N*, AC-F*, AC-B* (trừ AC-B15/AC-B16 đã bỏ), AC-P* + hồi quy "gửi tin → tự cuộn xuống đáy" + ca `<mark>` chồng `<mark>` + **ca "/compact không dọn bookmark" (AC-P10)** | tất cả | |

**Hồi quy bắt buộc (không được bỏ):**
1. Gửi tin nhắn mới khi thanh find **đóng** → transcript vẫn tự cuộn xuống đáy (`suppressAutoScroll` không rò rỉ).
2. 14 AC của `preview-modal-find.md` sau commit rename (AC-N7).
3. Anchor follow-up + follow-up card ở composer vẫn nhảy đúng sau khi `scrollToMessage` đổi chữ ký — **cả trong `SessionDetail` lẫn trong SSH co-pilot** (AC-N9).
4. `/compact` chạy xong → bookmark **còn nguyên** và vẫn nhảy đúng (AC-P10).

---

## 14. Quyết định BA chốt trong spec này

Các *Câu hỏi phụ* mà Brief giao lại cho BA — chốt tại đây, không cần hỏi thêm:

| Câu hỏi | Quyết định | Lý do |
|---|---|---|
| Chặn đánh dấu khi message đang streaming? | **Có** — nút ẩn khi `streaming`, và ẩn khi không có `eid` | Đúng cách footer action đang làm; không có id ⇒ không có neo ⇒ không tạo được rác (ADR 0074 §Q1.4) |
| Thanh rỗng chiếm chỗ? | **0px, không render trong DOM** | Success criteria của PO |
| Persist trạng thái mở/thu của thanh? | **Không** | Brief đã chốt (KISS, ephemeral UI state) |
| Sort tie-break khi `at` trùng nhau | Theo **index đã resolve** ASC; bookmark dangling xếp **sau** | Deterministic, không phụ thuộc thứ tự bấm |
| Excerpt dài bao nhiêu | **100 ký tự** — một dòng ở thanh, và là **độ dài duy nhất** của feature | Thanh là 1 dòng. Sau khi gỡ cầu nối "Đưa vào ngữ cảnh ghim" (§16), không còn nội dung nào của bookmark chảy vào prompt ⇒ không cần hằng số thứ hai |
| Kế thừa AC-14 (prefill selection)? | **Không** ở v1 | Selection trong transcript đã mang nghĩa "Quote & follow up"; hai hành vi tranh nhau trên cùng cử chỉ |
| `⌘F` nhường ai | Nhường **Monaco** + **xterm** + **PreviewModal đang mở**; **không** nhường composer textarea | Chỗ nào đã có find native thì nhường; chỗ nào browser-find vô dụng thì AWOG thắng |
| Ghi bookmark: optimistic hay chờ RPC? | **Optimistic** + `pushRequest` (như `setTodos`), lỗi thì log + toast `sessions.bookmark.saveFailed`, **không rollback** | Payload là **toàn bộ mảng** nên thao tác kế tiếp tự chữa; UI phản hồi tức thì |
| **`/compact` có prune bookmark không?** *(sửa 2026-08-27)* | **KHÔNG.** Chỉ `rewind` / `resend` (gồm edit & resend) / `regenerate` prune; `fork` lọc tường minh | `/compact` **không cắt transcript** — sidecar ghi checkpoint và cắt ở `buildContext` cho lượt sau, `session.messages` không đổi. Prune ở đó = **xoá bookmark còn sống**, đúng ngược mục tiêu (§5.4, AC-P10) |
| **Số `N` hiện ở đâu?** *(sửa 2026-08-27)* | **Chỉ ở chip đếm.** `barTitle` bỏ tham số `{n}` | Badge số phải `text-[12px]` fixed + mono (`.claude/rules/nuxt-vue.md`), tiêu đề phải `text-[1em]`; để `N` ở cả hai chỗ là hiển thị trùng và làm con số scale theo Appearance |
| **Giữ cầu nối bookmark → ngữ cảnh ghim?** *(chốt 2026-08-27, code đã gỡ)* | **KHÔNG.** Gỡ hoàn toàn: nút, hàm, 2 hằng số (500 / 8000), 3 khoá i18n | Bookmark giữ đúng **một** việc — điều hướng transcript (SRP). Ngữ cảnh ghim ở composer đã là chỗ đầy đủ cho việc "cho AI nhớ", có UI và đồng hồ chi phí riêng. Chi tiết + ranh giới chống scope-creep: **§16** |

---

## 15. Non-functional

| Tiêu chí | Mục tiêu |
|---|---|
| Latency — bấm "Đánh dấu" → thanh cập nhật | < 1 frame (optimistic, không chờ RPC) |
| Latency — gõ từ khoá → counter đúng, session 200 turn | ≤ 150ms sau debounce (`indexOf` trên text đã normalize) |
| Latency — click bookmark tới message ngoài window | Chấp nhận tới ~500ms trên session 200 turn (mount phần đuôi); phải **có phản hồi thị giác** (flash) khi xong |
| Offline | **Có** — 100% client-side + filesystem local |
| Restart-safe | **Có** — bookmark trong header, ghi atomic |
| Storage | ≤ **1.8KB** / session ở mức 30 bookmark; **không** vượt ngân sách probe 8KB một mình |
| Bề mặt IPC mới | 1 RPC (`sessions.updateBookmarks`) + 1 param (`userMessageId`) + 1 field header (`bookmarks`) |
| Chi phí token phát sinh | **0** — không có đường nào từ A1/A2 vào prompt (§10.5) |
| Số dependency mới | **0** |

---

## 16. Out of scope

Giữ nguyên mục *Out of scope* của Brief, nhắc lại để chống scope creep:

- **Search liên session** + palette `⌘K` (backend `sessions.search` đã có, ui-next chưa port) → backlog riêng.
- Tìm trong tool call / diff / terminal output / thinking (bảng §7.6) — **quyết định cuối**.
- Regex, whole-word, tìm-không-dấu tiếng Việt.
- Thay render-window bằng **virtual scroll thật** — refactor hiệu năng độc lập.
- Bookmark có ghi chú / nhãn / nhóm / kéo-thả sắp xếp lại.
- **Đồng bộ bookmark ra mobile remote** — mở allowlist ⇒ infosec re-audit bắt buộc.
- Xuất bookmark ra artifact / Wiki.
- Persist trạng thái mở/thu của thanh bookmark.
- Prefill selection vào ô tìm kiếm (§14).
- **Dọn bookmark theo `/compact`** — không phải "chưa làm" mà là **sai về bản chất**: `/compact` không cắt transcript (§5.4). Muốn đổi ⇒ phải đổi [ADR 0047](../decisions/0047-auto-compact-context.md) trước.
- **Đổi `SshWorkspace` sang `v-if` cho terminal tab** — cố ý dùng `v-show` để không disconnect shell; feature này thích ứng bằng surface scoping chứ không sửa `SshWorkspace` ([ADR 0075](../decisions/0075-transcript-surface-scoping.md)).
- **Cầu nối "Đưa vào ngữ cảnh ghim" từ thanh bookmark** — **đã LOẠI CÓ CHỦ ĐÍCH 2026-08-27**, không phải "chưa làm". Code đã gỡ ở commit `79e00e5` (nút, hàm `toPinned()`, excerpt 500 ký tự, trần 8000 ký tự cho `pinnedContext.notes`, 3 khoá i18n `sessions.bookmark.toPinned*`); tài liệu gỡ theo: §5.2, **AC-B15 + AC-B16** (số **không tái sử dụng**), task **A1.5**.
  **Lý do:** bookmark giữ đúng **một** việc — **điều hướng transcript** (SRP: một hàng bookmark = một lý do tồn tại). Ai muốn AI ghi nhớ một đoạn thì dùng **trực tiếp Ngữ cảnh ghim ở composer** ([spec](./session-pinned-context.md)), nơi đã có UI riêng, chip đếm và ngữ cảnh chi phí rõ ràng. Nhét thêm một nút "tiện tay" vào hàng bookmark biến một thao tác *đọc* (miễn phí) thành một thao tác *bơm token vào mọi lượt sau đó* — đúng loại nhầm lẫn mà ranh giới đặt tên ở §3 tồn tại để ngăn.
  **⇒ Đừng "bổ sung lại cho đủ".** Muốn mở lại phải đi qua Brief mới của PO, không phải một PR "hoàn thiện A1".

---

## 17. Open questions

Ba câu hỏi kiến trúc của Brief **đã chốt** ở ADR 0074 và **không mở lại**. Các *câu hỏi phụ* đã chốt ở §14.

- **✅ Q1 (tech-lead) — CHỐT 2026-08-26: phạm vi selector `[data-mi]` khi có nhiều transcript cùng mount.**
  **Quyết định:** registry **có kèm root**, VÀ chọn transcript **theo cấu trúc cây (provide/inject)** — bỏ hẳn singleton cấp module; `document.querySelector` **bị gỡ khỏi** `useSessionScroll`. Quyết định này nằm ở **[ADR 0075 — Phạm vi transcript theo surface](../decisions/0075-transcript-surface-scoping.md)** (**amend phần T0a/§Q2 của ADR 0074**; ADR 0074 giữ nguyên bất biến theo convention `docs/decisions/README.md`).
  Ba phần bắt buộc:
  1. `registerTranscriptRevealer(entry)` với `entry = { root: () => HTMLElement | null; reveal: (i) => Promise<void> }`; query là `entry.root()?.querySelector(...)`, không có entry ⇒ `'not-found'` ngay.
  2. `useTranscriptSurface.ts` (mới) + `provideTranscriptSurface()` gọi ở **`SessionDetail.vue`** và **`SshSessionPanel.vue`**; `SessionTranscript` inject và tự ghi entry ở `onMounted`, clear ở `onUnmounted`. **Bỏ** `onActivated`/`onDeactivated` — phạm vi là cấu trúc, không phải thời gian ⇒ T0a **đơn giản hơn** bản gốc.
  3. Phần tử tìm được nhưng `getClientRects().length === 0` (trong subtree `display:none`) ⇒ **`'not-found'`**, không `scrollIntoView` no-op.
  **Lý do không chọn "giữ `document.querySelector` + 1 ca QA":** đây không phải rủi ro xác suất thấp mà là **sai theo cấu trúc** — `SshWorkspace.vue:102-104` giữ **mọi** terminal tab bằng `v-show`, nên mở co-pilot ở 2 tab là đủ để có nhiều transcript của **cùng** session trong document sống; `document.querySelector` lấy phần tử đầu theo document order, rất có thể nằm trong tab ẩn, nơi `scrollIntoView` là **no-op** ⇒ đúng triệu chứng "click không làm gì" mà feature này tồn tại để diệt.
  **Đã phản ánh vào spec:** §4 T0a, §5.0 (bước 2/4/5), §10.1, §10.5, §12.1, §13.1, §13.2, §16, và **AC-N9 + AC-N10** ở §8.1.

- **✅ Q2 (BA) — CHỐT 2026-08-27: `/compact` có phải đường cắt không?**
  **Không.** Bản 2026-08-26 liệt kê nhầm (§5.4 "5 đường" + AC-P1). Dev phát hiện khi implement A1; BA verify lại tại nguồn: [`sessions.compact.ts`](../../apps/desktop/sidecar/src/methods/sessions.compact.ts) (*"The full transcript is left intact… only the model context is cut, in buildContext"*), `compactSession()` lưu `{ ...rest, compaction }` không đụng `messages`, và `runCompactRpc` phía UI không `slice` `s.msgs`. Danh sách đường cắt còn **3** + lọc tường minh khi `fork`; thêm **AC-P10** làm hồi quy.

- **✅ Q3 (PO/BA) — CHỐT 2026-08-27: bookmark có cần cầu nối sang ngữ cảnh ghim?**
  **Không — gỡ hoàn toàn.** Quyết định sản phẩm của người dùng; code đã gỡ ở commit `79e00e5`. Bookmark = điều hướng transcript, hết. Lý do + ranh giới chống "bổ sung lại cho đủ": **§16**; hàng quyết định tương ứng ở **§14**.

**Không còn open question nào chặn việc triển khai.**

---

## 18. Liên kết

- **Brief:** [session-transcript-navigation.brief.md](./session-transcript-navigation.brief.md)
- **ADR chính:** [0074 — Neo tin nhắn bền + hợp đồng điều hướng transcript](../decisions/0074-session-message-anchor-and-transcript-navigation.md)
- **ADR amend T0a:** [0075 — Phạm vi transcript theo surface](../decisions/0075-transcript-surface-scoping.md)
- **Kế thừa AC:** [preview-modal-find.md](./preview-modal-find.md)
- **Ranh giới đặt tên (không còn phụ thuộc chức năng — §16):** [session-pinned-context.md](./session-pinned-context.md)
- **Bối cảnh:** [sessions.md](./sessions.md), [workspace-panel.md](./workspace-panel.md), [session-popout-window.md](./session-popout-window.md), [todo-list.md](./todo-list.md)
- **Spec anh em (phải khớp thứ tự prune):** [session-destructive-action-guard.brief.md](./session-destructive-action-guard.brief.md)
- **ADR nền:** [0047](../decisions/0047-auto-compact-context.md) (`/compact` — không cắt transcript), [0048](../decisions/0048-session-index-lazy-load.md), [0062](../decisions/0062-adopt-craft-session-storage-model.md), [0069](../decisions/0069-editable-session-checklist.md), [0067](../decisions/0067-mobile-remote-control-transport.md), [0064](../decisions/0064-session-ssh-link.md)
- **Kiến trúc:** [system-overview](../architecture/system-overview.md), [data-model](../architecture/data-model.md), [execution-model](../architecture/execution-model.md)
- **VISION:** [artifacts/VISION.md](../../artifacts/VISION.md) — *"agents collaborate through artifacts, not chat history"* (ranh giới: bookmark **không** vào prompt)
