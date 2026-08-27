# QA Test Cases — Chặn thao tác phá huỷ transcript (guard B1 + persist B2)

> **Spec:** [session-destructive-action-guard.md](./session-destructive-action-guard.md) (§8 AC nhóm G/R, §9 edge case E1…E14, §7 nội dung hộp thoại)
> **Plan:** [session-destructive-action-guard.tasks.md](./session-destructive-action-guard.tasks.md) — task **QA-G1 / QA-G2 / QA-G3 / QA-R**
> **Spec anh em (phải khớp thứ tự cắt):** [session-transcript-navigation.md §5.4](./session-transcript-navigation.md) · test [session-transcript-navigation.tests.md](./session-transcript-navigation.tests.md)
> **Nhánh verify:** `feature/session-navigation-and-guard` (`e9991f6` … `5b56913`) · viết ngày 2026-08-27
> **Stack:** không có test runner ⇒ **manual + static only**.
> **Trạng thái lát:** **B1 và B2 đã cùng nằm trên nhánh này** (commit `7506f88` = B1, `0374cbf` + `37ba00e` + `c553bcf` = B2) ⇒ **AC-G36 KHÔNG chạy được** (tiền đề "B1 đã ship nhưng B2 chưa" không tồn tại). Nó bị **thay bởi AC-R9**: hộp thoại `rewind` **CÓ** câu "Không thể hoàn tác". Xem §7 và báo cáo bug #4 (doc drift).

## Loại verify

| Ký hiệu | Ý nghĩa |
|---|---|
| **S** | Static — đọc code / grep. |
| **A** | Cần chạy app (Electron + IPC thật): `pnpm dev` ở **root** repo. |
| **R** | Cần **khởi động lại app** — nhóm R kiểm chứng **đĩa**, không tin state bộ nhớ. |

---

## 0. Static gate (đã chạy 2026-08-27)

`pnpm lint` (ui-next) **PASS** · `pnpm typecheck` (ui-next) **PASS** · `pnpm typecheck` (sidecar) **PASS**.

⚠ **Chặn:** commit B1 (`7506f88`) kèm theo một hunk `streamDiag()` phụ thuộc `apps/desktop/ui-next/utils/stream-diag.ts` — file **chưa commit** ⇒ checkout sạch nhánh này **fail build**. Xem bug #1 ở báo cáo QA.

---

## 1. Chuẩn bị fixture

### G-30 — transcript 30 message, thao tác ở giữa
Cần biết chính xác `index` của từng message. Cách rẻ nhất: DevTools console → Vue DevTools chọn `SessionDetail` → đọc `session.msgs.length` và `data-mi` trên DOM (`document.querySelectorAll('[data-mi]')` → attribute `data-mi` là index tuyệt đối).

### G-MID — transcript có message **giữa** user turn và câu trả lời
Dựng hình `[… user@18, assistant@19, system@20, assistant@21]` (tổng 22):
1. Gửi 1 lượt (→ user@18, assistant@19).
2. Sinh một system divider: `/compact` hoặc một thao tác chèn system message (`system@20`).
3. Gửi tiếp một lượt rồi `rewind` sao cho chỉ còn assistant@21 phía sau — hoặc dựng trực tiếp bằng cách sửa JSONL khi app đóng rồi mở lại (an toàn hơn, số liệu chắc chắn).

### G-FORK-SYS — session vừa fork có **system message đã persist** (bắt buộc cho AC-R10/AC-R11)
1. Mở session có system message trong tiền tố (ví dụ có `/compact` divider), **ngay sau** system message đó là một lượt **user**.
2. Bấm **fork** ở một message phía sau system message đó.
3. Mở session fork → **khởi động lại app** (để mọi message mang `eid` đọc từ đĩa; `fork` chưa reload có ngoại lệ TL-2).
4. Kiểm tra hình dạng: `head -1` + đọc JSONL để chắc `[…, system, user, assistant, …]`.

