# Feature Brief: Điều hướng transcript dài (Bookmark + Find-in-session)

> **Status:** Draft
> **Owner:** Product Owner (AWOG)
> **Created:** 2026-08-26
> **Spec:** chưa có — chờ BA sau khi tech-lead chốt enabler (xem *Open questions*)

## Problem

Session trong AWOG đã không còn là "chat hỏi nhanh" như định vị ban đầu ở [sessions.md](./sessions.md): với Workspace Panel, checklist, subagent và Git panel, một session giờ là **nơi làm việc chính** cho cả một task kéo dài nhiều giờ, dài hàng trăm turn. Nhưng transcript vẫn chỉ có một cách di chuyển duy nhất: **cuộn tay**.

Hệ quả cụ thể, đo được ngay trên code hiện tại:

1. **Không quay lại được điểm quan trọng.** Một quyết định kiến trúc, một đoạn lệnh, một kết luận ở turn thứ 40 — sau 60 turn nữa thì coi như mất. Người dùng phải cuộn ngược qua render-window (`SessionTranscript` chỉ mount 5 turn cuối, mỗi lần "load older" thêm 5 turn) hoặc đọc lại toàn bộ.
2. **Không tìm được chữ trong session.** Đây là gap **đã được tự thú** trong spec: [sessions.md](./sessions.md) — *"Chưa search trong nội dung message (chỉ filter trên title)"*. Tệ hơn: `Cmd+F` của Chromium **chạy được nhưng cho kết quả sai một cách âm thầm**, vì nó chỉ thấy 5 turn đang mount trong DOM — người dùng kết luận "không có" trong khi nội dung vẫn nằm trên đĩa.

Cả hai đều là **một vấn đề**: transcript dài không có phương tiện điều hướng nào ngoài mắt và con lăn chuột.

## Target user

- **Persona:** Dev / tech-lead chạy **một session dài nhiều giờ** cho một task lớn (debug, refactor, dựng feature) — người đã dùng Workspace Panel + checklist, coi session là môi trường làm việc chứ không phải hộp thoại.
- **KHÔNG phải persona:** người mở session hỏi 3 câu rồi đóng. Với họ tính năng này vô hình (thanh bookmark rỗng ⇒ không chiếm chiều cao).
- **Tần suất gặp problem:** hằng ngày, và **tăng dần theo độ dài session** — càng session có giá trị thì càng đau.
- **Workaround hiện tại:** cuộn tay + đọc lướt; hoặc copy đoạn quan trọng ra ngoài (Wiki / file nháp / Notes trong `pinnedContext`); hoặc bỏ session cũ và mở session mới, chấp nhận mất ngữ cảnh.

## Why now

- **Session đã trở thành bề mặt làm việc chính** ([workspace-panel.md](./workspace-panel.md), [session-popout-window.md](./session-popout-window.md), checklist per-session) — độ dài trung bình của session tăng, kéo theo problem này từ "khó chịu" lên "chặn việc".
- **Hạ tầng đã có sẵn, chỉ cần lắp** — đây là lý do why-now mạnh nhất:
  - `useSessionScroll().scrollToMessage(i)` đã scroll + flash nền accent theo `data-mi`.
  - Cơ chế **anchor badge** của follow-up quote (badge số khoanh tròn trên message nguồn, click → nhảy tới) là **bản mẫu 1-1** cho bookmark, đã chạy trong `SessionMessageItem.vue`.
  - [preview-modal-find.md](./preview-modal-find.md) vừa ship đủ bộ find-in-DOM: `PreviewFindBar.vue` + `usePreviewFind.ts` + `utils/find-in-dom.ts`, kèm **14 AC đã chốt** về hành vi tìm kiếm (wrap-around, match-case, không auto-scroll khi gõ, NFC tiếng Việt…).
  - Kênh persist metadata session (`sessions.upsert` update-metadata) đã được `pinnedContext` / `todos` / `pinned` dùng chung.
- **Rule of Three cho find:** PreviewModal là usage 1, transcript là usage 2 → thời điểm hợp lý để cân nhắc nâng thành component dùng chung, chưa muộn mà cũng chưa sớm.

