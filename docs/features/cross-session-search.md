# Tìm kiếm xuyên phiên + Lưu trữ phiên (WP3)

Trạng thái: **đã code xong phần UI** (desktop `ui-next`), gồm cả nhảy tới message và badge lưu trữ. RPC `sessions.search` đã có sẵn từ trước; RPC `sessions.setArchived` / `sessions.list({ includeArchived })` do gói việc sidecar cung cấp — UI code theo đúng hợp đồng ghi ở §3.

Liên quan: [ADR 0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) (neo `eid`), [ADR 0075](../decisions/0075-transcript-surface-scoping.md) (phạm vi "surface"), [ADR 0048](../decisions/0048-session-index-lazy-load.md) (index + JSONL lazy).

---

## 1. Vấn đề

Ô tìm kiếm ở cột danh sách phiên chỉ lọc **tiêu đề** (`s.title.includes(q)`). Nội dung hội thoại — nơi 99% thông tin thật sự nằm — không tìm được từ desktop, dù sidecar đã có `sessions.search` (full-text mọi phiên) và **remote PWA đã dùng nó từ lâu**. Đây là gap "rẻ nhất": chỉ thiếu phần nối dây phía UI.

Vấn đề thứ hai: danh sách phiên chỉ có **xoá** — một hành động phá huỷ, không hoàn tác. Không có cách nào dọn danh sách mà vẫn giữ lịch sử.

## 2. Tìm kiếm trong nội dung phiên

### 2.1 Hai lớp, không trộn

| Lớp | Nguồn | Tính chất |
|---|---|---|
| Lọc **tiêu đề** | `props.sessions` (client) | Tức thì, mỗi ký tự, không I/O — giữ nguyên hành vi cũ |
| Tìm **nội dung** | RPC `sessions.search` | Bất đồng bộ, debounce 250ms, quét JSONL mọi phiên |

Cột danh sách vẫn là danh sách; kết quả nội dung nằm ở **section riêng phía dưới**, hiện khi query ≥ **2 ký tự** (đúng `z.string().min(2)` của schema sidecar — dưới ngưỡng thì không gọi RPC).

### 2.2 Composable [`useSessionSearch.ts`](../../apps/desktop/ui-next/composables/useSessionSearch.ts)

- **Debounce 250ms** — mỗi lần chạy sidecar fold JSONL của *mọi* phiên, quá đắt để bắn theo từng phím.
- **Race guard bằng số thứ tự** (`seq`): câu trả lời về muộn của query cũ bị **bỏ**, không bao giờ ghi đè kết quả của query mới. Không có nó, gõ `auth` → `author` có thể kết thúc bằng kết quả của `auth` nằm dưới ô đang hiện `author` — người dùng đọc ra "trả lời sai", không phải "trả lời chậm".
- **Xoá kết quả cũ ngay khi query đổi**: section không bao giờ trưng đáp án cho câu hỏi người dùng đã bỏ qua.
- `matchedQuery` = query mà `results` hiện tại thuộc về; phần **tô đậm** đọc biến này chứ không đọc ô input, nên tô đậm không thể lệch với dòng đang hiển thị.
- Không có shell Electron (browser-dev) ⇒ im lặng, không báo lỗi người dùng không xử lý được.
- `highlightSnippet()` cắt snippet thành các đoạn `{ text, hit }` → render bằng `<span>`, **không `v-html`** (snippet là dữ liệu L1: text của model + của người dùng đọc thẳng từ đĩa).

Giới hạn: `limit = 50`; sidecar trả `truncated` ⇒ UI nói rõ "chỉ hiện 50 kết quả đầu".

### 2.3 Mỗi dòng kết quả

Tiêu đề phiên · thời gian tương đối · nhãn vai (Bạn / Agent / Hệ thống) · snippet 2 dòng với đoạn khớp tô nền accent.

### 2.4 Nhảy tới message

Bấm một kết quả sẽ:

1. `store.openByEngineId(hit.sessionId)` — hydrate danh sách nếu cần, mở tab project tương ứng, activate phiên, `ensureLoaded` transcript. Nếu không thấy (phiên đã lưu trữ, chưa được nạp) → thử `loadArchivedSessions()` một lần rồi mở lại; vẫn không thấy → toast "phiên không còn trong danh sách".
2. `store.requestMessageJump(sessionId, hit.messageId)` — **gửi neo** `eid` của message sang bên transcript.
3. `SessionDetail.vue` **nhận neo** và cuộn tới đúng message (mục 2.5).