### G-ENGINE-OFF — có message `ENGINE_UNAVAILABLE` cục bộ (bắt buộc cho AC-R8)
Kill sidecar (hoặc rút quyền chạy engine) → gửi 1 lượt → store chèn system message `ENGINE_UNAVAILABLE` **không** persist (không có `eid`) → khởi động lại sidecar/app **KHÔNG** được (message đó sẽ mất). ⇒ Chạy AC-R8 **trong cùng phiên**, và restart chỉ ở bước cuối.

### G-SPY — quan sát RPC
`window.awog` read-only ⇒ dùng **DevTools → Sources → breakpoint**: `sessions.rewind` / `sessions.truncate` (`stores/sessions.ts` trong `rewind`, `resend`, `regenerate`) và `persistBookmarks`. Đọc `keepThroughId` trực tiếp trên scope khi break.

---

## 2. AC đã PASS bằng static

| AC | Bằng chứng |
|---|---|
| **AC-G4** | `grep -rln useConfirm apps/desktop/ui-next/components/session/` ⇒ `SessionDetail`, `SessionList`, `SessionListItem`, `SessionTabBar` (đã có từ trước) + **`SessionMessageItem`** (mới). **Không** component modal xác nhận mới; `ConfirmDialogHost.vue` / `LibraryConfirmDelete.vue` **0 dòng thay đổi** trên nhánh. |
| **AC-G9** | Không có khoá i18n biến thể "0 message"; gate `if (lost === 0) { run(); return }` ⇒ chuỗi "0 tin nhắn" không render được. |
| **AC-G13/G14/G15/G16/G17/G18** (công thức) | `lostCountOf` (`SessionMessageItem.vue`): `rewind → msgs.length - i`; `resend`/`editResend → msgs.length - i - 1`; `regen → msgs.length - ui - 2` với `ui` = `nearestUserIndex` (lùi từ `i-1` tới `role === 'user'`), `-1` ⇒ không mở hộp thoại. Đơn vị đếm = phần tử `msgs` ⇒ turn 5 block = 1, system divider = 1. |
| **AC-G24** | Thay đổi logic duy nhất ở store = helper `lastPersistedEid()` + 3 call site (`rewind`, `regenerate`, `resend`) + prune bookmark (thuộc spec anh em). `regenInFlight`, guard streaming, thứ tự `await sessions.truncate → void sendMessage` **giữ nguyên**; `rewind` vẫn **đồng bộ**; **không** `useConfirm`/DOM trong store; grep công thức role-based `role === 'assistant' ? … : null` cho **0** kết quả nghiệp vụ (chỉ còn 1 comment cảnh báo + 1 helper `findStreamingMsg` không liên quan). |
| **AC-G27/G28/G29** | 6 điểm bấm mang `danger`: user `edit`/`send`/`rewind` (class cứng trong template) + assistant `refresh`/`settings`/`rewind` (`danger: true` trong `msgActions`). Rule `.hoveract .ha.danger:hover { background: var(--dangerBg); color: var(--danger) }`. Nút an toàn giữ `.hoveract .ha:hover { --bgHover / --text }`. |
| **AC-G30** | Chỉ dùng token `--dangerBg` / `--danger`; cả hai có ở `prototype.css` và `theme-cute.css` ⇒ không token mới, không hex. |
| **AC-G31** | Diff chỉ thêm `:class`; mọi `:title` giữ nguyên khoá cũ. |
| **AC-G32/G33** | `guardDialog`: 3 hành động chạy lại ghép `' ' + irreversible + '\n' + costNote` (đúng **một** dòng phụ); `rewind` ghép `body + ' ' + irreversible`, **không** `costNote`. |
| **AC-G34/G35** | 12 khoá `sessions.guard.*` đủ ở **en + vi**, khớp đúng bảng §13; nhãn xác nhận là `rewind.confirm` ("Cắt về đây"/"Rewind here") hoặc `rerun.confirm` ("Chạy lại"/"Re-run") — **không** dùng `common.delete`. |
| **AC-R4** (phần logic) | `keepThroughId`/nhánh `truncate` của `rewind` chỉ chạy khi `lastPersistedEid()` trả `null`, tức **kết quả vòng lùi**, không phải `role`. |
| **AC-R6** | `function rewind(id, index)` — không `async`, không `await`. |
| **AC-R5** | `truncateSession`: `idx < 0` ⇒ `return` (no-op), chỉ `keepThroughId === null` mới `messages = []` (`sidecar/src/sessions/store.ts`). |
| **AC-G19…G21 (hạ tầng)** | `AppGlobalHosts.vue` chứa `ConfirmDialogHost` + `ActionToastHost`; `pages/session.vue` (popout) mount `AppGlobalHosts` ⇒ hộp thoại + toast chạy được trong popout. Hành vi thực tế vẫn cần chạy app. |