## Hypothesis

Nếu người dùng có (A1) cách **đánh dấu** một message để quay lại, và (A2) cách **tìm chữ** trong session đang mở, thì họ sẽ **giữ session dài thay vì mở session mới để né việc cuộn** — đo bằng: số lần "nhảy đúng" tới message nằm **ngoài** render-window mà không phải cuộn tay, và tỉ lệ session > 50 turn còn được quay lại sau ≥ 1 ngày.

## Success criteria

- Click một bookmark (hoặc một kết quả tìm kiếm) trỏ tới message **nằm ngoài render-window** → transcript **tự mở rộng window rồi nhảy đúng tới message đó**, có flash nhận biết. **Không được im lặng không làm gì** (hành vi hiện tại của `scrollToMessage` khi phần tử chưa mount).
- **0 lần scroll sai message.** Nếu anchor không còn hợp lệ (sau rewind / regenerate / compact / fork) thì bookmark phải **tự dọn hoặc báo rõ**, tuyệt đối không nhảy sang message khác.
- Tìm được chuỗi ký tự nằm ở turn **đầu tiên** của một session 200 turn, trong khi transcript chỉ đang mount 5 turn cuối — và counter `n/N` phản ánh **toàn bộ session**, không phải phần đang render.
- Thanh bookmark **rỗng ⇒ không tồn tại** (không chiếm một pixel chiều cao nào của transcript).
- Bookmark tạo trong cửa sổ popout **hiện lại đúng** ở cửa sổ chính sau khi "đưa về đây" (và ngược lại) — không mất, không nhân đôi.
- Người dùng **không nhầm** bookmark với ngữ cảnh ghim: 0 báo cáo kiểu "tôi đã ghim message mà AI không nhớ".

## Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | **Trung tính.** VISION nói *"agents collaborate through artifacts, **not chat history**"*. Feature này làm chat history **dễ tra cứu**, KHÔNG nâng nó thành nguồn sự thật. Ranh giới phải giữ: bookmark **không** đi vào prompt. |
| Workflow-based | Không áp dụng trực tiếp — thuần bề mặt session, không chạm workflow/DAG/phase. |
| Human-in-the-loop | Yes — công cụ cho **người** đọc lại và kiểm chứng việc agent đã làm; củng cố khả năng review thủ công. |
| Local-first | **Yes, mạnh.** Find chạy hoàn toàn client-side trên dữ liệu đã ở trong store: offline, không network, không gọi sidecar. Bookmark chỉ là metadata trong session trên filesystem. Không DB. |

## Năng lực A1 — Đánh dấu tin nhắn (Bookmark)

Cho phép đánh dấu một message bất kỳ; đầu transcript có một thanh liệt kê các message đã đánh dấu (rút gọn, mặc định chỉ hiện mục **cuối cùng theo thời gian tạo message**, có nút mở rộng); click → nhảy tới vị trí message trong transcript; bỏ đánh dấu được. Danh sách sắp theo **thời gian tạo message ASC** (không phải thời gian đánh dấu).

### Chốt đặt tên — bắt buộc, không phải gợi ý

Chữ **"ghim"** trong **cùng một màn hình Session** đã mang **hai nghĩa khác nhau**, verify trên i18n hiện có:

| Nghĩa đang tồn tại | Nơi | Khoá i18n | Hệ quả với người dùng |
|---|---|---|---|
| Ghim **session** lên đầu sidebar | `SessionListItem` (`Session.pinned`) | `sessions.item.pin` = "Ghim" | Sắp xếp danh sách |
| Ghim **file/ghi chú vào ngữ cảnh LLM** | `SessionComposer` (`Session.pinnedContext`) | `sessions.pinned.title` = "Ngữ cảnh ghim" | **Nạp vào prompt mỗi turn ⇒ tốn token/tiền thật** ([session-pinned-context.md](./session-pinned-context.md)) |

Nghĩa thứ ba sẽ khiến người dùng **hợp lý mà hiểu nhầm** rằng đánh dấu một câu trả lời quan trọng = bắt AI ghi nhớ nó. Đây là hiểu nhầm **có chi phí tiền thật** theo cả hai chiều. Do đó:

1. Tên UI = **"Đánh dấu" / Bookmark**; icon **`bookmark`**, **KHÔNG** dùng icon `pin`.
2. Khoá i18n + tên field dùng tiền tố **`bookmark*`**, **KHÔNG** `pin*`.
3. Thanh đầu transcript đặt tên **"Đã đánh dấu (N)"**, phải phân biệt thị giác rõ với chip "Ngữ cảnh ghim" ở composer.
4. **Cầu nối có chủ đích:** trong menu của một bookmark có thêm hành động thứ hai — **"Đưa vào ngữ cảnh ghim"** → ghi nội dung message sang `pinnedContext.notes`. Biến hiểu nhầm thành đường dẫn học được, đồng thời **tái dùng feature sẵn có thay vì làm mới**.

> **Superseded 2026-08-27 — điểm 4 đã bị loại.** Cầu nối "Đưa vào ngữ cảnh ghim" **không** được triển khai (quyết định của user, code gỡ ở `79e00e5`). Bookmark giữ đúng một việc: điều hướng transcript. Ba điểm 1–3 **vẫn còn hiệu lực** — và điểm 1–2 nay càng quan trọng hơn, vì không còn cầu nối nào để người dùng tự học ra khác biệt giữa "đánh dấu" và "ghim ngữ cảnh": tên + icon là phương tiện dẫn đường duy nhất. Xem [spec §16](./session-transcript-navigation.md).

### Vì sao không thay được bằng feature sẵn có

Follow-up quote **gần như** đủ (có anchor badge + scroll + đánh số) — nhưng `followups` bị **xoá sạch mỗi lần gửi tin** (bản chất ephemeral, phục vụ composer). Bookmark cần **bền qua turn và qua restart**. Kết luận: không thay thế được, feature mới hợp lệ; nhưng **cơ chế UI thì tái dùng nguyên**.

## Năng lực A2 — Tìm trong session đang mở

Ô nhập từ khoá → tìm trong **toàn bộ message của session đang mở**, highlight + đếm `n/N` + next/prev.

### Phạm vi đã chốt cứng với user

| Bề mặt | Tìm? | Ghi chú |
|---|---|---|
| Text của **user message** | ✅ Có | |
| **Final response** của assistant | ✅ Có | Phần người dùng thực sự đọc |
| Nội dung trong **activity đang collapse** (tool detail, diff, terminal output, thinking) | ❌ **Không** | Muốn match phải bung mọi `SessionTurnActivities` → phá cấu trúc đọc + rất chậm. Người dùng vẫn còn Workspace Panel để tra. Đây là quyết định cuối, **không có giai đoạn sau** — cùng tinh thần "chốt cứng phạm vi bề mặt" của [preview-modal-find.md](./preview-modal-find.md). |
| Session **khác** | ❌ Không | → *Ngoài phạm vi* |

**Kế thừa nguyên các quyết định UX đã chốt** ở [preview-modal-find.md](./preview-modal-find.md) — BA **không được phát minh lại**: không auto-scroll khi đang gõ (chỉ next/prev mới cuộn), wrap-around, toggle match-case `Aa`, counter `n/N`, `Esc` đóng thanh tìm (không đóng session), tìm **literal substring** (không regex), NFC phân biệt dấu tiếng Việt, debounce.

## Enabler dùng chung cho A1 + A2 (lý do gộp một brief)

Cả hai đều kết thúc ở **cùng một hành động**: *"nhảy tới message thứ i"*. Và hành động đó **hiện đang hỏng** với mọi message nằm ngoài render-window: `useSessionScroll` query `[data-mi]`, không thấy phần tử thì `return` — **thất bại im lặng, click không làm gì**.

Vì vậy phải chốt **một lần, dùng cho cả hai**:
- Cách **mở rộng render-window rồi mới scroll** (đã có tiền lệ: `jumpTop()` set `windowStart = 0` rồi `nextTick`).
- Cách **định danh** một message để anchor tồn tại bền.

