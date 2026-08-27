# 0074 — Neo tin nhắn bền + hợp đồng điều hướng transcript (bookmark & find-in-session)

- **Trạng thái:** Accepted (T0a amended by [0075](0075-transcript-surface-scoping.md); danh sách đường cắt của §Q1 amended by [0076](0076-compact-is-not-a-bookmark-prune-path.md) — `/compact` **không** phải đường cắt)
- **Ngày:** 2026-08-26
- **Người quyết định:** Tech Lead (AWOG)
- **Chặn:** [session-transcript-navigation.brief.md](../features/session-transcript-navigation.brief.md) (Brief A) — BA không viết spec được cho tới khi 3 câu này chốt.
- **Liên quan:** [ADR 0048](0048-session-index-lazy-load.md) (lazy-load transcript, `sessions.get`), [ADR 0062](0062-adopt-craft-session-storage-model.md) (header + messages, warm cache), [ADR 0069](0069-editable-session-checklist.md) (tiền lệ field metadata do UI ghi), [ADR 0032 parts](0032-session-message-parts-model.md), [ADR 0067](0067-mobile-remote-control-transport.md) (allowlist remote).

## Bối cảnh

Brief A gộp hai năng lực — **A1 đánh dấu (bookmark)** và **A2 tìm trong session đang mở** — vì cả hai kết thúc ở đúng một hành động: *"nhảy tới tin nhắn thứ i"*. Hành động đó hiện **hỏng** với mọi tin nhắn nằm ngoài render-window, và **không có định danh bền** để neo.

Hiện trạng đã verify tận file:

| Sự thật | Nơi verify |
|---|---|
| `SessionTranscript` chỉ mount 5 turn cuối; `windowStart` là **cửa sổ hậu tố** (`msgs.slice(windowStart)`), `loadOlder()` lùi 5 turn, `jumpTop()` mở hết rồi `nextTick` | `components/session/SessionTranscript.vue:139-201` |
| `scrollToMessage(i)` query `[data-mi="i"]`, `if (!el) return` → **thất bại im lặng** | `composables/useSessionScroll.ts:7-11` |
| UI `UserMessage` / `SystemMessage` **không có** trường định danh; chỉ `AssistantMessage` có `eid` | `composables/useSessionsData.ts:164-187` |
| **Sidecar thì CÓ:** `SessionMessage.id: string` là **bắt buộc cho cả 3 role** và đã nằm trên đĩa từ lâu | `sidecar/src/types/shared.ts:268-270`, `sessions/jsonl.ts` |
| UI **vứt bỏ** `m.id` khi hydrate user/system, chỉ giữ cho assistant | `stores/sessions.ts:1050-1063` |
| Id của user message do **sidecar tự mint** (`msg_u_<hex>`) lúc persist, **không bao giờ trả về UI** trong lượt đang chạy | `methods/sessions.send-message.ts:1147-1157` |
| `rewind`/`resend`/`regenerate` đều `msgs.slice(0, index)` + cắt trên đĩa; `fork` `...s` spread (kế thừa nguyên mọi field mới thêm) | `stores/sessions.ts:3595-3747` |
| `sessions.upsert` mode `update-metadata` **bỏ qua `messages`**, chỉ patch metadata; `sessions.updateTodos` là RPC hẹp riêng cho một danh sách do UI ghi | `methods/sessions.upsert.ts:162-182`, `methods/sessions.update-todos.ts` |
| `SessionMetadataPatch` là union đóng, mở rộng bằng cách thêm key | `sessions/session-manager.ts:28-51` |
| **KHÔNG tồn tại** event `session.metadata.updated` ở runtime (chỉ còn trong type union của `migrate-legacy.ts`) | grep `emit('session.` toàn sidecar |
| Round-trip popout đi bằng **reclaim + re-read**, không bằng event: `reclaimSession` set `loaded = false` → `ensureLoaded` → `sessions.get` | `stores/sessions.ts:2485-2505`, `electron/src/session-window.ts:109-116` |
| `engine:event` fan-out tới main window **+ mọi popout** (không tới tray/pet) | `electron/src/ipc.ts:88-92` |
| `ensureLoaded` `markRaw` mọi message trừ cái cuối → message **không reactive** | `stores/sessions.ts:994-996` |
| Header session đọc bằng **probe 8KB** ở fast path (vượt → fallback đọc lại, chậm cho mọi lần list) | `sessions/jsonl.ts:79, 282-310` |

