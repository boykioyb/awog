# Test Plan: Sửa trigger `/` và `@` của Session composer

> **Spec:** [composer-trigger-fixes.md](./composer-trigger-fixes.md) · **Plan:** [composer-trigger-fixes.tasks.md](./composer-trigger-fixes.tasks.md) (T4)
> **Build:** nhánh `fix/composer-trigger-fixes` (chưa commit)
> **Tester:** QA (trace code + unit test); phần test tay chưa chạy
> **Last run:** 2026-10-06

## Setup

- Chạy app Electron (không phải `pnpm dev` trên browser: `selectionchange` và IME phải đo trên Chromium của Electron 33). Settings → Defaults → `composerSendKey = enter` trừ khi ca ghi khác.
- Project có file `src/a.ts`, `src/b.ts`, `README.md`, `foo.ts`; một agent handle `ui-designer`; một trang wiki `architecture/overview.md`; một lệnh/skill/CLI `evon:ui-ux` là mục DUY NHẤT khớp tiền tố `evon` (nếu không có, tạo user command `~/.claude/commands/evon/ui-ux.md` hoặc thay bằng tên lệnh thật có trên máy).
- Một user command có body dùng `$ARGUMENTS`, `$1`, `$2` (cho AC-R1).
- Mở DevTools của cửa sổ (Console + Elements) để bắt lỗi console và kiểm font.
- Ký hiệu `|` = vị trí con trỏ. Sau mỗi ca: Esc + xoá draft trước ca kế tiếp.

## Kết quả trace code (tĩnh)

| Nhóm | PASS tĩnh | CẦN TEST TAY | FAIL |
|---|---|---|---|
| B (AC-B1…B20) | B1–B10, B13–B20 | B9, B11 (phụ thuộc `selectionchange` trên Electron) | — |
| D (AC-D1…D14) | D1–D8, D10, D12–D14 | D9, D11 (`selectionchange`), D8 (khối trang thật) | — |
| C (AC-C1…C10) | C4, C5, C6, C7, C10 (cấu trúc) | C1, C2, C3, C8, C9 (bố cục) | — |
| Hồi quy (AC-R1…R7) | R1–R7 | R6 (click chuột thật) | — |
| IME (AC-I1…I4) | guard có ở Enter/↑/↓/Esc | I1–I4 toàn bộ | xem Bug #2 (click mục menu lúc đang soạn) |

## Test case tay

### TC1 — Kịch bản người dùng báo: `/evon:ui-ux` + prompt dài (AC-B2…B5, AC-C1…C4)
**Steps:**
1. Ô soạn trống, gõ `/evo`. Quan sát menu `/` chỉ còn mục khớp `evo`.
2. Nhấn Enter (hoặc click mục `evon:ui-ux`).
3. Quan sát draft là `/evon:ui-ux ` (một space đuôi), con trỏ sau space, menu đóng.
4. Gõ từng ký tự `review trang login và kiểm tra lại toàn bộ luồng đăng nhập, quên mật khẩu, đăng ký` — quan sát menu sau MỖI phím.
5. Nhấn Shift+Enter, gõ `Dòng thứ hai`, Shift+Enter, gõ `Dòng thứ ba`.
6. Nhấn Enter đúng một lần.
**Expected:** bước 4–5 menu `/` không bao giờ mở; bước 6 tin được gửi ngay, ô soạn trống. Bubble: dòng đầu là chip mono `⌘ /evon:ui-ux` nằm trọn một dòng (không bẻ ở `-`/`:`); từ dòng 2 là toàn bộ prompt bằng font hệ thống, đủ chữ, không có `…`, giữ 3 dòng đúng chỗ người dùng ngắt. Hover chip thấy body đã expand.

### TC2 — Lệnh khớp chính xác cần hai Enter (AC-B6…B8)
**Steps:** gõ `/evon:ui-ux` (không space) → quan sát → Enter → quan sát → Enter.
**Expected:** sau khi gõ: menu mở, highlight `evon:ui-ux`. Enter 1: draft `/evon:ui-ux `, menu đóng, KHÔNG có bubble mới. Enter 2: gửi tin `/evon:ui-ux`, bubble chỉ có chip, không có dòng trống bên dưới (AC-C6).

