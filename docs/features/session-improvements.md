# Feature Spec — Cải thiện Session (UI + Annotation)

> **Ghi chú gộp tài liệu:** File này **gộp** từ [`session-ui-improvements.md`](session-ui-improvements.md) + [`session-annotation-improvements.md`](session-annotation-improvements.md) — hai file gốc đã được **thay thế/superseded** bởi tài liệu này. Không mất nội dung nào so với 2 file gốc.
>
> **✅ TRẠNG THÁI:** Đã triển khai code toàn bộ 8 issue (Wave 1–3). Lint + typecheck pass 0 lỗi (Wave 4 Z.1). Component mới: `SessionTurnFullscreen.vue`. Còn lại: QA verify AC + code review. Xem [session-improvements.tasks.md](session-improvements.tasks.md).
>
> **Loại:** Feature Spec (Business Analyst). Tài liệu chỉ **phân tích + AC + edge case**, KHÔNG chứa code.
> **Skill:** [elicit-requirements](../../.claude/skills/elicit-requirements/SKILL.md)
> **Phạm vi:** các component Session của `apps/desktop/ui-next/`.
> **Trạng thái:**
> - **Nhóm A (Session UI):** user đã chốt toàn bộ quyết định hướng đi; sẵn sàng cho project-manager decompose.
> - **Nhóm B (Annotation):** Draft — chờ review Product Owner + Tech Lead.
> **Liên quan:**
> - [ADR 0055 — Session ↔ Task link](../decisions/0055-session-task-link.md) (quote lưu thành follow-up)
> - [docs/features/workspace-panel.md](workspace-panel.md) (pattern overlay/panel)
> - Component render highlight: `SessionTextBlock` (CSS Custom Highlight API)

Tài liệu chia làm **2 nhóm, 8 issue**:

- **Nhóm A — Session UI (UI-1..UI-5):** tab search, drag tab, fullscreen turn, composer height, pagination — trên `SessionTabBar.vue`, `SessionMessageItem.vue`, `SessionComposer.vue`, `SessionList.vue`.
- **Nhóm B — Annotation trên SessionDetail (AN-1..AN-3):** auto-focus note, drag+resize notePop, right-click quote — trên `SessionDetail.vue`.

---

## Bảng tổng hợp (toàn bộ 8 issue)

| # | Issue | Component | Quyết định đã chốt | Ưu tiên | Effort | Trạng thái | Thứ tự triển khai đề xuất |
|---|---|---|---|---|---|---|---|
| **UI-1** | Search project khi add tab | SessionTabBar | Thêm input search (filter substring, autofocus, Esc/Enter) | **Cao** | **S** | Hướng đi đã chốt | 1 |
| **UI-4** | Max-height + resize composer | SessionComposer | **Phương án B**: manual resize > auto-grow; max = **40vh** (một nguồn); **không persist** MVP | **Cao** | **S–M** | Hướng đi đã chốt | 2 |
| **AN-1** | Auto-focus textarea note popover | SessionDetail | `nextTick`+ref `.focus()`, caret ở cuối; gỡ `autofocus` attr | **Cao** | **S** | Draft (quick win độc lập) | 3 |
| **UI-2** | Kéo-thả sắp xếp tab | SessionTabBar | **Native pointer** (không dep, không ADR); auto-scroll mép; keyboard reorder để sau | **TB** | **M** | Hướng đi đã chốt | 4 |
| **UI-3** | Fullscreen **toàn bộ turn** | SessionMessageItem | Overlay render lại `.abody`, **realtime khi streaming**; **GIỮ CẢ HAI nút**; Esc đóng | **TB** | **M** | Hướng đi đã chốt | 5 |
| **UI-5** | Nhiều session hơn (phân trang) | SessionList | **PHÂN TRANG PER-GROUP**; page size **20**/group; bỏ infinite/virtual | **TB** | **M** | Hướng đi đã chốt | 6 |
| **AN-3** | Right-click hiện nút Quote tại con trỏ | SessionDetail | Bổ sung `@contextmenu` song song mouseup; giữ cả hai trigger | **TB** | **S–M** | Draft | 7 |
| **AN-2** | Kéo-thả + resize note popover | SessionDetail | Native pointer trên header; clamp viewport; **không persist** MVP | **TB** | **M** | Draft (+ TL review) | 8 |

> **Thứ tự triển khai đề xuất:** ưu tiên các quick win / bug cảm nhận rõ trước (UI-1, UI-4, AN-1), rồi tới nhóm effort M. Trong Nhóm B, thứ tự nội bộ đề xuất **AN-1 → AN-3 → AN-2** (AN-1 quick win độc lập; AN-3 nhỏ, độc lập; AN-2 lớn nhất). Cả 3 issue Nhóm B độc lập, không chặn nhau.

### Ghi chú xuyên suốt cho TL / PM
- **UI-3 (3.b đã chốt)**: giữ **cả hai** nút fullscreen — nút câu trả lời cũ (PreviewModal, chỉ final response) + nút toàn bộ phản hồi mới (overlay render cây turn, realtime). Không gỡ nút cũ; hai icon + tooltip phân biệt.
- **UI-5 (5.a đã chốt)**: phân trang **per-group** (không phẳng) — mỗi project/group giữ state trang riêng, page size 20/group, reset khi filter đổi. Chỉ gỡ infinite scroll/load-more **trong SessionList** (không đụng `useLoadMore`/`LoadMoreSentinel` dùng chung).
- **UI-4** là bug cảm nhận rõ nhất; Phương án B đã chốt → triển khai sớm.
- **UI-2** dùng native pointer nhất quán `onResize` → không rủi ro dependency.
- **AN-1** là quick win độc lập, không có OQ chặn — có thể tách triển khai trước.
- Tất cả preference mới persist qua **localStorage lớp `awog.sessions.*`**, không backend/DB (local-first).
- **Toàn bộ open question quan trọng của Nhóm A đã được giải quyết** (3.b + 5.a là 2 câu cuối vừa chốt). Các câu còn lại là chi tiết nhỏ, có đề xuất rõ, **để dev quyết lúc implement** — không chặn code. Nhóm B còn một số OQ cần TL/PO xác nhận (xem cuối tài liệu).

---

# NHÓM A — Session UI (UI-1..UI-5)

## Bối cảnh chung (Nhóm A)

`apps/desktop/ui-next/` là thế hệ UI mới của màn hình Sessions (khác `apps/desktop/ui`).
Các component liên quan tới 5 issue Nhóm A:

| Component | Path | Vai trò |
|---|---|---|
| `SessionTabBar.vue` | `apps/desktop/ui-next/components/session/SessionTabBar.vue` | Thanh tab kiểu VSCode, 1 tab = 1 project đã mở (`'' = Default`). |
| `SessionMessageItem.vue` | `.../session/SessionMessageItem.vue` | Một message trong transcript (system/user/assistant). |
| `SessionComposer.vue` | `.../session/SessionComposer.vue` | Ô nhập prompt + toolbar + autocomplete + queue. |
| `SessionList.vue` | `.../session/SessionList.vue` | Danh sách session của tab project đang active. |

Nguồn dữ liệu chính:
- Store `sessions` (`apps/desktop/ui-next/stores/sessions.ts`): `openProjectTabs` (thứ tự tab, persist localStorage `awog.sessions.tabs`), `activeTab`, `tabSessions`, các action `openTab/closeTab/closeOtherTabs/closeTabsToRight/closeAllTabs`.
- Composable `useSessionTabs` (`.../composables/useSessionTabs.ts`): derive `tabs` + `openableProjects` từ store, không có state riêng, không IPC.
- Composable `useLoadMore` / `useGroupLoadMore` (`.../composables/useLoadMore.ts`): render-window incremental (page size 60 cho flat, 5 cho group) + `LoadMoreSentinel` (IntersectionObserver auto-load cho list phẳng).
- Composable `usePreview` + `PreviewModal.vue` (`.../components/common/PreviewModal.vue`): overlay full-window đã có sẵn (Teleport to body, outline markdown, minimize, close).
- Component render một assistant turn: `SessionTurnActivities.vue` (tools/thinking/sub-agents collapsible), `SessionTextBlock.vue` (final response), `SessionStepItem.vue` (todo), `SessionGateCard.vue` (gate). Tất cả nằm trong khối `.abody` của `SessionMessageItem.vue`.

### Ràng buộc AWOG bám suốt Nhóm A
- **Local-first / offline**: cả 5 issue thuần client-side UI, không phụ thuộc mạng → phải hoạt động offline.
- **SoC**: state + thứ tự tab thuộc store `sessions`; component chỉ present. Không `import fs`/SDK trong component.
- **Theme**: mọi màu qua `useTheme()` / CSS var (`var(--accent)`, `var(--border)`…), không hardcode hex.
- **i18n**: mọi label/tooltip/placeholder mới phải có key en/vi.
- **Persist**: preference UI dùng localStorage cùng lớp với `awog.sessions.*` hiện có (không tạo backend/DB mới).

---

## UI-1 — SessionTabBar: Search project khi "+" add tab

### Mô tả vấn đề
Nút `.stab-btn` (icon `plus`) mở dropdown `.stabs-drop` liệt kê `openableProjects` (project chưa mở thành tab + entry Default nếu có session chưa gán project). Hiện là danh sách phẳng, click để chọn. Khi số project lớn, người dùng phải cuộn `max-height: 60vh` để tìm → chậm. Cần một **input search nhanh theo tên project** ngay trong dropdown.

### Persona chịu tác động
- Người dùng có **nhiều project** (chục+) muốn mở tab một project cụ thể mà không phải cuộn/soi mắt.

### User flow chính
1. User click nút "+" → dropdown mở.
2. Input search **autofocus**, con trỏ sẵn sàng gõ.
3. User gõ vài ký tự → danh sách lọc realtime theo tên project (case-insensitive, substring).
4. User Enter (chọn item đang highlight) hoặc click item → mở tab project đó + đóng dropdown.
5. Esc → đóng dropdown (không mở tab nào).

### Cơ chế filter (đề xuất)
- Lọc trên `openableProjects` bằng `name.toLowerCase().includes(query.toLowerCase())`.
- Entry "Default" (`id === ''`) so khớp theo nhãn `t('sessions.defaultProject')`.
- Giữ nguyên thứ tự nguồn (`openableProjects` đã là projects-order). Có thể ưu tiên match ở đầu tên trước match giữa chuỗi (tùy TL, mức KISS: không cần rank ở MVP).

### Vị trí input + keyboard
- Input đặt **trên cùng** dropdown, sticky khi list cuộn.
- **Autofocus** khi dropdown mở (nextTick sau khi render).
- **Esc**: đóng dropdown, clear query.
- **Enter**: chọn item đang highlight (mặc định item đầu tiên trong danh sách đã lọc); nếu 0 kết quả → no-op.
- **ArrowUp/ArrowDown**: di chuyển highlight (đồng bộ pattern autocomplete của composer — tùy chọn, có thể để giai đoạn sau).
- Query reset mỗi lần đóng/mở lại dropdown (transient, không persist — nhất quán với `filter` transient của SessionList).

