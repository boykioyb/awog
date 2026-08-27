# QA Test Cases — Điều hướng transcript dài (Bookmark A1 + Tìm trong phiên A2)

> **Spec:** [session-transcript-navigation.md](./session-transcript-navigation.md) (§8 AC nhóm N/F/B/P, §10 edge case, §11 i18n)
> **Plan:** [session-transcript-navigation.tasks.md](./session-transcript-navigation.tasks.md) — task **QA-N / QA-T0b / QA-F / QA-B / QA-P**
> **ADR:** [0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) + [0075](../decisions/0075-transcript-surface-scoping.md)
> **Nhánh verify:** `feature/session-navigation-and-guard` (`e9991f6` … `5b56913`) · viết ngày 2026-08-27
> **Surface:** `apps/desktop/ui-next/` + `apps/desktop/sidecar/`. UI cũ `apps/desktop/ui/` không thuộc phạm vi.
> **Stack:** repo **không có test runner** cho ui-next (không vitest/jest) ⇒ **manual + static only**.
> **AC KHÔNG chạy:** **AC-B15**, **AC-B16** — đã bỏ cùng task A1.5 (cầu nối "Đưa vào ngữ cảnh ghim", commit `79e00e5`). Hai số **không tái sử dụng**; đừng viết ca mới cho chúng.

## Loại verify

| Ký hiệu | Ý nghĩa |
|---|---|
| **S** | Static — đọc code / grep / đọc file trên đĩa. Không cần chạy app. |
| **A** | Cần chạy app (Electron, IPC thật): `pnpm dev` ở **root** repo. |
| **R** | Cần **khởi động lại app** để kiểm chứng trạng thái trên đĩa. |
| **B** | Chạy được ở browser-dev (`pnpm dev:ui`, `useIpc === false`) — mock, không ghi đĩa. |