> Xác nhận cho PO: ADR lazy-load mà PO nhắc **có thật** — là **ADR 0048** (đã được ADR 0062 amend phần cơ chế index, giữ nguyên hợp đồng `sessions.get`).

## Quyết định

### Q1 — Neo bằng **id bền**, không bằng chỉ số mảng. Chọn **(b)**.

**Chốt: id là neo persistence; index là địa chỉ runtime.** Hai thứ này không được lẫn.

Điểm mấu chốt khiến (b) rẻ hơn PO tưởng: **không có thay đổi định dạng JSONL và không có migration dữ liệu.** Mọi message trên đĩa — user, agent, system — **đã có `id`** từ trước; UI chỉ đang vứt nó đi ở đúng một hàm. Việc phải làm là *đọc lại thứ đã có*, cộng một chỗ vá lỗ hổng "id của lượt vừa gửi":

1. **Đọc id sẵn có.** `engineMessageToSessionMessage` gắn `eid: m.id` cho cả `user` và `system` (hiện chỉ gắn cho assistant). Type UI: `UserMessage` và `SystemMessage` thêm `eid?: string`.
2. **UI mint id lượt user, gửi kèm khi send.** `sessions.sendMessage` nhận thêm param **tuỳ chọn** `userMessageId: string`; sidecar dùng nó thay `randomBytes(...)` khi persist message user. Không có param → giữ nguyên hành vi cũ. Lý do bắt buộc phải có bước này: nếu không, tin nhắn user **vừa gửi trong phiên hiện tại chưa có id nào** cho tới lần reload kế — người dùng không đánh dấu được đúng câu mình vừa hỏi, một lỗ hổng gây kinh ngạc.
3. **`msgsToEngineMessages` dùng lại `eid`** cho user/system thay vì mint `fm-<i>-<seq>` → transcript của fork trên đĩa trùng id với bản hiển thị, đúng như assistant đang làm.
4. **Chỉ message có `eid` mới đánh dấu được.** Nút "Đánh dấu" ẩn khi message không có `eid` (message hệ thống chèn cục bộ như `ENGINE_UNAVAILABLE` — không persist, không tồn tại sau reload) và khi `streaming === true`. Đây là biên fail-fast: không có id ⇒ không có neo ⇒ không tạo được bookmark rác ngay từ đầu.
5. **`Followup.src` GIỮ NGUYÊN là index.** Nó ephemeral (xoá sạch mỗi lần gửi), không có rủi ro dangling. Không migrate. YAGNI.
6. **`data-mi` GIỮ NGUYÊN là index.** Nó là địa chỉ DOM của một hàng đang mount, không phải neo bền.