Vì sao phải đi vòng qua store: cột danh sách (`SessionList`) là **anh em** của cột chi tiết (`SessionDetail`), không phải con — mà "surface" của transcript được phát bằng `provide/inject` (ADR 0075), nên `SessionList` **không thể** inject surface đó. Cách duy nhất đúng luật là bên sở hữu surface tự lấy neo về. `document.querySelector` bị cấm tuyệt đối (ADR 0075 §1: nhiều transcript cùng session có thể sống song song, query toàn cục dễ trúng bản nằm trong `display:none`).

### 2.5 Bên nhận trong `SessionDetail.vue`

Hai watcher, tách vai rõ ràng — **lấy neo** và **tiêu thụ neo** là hai việc khác nhau, và cái sau phải chờ được:

**Watcher 1 — nhận (`immediate: true`).** Nguồn: `store.pendingJump` · `isActive` · `ownsThisSession`.

- `immediate` là bắt buộc: với phiên mở lần đầu, danh sách đặt neo **trước khi** `SessionDetail` mount, nên watcher chỉ-nghe-thay-đổi sẽ không bao giờ thấy nó.
- `isActive` — `SessionDetail` sống dưới `<KeepAlive max=5>`; các instance bị cache **vẫn phản ứng** với reactive state. Không gate thì instance của phiên khác cũng chạy qua đoạn này. (`consumeMessageJump` đã lọc theo `sessionId`, nhưng gate `isActive` mới là thứ đúng ngữ nghĩa: chỉ bề mặt đang hiện mới cuộn được.)
- `ownsThisSession` = `!store.isHandedOff(session.engineId)` — mô hình hand-off của popout: đúng **một** renderer sở hữu một phiên; cửa sổ không sở hữu hiện placeholder nên không được cướp neo.
- Lấy neo là **read-and-clear** (`consumeMessageJump`) → slot trong store không bao giờ kẹt; việc chờ transcript diễn ra **cục bộ** trong component, có dây cương (`JUMP_WAIT_MS = 8000`).

**Watcher 2 — tiêu thụ (`flush: 'post'`).** Nguồn: neo cục bộ · `session.loaded` · `session.msgs.length` · `transcriptSurface`.

- Chỉ chạy khi transcript **đã nạp** *và* **đã mount** (surface non-null). Trước đó không kết luận gì — báo "không tìm thấy" khi `msgs` chưa về là nói dối.
- Resolve **chỉ** qua `msgs.findIndex(m => m.eid === eid)`. `-1` ⇒ toast + dừng, **không** fallback sang index gần đúng (ADR 0074 §Q1).
- `await nextTick()` trước khi cuộn: `SessionTranscript` re-window + cuộn xuống đáy ở `onMounted`/`onActivated`, nên cú nhảy có chủ đích phải là **cú cuộn cuối cùng**, không phải cú bị ghi đè.
- `scrollToMessage(i)` trả `'not-found'` ⇒ toast `sessionsSearch.jump.failed`.

**Bốn ca biên, xử lý tương ứng:**

| Ca | Xử lý |
|---|---|
| Message nằm ngoài render-window (transcript chỉ mount ~5 lượt cuối) | **Không cần code thêm.** `scrollToMessage` đã là hợp đồng 2 bước: `reveal(i)` nới `windowStart` tới đúng ranh giới turn chứa target rồi mới query trong root của chính transcript đó. `windowStart` vẫn là state cục bộ của `SessionTranscript` — đừng nhấc ra ngoài. |
| Transcript chưa nạp xong | Chờ `session.loaded` (watcher 2 tự chạy lại), không cuộn hụt rồi bỏ cuộc. Quá `JUMP_WAIT_MS` mà vẫn chưa nạp được (ví dụ `sessions.get` lỗi) → nhả neo + toast, không im lặng. |
| Message đã bị cắt (rewind / resend / regenerate) | `findIndex` trả `-1` → toast `sessionsSearch.jump.notFound`, không throw, không nhảy sang message khác. |
| Cửa sổ không sở hữu phiên (popout hand-off) | `ownsThisSession` chặn ở watcher 1. Neo nằm lại trong store của cửa sổ đó cho tới khi phiên được thu hồi về — lúc đó mới nhảy, thay vì mất hẳn. |