### Acceptance criteria (Given/When/Then)
- **AC1.1** — *Given* dropdown "+" đang đóng, *When* user click nút "+", *Then* dropdown mở và input search được autofocus.
- **AC1.2** — *Given* dropdown mở với N project openable, *When* user gõ chuỗi q, *Then* chỉ hiển thị project có tên chứa q (không phân biệt hoa/thường).
- **AC1.3** — *Given* danh sách đã lọc còn ≥1 item, *When* user nhấn Enter, *Then* mở tab item đang highlight và đóng dropdown.
- **AC1.4** — *Given* dropdown mở, *When* user nhấn Esc, *Then* dropdown đóng, không mở tab nào, query bị clear.
- **AC1.5** — *Given* query không khớp project nào, *Then* hiển thị empty state ("không có project khớp") — phân biệt với empty state "không còn project để mở" (`sessions.tabs.noProjects`).
- **AC1.6** — *Given* user chọn 1 project, *When* dropdown đóng rồi mở lại, *Then* input trống (query không sticky).

### Edge case
- **0 project openable** (mọi project đã mở): input vẫn hiển thị nhưng list rỗng → dùng `noProjects` sẵn có (không phải "không khớp").
- **Query khớp 0** khi vẫn còn project: empty state riêng "không khớp".
- **Tên project trùng nhau** (2 project cùng tên khác id): cả hai vẫn hiển thị; phân biệt bằng gì? → **Open question 1.a**.
- **Click ra ngoài**: backdrop `position:fixed; inset:0` hiện có phải đóng dropdown và clear query.
- **Số lượng project rất lớn (100+)**: filter O(n) mỗi keystroke chấp nhận được; nếu cần, cap hiển thị (ví dụ 50) + hint "gõ để thu hẹp" — YAGNI, chỉ làm khi thực đo chậm.
- **Phím Enter khi menu overflow cũng mở**: chỉ một menu mở tại một thời điểm (`toggleAdd` đã tắt overflow) → không xung đột.

### Dependency
- `useSessionTabs.openableProjects`, `store.setActiveTab` / `openTab`.
- i18n: thêm key `sessions.tabs.searchPlaceholder`, `sessions.tabs.noMatch`.

### Open questions (xem tổng hợp cuối tài liệu)
- **1.a** — Khi 2 project trùng tên trong danh sách lọc, có cần hiển thị thêm path/id để phân biệt không? (Đề xuất: hiển thị path rút gọn dưới tên khi trùng — quyết định lúc implement.)
- **1.b** — Có cần ArrowUp/Down + highlight ngay MVP, hay chỉ filter + click + Enter-chọn-item-đầu? (Đề xuất MVP: filter + Enter chọn item đầu; arrow nav để sau.)

### Ưu tiên / Effort
- **Ưu tiên: Cao** (rào cản dùng khi nhiều project). **Effort: S**.

---

## UI-2 — SessionTabBar: Kéo-thả sắp xếp thứ tự tab project

### Mô tả vấn đề
Thứ tự tab hiện cố định theo thứ tự thêm vào `store.openProjectTabs` (mảng string). Người dùng không thể sắp xếp lại. Cần **drag-and-drop** để đổi thứ tự tab project.

### Persona chịu tác động
- Người dùng làm việc nhiều project song song, muốn gom/ưu tiên tab theo thói quen.

### Nơi persist thứ tự
- Đã có sẵn: `store.openProjectTabs` (mảng) + persist localStorage `awog.sessions.tabs` (watch ghi). Reorder = **reassign lại mảng** `openProjectTabs` theo thứ tự mới → tự persist qua watch hiện có.
- Đây là **preference per-máy/per-user local**, không đồng bộ backend (nhất quán local-first). Cần bổ sung action mới trong store, ví dụ `reorderTabs(fromId, toIndex)` (SoC: logic reorder ở store, component chỉ phát sự kiện).

### Ràng buộc thứ tự đặc biệt
- Tab **Default** (`id === ''`) hiện có thể nằm bất kỳ đâu trong mảng. Cần quyết định: Default có được kéo không, hay luôn ghim đầu/cuối? → **Open question 2.a**.
- `closeTabsToRight` phụ thuộc vào **index trong mảng** → reorder phải cập nhật đúng thứ tự để "close right" hoạt động nhất quán sau khi kéo.

### Cơ chế kỹ thuật (đã chốt)
- **Dùng native pointer events** (`pointerdown` / `pointermove` / `pointerup` + `setPointerCapture`), **KHÔNG thêm thư viện DnD**, KHÔNG cần ADR dependency. Pattern này **nhất quán với `onResize` trong `SessionComposer`** (`apps/desktop/ui-next/components/session/SessionComposer.vue`, hàm `onResize` ~dòng 630) — đã dùng pointer capture + listener move/up trên window.
- Phân biệt **click vs drag** bằng ngưỡng di chuyển (threshold px): dưới ngưỡng = click (`setActiveTab`), vượt ngưỡng = bắt đầu drag reorder.

### Visual feedback (đề xuất)
- Trong khi kéo: tab được nhấc có opacity giảm / nền nhạt; vị trí thả hiển thị **insertion indicator** (đường accent mảnh giữa 2 tab, dùng `var(--accent)`).
- Kéo cả tab (drag toàn bộ `.stab`) — **không** cần drag handle riêng (tab nhỏ, thêm handle làm rối).
- Reduced-motion: bỏ animation, giữ insertion indicator tĩnh.

### Tương tác với hành vi hiện có
- **Active tab** khi bị kéo: giữ nguyên active (kéo chỉ đổi vị trí, không đổi selection).
- **Thêm tab mới** ("+"): append cuối như hiện tại; user có thể kéo lại sau.
- **Đóng tab** trong lúc kéo: không cho phép (drag đang giữ pointer). Sau khi thả, đóng bình thường.
- **Keyboard reorder** (a11y): **để sau MVP** — Arrow hiện đang dùng để chuyển selection (roving tabindex), không trùng chord được.
- **Menu context / overflow** đang mở khi bắt đầu kéo → nên đóng.

### Acceptance criteria
- **AC2.1** — *Given* ≥2 tab project, *When* user kéo tab A thả vào giữa tab B và C, *Then* thứ tự `openProjectTabs` đổi tương ứng và render lại đúng.
- **AC2.2** — *Given* user vừa reorder, *When* app khởi động lại (reload), *Then* thứ tự tab được khôi phục từ localStorage.
- **AC2.3** — *Given* user chỉ click (không vượt ngưỡng kéo), *Then* hành vi cũ giữ nguyên: `setActiveTab`.
- **AC2.4** — *Given* đang kéo, *Then* có insertion indicator hiển thị vị trí thả.
- **AC2.5** — *Given* reorder xong, *When* user dùng "Close tabs to the right" trên một tab, *Then* các tab đóng đúng theo thứ tự MỚI.
- **AC2.6** — *Given* tab đang active bị kéo đổi chỗ, *Then* nó vẫn là tab active sau khi thả.
- **AC2.7** — *Given* kéo tab tới sát mép trái/phải của strip (khi strip overflow), *Then* strip **auto-scroll** theo hướng đó để tiếp tục kéo.

### Edge case
- **Kéo tab Default** (nếu cho phép): xử lý theo quyết định 2.a.
- **Kéo rồi thả về đúng vị trí cũ**: no-op, không phát action thừa (tránh ghi localStorage vô ích).
- **1 tab duy nhất**: không có gì để reorder → drag vô hiệu.
- **Overflow scroll** (`overflow-x:auto`): auto-scroll khi pointer gần mép — trong phạm vi (AC2.7).
- **Live update trong lúc kéo**: một session mới xuất hiện ở project khác không được làm nhảy vị trí đang kéo (openProjectTabs không đổi do event session, chỉ `unread`/`running` đổi → an toàn).
- **Concurrent**: reorder là thao tác cục bộ 1 cửa sổ; nếu có nhiều cửa sổ Electron chia sẻ localStorage → không đồng bộ realtime (chấp nhận, ngoài scope).

### Dependency
- Store `sessions`: thêm action `reorderTabs`. Ràng buộc với `openProjectTabs`, `closeTabsToRight` (index-based).
- DnD: **native pointer events**, không dependency, không ADR (đã chốt).

### Open questions (xem tổng hợp cuối tài liệu)
- **2.a** — Tab Default có được kéo không / có bị ghim vị trí không? → *quyết định lúc implement* (đề xuất mặc định: Default kéo được như tab thường; nếu muốn đơn giản có thể ghim đầu).
- **2.b** *(đã chốt)* — Keyboard reorder (a11y): **để sau MVP**.
- **2.c** *(đã chốt)* — Auto-scroll strip khi kéo tới mép: **có** trong phạm vi (AC2.7).

### Ưu tiên / Effort
- **Ưu tiên: Trung bình** (tiện lợi, không chặn workflow). **Effort: M** (native pointer DnD + insertion indicator + phân biệt click/drag + auto-scroll mép).

---

## UI-3 — SessionMessageItem: Toàn màn hình TOÀN BỘ assistant turn

### Đính chính phát hiện trước (spec cũ đánh giá SAI)
Rà lại `SessionMessageItem.vue` kỹ hơn:
- Nút "maximize" hiện tại gọi `openFullscreen()` (dòng ~422-430) chỉ truyền **`plainText.value`** vào `PreviewModal` dưới dạng `kind: 'markdown'`.
- `plainText` (dòng ~381-391) **CỐ Ý** chỉ lấy **final response text** (câu trả lời cuối). Comment ghi rõ: *"must NOT leak intermediate commentary/activities into fullscreen/copy"*.
- ⇒ Fullscreen hiện tại **CHỈ** hiển thị câu trả lời cuối (markdown thô), **KHÔNG** bao gồm activities (tools / thinking / sub-agents), block trung gian, gates.

Kết luận đúng: **cái đang có ≠ cái user muốn.** Đây là hai tính năng khác nhau, và **quyết định là GIỮ CẢ HAI** (xem 3.b đã chốt):

| | Fullscreen câu trả lời (HIỆN CÓ — GIỮ NGUYÊN) | Fullscreen toàn bộ turn (YÊU CẦU MỚI — THÊM) |
|---|---|---|
| Nội dung | Chỉ final response (`plainText`) | **Toàn bộ `.abody`**: activities + mọi block trung gian + gates + final response |
| Cơ chế | Nhét text vào `PreviewModal` (viewer markdown), `openFullscreen` hiện có | Overlay render lại **cây component** của cả assistant turn |
| Cập nhật realtime | Không (chỉ khi turn xong) | **Có** — cập nhật theo delta khi đang stream |
| Nút trong `msgActions` | icon `maximize`, tooltip "Toàn màn hình câu trả lời" | icon riêng, tooltip "Toàn màn hình toàn bộ phản hồi" |

### Mô tả vấn đề (yêu cầu mới)
Cần một chế độ **toàn màn hình cho CẢ assistant turn**, hiển thị đúng như nó render trong transcript: `SessionTurnActivities` (tools, thinking, sub-agents), các block trung gian, `SessionGateCard`, `SessionStepItem` (todo) **và** final response (`SessionTextBlock`). Đây không phải nhét text vào `PreviewModal` mà là overlay fullscreen render lại khối `.abody`. **Tính năng này bổ sung, KHÔNG thay** nút fullscreen câu trả lời hiện có.

### Persona chịu tác động
- Người dùng đọc một **turn phức tạp** (nhiều tool call, thinking, sub-agent, response dài), muốn phóng to toàn màn hình để theo dõi trọn vẹn quá trình + câu trả lời mà không bị chật trong cột transcript.

