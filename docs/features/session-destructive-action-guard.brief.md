# Feature Brief: Chặn thao tác phá huỷ transcript

> **Status:** Draft
> **Owner:** Product Owner (AWOG)
> **Created:** 2026-08-26
> **Spec:** chưa có — sẵn sàng giao BA ngay (không có dependency)

## Problem

Trong footer của mỗi message ở Sessions có **9 nút hành động, cùng một màu `textDim`, cùng kích thước 13px, luôn hiện** (persistent, không cần hover). Trong số đó có những hành động **cắt vĩnh viễn transcript trên đĩa** — và chúng nằm **sát cạnh** các hành động hoàn toàn vô hại.

Một cú click lệch một ô = mất nửa cuối cuộc hội thoại. **Không có xác nhận. Không có undo. Không có toast hoàn tác.** Với session dài nhiều giờ, đây là mất mát công việc thật, không phải phiền toái giao diện.

Điều này cũng mâu thuẫn trực tiếp với tiêu chí thành công MVP #9 — *"tiếp tục công việc sau khi khởi động lại ứng dụng (state persistent trên đĩa)"*: state có persistent đến mấy cũng vô nghĩa nếu nó bị xoá bởi một cú click nhầm.

## Đính chính phạm vi — quan trọng

Yêu cầu gốc mô tả là *"confirm khi xoá message"*. Khi verify code: **hành động "xoá message" KHÔNG tồn tại** trong footer. Danh sách hiện có ở turn assistant là `copy`, `maximize`, `layers`, `quote`, `refresh`, `settings`, `rewind`, `branch`, `fork`; ở bong bóng user là `copy`, `maximize`, `edit`, `send`, `rewind`, `fork`.

Thủ phạm thật sự là những hành động **truncate rồi (đôi khi) chạy lại**:

| Hành động | Icon hiện tại | Thực chất làm gì | Hoàn tác được? | Tốn tiền? |
|---|---|---|---|---|
| **`rewind`** | `rewind` | Cắt transcript từ điểm này + RPC `sessions.rewind` (cắt cả trên đĩa) | ❌ **Không** | Không |
| **`resend`** | `send` | Cắt + `sessions.truncate` + **chạy lại turn** | ❌ **Không** | ✅ **Có** — 1 lượt gọi model |
| **`regenerate`** | `refresh` | Cắt về user turn gần nhất + **chạy lại** | ❌ **Không** | ✅ **Có** |
| **`edit & resend`** | `edit` | Như trên, có overlay sửa nội dung | ❌ Không | ✅ Có |
| `fork` / `branch` | `fork` / `branch` | Tạo **session mới**, không đụng session gốc | ✅ An toàn | Không |

Nghĩa là: **nỗi sợ của người dùng đúng, chỉ gọi sai tên.** Feature này không thêm nút xoá — nó thêm **ma sát vào 4 hành động đang không có ma sát nào**.

## Target user

- **Persona:** **Mọi** người dùng Sessions. Đây là ngoại lệ hợp lệ của quy tắc "phải có persona cụ thể" — vì đây là **an toàn dữ liệu**, không phải tiện ích cho một nhóm.
- **Tần suất gặp problem:** rủi ro tồn tại ở **mỗi lần rê chuột qua footer**, tức hàng chục lần mỗi session. Thiệt hại khi xảy ra tỉ lệ thuận với độ dài session — nghĩa là **đánh đúng vào session có giá trị nhất**.
- **Workaround hiện tại:** không có. Chỉ có "cẩn thận". Sau khi mất, cách duy nhất là chấp nhận mất.

## Why now

