# Plan: Sửa trigger `/` và `@` của Session composer (B + C + D)

> **Spec:** [composer-trigger-fixes.md](./composer-trigger-fixes.md) (Phần II)
> Vai trò tạo: Project Manager. Tài liệu **chỉ chia task + dependency + ước lượng + owner + acceptance**, KHÔNG chứa code.
> **Target milestone:** MVP (sửa lỗi tính năng đã ship). **Last updated:** 2026-10-06.
> **Phạm vi đã chốt:** B, C, D + các quy tắc R-X (cập nhật theo con trỏ) và R-X4 (IME). **A loại** (spec § Out of scope). **Q1 (`WorkspaceBoardComposer.vue`) KHÔNG làm lần này** — ghi ở [Backlog](#backlog-sau-lần-này).

## Cách đọc plan

- **Effort:** S (< 0.5d) · M (0.5–2d). Không task nào L/XL. Brief ước lượng cả feature là **S**; phần code (T1–T3) cỡ nửa ngày, QA + review + docs mỗi việc vài giờ.
- **Owner:** `developer` · `qa-tester` · `code-reviewer` · `tech-lead` (chỉ T0, đang chốt song song).
- **Acceptance** trỏ thẳng tới AC của spec: tiền tố **AC-B** (menu `/`), **AC-D** (menu `@`), **AC-C** (chip bubble), **AC-R** (hồi quy), **AC-I** (IME); quy tắc trỏ tới **R-B / R-D / R-X / R-C**; edge case trỏ tới **E1…E20**.
- **DoD chung cho MỌI task code:** `cd apps/desktop/ui-next && pnpm lint:fix && pnpm format && pnpm lint && pnpm typecheck` — **0 error** (`pnpm lint` đã gồm `scripts/check-design-tokens.mjs`).
- **Quy ước code:** identifier + log message tiếng Anh, comment kỹ thuật tiếng Việt. Theo [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md): font-size / line-height / radius **chỉ bằng token** (`var(--fs-*)`, `var(--lh-*)`, `var(--r-*)`, không hệ số line-height không đơn vị, không `border-radius: <n>px`); mọi chỗ dùng `var(--code)` phải kèm `/* mono-ok: <lý do> */`.
- **Ràng buộc KHÔNG chạm (cả plan):** không thêm dependency; không sửa `utils/slash-command.ts` (`parseSlashInvocation` / `expandCommandBody`); không sửa `SessionSlashMenu` / `SessionMentionMenu`; không sửa `stores/**`, `types/index.ts`, `apps/desktop/sidecar/**`, `apps/desktop/electron/**`; không i18n key mới; không token theme mới; không `v-html`; không sửa `WorkspaceBoardComposer.vue`.

---

## DAG phụ thuộc

```
T0 (TL: chốt tách util thuần + chỗ đặt test)
 ↓
T1 (dev: utils/composer-trigger.ts + node --test) ──→ T2 (dev: nối vào SessionComposer.vue — B, D, R-X, IME, R-B6, R-B7) ──┐
                                                                                                                              ├─→ T4 (QA) ──┐
T3 (dev: chip + args trong SessionMessageItem.vue — C)  ── độc lập, chạy song song T0/T1/T2 ──────────────────────────────────┤             ├─→ T6 (docs)
                                                                                                                              └─→ T5 (review) ┘
```

Critical path: **T0 → T1 → T2 → T4 → T6**. T3 khác file, không phụ thuộc T1/T2 ⇒ giao song song (có thể cùng dev, commit riêng). T4 và T5 chạy song song.

---

## Task

- [x] **T0. Chốt tách logic token tại con trỏ thành hàm thuần + chỗ đặt/cách chạy test** — **S**
  - **Mục tiêu:** tech-lead xác nhận giả định của plan: logic phát hiện token `/` và `@` tại con trỏ, vùng thay, chuỗi kết quả và vị trí con trỏ mới nằm ở **một file thuần** `apps/desktop/ui-next/utils/composer-trigger.ts` (không import Vue / Nuxt auto-import / DOM ⇒ chạy được dưới Node), test bằng `node --test` (type-stripping của Node 22), **không thêm dependency, không thêm test runner**.
  - **Cần chốt kèm (xem [Open questions](#open-questions)):** (a) vị trí file test — đề xuất `utils/__tests__/composer-trigger.test.ts` (Nuxt chỉ auto-import cấp 1 của `utils/` nên thư mục con không bị quét; khớp mẫu `electron/src/__tests__/`); (b) cách test import `../composer-trigger.ts` có đuôi `.ts` (Node strip-types bắt buộc) mà vẫn qua `pnpm typecheck`; (c) có thêm script `test` vào `package.json` hay chỉ ghi lệnh chạy trong spec. Đây là quyết định nhỏ ⇒ ghi chú vào spec (mục "Hiện trạng code"/"Non-functional") là đủ, **không cần ADR** trừ khi (b) buộc đổi `tsconfig`.
  - **File chạm:** `docs/features/composer-trigger-fixes.md` (ghi chú quyết định) — nếu cần.
  - **AC spec thoả:** không trực tiếp (gate kỹ thuật cho T1).
  - **Depends on:** none (đang chạy song song).
  - **Owner:** tech-lead
  - **Định nghĩa xong:** 3 điểm (a)(b)(c) có câu trả lời ghi lại; nếu đụng `tsconfig`/config ⇒ flag rõ cho T1.

- [x] **T1. Viết `utils/composer-trigger.ts` (hàm thuần) + test `node --test`** — **S**
  - **Mục tiêu:** một nguồn duy nhất cho toán học "token tại con trỏ", nhận `(draft, selectionStart, selectionEnd, …)` và trả dữ liệu thuần, không đụng textarea. Tối thiểu phủ:
    - **Slash:** phát hiện token lệnh tại con trỏ theo § "Định nghĩa dùng trong quy tắc" — `/` ở vị trí 0, `draft[0..con trỏ)` không có khoảng trắng (space/tab/xuống dòng), vùng chọn khác rỗng ⇒ không có token (E12). Trả từ khoá lọc `draft[1..con trỏ)` (R-B2).
    - **Thay slash:** chuỗi kết quả khi chọn lệnh = thay token đầu `/\S*` + tối đa một khoảng trắng ngay sau bằng `/<label> ` (đúng hành vi `applySlash` hiện có, E13), và **vị trí con trỏ mới ngay sau `/<label> `** (R-B4). Nhánh built-in `takesArg` (ăn phần còn lại làm đối số) giữ ở composer — util chỉ cần trả được "phần còn lại sau token".
    - **Vị trí con trỏ cho Insert `/`** (R-B6): cuối token đầu tin (trước khoảng trắng đầu tiên) cho cả ca vừa chèn `/` lẫn ca draft đã bắt đầu `/`.
    - **Token đầu tin cho R-B7:** trả tên token đầu (không `/`) và phần còn lại sau token, để composer so **khớp chính xác** với built-in không đối số (danh mục built-in vẫn ở composer, util không biết catalogue).
    - **Mention:** phát hiện bằng regex hiện có `(^|\s)@([\w./:-]*)$` trên `draft[0..con trỏ)` (R-D1, không đổi regex); trả từ khoá = nhóm 2; vùng token = từ `@` tới hết dãy `[\w./:-]` liên tiếp **sau** con trỏ (R-D4, E14).
    - **Thay mention:** thay vùng token bằng `@<insert>`; quy tắc khoảng trắng đuôi + con trỏ R-D3 (`next` là space/tab ⇒ không chèn thêm, con trỏ sau space có sẵn; còn lại ⇒ chèn một space, con trỏ sau space đó).
    - **Gỡ mention cho `@page`** (R-D5): gỡ vùng token, nếu ký tự ngay sau là space/tab thì gỡ thêm đúng một ký tự; con trỏ tại vị trí `@` cũ.
  - **Test (`node --test`, theo cách chạy T0 chốt):** mỗi ca là một AC của spec dạng `|` = con trỏ — tối thiểu AC-B2, AC-B3, AC-B4 (mọi tiền tố của `review trang login` không có token), AC-B6, AC-B10, AC-B11, AC-B13, AC-B15/B16 (token đầu khớp chính xác vs tiền tố), AC-B19, AC-B20, AC-D1…AC-D8, AC-D11, AC-D13, E12 (vùng chọn khác rỗng), E14, E15; kiểm tra "mọi ký tự ngoài vùng token giữ nguyên" bằng so chuỗi đầy đủ.
  - **File chạm:** `apps/desktop/ui-next/utils/composer-trigger.ts` (mới) · file test theo T0(a) (mới) · `package.json` **chỉ nếu** T0(c) chốt thêm script.
  - **AC spec thoả (ở mức logic):** AC-B2, B3, B4, B6, B10, B11, B13, B19, B20 · AC-D1…D8, D11, D13 · E12, E14, E15.
  - **Depends on:** T0
  - **Owner:** developer
  - **Định nghĩa xong:** test xanh bằng một lệnh `node --test <path>` ghi trong PR; `pnpm lint` 0 error, `pnpm typecheck` 0 error; file util **không** import gì ngoài TS thuần; export đặt tên rõ, comment kỹ thuật tiếng Việt giải thích R-D3/R-D4 ngay tại chỗ.
  - **Risk:** Nuxt auto-import mọi export cấp 1 của `utils/` ⇒ chọn tên export không đụng tên đã có (grep trước, ví dụ tránh `findToken`/`replaceToken` chung chung). `\w` chỉ ASCII là **cố ý** (E16) — không "sửa" sang Unicode.

- [x] **T2. Nối util vào `SessionComposer.vue`: menu theo con trỏ, thay đúng token, Enter, IME, Insert `/`, built-in gõ tay** — **S** (sát ngưỡng M — xem Risk)
  - **Mục tiêu:** composer dùng T1 thay cho logic theo toàn draft. Các điểm sửa (mốc dòng lấy từ spec § "Hiện trạng code"):
    1. `refreshAutocomplete()` (~:1581) + `slashMatches` (~:1409): mở menu `/` theo token tại con trỏ (R-B1, R-B2); khi không có token lệnh thì **rơi xuống** đánh giá menu `@` thay vì `return` sớm (R-B8).
    2. `applySlash`: thay token qua T1, đặt con trỏ ngay sau `/<label> ` thay vì cuối draft (R-B4); nhánh built-in `takesArg` giữ nguyên ngữ nghĩa. Menu đóng ngay sau khi chọn. Lệnh khớp chính xác vẫn đi qua menu (R-B5 — **không** thêm ngoại lệ "khớp chính xác thì gửi").
    3. `applyMention` (~:1654, cả nhánh `page` ~:1660 và nhánh thường ~:1670): bỏ regex neo `$` trên toàn draft, thay vùng token tại con trỏ qua T1 + đặt con trỏ theo R-D3 (R-D2, R-D4). Nhánh `@page`: gỡ token qua T1 **trước**, rồi mới `attachPage()` để nó đọc draft đã gỡ (R-D5).
    4. `onEnter` (~:1338): giữ cơ chế "menu mở + Enter không Shift ⇒ `acceptActive()`" (R-B3); menu đóng ⇒ thêm nhánh **R-B7**: token đầu **trùng chính xác** một built-in không đối số ⇒ dispatch built-in (tái dùng đúng đường built-in của `applySlash`, không nhân bản), draft còn phần sau token, không gửi cho model. Tiền tố (`/pla fix`) ⇒ gửi như văn bản. `/browser …` vẫn qua `dispatchBuiltinDraft` (~:1313). Steer/queue khi stream và `composerSendKey` không đổi (AC-R5, AC-R7).
    5. **R-X2/R-X3 — di chuyển con trỏ không qua input:** nghe thêm sự kiện con trỏ trên textarea (gợi ý: `click`/`mouseup`/`keyup` của phím điều hướng/`select` — chọn cụ thể là việc của dev). Chỉ đánh giá lại khi menu **đang mở**: hết token ⇒ đóng; còn token ⇒ lọc lại. Di chuyển con trỏ **không bao giờ mở** menu đang đóng. Từ khoá không đổi ⇒ giữ highlight; đổi ⇒ về mục đầu. ↑/↓ khi menu mở không được di chuyển con trỏ textarea (AC-R2).
    6. **R-X4 — IME:** không có xử lý IME nào trong `ui-next` hiện nay ⇒ thêm guard: đang soạn (`KeyboardEvent.isComposing` hoặc cờ giữa `compositionstart`/`compositionend`) thì handler **không xử lý** Enter/↑/↓/Esc, ở cả lúc menu mở lẫn đóng (Enter chốt chữ không gửi tin). Input cuối sau khi soạn xong đánh giá lại theo R-X1.
    7. `insertSlash` (~:1697): đặt con trỏ theo T1 (R-B6) thay vì `refocusDraft()` về cuối; draft đã bắt đầu `/` ⇒ không chèn thêm. Insert `@` **giữ nguyên** nối cuối (R-D6, AC-D14).
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionComposer.vue` — **và chỉ file này** (cộng import util T1 qua auto-import).
  - **AC spec thoả:** AC-B1…AC-B20 · AC-D1…AC-D14 · AC-R1…AC-R7 · AC-I1…AC-I4 · E1…E10, E12, E13, E17, E20; E7 ở mức tối thiểu (không mất text ngoài vùng token, không lỗi console).
  - **Depends on:** T1
  - **Owner:** developer
  - **Định nghĩa xong:** `pnpm lint` + `pnpm typecheck` 0 error; tự chạy tay nhanh 3 flow ở spec § "User flow" (B, flow phụ B, D) trong app trước khi chuyển QA; diff không chạm file nào ngoài danh sách.
  - **Risk:** (1) Đây là task to nhất — 7 điểm sửa trên một file SFC đã dài. Nếu vượt nửa ngày, tách tại chỗ thành **T2a** (điểm 1–4 + 7: B, D, R-B6, R-B7) và **T2b** (điểm 5–6: R-X2/R-X3 + IME), cùng dev, tuần tự. (2) **R-B7 là đổi hành vi có chủ đích** để bù việc menu không còn luôn mở với draft bắt đầu `/` — bỏ sót thì `/plan fix bug` thành prompt gửi cho model (AC-B15). (3) Đặt con trỏ sau khi gán `draft` phải chờ DOM cập nhật (gán giá trị rồi mới `setSelectionRange`), nếu không con trỏ nhảy về cuối và menu `@` bật lại (lỗi B nhưng ở `@`). (4) Latency: đánh giá lại khi di chuyển con trỏ chỉ chạy lúc menu mở (spec § Non-functional). Listener `selectionchange` trên `document` (tech-lead T3) chấp nhận được: menu đóng ⇒ thoát ngay sau một phép so `activeElement`.

- [x] **T3. Bubble người dùng: chip chỉ `/name`, args là văn xuôi bên dưới** — **S**
  - **Mục tiêu:** sửa khối `.ucmd` trong `SessionMessageItem.vue` (template :33-39, CSS ~:972-994):
    - Chip chỉ chứa icon lệnh + `/name` (R-C1); tên `white-space: nowrap`, không bẻ ở `-`/`:`/`/` (R-C2); chip giữ `var(--code)` + skin primary-tint hiện có, **giữ/ghi** `/* mono-ok: tên lệnh là chuỗi người dùng gõ/copy vào CLI */`.
    - Tên cực dài: chip co tối đa bằng bề rộng bubble, cắt `…` ở **cuối**, không tràn, không bẻ dòng (R-C3).
    - `args` khác rỗng ⇒ render **dòng mới bên dưới chip** bằng `SessionLinkedText` (ngắt dòng của người dùng ⇒ `<br>`, URL/path bấm được) — font hệ thống, cỡ/leading/màu như text thường của bubble (`var(--fs-md)`/`var(--lh-md)`, kế thừa từ `.mu`), **bỏ** `nowrap` + `text-overflow: ellipsis` của `.ucmd-args`, kế thừa `overflow-wrap: anywhere`, không `pre-wrap` (R-C4). `args` rỗng ⇒ không có dòng trống (AC-C6).
    - `title` trên chip = `message.text` như cũ; args không có tooltip riêng (R-C5). Không đổi `SlashCommandRef`/`message.text`, tin cũ render theo bố cục mới không cần migrate (R-C6).
    - Mọi font-size/line-height/radius mới chỉ bằng token; `.ucmd` hiện là `inline-flex` — đổi bố cục bằng flex/layout thường, không hardcode px cho chữ.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionMessageItem.vue` — **và chỉ file này** (không sửa `SessionLinkedText.vue`).
  - **AC spec thoả:** AC-C1…AC-C10 · E18 (popout/board thread dùng cùng component).
  - **Depends on:** none (song song T0/T1/T2).
  - **Owner:** developer
  - **Định nghĩa xong:** `pnpm lint` (gồm design-token check) + `pnpm typecheck` 0 error; render args **chỉ** qua text interpolation / `SessionLinkedText`, không `v-html`.
  - **Risk:** `SessionMessageItem.vue` là file nóng (nhiều feature cùng sửa) ⇒ rebase trước khi mở PR; giữ diff gọn trong khối `.ucmd`.

- [x] **T4. QA: verify toàn bộ AC + edge case** — **S**
  - **Mục tiêu:** chạy tay trên app (Electron, `composerSendKey = 'enter'` mặc định) toàn bộ AC; T1 đã phủ logic bằng test nên QA tập trung vào **tương tác thật**: sự kiện con trỏ, Enter, IME, bố cục bubble.
  - **Ca bắt buộc:**
    1. **B (AC-B1…B20):** flow chính `/evo` → chọn → gõ `review trang login` → Enter gửi một lần; R-B5 hai lần Enter (AC-B6…B8); click giữa token (AC-B9/B10); End đóng menu rồi Enter gửi (AC-B11/B12); Shift+Enter xuống dòng (AC-B13); built-in `/compact`, `/plan fix bug`, `/pla fix`, `/browser example.com` (AC-B14…B17); nút `+` Insert `/` ở draft rỗng và draft có chữ (AC-B18/B19); mention trong draft có lệnh (AC-B20).
    2. **D (AC-D1…D14):** mention đầu/giữa/cuối, nhiều `@` (AC-D4 — `@src/a.ts`, `@wiki:x` không đổi từng ký tự), con trỏ giữa token (AC-D5/D6), draft 3 dòng (AC-D7), `@page` (AC-D8, khối trang vẫn nối cuối), click/← khi menu mở (AC-D9…D11), click vào mention cũ khi menu đóng **không** mở menu (AC-D12), email (AC-D13), Insert `@` (AC-D14).
    3. **C (AC-C1…C10):** panel hẹp nhất cho phép; args 600 ký tự; args 3 dòng; tên 120 ký tự; URL dài bấm được; kiểm font bằng DevTools; session cũ lưu trước bản sửa; cả theme `awog` và `cute`; cả cửa sổ popout session (E18).
    4. **Hồi quy (AC-R1…R7):** AC-R1 so `text` + `command` gửi đi với bản trước sửa (lệnh có `$ARGUMENTS`/`$1`/`$2`, lệnh CLI native, văn bản có `@src/a.ts`); ↑/↓ vòng quanh không xê dịch con trỏ; Esc; Shift+Enter; `composerSendKey = 'shift-enter'`; click mục menu; steer/queue khi đang stream.
    5. **IME (AC-I1…I4):** Telex tiếng Việt trên macOS với menu mở (`/evo`, `@ti`) và menu đóng; IME tiếng Nhật đổi ứng viên bằng ↑/↓ khi menu `@` mở; Enter sau khi chốt chữ.
    6. **Edge:** E7 (⌘Z sau chèn không mất text ngoài token, không lỗi console), E12 (Shift+← khi menu mở ⇒ đóng), E14/E15, E17 (dán khi con trỏ trong token), draft dài vài nghìn ký tự không giật khi gõ.
  - **File chạm:** không sửa file.
  - **AC spec thoả:** verify AC-B1…B20, AC-D1…D14, AC-C1…C10, AC-R1…R7, AC-I1…I4.
  - **Depends on:** T2, T3
  - **Owner:** qa-tester
  - **Định nghĩa xong:** bảng kết quả PASS/FAIL từng AC (ghi trong PR); FAIL ⇒ trả về T2/T3, không tự sửa.

- [x] **T5. Code review** — **S**
  - **Mục tiêu:** review theo ràng buộc "KHÔNG chạm" ở đầu plan và spec § Non-functional.
  - **Checklist:** (a) diff chỉ gồm `utils/composer-trigger.ts`, file test, `SessionComposer.vue`, `SessionMessageItem.vue` (+ `package.json` / ghi chú spec nếu T0 chốt); (b) `utils/slash-command.ts`, `SessionSlashMenu`, `SessionMentionMenu`, `WorkspaceBoardComposer.vue`, `stores/**`, `types/index.ts`, sidecar, electron **không đổi**; (c) không dependency mới, `pnpm-lock.yaml` không đổi; (d) util T1 thuần (không import Vue/DOM/Nuxt), composer không còn regex neo `$` trên toàn draft và không còn `startsWith('/')` làm điều kiện mở menu; (e) R-B7 tái dùng đường built-in của `applySlash`, không nhân bản logic dispatch; (f) IME guard bao cả Enter/↑/↓/Esc ở cả hai trạng thái menu; (g) design token đúng, `mono-ok` có lý do, args không mono, không `v-html`; (h) identifier/log tiếng Anh, comment tiếng Việt; (i) `pnpm lint` + `pnpm typecheck` 0 error, test T1 xanh.
  - **File chạm:** không sửa file (comment trên PR).
  - **AC spec thoả:** gián tiếp — xác nhận spec § Non-functional + AC-R1 (không đổi hợp đồng gửi).
  - **Depends on:** T1, T2, T3 (song song T4)
  - **Owner:** code-reviewer
  - **Định nghĩa xong:** approve, hoặc danh sách thay đổi bắt buộc trả về developer.

- [x] **T6. Cập nhật tài liệu** — **S**
  - **Mục tiêu:** spec `Status: Spec → Implemented` (ghi ngày); bổ sung trong spec cách chạy test T1 (lệnh `node --test`) nếu T0 chưa ghi; kiểm [slash-commands.md](./slash-commands.md) — nếu có câu mô tả menu `/` "mở khi draft bắt đầu `/`" hoặc mention "chỉ ở cuối" thì sửa cho khớp R-B1/R-D2/R-B7. Không ADR mới (trừ khi T0 đổi `tsconfig`).
  - **File chạm:** `docs/features/composer-trigger-fixes.md` · `docs/features/slash-commands.md` (nếu có câu sai).
  - **AC spec thoả:** không (tài liệu).
  - **Depends on:** T4, T5
  - **Owner:** developer
  - **Định nghĩa xong:** không tài liệu nào còn mô tả hành vi cũ; liên kết tương đối đúng.

---

## Thứ tự ship / chia PR

| PR | Gồm task | Ghi chú |
|---|---|---|
| **PR-1** | T1 → T2 → T3 (3 commit tách: util+test / composer / bubble) + T4 + T5 + T6 | Một PR là đủ với cỡ S. Nhánh hiện tại `fix/composer-trigger-fixes`. T3 có thể commit trước T1/T2 vì độc lập. |

## Backlog (sau lần này)

- [ ] **F1. Áp cùng bản sửa B/D cho `WorkspaceBoardComposer.vue`** (spec Q1 — **ngoài phạm vi lần này**) — S · developer · Depends on: PR-1 merge. File chép cùng logic (`startsWith('/')` ~:365, regex neo `$` ~:372/:426). Dùng lại util T1 — đây là bản sao thứ hai nên dùng chung là hợp lý. Cần PO tạo brief/AC riêng (IME, R-X, R-B7 có áp dụng y hệt không).
- [ ] **F2. Ưu tiên mục khớp chính xác trong xếp hạng menu `/`** (E11) — cần spec riêng (đụng xếp hạng autocomplete, ngoài phạm vi).
- Các mục còn lại của spec § Out of scope (A, Insert `@` tại con trỏ, `@page` chèn tại con trỏ, undo native từng thao tác chèn, mention Unicode, Remote PWA) **không tạo task**.

## Test plan high-level

- Logic token (T1): unit test `node --test` theo AC dạng `|`-con-trỏ — nguồn sự thật cho chuỗi kết quả và vị trí con trỏ.
- Tương tác (T4): AC-B/D/C/R/I chạy tay trên app.
- Edge ưu tiên cao: R-B7 built-in gõ tay (AC-B15/B16), IME Telex với menu mở (AC-I1), nhiều `@` trong draft (AC-D4), tên lệnh 120 ký tự (AC-C8).

## Risks

- **T2 vượt ngưỡng S** — đã có phương án tách T2a/T2b tại chỗ.
- **Hành vi built-in gõ tay (R-B7)** là nhánh mới duy nhất trên đường gửi; sai thì lệnh hành động bị gửi cho model như văn xuôi.
- **Test `.ts` dưới Node:** type-stripping cần import có đuôi `.ts`, đụng tới `pnpm typecheck` (xem T0(b)); và Node trước 22.18 cần cờ `--experimental-strip-types` — cần ghi rõ phiên bản Node khi chốt lệnh chạy.

## Open questions

- **OQ-1 (tech-lead, T0):** vị trí file test, cách import `.ts` vừa chạy được dưới Node vừa qua `pnpm typecheck` (có phải đổi `tsconfig`/loại thư mục test khỏi typecheck không — nếu có thì là config change, flag rõ), và có thêm script `test` vào `apps/desktop/ui-next/package.json` không.

## Missing from spec

**Không có.** Spec đã tự chốt R-B5, R-B7, R-D3, R-D4, R-X2, R-C1, R-C3, R-C4; Q1 đã được chốt là follow-up (F1).