### Cách tiếp cận (phân tích cho TL/developer)
- **Overlay riêng** (KHÔNG tái dùng `PreviewModal` — modal đó chỉ nhận `text`/`src`, không render cây component turn). Dùng **`Teleport to body`** để thoát mọi stacking-context / overflow của transcript (giống PreviewModal).
- Bên trong overlay render lại **cùng cây component** dựa trên `grouped` (computed đã có trong `SessionMessageItem`): tái dùng `SessionTurnActivities` / `SessionTextBlock` / `SessionStepItem` / `SessionGateCard` — **không** duplicate logic grouping (DRY: dùng chung `grouped`).
- **Realtime khi streaming**: overlay bind trực tiếp vào `props.message` (reactive) → khi delta tới, `grouped` re-run và overlay tự cập nhật. Không snapshot cứng nội dung lúc mở.
- **Trigger (2 nút, đã chốt 3.b)**: **giữ nút fullscreen-response cũ** (`openFullscreen` → PreviewModal, icon `maximize`) **và THÊM nút mới fullscreen-turn** trong cùng footer action row (`msgActions`, template dòng ~131-135; thêm entry vào computed `msgActions` dòng ~434-446). Hai nút icon + tooltip phân biệt rõ: "Toàn màn hình câu trả lời" (cũ) vs "Toàn màn hình toàn bộ phản hồi" (mới).
- **Đóng**: nút `x` trong header overlay **và phím Esc**. Click nền ngoài card cũng đóng (giống PreviewModal `@click.self`).
- **Scroll**: overlay có vùng cuộn nội bộ; khi streaming, cân nhắc auto-scroll xuống đáy theo delta (giống transcript) — nhưng nếu user đã cuộn lên đọc thì không giật xuống → **Open question 3.c**.
- **Collapsed/expanded state của activities**: `SessionTurnActivities` tự giữ state collapse. Quyết định: trong fullscreen **expand hết** (để đọc trọn) hay **giữ nguyên state như transcript**? → **Open question 3.a**.

### User flow chính
1. Một assistant turn (đang stream hoặc đã xong) — footer action row có **cả hai** nút fullscreen (câu trả lời + toàn bộ phản hồi).
2. User click nút "fullscreen turn" (toàn bộ phản hồi).
3. Overlay mở toàn cửa sổ, render lại toàn bộ `.abody`: activities + trung gian + gates + final response.
4. Nếu đang stream: nội dung overlay **cập nhật realtime** theo delta.
5. User đọc / cuộn.
6. User đóng bằng nút `x`, phím Esc, hoặc click nền ngoài → về transcript, vị trí cuộn transcript giữ nguyên.

### Acceptance criteria
- **AC3.1** — *Given* một assistant turn, *When* user click nút fullscreen-turn (toàn bộ phản hồi), *Then* overlay mở render **toàn bộ `.abody`** (activities + block trung gian + gates + final response), khớp với transcript.
- **AC3.2** — *Given* turn đang **streaming**, *When* user mở fullscreen-turn, *Then* nội dung overlay **cập nhật realtime** theo delta (block/activity mới xuất hiện trong overlay khi chúng tới).
- **AC3.3** — *Given* overlay đang mở, *When* user nhấn Esc, *Then* overlay đóng.
- **AC3.4** — *Given* overlay đang mở, *When* user click nền ngoài card, *Then* overlay đóng.
- **AC3.5** — *Given* overlay đóng, *Then* transcript giữ nguyên vị trí cuộn trước khi mở.
- **AC3.6** — *Given* overlay mở, *Then* các component con (activities/gate/text) render đúng như transcript (không mất highlight §8, không vỡ layout).
- **AC3.7** — *Given* turn stream xong trong khi overlay đang mở, *Then* overlay chuyển sang trạng thái hoàn tất (final response + activities đầy đủ) không cần đóng/mở lại.
- **AC3.8** *(đã chốt 3.b)* — *Given* một assistant turn có final response, *Then* footer action row hiển thị **CẢ HAI** nút fullscreen: nút "câu trả lời" (cũ, `openFullscreen` → PreviewModal) và nút "toàn bộ phản hồi" (mới, overlay turn), icon + tooltip phân biệt rõ; nút câu trả lời cũ **giữ nguyên hành vi** (chỉ final response text).
- **AC3.9** *(đã chốt 3.b)* — *Given* một assistant turn **tool-only** (không có final response), *Then* nút "câu trả lời" cũ vẫn ẩn (không có prose), nhưng nút "toàn bộ phản hồi" mới **vẫn hiển thị** (bao trùm activities + gates).

### Edge case
- **Turn tool-only (không có final response)**: nút "toàn bộ phản hồi" mới vẫn fullscreen được — hiển thị activities + gates (khác nút "câu trả lời" cũ vốn ẩn khi không có prose) — xem AC3.9.
- **Turn rỗng lúc mới bắt đầu stream** (chưa có block nào): overlay mở vẫn OK, hiển thị trạng thái đang xử lý; block xuất hiện dần.
- **Gate đang chờ** (question/permission pending) trong turn: hiển thị `SessionGateCard`; **tương tác gate trong fullscreen** (trả lời question / approve permission) có cho phép không? → **Open question 3.d**. Đề xuất MVP: read-only trong overlay, thao tác gate làm ở transcript.
- **Turn rất dài** (nhiều tool call): overlay cuộn nội bộ.
- **Esc trùng lớp khác**: overlay là lớp trên cùng khi mở → Esc ưu tiên đóng overlay.
- **Hai nút cùng tồn tại**: cần rõ ràng nút nào làm gì qua icon + tooltip (AC3.8); mở nút này không ảnh hưởng nút kia.
- **Reduced-motion**: overlay không animation nặng.
- **Unmount khi turn bị xóa/rewind/fork** trong lúc overlay mở: overlay phải tự đóng an toàn (message không còn) — tránh render lỗi.

### Dependency
- Overlay mới (component riêng, ví dụ `SessionTurnFullscreen.vue`) + state mở/đóng (local ref trong `SessionMessageItem` hoặc một composable dùng chung nếu cần mount 1 instance ở `SessionDetail` — cân nhắc SoC như `usePreview`).
- Tái dùng: `grouped`, `SessionTurnActivities`, `SessionTextBlock`, `SessionStepItem`, `SessionGateCard`.
- **Giữ** `openFullscreen` + `usePreview` hiện có (nút câu trả lời cũ) — không gỡ.
- i18n: key `sessions.message.fullscreenTurn` (tooltip nút mới "toàn bộ phản hồi"); nút cũ giữ key `sessions.message.fullscreen` hiện có.
- Không thêm dependency.

### Open questions (xem tổng hợp cuối tài liệu)
- **3.a** — Trong fullscreen: activities **expand hết** hay **giữ nguyên state collapse** như transcript? (Đề xuất: giữ nguyên state để nhất quán; hoặc thêm nút "expand all". Quyết định lúc implement.)
- **3.b** *(đã chốt)* — **GIỮ CẢ HAI** nút: fullscreen-response cũ (câu trả lời) + fullscreen-turn mới (toàn bộ phản hồi). Hai nút riêng biệt, icon + tooltip phân biệt; **không bỏ nút cũ**.
- **3.c** — Khi streaming: overlay có auto-scroll theo delta không, và ứng xử khi user đã cuộn lên? (Quyết định lúc implement — đề xuất: auto-scroll xuống đáy nếu user đang ở đáy, dừng nếu user đã cuộn lên.)
- **3.d** — Trong fullscreen có cho tương tác gate (trả lời question / approve) không? (Quyết định lúc implement — đề xuất MVP: read-only.)

### Ưu tiên / Effort
- **Ưu tiên: Trung bình**. **Effort: M** (overlay render lại cây component + realtime streaming + Esc/close + 2 nút trong action row + edge case unmount) — **tăng so với đánh giá S sai trước đó** vì không phải chỉ nhét text vào modal có sẵn.

---

## UI-4 — SessionComposer: Giới hạn max-height + manual resize > auto-grow

### Mô tả vấn đề (root cause)
Composer có 2 cơ chế chiều cao đang **xung đột**:
- **Auto-grow** `grow()` (dòng ~624): set `height = clamp(composerH, min(scrollHeight, 640))`. Auto cao theo nội dung tới trần 640px, sàn = `composerH` (giá trị kéo handle).
- **Manual resize** `onResize` (dòng ~630): handle `.cresize` kéo lên → tăng `composerH` trong `[40, 560]`, rồi gọi `grow()`.
- **CSS** `textarea.ci { max-height: 40vh }` (dòng ~1428) giới hạn chiều cao CSS + cuộn nội bộ.

**Root cause**: `grow()` set `height = max(composerH, min(scrollHeight, 640))`. Khi nội dung dài, `min(scrollHeight, 640) = 640 > composerH` → chiều cao **luôn bị auto-grow ép lên**, **bỏ qua** giá trị nhỏ mà user vừa kéo xuống. Mỗi lần gõ (`onInput` → `grow()`) lại ghi đè → **kéo tay thu nhỏ không có tác dụng**. Ngoài ra trần JS (640/560) và CSS (40vh) **không đồng bộ** → nhập nhằng giới hạn thật.

### Quyết định (đã chốt): Phương án B — Manual override thắng auto-grow
- Thêm cờ `userSizedManually` (bool). Khi user kéo handle → set `composerH` = chiều cao mong muốn **và** bật cờ manual.
- `grow()`:
  - Nếu `userSizedManually === true` → **giữ đúng `composerH`** (chỉ clamp `[MIN, MAX]`), cho phép **cuộn nội bộ** dù content dài hơn. Auto-grow **KHÔNG** ghi đè.
  - Nếu `userSizedManually === false` → auto-grow bình thường: `clamp(MIN, scrollHeight, MAX)`.
- **Reset cờ manual về false** khi: **gửi message / clear draft** (input về min-height, quay lại chế độ auto). Xem 4.b cho trường hợp seed draft.

### Giá trị min/max (đã chốt hướng)
- **min-height**: 40px (1 dòng, khớp hằng `40` hiện có).
- **max-height**: **40vh** — **một nguồn duy nhất** (DRY). Bỏ các hằng rời rạc 640/560; JS clamp và CSS `max-height` phải cùng tham chiếu giá trị này.
- Content > max → `overflow-y: auto` trong textarea (cuộn nội bộ).

### Persist chiều cao (đề xuất)
- **Đề xuất: KHÔNG persist** ở MVP (YAGNI). `composerH` reset về min sau khi gửi; cờ manual về false. Đơn giản, không thêm localStorage key.
- Nếu sau này user phản hồi muốn nhớ chiều cao → có thể thêm key `awog.sessions.composerHeight` (global). Ghi nhận ở 4.a nhưng **không làm ngay**.

### Acceptance criteria
- **AC4.1** — *Given* user nhập nội dung dài mà **chưa** kéo tay, *Then* input auto-grow tối đa tới max-height (40vh) rồi **cuộn bên trong**, KHÔNG cao thêm, KHÔNG đẩy toolbar/Send ra ngoài màn hình.
- **AC4.2** — *Given* input đang cao do nội dung dài, *When* user kéo handle **xuống**, *Then* input thu nhỏ theo và **giữ** ở chiều cao đó; nội dung dài cuộn nội bộ.
- **AC4.3** — *Given* user **đã kéo tay** đặt chiều cao, *When* user gõ thêm nội dung, *Then* auto-grow **KHÔNG** ghi đè để phình lại vượt chiều cao user đặt (manual > auto).
- **AC4.4** — *Given* user kéo handle xuống hết cỡ, *Then* không nhỏ hơn min-height (40px, ~1 dòng).
- **AC4.5** — *Given* trần JS và CSS, *Then* **cùng một** giá trị max-height (40vh); không còn 640/560 mâu thuẫn.
- **AC4.6** — *Given* user gửi message (hoặc clear draft), *Then* input reset về min-height và cờ manual về false (quay lại auto-grow cho draft kế tiếp).