- **Hạ tầng đã có, chi phí gần bằng không.** `useConfirm()` + `ConfirmDialogHost` (mount app-lifetime ở layout) + `LibraryConfirmDelete` đã tồn tại, có sẵn `kind: 'danger'`, và **đã được dùng ngay trong chính Sessions** (`SessionDetail`, `SessionListItem`, `SessionTabBar`, `SessionList`). Việc cần làm là `if (await confirm({…})) act(…)` — **không dựng modal mới**.
- **Session ngày càng dài** (Workspace Panel, checklist, subagent) ⇒ thiệt hại mỗi lần click nhầm **đang tăng theo thời gian**, trong khi rủi ro thì không đổi.
- **Không có dependency.** Không chờ tech-lead, không chờ enabler nào. Ship được ngay, độc lập với [session-transcript-navigation.brief.md](./session-transcript-navigation.brief.md).
- Đúng convention sẵn có của repo mà footer message đang **vi phạm**: `.claude/rules/nuxt-vue.md` quy định nút destructive phải hover `dangerBg`+`danger`; hiện **cả 9 nút đều cùng màu**, không phân biệt an toàn/nguy hiểm.

## Hypothesis

Nếu 4 hành động cắt transcript được gate bằng một hộp xác nhận **nêu rõ số message sẽ mất**, và icon destructive được tô `danger` khi hover, thì tai nạn mất transcript về **0** mà **không** phát sinh confirm-fatigue — vì các hành động phổ biến và an toàn (copy, quote, fullscreen, fork, branch) vẫn **không** bị hỏi.

## Success criteria

- **0 trường hợp** mất transcript do click nhầm sau khi ship.
- Hộp xác nhận nêu **con số cụ thể** ("Sẽ xoá 12 tin nhắn sau điểm này. Không thể hoàn tác.") — không phải câu chung chung "Bạn có chắc không?".
- **Đúng 4 hành động** bị gate (`rewind`, `resend`, `regenerate`, `edit & resend`). `copy` / `quote` / `fullscreen` / `fork` / `branch` / `retryModel` **không** bị hỏi — kiểm tra được bằng cách đếm.
- Người dùng **phân biệt được bằng mắt** nút nguy hiểm với nút an toàn trước khi click (hover ra màu `danger`).
- Xác nhận hoạt động **cả trong cửa sổ popout**, không treo im lặng.
- **Không** phát sinh modal mới trong codebase — dùng lại `useConfirm()`.

## Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | Gián tiếp — bảo vệ transcript, thứ sinh ra artifact; bản thân transcript không phải artifact. |
| Workflow-based | Không áp dụng — thuần bề mặt session. |
| Human-in-the-loop | **Yes, mạnh nhất trong các brief hiện tại.** *"Humans remain in control through approval checkpoints"* là 1 trong 5 câu triết lý core của [VISION](../../artifacts/VISION.md). Một xác nhận trước thao tác huỷ **chính là** approval checkpoint ở cấp vi mô. |
| Local-first | Yes — thuần client-side, không network, không thêm state. Bảo vệ đúng thứ mà local-first hứa hẹn: dữ liệu của người dùng nằm trên máy họ và **không tự bốc hơi**. |

## Phạm vi đã chốt

**Có xác nhận (4):**
- `rewind` — nêu số message sẽ mất.
- `resend` và `edit & resend` — nêu số message sẽ mất **+ lưu ý sẽ chạy lại một lượt model**.
- `regenerate` — như trên.

**KHÔNG xác nhận (6):** `copy`, `quote`, `fullscreen` (cả hai biến thể), `fork`, `branch`, `retryModel`.

> Lý do phải giữ danh sách thứ hai đúng bằng này: **confirm-fatigue là rủi ro thật**. Hỏi ở khắp nơi ⇒ người dùng bấm Enter phản xạ ⇒ hộp thoại mất hoàn toàn tác dụng đúng vào lúc cần nhất. Ma sát chỉ có giá trị khi nó **hiếm**.

**Kèm theo (rẻ, tăng an toàn thật):** tô `danger` khi hover cho icon destructive trong footer message, theo đúng UI pattern đã quy định trong `.claude/rules/nuxt-vue.md`.

## Scope hint

- **v-next** (post-MVP) nhưng **ưu tiên P0** — làm trước cả 2 năng lực của brief anh em.
- Layer chạm: **UI only**. Không sidecar, không storage, không data-model, không IPC mới.
- Ước lượng (PM refine): **S**.
- **Không cần ADR. Không cần infosec** (không chạm filesystem / network / exec / parse; không mở surface mới).

