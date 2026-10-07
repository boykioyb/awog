# Feature Spec: Sửa trigger `/` và `@` của Session composer

> **Status:** Implemented (chờ test tay — xem [test cases](./composer-trigger-fixes.test-cases.md))
> **Owner:** Product Owner (brief) · Business Analyst (spec)
> **Created:** 2026-10-06
> **Last updated:** 2026-10-06
> **Liên quan:** [Slash Commands](./slash-commands.md) · [ADR 0034](../decisions/0034-slash-commands-markdown.md) · [ADR 0079](../decisions/0079-native-macos-shell-and-design-tokens.md) (D3: mono chỉ cho code)

Phạm vi đã chốt với người dùng: **B, C, D**. **A (cho `/` hoạt động giữa câu) bị loại** và nằm ở [Out of scope](#out-of-scope). Không đổi cú pháp, không đổi `utils/slash-command.ts` (`parseSlashInvocation` / `expandCommandBody`), không đổi hợp đồng gửi sang runtime/CLI.

---

## Phần I — Feature Brief (giữ nguyên từ PO)

### Problem

Người dùng gọi lệnh skill/plugin CLI (ví dụ `/evon:ui-ux`) kèm một prompt dài gặp ba lỗi ở Session composer, cả ba đều nằm ở đường nhập liệu hằng ngày.

**B. Menu `/` không chịu đóng.** Sau khi chọn `/evon:ui-ux` và gõ tiếp nội dung, menu gợi ý lệnh bật lại ở mỗi phím gõ, vì tên lệnh vừa chọn vẫn khớp chính nó. Tệ hơn, khi menu đang mở, phím Enter chọn lại mục trong menu thay vì gửi tin, nên người dùng phải bấm Escape rồi Enter, hoặc không hiểu vì sao tin không đi.

**C. Chip lệnh trong bubble của người dùng hiển thị sai.** Bubble gom cả `/name` lẫn phần prompt vào một chip mono một dòng. Prompt dài bị cắt bằng dấu `…` (người dùng không đọc lại được mình đã gửi gì), còn tên lệnh thì bị bẻ dòng ở dấu `-` (`/evon:ui-` / `ux`).

**D. `@` chỉ dùng được ở cuối prompt.** Gõ `@` ở giữa câu thì menu mention vẫn mở, nhưng chọn xong thì không chèn được, hoặc chèn nhầm vào một `@…` khác ở cuối draft. Người dùng buộc phải viết mention ở cuối hoặc dán đường dẫn bằng tay.

### Target user

- **Persona:** power user gọi lệnh skill/plugin (`/namespace:name`) kèm prompt nhiều câu, thường chèn `@file`, `@agent`, `@wiki` vào giữa đoạn mô tả.
- **Tần suất gặp problem:** hằng ngày, ở mỗi lần gửi có lệnh hoặc mention.
- **Workaround hiện tại:** Escape để đóng menu rồi mới Enter; dồn mọi mention xuống cuối prompt hoặc gõ path tay; chấp nhận không đọc lại được prompt đã gửi trong bubble.

### Why now

Lỗi nằm trên đường gửi tin, tức thao tác dày nhất của app, và người dùng đã báo trực tiếp. Lỗi Enter bị cướp làm người dùng hiểu sai trạng thái (tưởng đã gửi). Chi phí thấp: chỉ sửa ở UI, không đụng sidecar, runtime hay định dạng lưu trữ.

### Hypothesis

Nếu trigger `/` và `@` bám theo **vị trí con trỏ** thay vì toàn bộ draft, và chip lệnh tách tên khỏi nội dung, thì người dùng gửi được lệnh kèm prompt dài và đặt mention ở bất kỳ đâu mà không cần workaround.

### Success criteria (brief)

- **B1.** Sau khi chọn một lệnh từ menu `/` và gõ khoảng trắng hay nội dung tiếp theo, menu `/` **không** mở lại, kể cả khi tên lệnh vẫn khớp.
- **B2.** Khi con trỏ đã nằm sau token lệnh (đang gõ args), Enter **gửi tin ngay**, không chọn lại mục nào.
- **B3.** Đưa con trỏ về trong token lệnh đầu tin (ví dụ sửa `/evo` thành `/evon:`) thì menu vẫn gợi ý như cũ.
- **C1.** Trong bubble của người dùng, tên lệnh **không bao giờ** bị bẻ dòng giữa tên.
- **C2.** Args hiển thị **đầy đủ**, xuống dòng tự nhiên theo bề rộng bubble, không bị cắt `…`, không tràn ngang khỏi bubble.
- **D1.** Chọn một mục `@` chèn đúng tại vị trí con trỏ khi `@` nằm ở **đầu**, **giữa** và **cuối** prompt. Text trước và sau giữ nguyên từng ký tự.
- **D2.** Draft có nhiều `@…` thì chọn mention chỉ thay đúng token đang gõ. Sau khi chèn, con trỏ đứng ngay sau mention vừa chèn.
- **Hồi quy.** Tin gửi đi giống hệt trước đây cho cùng một draft.

### Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | Trung tính. Không đổi artifact, chỉ sửa cách nhập prompt. |
| Workflow-based | Trung tính. Lệnh skill/plugin là đường vào workflow; sửa lỗi giúp dùng nó trơn hơn. |
| Human-in-the-loop | Yes. Composer là kênh con người lái agent; Enter gửi đúng và đọc lại được prompt đã gửi là điều kiện tối thiểu. |
| Local-first | Yes. Chỉ sửa ở UI, không có network hay dịch vụ mới. |

Scope hint: In MVP (sửa lỗi tính năng đã ship), layer UI (`SessionComposer`, `SessionMessageItem`), ước lượng **S**.

---

## Phần II — Feature Spec

### Tóm tắt

Autocomplete `/` và `@` của Session composer được đánh giá theo **vị trí con trỏ** thay vì theo toàn bộ draft: menu `/` chỉ mở khi con trỏ còn nằm trong token lệnh đầu tin, menu `@` chèn/thay đúng token `@…` tại con trỏ và giữ nguyên mọi text khác. Bubble của người dùng hiển thị lệnh đã gửi thành chip chỉ chứa `/name` (không bẻ dòng), còn args là văn xuôi thường bên dưới chip, đọc lại được đầy đủ. Không đổi gì ở dữ liệu gửi đi, lưu trữ hay runtime.

### Hiện trạng code (đã đọc, làm mốc cho dev)

- `SessionComposer.vue` `refreshAutocomplete()` (~:1581): menu `/` mở mỗi khi `draft.startsWith('/')`, bất kể con trỏ ở đâu; nếu draft bắt đầu bằng `/` thì hàm `return` sớm nên **menu `@` không bao giờ mở được trong một draft có lệnh** (lỗi phụ của B, sửa cùng lúc).
- `slashMatches` (~:1409) lọc theo `draft.slice(1).split(/\s/)[0]`, tức từ đầu tiên của cả draft, không phải phần trước con trỏ.
- `onEnter` (~:1338): menu mở + Enter không Shift ⇒ `acceptActive()`. Đây là cơ chế "cướp Enter" của B; giữ nguyên cơ chế, chỉ đổi điều kiện mở menu.
- `applyMention` (~:1654): cả nhánh `page` (~:1660) và nhánh thường (~:1670) `replace` bằng regex neo `$` trên **toàn draft**, nên chỉ trúng token nằm ở cuối draft — gốc của D.
- `mentionMatches` dùng `mentionQuery` lấy từ `caretText()` (đúng theo con trỏ) — phần lọc đã đúng, chỉ phần thay thế sai.
- Textarea (~:140-153) chỉ nghe `input`, `keydown.down/up/esc/enter`, `paste`. **Không** nghe click/keyup/selectionchange, nên di chuyển con trỏ không cập nhật menu. **Không có xử lý IME** nào trong `ui-next` (không `isComposing`, không `compositionstart`).
- `insertSlash` (~:1697) chèn `/` vào đầu draft rồi `refocusDraft()` đặt con trỏ **ở cuối draft**; với quy tắc B mới, con trỏ ở cuối một draft có khoảng trắng sẽ không mở menu ⇒ phải đổi vị trí con trỏ (xem R-B6).
- `dispatchBuiltinDraft` (~:1313) chỉ dispatch built-in `takesArg` (`/browser`) khi gửi bằng Enter lúc menu đóng.
- `SessionMessageItem.vue` (:33-39, CSS ~:972-994): `.ucmd` là `inline-flex`, `font-family: var(--code)` cho cả chip, `.ucmd-args` `white-space: nowrap; text-overflow: ellipsis`. Text thường của bubble render qua `SessionLinkedText` (tách `\n` thành `<br>`, link/path bấm được, `white-space` mặc định), `.mu` có `overflow-wrap: anywhere`, font hệ thống `fs-md`/`lh-md`.

### Định nghĩa dùng trong quy tắc

- **Con trỏ** = `selectionStart` của textarea khi vùng chọn **thu gọn** (`selectionStart === selectionEnd`). Khi có vùng chọn khác rỗng, coi như **không có token tại con trỏ** (menu đóng).
- **Token lệnh tại con trỏ**: draft bắt đầu bằng `/` ở vị trí 0 **và** đoạn `draft[0..con trỏ)` không chứa ký tự khoảng trắng nào (space, tab, xuống dòng). Từ khoá lọc = `draft[1..con trỏ)`. Vùng bị thay khi chọn = toàn bộ token đầu tin `/\S*` cộng tối đa một ký tự khoảng trắng ngay sau (đúng hành vi hiện có của `applySlash`).
- **Token mention tại con trỏ**: `draft[0..con trỏ)` khớp `(^|\s)@([\w./:-]*)$` (regex hiện có, không đổi). Từ khoá lọc = nhóm 2 (phần trước con trỏ). Vùng bị thay = từ ký tự `@` tới hết dãy ký tự `[\w./:-]` liên tiếp **sau** con trỏ (tức cả token, kể cả phần nằm sau con trỏ).
- **Di chuyển con trỏ không qua input**: click/chạm chuột trong textarea, ←/→/Home/End/⌘←/⌘→/Option←/→, ↑/↓ khi menu đóng, chọn vùng bằng Shift+mũi tên hoặc kéo chuột.

### Quy tắc hành vi

#### B — Menu `/`

- **R-B1. Điều kiện mở.** Menu `/` chỉ được mở (hoặc giữ mở) khi có **token lệnh tại con trỏ** và danh sách lọc không rỗng. Draft có `/` ở đầu nhưng con trỏ đã qua khoảng trắng đầu tiên ⇒ menu `/` đóng.
- **R-B2. Từ khoá lọc** là phần token từ sau `/` tới con trỏ (không phải từ đầu của cả draft). Logic so khớp và thứ tự xếp hạng giữ nguyên.
- **R-B3. Menu đóng ⇒ Enter theo logic gửi bình thường** (`composerSendKey`, `dispatchBuiltinDraft`, steer/queue khi đang stream). Menu mở ⇒ Enter (không Shift) chọn mục đang highlight như hiện tại.
- **R-B4. Chọn lệnh từ menu** thay đúng token đầu tin, giữ phần còn lại (hành vi hiện có của `applySlash`, kể cả nhánh built-in `takesArg` ăn phần còn lại làm đối số). **Mới:** với lệnh user/skill/CLI, con trỏ đặt ngay sau `/<label> ` (sau khoảng trắng chèn kèm), không nhảy về cuối draft. Hệ quả: menu đóng ngay sau khi chọn.
- **R-B5. Draft chỉ có `/evon:ui-ux`, con trỏ ở cuối, tên khớp đúng một lệnh.** Chốt: **menu mở**, Enter **chọn mục** ⇒ draft thành `/evon:ui-ux ` (có khoảng trắng đuôi), con trỏ sau khoảng trắng, menu đóng, **chưa gửi**; Enter lần hai gửi. Lý do: (1) một quy tắc duy nhất "menu mở thì Enter chọn" dễ đoán hơn ngoại lệ "khớp chính xác thì gửi"; (2) built-in không đối số (`/compact`, `/plan`) **cần** Enter đi qua menu để dispatch, gửi thẳng sẽ biến hành động thành prompt gửi cho model; (3) so khớp là theo tiền tố nên "khớp chính xác" hiếm khi là duy nhất (`/review` vs `/review-pr`), tự gửi sẽ là đoán. Chi phí: thêm một Enter cho lệnh không args gõ tay; người gõ khoảng trắng trước thì chỉ cần một Enter. Phương án đã cân nhắc và loại: "khớp chính xác đúng một mục ⇒ Enter gửi luôn" (vỡ built-in, thêm nhánh đặc biệt).
- **R-B6. Nút `+` → Insert `/`.** Draft rỗng ⇒ draft `/`, con trỏ sau `/`, menu mở toàn bộ danh sách (như cũ). Draft có chữ (không bắt đầu `/`) ⇒ chèn `/` vào đầu như cũ, **con trỏ đặt ở cuối token đầu tin** (trước khoảng trắng đầu tiên) để từ đầu tiên thành từ khoá lọc như ý đồ ban đầu của `insertSlash`. Draft đã bắt đầu `/` ⇒ không chèn thêm, con trỏ đặt ở cuối token đầu tin, menu mở theo token đó.
- **R-B7. Built-in không đối số gửi bằng Enter khi menu đóng.** Draft mà token đầu **trùng chính xác** tên một built-in (`/plan fix bug`, `/compact `) và menu đóng ⇒ Enter **dispatch built-in**, draft còn lại phần sau token (đúng ngữ nghĩa nhánh built-in của `applySlash`), **không** gửi tin cho model. Lý do: trước đây trường hợp này luôn đi qua menu (menu luôn mở với draft bắt đầu `/`), nên nếu không thêm quy tắc này thì đóng menu theo R-B1 sẽ đổi hành vi thành gửi `/plan fix bug` cho model như văn xuôi; built-in là hành động, không bao giờ là prompt. Built-in `takesArg` (`/browser url`) giữ nguyên đường `dispatchBuiltinDraft`. Token chỉ là tiền tố (`/pla fix`) ⇒ không dispatch, gửi như văn bản (đúng như lệnh không khớp). **Trùng tên** với user command hoặc skill trong scope (vd `~/.claude/commands/plan.md`) ⇒ **không** dispatch, để Enter gửi command của người dùng: menu liệt kê cả hai hàng, người dùng chọn hàng command rồi gõ args thì phải ra command; built-in vẫn chạy được qua hàng của nó trong menu (dispatch theo id). Nút Gửi đi cùng đường `send()` với Enter nên áp dụng y hệt (bổ sung sau code review).
- **R-B8. Mention trong draft có lệnh.** Khi menu `/` không áp dụng (R-B1), composer tiếp tục đánh giá menu `@` theo R-D1 — tức `/evon:ui-ux review @src` mở được menu mention.

#### D — Menu `@`

- **R-D1. Điều kiện mở** giữ nguyên regex hiện có trên `draft[0..con trỏ)`; đánh giá ở mọi vị trí con trỏ (đầu, giữa, cuối, dòng giữa của draft nhiều dòng).
- **R-D2. Chọn mục (agent/skill/wiki/file)** thay **vùng token mention tại con trỏ** (từ `@` tới hết token, gồm cả phần sau con trỏ) bằng `@<insert>`. Mọi ký tự trước `@` và sau vùng token giữ nguyên từng ký tự. Các token `@…` khác trong draft không bị đụng.
- **R-D3. Khoảng trắng đuôi + vị trí con trỏ.** Gọi `next` là ký tự ngay sau vùng token. Nếu `next` là space hoặc tab ⇒ **không chèn thêm** khoảng trắng, con trỏ đặt **sau** khoảng trắng có sẵn đó. Ngược lại (hết draft, xuống dòng, hay ký tự khác) ⇒ chèn **một** space, con trỏ đặt sau space đó. Lý do: không bao giờ sinh hai space liền; con trỏ luôn đứng sau một khoảng trắng nên menu đóng ngay (nếu con trỏ đứng sát cuối `@src/a.ts`, regex sẽ khớp lại và menu bật lại — đúng lỗi B nhưng ở `@`); không nhảy con trỏ xuống dòng sau khi `next` là xuống dòng.
- **R-D4. Con trỏ giữa token** (`@wiki:arch|itecture`). Chốt: từ khoá lọc = phần trước con trỏ (`wiki:arch`), chọn mục thì thay **cả token** (`@wiki:architecture`). Lý do: chỉ thay phần trước con trỏ để lại mảnh vụn (`@wiki:architecture/overview.md itecture`) mà người dùng phải tự xoá; ý đồ đã ghi trong comment code hiện có ("replaces the whole thing instead of leaving `@wiki:` behind") cũng là thay trọn token.
- **R-D5. Nhánh `@page`.** Gỡ đúng vùng token mention tại con trỏ (không đụng token khác). Nếu ký tự ngay sau vùng là space/tab thì gỡ luôn **một** ký tự đó để không còn hai space liền. Con trỏ đặt tại vị trí `@` cũ. Sau đó gọi `attachPage()` như cũ (khối context trang vẫn **nối vào cuối draft** — hành vi của `useBrowserContext.insertBlock`, không đổi trong spec này). Draft mà `attachPage()` đọc phải là draft **đã gỡ token**.
- **R-D6. Nút `+` → Insert `@`** giữ nguyên: nối `@` (hoặc ` @`) vào cuối draft, con trỏ ở cuối, menu mở.

#### Chung cho `/` và `@` — cập nhật theo con trỏ

- **R-X1. Sau input** (gõ, xoá, dán, cắt): đánh giá lại; có thể **mở** menu; highlight về mục đầu (như hiện tại).
- **R-X2. Sau di chuyển con trỏ không qua input**: chỉ khi menu **đang mở** mới đánh giá lại — không còn token tại con trỏ ⇒ **đóng**; còn token ⇒ lọc lại theo từ khoá mới. Di chuyển con trỏ **không bao giờ mở** menu đang đóng. Lý do: người dùng chỉ click/di chuyển qua một mention cũ thì không muốn menu bật lên và chiếm phím Enter; còn menu đã mở mà không cập nhật thì nó trỏ vào token sai và Enter chèn sai chỗ (chính là lỗi D).
- **R-X3. Giữ highlight**: khi đánh giá lại theo R-X2 mà từ khoá **không đổi** (ví dụ ↑/↓ trong menu, click vào cùng vị trí) thì giữ nguyên mục đang highlight; từ khoá đổi thì về mục đầu.
- **R-X4. IME.** Trong lúc đang soạn bằng IME (`KeyboardEvent.isComposing` đúng, hoặc giữa `compositionstart`/`compositionend`), composer **không xử lý** Enter, ↑, ↓, Esc: phím thuộc về IME (chốt chữ, chọn ứng viên, huỷ soạn). Áp dụng cho cả lúc menu mở lẫn menu đóng (cùng một handler, nên Enter chốt chữ cũng không gửi tin). Sau khi soạn xong, input cuối cùng đánh giá lại menu theo R-X1.

#### C — Chip lệnh trong bubble người dùng

- **R-C1. Cấu trúc.** Khi tin có `command`, bubble hiển thị: (1) chip chứa **icon lệnh + `/name`** — chỉ vậy; (2) nếu `args` khác rỗng, **args là văn bản thường bên dưới chip** (dòng mới), render cùng cách với text thường của bubble người dùng (`SessionLinkedText`: xuống dòng của người dùng thành ngắt dòng, URL/path bấm được). Phương án "chip đứng inline rồi args chạy tiếp cùng dòng" đã cân nhắc và loại: hộp chip có padding + viền làm dòng đầu cao hơn các dòng sau, và tên lệnh dài chiếm gần hết dòng đầu.
- **R-C2. Tên lệnh** `white-space: nowrap` — không bao giờ bẻ giữa tên, kể cả tại `-`, `:`, `/`. Chip giữ font mono (`var(--code)`, `mono-ok`: tên lệnh là chuỗi người dùng gõ/copy vào CLI) và skin primary-tint hiện có.
- **R-C3. Tên cực dài** (rộng hơn bubble, không có điểm bẻ): chip co tối đa bằng bề rộng bubble, tên bị cắt bằng `…` ở **cuối**, không tràn ngang, không bẻ dòng. Chấp nhận mất phần đuôi tên trong trường hợp cực hiếm này (bubble tối thiểu ~75% cột, đủ cho tên vài chục ký tự).
- **R-C4. Args** dùng font hệ thống (KHÔNG mono — văn xuôi, trả lời open question của brief theo ADR 0079 D3), cỡ/leading/màu giống text thường của bubble (`fs-md`/`lh-md`, `accent-foreground`), không `nowrap`, không `ellipsis`, kế thừa `overflow-wrap: anywhere` của `.mu` để URL/path dài xuống dòng trong bubble. Khoảng trắng liên tiếp gộp như text thường của bubble (không `pre-wrap`).
- **R-C5. Tooltip** `title` trên chip = `message.text` (body đã expand gửi cho model) — giữ như cũ. Args không mang tooltip riêng.
- **R-C6.** Không đổi dữ liệu: `SlashCommandRef { name, args, native? }` và `message.text` giữ nguyên; tin cũ đã lưu render theo bố cục mới mà không cần migrate.

### User flow

#### B — Gửi lệnh kèm prompt

Trước:

1. Người dùng gõ `/evon`, menu mở, chọn `evon:ui-ux` ⇒ draft `/evon:ui-ux `.
2. Gõ `review trang login` ⇒ mỗi phím gõ menu bật lại (tên vẫn khớp chính nó).
3. Nhấn Enter ⇒ menu chọn lại `evon:ui-ux`, tin không đi. Phải Esc rồi Enter.

Sau:

1. Gõ `/evon`, menu mở lọc theo `evon`; chọn `evon:ui-ux` ⇒ draft `/evon:ui-ux `, con trỏ sau khoảng trắng, menu đóng.
2. Gõ `review trang login` ⇒ menu không mở.
3. Enter ⇒ gửi ngay. Bubble hiện chip `/evon:ui-ux` và dòng `review trang login` bên dưới.

Flow phụ B: người dùng đang ở `/evo fix bug`, click vào ngay sau `/evo` rồi gõ `n:` ⇒ menu mở lọc `evon:`; chọn `evon:ui-ux` ⇒ draft `/evon:ui-ux fix bug`, con trỏ ngay trước `fix`.

#### C — Đọc lại lệnh đã gửi

Trước: bubble là một chip mono một dòng `⌘ /evon:ui-` / `ux review trang login và…` — tên bẻ đôi, prompt bị cắt.

Sau: dòng 1 là chip `⌘ /evon:ui-ux` (không bẻ); từ dòng 2 là toàn bộ prompt bằng font thường, xuống dòng theo bề rộng bubble và giữ các ngắt dòng người dùng đã gõ. Hover chip vẫn thấy body đã expand.

#### D — Mention giữa câu

Trước: draft `So sánh @src/a.ts với  rồi kết luận`, người dùng đặt con trỏ sau `với `, gõ `@b`, menu mở, chọn `src/b.ts` ⇒ không có gì xảy ra (regex chỉ nhìn cuối draft), hoặc nếu cuối draft là `@…` thì token đó bị thay nhầm.

Sau: chọn `src/b.ts` ⇒ draft `So sánh @src/a.ts với @src/b.ts rồi kết luận` (space có sẵn trước `rồi` được tái dùng, không thành hai space), con trỏ đứng trước `rồi`, menu đóng. `@src/a.ts` không bị đụng.

### Acceptance criteria

Mặc định `composerSendKey = 'enter'` trừ khi AC ghi khác. Ví dụ lệnh `evon:ui-ux` giả định là lệnh duy nhất khớp tiền tố `evon` trong catalogue; `|` trong ví dụ là vị trí con trỏ.

#### B — Menu `/`

- **AC-B1.** Given draft rỗng, when gõ `/`, then menu `/` mở với danh sách đầy đủ (built-in đứng đầu) như trước.
- **AC-B2.** Given draft `/evo|`, when quan sát menu, then menu chỉ liệt kê mục khớp `evo` (có `evon:ui-ux`).
- **AC-B3.** Given đã chọn `evon:ui-ux` từ menu, when quan sát, then draft là `/evon:ui-ux ` , con trỏ ở sau khoảng trắng và menu đóng.
- **AC-B4.** Given draft `/evon:ui-ux |`, when gõ lần lượt từng ký tự `review trang login`, then menu `/` không mở ở bất kỳ phím nào.
- **AC-B5.** Given draft `/evon:ui-ux review trang login|` và menu đóng, when nhấn Enter một lần, then tin được gửi và ô soạn trống.
- **AC-B6.** Given draft `/evon:ui-ux|` (chưa có khoảng trắng, con trỏ ở cuối), when quan sát, then menu `/` đang mở và highlight `evon:ui-ux`.
- **AC-B7.** Given AC-B6, when nhấn Enter, then draft thành `/evon:ui-ux `, menu đóng và **chưa** có tin nào được gửi.
- **AC-B8.** Given AC-B7 vừa xong, when nhấn Enter lần nữa, then tin `/evon:ui-ux` được gửi.
- **AC-B9.** Given draft `/evo fix bug`, when click đặt con trỏ ngay sau `/evo` rồi gõ `n:`, then menu `/` mở và lọc theo `evon:`.
- **AC-B10.** Given AC-B9 và chọn `evon:ui-ux`, when quan sát, then draft là `/evon:ui-ux fix bug` và con trỏ đứng ngay trước `fix`.
- **AC-B11.** Given menu `/` đang mở với draft `/evo| fix`, when nhấn End, then menu đóng.
- **AC-B12.** Given AC-B11, when nhấn Enter, then tin được gửi (không chọn mục nào).
- **AC-B13.** Given draft `/evon:ui-ux` rồi xuống dòng (Shift+Enter) và gõ `chi tiết`, when quan sát, then menu `/` không mở.
- **AC-B14.** Given draft `/compact|`, when nhấn Enter, then built-in compact chạy và không có bubble tin nhắn nào được tạo (như trước).
- **AC-B15.** Given draft `/plan fix bug|` (menu đóng vì con trỏ sau khoảng trắng), when nhấn Enter, then chế độ chuyển sang Plan, draft còn `fix bug`, và không có tin nào được gửi cho model.
- **AC-B16.** Given draft `/pla fix|`, when nhấn Enter, then tin `/pla fix` được gửi như văn bản thường (không dispatch built-in).
- **AC-B17.** Given draft `/browser example.com|`, when nhấn Enter, then built-in browser chạy với đối số `example.com`, draft trống, không có tin gửi cho model (như trước).
- **AC-B18.** Given draft rỗng, when chọn `+` → Insert `/`, then draft là `/`, con trỏ sau `/`, menu `/` mở.
- **AC-B19.** Given draft `fix bug`, when chọn `+` → Insert `/`, then draft là `/fix bug`, con trỏ đứng ngay sau `/fix`, và menu `/` mở lọc theo `fix` (nếu có mục khớp; không có mục khớp thì menu đóng như hiện tại).
- **AC-B20.** Given draft `/evon:ui-ux review @sr|`, when quan sát, then menu **mention** mở lọc theo `sr` (menu `/` không mở).

#### D — Menu `@`

- **AC-D1.** Given draft `@sr|`, when chọn file `src/a.ts`, then draft là `@src/a.ts ` và con trỏ ở cuối.
- **AC-D2.** Given draft `Review @rea|`, when chọn file `README.md`, then draft là `Review @README.md ` và con trỏ ở cuối.
- **AC-D3.** Given draft `Sửa @ui| cho đẹp`, when chọn agent có handle `ui-designer`, then draft là `Sửa @ui-designer cho đẹp` (đúng một space trước `cho`) và con trỏ đứng ngay trước `cho`.
- **AC-D4.** Given draft `So sánh @src/a.ts với @b| rồi xem @wiki:x`, when chọn file `src/b.ts`, then draft là `So sánh @src/a.ts với @src/b.ts rồi xem @wiki:x` — `@src/a.ts` và `@wiki:x` không đổi.
- **AC-D5.** Given draft `Đọc @wiki:arch|itecture giúp`, when quan sát menu, then menu lọc theo `wiki:arch`.
- **AC-D6.** Given AC-D5, when chọn trang wiki `architecture/overview.md`, then draft là `Đọc @wiki:architecture/overview.md giúp` (không còn mảnh `itecture`).
- **AC-D7.** Given draft 3 dòng `Dòng 1` / `Xem @fo|` / `Dòng 3`, when chọn file `foo.ts`, then dòng 2 thành `Xem @foo.ts ` (space đuôi), dòng 1 và dòng 3 giữ nguyên, hai ngắt dòng giữ nguyên, con trỏ nằm trên dòng 2 sau space.
- **AC-D8.** Given draft `Tóm tắt @pa| giúp tôi`, when chọn mục `@page`, then token `@pa` bị gỡ, phần còn lại là `Tóm tắt giúp tôi` (một space) trước khối context trang được nối vào cuối draft.
- **AC-D9.** Given menu `@` đang mở với draft `Xem @fo| và sửa`, when click chuột đặt con trỏ vào giữa chữ `sửa`, then menu đóng.
- **AC-D10.** Given AC-D9, when nhấn Enter, then tin được gửi (không chèn mention nào).
- **AC-D11.** Given menu `@` đang mở với draft `@foo|`, when nhấn ← một lần, then menu vẫn mở và lọc theo `fo`.
- **AC-D12.** Given menu đang đóng và draft có sẵn `Xem @src/a.ts rồi`, when click đặt con trỏ vào giữa `@src/a.ts`, then menu **không** mở.
- **AC-D13.** Given draft `liên hệ a@b|`, when quan sát, then không menu nào mở.
- **AC-D14.** Given draft `Xem @fo|`, when chọn `+` → Insert `@`, then hành vi như trước: `@` (kèm space trước nếu cần) được nối vào **cuối** draft, con trỏ ở cuối, menu mở.

#### C — Chip lệnh

- **AC-C1.** Given tin đã gửi `/evon:ui-ux review trang login`, when xem bubble ở bề rộng panel hẹp nhất cho phép, then `/evon:ui-ux` nằm trọn trên một dòng.
- **AC-C2.** Given tin có args dài 600 ký tự, when xem bubble, then toàn bộ args hiển thị, không có `…`, và không có thanh cuộn ngang hay chữ tràn ra ngoài bubble.
- **AC-C3.** Given args người dùng gõ có 3 dòng, when xem bubble, then args hiển thị đúng 3 dòng bắt đầu ở đúng các vị trí ngắt của người dùng (cộng thêm ngắt tự nhiên nếu dòng dài).
- **AC-C4.** Given tin có lệnh kèm args, when xem bubble, then chip đứng riêng ở dòng đầu và args bắt đầu ở dòng kế tiếp.
- **AC-C5.** Given tin có lệnh kèm args, when kiểm font (DevTools), then chip dùng font mono và args dùng font hệ thống cùng cỡ/màu với bubble text thường.
- **AC-C6.** Given tin có lệnh không args (`/evon:ui-ux`), when xem bubble, then chỉ có chip, không có dòng trống bên dưới.
- **AC-C7.** Given tin gửi một user command, when hover chip, then tooltip hiện body đã expand (bằng `message.text`).
- **AC-C8.** Given lệnh có tên 120 ký tự không có điểm bẻ, when xem bubble, then chip không vượt mép bubble, tên kết thúc bằng `…` và không bẻ dòng.
- **AC-C9.** Given args chứa URL `https://example.com/very/long/...` dài hơn bubble, when xem bubble, then URL hiển thị dạng link bấm được và xuống dòng bên trong bubble.
- **AC-C10.** Given một session cũ có tin lệnh đã lưu trước bản sửa, when mở session, then tin đó hiển thị theo bố cục mới (chip + args bên dưới) mà không lỗi.

#### Hồi quy

- **AC-R1.** Given cùng một draft (`/cmd a b` với body dùng `$ARGUMENTS`/`$1`/`$2`; `/evon:ui-ux text` là lệnh CLI native; văn bản thường có `@src/a.ts`), when gửi, then `text` và `command` gửi đi giống hệt bản trước sửa.
- **AC-R2.** Given menu (`/` hoặc `@`) đang mở với ≥ 3 mục, when nhấn ↓ ba lần rồi ↑ một lần, then highlight di chuyển tương ứng, vòng quanh ở hai đầu, và con trỏ trong textarea không di chuyển.
- **AC-R3.** Given menu đang mở, when nhấn Esc, then menu đóng và draft không đổi.
- **AC-R4.** Given menu đang mở và `composerSendKey = 'enter'`, when nhấn Shift+Enter, then không chọn mục nào và textarea chèn xuống dòng (như trước).
- **AC-R5.** Given `composerSendKey = 'shift-enter'` và menu đóng, when nhấn Enter, then chèn xuống dòng; when nhấn Shift+Enter, then gửi tin.
- **AC-R6.** Given menu đang mở, when click chuột vào một mục, then kết quả giống hệt nhấn Enter khi mục đó được highlight.
- **AC-R7.** Given session đang stream và draft `/evon:ui-ux thêm ý|` (menu đóng), when nhấn Enter, then đi theo đường steer/queue như mọi tin khác (không chọn mục menu).

#### IME

- **AC-I1.** Given bộ gõ tiếng Việt (Telex, macOS) đang soạn dở chữ có gạch chân trong draft `/evo` hoặc `@ti` khi menu mở, when nhấn Enter để chốt chữ, then chữ được chốt, không mục nào được chọn và không tin nào được gửi.
- **AC-I2.** Given bộ gõ IME đang soạn dở với menu đóng, when nhấn Enter để chốt chữ, then không có tin nào được gửi.
- **AC-I3.** Given bộ gõ IME (ví dụ tiếng Nhật) đang hiện danh sách ứng viên khi menu `@` mở, when nhấn ↑/↓, then IME đổi ứng viên và highlight của menu không đổi.
- **AC-I4.** Given vừa chốt chữ xong (hết soạn), when nhấn Enter lần nữa, then hành vi theo quy tắc thường (menu mở ⇒ chọn mục; menu đóng ⇒ gửi).

### UI behavior

- **Component liên quan:** [SessionComposer.vue](../../apps/desktop/ui-next/components/session/SessionComposer.vue) (đánh giá menu theo con trỏ, thay token, IME guard, Enter dispatch built-in, `insertSlash`), [SessionMessageItem.vue](../../apps/desktop/ui-next/components/session/SessionMessageItem.vue) (bố cục chip + args), có thể dùng lại [SessionLinkedText.vue](../../apps/desktop/ui-next/components/session/SessionLinkedText.vue) cho args. `SessionSlashMenu` / `SessionMentionMenu` không đổi.
- **Route mới:** không.
- **State mới ở store:** không. Mọi state autocomplete vẫn cục bộ trong composer.
- **Theme/design token:** không thêm token. Chip giữ skin hiện có; args dùng `fs-md`/`lh-md` kế thừa từ `.mu`; mọi radius/font-size/line-height mới (nếu có) phải theo token, qua được `scripts/check-design-tokens.mjs`. Chip giữ ghi chú `mono-ok`; args không mono.
- **i18n:** không có chuỗi mới.
- **Empty/loading/error state:** không có trạng thái mới. Menu không có mục khớp ⇒ đóng (như hiện tại).

### Data shape

- **Entity:** không đổi. `SlashCommandRef` (`name`, `args`, `native?`) và `message.text` giữ nguyên ([types/index.ts](../../apps/desktop/ui-next/types/index.ts)).
- **File trên đĩa:** không đổi (session JSONL không đổi format).
- **Event log:** không thêm.

### Edge case

| # | Tình huống | Hành vi chốt |
|---|---|---|
| E1 | Email `a@b.com` | Không mở menu (`@` không đứng sau đầu dòng/khoảng trắng) — AC-D13. |
| E2 | `@` ở ngay đầu draft | Mở menu, chèn tại đầu — AC-D1. |
| E3 | Nhiều `@` trong draft | Chỉ token tại con trỏ bị thay — AC-D4. |
| E4 | Con trỏ giữa token `@wiki:arch|itecture` | Lọc theo phần trước con trỏ, thay cả token — R-D4, AC-D5/D6. |
| E5 | Draft nhiều dòng, `@` ở dòng giữa | Regex dùng `\s` nên `@` đầu dòng vẫn kích hoạt; chỉ dòng đó đổi — AC-D7. |
| E6 | IME tiếng Việt/Nhật khi menu mở | Enter/↑/↓/Esc thuộc về IME — R-X4, AC-I1..I4. |
| E7 | Undo (⌘Z) sau khi chèn từ menu | **Chỉ ghi nhận, không bắt buộc sửa.** Hiện tại thay draft bằng gán giá trị lập trình nên undo native của textarea không đảm bảo hoàn tác đúng thao tác chèn. Yêu cầu tối thiểu: không tệ hơn hiện tại (không mất text ngoài vùng token, không lỗi console). |
| E8 | Built-in `takesArg` (`/browser`) | Chọn từ menu: ăn phần còn lại làm đối số (như cũ). Gõ tay + Enter khi menu đóng: `dispatchBuiltinDraft` như cũ — AC-B17. |
| E9 | Built-in không đối số gõ tay kèm text | Dispatch + giữ phần còn lại — R-B7, AC-B15. |
| E10 | Token `/` không khớp mục nào (`/xyz`) | Menu đóng; Enter gửi như văn bản (như cũ). |
| E11 | Nhiều mục khớp tiền tố, người dùng gõ đúng tên của mục **không** đứng đầu (`/review` khi `review-pr` xếp trước) | Enter chọn mục đang highlight (mục đầu) theo xếp hạng hiện tại. **Không sửa trong spec này** (xếp hạng nằm ngoài phạm vi); người dùng dùng ↓ hoặc gõ khoảng trắng để đóng menu. Đề xuất follow-up: ưu tiên mục khớp chính xác. |
| E12 | Vùng chọn khác rỗng (Shift+← khi menu mở) | Coi như không có token ⇒ menu đóng (R-X2). |
| E13 | Token `/cmd` theo sau là xuống dòng (`/cmd` ↵ `body`) rồi chọn lại lệnh | Giữ hành vi hiện có của `applySlash` (một ký tự khoảng trắng sau token, kể cả xuống dòng, được thay bằng space). Ghi nhận, không sửa. |
| E14 | Ký tự thuộc lớp token ngay sau con trỏ (`xem @fo|.`) | Vùng token kéo qua `.` nên dấu chấm bị thay luôn (`xem @foo.ts `). Chấp nhận: cùng lớp ký tự với regex trigger, ca hiếm. |
| E15 | Ký tự không thuộc token sau con trỏ (`@fo|,`) | Chèn thêm space: `@foo.ts ,`. Chấp nhận. |
| E16 | Query có dấu tiếng Việt (`@tài`) | `\w` chỉ ASCII ⇒ menu đóng khi gặp ký tự có dấu. Như hiện tại, ngoài phạm vi. |
| E17 | Dán (paste) văn bản khi con trỏ trong token | Coi là input ⇒ đánh giá lại theo R-X1. Dán lớn thành file đính kèm thì draft không đổi ⇒ menu không đổi. |
| E18 | Chip mở trong popout session window / board thread readonly | Cùng component `SessionMessageItem` ⇒ cùng bố cục. |
| E19 | Offline / restart giữa chừng | Không áp dụng: chỉ là hành vi nhập liệu và render cục bộ; draft persist như cũ. |
| E20 | Hai phiên song song / hai cửa sổ | Mỗi composer giữ state autocomplete riêng; không có state chia sẻ mới. |

AWOG-specific checklist: local-first (có, thuần UI) · restart-safe (không có state mới) · approval gate (không chạm) · trace/event log (không thêm) · git auto-commit (không) · notification (không) · multi-task concurrent (không xung đột).

### Dependencies

- **Entity hiện có:** Session message (`role: 'user'`, `command: SlashCommandRef`), Command, Skill, Agent, Wiki page, workspace file index (nguồn của menu — không đổi).
- **Feature liên quan:** [Slash Commands](./slash-commands.md) (cú pháp, expansion — không đổi), [Wiki](./wiki.md) (`@wiki:`), [Session browser panel](./session-browser-panel.md) (`@page` → `attachPage`), Settings → Defaults `composerSendKey`.
- **ADR:** [0034](../decisions/0034-slash-commands-markdown.md) (slash command Markdown), [0079](../decisions/0079-native-macos-shell-and-design-tokens.md) (design token + D3 mono).
- **Code anh em có cùng lỗi:** [WorkspaceBoardComposer.vue](../../apps/desktop/ui-next/components/session/workspace/WorkspaceBoardComposer.vue) chép cùng logic (`startsWith('/')` ~:365, regex neo `$` ~:372/:426) — xem Q1.
- **External:** không.

### Non-functional

| Tiêu chí | Mục tiêu |
|---|---|
| Dependency | Không thêm dependency nào. |
| Layer | Chỉ UI (`ui-next`). Không đụng sidecar, runtime, storage, IPC, `utils/slash-command.ts`. |
| Latency UI | Đánh giá lại menu khi di chuyển con trỏ chỉ chạy lúc menu đang mở; không gây giật khi gõ trong draft dài (vài nghìn ký tự). |
| Design token | Theo `.claude/rules/nuxt-vue.md`; `pnpm lint` (gồm check design token) và `pnpm typecheck` sạch. |
| Offline | Có. |
| Restart-safe | Không có state mới cần persist. |
| Security | Không có sink mới; args vẫn render qua text interpolation, không `v-html`. |

### Ghi chú kỹ thuật (tech-lead)

> Chốt 2026-10-06. **Không cần ADR**: chỉ sửa UI trong `ui-next`, không đổi IPC / event schema / data shape, không thêm dependency. `node:test` là built-in của Node và đã có tiền lệ ở [apps/desktop/electron/src/\_\_tests\_\_/](../../apps/desktop/electron/src/__tests__/), nên không phải "thêm test runner".

#### T1. Hàm thuần `utils/composer-trigger.ts`

- File mới [apps/desktop/ui-next/utils/composer-trigger.ts](../../apps/desktop/ui-next/utils/composer-trigger.ts), thuần (không DOM, không Vue, không store) và **không import gì, kể cả `import type`**: Node chạy file này bằng type-stripping nên không hiểu alias `~/` và không tự thêm đuôi `.ts`. Chỉ dùng cú pháp xoá được (annotation, `type`, `as`, `satisfies`); cấm `enum`, `namespace`, parameter property. Composer import tường minh `from '~/utils/composer-trigger'` giống `~/utils/slash-command` (không dựa vào auto-import; tên export đã kiểm không trùng auto-import nào hiện có).
- Lớp ký tự token mention `[\w./:-]` và regex trigger `(^|\s)@([\w./:-]*)$` thành hằng **trong file này** — nguồn duy nhất. Sau khi sửa, `SessionComposer.vue` không còn regex `/` hay `@` riêng nào (trừ regex `takesArg` cũ của `dispatchBuiltinDraft`, giữ nguyên theo T6).
- `caret` trong mọi hàm là con trỏ **thu gọn**. Quy tắc "vùng chọn khác rỗng ⇒ không có token" nằm ở composer: helper `collapsedCaret(): number | null` (trả `null` khi `!ta` hoặc `selectionStart !== selectionEnd`) thay cho `caretText()`. Util không biết `selectionEnd`.

```ts
export type TextEdit = { text: string; caret: number }
export type MentionToken = { start: number; end: number; query: string } // start = vị trí '@', end = exclusive

export function slashTokenAt(draft: string, caret: number): string | null // R-B1/R-B2: query (chưa lowercase)
export function slashTokenEnd(draft: string): number // R-B6: vị trí khoảng trắng đầu tiên, không có ⇒ draft.length
export function slashHead(draft: string): { name: string; rest: string } | null // tách token đầu tin
export function replaceSlashToken(draft: string, label: string): TextEdit // R-B4
export function mentionTokenAt(draft: string, caret: number): MentionToken | null // R-D1/R-D4
export function replaceMention(draft: string, token: MentionToken, insert: string): TextEdit // R-D2/R-D3
export function removeMention(draft: string, token: MentionToken): TextEdit // R-D5
```

- `slashTokenAt`: `null` nếu draft không bắt đầu `/`, hoặc `caret < 1` (con trỏ đứng trước `/` không tính là trong token), hoặc `draft.slice(0, caret)` chứa `\s`; ngược lại trả `draft.slice(1, caret)` (có thể là `''`). Lowercase vẫn do `slashMatches` làm như cũ.
- `slashHead`: tương đương `/^\/(\S*)\s?([\s\S]*)$/` trên draft **thô** (không trim) — cùng ngữ nghĩa regex `^\/\S*\s?` của `applySlash` hiện tại (E13 giữ nguyên). `name` có thể rỗng; `null` khi không bắt đầu `/`.
- `replaceSlashToken`: `text = '/' + label + ' ' + (slashHead(draft)?.rest ?? draft)`, `caret = label.length + 2`. **Bỏ `trimEnd()`** của công thức cũ: nó cắt khoảng trắng/xuống dòng đuôi của phần người dùng muốn giữ và làm `caret` có thể vượt độ dài khi `rest` toàn khoảng trắng. Tin gửi đi không đổi vì `parseSlashInvocation` đã `trim()` cả draft lẫn args (AC-R1 giữ nguyên).
- `mentionTokenAt`: exec regex trigger trên `draft.slice(0, caret)`; `query = m[2]`; `start = caret - query.length - 1`; `end = caret + độ dài dãy [\w./:-]* ngay sau caret`.
- `replaceMention`: `head = draft.slice(0, start) + '@' + insert`; nếu `draft[end]` là `' '` hoặc `'\t'` thì `text = head + draft.slice(end)`, ngược lại `text = head + ' ' + draft.slice(end)`; cả hai nhánh `caret = head.length + 1`.
- `removeMention`: `cut = end + (draft[end] là ' ' hoặc '\t' ? 1 : 0)`; `text = draft.slice(0, start) + draft.slice(cut)`; `caret = start`.

#### T2. Test (không thêm dependency)

- File test: [apps/desktop/ui-next/utils/\_\_tests\_\_/composer-trigger.test.mjs](../../apps/desktop/ui-next/utils/__tests__/composer-trigger.test.mjs) — **JS thuần `.mjs`**, dùng `node:test` + `node:assert/strict`, import `'../composer-trigger.ts'` (có đuôi).
- Vì sao `.mjs` mà không `.ts`: tsconfig do Nuxt sinh (`.nuxt/tsconfig.json`) có `include: ["../**/*"]` ⇒ mọi file trong `ui-next` đều vào `pnpm typecheck`, và **không** bật `allowImportingTsExtensions` ⇒ một file test `.ts` import có đuôi `.ts` sẽ đỏ typecheck (TS5097), còn bỏ đuôi thì Node không resolve. File `.mjs` được `allowJs` nạp nhưng không bị check type (không có `checkJs`); ESLint (`eslint .`) vẫn lint nó bằng rule JS cơ sở. Nuxt chỉ auto-import file cấp 1 của `utils/` (và `utils/*/index.*`) nên `__tests__/` không bị quét; không ai import nên Vite không bundle. `ui-next/package.json` có `"type": "module"` nên Node coi `.ts` là ESM.
- Thêm script (không phải dependency) vào `apps/desktop/ui-next/package.json`: `"test:unit": "node --test \"utils/__tests__/*.test.mjs\""`. Lệnh chạy: `cd apps/desktop/ui-next && pnpm test:unit`. Cần Node ≥ 22.18 (type-stripping bật mặc định); Node 22.6–22.17 thì chạy `node --experimental-strip-types --test "utils/__tests__/*.test.mjs"`.
- Sau khi thêm file, developer **bắt buộc** chạy `pnpm typecheck` và `pnpm lint` để xác nhận giả định trên. Nếu một trong hai báo lỗi ở file test thì dừng và báo lại tech-lead — không thêm `@ts-nocheck`, không tắt rule.
- Case tối thiểu (mỗi case một `test`, tên ghi AC): `slashTokenAt` cho AC-B2/B6/B9/B11/B13 + caret 0 + draft không bắt đầu `/`; `replaceSlashToken` cho AC-B3/B10 + `rest` toàn khoảng trắng; `slashTokenEnd` cho AC-B18/B19; `slashHead` cho AC-B15/B16 (`name` `plan` vs `pla`); `mentionTokenAt` cho AC-B20/D5/D13 + E14/E15; `replaceMention` cho AC-D1/D2/D3/D4/D6/D7 (kiểm cả `text` lẫn `caret`); `removeMention` cho AC-D8.

#### T3. Đánh giá menu theo con trỏ (R-X1…R-X3, R-B1, R-B8)

- `refreshAutocomplete(cause: 'input' | 'caret')`. Thêm ref `slashQuery` song song `mentionQuery`; `slashMatches` lọc theo `slashQuery.value.toLowerCase()` thay cho `draft.slice(1)…split(/\s/)[0]`.
- Thân hàm: (1) `cause === 'caret' && !autocomplete.value` ⇒ `return` ngay — đây vừa là R-X2 (di chuyển không bao giờ mở menu) vừa là chốt hiệu năng (menu đóng thì không làm gì). (2) Nhớ `(kind, query)` cũ. (3) `caret = collapsedCaret()`; `slashTokenAt` khác `null` ⇒ menu slash; không thì `mentionTokenAt` khác `null` ⇒ menu mention; không thì đóng. Bỏ `return` sớm theo `startsWith('/')` ⇒ R-B8 tự đúng (token `/` không chứa khoảng trắng nên không thể đồng thời là token `@`). (4) Với `cause === 'caret'`: chỉ đặt `acIndex = 0` khi `kind` hoặc `query` đổi (R-X3). Với `cause === 'input'`, `onInput` đã đặt `acIndex = 0` trước khi gọi (R-X1, như cũ). Giữ chốt `acIndex >= len ⇒ 0` và "danh sách rỗng ⇒ đóng". `ensureCatalogs`/`ensureFiles`/`wiki.loadTree` giữ như cũ trong nhánh mở.
- **Sự kiện: một listener `selectionchange` trên `document`**, đăng ký trong `onMounted`, gỡ trong `onBeforeUnmount`; handler `if (document.activeElement === ta.value) refreshAutocomplete('caret')`. Chọn vì một nguồn phủ mọi kiểu di chuyển (click, kéo chọn kể cả thả chuột ngoài textarea, ←/→/Home/End/⌘/⌥, Shift+mũi tên, ⌘A, `setSelectionRange` bằng code) mà không phải giữ danh sách phím. Đã loại `@click` + `@keyup`: phải liệt kê phím điều hướng, sót kéo-thả ra ngoài và ⌘A, và keyup bắn cả sau ↑/↓ trong menu.
- **Không vòng lặp với `onAcArrow`**: ↑/↓ lúc menu mở đã `preventDefault` ⇒ con trỏ không đổi ⇒ không có `selectionchange`. Lúc menu đóng, ↑/↓ di chuyển con trỏ ⇒ có event nhưng handler `return` ở bước (1).
- **Phân biệt input với di chuyển**: không cần biết nguồn của `selectionchange`. Gõ phím sinh `input` trước (đồng bộ ⇒ `onInput` ⇒ `cause 'input'`, được mở menu), `selectionchange` đến sau ở task kế tiếp ⇒ lượt `'caret'` đánh giá lại cùng token, query không đổi ⇒ không đổi highlight, tức idempotent. Mọi chỗ gán draft bằng code (seed, apply, enhance) diễn ra khi menu đã đóng ⇒ handler no-op.
- Nhiều instance (grid, KeepAlive, popout): mỗi instance có listener riêng, chốt `activeElement` đảm bảo chỉ composer đang focus xử lý; popout có `document` riêng.
- QA kiểm trên Electron: Chromium bắn `selectionchange` khi con trỏ trong textarea đổi (bản mới bắn tại element và bubble lên `document`). Nếu đo thấy không có event khi click hoặc ←/→ trong textarea, fallback là `@click` + `@keyup` (chỉ phím điều hướng) gọi cùng `refreshAutocomplete('caret')`, phần logic còn lại không đổi.

#### T4. Đặt con trỏ sau khi thay (R-B4, R-B6, R-D3, R-D5)

- Một helper trong composer `applyDraftEdit(edit: TextEdit)`: gán `draft.value = edit.text`, `closeAutocomplete()`, rồi `nextTick` ⇒ `el.focus()` → `grow()` → `el.setSelectionRange(edit.caret, edit.caret)`. Cần `nextTick` vì `draft` là computed ghi qua store, Vue patch `el.value` ở lượt render và việc gán value bằng code đẩy con trỏ về cuối. `grow()` đứng trước `setSelectionRange` vì `grow` đặt `height: auto` có thể reset `scrollTop`; đặt con trỏ sau cùng để Chromium cuộn con trỏ vào tầm nhìn khi textarea đã đúng chiều cao.
- Dùng ở: `applySlash` nhánh user/skill/CLI (`replaceSlashToken`); `applyMention` nhánh thường (`mentionTokenAt` tính lại tại thời điểm chọn từ `collapsedCaret()` rồi `replaceMention`; token `null` ⇒ chỉ đóng menu); nhánh `page` (`removeMention` ⇒ `applyDraftEdit` ⇒ `void browserCtx.attachPage()`). Click chuột vào mục menu không làm mất con trỏ vì `SessionSlashMenu`/`SessionMentionMenu` đã `@mousedown.prevent` (AC-R6).
- Nhánh `page`: `attachPage` gọi **sau** khi gán draft là đủ cho R-D5, vì setter của `draft` ghi đồng bộ vào store và `insertBlock` đọc `store.active.draft`. Khi `attachPage` chèn được khối, `seedComposer` ⇒ watcher `draftSeed` đưa con trỏ về cuối (sau khối) — chấp nhận, vì khối nằm ở cuối; con trỏ tại vị trí `@` cũ chỉ còn hiệu lực khi `attachPage` không chèn gì (toast). Không `await`.
- Nhánh built-in của `applySlash` giữ nguyên hành vi (draft = `rest` hoặc `''`, con trỏ ở cuối), chỉ đổi cách lấy `rest` sang `slashHead`.
- `refocusDraft(caret?: number)`: mặc định `el.value.length` (để `insertMention`/R-D6 không đổi); `insertSlash` truyền `slashTokenEnd(newDraft)` cho cả nhánh chèn `/` lẫn nhánh draft đã có `/`. Giữ `setTimeout` (để thắng cú trả focus của dropdown) và giữ lời gọi `onInput()` ở cuối (`cause 'input'` ⇒ được mở menu) — đúng AC-B18/B19. Draft rỗng ⇒ `/`, `slashTokenEnd('/') = 1`.
- Không đụng undo (E7).

#### T5. IME (R-X4)

- Electron là Chromium: keydown phát ra trong lúc soạn, kể cả Enter chốt chữ, có `isComposing === true`. Safari khác (`compositionend` bắn trước keydown) nhưng không áp dụng ở đây. Vì vậy chỉ cần `e.isComposing`, **không** thêm cờ `compositionstart`/`compositionend`.
- Thêm helper `isImeKey(e: KeyboardEvent): boolean` (hiện chỉ `return e.isComposing`), gọi ở đầu `onEnter`, `onAcArrow` và một handler mới `onEsc(e)` thay cho `@keydown.esc="closeAutocomplete"`: `if (isImeKey(e)) return`, **không** `preventDefault` để phím về IME. Gom vào một helper để nếu QA thấy AC-I1 rớt trên máy thật thì chỉ cần thêm `|| e.keyCode === 229` ở một chỗ.
- `onInput` **không** chặn IME: input trong lúc soạn vẫn đánh giá lại như hiện tại, nên input cuối cùng của composition tự đáp ứng câu cuối của R-X4.
- Bộ gõ tiếng Việt kiểu xoá-rồi-gõ-lại (EVKey/OpenKey) không dùng composition ⇒ Enter là Enter thường, không có gì để chặn.

#### T6. R-B7 — built-in không đối số khi menu đóng

- Mở rộng `dispatchBuiltinDraft` (hàm này đã chạy trong `send()` trước nhánh `busy`, đúng chỗ của "hành động người dùng, không phải tin nhắn"). **Nhánh `takesArg` giữ nguyên từng dòng** (regex trên `draft.trim()`, draft = `''`, truyền đối số); chỉ đổi luồng: thay vì `return false` khi regex không khớp hoặc không có built-in `takesArg`, rơi xuống nhánh mới.
- Nhánh mới: `head = slashHead(draft.value)` (draft thô, `/` ở vị trí 0 — cùng điều kiện với menu); tìm built-in có `!takesArg` và `name === head.name.toLowerCase()` (lowercase vì menu cũ lowercase query, nên `/Plan x` trước đây vẫn dispatch). Có ⇒ `draft.value = head.rest`, `closeAutocomplete()`, `onCommand(id, '')`, `nextTick(grow)`, `return true`. Không khớp chính xác (`/pla`) ⇒ `false` ⇒ gửi như văn bản (AC-B16).
- Hệ quả: bấm nút Gửi với `/plan fix` cũng dispatch (vì `send()` là cửa chung). Hành vi này nhất quán và có chủ đích: trước đây bấm Gửi sẽ đưa `/plan fix` cho model, cũng là lỗi cùng loại.

#### T7. C — Markup + CSS chip

- Template: thay `<span v-if="message.command" class="ucmd">…</span>` bằng `<template v-if="message.command">` chứa (a) chip `.ucmd` gồm icon + `.ucmd-name`, giữ `:title="message.text"` (R-C5); (b) `<div v-if="message.command.args" class="ucmd-args"><SessionLinkedText :text="message.command.args" /></div>`. Chuỗi `v-else-if="fenced"` / `v-else` phía sau giữ nguyên (vẫn nối vào `<template v-if>`).
- `.ucmd`: giữ `inline-flex`, `max-width: 100%`, skin primary-tint, `font-family: var(--code)` kèm `mono-ok`; bỏ `vertical-align` vì không còn args chung dòng. Icon `flex: none`.
- `.ucmd-name`: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0`. `min-width: 0` là bắt buộc: item flex mặc định `min-width: auto` không chịu co nên không bao giờ ra `…` — đây chính là cơ chế của R-C3/AC-C8.
- `.ucmd-args`: chỉ khai `margin-top` (px chẵn, ví dụ `6px`; spacing không thuộc phạm vi guard token). **Không** khai `font-family`/`font-size`/`line-height`/`color` mà để kế thừa từ `.mu`: font hệ thống, `--fs-md`, `accent-foreground`, `overflow-wrap: anywhere`. Lưu ý leading thực tế của `.mu` là `--lh-prose` (rule ở `prototype.css` ~:955 đè `--lh-md`); "giống text thường của bubble" (R-C4/AC-C5) nghĩa là kế thừa, không ghi cứng `--lh-md`. Xoá `color: var(--foreground)`, `nowrap`, `overflow`, `ellipsis` cũ của `.ucmd-args`.
- Không `pre-wrap`: `SessionLinkedText` đã biến `\n` thành `<br>` (AC-C3) và gộp khoảng trắng như text thường (R-C4); link/path đi qua nó (AC-C9); không có `v-html`. `theme-cute.css` không có rule `.ucmd` ⇒ không phải sửa.

#### T8. Phạm vi, follow-up, thứ tự làm

- **Q1 (đã chốt: follow-up):** `WorkspaceBoardComposer.vue` sẽ dùng lại nguyên các hàm T1 (`slashTokenAt`, `mentionTokenAt`, `replaceMention`, `replaceSlashToken`). Khi đó util có người dùng thứ hai; chưa trừu tượng thêm (composable autocomplete chung) cho tới khi có bản thứ ba (Rule of Three).
- Ghi nhận ngoài phạm vi, không sửa: `useBrowserContext.insertBlock` ghi vào `store.activeId` chứ không vào `sid` của composer gọi nó, nên ở chế độ lưới hoặc popout, `@page` chọn từ một ô không phải phiên đang active có thể chèn khối vào phiên khác. Cần follow-up riêng.
- Thứ tự làm cho developer: T1 + T2 (util + test xanh) → T3 → T4 → T6 → T5 → T7 → `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` → QA chạy AC trên Electron, gồm kiểm `selectionchange` (T3) và IME (T5) trên máy thật.

### Out of scope

- **A. Cho `/` hoạt động giữa câu.** Người dùng đã chốt không làm; `/` chỉ ở đầu tin là cố ý theo spec Slash Commands.
- Đổi cú pháp lệnh hoặc mention, thêm trigger mới.
- Đổi hợp đồng gửi sang runtime/CLI hay expansion (`utils/slash-command.ts`).
- Thiết kế lại autocomplete: xếp hạng (kể cả ưu tiên khớp chính xác — E11), nguồn gợi ý, phím tắt mới (Tab để chọn…).
- Insert `@` từ nút `+` chèn tại con trỏ (giữ nối cuối — R-D6).
- Khối `@page` chèn tại con trỏ (giữ nối cuối — R-D5).
- Undo native đúng từng thao tác chèn (E7).
- Mention với ký tự Unicode trong query (E16).
- Remote PWA (không render chip `.ucmd`).

### Open questions

- **Q1.** `WorkspaceBoardComposer.vue` (composer của board thread) chép cùng logic và có cùng lỗi B/D. Gộp vào phạm vi lần này hay để follow-up? **Đề xuất:** follow-up riêng để giữ ước lượng S; nếu gộp thì tech-lead cân nhắc tách hàm thuần dùng chung (tìm token tại con trỏ + tính chuỗi thay thế) — đây là bản sao thứ hai nên mới là tín hiệu, chưa bắt buộc theo Rule of Three. → cần PO/user chốt. **Đã chốt (2026-10-06):** follow-up riêng; util ở T1 dùng lại được (xem T8).

Các điểm còn lại đã tự chốt kèm lý do: R-B5 (lệnh khớp chính xác vẫn cần Enter chọn), R-B7 (built-in không đối số dispatch bằng Enter), R-D3 (khoảng trắng đuôi), R-D4 (thay cả token), R-X2 (di chuyển con trỏ chỉ đóng/lọc lại, không mở), R-C1 (chip một dòng riêng), R-C3 (tên cực dài cắt `…`), R-C4 (args font hệ thống). Nếu PO muốn đảo bất kỳ điểm nào, AC tương ứng đổi theo.

### Liên kết

- Spec gốc: [Slash Commands](./slash-commands.md)
- ADR: [0034](../decisions/0034-slash-commands-markdown.md), [0079](../decisions/0079-native-macos-shell-and-design-tokens.md)
- Architecture: [system-overview](../architecture/system-overview.md), [data-model](../architecture/data-model.md), [execution-model](../architecture/execution-model.md)
- [VISION](../../artifacts/VISION.md) · [MVP scope](../requirements/mvp-scope.md)