### Edge case
- **Paste lớn dưới ngưỡng paste-as-file** (chèn inline): nếu manual đang bật → giữ chiều cao manual + cuộn; nếu auto → grow tới max rồi cuộn.
- **Seed draft** (quote/edit/welcome — `watch(store.draftSeed)` gọi `grow()`): xem 4.b (đề xuất: seed reset về auto để hiển thị đủ nội dung seed).
- **Resize cửa sổ**: `40vh` co theo viewport (CSS tự co); nhưng `composerH` là px cố định trong JS → khi thu nhỏ cửa sổ, cần **re-clamp `composerH` theo max mới** để input không che toolbar. → thêm listener `window resize` re-clamp (trong phạm vi, xem 4.c).
- **Follow-up quotes + queued chips + budget banner** phía trên input cũng chiếm chiều cao trong `.cbox`; max-height chỉ áp cho **textarea**. Các khối kia đã tự cap (`.sfollow.scroll` 210px…) — rà tổng `.cbox` không đẩy transcript quá mức.
- **Reduced-motion**: resize không animate (đã ok).

### Dependency
- Chỉ `SessionComposer.vue` (grow / onResize / CSS + cờ manual + listener resize). Không đụng store.
- i18n: tooltip handle đã có (`sessions.composer.resize`).

### Open questions (xem tổng hợp cuối tài liệu)
- **4.a** *(đề xuất: không làm ngay)* — Persist chiều cao input? MVP: **không persist**. Có thể thêm sau (global key) nếu user yêu cầu.
- **4.b** — Khi **seed draft**, reset cờ manual về auto (auto-grow hiển thị đủ seed) hay tôn trọng chiều cao manual? (Đề xuất: reset về auto khi seed; reset về auto sau khi gửi. Quyết định lúc implement.)
- **4.c** — Chốt max = `40vh`; cần listener `window resize` để re-clamp `composerH` theo max mới (trong phạm vi).

### Ưu tiên / Effort
- **Ưu tiên: Cao** (bug cảm nhận rõ, ảnh hưởng thao tác nhập hằng ngày). **Effort: S–M** (cờ manual + đồng bộ max 40vh JS↔CSS + re-clamp khi resize; không persist nên gọn hơn).

---

## UI-5 — SessionList: Hiển thị nhiều session hơn (PHÂN TRANG)

### Mô tả vấn đề (hiện trạng)
`SessionList.vue` hiện dùng render-window incremental:
- **Flat (`groupBy='none'`)**: `useLoadMore` render 60 row đầu, `LoadMoreSentinel auto` → infinite scroll (IntersectionObserver).
- **Grouped**: mỗi group render 5 row (`GROUP_PAGE_SIZE`), nút "load more" thủ công.
- Search theo `title` (substring, case-insensitive); sort updated/created/title (pinned-first, persist localStorage); `reset()` khi đổi filter/group/sort/tab.

Người dùng cảm thấy "chỉ hiển thị giới hạn session" (do grouped 5 row/group + phụ thuộc infinite scroll).

### Quyết định (đã chốt): dùng PAGINATION (phân trang) — PER-GROUP
Thay cơ chế hiển thị hiện tại bằng **phân trang có điều khiển trang** — **KHÔNG** virtual-scroll, **KHÔNG** infinite-scroll.

- **Điều khiển trang**: prev/next (và/hoặc chỉ số trang "trang X / Y").
- **Page size (đã chốt)**: **20 session/trang**. Đây là giá trị đã chốt cuối; đủ để đọc lướt mà DOM không quá lớn.
- **Cách phân trang (đã chốt 5.a): PHÂN TRANG THEO TỪNG GROUP (per-group)** — **KHÔNG** phẳng toàn bộ.
  - **Flat (`groupBy='none'`)**: cả danh sách là một "group" duy nhất → một bộ điều khiển trang, page size 20 (phân trang trực tiếp trên `filtered` phẳng đã sort pinned-first).
  - **Grouped**: **mỗi project/group có bộ điều khiển phân trang RIÊNG**, page size 20 áp dụng cho **từng group độc lập**. Mỗi group giữ **state trang riêng** (page index per group key). Control trang của group đặt ở đáy khối group đó (thay cho nút "load more" per-group hiện có). Group header count phản ánh **tổng số item của group** (không phải theo trang).
- **Reset trang về 1 (mọi group)** khi đổi search / sort / group / tab (mở rộng watch `reset()` hiện có sang state trang per-group). *(SoC: state trang per-group nên keyed by group key, kiểu `useGroupLoadMore` hiện tại — reset = clear map.)*

### Phương án loại trừ (chỉ ghi lý do, KHÔNG chọn)
| Phương án | Vì sao KHÔNG chọn |
|---|---|
| **Infinite scroll** (đang có ở flat) | User muốn kiểm soát trang rõ ràng; loại theo quyết định. |
| **Virtual scroll** | Phức tạp (đo chiều cao, group header, rename inline, ctx menu), có thể cần dependency + ADR; loại theo quyết định. |
| **Phân trang phẳng toàn bộ** (group chỉ nhóm trong trang) | User chốt phân trang **per-group** để kiểm soát từng project độc lập; loại theo quyết định 5.a. |

### Persona chịu tác động
- Người dùng có **lịch sử session dài** trong một project, muốn xem theo trang có kiểm soát cho **từng project/group** (biết mỗi group đang ở trang mấy / tổng bao nhiêu).

### User flow chính
1. User mở tab project có nhiều session.
2. **Flat**: danh sách hiển thị trang 1 (20 session) + control trang ở đáy list.
3. **Grouped**: mỗi group hiển thị trang 1 (20 session của group đó) + control trang RIÊNG ở đáy group.
4. User bấm next/prev trên group nào thì chỉ group đó đổi trang (các group khác giữ nguyên trang).
5. Đổi search/sort/group/tab → mọi group về trang 1.

### Acceptance criteria
- **AC5.1** — *Given* flat mode, project có > 20 session, *Then* danh sách hiển thị đúng một trang (20 session) + control trang (prev/next hoặc số trang) + tổng số trang.
- **AC5.2** — *Given* đang ở trang i (của một group hoặc flat), *When* user bấm next, *Then* hiển thị trang i+1 (chặn vượt trang cuối); bấm prev → i-1 (chặn dưới trang 1).
- **AC5.3** — *Given* user đổi search / sort / group / tab, *Then* mọi group + flat reset về trang 1.
- **AC5.4** — *Given* danh sách một trang (group hoặc flat), *Then* chỉ render session của trang hiện tại (DOM nhỏ, không render toàn bộ).
- **AC5.5** — *Given* bulk-select / select-all, *Then* thao tác trên **toàn bộ filtered** (mọi trang, mọi group), không chỉ trang đang hiển thị. *(Giữ đúng hành vi hiện tại — cần làm rõ trong UI: "select all" chọn toàn bộ filtered hay chỉ trang này → xem 5.b.)*
- **AC5.6** — *Given* search khớp 0, *Then* empty state `sessions.list.noMatch` (không hiện control trang).
- **AC5.7** *(đã chốt 5.a)* — *Given* grouped mode, *Then* **mỗi group có control trang RIÊNG** (page size 20/group), state trang độc lập giữa các group; bấm next/prev trên một group không đổi trang group khác; group header count = tổng item của group (không mất session, không đếm trang sai).

### Edge case
- **Session mới xuất hiện live** (streaming tạo session): KHÔNG được reset trang đang xem (của bất kỳ group nào); chỉ cập nhật tổng số trang của group tương ứng nếu cần. (Giữ tinh thần comment code cũ: append live không reset window.)
- **Xóa session làm giảm số trang của một group**: nếu group đó đang ở trang cuối vừa bị rỗng → tự lùi group đó về trang hợp lệ cuối cùng (clamp per-group).
- **Pinned session**: luôn nổi đầu `filtered` → nằm ở trang 1 của group chứa nó (nhất quán sort pinned-first).
- **Grouped + phân trang per-group**: group header + count phản ánh **tổng số item của group** (không theo trang); control trang chỉ chi phối phần hiển thị bên trong group.
- **Fold-all / collapse group**: group collapse ẩn cả body (bao gồm control trang) — state trang của group vẫn giữ, mở lại thấy đúng trang cũ.
- **Rename inline / ctx menu**: chỉ tác động item trong trang hiển thị — ok.

### Dependency
- Thay/điều chỉnh cơ chế hiển thị trong `SessionList.vue` bằng logic phân trang **per-group** (page index keyed by group key + page size). Có thể tạo composable mới `usePagination`/`useGroupPagination` **HOẶC** dùng `computed` + reactive map keyed by group key ngay trong SessionList (nhất quán pattern `useGroupLoadMore` — state per key + reset clear map).
- **Chỉ đổi trong `SessionList.vue`** — KHÔNG sửa `composables/useLoadMore.ts`/`useGroupLoadMore`/`LoadMoreSentinel.vue` (đang dùng ở library và nơi khác). Nếu tạo composable phân trang mới thì đặt file riêng, không đụng file cũ.
- Hằng page size mới: `SESSIONS_PAGE_SIZE = 20` *(đã chốt)* — áp cho cả flat và từng group.
- Gỡ bỏ `LoadMoreSentinel auto` (infinite) ở flat + nút "load more" per-group **trong SessionList** (thay bằng control trang, per-group cho grouped) — **cần TL xác nhận** phạm vi gỡ chỉ ở SessionList.
- i18n: key control trang (`sessions.list.pagePrev`, `sessions.list.pageNext`, `sessions.list.pageOf`).

### Open questions (xem tổng hợp cuối tài liệu)
- **5.a** *(đã chốt)* — Grouped mode: **phân trang theo TỪNG group** (per-group), page size 20/group, mỗi group state trang riêng, reset khi filter đổi. Group header count = tổng item của group. **KHÔNG** phân trang phẳng toàn bộ.
- **5.b** — "Select all" trong select-mode: chọn **toàn bộ filtered (mọi trang, mọi group)** hay **chỉ trang hiện tại**? (Đề xuất: giữ toàn bộ filtered như hiện tại; UI nói rõ. Quyết định lúc implement.)
- **5.c** *(page size đã chốt = 20)* — Kiểu control còn để chốt khi implement: prev/next đơn giản, hay số trang + jump? (Đề xuất: prev/next + "trang X / Y".)

### Ưu tiên / Effort
- **Ưu tiên: Trung bình**. **Effort: M** (thay cơ chế hiển thị hiện có bằng phân trang per-group + state trang keyed by group key + reset/clamp trang + i18n control).

---

# NHÓM B — Annotation trên SessionDetail (AN-1..AN-3)

## Bối cảnh & hiện trạng (Nhóm B)

> **Phạm vi:** `apps/desktop/ui-next/components/session/SessionDetail.vue` — luồng selection-to-quote (bôi đen text → nút Quote nổi → note popover → lưu thành follow-up có ghi chú).

Trong khung chat của Session, user có thể bôi đen (highlight) một đoạn text bên trong một message để "trích dẫn + ghi chú". Luồng hiện tại:

1. User bôi đen text trong `.chat` → sự kiện `@mouseup="onSelectQuote"`.
2. `onSelectQuote()` lấy `window.getSelection()`, kiểm tra selection thuộc một message (`closest('[data-mi]')`), tính rect và set `quoteSel = { text, src, x, y }` với `x = rect.left + rect.width/2`, `y = rect.top - 8`.
3. Nút nổi `.selquote` (`position: fixed`, `transform: translate(-50%, -100%)`) hiện ở đỉnh-giữa vùng chọn.
4. Click nút → `openNote()` copy `quoteSel` sang `notePop`, xoá `noteText`, ẩn nút.
5. `.notepop` (`position: fixed`, width cố định `280px`, có backdrop `.notebackdrop`) hiện tại cùng toạ độ; user gõ ghi chú vào `<textarea.npinput>`.
6. Enter (hoặc Cmd/Ctrl+Enter) hoặc nút Save → `saveQuote()` gọi `store.addQuote(...)`, xoá selection, đóng popover.
7. `.chat` còn `@mousedown="quoteSel = null"` — mọi mousedown trong khung chat xoá nút Quote đang hiện.

**3 điểm ma sát UX** được yêu cầu phân tích: (AN-1) thiếu auto-focus vào textarea khi mở popover, (AN-2) popover không kéo-thả/resize được, (AN-3) không có cách hiện nút Quote tại vị trí con trỏ (right-click).

### Persona chịu tác động (Nhóm B)
- **Người dùng cuối (operator)** — người review transcript, trích dẫn đoạn AI/người dùng đã nói để hỏi lại / ghi chú. Đây là persona chính của cả 3 issue.

### User flow chính (sau cải thiện)

```
Bôi đen text trong message
   ├─ (giữ) mouseup → nút Quote nổi ở đỉnh vùng chọn
   └─ (mới AN-3) right-click trên vùng chọn → nút Quote nổi ngay tại con trỏ
        │
        ▼ click nút Quote
   Note popover mở
        ├─ (mới AN-1) con trỏ tự nằm trong textarea, gõ được ngay
        ├─ (mới AN-2) kéo header để di chuyển popover tới chỗ dễ nhìn
        ├─ (mới AN-2) kéo góc/cạnh để resize xem nhiều nội dung hơn
        └─ gõ ghi chú → Enter/Save → lưu thành follow-up (highlight tại chỗ)
```

---

## AN-1 — Auto-focus textarea khi mở note popover

### Vấn đề
`<textarea.npinput>` đang khai báo thuộc tính HTML `autofocus` (dòng 273). Tuy nhiên `autofocus` **chỉ có hiệu lực khi element hiện diện trong DOM lúc trang load lần đầu**. Vì `.notepop` được chèn động qua `v-if="notePop"` (mount sau khi user click nút Quote), attribute `autofocus` **không kích hoạt**. Hệ quả: popover mở ra nhưng con trỏ chưa nằm trong textarea → user phải click thủ công một lần nữa rồi mới gõ được ghi chú. Đây là 1 click thừa trên một thao tác lẽ ra phải liền mạch.

### Giải pháp đề xuất (mô tả hành vi, không code)
- Sau khi `notePop` được set và popover mount, chủ động focus vào textarea (pattern chuẩn Vue: `nextTick` + `template ref` → gọi `.focus()`; hoặc một directive `v-focus` dùng lại được). Gỡ attribute `autofocus` vì không có tác dụng và gây hiểu lầm.
- Đặt con trỏ ở **cuối** nội dung textarea (khi mở lại vào ghi chú đang có).

### Acceptance criteria
- **AC-A1** — *Given* user đã bôi đen text hợp lệ và nút Quote đang hiện, *When* user click nút Quote (mở popover), *Then* con trỏ nhập liệu (caret) tự động nằm trong `<textarea>` và user gõ được ngay mà không cần click thêm.
- **AC-A2** — *Given* popover đã đóng và mở lại (cho một selection khác), *When* popover mount lần thứ hai/thứ ba…, *Then* auto-focus vẫn hoạt động mỗi lần mở (không chỉ lần đầu).
- **AC-A3** — *Given* textarea đã có sẵn nội dung ghi chú (nếu về sau cho phép mở lại note cũ), *When* popover mở, *Then* caret đặt ở cuối text, không bôi đen toàn bộ và không xoá nội dung.
- **AC-A4** — *Given* popover vừa mở và textarea được focus, *When* user nhấn Esc, *Then* popover đóng (`notePop = null`) — hành vi Esc hiện có không bị auto-focus phá vỡ.

### Edge case
- Popover mở → đóng → mở nhiều lần liên tiếp: mỗi lần phải focus lại (không được rely vào lần mount đầu).
- Reduced-motion / theme khác nhau: focus không phụ thuộc animation.
- Nếu user right-click (AN-3) làm mất selection của browser: vẫn phải focus được vì textarea là input riêng, không phụ thuộc selection gốc.
- Trap focus không bắt buộc ở MVP; chỉ cần focus khởi tạo. (Xem Open question OQ-A1.)

### UI behavior
- Không thay đổi hình thức popover. Chỉ khác: caret nhấp nháy trong textarea ngay khi mở.

### Dependency
- Không đụng entity/store. Thuần render/DOM trong `SessionDetail.vue`.

### Ưu tiên / Effort / Owner
- **Ưu tiên: Cao** (quick win, ảnh hưởng mọi lần dùng feature). **Effort: S.** **Owner: developer (frontend).**

---

## AN-2 — Kéo-thả di chuyển + resize note popover

### Vấn đề
`.notepop` neo cứng theo toạ độ vùng chọn (`fixed`, `transform: translate(-50%, -100%)`, width `280px`). Với đoạn trích dài hoặc ghi chú dài, popover có thể: (1) rơi vào mép/ngoài viewport khó bấm, (2) che chính đoạn text gốc user đang muốn tham chiếu, (3) quá hẹp để đọc trích dẫn dài (`.npex` giới hạn `max-height: 8em` + scroll). User cần chủ động **di chuyển** popover tới chỗ trống và **resize** để xem nhiều nội dung hơn.

### Giải pháp đề xuất (mô tả hành vi, không code)
Tái dùng **pattern native pointer** đã có sẵn trong file: `onWpResize` (dòng ~800) dùng `pointerdown` → `setPointerCapture(pointerId)` → lắng nghe `pointermove`/`pointerup` trên chính handle, clamp bằng `Math.max/min`. Áp dụng tương tự cho drag-move và resize của popover.

**Drag-handle (di chuyển):**
- Vùng kéo = **header `.npq`** (dòng chứa icon quote + đoạn trích `.npex`). Lý do: header là vùng "không tương tác nhập liệu" tự nhiên, không xung đột với việc select text trong textarea, phù hợp Least Astonishment.
- KHÔNG dùng toàn bộ popover làm drag-handle: sẽ xung đột với thao tác bôi đen/di chuột trong textarea.
- Con trỏ trên header đổi thành `grab`/`grabbing` để gợi ý kéo được.
- Khi kéo: cập nhật toạ độ popover; giữ nguyên `noteText` (không remount textarea, không mất nội dung đang gõ).

**Resize:**
- Cho phép resize qua **cạnh/góc** (đề xuất tối thiểu: góc dưới-phải, hoặc dùng luôn `resize` CSS native của container nếu khả thi — nhưng textarea đã có `resize: vertical` riêng, nên resize popover cần handle riêng để tránh nhầm).
- Clamp min/max: đề xuất `width` min ~240px, max ~min(560px, viewport width - margin); `height` min ~160px, max ~viewport height - margin. (Con số cụ thể → Tech Lead chốt; tham chiếu `WP_SIDE = {min:240,max:560}`.)
- Khi popover được kéo/resize thủ công, bỏ `transform: translate(-50%, -100%)` (chuyển sang neo theo góc trên-trái để toạ độ drag khớp trực giác).

**Clamp trong viewport:**
- Khi kéo, clamp `x/y` sao cho popover không ra ngoài viewport (giữ tối thiểu một phần header + toàn bộ nằm trong màn hình). Tránh mất popover ngoài mép.

**Tương tác với backdrop (chống đóng nhầm khi kéo):**
- Hiện `.notebackdrop` có `@mousedown="notePop = null"` → click ra ngoài đóng popover. Khi kéo bằng pointer trên header, pointer capture đảm bảo `pointermove/up` bắn trên header chứ không phải backdrop → **kéo không vô tình đóng**. Cần đảm bảo `mousedown` trên header không bubble lên backdrop gây đóng (header nằm trong `.notepop`, không phải backdrop — nhưng cần chặn để mousedown trên popover không lọt ra ngoài đóng nhầm).

**Persist vị trí/size:**
- **Đề xuất KHÔNG persist ở MVP.** Vị trí/size **reset về mặc định (neo theo selection, width 280px) mỗi lần mở popover mới**. Lý do: KISS/YAGNI — mỗi selection ở toạ độ khác nhau, một vị trí "đã lưu" thường không còn hợp lý cho selection kế tiếp; persist thêm state vào settings store là over-engineering chưa có nhu cầu xác thực. (Xem OQ-B2.)

### Acceptance criteria
- **AC-B1** — *Given* popover đang mở, *When* user nhấn-giữ trên header `.npq` và kéo, *Then* popover di chuyển theo con trỏ mượt (native pointer, có `setPointerCapture`), và nội dung `noteText` không bị mất.
- **AC-B2** — *Given* user đang kéo popover, *When* con trỏ chạm/vượt mép viewport, *Then* popover bị clamp trong viewport (không biến mất khỏi màn hình).
- **AC-B3** — *Given* popover đang mở, *When* user kéo handle resize, *Then* kích thước popover thay đổi trong khoảng min/max đã định; nội dung trích dẫn `.npex` và textarea giãn theo để đọc được nhiều hơn.
- **AC-B4** — *Given* user đang kéo/resize popover, *When* thao tác kéo diễn ra (pointerdown → move → up), *Then* popover **không bị đóng** do backdrop.
- **AC-B5** — *Given* user đã kéo/resize popover rồi đóng, *When* user mở popover cho một selection mới, *Then* popover xuất hiện ở vị trí/size mặc định (không nhớ vị trí cũ) — theo quyết định không-persist.
- **AC-B6** — *Given* con trỏ ở trên header, *Then* cursor hiển thị `grab`/`grabbing` để gợi ý kéo được; con trỏ trên textarea vẫn là caret bình thường (kéo trong textarea = bôi đen text, không di chuyển popover).

### Edge case
- **Kéo vs select text:** kéo chỉ kích hoạt từ header; bôi đen trong textarea không được biến thành drag.
- **Cửa sổ resize khi popover đang mở:** clamp lại vị trí nếu viewport thu nhỏ khiến popover lọt ra ngoài (đề xuất: clamp on next interaction; recompute realtime là nice-to-have — OQ-B1).
- **Trích dẫn/ghi chú rất dài:** textarea + `.npex` phải scroll trong popover, không đẩy nút Save ra ngoài viewport khi popover đã bị clamp.
- **Multi-monitor / DPI scaling:** dùng `clientX/clientY` (viewport coords) như `onWpResize` để nhất quán.
- **Pointer bị nhả ngoài cửa sổ (dragleave):** `setPointerCapture` + `pointerup` xử lý được; cần cleanup listener khi popover unmount giữa chừng (đóng bằng Esc/Save trong lúc đang drag).
- **Touch/pen:** pointer events cover được; không cần thêm handler riêng.