## Out of scope (chốt cứng, chống scope creep)

- **Undo / khôi phục transcript đã cắt.** Đây là feature khác hẳn (cần lưu bản sao trước khi truncate ⇒ chạm JSONL + dung lượng đĩa). Brief này chỉ ngăn tai nạn, **không** sửa hậu quả.
- Tuỳ chọn **"Đừng hỏi lại nữa"** (nhớ trong settings) — YAGNI. Chỉ thêm nếu người dùng thật sự phàn nàn; thêm sớm sẽ vô hiệu hoá chính feature này.
- Đổi lại **thứ tự / bố cục** 9 nút trong footer, hoặc gom bớt vào menu `…` — là việc của refactor UI, không trộn vào đây.
- Thêm confirm cho các bề mặt khác (xoá session, xoá tab, xoá project) — những chỗ đó **đã có** confirm riêng.
- Cảnh báo ngân sách/chi phí chi tiết cho lượt chạy lại — thuộc [session-cost-budget.md](./session-cost-budget.md), ở đây chỉ nhắc một dòng.
- Thêm xác nhận vào đường **mobile remote** — `sessions.*` mutating đi qua gateway theo policy riêng, không thuộc bề mặt UI này.

## Open questions cho user / BA

- **Cần user chốt:** với `resend` / `regenerate`, hộp thoại có nên nhắc **"sẽ tốn thêm 1 lượt gọi model"** không, hay chỉ nói về số message bị mất? (PO nghiêng: **có nhắc**, một dòng phụ, vì đây là chi phí thật và người dùng đang trả tiền theo lượt.)
- **BA verify:** cửa sổ **popout** có mount `ConfirmDialogHost` không? Nếu không, `confirm()` sẽ **không hiện gì và promise treo vĩnh viễn** ⇒ hành động im lặng không chạy — tệ hơn cả hiện trạng. Xem [session-popout-window.md](./session-popout-window.md).
- **BA verify:** `resend` / `regenerate` là `async` và **đã** `await sessions.truncate` trước khi chạy lại; chèn thêm `await confirm()` ở đầu chuỗi làm **dài thêm cửa sổ đua** (double-click, hoặc người dùng gửi tin mới trong lúc modal đang mở). Guard re-entry sẵn có (`regenInFlight`, chặn khi có turn đang streaming) **phải vẫn đúng** sau khi thêm `await` — và modal không được che mất guard đó.
- Đếm "số message sẽ mất" tính theo **message** hay theo **turn** (một turn assistant có thể gồm nhiều block)? → đề xuất: theo **message**, khớp với đơn vị mà `msgs.slice()` thao tác.
- Nhãn nút xác nhận: dùng mặc định ("Xoá") hay đặt riêng theo hành động ("Cắt về đây" / "Chạy lại")? → đề xuất: **đặt riêng**, vì "Xoá" sẽ tái tạo đúng sự nhầm lẫn mà mục *Đính chính* đang gỡ.

## Liên kết

- [VISION](../../artifacts/VISION.md) — *"Humans remain in control through approval checkpoints"*
- [MVP scope](../requirements/mvp-scope.md) — tiêu chí thành công #9 (state persistent trên đĩa)
- [sessions.md](./sessions.md) — bối cảnh Sessions
- [session-popout-window.md](./session-popout-window.md) — mô hình hand-off, cần verify `ConfirmDialogHost`
- [human-approval.md](./human-approval.md) — approval checkpoint ở cấp workflow (feature này là bản vi mô của cùng triết lý)
- [session-cost-budget.md](./session-cost-budget.md) — chi phí lượt chạy lại
- `.claude/rules/nuxt-vue.md` — UI pattern cho nút destructive (hover `dangerBg`+`danger`)
- Brief anh em: [session-transcript-navigation.brief.md](./session-transcript-navigation.brief.md)