Làm nổi bật sau khi cuộn: **đã có sẵn** trong `scrollToMessage` (nền `color-mix(--accent 18%)` trong ~0.85s rồi trả lại) — không thêm hiệu ứng thứ hai.

## 3. Lưu trữ phiên (archive)

### 3.1 Hợp đồng với sidecar

Phía engine ở [session-lifecycle-ops.md](./session-lifecycle-ops.md) (`sessions.set-archived.ts` + lọc trong `sessions.list.ts`). Hợp đồng UI dùng:

- `Session.archived?: boolean`
- `sessions.setArchived({ id: string, archived: boolean })` — `id` là **engineId** (`ses-…`).
- `sessions.list({ includeArchived?: boolean })` — mặc định `false`.

### 3.2 Phía UI

- Store giữ `archivedIds: Set<clientId>` + getter `isArchived(id)`. Cố tình **không** gắn cờ vào `Session` shape: cờ này là chuyện của cột danh sách, và `SessionSummaryDto` do phần khác sở hữu.
- `loadArchivedSessions()` — gọi **một lần**, khi người dùng bật "Hiện phiên đã lưu trữ": `sessions.list({ includeArchived: true })`, merge theo `engineId` những phiên danh sách mặc định đã bỏ qua. Lỗi ⇒ mở khoá để lần sau thử lại.
- `setArchived(id, archived)` — cập nhật lạc quan (dòng rời danh sách ngay), **rollback + toast** khi engine từ chối: giữ cờ sai sẽ giấu mất một phiên mà sidecar vẫn liệt kê ở lần khởi động sau.
- Phiên chưa từng lưu (không có `engineId`) ⇒ toast "chưa được lưu", không gọi RPC.
- Menu chuột phải: **Lưu trữ / Bỏ lưu trữ** (ngay dưới Ghim).
- Ngăn kéo bộ lọc: ô tick **Hiện phiên đã lưu trữ**, persist ở `awog.sessions.filter.showArchived` — cùng họ khoá localStorage với `groupBy` / `sortBy`.
- Mặc định **ẩn** phiên đã lưu trữ.

### 3.3 Hạn chế đã biết

1. Phiên đã lưu trữ thuộc project **chưa mở tab** sẽ không hiện dù đã bật toggle — danh sách luôn scope theo tab đang mở (`store.tabSessions`). Mở tab project đó thì thấy.
2. ~~Dòng phiên đã lưu trữ chưa có badge~~ — đã có: chip chữ "Đã lưu trữ" ở nhóm bên phải của dòng phụ trong [`SessionListItem.vue`](../../apps/desktop/ui-next/components/session/SessionListItem.vue), 12px cố định, `--textFaint`, không nền không viền (nhẹ nhất trong dòng), không mono, không uppercase. Đọc trạng thái qua `store.isArchived(id)` — cờ archived **không** nằm trên `Session` (§3.2).
3. Lưu trữ chính phiên đang mở không đóng phiên đó: dòng biến khỏi danh sách nhưng cột chi tiết vẫn giữ nguyên. Có chủ đích — không cắt ngang việc người dùng đang đọc.

## 4. i18n

Khoá nằm ở namespace riêng `sessionsSearch.` trong [`i18n/locales/{en,vi}/sessions-search.json`](../../apps/desktop/ui-next/i18n/locales/vi/sessions-search.json) — tách khỏi `sessions.json` để việc song song không đụng nhau (đúng lý do file i18n được chia theo vùng).

## 5. Follow-up

| Id | Việc | Trạng thái |
|---|---|---|
| FU-1 | Nhận `pendingJump` trong `SessionDetail.vue` → hoàn tất "nhảy tới đúng message" | **Xong** (§2.5) |
| FU-2 | Badge "Đã lưu trữ" trên dòng danh sách | **Xong** (§3.3) |
| FU-3 | Ghi mục Sessions trong `docs/architecture/system-overview.md` | **Xong** |
| FU-4 | Phiên đã lưu trữ thuộc project chưa mở tab vẫn không hiện (§3.3.1) | Chưa làm |