### UI behavior
- Header có visual affordance kéo (cursor grab; có thể thêm dấu hiệu handle mờ). Resize handle nhỏ ở góc dưới-phải.
- Trong lúc kéo: có thể set một cờ (như `wpDragging`) để tắt transition/tránh nhấp nháy.

### Dependency
- Không đụng entity/store nếu **không persist** (quyết định MVP). Nếu persist → cần thêm field vào `settings` store (out of MVP scope).
- Tái dùng logic pointer từ `onWpResize` — cân nhắc trích chung một helper nếu logic trùng đủ nhiều (Rule of Three: hiện là copy thứ 2, chưa bắt buộc abstract).

### Ưu tiên / Effort / Owner
- **Ưu tiên: Trung bình** (cải thiện đáng kể khi nội dung dài, nhưng không chặn luồng cơ bản). **Effort: M.** **Owner: developer (frontend), Tech Lead review pattern pointer + clamp.**

---

## AN-3 — Right-click để hiện nút Quote tại vị trí con trỏ

### Vấn đề
Nút `.selquote` luôn hiện ở đỉnh-giữa vùng chọn (`y = rect.top - 8`). Với đoạn text dài (nhiều dòng) hoặc selection sát mép trên viewport, nút có thể ra ngoài màn hình / vào chỗ khó bấm. User cần một cách chủ động: sau khi bôi đen, **right-click (contextmenu)** để nút Quote hiện **ngay tại vị trí con trỏ chuột phải**.

### Giải pháp đề xuất (mô tả hành vi, không code)
- **Bổ sung** listener `@contextmenu` trên `.chat` (song song, không thay thế hành vi mouseup hiện tại — xem trade-off bên dưới).
- Handler: kiểm tra có selection hợp lệ trong một message (`closest('[data-mi]')`) giống `onSelectQuote`. Nếu hợp lệ:
  - `preventDefault()` để chặn context menu mặc định.
  - Set `quoteSel` với `x = clientX`, `y = clientY` (toạ độ con trỏ), giữ nguyên `src`/`text` từ selection.
- Nếu **không** có selection hợp lệ trong message → **không** `preventDefault`, để hành vi mặc định (trong Electron production thường không có menu mặc định; nhưng ở dev/browser cần tôn trọng — xem OQ-C1).

**Quyết định giữ cả hai (mouseup + right-click):**
- **Đề xuất: GIỮ mouseup (hành vi hiện tại) + BỔ SUNG right-click.** Trade-off:
  - *Giữ cả hai:* mouseup cho discovery (user không cần biết mẹo right-click); right-click cho control (đặt nút chính xác chỗ con trỏ khi selection dài). Nhược: 2 cách làm cùng việc, nút có thể "nhảy" vị trí (mouseup hiện ở đỉnh selection, sau đó right-click dời nút xuống con trỏ) — nhưng đây là hành vi mong đợi (user chủ động dời).
  - *Chỉ right-click:* gọn hơn nhưng mất discovery, đổi hành vi quen thuộc — không khuyến nghị.

**Tương tác với `@mousedown="quoteSel = null"` hiện có:**
- `.chat` có `@mousedown="quoteSel = null"` → mọi mousedown xoá nút Quote. **Right-click CÓ phát `mousedown`** (button=2). Nghĩa là chuỗi sự kiện right-click là: `mousedown` (xoá `quoteSel`) → `contextmenu` (set lại `quoteSel`). Vì `contextmenu` bắn **sau** `mousedown`, kết quả cuối vẫn là `quoteSel` được set → nút hiện. Cần verify thứ tự này trong Electron/Chromium; nếu có race, cân nhắc: mousedown chỉ xoá khi `button === 0` (left) để right-click không xoá trước. (Xem OQ-C2 — đề xuất chốt: mousedown chỉ reset khi left-click.)
- **Selection có bị mất khi right-click không?** Trong Chromium, right-click trên vùng đã select **giữ** selection (không clear). Right-click ngoài vùng select có thể clear — nhưng handler chỉ set `quoteSel` khi selection còn hợp lệ nên an toàn. Cần verify (OQ-C3).

### Acceptance criteria
- **AC-C1** — *Given* user đã bôi đen text hợp lệ trong một message, *When* user right-click **trên vùng chọn**, *Then* context menu mặc định KHÔNG hiện và nút Quote xuất hiện **tại vị trí con trỏ chuột phải** (`clientX/clientY`).
- **AC-C2** — *Given* không có selection hợp lệ (hoặc selection ngoài `[data-mi]`), *When* user right-click, *Then* handler không hiện nút Quote (và không chặn menu mặc định — tôn trọng hành vi nền tảng).
- **AC-C3** — *Given* nút Quote đã hiện qua right-click, *When* user click nút, *Then* mở note popover đúng như luồng cũ (`openNote`), với `text`/`src` từ selection.
- **AC-C4** — *Given* hành vi mouseup hiện tại, *When* user bôi đen thả chuột, *Then* nút Quote vẫn hiện ở đỉnh selection như trước (không regression).
- **AC-C5** — *Given* user right-click sau khi đã có nút từ mouseup, *When* right-click trên vùng chọn, *Then* nút dời về vị trí con trỏ (không nhân đôi nút).

### Edge case
- Right-click khi đang có note popover mở: đề xuất không xử lý (hoặc bỏ qua) để tránh mở chồng.
- Right-click nhiều lần liên tiếp: nút chỉ dời theo con trỏ, không tạo nhiều nút.
- Selection kéo qua nhiều message (`data-mi` khác nhau): giữ logic hiện tại (`onSelectQuote` dùng `commonAncestorContainer` → một `src`); right-click cũng phải xác định đúng message theo con trỏ hoặc theo `commonAncestorContainer` — thống nhất với mouseup (OQ-C4).
- Right-click trong textarea của composer / vùng ngoài transcript: không nằm trong `[data-mi]` → không hiện nút, giữ menu mặc định.
- Trên macOS trackpad "secondary click" (Ctrl+click / two-finger): vẫn bắn `contextmenu` → cover được.

### UI behavior
- Nút xuất hiện ngay dưới/tại con trỏ. Cân nhắc offset nhỏ để nút không nằm ngay dưới đầu con trỏ che view. Vẫn dùng `transform` neo phù hợp (nếu đặt tại con trỏ, có thể bỏ `translate(-50%,-100%)` hoặc dịch để nút nằm gọn dưới-phải con trỏ — Tech Lead chốt).

### Dependency
- Không đụng store. Thuần event handling trong `SessionDetail.vue`.
- Chạm hành vi context menu của Electron — cần xác nhận không phá menu hệ thống nơi khác (OQ-C1).

### Ưu tiên / Effort / Owner
- **Ưu tiên: Trung bình.** **Effort: S–M** (S nếu chỉ bổ sung handler; M nếu phải xử lý cẩn thận thứ tự mousedown/contextmenu + verify Electron). **Owner: developer (frontend).**

---

## Edge case AWOG-specific — Nhóm B (rà theo checklist)

- **Local-first / offline:** cả 3 issue thuần UI client, không gọi network → hoạt động offline hoàn toàn. Không ảnh hưởng.
- **Restart-safe / resume:** popover là ephemeral UI state; không cần persist qua restart. `saveQuote` mới ghi vào store (follow-up) — không đổi. Không có state trung gian cần resume.
- **Approval gate:** không chạm approval flow.
- **Trace/event log:** không phát event mới; quote đã lưu qua `store.addQuote` (giữ nguyên).
- **Git workspace:** không auto-commit gì mới.
- **Tray/notification:** không cần notify.
- **Multi-task concurrent:** popover per-session, không chia sẻ state giữa task chạy song song → không conflict.

> **Ghi chú:** Nhóm A cũng thuần client-side UI, offline-safe; các ràng buộc AWOG cho Nhóm A đã nêu ở mục "Ràng buộc AWOG bám suốt Nhóm A".

---

## Open questions (gộp cả hai nhóm, phân nhóm theo issue)

### Chung
- **OQ-0** *(Nhóm B)* — i18n: các label mới (nếu có tooltip "Kéo để di chuyển", hint right-click) cần key mới ở en/vi. Có cần không hay giữ tối giản (chỉ cursor grab)? → PO/BA quyết. **→ đã chốt (TL): tối giản, không label mới — xem § T0-BC.**

### Nhóm A — Session UI
**UI-1 — Search project khi add tab**
- **1.a** — Khi 2 project trùng tên trong danh sách lọc, có cần hiển thị thêm path/id để phân biệt không? (Đề xuất: hiển thị path rút gọn dưới tên khi trùng — quyết định lúc implement.)
- **1.b** — Có cần ArrowUp/Down + highlight ngay MVP, hay chỉ filter + click + Enter-chọn-item-đầu? (Đề xuất MVP: filter + Enter chọn item đầu; arrow nav để sau.)

**UI-2 — Kéo-thả sắp xếp tab**
- **2.a** — Tab Default có được kéo không / có bị ghim vị trí không? → *quyết định lúc implement* (đề xuất mặc định: Default kéo được như tab thường; nếu muốn đơn giản có thể ghim đầu).
- **2.b** *(đã chốt)* — Keyboard reorder (a11y): **để sau MVP**.
- **2.c** *(đã chốt)* — Auto-scroll strip khi kéo tới mép: **có** trong phạm vi (AC2.7).

**UI-3 — Fullscreen toàn bộ turn**
- **3.a** — Trong fullscreen: activities **expand hết** hay **giữ nguyên state collapse** như transcript? (Đề xuất: giữ nguyên state để nhất quán; hoặc thêm nút "expand all". Quyết định lúc implement.)
- **3.b** *(đã chốt)* — **GIỮ CẢ HAI** nút: fullscreen-response cũ (câu trả lời) + fullscreen-turn mới (toàn bộ phản hồi). Hai nút riêng biệt, icon + tooltip phân biệt; **không bỏ nút cũ**.
- **3.c** — Khi streaming: overlay có auto-scroll theo delta không, và ứng xử khi user đã cuộn lên? (Quyết định lúc implement — đề xuất: auto-scroll xuống đáy nếu user đang ở đáy, dừng nếu user đã cuộn lên.)
- **3.d** — Trong fullscreen có cho tương tác gate (trả lời question / approve) không? (Quyết định lúc implement — đề xuất MVP: read-only.)

**UI-4 — Max-height + resize composer**
- **4.a** *(đề xuất: không làm ngay)* — Persist chiều cao input? MVP: **không persist**. Có thể thêm sau (global key) nếu user yêu cầu.
- **4.b** — Khi **seed draft**, reset cờ manual về auto (auto-grow hiển thị đủ seed) hay tôn trọng chiều cao manual? (Đề xuất: reset về auto khi seed; reset về auto sau khi gửi. Quyết định lúc implement.)
- **4.c** — Chốt max = `40vh`; cần listener `window resize` để re-clamp `composerH` theo max mới (trong phạm vi).

**UI-5 — Phân trang session**
- **5.a** *(đã chốt)* — Grouped mode: **phân trang theo TỪNG group** (per-group), page size 20/group, mỗi group state trang riêng, reset khi filter đổi. Group header count = tổng item của group. **KHÔNG** phân trang phẳng toàn bộ.
- **5.b** — "Select all" trong select-mode: chọn **toàn bộ filtered (mọi trang, mọi group)** hay **chỉ trang hiện tại**? (Đề xuất: giữ toàn bộ filtered như hiện tại; UI nói rõ. Quyết định lúc implement.)
- **5.c** *(page size đã chốt = 20)* — Kiểu control còn để chốt khi implement: prev/next đơn giản, hay số trang + jump? (Đề xuất: prev/next + "trang X / Y".)