---

## 3. Phạm vi gate — đếm được (QA-G1)

- **TC-G1 (AC-G1) — A.** G-30, thao tác ở **giữa** (mọi điểm bấm có `lostCount ≥ 1`). Bấm lần lượt: `rewind` (bong bóng user), `send`, `edit` (rồi xác nhận trong overlay), `refresh`.
  **Expected:** **cả 4** mở hộp thoại **trước** khi bất kỳ message nào biến mất (đếm `msgs.length` vẫn 30 trong lúc hộp thoại mở).

- **TC-G2 (AC-G2) — A.** Cùng session, bấm lần lượt: `copy`, `quote`, `maximize` (fullscreen câu trả lời), `layers` (fullscreen cả lượt), `fork`, `branch`, `settings` (Thử model khác).
  **Expected:** **không nút nào** mở hộp thoại — đúng **7 điểm bấm / 6 hành động**. `settings` **chạy ngay** (truncate + tốn 1 lượt model) — đúng thiết kế, **không** phải bug.

- **TC-G3 (AC-G3) — A.** Đếm điểm bấm mở hộp thoại: footer assistant giữa transcript; footer user bubble.
  **Expected:** assistant đúng **2** (`refresh`, `rewind`); user bubble đúng **3** (`edit`, `send`, `rewind`).

- **TC-G4 (AC-G4) — S.** `grep -rn 'useConfirm' apps/desktop/ui-next/components/session/`.
  **Expected:** không file modal xác nhận mới; chỉ dùng lại `useConfirm()` + `ConfirmDialogHost`.

## 4. Quy tắc `lostCount === 0` (QA-G1)

- **TC-G5 (AC-G5) — A.** Turn **cuối** là một lượt **lỗi** → bấm "Thử lại" trong khối lỗi (`SessionMessageItem` khối error) và cả `onRetry` của `SessionGateCard`.
  **Expected:** chạy lại **ngay**, **không** hộp thoại (`lostCount = 0`).
- **TC-G6 (AC-G6) — A.** `refresh` trên câu trả lời **cuối cùng** (không lỗi), phía sau không còn message.
  **Expected:** tạo lại ngay, không hộp thoại.
- **TC-G7 (AC-G7) — A.** `send` trên bong bóng user **cuối cùng** chưa có trả lời.
  **Expected:** gửi lại ngay, không hộp thoại.
- **TC-G8 (AC-G8) — A.** Lượt lỗi **không phải** message cuối (đã có message sau nó) → "Thử lại".
  **Expected:** hộp thoại `regenerate` hiện, con số đúng theo công thức `msgs.length - ui - 2`.
- **TC-G9 (AC-G9) — A.** Đọc mọi hộp thoại xuất hiện trong TC-G1…TC-G8.
  **Expected:** **không bao giờ** thấy "0 tin nhắn" / "0 messages".
- **TC-G10 (E6) — A.** Transcript có message **đầu tiên là assistant/system** (dựng bằng JSONL) → `refresh` trên assistant đó khi **không có** user turn phía trước.
  **Expected:** **không** hộp thoại **và không** gọi store ⇒ transcript **không** bị cắt trong bộ nhớ (đây còn là cải thiện thật so với hiện trạng cũ).

## 5. Huỷ = không mất gì (QA-G1)

- **TC-G11 (AC-G10) — A.** G-30, hộp thoại `rewind@18` mở → bấm **"Hủy"**.
  **Expected:** transcript đủ **30**; breakpoint `sessions.rewind`/`sessions.truncate` **không** break; `persistBookmarks` **không** break ⇒ **không bookmark nào bị prune** (giao thoa AC-P1 của spec anh em).