### TC3 — Click vào giữa token lệnh (AC-B9, AC-B10) — kiểm `selectionchange`
**Steps:**
1. Gõ `/evo fix bug` (menu đóng vì con trỏ ở cuối, sau space).
2. Click chuột đặt con trỏ ngay sau `/evo`. Quan sát menu (phải VẪN đóng — di chuyển con trỏ không mở menu).
3. Gõ `n:`. Quan sát menu.
4. Chọn `evon:ui-ux` bằng Enter. Gõ thử một ký tự `X`.
**Expected:** bước 2 menu đóng; bước 3 menu mở lọc `evon:`; bước 4 draft thành `/evon:ui-ux fix bug`, chữ `X` xuất hiện ngay trước `fix` (`/evon:ui-ux Xfix bug`).

### TC4 — End đóng menu, Enter gửi (AC-B11, AC-B12) — kiểm `selectionchange` bằng phím
**Steps:** gõ `/evo fix`, click đặt con trỏ sau `/evo`, xoá `o` rồi gõ lại `o` để menu mở (draft `/evo| fix`), nhấn End, quan sát menu, nhấn Enter.
**Expected:** sau End menu đóng ngay (không cần gõ thêm); Enter gửi tin `/evo fix` như văn bản, không chèn mục nào. Lặp lại thay End bằng: → nhiều lần qua space, ⌘→, click chuột vào cuối — mỗi cách đều phải đóng menu. Nếu một cách KHÔNG đóng menu ⇒ ghi bug (fallback `@click` + `@keyup` theo spec T3).

### TC5 — Shift+Enter sau lệnh (AC-B13, AC-R4)
**Steps:** gõ `/evon:ui-ux` (menu mở), nhấn Shift+Enter, gõ `chi tiết`.
**Expected:** Shift+Enter chèn xuống dòng, không chọn mục; menu đóng và không mở lại khi gõ `chi tiết`.