### Nhóm B — Annotation
**AN-1 — Auto-focus textarea**
- **OQ-A1** — Có cần focus-trap (Tab loop trong popover) không, hay chỉ focus khởi tạo textarea là đủ cho MVP? Đề xuất: chỉ focus khởi tạo.

**AN-2 — Kéo-thả + resize note popover**
- **OQ-B1** — Khi cửa sổ resize lúc popover đang mở, cần recompute clamp realtime hay chỉ clamp ở lần tương tác kế? Đề xuất MVP: clamp ở lần tương tác kế (đơn giản hơn).
- **OQ-B2** — Xác nhận **không persist** vị trí/size popover (reset mỗi lần mở)? Đề xuất: không persist. Chờ PO xác nhận.
- **OQ-B3** — Resize handle: chỉ góc dưới-phải, hay đủ 4 cạnh? Đề xuất: chỉ góc dưới-phải (KISS). → TL chốt.
- **OQ-B4** — Con số min/max width/height cụ thể? Đề xuất tham chiếu `WP_SIDE {min:240,max:560}` cho width, height min ~160. → TL chốt.

**AN-3 — Right-click hiện nút Quote**
- **OQ-C1** — Trong Electron production, right-click ở vùng KHÔNG có selection có cần menu mặc định (copy/paste) không? Nếu app đã tắt context menu toàn cục thì `preventDefault` có điều kiện là an toàn; nếu app có menu tuỳ biến ở nơi khác thì cần đảm bảo không nuốt. → cần verify với Tech Lead/hiện trạng Electron main.
- **OQ-C2** — `@mousedown="quoteSel = null"` có nên đổi thành "chỉ reset khi left-click (`button===0`)" để right-click không xoá `quoteSel` trước khi `contextmenu` set lại? Đề xuất: có, để tránh race. → TL xác nhận thứ tự sự kiện Chromium/Electron.
- **OQ-C3** — Verify Chromium giữ selection khi right-click **trên** vùng đã chọn (kỳ vọng: giữ). Cần test thực tế.
- **OQ-C4** — Right-click xác định `src` (message index) theo `commonAncestorContainer` (như mouseup) hay theo element dưới con trỏ (`elementFromPoint`)? Đề xuất: dùng lại logic `onSelectQuote` (commonAncestorContainer) để nhất quán.
- **OQ-C5** — Có giữ cả hai trigger (mouseup + right-click) không, hay chỉ right-click? Đề xuất BA: giữ cả hai. → PO chốt.

---

## Đề xuất bước tiếp

1. Chuyển spec cho **project-manager** decompose task (skill `decompose-tasks`). Nhóm A các quyết định hướng đi đã chốt hết; Nhóm B chia theo thứ tự AN-1 → AN-3 → AN-2.
2. **Tech-lead** xác nhận:
   - **UI-5**: phạm vi gỡ infinite scroll chỉ ở SessionList, giữ composable dùng chung; state trang per-group. → **đã chốt (TL), xem "Quyết định Tech Lead (Wave 0)" § T0b.**
   - **UI-3**: nơi mount overlay — local ref trong `SessionMessageItem` vs composable như `usePreview`. → **đã chốt (TL), xem § T0c.**
   - **Nhóm B (AN-2, AN-3)**: các OQ về thứ tự event Electron (OQ-C1, OQ-C2, OQ-C3), clamp/min-max/persist popover (OQ-B1..OQ-B4) cần TL xác nhận trước khi PM ước lượng chốt effort AN-2. → **đã chốt (TL), xem § T0-BC.**
3. Không có OQ nào chặn **AN-1** (và UI-1/UI-4) — có thể tách làm quick win triển khai trước.

---

## Quyết định Tech Lead (Wave 0)

> **Vai trò:** tech-lead. **Ngày:** 2026-07-22. **Phạm vi:** giải quyết các điểm BLOCK Wave 0 (TL-A = T0b + T0c; TL-B = T0-BC) để developer bắt đầu code.
> **Kết luận chung:** **KHÔNG cần ADR** cho toàn bộ 8 issue. Lý do: (1) không thêm dependency (native pointer events, không thư viện DnD/pagination); (2) không đổi data shape entity / IPC / event schema (state phân trang + vị trí popover là **ephemeral UI state**, không persist ra đĩa; `store.addQuote` giữ nguyên); (3) thuần client-side UI trong `apps/desktop/ui-next/`. Chỉ cần các quyết định thiết kế dưới đây + design note này.
> Các quyết định này **không vi phạm** ADR nào hiện có (đã rà [ADR 0055](../decisions/0055-session-task-link.md) — không đụng luồng session↔task; không đụng ADR 0019/0024/0029).

### T0b — Scope Issue UI-5 (pagination SessionList) — ĐÃ CHỐT (TL)

**Quyết định 1 — File được đụng / KHÔNG đụng.**
- **CHỈ đụng `apps/desktop/ui-next/components/session/SessionList.vue`.**
- **KHÔNG đụng** `composables/useLoadMore.ts`, `components/common/LoadMoreSentinel.vue`, và **không** dùng `useGroupLoadMore` trong SessionList nữa.

**Lý do (bằng chứng grep toàn repo):** `useLoadMore.ts` (export `useLoadMore` + `useGroupLoadMore` + type `GroupWindow`) và `LoadMoreSentinel.vue` là composable/component **dùng chung**, có consumer khác ngoài SessionList:
- `components/library/LibraryView.vue` — import cả `useLoadMore` + `useGroupLoadMore` + type `GroupWindow`, render `LoadMoreSentinel` (dòng ~133/143/163/257/258).
- `components/project/ProjectList.vue` — `useLoadMore` + `LoadMoreSentinel auto` (dòng ~39/65).
- `components/session/SessionTranscript.vue` — `LoadMoreSentinel` (dòng ~30).

⇒ Sửa `useLoadMore.ts`/`LoadMoreSentinel.vue` sẽ **vỡ Library, ProjectList, SessionTranscript**. **Tuyệt đối không sửa 2 file này.** Ở SessionList: gỡ 2 lệnh gọi `useLoadMore(() => filtered.value)` + `useGroupLoadMore()` (dòng 401–402), gỡ 3 chỗ render `LoadMoreSentinel` (template dòng ~188, ~199) và thay bằng logic phân trang mới.

**Quyết định 2 — Shape state phân trang per-group (khả thi với cấu trúc hiện tại).**
- **Dùng reactive map cục bộ trong `SessionList.vue`** (KHÔNG tạo composable mới `useGroupPagination`). Lý do KISS/YAGNI + Rule of Three: chỉ có **một** consumer (SessionList) cần kiểu phân trang có-control-trang này; Library/ProjectList vẫn dùng render-window incremental cũ. Chưa tới ngưỡng abstract (Rule of Three: đây là bản 1). Nếu sau này Library cần phân trang trang-controlled thì mới tách composable.
- Shape đề xuất (bám pattern `useGroupLoadMore` — map keyed by group key, reassign để re-run computed):
  - `const pageIndex = ref<Record<string, number>>({})` — key = `grp.key` (giá trị `groupKeyOf` hiện có: provider/model/unread bucket). Flat mode = một group key cố định, ví dụ `'__flat__'`.
  - `pageOf(key) = pageIndex.value[key] ?? 0` (0-based). `totalPages(items) = Math.max(1, Math.ceil(items.length / SESSIONS_PAGE_SIZE))`.
  - `pageSliceOf(key, items)` = `items.slice(p*20, p*20+20)` với `p = clamp(pageOf(key), 0, totalPages-1)` (clamp tại chỗ đọc → tự lùi trang khi group co lại, phục vụ edge "xóa giảm trang").
  - `setPage(key, next)`: reassign `pageIndex.value = { ...pageIndex.value, [key]: clamp(...) }` (reassign, không mutate — để `groups` computed đọc nó re-run, giống `useGroupLoadMore.loadMore`).
  - `reset()`: `pageIndex.value = {}` — nối vào `watch([filter, groupBy, sortBy, () => store.activeTab])` **đang có sẵn** (dòng 407–410) thay cho `reset()/groupLoad.reset()` cũ.
- **Khả thi xác nhận:** cấu trúc hiện tại đã sẵn sàng — `groups` computed (dòng 425–441) map từ `filtered` theo `groupKeyOf`, mỗi group đã có `key` ổn định. Chỉ đổi `...groupLoad.windowOf(key, items)` → `visible: pageSliceOf(key, items)` + thêm `page`, `totalPages`. `grp.items.length` (dòng 174) giữ nguyên = **tổng item group** (AC5.7). Flat (dòng 145–160) đổi `visible` (từ `useLoadMore`) → `pageSliceOf('__flat__', filtered)`.
- **Select-all** (`selectAllFiltered`, `allFilteredSelected` dòng 339–354) đọc `filtered.value` (toàn bộ) → **giữ nguyên**, không phá bởi phân trang (AC5.5 / OQ-5.b: toàn bộ filtered mọi trang). Đề xuất OQ-5.c: control **prev/next + "trang X / Y"** (đủ, KISS).

**Ghi chú cho developer:** control trang đặt ở đáy mỗi `.grpitems` (thay `LoadMoreSentinel` per-group) và đáy `.lscroll` cho flat. i18n `sessions.list.pagePrev/pageNext/pageOf`. Hằng `SESSIONS_PAGE_SIZE = 20` khai cục bộ trong SessionList (không dùng `GROUP_PAGE_SIZE`/`LOAD_MORE_PAGE_SIZE` của composable chung).

### T0c — Nơi mount overlay fullscreen toàn bộ turn (Issue UI-3) — ĐÃ CHỐT (TL)

**Quyết định — Mount LOCAL trong `SessionMessageItem.vue` qua component con `SessionTurnFullscreen.vue` + `Teleport to body`.** KHÔNG dùng cơ chế shared kiểu `usePreview`.

**Lý do (realtime binding là yếu tố quyết định):**
- `grouped` là **computed cục bộ của instance `SessionMessageItem`**, reactive theo `props.message` (dòng 203–256). Realtime khi streaming (AC3.2/AC3.7) yêu cầu overlay đọc **đúng instance message reactive** đó. Mount local giữ overlay **trong cùng cây reactive** của message → `grouped` re-run khi delta tới, overlay tự cập nhật, **không snapshot cứng**.
- `usePreview` là singleton shared chỉ mang payload `{ name, kind: 'markdown', text }` (dòng 421–430) — **không** render cây component turn, không giữ tham chiếu tới message reactive. Tái dụng nó = phải serialize turn thành text (mất activities/gates) hoặc truyền message qua singleton (phá SoC, 1 instance không map được nhiều message đang stream song song). Loại.
- Mount local đơn giản hơn: `const turnFs = ref(false)` trong SessionMessageItem; nút mới trong `msgActions` set `turnFs = true`; `<SessionTurnFullscreen v-if="turnFs" :message="props.message" @close="turnFs = false" />`. Mỗi message có overlay riêng, unmount an toàn khi message bị xóa/rewind/fork (v-if theo message).