- **TC-G12 (AC-G11) — A.** Hộp thoại mở → `Esc`; lặp lại → click vùng scrim.
  **Expected:** giống bấm "Hủy" (không cắt gì).
- **TC-G13 (AC-G12) — A.** `edit` → sửa nội dung trong overlay → xác nhận overlay → hộp thoại hiện → bấm **"Hủy"**.
  **Expected:** transcript nguyên vẹn **và** bong bóng user giữ **nội dung cũ** (bản sửa bị bỏ, không lưu nháp).
- **TC-G14 (§4.5) — A.** `edit` → **huỷ overlay** (Esc/Cancel trong overlay).
  **Expected:** thoát im lặng, **không** hiện hộp thoại xác nhận.

## 6. Con số phải đúng (QA-G1)

- **TC-G15 (AC-G13) — A.** G-30, `rewind` tại index **18** ⇒ nội dung nêu **12**.
- **TC-G16 (AC-G14) — A.** G-30, `resend` ở bong bóng user index **12** ⇒ nêu **17** (không tính chính tin nhắn được gửi lại).
- **TC-G17 (AC-G15) — A.** G-30, `regenerate` tại assistant index **21**, user turn gần nhất index **20** ⇒ nêu **8**.
- **TC-G18 (AC-G16) — A. ⚠ CA CHỐNG GIẤU SỐ.** G-MID (`[… user@18, assistant@19, system@20, assistant@21]`, tổng 22) → `regenerate@21`.
  **Expected:** nêu đúng **2** (assistant@19 + system@20). Nếu thấy **0** ⇒ công thức đã bị rút gọn sai thành `msgs.length - i - 1`.
- **TC-G19 (AC-G17) — A.** Có **system divider** giữa điểm neo và cuối transcript.
  **Expected:** divider **được tính** là 1 message.
- **TC-G20 (AC-G18) — A.** Turn assistant gồm **5 block** (tool + thinking + text) nằm trong vùng bị cắt.
  **Expected:** đếm là **1**, không phải 5.

## 7. Nội dung hộp thoại + i18n (QA-G3)

- **TC-G21 (§7.1, AC-R9) — A. ⚠ KỲ VỌNG ĐÃ ĐẢO.** Mở hộp thoại `rewind`.
  **Expected:** tiêu đề **"Tua về đây?"**; nội dung **"Sẽ xoá {n} tin nhắn từ điểm này trở đi. Không thể hoàn tác."** — **CÓ** câu "Không thể hoàn tác" (vì B2 đã merge và cắt đĩa đã vô điều kiện); **KHÔNG** có dòng nhắc chi phí; nút **"Cắt về đây"** (đỏ) + **"Hủy"**.
  **AC-G36 (bản cũ) KHÔNG chạy** — tiền đề "B1 đã ship, B2 chưa" không tồn tại trên nhánh này.
- **TC-G22 (§7.2, AC-G32) — A.** Mở hộp thoại `resend` và `edit & resend`.
  **Expected:** tiêu đề **"Gửi lại tin nhắn này?"** / **"Sửa & gửi lại?"**; nội dung `Sẽ xoá {n} tin nhắn sau tin nhắn này. Không thể hoàn tác.` + **xuống dòng** + `Lượt chạy lại sẽ tốn thêm một lần gọi model.` (đúng **một** dòng phụ; `pre-wrap` render `\n`); nút **"Chạy lại"**.
- **TC-G23 (§7.3) — A.** Mở hộp thoại `regenerate`.
  **Expected:** `Câu trả lời này sẽ bị thay thế và {n} tin nhắn khác bị xoá. Không thể hoàn tác.\nLượt chạy lại sẽ tốn thêm một lần gọi model.`
- **TC-G24 (AC-G33) — A.** So `rewind` với 3 hộp thoại kia.
  **Expected:** `rewind` **không** có dòng nhắc chi phí.
- **TC-G25 (AC-G34, AC-G35) — A.** Đổi app sang **en** → mở cả 4 hộp thoại.
  **Expected:** toàn bộ tiêu đề / nội dung / 2 nhãn nút là tiếng Anh; nhãn xác nhận **"Rewind here"** / **"Re-run"** — **không bao giờ** "Delete".