Tách thành 2 brief sẽ khiến 2 người giải cùng bài toán này theo 2 kiểu khác nhau. BA **được phép** tách thành 2 spec / 2 PR sau, nhưng enabler phải là một.

## Scope hint

- **v-next** (post-MVP). Không nằm trong [mvp-scope.md](../requirements/mvp-scope.md) — Sessions bản thân nó đã là phần mở rộng ngoài MVP gốc. Không chen vào MVP scope hiện tại.
- Layer chạm: **UI** (transcript + thanh bookmark + thanh find) / **Sidecar** (chỉ khi chọn phương án cấp id cho message — xem Open questions) / **Storage** (metadata session, không thêm store, không DB).
- Ước lượng (PM refine): **M** — trong đó A2 rẻ hơn (tái dùng nhiều), A1 đắt hơn vì phần anchor bền.
- Thứ tự đề xuất: **A2 trước, A1 sau** — A2 ít câu hỏi mở hơn và tự nó đã giải quyết phần lớn nỗi đau "quay lại điểm cũ".

## Out of scope (chốt cứng, chống scope creep)

- **Search liên session** và **palette `Cmd+K`** — backend `sessions.search` **đã tồn tại** trong sidecar và đang được remote PWA dùng, nhưng ui-next chưa port. Đó là **feature riêng, persona riêng** ([session-upgrades.md](./session-upgrades.md) #4) → **backlog riêng**, không gộp vào PR này.
- Tìm trong nội dung tool call / diff / terminal output / thinking (bảng phạm vi A2).
- Regex, whole-word, tìm-không-dấu tiếng Việt.
- Thay thế render-window bằng **virtual scroll thật** — là refactor hiệu năng độc lập, không phải điều kiện cần của brief này.
- Bookmark có ghi chú / gắn nhãn / phân nhóm / kéo-thả sắp xếp lại (sort đã chốt: theo thời gian tạo message ASC).
- Đồng bộ bookmark ra **mobile remote** — hiện `sessions.upsert` qua remote gateway là intent-based param-pick default-deny nên field mới **không với tới được từ xa, by construction**. Muốn có ⇒ mở rộng allowlist ⇒ **infosec re-audit bắt buộc**.
- Xuất bookmark ra artifact/Wiki (dù về lâu dài đây mới là đường đúng theo triết lý artifact-driven).
- Persist trạng thái mở/thu của thanh bookmark (KISS: ephemeral UI state).

## Open questions cho tech-lead

> ✅ **ĐÃ CHỐT CẢ 3 — 2026-08-26.** Quyết định + ràng buộc thi hành nằm ở **[ADR 0074 — Neo tin nhắn bền + hợp đồng điều hướng transcript](../decisions/0074-session-message-anchor-and-transcript-navigation.md)**. BA đọc ADR đó trước khi viết spec; ba câu dưới đây **không mở lại**. Phần mô tả gốc giữ nguyên để đọc lại bối cảnh.

1. **✅ CHỐT — Anchor: id ổn định vs index → chọn (b), có ADR ([0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md#q1--neo-bằng-id-bền-không-bằng-chỉ-số-mảng-chọn-b)).**
   Tóm tắt quyết định: **id là neo persistence, index là địa chỉ runtime.** Hoá ra (b) rẻ ngang (a): sidecar **đã persist `id` cho cả 3 role** từ lâu (`types/shared.ts:268`), UI chỉ đang vứt nó đi ở `engineMessageToSessionMessage` — nên **không đổi định dạng JSONL, không migration**. Bổ sung duy nhất: UI mint id lượt user và gửi kèm param mới `userMessageId` ở `sessions.sendMessage` (có **regex validate bắt buộc** — id chảy vào path sink). Bookmark = `{ id, at }`, lưu qua RPC hẹp mới `sessions.updateBookmarks` (không qua `upsert`), cap 30. Dangling: **tự dọn** ở 4 đường cắt + `/compact` (tính tập id còn sống *trước* khi cắt) và **render mờ, không tự xoá** ở mọi trường hợp khác; resolve `-1` ⇒ return sớm. `Followup.src` và `data-mi` **giữ nguyên là index**.
   *(Câu hỏi gốc)* `AssistantMessage` có `eid`; **`UserMessage` và `SystemMessage` KHÔNG có định danh nào**. Mọi anchor hiện tại (`Followup.src`, thuộc tính `data-mi`) đều là **chỉ số mảng**. Chỉ số **dịch chuyển / dangling** sau `rewind`, `resend`, `regenerate` (đều `msgs.slice(0, index)` + truncate JSONL), sau `/compact`, và sau `fork` (spread `...s` ⇒ bookmark trỏ ra ngoài đoạn đã cắt vẫn được kế thừa). Quote chịu được vì ephemeral; **bookmark thì bền, nên rủi ro là thật**.
   - Phương án (a) giữ index — rẻ, nhưng phải có cơ chế dọn dangling.
   - Phương án (b) cấp `eid` cho user/system message — đúng bản chất, nhưng **chạm JSONL + sidecar + migration cho session cũ ⇒ khả năng cần ADR**.
   - **Ràng buộc PO (không thương lượng):** dù chọn gì, bookmark dangling **không được crash** và **không được nhảy sang message khác**.
2. **✅ CHỐT — Mở rộng render-window trước khi scroll ([0074 §Q2](../decisions/0074-session-message-anchor-and-transcript-navigation.md#q2--hợp-đồng-mở-window-rồi-mới-scroll)).**
   Tóm tắt: **`SessionTranscript` sở hữu window; `useSessionScroll` điều phối** qua registry `registerTranscriptRevealer`. `scrollToMessage` thành **async** và **trả `'ok' | 'not-found'`** — hết thất bại im lặng. Mở tới **ranh giới turn chứa target** (không mở hết như `jumpTop`), **chỉ nới không co**. Chống nhảy layout bằng đúng phép toán neo của `loadOlder` (`scrollTop = prevTop + (scrollHeight - prevH)`) **rồi mới** `scrollIntoView`. Thêm prop `suppressAutoScroll` để lượt đang stream không kéo người đọc về đáy khi thanh find đang mở. Cho A2: **lớp data-find** (`s.msgs`) là nguồn sự thật của `n/N` và next/prev; **lớp DOM-highlight** chỉ trang trí **message chứa match hiện tại** — và nếu DOM lệch với data thì **vẫn reveal + cuộn, chỉ bỏ `<mark>`** (*reveal là cam kết, highlight là best-effort*).
   *(Câu hỏi gốc)* `SessionTranscript` mount 5 turn cuối (`INITIAL_TURNS`). Cần chốt hợp đồng cho `scrollToMessage`: ai chịu trách nhiệm mở window (composable scroll hay transcript), mở tới đâu (đúng turn chứa target hay mở hết như `jumpTop`), và xử lý `nextTick` / anchor viewport thế nào để nội dung không nhảy dưới con trỏ người dùng.
   Với **A2 còn nặng hơn**: "tìm toàn bộ message" ≠ "tìm trong DOM". Phải tìm trên **dữ liệu** (`s.msgs` trong store) để có danh sách match + counter đúng, **rồi mới** mở window + scroll + highlight DOM cho match hiện tại. **Không được** áp thẳng `findAllRanges(root)` như PreviewModal (nơi mọi thứ đều render). Đây là khác biệt kiến trúc mấu chốt giữa hai bề mặt.
3. **✅ CHỐT — Rename `PreviewFindBar.vue` → `common/FindBar.vue`: chọn (b) ([0074 §Q3](../decisions/0074-session-message-anchor-and-transcript-navigation.md#q3--previewfindbarvue--commonfindbarvue-chọn-b)).**
   Tóm tắt: **rename phần VIEW, KHÔNG dùng chung phần STATE.** `PreviewFindBar.vue` → `common/FindBar.vue` là **rename thuần** (component đã generic sẵn), i18n `common.preview.find.*` → `common.find.*` trừ `placeholder` (thành prop, mỗi bề mặt giữ khoá riêng), **tách commit riêng**. `usePreviewFind` **không** generalize — hợp đồng của nó là DOM-first/một-root, sai bản chất cho transcript; transcript dùng composable mới `useSessionFind` trên cùng `utils/find-in-dom.ts` (không sửa).
   *(Câu hỏi gốc)* Rule of Three cho phép (usage 2). Nhưng vì điểm 2 ở trên, **rename có thể không đủ** — có thể cần thêm một lớp "data-find" riêng bên trên `usePreviewFind`. TL chốt: (a) rename + tái dùng nguyên, (b) rename + thêm lớp data-find, hay (c) giữ nguyên `PreviewFindBar` cho preview và làm thanh riêng cho transcript.
   Nếu rename: là **rename thuần, không đổi hành vi**, và **tách commit riêng** khỏi commit tính năng (theo `.claude/rules/git-commit.md`).

### Câu hỏi phụ (BA có thể tự chốt trong spec)

> Ba câu đầu đã được ADR 0074 trả lời luôn (đánh dấu ✅) vì chúng là hợp đồng, không phải lựa chọn UX. Phần còn lại BA tự chốt.

- ✅ Nơi lưu bookmark: **RPC hẹp mới `sessions.updateBookmarks`** (mô hình `sessions.updateTodos`, KHÔNG dùng `sessions.upsert`). **Round-trip qua popout đi bằng re-read, không bằng event** — TL đã verify: **event `session.metadata.updated` KHÔNG tồn tại ở runtime** (chỉ còn trong type union của `migrate-legacy.ts`); đường thật là `reclaimSession` → `loaded = false` → `sessions.get`, và `engine:event` thì có fan-out tới popout nhưng không liên quan ở đây.
- ✅ Bookmark **có sống qua fork/branch**: giữ những bookmark nằm trong đoạn đã clone, bỏ phần ngoài — và phải làm **tường minh**, vì `fork()` dùng `...s` spread nên field mới bị kế thừa mù.
- ✅ Session **chưa `loaded`**: `await ensureLoaded` **trước** khi chạy tìm, hiện trạng thái nạp; **cấm** trả `0/0` khi chưa nạp.
- Chặn đánh dấu message **đang streaming** (giống cách footer action ẩn khi `streaming`) — ADR 0074 còn thêm: chỉ message **có `eid`** mới đánh dấu được.
- Phím tắt `Cmd/Ctrl+F` trong Sessions hiện **đang tự do**, nhưng không được giẫm lên Monaco / terminal trong Workspace Panel.
- Highlight `<mark>` của find sống chung thế nào với `<mark>` sẵn có của quote-highlight, và với `v-html` **đang streaming** (spec find đã cảnh báo rủi ro Vue patch đè với nội dung *tĩnh*; transcript streaming từng frame ⇒ rủi ro cao hơn hẳn). ADR 0074 chốt: **không wrap trong message đang streaming**; rủi ro `normalize()` giữa hai loại `<mark>` được ghi lại là rủi ro còn lại, QA phải có ca riêng.

## Liên kết

- [VISION](../../artifacts/VISION.md) — *"agents collaborate through artifacts, not chat history"* (ranh giới phải giữ)
- [MVP scope](../requirements/mvp-scope.md)
- [ADR 0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) — **quyết định kiến trúc chặn brief này** (3 open question ở trên)
- [sessions.md](./sessions.md) — gap đã tự thú: *"Chưa search trong nội dung message"*
- [session-pinned-context.md](./session-pinned-context.md) — **nghĩa "ghim" đang tồn tại**, lý do phải đổi tên sang Bookmark
- [preview-modal-find.md](./preview-modal-find.md) — nguồn tái dùng cho A2 (`PreviewFindBar`, `usePreviewFind`, `find-in-dom`) + 14 AC hành vi phải kế thừa
- [session-popout-window.md](./session-popout-window.md) — mô hình hand-off, ràng buộc round-trip của bookmark
- [session-upgrades.md](./session-upgrades.md) — cross-session search `Cmd+K` (đã có backend, thuộc *Ngoài phạm vi*)
- [workspace-panel.md](./workspace-panel.md) — bối cảnh "session là bề mặt làm việc"
- Brief anh em: [session-destructive-action-guard.brief.md](./session-destructive-action-guard.brief.md)