**Tái dùng grouping KHÔNG duplicate logic (DRY):**
- **Truyền `grouped` xuống overlay như prop** (`:groups="grouped"`), KHÔNG tính lại grouping trong `SessionTurnFullscreen`. `grouped` đã là computed sẵn trong SessionMessageItem; overlay chỉ nhận mảng `Grouped[]` + `message` (cho `streaming`, `inlineTodoStep` nếu cần) và render lại **cùng cây con**: `SessionTurnActivities` / `SessionTextBlock` / `SessionStepItem` / `SessionGateCard` — copy đúng block `<template v-for="(g, gi) in grouped">` (dòng ~82–97 SessionMessageItem) vào overlay.
- Vì `grouped` là computed reactive, prop truyền xuống overlay cũng reactive → khi stream delta, `grouped` re-run ở parent, prop đổi, overlay re-render. Đạt AC3.2/AC3.7 mà không có logic grouping thứ hai.

**Giữ CẢ HAI nút (3.b đã chốt):**
- **GIỮ NGUYÊN** nút cũ `openFullscreen` → `usePreview`/PreviewModal (icon `maximize`, gated bởi `plainText.value.trim()` — dòng 437–439). Chỉ final response text.
- **THÊM** entry mới vào `msgActions` (dòng 434–446): icon riêng (đề xuất `expand`/`fullscreen`, khác `maximize`), tooltip `sessions.message.fullscreenTurn`, `run: () => (turnFs = true)`. Nút mới **luôn hiển thị** cho assistant turn (kể cả tool-only, không gated bởi `plainText` — AC3.9); nút cũ giữ điều kiện ẩn khi không có prose (AC3.8).

**OQ nhỏ (dev quyết theo đề xuất spec):** 3.a giữ nguyên state collapse như transcript (component con tự giữ state riêng khi mount trong overlay — chấp nhận, KISS); 3.c auto-scroll xuống đáy nếu đang ở đáy, dừng nếu user đã cuộn lên; 3.d gate **read-only** trong overlay (thao tác gate làm ở transcript).

**Ghi chú cho developer:** tạo `components/session/SessionTurnFullscreen.vue` (Teleport to body, `@click.self` + `@keydown.esc` đóng, vùng cuộn nội bộ). Đăng ký `SessionTurnFullscreen.vue` vào bảng component `apps/desktop/ui-next/README.md` (task Z.2).

### T0-BC — OQ kỹ thuật Annotation nhóm B (drag+resize notePop) & C (right-click quote) — ĐÃ CHỐT (TL)

**Nhóm B — drag + resize `.notepop`:**

- **OQ-B4 (BLOCK) — con số clamp min/max → CHỐT:**
  - **Width:** `min 240px, max min(560px, viewport.width − 16)`. Bám hằng `WP_SIDE = { min:240, max:560 }` đang có (dòng 798) để nhất quán toàn app; margin 16px giữ popover không dính mép.
  - **Height:** `min 160px, max viewport.height − 16`.
  - Vị trí `x/y` clamp: `x ∈ [8, viewport.width − popoverWidth − 8]`, `y ∈ [8, viewport.height − popoverHeight − 8]` (dùng `clientX/clientY` như `onWpResize`).
- **OQ-B3 (BLOCK) — resize handle → CHỐT: CHỈ góc dưới-phải** (một handle). KISS/YAGNI: 4 cạnh là over-engineering cho popover ghi chú; một handle góc dưới-phải đủ để giãn xem trích dẫn dài. Handle **riêng** (element `.npresize`), KHÔNG dùng `resize: vertical` CSS (đã bị textarea dùng — tránh nhầm, AC-B3).
- **OQ-B2 (Nên chốt) — persist vị trí/size → CHỐT: KHÔNG persist ở MVP.** Reset về mặc định (neo theo selection, width 280px) mỗi lần mở popover mới. Lý do: mỗi selection ở toạ độ khác → vị trí lưu thường vô nghĩa cho selection kế; persist = đụng `settings` store (out of MVP, và sẽ cần đổi data shape → mới cần ADR — tránh). Đây cũng là lý do **không cần ADR**.
- **OQ-B1 (dev quyết) — window resize khi popover mở:** clamp ở **lần tương tác kế** (không recompute realtime). Đề xuất spec, đơn giản.
- **Tái dùng pattern pointer → CÓ:** tái dùng đúng khuôn `onWpResize` (dòng 800–825): `pointerdown` → `ev.preventDefault()` → `handle.setPointerCapture(ev.pointerId)` → `addEventListener('pointermove'/'pointerup')` trên chính handle → clamp `Math.max/min` → `onUp` remove listener. **Drag-handle = header `.npq`** (không toàn bộ popover — tránh xung đột select text trong textarea). Đây là **copy thứ 2** của pattern (Rule of Three chưa đạt) → **chưa tách helper chung**, copy inline trong SessionDetail chấp nhận được (KISS thắng DRY). Khi kéo/resize thủ công: bỏ `transform: translate(-50%,-100%)`, neo góc trên-trái để toạ độ khớp trực giác.
- **Chống đóng nhầm (AC-B4):** `.notebackdrop` có `@mousedown="notePop = null"` (dòng 263). Header `.npq` nằm trong `.notepop` (không phải backdrop) + `setPointerCapture` giữ `pointermove/up` trên header → kéo không lọt ra backdrop. Đảm bảo `pointerdown` trên header **không bubble** kích hoạt backdrop (header không phải con của backdrop nên OK; nếu cần, `.stop` trên pointerdown của header). **Không remount textarea** khi cập nhật toạ độ (giữ `noteText` — bind `left/top` qua `:style`, không `v-if`).

**Nhóm C — right-click quote:**

- **OQ-C1 (BLOCK) — Electron menu mặc định → CHỐT: `preventDefault` CÓ ĐIỀU KIỆN là an toàn.** Xác nhận hiện trạng: app **không** đăng ký context menu tuỳ biến toàn cục ở renderer (grep `@contextmenu` chỉ thấy `SessionList.vue` dòng 218 tự quản menu riêng của nó với `.prevent` cục bộ, không ảnh hưởng `.chat`). ⇒ `contextmenu` trên `.chat` chỉ `preventDefault()` **khi có selection hợp lệ trong `[data-mi]`**; ngoài trường hợp đó **không** `preventDefault` → để hành vi nền tảng (Chromium/Electron) như cũ. Không nuốt menu nơi khác.
- **OQ-C2 (Nên chốt) — thứ tự event + mousedown reset → CHỐT: đổi `@mousedown="quoteSel = null"` thành CHỈ reset khi `button === 0` (left-click).** Thứ tự event Chromium/Electron: right-click bắn `mousedown (button=2)` → `mouseup (button=2)` → `contextmenu`. Với handler hiện tại (dòng 176 `@mousedown="quoteSel = null"` không lọc button), `mousedown` right-click **sẽ xoá `quoteSel`** trước; tuy `contextmenu` bắn sau set lại nhưng để chắc chắn không race và không nhấp nháy, **lọc `button===0`**: `@mousedown="(e) => { if (e.button === 0) quoteSel = null }"`. Left-click giữ hành vi cũ (xoá nút Quote đang hiện); right-click không xoá → `contextmenu` set sạch.
- **OQ-C5 (Nên chốt) — giữ cả hai trigger → CHỐT: GIỮ CẢ HAI** (`@mouseup="onSelectQuote"` hiện tại + `@contextmenu` mới song song). mouseup cho discovery, right-click cho control đặt nút tại con trỏ. Right-click chỉ **dời** `quoteSel` tới `clientX/clientY`, không nhân đôi nút (AC-C5).
- **OQ-C4 (dev quyết) — xác định `src`:** dùng lại logic `onSelectQuote` (`commonAncestorContainer` + `closest('[data-mi]')`, dòng 554–561) — nhất quán với mouseup. Handler `@contextmenu` = copy `onSelectQuote` nhưng đặt `x = e.clientX`, `y = e.clientY` (thay vì rect center) và `preventDefault` khi hợp lệ.
- **OQ-C3 (dev verify) — Chromium giữ selection khi right-click trên vùng đã chọn:** kỳ vọng giữ (right-click **trong** vùng select không clear selection ở Chromium). Dev verify thực tế; nếu ngoài vùng select thì `getSelection` rỗng → handler no-op (không `preventDefault`), an toàn.
- **Vị trí nút tại con trỏ:** đặt `left=clientX, top=clientY`; cân nhắc đổi `transform` từ `translate(-50%,-100%)` sang offset nhỏ dưới-phải con trỏ để không che (dev tinh chỉnh, không block).

**OQ-0 (Chung — i18n) → CHỐT: tối giản, KHÔNG thêm label văn bản mới cho drag/right-click.** Chỉ dùng affordance `cursor: grab/grabbing` cho header (AC-B6) và không cần hint text cho right-click (hành vi khám phá qua mouseup). ⇒ Nhóm B/C **không phát sinh key i18n mới** (trừ tooltip nút fullscreen-turn của UI-3 = `sessions.message.fullscreenTurn`, thuộc Issue 3). Giảm bề mặt dịch.

**OQ-A1 (dev quyết) — AN-1 focus:** chỉ **focus khởi tạo** (nextTick + template ref, caret cuối), không focus-trap. Đề xuất spec.

### Trạng thái open question sau chốt (TL)

| OQ | Phân loại cũ | Trạng thái sau TL |
|---|---|---|
| Scope UI-5 (T0b) | BLOCK | **đã chốt (TL)** — chỉ `SessionList.vue`, reactive map cục bộ |
| Mount UI-3 (T0c) | BLOCK | **đã chốt (TL)** — local `SessionMessageItem` + `SessionTurnFullscreen.vue`, prop `grouped` |
| OQ-B3 | BLOCK | **đã chốt (TL)** — chỉ handle góc dưới-phải |
| OQ-B4 | BLOCK | **đã chốt (TL)** — W `[240, min(560,vw−16)]`, H `[160, vh−16]`, pos clamp margin 8 |
| OQ-C1 | BLOCK | **đã chốt (TL)** — `preventDefault` có điều kiện an toàn (không menu tuỳ biến toàn cục) |
| OQ-B2 | Nên chốt | **đã chốt (TL)** — không persist MVP |
| OQ-C2 | Nên chốt | **đã chốt (TL)** — mousedown reset chỉ `button===0` |
| OQ-C5 | Nên chốt | **đã chốt (TL)** — giữ cả hai trigger |
| OQ-0 | Dev quyết | **đã chốt (TL)** — tối giản, không label mới (trừ tooltip UI-3) |
| OQ-A1, OQ-B1, OQ-C3, OQ-C4 | Dev quyết | giữ nguyên — dev quyết lúc implement theo đề xuất spec |

### Kết luận Wave 0 / cần ADR?

- **KHÔNG cần ADR.** Không thêm dependency, không đổi data shape entity / IPC / event schema, không backend/DB — thuần client-side UI + native pointer + ephemeral state. Design note này là đủ. (Cảnh báo giữ nguyên: nếu bất kỳ issue nào phát sinh nhu cầu persist vị trí popover / chiều cao composer vào store hoặc thêm thư viện → **dừng, mở ADR** trước.)
- **Wave 0 UNBLOCK.** TL-A (T0b + T0c) và TL-B (T0-BC) đã chốt. Developer có thể bắt đầu **Wave 1** ngay (Issue 4, Issue 1, Issue A — Issue A vốn không chờ Wave 0), và mọi task Wave 2/3 phụ thuộc TL-A/TL-B (U3.1, U5.1, AN-C.1, AN-B.1/2) đã có đủ quyết định để triển khai.