- **TC-G26 (AC-G27, AC-G29) — A.** Hover lần lượt **6 điểm bấm** destructive rồi **6 nút an toàn**.
  **Expected:** destructive ra nền `--dangerBg` + chữ `--danger`; an toàn giữ `--bgHover` + `--text`.
- **TC-G27 (AC-G28) — A. ⚠ ĐIỂM DỄ SÓT NHẤT.** Hover **riêng** nút `settings` ("Thử model khác").
  **Expected:** ra màu **danger** y như `refresh`/`rewind`, **dù** nó **không** mở hộp thoại (đối chiếu TC-G2). Nó truncate + tốn 1 lượt model nên phải nhìn thấy nguy hiểm trước khi click.
- **TC-G28 (AC-G30) — A.** Bật theme family **Cute** → lặp TC-G26 + TC-G27.
  **Expected:** vẫn ra danger.
- **TC-G29 (AC-G31) — A/S.** Đọc DOM (`title`) của 9 nút footer.
  **Expected:** `title` **không đổi** so với trước feature (chỉ màu hover đổi).

## 8. Popout (QA-G2)

- **TC-G30 (AC-G19) — A. ⚠ CA BẮT BUỘC.** Pop out session ra cửa sổ riêng (`/session?id=…`) → bấm `rewind` trong cửa sổ đó → xác nhận.
  **Expected:** hộp thoại **hiện trong chính cửa sổ popout**; "Cắt về đây" cắt đúng transcript; **không treo, không im lặng**.
- **TC-G31 (AC-G20) — A.** Hộp thoại đang mở trong popout → nhìn cửa sổ chính.
  **Expected:** cửa sổ chính **không** hiện hộp thoại nào, vẫn ở trạng thái hand-off (placeholder).
- **TC-G32 (AC-G21) — A.** Trong popout: mở hộp thoại rồi làm transcript đổi (gửi tin từ chính popout ở tab khác / một lượt mới nối vào) → xác nhận.
  **Expected:** toast `sessions.guard.stale` ("Transcript đã thay đổi — thao tác bị huỷ.") hiện **trong popout**.
- **TC-G33 (E13) — A.** Session đã pop out; ở **cửa sổ chính** thử bấm hành động destructive.
  **Expected:** cửa sổ chính hiển thị placeholder hand-off ⇒ **không có footer** ⇒ không có đường bấm.

## 9. Race / re-entry (QA-G2)

- **TC-G34 (E2, §4.6) — A.** Mở hộp thoại `rewind` → **gửi tin nhắn mới** → mới bấm xác nhận.
  **Expected:** **không cắt gì** + toast `sessions.guard.stale`. Con số trên hộp thoại không bao giờ được dùng để cắt một transcript khác.
- **TC-G35 (E3) — A.** Mở hộp thoại → **đổi sang session khác** → xác nhận.
  **Expected:** **không cắt nhầm session** + toast.
- **TC-G36 (E4, AC-G22) — A. ⚠ `rewind` không có guard streaming ở store ⇒ §4.6 là lớp duy nhất.** Một turn đang **streaming**; bấm `rewind` / `send` / `edit` trên một bong bóng **user cũ** (footer user **không** bị ẩn khi streaming) → xác nhận.
  **Expected:** **không message nào bị cắt** + toast giải thích.
- **TC-G37 (E1, AC-G25) — A.** Double-click nhanh cùng một nút destructive.
  **Expected:** tối đa **1** hộp thoại trên màn hình (cái đầu tự resolve `false`), tối đa **1** hành động thực thi.
- **TC-G38 (AC-G26) — A.** Hộp thoại `rewind` đang mở → click nút `refresh` của **message khác**.
  **Expected:** hộp `rewind` biến mất **và không cắt gì**, thay bằng hộp `regenerate` với con số của nó.
- **TC-G39 (AC-G23) — A.** Xác nhận một `regenerate` → trong lúc còn trong cửa sổ `await sessions.truncate`, bấm `refresh` lần nữa và xác nhận.
  **Expected:** **không** lượt model thứ hai (`regenInFlight` vẫn chặn).