**BẢO MẬT — bắt buộc, không thương lượng.** `userMessageId` là input **L1** và `message.id` chảy vào một **path sink**: `sanitizeChild(`${message.id}-${att.id}`)` khi externalize attachment (`sessions/jsonl.ts:223`). Schema zod của `sessions.sendMessage` phải chặn tại biên: `z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional()`. Không được dựa vào `sanitizeChild` làm lớp bảo vệ duy nhất (nó chỉ chặn `/`, `\`, `..`). Đây là điều kiện merge, không phải gợi ý.

**Lưu bookmark ở đâu.** Field metadata mới trên session, đi qua **RPC hẹp riêng** `sessions.updateBookmarks` — **không** qua `sessions.upsert`:

- `sessions.upsert` mode `update-metadata` bắt buộc gửi **nguyên** session để qua zod; dùng nó cho một thao tác bấm-một-phát là sai đơn vị.
- `sessions.updateTodos` (ADR 0069) đã là tiền lệ đúng cho "một danh sách do UI ghi thường xuyên": RPC hẹp, schema là biên validate, cap độ dài.
- RPC mới **mặc định không với tới được từ remote gateway** (allowlist exact-match + param-pick default-deny, ADR 0067) — đúng như Brief A đã chốt trong *Out of scope*. Giữ nguyên; mở allowlist ⇒ infosec re-audit.

Hình dạng: `SessionBookmark = { id: string; at: string }` — **id message + thời điểm message**, hết. **Không persist excerpt.** Excerpt derive từ `msgs` lúc render (thanh bookmark chỉ hiện khi session đã `loaded`, nên nội dung luôn có sẵn). Lý do là con số cụ thể: header session đọc bằng **probe 8KB**; vượt ngưỡng thì *mọi* lần load danh sách phải đọc lại vòng hai. 30 bookmark × ~60 byte ≈ 1.8KB nằm trong ngân sách; nếu nhét excerpt 200 ký tự thì cùng số lượng đó ≈ 7KB và ăn hết probe một mình.

Cap tại schema: **`MAX_BOOKMARKS = 30`**, `id` khớp `^[A-Za-z0-9_-]{1,64}$`, `at` là chuỗi ISO ≤ 40 ký tự. Thêm `bookmarks?: SessionBookmark[]` vào `Session` (shared.ts) + vào union `SessionMetadataPatch`. **Không** thêm vào `SessionSummary` (danh sách session không cần biết).

**Dangling — hợp đồng với PO ("không crash, không nhảy sang message khác").**

Phân biệt hai loại, xử lý khác nhau, cố ý:

- **Cắt có chủ đích** (`rewind`, `resend`, `regenerate`, `edit & resend`, `/compact`) — message đã mất vĩnh viễn trên đĩa, bookmark trỏ tới nó là rác thuần tuý ⇒ **tự dọn**. Cách làm: **tính tập id còn sống TRƯỚC khi cắt** (`new Set(idsOf(msgs.slice(0, index)))`), lọc `bookmarks`, rồi mới `slice`. Nếu tập bookmark đổi → gọi `sessions.updateBookmarks`. Đặt trong một hàm duy nhất `pruneBookmarksTo(s, survivingIds)` — dùng lại ở cả 5 đường, không copy logic.
- **Mọi trường hợp khác** (không resolve được id trong `msgs` hiện tại) — **KHÔNG tự xoá**, render hàng bookmark ở trạng thái *dangling*: mờ, không bấm được, có nút "Gỡ đánh dấu" riêng. Lý do không auto-prune ở đây: một transcript đang reload / một session chưa `loaded` cũng cho ra "không tìm thấy", và xoá nhầm là **mất dữ liệu không hoàn tác được** — đúng loại lỗi mà Brief B đang đi chống.
- **Bất biến tuyệt đối:** đường resolve bookmark là `msgs.findIndex(m => m.eid === b.id)`. `-1` ⇒ **return sớm**, không fallback sang index cũ, không "gần đúng". Đây là điều kiện đủ để không bao giờ nhảy sang message khác.
- **Fork.** `fork()` dùng `...s` spread nên `bookmarks` sẽ tự động chảy sang bản clone — **phải xử lý tường minh**: lọc theo tập id thuộc `msgs.slice(0, index + 1)` (đúng đoạn được clone), rồi để `pushUpsert(branch, 'create')` mang đi. Đây là bug **đã tồn tại sẵn trong tương lai** nếu quên: mọi field mới thêm vào `Session` đều bị `...s` kế thừa mù.

**Hiệu năng resolve.** `msgs` bị `markRaw`, mảng có thể 200+ phần tử, bookmark tới 30 → `computed` một `Map<eid, index>` từ `s.msgs` một lần, mọi bookmark tra `O(1)`. Không `findIndex` trong `v-for`.

### Q2 — Hợp đồng "mở window rồi mới scroll"

**Ai mở window: `SessionTranscript`. Ai điều phối: `useSessionScroll`.**

`windowStart` là chuyện nội bộ của transcript (SRP) — không nhấc lên store, không nhấc vào composable dùng chung. Nhưng `useSessionScroll` phải giữ vai trò cửa duy nhất mà anchor follow-up / bookmark / find đều gọi (hiện đã vậy). Nối hai thứ bằng **registry một chỗ**, không phải template ref xuyên tầng:

```
// useSessionScroll.ts — singleton cấp module
registerTranscriptRevealer(reveal: (msgIndex: number) => Promise<void>): () => void
scrollToMessage(msgIndex: number): Promise<'ok' | 'not-found'>
```

- `SessionTranscript` gọi `registerTranscriptRevealer(revealMessage)` ở `onMounted` **và** `onActivated`; huỷ đăng ký ở `onDeactivated` **và** `onUnmounted` (transcript sống dưới `<KeepAlive>` — bản activate sau cùng thắng; hàm huỷ chỉ clear khi con trỏ vẫn là chính nó).
- **`scrollToMessage` đổi thành `async` và TRẢ VỀ KẾT QUẢ.** Đây là điểm sửa trực tiếp "thất bại im lặng" mà success criteria của PO yêu cầu. Thứ tự gọi cố định:
  1. `await revealer?.(msgIndex)` — không có revealer (chưa mount) thì bỏ qua, không throw.
  2. `await nextTick()`.
  3. `document.querySelector('[data-mi="i"]')`.
  4. `!el` ⇒ **`return 'not-found'`** (caller quyết định: bookmark → toast + đánh dấu dangling; find → bỏ qua match và đi tiếp).
  5. `scrollIntoView({ block: 'center' })` + flash nền accent (giữ nguyên đoạn flash hiện có, không đụng).
  Caller cũ trong template (`@click="scrollToMessage(msgIndex)"`) không cần sửa; nếu lint kêu floating promise thì `void` ở call site.

**Mở tới đâu: đúng ranh giới turn chứa target, KHÔNG mở hết như `jumpTop`.**

`revealMessage(i)` trong `SessionTranscript`:

- Ngoài `[0, messages.length)` ⇒ return ngay (fail fast, không tính toán).
- `target = turnStartFor(i)` = chỉ số user-message lớn nhất `≤ i`, không có thì `0`. Dùng lại `userTurnIndices` sẵn có, không viết bộ đếm turn thứ hai.
- **`target >= windowStart` ⇒ return** — đã mount rồi. **Window chỉ được nới rộng, không bao giờ co lại.** Co lại sẽ unmount thứ người dùng đang đọc.
- Nới: `windowStart.value = target`.

> Ghi chú cho BA để khỏi kỳ vọng sai: window là **hậu tố** (`slice(windowStart)`), nên mở tới message thứ 3 của session 200 message *bắt buộc* mount 197 message — không có phương án rẻ hơn trong thiết kế hiện tại. Chọn "ranh giới turn chứa target" vì nó **luôn ≤** `jumpTop`, chặt hơn khi target nằm giữa, và suy biến về đúng `jumpTop` khi target ở đầu. Đổi sang virtual scroll thật là refactor độc lập, Brief A đã chốt là *Out of scope*.

**Chống nhảy layout dưới con trỏ — dùng lại đúng phép toán của `loadOlder`, không phát minh cái mới:**

1. `prevH = el.scrollHeight`, `prevTop = el.scrollTop` **trước** khi đổi `windowStart`.
2. Đổi `windowStart` → `await nextTick()`.
3. `el.scrollTop = prevTop + (el.scrollHeight - prevH)` — bù đúng phần vừa chèn lên trên, **màn hình không nhúc nhích một pixel**.
4. `updateEdges()`.
5. Chỉ **sau đó** `scrollToMessage` mới `scrollIntoView` tới target.

Thứ tự này quan trọng: neo trước (không nhảy), rồi mới cuộn có chủ đích (nhảy đúng chỗ người dùng yêu cầu). Đảo thứ tự sẽ ra hiện tượng "giật hai nhịp".

**Đối kháng với auto-stick.** Watcher `scrollSig` hiện đặt `stick = true` **vô điều kiện** khi `messages.length` tăng, nghĩa là một lượt đang stream sẽ kéo người dùng về đáy ngay sau khi họ vừa nhảy lên. Chốt: `SessionTranscript` nhận prop `suppressAutoScroll?: boolean`, watcher đổi thành `if (grew && !props.suppressAutoScroll) stick.value = true`. `SessionDetail` bật cờ này **khi và chỉ khi thanh find đang mở**. Cú click bookmark **không** bật cờ (một lần nhảy, người dùng tự cuộn tiếp) — giữ blast radius nhỏ nhất có thể mà vẫn đóng được ca đau nhất (đang tìm kiếm giữa lúc agent chạy).

**A2 — ranh giới lớp data-find ↔ lớp DOM-highlight.**

Hai lớp, hợp đồng một chiều, **không được trộn**:

| | Lớp DATA (nguồn sự thật) | Lớp DOM (chỉ trang trí) |
|---|---|---|
| Đầu vào | `s.msgs` (toàn session, kể cả phần chưa mount) | `[data-mi="i"]` của **một** message |
| Đầu ra | `matches: { msgIndex, segIndex, occurrence }[]`, sắp theo đúng thứ tự đó | `<mark class="findmatch">` + `findmatch--current` |
| Quyết định | `n/N`, next/prev, wrap-around | không quyết định gì |
| Thất bại | không được phép (là nguồn sự thật) | được phép — degrade, xem dưới |

- **`n/N` luôn tính trên lớp DATA.** Không bao giờ đếm `<mark>` trong DOM. Đây chính là khác biệt kiến trúc với PreviewModal (nơi mọi thứ đã render nên `findAllRanges(root)` là đủ) — **cấm** áp thẳng mô hình đó sang transcript.
- **Trích text tìm được:** util thuần `utils/transcript-text.ts` → `searchableSegments(m: SessionMessage): { segIndex: number; text: string }[]`. Trả về: text của `UserMessage`, text của `SystemMessage`, và **chỉ** các block `kind === 'text'` của `AssistantMessage`. Đúng bảng phạm vi Brief A: thinking / step / detail / diff / terminal / plan / question / perm **không** vào. Chuẩn hoá **giống hệt** `buildTextIndex`: gộp `\s+ → ' '`, cộng thêm `.normalize('NFC')` cho cả text lẫn query (AC-12 của preview). Tìm **literal substring** bằng `indexOf`, không regex — giữ nguyên.
- **Session chưa `loaded`:** `useSessionFind` mở ra ⇒ `await ensureLoaded(s.id)` **trước** khi chạy tìm; trong lúc chờ thanh find hiện trạng thái nạp. **Cấm** trả `0/0` khi chưa nạp — đó là kết quả sai im lặng, đúng loại bug mà cả Brief A đang đi chống.
- **Phạm vi highlight DOM = message chứa match hiện tại, và chỉ nó.** Mọi occurrence trong message đó được wrap; cái current thêm class current. **Không** wrap toàn transcript (không thể — phần lớn chưa mount, và sẽ đánh nhau với `v-html` đang stream). Chấp nhận sai khác có ý thức so với AC-2 của preview ("highlight mọi occurrence"): ở transcript, "mọi occurrence" là bất khả thi theo định nghĩa của render-window.
- **Gõ ≠ điều hướng.** `runFind` (debounce ~120ms): tính lại `matches`, đặt `currentIndex = 0`, **không reveal, không scroll**. Nếu message của match hiện tại **tình cờ đã mount** thì wrap luôn; nếu chưa mount thì không làm gì với DOM. `next`/`prev` mới gọi chuỗi đầy đủ: `clearMatches(rootCũ)` → `scrollToMessage(msgIndex)` → nếu `'ok'` thì wrap trong root mới + set current + `scrollIntoView`. Kế thừa đúng AC-2/AC-3 của preview.
- **Degrade an toàn — quy tắc trục:** nếu lớp DOM **không tìm thấy** occurrence mà lớp DATA báo có (drift do chuẩn hoá, do markdown render, do `<mark>` của quote-highlight chen vào), thì **vẫn reveal + cuộn tới message đó**, chỉ bỏ phần `<mark>`. **Reveal + scroll là cam kết; highlight là best-effort.** Quy tắc này diệt nguyên một lớp bug "counter nói có mà màn hình không thấy" và đảm bảo không bao giờ nhảy nhầm.
- **Không wrap trong message đang `streaming`** (`role === 'assistant' && streaming`). Vue patch `v-html` từng frame sẽ nuốt hoặc nhân bản `<mark>`. Với message đang stream: reveal + cuộn, không wrap.
- **Dọn dẹp:** `clearMatches(root)` trước mỗi lần đổi match / đổi query / đóng thanh / đổi session, và trong watch `msgs.length` — **trước** khi Vue re-render. Dùng lại `utils/find-in-dom.ts` nguyên trạng (nó đã root-scoped, không cần sửa một dòng).

### Q3 — `PreviewFindBar.vue` → `common/FindBar.vue`. Chọn **(b)**.

Chốt tách bạch: **đổi tên phần VIEW, KHÔNG dùng chung phần STATE.**

- **Rename thuần** `components/common/PreviewFindBar.vue` → `components/common/FindBar.vue`. Component này **đã generic sẵn** — props `total` / `current` / `focusTick`, model `query` / `matchCase`, emit `next` / `prev` / `close`, không biết gì về preview. Đúng usage thứ 2, đúng thời điểm Rule of Three cho phép, và còn đúng **2** call site nên rename bây giờ rẻ nhất.
- **`usePreviewFind` KHÔNG generalize, KHÔNG đổi tên, KHÔNG đụng tới.** Hợp đồng của nó là `getRoot: () => HTMLElement | null` + `matches: HTMLElement[]` — mô hình **DOM-first, một root**. Transcript là **data-first, nhiều root, phần lớn chưa mount**. Giống nhau ở tên gọi "find" nhưng khác nhau ở *ý nghĩa* → đây là **trùng lặp ngẫu nhiên**; gộp lại sẽ đẻ ra một abstraction có cờ `mode` và cả hai bên đều khổ. Nguyên tắc dự án: KISS + YAGNI thắng DRY.
- **Composable mới `composables/useSessionFind.ts`** cho transcript, dùng lại `utils/find-in-dom.ts` (không sửa) + `utils/transcript-text.ts` (mới) + `useSessionScroll`.
- **i18n:** `common.preview.find.{matchCase,noResults,next,prev,close}` → `common.find.*` (en + vi). Khoá `placeholder` **không** đi theo vì nó mang nội dung riêng của bề mặt ("Tìm trong tài liệu…"); `FindBar` nhận **prop `placeholder: string` bắt buộc**, mỗi caller truyền khoá của mình (`common.preview.find.placeholder` giữ nguyên cho preview, `sessions.find.placeholder` mới cho transcript).
- **Tách commit riêng**, theo `.claude/rules/git-commit.md`: `refactor(ui): rename PreviewFindBar to common FindBar` — chỉ rename file + đổi khoá i18n + sửa call site trong `PreviewModal.vue`, **hành vi không đổi, 0 dòng logic mới**. Commit tính năng đi sau, không trộn.

## Phương án đã cân nhắc

**Q1 — (a) giữ index + cơ chế dọn dangling.** Loại. Rẻ hơn thật, nhưng dời được cả 4 đường cắt (`rewind`/`resend`/`regenerate`/`edit & resend`) cộng `/compact` cộng `fork` sẽ đòi **sáu** đoạn logic "dịch chỉ số" viết tay, mỗi đoạn một cơ hội trượt off-by-one, và **sai lệch âm thầm** — bookmark vẫn trỏ tới một message *hợp lệ*, chỉ là **sai message**. Đó đúng là điều PO cấm tuyệt đối. Với id, trượt bất kỳ đều biểu hiện thành "không tìm thấy" — fail loud. Và điểm quyết định: sau khi verify, (b) **rẻ ngang (a)** vì id đã nằm sẵn trên đĩa.

**Q1 — (b') thêm trường id mới vào JSONL + migration.** Loại. Không cần thiết. `SessionMessage.id` đã tồn tại và bắt buộc cho cả 3 role; session định dạng cũ đã được `migrate-legacy.ts` đưa về đúng shape. Viết migration ở đây là làm việc thừa và tự chuốc rủi ro ghi đè transcript.

**Q2 — nhấc `windowStart` lên store `sessions`.** Loại. Vi phạm SRP và bounded context (store là dữ liệu session, không phải trạng thái cuộn của một component), và sẽ vỡ ngay khi có ≥ 2 transcript sống song song dưới `<KeepAlive>`.

**Q2 — expose `revealMessage` qua template ref từ `SessionDetail` xuống.** Loại. Buộc mọi caller (thanh bookmark, thanh find, anchor follow-up trong `SessionMessageItem` — nằm sâu trong cây) phải cầm được ref → prop-drilling xuyên 3 tầng, vi phạm Law of Demeter. `useSessionScroll` đã là điểm gọi chung; giữ nguyên bề mặt đó.

**Q2 — luôn mở hết như `jumpTop`.** Loại (nhưng sát nút). Đơn giản hơn một chút, nhưng mount thừa vô cớ khi target nằm giữa session — và mount thừa ở đây là markdown + highlight + mermaid, không phải div rỗng.

**Q2 — tìm bằng `findAllRanges(root)` trên container `.msgs` như PreviewModal.** Loại thẳng. Chỉ thấy phần đang mount ⇒ tái tạo **đúng con bug `Cmd+F` của Chromium** mà Brief A lấy làm lý do tồn tại.

**Q3 — (a) rename + tái dùng nguyên `usePreviewFind`.** Loại: mô hình DOM-first sai bản chất cho transcript (xem Q2).

**Q3 — (c) giữ `PreviewFindBar` + làm thanh riêng.** Loại: nhân bản ~160 dòng markup + style theme cho usage thứ 2, hai bản sẽ trôi khỏi nhau ở lần chỉnh theme kế tiếp. Đây đúng là ca Rule of Three cho phép tách ở usage 2 vì phần view **đã** generic sẵn, chi phí gần bằng 0.

## Hệ quả

**Tích cực**

- Một hợp đồng neo duy nhất cho cả A1 và A2 — đúng mục tiêu "enabler phải là một" của Brief A. BA được phép tách 2 spec / 2 PR.
- `scrollToMessage` hết thất bại im lặng cho **mọi** caller hiện có, kể cả anchor follow-up đang có sẵn (bug này đang tồn tại và sẽ tự khỏi).
- Không migration, không đổi định dạng JSONL, không thêm store, không thêm DB.
- Round-trip popout chạy **miễn phí**: `reclaimSession` → `loaded = false` → `sessions.get` đã là đường re-read duy nhất và `bookmarks` nằm trong header. **Không cần** event `session.metadata.updated` (đường đó **không tồn tại** ở runtime — đính chính giả định trong *Câu hỏi phụ* của Brief A).
- Bookmark tuyệt đối không rời khỏi `.awog`, không vào prompt, không tới remote gateway — giữ đúng ranh giới VISION *"not chat history"* mà Brief A đã tự đặt ra.

**Tiêu cực / Trade-off**

- Highlight find chỉ phủ **message chứa match hiện tại**, không phủ cả transcript. Sai khác có ý thức so với preview; BA phải viết AC theo đúng câu này, đừng copy AC-2 nguyên văn.
- Nhảy tới message rất cũ vẫn mount toàn bộ phần đuôi ⇒ có thể khựng trên session cực dài. Không giải trong phạm vi này (virtual scroll = việc khác, đã *Out of scope*).
- Thêm một RPC + một field header + một param `sessions.sendMessage`. Nhỏ nhưng là bề mặt IPC mới — chính vì vậy mới cần ADR này.
- `suppressAutoScroll` là prop mới trên `SessionTranscript`, chạm một dòng watcher đang chạy tốt. Rủi ro thấp, cần QA hồi quy "gửi tin → tự cuộn xuống đáy".

**Rủi ro còn lại (nêu thẳng, không giấu)**

1. **`<mark>` find sống chung với `<mark>` quote-highlight.** Cả hai wrap bằng DOM Range trên cùng cây. Bắt buộc: `clearMatches` **trước** khi quote-highlight áp lại, và ngược lại; hai bên đã dùng class khác nhau (`findmatch` vs class của quote) nên `clearMatches` không ăn nhầm — nhưng `root.normalize()` của bên này **có thể** gộp text node của bên kia. QA phải có ca "message vừa được quote vừa đang là match hiện tại".
2. **Drift chuẩn hoá data ↔ DOM.** Đã có van xả (degrade: reveal, bỏ highlight), nhưng nếu drift xảy ra thường xuyên thì counter đúng mà mắt không thấy → khó chịu. QA cần một ca tiếng Việt có dấu + một ca match bắc qua inline code/bold.
3. **`markRaw` trên message cũ.** Bookmark **không** được lưu như field trên message (sẽ không reactive). Đã chốt là mảng cấp session — dev đừng "tối ưu" ngược lại.
4. **Bookmark tạo trong popout, session bị xoá/cắt ở cửa sổ chính cùng lúc.** Hai renderer, một file. `updateSessionMetadata` ghi cả header nên là last-write-wins ở mức field. Xác suất thấp (hand-off đảm bảo mỗi lúc chỉ một renderer *điều khiển* session), hậu quả tối đa là mất một bookmark. Chấp nhận, không thêm khoá.
5. **Ngân sách header 8KB.** `todos` (ADR 0069) cho phép tới 200 × 2000 ký tự — đã có thể vượt probe từ trước. Bookmark **không làm tệ thêm đáng kể** (≤ 1.8KB), nhưng nếu sau này có field thứ ba muốn vào header thì phải đo lại tổng, không thêm mù.

**Việc cần làm tiếp**

- **BA:** viết spec + AC cho A1/A2 theo đúng hợp đồng mục *Quyết định*. Ba câu hỏi trong *Open questions cho tech-lead* đã chốt, không mở lại. Ba *Câu hỏi phụ* nay đã có đáp án ở đây: (i) round-trip popout = re-read, **không** có event; (ii) fork = giữ bookmark trong đoạn clone, bỏ phần ngoài; (iii) session chưa `loaded` = `ensureLoaded` trước, cấm `0/0`. Các câu phụ còn lại (`Cmd+F` không giẫm Monaco/terminal, chặn đánh dấu khi streaming, thanh rỗng ⇒ 0px) BA tự chốt.
- **PM:** thứ tự **A2 trước, A1 sau** vẫn đúng, nhưng chèn thêm **hai** task nền chạy trước cả hai: (T0a) `scrollToMessage` async + registry + `revealMessage`; (T0b) rename `FindBar` (commit riêng). A1 phụ thuộc thêm (T0c) surface `eid` + `userMessageId` + `sessions.updateBookmarks`.
- **infosec:** review **bắt buộc** đúng một điểm — regex validate `userMessageId` ở schema `sessions.sendMessage` (L1 → path sink `sanitizeChild` khi externalize attachment). Phần còn lại không mở bề mặt mới (không network, không exec, không path từ UI).
- **Cập nhật** [docs/decisions/README.md](README.md): thêm dòng 0074, sửa ghi chú "ADR kế tiếp sau 0073 dùng 0074" → 0075.

## Tham chiếu

- [Brief A — session-transcript-navigation.md](../features/session-transcript-navigation.md)
- [Brief B — session-destructive-action-guard.md](../features/session-destructive-action-guard.md) — 4 hành động cắt transcript; ADR này quy định thứ tự "tính tập id còn sống **trước** khi cắt", Brief B chèn `await confirm()` **trước** cả hai
- [preview-modal-find.md](../features/preview-modal-find.md) — 14 AC hành vi find được kế thừa; sai khác đã nêu ở Q2
- [session-popout-window.md](../features/session-popout-window.md) — mô hình hand-off, đường reclaim + re-read
- [session-pinned-context.md](../features/session-pinned-context.md) — nghĩa "ghim" đang tồn tại (lý do đặt tên Bookmark)
- [ADR 0048](0048-session-index-lazy-load.md), [ADR 0062](0062-adopt-craft-session-storage-model.md), [ADR 0069](0069-editable-session-checklist.md), [ADR 0067](0067-mobile-remote-control-transport.md)