> `pnpm dev:ui` (http://localhost:3031) **không** có sidecar ⇒ bookmark không persist, `sessions.updateBookmarks` không được gọi. Mọi ca có chữ **A/R** phải chạy trong Electron shell (`pnpm dev` ở root).

---

## 0. Static gate (đã chạy 2026-08-27)

| Lệnh | Kết quả |
|---|---|
| `cd apps/desktop/ui-next && pnpm lint` | **PASS** (0 error) |
| `cd apps/desktop/ui-next && pnpm typecheck` | **PASS** |
| `cd apps/desktop/sidecar && pnpm typecheck` | **PASS** |

⚠ **Điều kiện tiên quyết trước khi chạy bộ test này:** `apps/desktop/ui-next/utils/stream-diag.ts` hiện **chưa được commit** trong khi `SessionMessageItem.vue` (commit `7506f88`) đã gọi `streamDiag()` ⇒ typecheck/build **chỉ pass trên máy đang có file untracked đó**. Trên máy khác / CI, checkout nhánh này sẽ **fail build** ⇒ không test được gì. Xem báo cáo bug #1.

---

## 1. Chuẩn bị fixture

### F-LONG — session 200 turn (bắt buộc cho AC-N1/N2/N3/F3/F20)

1. Tắt app.
2. Chọn một session thật làm khuôn: `~/.awog/sessions/<id>/session.jsonl` (dòng 1 = header, dòng 2+ = message).
3. Sinh file mới bằng script: giữ nguyên dòng header (đổi `id`, `title`, `messageCount`), rồi ghi 400 dòng message xen kẽ
   `{"id":"seed-u-<k>","role":"user","text":"turn <k> câu hỏi","at":"<ISO tăng dần>"}` và
   `{"id":"seed-a-<k>","role":"agent","text":"turn <k> trả lời","at":"<ISO>"}`.
4. Nhúng chuỗi mồi: `"CHUOI_DAU_TIEN"` **chỉ** trong message turn #1; `"foo"` xuất hiện **7 lần**, trong đó **6 lần** ở turn #1…#190 và **1 lần** ở 5 turn cuối.
5. Đặt file vào `~/.awog/sessions/<idmoi>/session.jsonl`, mở app.

> Transcript mở ra mount **5 turn cuối** (`INITIAL_TURNS = 5`, `SessionTranscript.vue`). Đó là tiền đề của mọi ca "ngoài render-window".

### F-CAP — 30 bookmark
Đánh dấu 30 message trong F-LONG (hoặc sửa tay mảng `bookmarks` ở dòng header rồi mở app).

### F-DANGLING — bookmark không resolve
Tắt app → sửa dòng header: thêm `{"id":"khong-ton-tai-1","at":"2026-08-01T00:00:00.000Z"}` vào `bookmarks` → mở app.

### F-SURFACE — 2 transcript cùng session (bắt buộc cho AC-N9)
Mở SSH workspace → mở **co-pilot (dock `session`) ở tab 1** → mở **tab 2** và cũng bật co-pilot của **cùng session** → quay lại tab 1 (`SshWorkspace` giữ tab ẩn bằng `v-show`, transcript ẩn **vẫn nằm trong DOM**) → đồng thời mở session đó ở `SessionDetail`.

### F-SPY — quan sát RPC không sửa code
`window.awog` là object contextBridge (read-only) ⇒ **không patch được từ console**. Dùng một trong hai:
- **DevTools → Sources → breakpoint** ở `persistBookmarks` (`stores/sessions.ts`) và ở nhánh `sessions.truncate` / `sessions.rewind`. Không break = không gọi.
- **Đọc đĩa:** `jq -c 'select(true)' <(head -1 ~/.awog/sessions/<id>/session.jsonl)` trước/sau thao tác, so `bookmarks` + `updatedAt`.

---

## 2. AC đã PASS bằng static (không cần chạy app)

| AC | Bằng chứng |
|---|---|
| **AC-N10** | `grep -n 'document.querySelector' apps/desktop/ui-next/composables/useSessionScroll.ts` ⇒ **rỗng**. Query duy nhất là `entry.root()?.querySelector(...)`. |
| **AC-N8** | Commit `023dfc3` **riêng**, chỉ rename file + 5 khoá `common.preview.find.* → common.find.*` (giá trị chuỗi **không đổi**) + prop `placeholder` + 1 call site. `usePreviewFind.ts` và `utils/find-in-dom.ts` **0 dòng thay đổi** trên toàn nhánh. |
| **AC-F16** | `utils/transcript-text.ts::searchableSegments` chỉ nhận `user.text`, `system.text`, block `kind === 'text'` của assistant. |
| **AC-F11** | `normalizeSearchText` = `\s+→' '` + `trim` + `.normalize('NFC')`, áp cho **cả** haystack và needle; `indexOf`, không regex, không fold dấu. |
| **AC-B11** | `sessions.update-bookmarks.ts`: `z.array(...).max(MAX_BOOKMARKS)` với `MAX_BOOKMARKS = 30` (`sessions/ids.ts`) — cap **tại schema**. |
| **AC-B12** | Schema chỉ nhận `{ id, at }`; `SessionBookmark` (sidecar `types/shared.ts`) không có excerpt. Excerpt derive ở `useSessionBookmarks.excerptOf` (100 ký tự). |
| **AC-B17** | `grep -rn 'bookmarks' apps/desktop/sidecar/src` ⇒ chỉ `ids.ts`, `sessions.update-bookmarks.ts`, `session-manager.ts`, `types/shared.ts`. **Không** đường nào tới `context/`, `runtime/`, prompt builder. |
| **AC-B18** | `summarizeHeader()` (`session-manager.ts`) liệt kê tường minh từng field; **không** có `bookmarks`. |
| **AC-P5** | `sessions.send-message.ts`: `userMessageId: z.string().regex(MESSAGE_ID_RE).optional()`, `MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/` (`sessions/ids.ts`, không cờ `g`). UI cũng tự chặn (`validUserMessageId`). |
| **AC-P6** | `appendMessage({ id: params.userMessageId ?? 'msg_u_<hex>' })`; attachment externalize qua `sanitizeChild(\`${message.id}-${att.id}\`)` trong `sessions/jsonl.ts`. |
| **AC-P8** | Header ghi atomic: `writeFileSync(tmp)` → `atomicReplaceSync` (`sessions/jsonl.ts`), mode `0o600`. |
| **AC-P9** | `sessions.updateBookmarks` **không** có trong `electron/src/remote-gateway-policy.ts` (allowlist exact-match, default-deny). |
| **AC-P10** (phần static) | `runCompactRpc` (`stores/sessions.ts`) chỉ set `s.usage.contextChars.history`; **không** `s.msgs`, **không** `pruneBookmarksTo`. 4 call site `pruneBookmarksTo` = `regenerate` (×2), `retryModel` (nhánh browser), `rewind`, `resend` — **không có** compact. |
| **i18n (§11.2)** | **15** khoá `sessions.bookmark.*` + `sessions.find.*` có đủ ở **en + vi**, `barTitle` **không** còn `{n}`, **không** còn khoá `toPinned*` **và không còn `sessions.find.open`** (khoá chết — thanh tìm chỉ mở bằng `⌘F`, đã gỡ 2026-08-27). |
| **A1.5 tombstone** | `grep -rn "toPinned" apps/desktop/ui-next` ⇒ **rỗng**. `SessionBookmarkBar.vue` không dùng icon `pin`, mỗi hàng chỉ có 2 hành động (nhảy / gỡ). |

---

## 3. Nhóm N — nền tảng điều hướng

- **TC-N1 (AC-N1, AC-N2, AC-N3) — A.**
  **Setup:** F-LONG mở ở `SessionDetail`, cuộn lên giữa transcript, ghi nhớ message đang ở giữa viewport.
  **Bước:** đánh dấu 1 message ở turn #1 (hoặc dùng anchor follow-up trỏ tới đó) → click hàng bookmark.
  **Expected:** transcript nới window, cuộn tới đúng message, **flash nền accent** ~0.85s; DevTools: **ngay trước** khi `scrollIntoView` chạy, vị trí tương đối nội dung đang đọc **không đổi** (đo `getBoundingClientRect().top` của phần tử mốc trước/sau bước nới); `windowStart` mới = `turnStartFor(i)` (chỉ số user-message lớn nhất ≤ i), **không** phải 0 nếu turn đó không bắt đầu ở 0.
  **Đo hiệu năng:** thời gian từ click tới flash ≤ ~500ms (§15).

- **TC-N2 (AC-N5) — A.** Đặt `windowStart = 10` (cuộn lên bằng "load older" đúng 1 lần từ vị trí phù hợp), rồi nhảy tới message thuộc turn bắt đầu ở index 40.
  **Expected:** `windowStart` **vẫn 10** (window chỉ nới, không co); message đang đọc **không bị unmount**; vẫn cuộn tới đúng target.

- **TC-N3 (AC-N4) — A.** Nhảy tới một index không có phần tử `[data-mi]` sau reveal (dùng F-DANGLING đã resolve nhưng transcript bị cắt giữa lúc chờ: click bookmark rồi lập tức `rewind` — hoặc gọi từ console một caller nội bộ nếu có).
  **Expected:** không throw, không cuộn, không flash; caller nhận `'not-found'` ⇒ toast `sessions.bookmark.notFound` (bookmark) và hàng chuyển dangling **chỉ trong phiên hiện tại** (header trên đĩa **không** đổi).

- **TC-N4 (AC-N6) — A.** Mở session A → chuyển sang session B → quay lại A (`SessionDetail` restore từ `<KeepAlive>`) → click **anchor follow-up** trỏ tới message ngoài render-window.
  **Expected:** nhảy đúng (entry vẫn đăng ký vì phạm vi là **cấu trúc**, không phải thời gian). Không còn thất bại im lặng như trước T0a.

- **TC-N5 (AC-N9) — A. ⚠ CA BẮT BUỘC.**
  **Setup:** F-SURFACE (co-pilot ở **2 tab**, 1 tab ẩn bằng `v-show`, cả hai mount `SessionTranscript` của **cùng** session, trùng dải `data-mi`).
  **Bước:** ở `SessionDetail` click một bookmark / anchor trỏ tới message **ngoài render-window**.
  **Expected:** (a) transcript **của `SessionDetail`** nới window + cuộn + flash; (b) transcript trong **tab ẩn không bị tác động** (kiểm bằng `windowStart` / `scrollTop` của nó qua Vue DevTools trước–sau); (c) **không** trả `'ok'` cho phần tử nằm trong subtree ẩn — không có trường hợp "click không làm gì".
  **Bước 2:** đứng **trong co-pilot của tab 1** click anchor follow-up của nó → phải cuộn transcript của **tab 1**, không phải của `SessionDetail`.

- **TC-N6 (AC-N9 biến thể lỗi cấu hình) — S.** `grep -rn 'provideTranscriptSurface' apps/desktop/ui-next` ⇒ đúng **2** call site: `SessionDetail.vue`, `SshSessionPanel.vue`. Nếu sau này thêm surface mới mà quên gọi ⇒ mọi lần nhảy trả `'not-found'` + toast (fail loud, chấp nhận được).

- **TC-N7 (AC-N7) — A. (QA-T0b)** Mở PreviewModal một file markdown ở chế độ render → `⌘F` → chạy lại **14 AC** của [preview-modal-find.md](./preview-modal-find.md).
  **Expected:** cả 14 pass nguyên; placeholder vẫn **"Tìm trong tài liệu…"** (khoá `common.preview.find.placeholder` giữ nguyên); nhãn nút vẫn "Kết quả kế / Kết quả trước / Đóng tìm kiếm".

- **TC-N8 (hồi quy `suppressAutoScroll` không rò rỉ) — A.** Thanh find **đóng**, gửi một tin nhắn mới.
  **Expected:** transcript **tự cuộn xuống đáy** như trước (watcher `scrollSig` chỉ bỏ `stick` khi `suppressAutoScroll === true`).

---

## 4. Nhóm F — Tìm trong phiên

- **TC-F1 (AC-F1) — A/B.** Focus vùng chat **hoặc** composer textarea → `⌘/Ctrl+F`.
  **Expected:** thanh find hiện overlay góc trên-phải vùng `.chat` (không đẩy layout, không đè nút fold-all), input được focus + select; **browser-find không bung**; chưa có highlight nào.

- **TC-F2 (AC-F2) — A.** Session **chưa `loaded`** (vừa restart app, click session trong sidebar rồi bấm `⌘F` ngay) → gõ từ khoá.
  **Expected:** counter hiện **"Đang nạp transcript…"**, `‹`/`›` disabled; **không bao giờ** thấy `0/0` trong lúc chờ; sau `ensureLoaded` counter đổi sang số thật.

- **TC-F3 (AC-F3) — A.** F-LONG (mount 5 turn cuối), gõ `foo` (7 lần, 6 ngoài render-window).
  **Expected:** counter **`1/7`** ngay sau debounce — `N` tính trên **toàn `s.msgs`**, không phải DOM.

- **TC-F4 (AC-F4) — A.** Đang gõ từ khoá có match ngoài render-window.
  **Expected:** counter + current cập nhật nhưng **viewport không nhúc nhích** (không reveal, không cuộn). Nếu message của match hiện tại **tình cờ đã mount** thì có `<mark>`, còn lại không đụng DOM.

- **TC-F5 (AC-F5, AC-F6) — A.** Nhấn `Enter`/`›` khi match kế nằm ngoài render-window; lặp tới match cuối rồi Enter thêm 1 lần; rồi `Shift+Enter` ở match đầu.
  **Expected:** window nới tới turn chứa match → cuộn tới message → **mọi occurrence trong message đó** wrap `<mark class="findmatch">`, cái hiện tại thêm `findmatch--current` (nền accent) → counter tăng 1; wrap-around cả hai chiều (`N/N` → `1/N`, `1/N` → `N/N`).

- **TC-F6 (AC-F13) — A.** Có match ở ≥2 message đã mount, đang ở match thuộc message X.
  **Expected:** **chỉ** X có `<mark class="findmatch">`; các message khác không bị wrap (sai khác có ý thức so với AC-2 của preview).

- **TC-F7 (AC-F7) — A.** Gõ `Task` (match-case off) → bật `Aa`.
  **Expected:** danh sách match lọc lại live, counter đổi, current về match đầu hợp lệ, **không tự cuộn**.

- **TC-F8 (AC-F8) — A.** Session đã `loaded`, gõ chuỗi không tồn tại.
  **Expected:** counter hiện **"Không có kết quả"**, input viền `--danger`, `‹`/`›` disabled, không highlight.

- **TC-F9 (AC-F9) — A.** Có highlight → xoá hết input.
  **Expected:** mọi `<mark class="findmatch">` bị gỡ (kiểm `document.querySelectorAll('.findmatch').length === 0`), counter ẩn, console **không** lỗi.

- **TC-F10 (AC-F10) — A.** Thanh find mở, workspace panel đang mở → `Esc`.
  **Expected:** thanh find đóng, highlight sạch, **session vẫn mở**, workspace panel **không** đổi, vị trí cuộn giữ nguyên.

- **TC-F11 (AC-F10 thứ tự Esc) — A.** Mở note-modal của "Quote & follow up" **và** thanh find cùng lúc → `Esc`.
  **Expected:** **note-modal đóng trước**, thanh find **vẫn mở**; `Esc` lần 2 mới đóng thanh find.

- **TC-F12 (AC-F11) — A.** Transcript chứa "phân tích": tìm `phân tích` ⇒ có match; tìm `phan tich` ⇒ **0 match**.

- **TC-F13 (AC-F12) — A.** Dựng drift DOM ↔ data: message có markdown làm text render khác text lưu (ví dụ chuỗi bị chia bởi inline code / `<mark>` quote chen giữa). Next tới match đó.
  **Expected:** **vẫn reveal + cuộn tới message**, chỉ **bỏ `<mark>`**; giá trị `N` **không đổi**.

- **TC-F14 (AC-F14) — A.** Thanh find **đang mở**, một lượt đang stream nhận thêm delta.
  **Expected:** transcript **không** tự kéo về đáy; người dùng giữ nguyên vị trí đang tìm.

- **TC-F15 (AC-F15) — A.** Match nằm trong message assistant `streaming === true` → Next tới nó.
  **Expected:** reveal + cuộn tới message nhưng **không** wrap `<mark>`; không có mark bị nhân bản/nuốt sau khi stream xong.

- **TC-F16 (AC-F16) — A.** Tìm một chuỗi chỉ có trong tool detail / diff / terminal output / thinking (activity đang collapse).
  **Expected:** counter **"Không có kết quả"**.

- **TC-F17 (AC-F17) — A.** Thanh find mở + có highlight → đổi sang session khác; lặp lại với **release session sang popout**.
  **Expected:** thanh đóng, query reset, `clearMatches` chạy **trước** re-render ⇒ `document.querySelectorAll('.findmatch').length === 0`, không `<mark>` rác (kể cả trong subtree `<KeepAlive>` đã park).

- **TC-F18 (AC-F18) — A.** Focus trong Monaco (Workspace Panel → Files → mở file) rồi `⌘F`; lặp với terminal (`.xterm`).
  **Expected:** thanh find của session **không** mở; find widget của Monaco / xterm nhận phím như trước.

- **TC-F19 (AC-F19) — A.** PreviewModal đang mở phía trên session → `⌘F`.
  **Expected:** chỉ handler của PreviewModal chạy; thanh find của session **không** mở.

- **TC-F20 (AC-F20) — A.** F-LONG, gõ nhanh 10 ký tự liên tiếp.
  **Expected:** `runFind` chạy tối đa 1 lần sau khi ngừng ~120ms (breakpoint ở `runFind` để đếm); UI không đứng hình; counter đúng ≤150ms sau debounce.

- **TC-F21 (AC-F21) — A.** Thanh find mở với query có match → gửi một lượt mới (`msgs.length` tăng).
  **Expected:** `clearMatches` chạy **trước** re-render, `matches` tính lại, counter phản ánh nội dung mới, **không** `<mark>` mồ côi.

- **TC-F22 (AC-F22) — A.** Ép mọi match trả `'not-found'` (F-SURFACE + đưa transcript của surface hiện tại vào trạng thái ẩn, hoặc cắt transcript ngay sau khi tính match) → nhấn Next liên tiếp.
  **Expected:** duyệt **tối đa một vòng** rồi dừng ở match ban đầu + toast `sessions.find.notFoundJump`; **không** lặp vô hạn (kiểm CPU + số lần vào `scrollToMessage`).

- **TC-F23 (AC-F5 + §10.2 mark chồng mark) — A. ⚠ CA BẮT BUỘC.** Một message **vừa được quote-highlight** (Quote & follow up) **vừa là match hiện tại**.
  **Expected:** hai lớp mark sống chung; `clearMatches` không ăn mất quote-highlight và ngược lại; không nhân bản text; sau khi đóng find, quote-highlight vẫn đúng chỗ.

- **TC-F24 (popout) — A.** Pop out một session ra cửa sổ riêng → `⌘F` trong cửa sổ đó.
  **Expected:** thanh find hoạt động đầy đủ (handler là cục bộ của `SessionDetail`).

- **TC-F25 (limitation đã biết, §10.4) — A.** Rebind một global shortcut sang `mod+KeyF` ở Settings → Keyboard.
  **Expected:** handler global **thắng**, thanh find không mở. **Không phải bug** — ghi nhận đúng limitation.

---

## 5. Nhóm B — Đánh dấu

- **TC-B1 (AC-B1) — A.** Message assistant đã hoàn tất, có `eid`.
  **Expected:** footer action row có icon `bookmark`, tooltip **"Đánh dấu"**, icon-only 13px.

- **TC-B2 (AC-B2) — A.** (a) message đang `streaming`; (b) system message cục bộ `ENGINE_UNAVAILABLE` (ngắt sidecar rồi gửi 1 lượt).
  **Expected:** nút "Đánh dấu" **không hiện** ở cả hai (không có `eid` / đang stream).

- **TC-B3 (AC-B3) — A.** Click nút trên message chưa đánh dấu.
  **Expected:** icon sang accent + tooltip "Bỏ đánh dấu"; thanh "Đã đánh dấu" cập nhật trong **cùng frame** (optimistic, trước khi RPC trả); click lần nữa → gỡ.

- **TC-B4 (AC-B4) — A.** Đánh dấu message **#80 trước**, rồi **#12 sau** → mở rộng thanh.
  **Expected:** thứ tự **#12 → #80** (sort theo `at` của **message** ASC, không theo thời điểm bấm).

- **TC-B5 (AC-B5) — A.** Session có 4 bookmark, vừa mở transcript.
  **Expected:** thanh **rút gọn**: đúng **1 mục** = mục có `at` **lớn nhất**; chip đếm `4`; số `4` **chỉ xuất hiện một lần** (tiêu đề là "Đã đánh dấu", không kèm số); chip là `12px` mono, tiêu đề/excerpt `1em`.

- **TC-B6 (AC-B6) — A.** Mở rộng → thu lại → đổi session → quay lại.
  **Expected:** mở rộng hiện đủ 4 hàng sort ASC; thu lại về 1 hàng; trạng thái **không persist** (quay lại session ⇒ rút gọn).
  ⚠ **Kiểm thêm (spec §5.1 bước 5):** click **chọn một mục** cũng phải thu thanh lại — xem bug #2.

- **TC-B7 (AC-B7) — A. ⚠ CÓ SỐ ĐO.** Session không có bookmark: đo `document.querySelector('.msgs').clientHeight` → thêm 1 bookmark → đo lại → gỡ hết → đo lại.
  **Expected:** khi 0 bookmark, `document.querySelector('.bmb') === null` (**không tồn tại trong DOM**, không phải `display:none`); `clientHeight` lần 1 **= lần 3**, lệch **0 px**. Ghi 3 số đo vào báo cáo.

- **TC-B8 (AC-B8) — A.** Bookmark trỏ tới message ngoài render-window → click hàng.
  **Expected:** nới window + cuộn + flash. **Không im lặng không làm gì.**

- **TC-B9 (AC-B9) — A.** Session có bookmark nhưng `s.loaded === false` (vừa restart, chưa mở session).
  **Expected:** thanh **chưa render**; sau `ensureLoaded` thanh xuất hiện với excerpt đầy đủ (excerpt = đoạn prose đầu tiên, ≤100 ký tự + `…`; turn không có text ⇒ **"(lượt không có phản hồi văn bản)"**).

- **TC-B10 (AC-B10) — A.** F-CAP (30 bookmark) → xem một message chưa đánh dấu.
  **Expected:** nút ở trạng thái **disabled** (mờ 0.4, hover không đổi màu), tooltip **"Tối đa 30 đánh dấu mỗi phiên"**; click **không** tạo thêm và **không** gửi RPC (breakpoint `persistBookmarks` không break).

- **TC-B11 (AC-B11) — S/A.** Gọi trực tiếp RPC với 31 phần tử (từ một script sidecar test hoặc tạm thời qua console của main process).
  **Expected:** zod **reject**, không ghi đĩa, lỗi rõ ràng. *(Static đã PASS — chỉ chạy nếu muốn kiểm chứng end-to-end.)*

- **TC-B12 (AC-B12) — A/S.** Đánh dấu 3 message nội dung dài → đọc dòng header `~/.awog/sessions/<id>/session.jsonl`.
  **Expected:** `bookmarks` chỉ có `{ id, at }` cho mỗi mục; **không** excerpt/preview/text. Ở 30 mục, độ dài phần `bookmarks` ≤ ~1.8KB (đo bằng `jq -c '.bookmarks' | wc -c`).

- **TC-B13 (AC-B13) — A.** F-DANGLING.
  **Expected:** hàng mờ (opacity .55, chữ in nghiêng), **không bấm được**, nhãn **"Tin nhắn không còn tồn tại"**, có nút gỡ với tooltip **"Gỡ đánh dấu này"**; **app không crash**, console không exception; hàng dangling xếp **sau** các hàng sống.

- **TC-B14 (AC-B14) — A. ⚠ RÀNG BUỘC KHÔNG THƯƠNG LƯỢNG.** Click vào hàng dangling; rồi Tab tới nó và nhấn `Enter`.
  **Expected:** **không** thao tác cuộn nào; **tuyệt đối không** cuộn tới một message khác (button `disabled` chặn cả click và Enter).

- **TC-B15 (AC-B13 nửa còn lại) — A.** Bookmark dangling **không tự xoá**: đóng/mở session, restart app.
  **Expected:** hàng dangling vẫn còn trên đĩa cho tới khi người dùng tự gỡ.

- **TC-B16 (AC-B19) — A.** Ép `sessions.updateBookmarks` lỗi (kill sidecar rồi bấm "Đánh dấu", hoặc chặn method).
  **Expected:** toast **"Không lưu được đánh dấu"** (`sessions.bookmark.saveFailed`), `console.warn('[sessions] sessions.updateBookmarks failed', …)`, **state UI không rollback**; thao tác kế tiếp (sau khi sidecar sống lại) gửi lại **toàn bộ mảng** ⇒ tự chữa.

- **TC-B17 (AC-P10 — ⚠ ĐỪNG TEST THEO KỲ VỌNG CŨ) — A + R.**
  **Setup:** session ~60 message, bookmark ở #5 và #40; #5 nằm **trước** `firstKeptMessageId` sau khi compact. Đặt breakpoint ở `persistBookmarks`.
  **Bước:** chạy `/compact` thành công (đồng hồ ngữ cảnh tụt, checkpoint `session.compacted` xuất hiện).
  **Expected:** `s.msgs` **không đổi** (đếm số message trước/sau); breakpoint `persistBookmarks` **KHÔNG** break ⇒ `sessions.updateBookmarks` **không được gọi**; thanh vẫn hiện **đủ 2** bookmark; **cả hai vẫn nhảy đúng**, kể cả #5; sau **restart app** header vẫn có **đúng 2** phần tử.
  **Ghi chú:** `/compact` chỉ cắt ngữ cảnh model trong `buildContext`; transcript trên đĩa nguyên vẹn. Kỳ vọng cũ ("cùng quy tắc prune") là **sai** và đã bị gỡ khỏi spec.

---

## 6. Nhóm P — persistence, popout, offline

- **TC-P1 (AC-P1) — A + R. Ba nhánh, chạy riêng từng nhánh.**
  **Setup:** session có bookmark ở message #5 và #40, thao tác tại index 20.
  **Bước:** (a) `rewind@20`; (b) `resend@20` ở một bong bóng user; (c) `edit & resend@20`; (d) `regenerate` tại một turn assistant có user turn ở 20.
  **Expected mỗi nhánh:** bookmark #5 **còn**, #40 **bị dọn**; `sessions.updateBookmarks` gửi **trước** khi cắt trên đĩa (breakpoint: `persistBookmarks` break **trước** `sessions.truncate`/`sessions.rewind`); **restart app** ⇒ đúng **1** bookmark trong header.
  **Lưu ý `regenerate`:** prune chạy **2 lần** (một lần theo `index`, một lần theo `ui`) ⇒ 2 lời gọi RPC. Không phải lỗi, nhưng ghi lại nếu thấy.

- **TC-P2 (AC-P2) — A + R.** Session gốc có bookmark #5 và #40 → `fork` tại index 20 → mở session fork.
  **Expected:** fork chỉ mang bookmark **#5**; **session gốc giữ nguyên cả hai**; sau **restart app**, header của fork vẫn có **đúng 1** bookmark (kiểm chứng `sessions.upsert` không mang `bookmarks` nên `persistBookmarks(branch)` phải thắng cuộc đua đăng ký session — nếu sau restart fork **rỗng bookmark** ⇒ đó là lỗi ordering, báo ngay).

- **TC-P3 (AC-P3) — A + R.** (a) Pop out session → tạo 2 bookmark trong popout → "Đưa về đây" ở cửa sổ chính. (b) Chiều ngược: tạo bookmark ở cửa sổ chính → pop out.
  **Expected:** cửa sổ nhận hiển thị **đúng 2** bookmark — **không mất, không nhân đôi**; sau restart vẫn đúng.
  **⚠ Biến thể phải chạy (đường hydrate mảng rỗng):** trong popout **gỡ hết** bookmark → "Đưa về đây". Kỳ vọng: cửa sổ chính hiển thị **0** bookmark. *(Đường này chỉ đúng nhờ `[]` là truthy trong `if (full.bookmarks)` — nếu ai đó "tối ưu" thành `if (full.bookmarks?.length)` thì bookmark đã gỡ sẽ sống lại. Ca này là lưới an toàn cho chính điều đó.)*

- **TC-P4 (AC-P4) — A.** Gửi một tin nhắn mới trong phiên hiện tại (chưa reload) → xem footer của **chính bong bóng user vừa gửi**.
  **Expected:** nút "Đánh dấu" **có sẵn và dùng được**; đọc header trên đĩa: message user đó có `id` dạng `mu-<b36>-<b36>` (đúng id UI mint) — **không** phải `msg_u_<hex>`.

- **TC-P5 (AC-P5) — S (đã PASS) + A tuỳ chọn.** Ép `userMessageId = "../../etc/passwd"` (sửa tạm `mintUserMessageId`, revert sau) → gửi.
  **Expected:** UI tự loại (`console.warn('[sessions] discarding malformed userMessageId')`) và gửi **không** kèm param ⇒ sidecar mint `msg_u_<hex>`; nếu gọi RPC trực tiếp thì zod reject; **không** file nào được ghi ngoài `~/.awog/sessions/<id>/`.

- **TC-P6 (AC-P6) — A.** Gửi một lượt có đính kèm ảnh (`userMessageId` hợp lệ).
  **Expected:** file trong `~/.awog/sessions/<id>/attachments/` tên `<userMessageId>-<attId>.<ext>`, nằm **trong** thư mục session.

- **TC-P7 (AC-P7) — A.** Ngắt mạng (tắt Wi-Fi) → dùng A1 (đánh dấu, mở/thu, nhảy, gỡ) + A2 (tìm, next/prev, match-case).
  **Expected:** mọi chức năng đầy đủ; DevTools → Network: **0** request mạng phát sinh từ hai feature này.

- **TC-P8 (AC-P8) — R.** Bấm "Đánh dấu" rồi **kill app ngay** (Force Quit / `kill -9` process Electron).
  **Expected:** mở lại app: hoặc bookmark có, hoặc không — **không** trạng thái hỏng; dòng header vẫn parse được (`head -1 … | jq .` OK), transcript mở bình thường.

- **TC-P9 (AC-P9) — S (đã PASS) + A tuỳ chọn.** Từ PWA remote gọi `sessions.updateBookmarks`.
  **Expected:** bị từ chối (default-deny), không ghi gì.

- **TC-P10 (§10.3 header bị sửa tay) — R.** Tắt app → sửa header: thêm phần tử sai shape (`{"id":"a/b","at":"x"}`, `{"id":123}`, chuỗi thay vì object) + 35 phần tử hợp lệ → mở app.
  **Expected:** sidecar **bỏ qua** phần tử không hợp lệ, **không throw**; danh sách bị cắt còn **30**; session mở bình thường; sau lần persist kế tiếp header chỉ còn phần đã lọc.

---

## 7. Theme + hồi quy

- **TC-T1 — A.** Lặp TC-B5, TC-B13, TC-F8 ở **dark** và **light**.
  **Expected:** thanh bookmark dùng `--bgEl` + `--border` + icon `--accent`; hàng dangling đọc được; input find viền `--danger` rõ; **không** hardcode hex (đã static).
- **TC-T2 — A.** Bật theme family **Cute** (Settings → Appearance → Theme → Cute) → lặp TC-B5 + TC-F8.
  **Expected:** vẫn đọc được, token màu vẫn qua biến; chip đếm vẫn `12px` mono.
- **TC-REG1 — A.** Anchor follow-up + card follow-up ở composer (2 caller cũ của `scrollToMessage`) vẫn nhảy đúng sau khi hàm thành async.
- **TC-REG2 — A.** `fork` / `branch` / `retryModel` / `/compact` vẫn chạy như trước (không lỗi console mới).
- **TC-REG3 — A.** Session mount trong **SSH co-pilot**: **không** có thanh bookmark (thanh chỉ ở `SessionDetail`) và **không** có thanh find (không handler `⌘F` trong panel).
- **TC-REG4 — A.** Gửi tin nhắn mới khi transcript đang cuộn lên giữa (find đóng) ⇒ vẫn snap xuống đáy (trùng TC-N8, chạy 1 lần là đủ).

---

## 8. Ca hồi quy cho bug đã phát hiện (static)

- **TC-BUG1 — S.** `git stash -u` (park `utils/stream-diag.ts` untracked) rồi `pnpm typecheck` ở `apps/desktop/ui-next`.
  **Expected sau khi fix:** typecheck **PASS** trên cây làm việc **không** có file untracked (tức file đã được commit, hoặc hunk `streamDiag` trong `SessionMessageItem.vue` được tách khỏi commit `7506f88`).
- **TC-BUG2 — A.** (spec §5.1 bước 5 / AC-B6) Thanh bookmark **mở rộng** → click **một mục** (không phải nút thu).
  **Expected sau khi fix:** thanh thu lại về 1 hàng sau khi nhảy.

---

## 9. Static gate cuối (chạy trước khi đóng QA)

```bash
cd apps/desktop/ui-next && pnpm lint && pnpm typecheck
cd ../sidecar && pnpm typecheck
grep -n 'document.querySelector' apps/desktop/ui-next/composables/useSessionScroll.ts   # phải rỗng (AC-N10)
grep -rn 'toPinned' apps/desktop/ui-next                                                # phải rỗng (A1.5 tombstone)
grep -rn 'provideTranscriptSurface' apps/desktop/ui-next                                # đúng 2 call site
```