- **TC-G40 (E9) — A.** Session đang `loading` / là placeholder hand-off.
  **Expected:** không footer ⇒ không đường bấm; guard phòng thủ (`store.active == null || i < 0 || i >= msgs.length`) ⇒ **không** hộp thoại, **không** hành động.
- **TC-G41 (E10) — A.** Ngắt mạng / kill sidecar → bấm `rewind` → xác nhận.
  **Expected:** hộp thoại vẫn hiện (100% client-side), huỷ được; nếu xác nhận thì phần cắt đĩa thất bại rơi về hành vi cũ (`console.warn` ở nhánh catch) — feature này **không** đổi xử lý lỗi đó.
- **TC-G42 (E11) — R.** Mở hộp thoại rồi **kill app** giữa chừng.
  **Expected:** mở lại: không còn dialog; **transcript nguyên vẹn** (bước cắt chưa chạy).
- **TC-G43 (E12) — A.** Transcript rất dài (~5.000 message, dựng bằng JSONL) → mở hộp thoại `regenerate` giữa transcript.
  **Expected:** hộp thoại hiện < 1 frame; không đứng hình (phép trừ O(1); vòng lùi tìm `ui`/`eid` thực tế < 20 bước).

---

## 10. Nhóm R — persist trên đĩa (QA-R). **MỌI CA VERIFY BẰNG RESTART APP.**

> Đo bằng: (1) đếm message trên UI sau restart; (2) `awk 'NR>1' ~/.awog/sessions/<id>/session.jsonl | wc -l`; (3) `keepThroughId` / `messageId` đọc tại breakpoint.
> **Nếu bất kỳ ca nào ra 0 message ngoài AC-R3 ⇒ DỪNG, rollback:** đó là bẫy wipe của §4.8.

- **TC-R1 (AC-R1) — R.** Transcript 30 message, `msgs[17]` là **assistant có `eid`** → `rewind@18` → xác nhận → **restart app**.
  **Expected:** còn **đúng 18** message. RPC gửi là `sessions.rewind` với `messageId` = `eid` của `msgs[17]`.
- **TC-R2 (AC-R2) — R. ⚠ CA PHỔ BIẾN NHẤT.** `msgs[17]` là **user** (rewind trên turn assistant) → `rewind@18` → xác nhận → **restart app**.
  **Expected:** còn **đúng 18** message — **không 30** (bug cũ "bộ nhớ cắt, đĩa không") và **không 0** (bẫy `keepThroughId: null`). RPC = `sessions.rewind` với `messageId` = `eid` của message user đó.
- **TC-R3 (AC-R3, E7) — R.** `rewind` tại index **0** → xác nhận → **restart app**.
  **Expected:** transcript **rỗng**; RPC là `sessions.truncate` với `keepThroughId: null` (vì `sessions.rewind` không diễn đạt được "cắt sạch": `messageId` bắt buộc `min(1)`).
- **TC-R4 (AC-R8, E8) — R.** G-ENGINE-OFF: message `ENGINE_UNAVAILABLE` cục bộ **ngay trước** điểm rewind → `rewind` → xác nhận → **restart app**.
  **Expected:** neo lùi tới message **có `eid`** gần nhất phía trước; transcript sau restart = đúng phần đáng lẽ còn lại (thiếu **đúng** dòng thông báo cục bộ, vì nó chưa bao giờ nằm trên đĩa) — **không wipe**, **không giữ nguyên 30**.
- **TC-R5 (AC-R4) — A.** Đọc payload ở **mọi** ca R (R1…R4, R6, R7).
  **Expected:** `keepThroughId: null` (và nhánh `truncate` của `rewind`) **chỉ** xuất hiện ở TC-R3 — ca duy nhất mà toàn bộ tiền tố không có `eid` nào.