### TC6 — Built-in gõ tay (AC-B14…B17, E9, E10)
**Steps & Expected:**
1. `/compact` + Enter ⇒ compact chạy, không có bubble.
2. `/plan fix bug` + Enter (menu đóng vì con trỏ sau space) ⇒ chế độ chuyển Plan, draft còn `fix bug`, không có bubble, không có lượt model.
3. `/Plan fix` + Enter ⇒ như bước 2 (so khớp không phân biệt hoa thường).
4. `/pla fix` + Enter ⇒ gửi tin `/pla fix` như văn bản.
5. `/browser example.com` + Enter ⇒ tab Browser mở `example.com`, draft trống, không có bubble.
6. `/xyz` (menu đóng vì không khớp) + Enter ⇒ gửi như văn bản.
7. **Nút Gửi:** gõ `/plan fix bug` rồi BẤM NÚT GỬI (không Enter) ⇒ ghi nhận kết quả (xem Bug #1: hiện code gửi cho model như văn bản, trái ghi chú T6 của spec).

### TC7 — Nút `+` → Insert `/` (AC-B18, AC-B19)
**Steps & Expected:**
1. Draft rỗng ⇒ Insert `/` ⇒ draft `/`, con trỏ sau `/`, menu mở đầy đủ (built-in đứng đầu).
2. Draft `fix bug` ⇒ Insert `/` ⇒ draft `/fix bug`, con trỏ ngay sau `/fix` (gõ thử `X` ⇒ `/fixX bug`), menu mở lọc `fix` nếu có mục khớp, không có thì đóng.
3. Draft `/evon:ui-ux review` ⇒ Insert `/` ⇒ draft không đổi, con trỏ ngay sau `/evon:ui-ux`, menu mở lọc theo `evon:ui-ux`.

### TC8 — Kịch bản người dùng báo: `@` giữa câu (AC-D3, AC-D4, flow D)
**Steps:**
1. Gõ `So sánh @src/a.ts với  rồi xem @wiki:x` (hai space giữa `với` và `rồi`).
2. Click đặt con trỏ giữa hai space đó. Quan sát: menu KHÔNG mở.
3. Gõ `@b`. Quan sát menu mention lọc theo `b`.
4. Chọn `src/b.ts` bằng Enter. Gõ thử `X`.
5. Lặp lại bước 1–4 nhưng chọn bằng CLICK chuột vào mục (AC-R6).
**Expected:** draft `So sánh @src/a.ts với @src/b.ts rồi xem @wiki:x` — đúng một space trước `rồi`, `@src/a.ts` và `@wiki:x` không đổi từng ký tự; menu đóng; `X` xuất hiện ngay trước `rồi`. Click và Enter cho kết quả giống hệt.

### TC9 — Mention đầu / cuối / giữa dòng của draft nhiều dòng (AC-D1, D2, D3, D7)
**Steps & Expected:**
1. `@sr|` → chọn `src/a.ts` ⇒ `@src/a.ts ` con trỏ cuối.
2. `Review @rea|` → `README.md` ⇒ `Review @README.md ` con trỏ cuối.
3. `Sửa @ui| cho đẹp` (đặt con trỏ bằng click sau `@ui`, xoá rồi gõ lại `i` để mở menu) → agent `ui-designer` ⇒ `Sửa @ui-designer cho đẹp`, con trỏ trước `cho`.
4. Draft 3 dòng `Dòng 1` / `Xem @fo` / `Dòng 3`, con trỏ cuối dòng 2 → `foo.ts` ⇒ dòng 2 `Xem @foo.ts ` (space đuôi), dòng 1 và 3 nguyên, con trỏ ở dòng 2.

### TC10 — Con trỏ giữa token (AC-D5, AC-D6)
**Steps:** gõ `Đọc @wiki:architecture giúp`, click đặt con trỏ ngay sau `@wiki:arch`, xoá `h` rồi gõ lại `h` (mở menu bằng input), quan sát, chọn `architecture/overview.md`.
**Expected:** menu lọc theo `wiki:arch`; kết quả `Đọc @wiki:architecture/overview.md giúp`, không còn mảnh `itecture`.

### TC11 — `@page` (AC-D8)
**Pre:** tab Browser của session đang mở một trang thật (vd `example.com`).
**Steps:** gõ `Tóm tắt @pa giúp tôi` với con trỏ sau `@pa` (mở menu bằng input), chọn mục `@page`.
**Expected:** draft còn `Tóm tắt giúp tôi` (một space) rồi khối context trang được nối vào CUỐI draft; không lỗi console. Lặp lại khi Browser không có trang ⇒ toast, draft `Tóm tắt giúp tôi`, con trỏ ở vị trí `@` cũ.

### TC12 — Di chuyển con trỏ khi menu `@` mở (AC-D9…D11, E12) — kiểm `selectionchange`
**Steps & Expected:**
1. `Xem @fo| và sửa` (menu mở) → click vào giữa chữ `sửa` ⇒ menu đóng; Enter ⇒ gửi tin, không chèn mention.
2. `@foo|` (menu mở) → ← một lần ⇒ menu vẫn mở, lọc theo `fo`, highlight về mục đầu.
3. `@fo|` (menu mở) → ↓ hai lần (highlight mục 3) → click chuột vào đúng vị trí con trỏ hiện tại ⇒ menu mở, highlight VẪN mục 3 (R-X3).
4. `@fo|` (menu mở) → Shift+← ⇒ menu đóng. ⌘A ⇒ menu đóng.
5. Gõ nhanh `@src/` liên tục rồi ↓ ngay ⇒ highlight ở mục 2, không bị nhảy về mục đầu sau khi dừng gõ (thứ tự `input` → `selectionchange` bất đồng bộ).

### TC13 — Click mention cũ khi menu đóng (AC-D12), email (AC-D13), Insert `@` (AC-D14)
**Steps & Expected:**
1. `Xem @src/a.ts rồi` (menu đóng) → click vào giữa `@src/a.ts`, ←/→ qua lại ⇒ menu KHÔNG mở; Enter gửi tin.
2. `liên hệ a@b` ⇒ không menu nào mở.
3. `Xem @fo` → `+` → Insert `@` ⇒ draft `Xem @fo @`, con trỏ cuối, menu mở.

### TC14 — Mention trong draft có lệnh (AC-B20)
**Steps:** `/evo` → chọn `evon:ui-ux` → gõ `review @sr` → chọn `src/a.ts` → gõ `tiếp` → Enter.
**Expected:** khi gõ `@sr` menu MENTION mở (không phải menu `/`); draft `/evon:ui-ux review @src/a.ts tiếp`; gửi được; bubble chip `/evon:ui-ux` + args `review @src/a.ts tiếp`.

### TC15 — Bố cục chip (AC-C1, C2, C3, C8, C9, E18)
**Steps & Expected:**
1. Kéo panel chat hẹp nhất cho phép (mở Workspace Panel kéo rộng tối đa), xem bubble TC1 ⇒ `/evon:ui-ux` một dòng.
2. Gửi `/evon:ui-ux` + args 600 ký tự (một đoạn liền) ⇒ đủ chữ, không `…`, không thanh cuộn ngang, không tràn mép bubble.
3. Args chứa `https://example.com/very/long/path/...` dài hơn bubble ⇒ là link bấm được, xuống dòng trong bubble.
4. Tạo user command tên 120 ký tự không có khoảng trắng/dấu gạch (vd `aaaa…`) và gửi ⇒ chip không vượt mép bubble, tên kết thúc `…`, không bẻ dòng.
5. DevTools: chip `font-family` = mono (`--code`), `.ucmd-args` = font hệ thống, cỡ/màu giống `SessionLinkedText` của tin thường.
6. Lặp lại 1–4 ở theme `cute`, ở cửa sổ popout session, và ở board thread readonly.

### TC16 — Session cũ (AC-C10)
**Steps:** checkout `main`, gửi `/evon:ui-ux review cũ` trong một session, quay về nhánh này, mở lại session đó.
**Expected:** tin cũ hiển thị chip + args bên dưới, không lỗi console.

### TC17 — Hồi quy gửi (AC-R1, AC-R5, AC-R7)
**Steps & Expected:**
1. So `text` + `command` gửi đi (log `sessions.sendMessage` trong DevTools Network/IPC hoặc JSONL session) giữa `main` và nhánh này cho: `/cmd a b` (body `$ARGUMENTS`/`$1`/`$2`), `/evon:ui-ux text` (CLI native), `Xem @src/a.ts` ⇒ giống hệt. Thêm ca skill: `/sk` → chọn một skill, gõ args, Enter ⇒ so `text` (nhánh skill gửi draft THÔ — xem Note).
2. `composerSendKey = shift-enter`, menu đóng: Enter ⇒ xuống dòng; Shift+Enter ⇒ gửi.
3. Session đang stream, draft `/evon:ui-ux thêm ý` (menu đóng) + Enter ⇒ đi steer/queue như tin thường.
4. Menu mở ≥ 3 mục: ↓↓↓↑ ⇒ highlight vòng quanh đúng, con trỏ textarea đứng yên; Esc ⇒ menu đóng, draft không đổi.

### TC18 — IME (AC-I1…I4, E6) — bắt buộc trên macOS thật
**Pre:** bật input source "Vietnamese – Telex" của macOS (có chữ gạch chân khi soạn) và "Japanese – Romaji".
**Steps & Expected:**
1. Telex: gõ `/evo` sao cho đang còn gạch chân, menu mở ⇒ Enter chốt chữ: chữ được chốt, KHÔNG chọn mục, không gửi. Enter lần nữa ⇒ chọn mục (AC-I4).
2. Telex: gõ `@ti` đang gạch chân, menu mở ⇒ Enter chốt chữ, không chọn mục.
3. Telex: menu đóng, gõ `xin chào` đang gạch chân ⇒ Enter chốt chữ, không gửi (AC-I2). Enter lần nữa ⇒ gửi.
4. Japanese: gõ `@` rồi soạn `kanji` đang có danh sách ứng viên ⇒ ↑/↓ đổi ứng viên IME, highlight menu đứng yên (AC-I3); Esc huỷ soạn, menu vẫn mở.
5. Telex: gõ `Xem @tin` đang gạch chân rồi CLICK chuột vào một mục file trong menu ⇒ ghi lại draft cuối cùng sau khi chốt (xem Bug #2: nghi ra `@@…` hoặc mất mention).
6. Quan sát trong lúc đang soạn: menu có lọc theo chữ đang gạch chân không (v-model không cập nhật draft khi đang soạn ⇒ dự đoán menu hiện danh sách chưa lọc cho tới khi chốt — ghi nhận, hành vi có từ trước).

### TC19 — Edge (E7, E14, E15, E17, hiệu năng)
**Steps & Expected:**
1. E7: chèn mention giữa câu rồi ⌘Z ⇒ không mất text ngoài vùng token, không lỗi console (ghi lại hành vi thực tế).
2. E14: `xem @fo|.` → `foo.ts` ⇒ `xem @foo.ts `. E15: `@fo|,` → `foo.ts` ⇒ `@foo.ts ,`.
3. E17: con trỏ trong `@fo|`, dán `o` ⇒ menu lọc lại theo `foo`; dán đoạn lớn (≥ ngưỡng paste-as-file) ⇒ thành file đính kèm, draft + menu không đổi.
4. Dán draft 5.000 ký tự rồi gõ liên tục ở cuối và ở giữa ⇒ không giật; mở `@` ở giữa draft dài ⇒ menu bật tức thì.

## Bug

### #1 — Nút Gửi bỏ qua R-B7 (built-in gõ tay)
**Severity:** S3 (không có AC nào ghi Nút Gửi; nhưng trái ghi chú T6 của spec, và không phải hồi quy — trước sửa cũng vậy)
**Steps:** draft `/plan fix bug` → bấm nút Gửi (idle).
**Expected (theo spec T6):** dispatch Plan, draft còn `fix bug`.
**Actual (trace):** nút Gửi gọi thẳng `sendNow` (`SessionComposer.vue:556`), không qua `send()` (`:1355`) ⇒ `dispatchBuiltinDraft` không chạy ⇒ `/plan fix bug` gửi cho model như văn bản. Cùng lỗi với `/compact`, `/browser url` qua nút Gửi.

### #2 — Chọn mục `@` bằng click khi IME đang soạn: token neo sai
**Severity:** S3 (cần xác nhận trên máy thật — TC18 bước 5)
**Steps:** IME đang soạn (`Xem @` đã chốt, `ti` còn gạch chân), menu `@` mở, click một mục.
**Expected:** mention chèn đúng một `@`.
**Actual (trace):** `vModelText` không cập nhật `draft` khi `el.composing` nhưng `collapsedCaret()` (`SessionComposer.vue:1429`) đọc `selectionStart` theo `el.value` ⇒ caret > `draft.length` ⇒ `mentionTokenAt('Xem @', 7)` trả `start = 6` (không trỏ vào `@`) ⇒ `replaceMention` ra `Xem @@tiny.ts `. Unit test `QA mentionTokenAt: caret past draft end…` FAIL. Thêm nữa `beforeUpdate` của v-model bỏ qua patch khi đang soạn và `compositionend` ghi đè draft bằng `el.value` ⇒ lần chèn có thể mất hẳn (phần này có từ trước).

## Note

- Nhánh skill (không phải user command, không phải CLI native) trong `buildOutgoing` gửi draft THÔ; `replaceSlashToken` bỏ `trimEnd()` nên khi người dùng chọn skill lúc phần sau token còn khoảng trắng/xuống dòng đuôi, khoảng trắng đuôi đó giờ được giữ ⇒ `text` gửi đi có thể khác bản cũ ở khoảng trắng cuối. Câu "tin gửi đi không đổi vì `parseSlashInvocation` tự trim" trong spec T1 chỉ đúng cho user command + CLI native.
- Lúc menu mở, ↓/↑ kèm Shift vẫn bị `onAcArrow` nuốt (modifier `.down` không xét Shift) — có từ trước, ngoài phạm vi.
- `/Browser x` (hoa) không dispatch vì nhánh `takesArg` so khớp phân biệt hoa thường trong khi nhánh mới thì không — lệch nhỏ, có từ trước.