- **TC-R6 (AC-R10) — R. ⚠ CA WIPE CŨ.** G-FORK-SYS: transcript `[…, system (đã persist), user, assistant, …]` → bấm **`send` (resend)** trên bong bóng **user đứng ngay sau system message** → xác nhận → **restart app**.
  **Expected:** transcript trên đĩa giữ **đúng tiền tố tới hết system message**, rồi tiếp bằng lượt vừa chạy lại — **KHÔNG rỗng**. `keepThroughId` = `eid` của **system message** đó.
  *(Trước khi vá: `prev.role === 'system'` ⇒ `keepThroughId = null` ⇒ `messages = []` ⇒ transcript trống trơn sau restart.)*
- **TC-R7 (AC-R11) — R.** Cùng hình dạng G-FORK-SYS → bấm **`refresh` (regenerate)** trên turn assistant mà user turn gần nhất phía trước là bong bóng user đứng ngay sau system message → xác nhận → **restart app**.
  **Expected:** giữ **đúng tiền tố tới hết system message** — **KHÔNG rỗng**, và **không** mất thêm message nào phía trước điểm neo.
- **TC-R8 (AC-R5) — A.** Gửi payload `sessions.rewind` với `messageId` mà engine không biết (gọi RPC trực tiếp).
  **Expected:** transcript trên đĩa **không đổi** (no-op), **không wipe**.
- **TC-R9 (AC-R6) — S.** Đọc `rewind` trong `stores/sessions.ts`.
  **Expected:** vẫn **đồng bộ** (`function rewind(id, index)`), dùng `pushRequest` fire-and-forget.
- **TC-R10 (AC-R7 — cổng tiên quyết) — A.** Mở một session **dài** qua `ensureLoaded` → console: đếm message thiếu `eid`.
  **Expected:** **mọi** message có `eid`, **trừ** system message cục bộ `ENGINE_UNAVAILABLE`. Nếu tìm thấy message **persist** nào thiếu `eid` ⇒ **DỪNG, báo tech-lead** (đừng tự mở rộng vòng lùi).
  **Ngoại lệ đã biết (TL-2, không chặn):** session **vừa fork chưa reload** — dòng `ENGINE_UNAVAILABLE` đã nằm trên đĩa dưới id `fm-<i>-<seq>` nhưng bộ nhớ không có `eid` ⇒ đĩa bị cắt nhiều hơn bộ nhớ **đúng một** dòng thông báo lỗi. Ghi nhận, không rollback.
- **TC-R11 (AC-R9) — A + R.** Mở hộp thoại `rewind` (TC-G21) **và** chạy TC-R1…TC-R3 trong cùng một đợt.
  **Expected:** hộp thoại **CÓ** câu "Không thể hoàn tác" **và** R1…R3 pass ⇒ câu đó **đúng sự thật**.
- **TC-R12 (hồi quy B2.1) — R.** `resend` / `edit & resend` / `regenerate` ở các hình dạng **thường** (prev là assistant có `eid`).
  **Expected:** vẫn cắt đĩa đúng như trước B2 (không thừa, không thiếu); sau restart số message khớp UI.

---

## 11. Giao thoa với spec anh em (thứ tự §6)

- **TC-X1 (§6 thứ tự bắt buộc) — A.** Session có bookmark ở phần sẽ bị cắt; đặt breakpoint theo thứ tự: `confirm` → so lại `msgs.length` → `persistBookmarks` → `sessions.truncate`/`sessions.rewind`.
  **Expected:** thứ tự break đúng **0→1→2→3/4→5**: `lostCount` → `confirm` → so lại → prune bookmark → cắt. **Không** đảo.
- **TC-X2 (AC-G10 + AC-P1) — A.** Huỷ hộp thoại.
  **Expected:** bookmark **KHÔNG** bị prune (bước 3-4 chưa chạy) — cả hai spec cùng đúng.

## 12. Static gate cuối

```bash
cd apps/desktop/ui-next && pnpm lint && pnpm typecheck
grep -rn "role === 'assistant' ?" apps/desktop/ui-next/stores/sessions.ts   # chỉ comment + findStreamingMsg
grep -rln 'useConfirm' apps/desktop/ui-next/components/session/             # không file modal mới
git diff --stat <base>..HEAD -- apps/desktop/sidecar apps/desktop/electron   # B1/B2 không được chạm (T0c của spec A thì có)
```
