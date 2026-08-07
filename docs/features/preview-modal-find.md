# Preview Modal — Find-in-page (tìm kiếm theo từ khóa)

> Spec BA cho tính năng **tìm trong nội dung đang xem** của `PreviewModal`, bật bằng **Cmd/Ctrl+F**.
> Liên quan: [preview-modal-back-stack](./preview-modal-back-stack.md), [workspace-panel](./workspace-panel.md).
> Chạm: [`components/common/PreviewModal.vue`](../../apps/desktop/ui-next/components/common/PreviewModal.vue), [`composables/usePreviewModal.ts`](../../apps/desktop/ui-next/composables/usePreviewModal.ts), tham chiếu cơ chế highlight [`utils/quote-highlight.ts`](../../apps/desktop/ui-next/utils/quote-highlight.ts) + [`components/session/SessionMarkdownHtml.vue`](../../apps/desktop/ui-next/components/session/SessionMarkdownHtml.vue), [`components/common/MonacoViewer.vue`](../../apps/desktop/ui-next/components/common/MonacoViewer.vue).

## Bối cảnh & vấn đề

`PreviewModal` là viewer full-window dùng chung (mount app-lifetime ở `layouts/default.vue`, drive bởi shared store `usePreview()`). Nó render **nhiều loại nội dung** trong cùng một khung `.pvcard`, mỗi loại có "bề mặt tìm kiếm" khác nhau. Hiện `PreviewModal` **chưa có** tìm kiếm; `Cmd/Ctrl+F` khi modal mở sẽ bung **find của trình duyệt/Electron** — vô dụng vì nội dung nằm trong Monaco / iframe / DOM v-html và không nhất quán giữa các loại.

Vì không thể một cơ chế phủ hết mọi loại nội dung, **phạm vi đã được chốt cứng** (mục dưới): find chỉ áp cho 3 bề mặt, các bề mặt còn lại **không hỗ trợ** (quyết định cuối, không có giai đoạn sau).

## Persona chịu tác động

- **Người đọc tài liệu** (dev/PM/PO): mở 1 doc/report markdown dài full-screen, muốn nhảy tới từ khóa (tên hàm, mã AC, tên file).
- **Người xem code/config**: xem file text/code trong Monaco — vốn đã quen `Cmd+F` native của Monaco.
- **Người xem PDF**: xem spec `.pdf`, muốn tìm nhanh.

## Phạm vi (đã chốt cứng)

| Bề mặt render | Hỗ trợ find | Cơ chế |
|---|---|---|
| `markdown` — view=render (`.mdbody` v-html) | ✅ **Có** | **Thanh search AWOG** + DOM `<mark>` highlight (tái dùng cơ chế quote-highlight) |
| `text` / `code` / `markdown`-raw / `html`-raw (Monaco) | ✅ **Có** | **Monaco find widget** — mở/focus qua `focusFind()` |
| `pdf` (iframe Chromium) | ✅ **Có** | **Chromium PDF find native** (AWOG nhường) |
| `html` — view=render (iframe sandbox) | ❌ **Không hỗ trợ** | Parent không đọc/inject được DOM iframe (không `allow-same-origin` — chủ ý bảo mật). Lối thoát: nút "Open in browser". |
| `doc` (docx) / `sheet` (xlsx) | ❌ **Không hỗ trợ** | Loại khỏi phạm vi. |
| `image` / `video` / `audio` / `folder` | ❌ **Không hỗ trợ** | Không có prose để tìm. |

Nguyên tắc KISS: bề mặt người dùng đọc nhiều nhất và **thiếu** find sẵn là markdown-render → AWOG tự cài thanh search cho nó. Monaco + PDF đã có find native tốt → **nhường**, không tái phát minh và không thống nhất về một widget duy nhất (giữ 3 kiểu find theo loại cho đơn giản).

## Xử lý phím `Cmd/Ctrl+F`

**Hiện trạng:** `PreviewModal.vue` đăng ký `window.addEventListener('keydown', onKeyGuarded)` (onMounted); `onKeyGuarded` → `onKey` chỉ bắt `Escape`. Không có handler cho `Cmd+F`.

Quy tắc (Least Astonishment) — **bắt keydown ở capture** để chắc chắn `preventDefault` trước khi browser-find kích hoạt:

1. **Chỉ xử lý khi modal đang mở** (`item.value != null`).
2. **Bề mặt `markdown`-render:** `e.preventDefault()` + `e.stopPropagation()` → mở/focus **thanh search AWOG**. **Prefill selection (MỚI):** nếu người dùng đang **bôi đen** text TRONG surface markdown (`.mdbody`) và selection không rỗng → **điền sẵn** đoạn đã chọn vào ô tìm kiếm rồi **chạy tìm ngay**; nếu selection rỗng / chỉ khoảng trắng / nằm ngoài `.mdbody` → mở bar bình thường (giữ query cũ hoặc rỗng, không prefill). Sau prefill (hoặc mở bar), focus input + `select()` toàn bộ để user gõ đè dễ. `Cmd+F` **lần nữa** khi thanh đang mở → nếu có selection mới trong `.mdbody` thì **thay** query bằng selection đó + chạy tìm + `select()`; else chỉ focus lại input + `select()` toàn bộ.
3. **Bề mặt Monaco (`showCode`):** `e.preventDefault()` + gọi `focusFind()` mở find widget của Monaco. Lý do phải chủ động: Monaco chỉ tự bắt `Cmd+F` khi editor **đang focus**; nếu focus ở body (vd vừa mở modal) thì `Cmd+F` rơi xuống browser-find. Đây là điểm kỹ thuật cần tech-lead (xem cuối). **Prefill:** Monaco find widget **tự** điền selection đang chọn khi mở → **không cần** AWOG làm gì thêm.
4. **Bề mặt `pdf`:** **KHÔNG** `preventDefault` → nhường Chromium PDF viewer tự bắt `Cmd+F` trong iframe (native find, tự xử lý selection).
5. **Bề mặt không hỗ trợ** (html-render / office / media / folder): **no-op** (không mở thanh, không preventDefault → giữ hành vi mặc định).

## UI thanh search (markdown-render)

Vị trí: **overlay góc trên–phải** bên trong `.pvcard` (dưới header `.pvhead`, absolute — không đẩy layout, giống progress strip của Git). Nổi trên nội dung, có bóng đổ.

Thành phần (trái → phải):

- **Input** tìm kiếm (placeholder "Tìm trong tài liệu…"), autofocus khi mở.
- **Counter** `"3/12"` (match hiện tại / tổng). Rỗng → ẩn. Không match → `"0/0"` + input viền `--danger`.
- **Toggle `Aa`** match-case (trạng thái bật dùng `--accent`).
- **`‹` previous match**, **`›` next match** (disable khi total=0).
- **`×` đóng** thanh search.

Option cố định (không toggle):

- **Đếm n/total** — có.
- **Wrap-around** (next ở match cuối → về match đầu) — bật mặc định, không toggle.
- **Whole word / regex** — **không làm** (Monaco đã có cho code; prose không cần).
- **Match có phân biệt dấu (NFC)** — luôn phân biệt dấu; **không** có chế độ bỏ dấu tiếng Việt.

Màu sắc: **bắt buộc** qua `useTheme()` token (`--bgEl`, `--border`, `--text`, `--textDim`, `--accent`, `--accentBorder`, `--danger`, `--bgHover`). **Không** hardcode hex. Icon `lucide-vue-next` (search, chevron-up/down, x; `Aa` là text label hoặc icon `case-sensitive`).

## Bàn phím & thứ tự ưu tiên

Khi **thanh search markdown đang mở**:

| Phím | Hành động |
|---|---|
| `Enter` | Next match (cuộn tới match) |
| `Shift+Enter` | Previous match (cuộn tới match) |
| `Cmd/Ctrl+F` (lần nữa) | Prefill selection mới (nếu có) hoặc focus lại input + `select()` toàn bộ |
| `Esc` | **Đóng thanh search** (KHÔNG đóng modal) — gỡ highlight, trả focus về nội dung |

**Thứ tự ưu tiên `Esc`** (cập nhật `onKey`/`onKeyGuarded`), từ cao xuống thấp:

1. **Popover translate active** (đã có — giữ nguyên, ưu tiên cao nhất).
2. **Thanh search đang mở** → đóng search. **(MỚI — chèn TRƯỚC rename/confirm)**
3. `rename.open` → `closeRename()`.
4. `confirmReq` → `cancelConfirm()`.
5. `canGoBack` → `goBack()` (pop back-stack).
6. else → `close()` (đóng modal).

> Lý do đặt search **trên** rename/confirm: search là lớp UI "nông" nhất người dùng vừa tương tác; đóng nó trước là kỳ vọng tự nhiên. Search + rename thường loại trừ nhau → cố định thứ tự search-trước cho đơn giản.

## Highlight + current match (markdown-render)

Tái dùng ý tưởng của [`utils/quote-highlight.ts`](../../apps/desktop/ui-next/utils/quote-highlight.ts):

- Xây **text index** từ DOM (`buildTextIndex` — map char normalize → `{node, offset}`), tìm **tất cả** occurrence của từ khóa (cần biến thể lặp `indexOf`; `locateMarks` hiện chỉ trả occurrence đầu → phải generalize).
- Mỗi match → wrap `<mark class="findmatch">` bằng **DOM Range** (`extractContents` + `insertNode`), **không** splice chuỗi HTML (an toàn XSS — nội dung đã sanitized bởi `useMarkdown`, cùng trust boundary v-html).
- **Match hiện tại** thêm class `findmatch--current` (màu khác: `background: --accent`, chữ `--bg`; match thường: tint `--amber` nhạt). Wrap **phải theo thứ tự document giảm dần** để `extractContents` của match sau không dịch offset match trước (đúng như `applyMarks` hiện có).
- **Cuộn tới match — CHỈ khi điều hướng chủ động (CẬP NHẬT):** `scrollIntoView({ block: 'center' })` **chỉ** chạy khi người dùng bấm next/prev (`Enter`/`Shift+Enter`/`‹`/`›`). **KHÔNG** tự cuộn sau `runFind` (lúc vừa gõ từ khóa / vừa toggle match-case): highlight + đánh dấu current (đổi màu) + counter `1/N` cập nhật, nhưng **viewport giữ nguyên**. Nếu match đầu nằm ngoài viewport → người dùng tự cuộn hoặc bấm next để nhảy tới. (Về code: tách `scrollIntoView` ra khỏi `applyCurrent`; `runFind` chỉ đánh dấu current, `nextMatch`/`prevMatch` mới cuộn.)
- **Dọn dẹp:** trước mỗi lần search lại / đổi từ khóa / đóng search → **unwrap** toàn bộ `<mark class="findmatch">` (thay `mark` bằng text nodes con + `normalize()`).

> **Lưu ý DOM an toàn:** `.mdbody` trong PreviewModal render bằng `v-html` (Vue quản lý). Wrap `<mark>` trực tiếp có rủi ro Vue patch đè khi `segments`/`view`/`item` đổi. Vì preview markdown là **tĩnh** (không streaming từng frame như transcript) → rủi ro thấp, nhưng dev phải **unwrap sạch trước khi Vue re-render** (watch `item`/`view`/`effectiveText`).

## Tương tác với back-stack / minimize / rename

- **Đổi item** (push link, folder-tree open, Back, rename replace, reload): **reset search state** — đóng thanh, xóa từ khóa, unwrap highlight. Highlight cũ vô nghĩa trên nội dung mới.
- **Minimize/restore:** không lưu search state qua dock (KISS). Restore mở lại ở trạng thái không-search.
- **Rename/confirm dialog mở:** thanh search đóng; `Esc` ưu tiên theo bảng trên.
- **Edit mode Monaco** (markdown chuyển view=raw để sửa): rời khỏi markdown-render → thanh search AWOG đóng; find giờ do Monaco lo.

## Acceptance Criteria (Given/When/Then)

### AC-1 — Mở thanh search trên markdown-render
- **Given** đang xem 1 file markdown ở view=render, **When** nhấn `Cmd/Ctrl+F`, **Then** thanh search hiện góc trên-phải, input được focus, browser-find KHÔNG bung, chưa highlight cho tới khi gõ.

### AC-2 — Tìm và highlight tất cả match (KHÔNG tự cuộn)
- **Given** thanh search mở, **When** gõ từ khóa có trong tài liệu, **Then** mọi occurrence được highlight, match đầu được đánh dấu "current" (đổi màu) + counter `1/N`; **viewport GIỮ NGUYÊN** — find KHÔNG tự cuộn tới match đầu. Chỉ khi người dùng chủ động bấm next/prev (AC-3) mới cuộn.

### AC-3 — Next / Prev (cuộn khi người dùng chủ động điều hướng)
- **Given** có ≥2 match, **When** `Enter` (hoặc `›`), **Then** current chuyển match kế, counter cập nhật, và match hiện tại **được cuộn vào view** (`scrollIntoView({ block: 'center' })`) — đây là lúc DUY NHẤT find tự cuộn, vì người dùng chủ động điều hướng. **When** `Shift+Enter` (hoặc `‹`) **Then** lùi 1 match (cũng cuộn vào view).

### AC-4 — Wrap-around
- **Given** current là match cuối, **When** Next, **Then** current về match đầu (`1/N`). Tương tự Prev ở match đầu → về match cuối.

### AC-5 — Match case
- **Given** từ khóa "Task", match-case **off**, **When** bật toggle `Aa`, **Then** kết quả lọc lại chỉ còn match phân biệt hoa/thường (live, không cần Enter), counter + highlight cập nhật, current reset về match đầu hợp lệ (KHÔNG tự cuộn — theo AC-2).

### AC-6 — Không có kết quả
- **Given** thanh search mở, **When** gõ từ khóa không tồn tại, **Then** counter `0/0` (hoặc "Không có kết quả"), input viền `--danger`, không highlight, Next/Prev vô hiệu.

### AC-7 — Từ khóa rỗng
- **Given** thanh search có từ khóa + highlight, **When** xóa hết input, **Then** mọi highlight bị gỡ, counter ẩn, không lỗi.

### AC-8 — Đóng search bằng Esc (không đóng modal)
- **Given** thanh search mở, **When** `Esc`, **Then** thanh search đóng, highlight gỡ sạch, **modal vẫn mở** ở đúng vị trí cuộn. **When** `Esc` lần nữa (không còn search/rename/confirm, ở gốc stack) **Then** modal đóng.

### AC-9 — Monaco find
- **Given** đang xem file `text`/`code` (Monaco), **When** `Cmd/Ctrl+F`, **Then** find widget **của Monaco** mở (không phải thanh AWOG), browser-find không bung — kể cả khi focus chưa ở trong editor. (Selection đang chọn được Monaco tự prefill — AWOG không can thiệp.)

### AC-10 — PDF find
- **Given** đang xem `pdf`, **When** `Cmd/Ctrl+F` với focus trong iframe PDF, **Then** find native của Chromium PDF hoạt động (AWOG không can thiệp).

### AC-11 — Đổi item reset search
- **Given** thanh search mở + có highlight trên markdown A, **When** click 1 link file trong A (push) hoặc Back, **Then** search đóng, highlight gỡ, item mới hiển thị sạch.

### AC-12 — Unicode / tiếng Việt (phân biệt dấu)
- **Given** tài liệu chứa "phân tích", **When** tìm "phân tích", **Then** match đúng (chuẩn hóa NFC). Tìm "phan tich" (không dấu) **không** match "phân tích".

### AC-13 — Bề mặt không hỗ trợ = no-op
- **Given** đang xem `html`-render / docx / xlsx / image / video / audio / folder, **When** `Cmd/Ctrl+F`, **Then** thanh search AWOG **không** mở (no-op); không lỗi.

### AC-14 — Prefill selection vào ô tìm kiếm (markdown-render)
- **Given** đang xem markdown ở view=render và người dùng **bôi đen** một đoạn text trong `.mdbody`, **When** nhấn `Cmd/Ctrl+F`, **Then** thanh search mở với ô tìm kiếm **điền sẵn** đoạn text đang chọn và **chạy tìm ngay** (highlight tất cả + current = match đầu, **KHÔNG** tự cuộn — theo AC-2), input được focus + `select()` toàn bộ để gõ đè dễ.
- **Edge — selection rỗng / ngoài `.mdbody`:** **When** không có selection (hoặc chỉ khoảng trắng, hoặc selection nằm ngoài surface markdown) và nhấn `Cmd/Ctrl+F`, **Then** bar mở bình thường, **không** prefill (giữ query cũ hoặc rỗng).
- **Edge — bar đang mở sẵn:** **When** người dùng chọn text mới rồi `Cmd/Ctrl+F` lần nữa, **Then** query bị **thay** bằng selection mới + `select()` toàn bộ (không cộng dồn); nếu không có selection mới → chỉ focus lại + `select()`.

> **Monaco & PDF — không cần làm gì cho prefill:** Monaco find widget tự điền selection khi mở (`actions.find`); Chromium PDF find native cũng tự xử lý. Prefill selection **chỉ** áp cho thanh search AWOG (bề mặt markdown-render).

## Edge case

- **Từ khóa rỗng / chỉ khoảng trắng** → không search, gỡ highlight (AC-7).
- **Không match** → `0/0` + trạng thái cảnh báo, Next/Prev disabled (AC-6).
- **Sau khi tìm, match đầu ngoài viewport** → current được đánh dấu màu nhưng viewport **không** đổi (không auto-scroll); người dùng tự cuộn hoặc bấm next để nhảy tới (AC-2/AC-3).
- **File rất lớn** (markdown tới `PREVIEW_MAX_BYTES` = 4 MB): `buildTextIndex` + nhiều `<mark>` có thể chậm. **Debounce** input ~120ms; markdown-render **không** virtualize (toàn bộ DOM trong `.mdscroll`) nên `scrollIntoView` (khi next/prev) an toàn.
- **Match-case toggle live** → recompute ngay, giữ current gần vị trí cũ nếu còn hợp lệ, else về match đầu (không auto-scroll).
- **Đổi item khi search đang mở** → reset (AC-11); phải unwrap TRƯỚC khi Vue re-render `.mdbody` để tránh DOM rác.
- **Wrap-around ở match cuối/đầu** (AC-4).
- **Prefill — selection nhiều dòng / bắc qua block** → whitespace được **normalize** khi so khớp (giống `buildTextIndex`); nên trim + gộp whitespace trước khi set query, và **cắt bớt nếu selection quá dài** (đề xuất ngưỡng ≤200 ký tự; nếu selection có xuống dòng → chỉ lấy tới hết dòng đầu để query gọn, tránh set cả đoạn dài vào input 1 dòng).
- **Prefill — selection chứa ký tự đặc biệt** (`.`, `*`, `(`) → an toàn tự nhiên vì tìm **literal substring** (`indexOf`, KHÔNG regex).
- **Search trong edit-mode Monaco** → không dùng thanh AWOG; Monaco find lo (AC-9). Thanh AWOG tự đóng khi rời markdown-render.
- **Ký tự regex đặc biệt trong từ khóa** (`.`, `*`, `(`) → tìm **literal substring** (`indexOf`, KHÔNG regex) nên an toàn tự nhiên.
- **Match trải qua ranh giới inline** (bold/code/link) → `buildTextIndex` normalize đã gộp text; wrap theo Range per-run như quote-highlight (một match có thể thành nhiều `<mark>` nếu bắc qua block — hiếm với từ khóa ngắn).
- **`v-html` re-patch** khi reactivity → xem "Lưu ý DOM an toàn"; unwrap ở watch `item`/`view`/`effectiveText`.

## Edge case AWOG-specific

- **Local-first / offline:** thuần client-side (DOM/Monaco/PDF), không gọi sidecar/network → offline hoàn toàn. ✔
- **Restart-safe:** search là ephemeral UI state, không cần persist. ✔
- **Approval gate / trace / git / event log:** **không chạm** — read-only, không mutate file, không phát event, không commit. ✔
- **Multi-task concurrent:** PreviewModal là single-instance, single item → không có concurrency search. ✔
- **Security:** không I/O filesystem, không network. Wrap `<mark>` bằng DOM API (không splice HTML string) → không mở XSS surface mới; markdown đã sanitized bởi `useMarkdown`. Selection prefill đọc qua `window.getSelection()?.toString()` (chuỗi text thuần, tìm literal substring) → không mở surface mới. ✔ (Không cần `infosec` — không chạm surface nhạy cảm.)

## Dependency với module hiện có

- **Không** phụ thuộc entity domain (Task/Project/Workflow/Agent/Skill/Artifact) — thuần UI viewer.
- Phụ thuộc **kỹ thuật:** cơ chế `buildTextIndex`/Range-wrap ở `utils/quote-highlight.ts` (generalize để trả **tất cả** occurrence, hoặc tách util `find-in-dom.ts` mới — Rule of Three). `MonacoViewer` expose action find. Interaction với **back-stack** ([preview-modal-back-stack](./preview-modal-back-stack.md)): reset khi push/back/replace.
- **i18n:** thêm khóa `common.preview.find.*` (placeholder, matchCase, noResults, next, prev, close) cho en + vi.

## Điểm còn cần tech-lead (duy nhất)

**Cách `MonacoViewer.vue` expose `focusFind()`** để `usePreviewModal` gọi khi bắt `Cmd+F` trên bề mặt Monaco (vì editor chỉ tự bắt `Cmd+F` khi đã focus).

- Gợi ý: `defineExpose({ focusFind })` với `focusFind = () => editor.value?.getAction('actions.find')?.run()` (hoặc action id `editor.action.startFindReplaceAction`).
- TL chốt: cách expose (template ref tới `MonacoViewer`) + action id chuẩn.
- Ngoài điểm này: feature thuần UI, **không cần ADR**, không chạm sidecar/data-model/security.

## Quy mô

| Hạng mục | Quy mô | Ghi chú |
|---|---|---|
| Util `find-in-dom` (all-occurrence + wrap/unwrap) | **M** | Generalize từ `quote-highlight.ts`; cẩn thận unwrap + offset. |
| Thanh search UI + composable state | **M** | Component `PreviewFindBar.vue` + composable `usePreviewFind`. |
| Cmd+F / Esc wiring + nhường Monaco/PDF | **S** | Sửa `onKey`/`onKeyGuarded`, capture keydown. |
| Monaco `focusFind()` expose | **S** | defineExpose từ `MonacoViewer`. |
| i18n en/vi | **S** | |

**Tổng: M** (khu trú UI, không chạm sidecar/data/security). **Không cần ADR.**

## Đề xuất giải pháp KISS cho dev

1. **Tách util `utils/find-in-dom.ts`** (Rule of Three: quote-highlight = usage 1; find = usage 2 → generalize hợp lý). API tối thiểu:
   - `findAllRanges(root, needle, matchCase): Range[]` — tái dùng `buildTextIndex` (tách export từ quote-highlight), lặp `indexOf` từ sau match trước.
   - `wrapMatches(ranges): HTMLElement[]` — wrap `<mark class="findmatch">` phải-qua-trái (như `applyMarks`), trả list `<mark>` để set current.
   - `clearMatches(root)` — unwrap toàn bộ `.findmatch` + `root.normalize()`.
2. **State find** trong composable con `usePreviewFind(getRoot)`: `findOpen`, `query`, `matchCase`, `matches: HTMLElement[]`, `currentIndex`. Actions: `openFind(prefill?)`, `closeFind()`, `runFind()` (debounced), `nextMatch()`, `prevMatch()` (wrap-around), `applyCurrent()` (**chỉ** đổi class current — KHÔNG scrollIntoView), + cuộn tách riêng.
   - **CẬP NHẬT hành vi `applyCurrent`/`runFind` (bỏ auto-scroll):** hiện `applyCurrent()` vừa toggle class current vừa `scrollIntoView`, và được cả `runFind` lẫn `nextMatch`/`prevMatch` gọi. Tách `scrollIntoView({ block: 'center' })` ra khỏi `applyCurrent` (vd đưa vào helper `scrollToCurrent()`). `runFind` chỉ gọi `applyCurrent` (highlight + đánh dấu current, **không cuộn**); `nextMatch`/`prevMatch` gọi `applyCurrent` **+** `scrollToCurrent`. Kết quả: gõ từ khóa / toggle match-case không cuộn; chỉ next/prev mới cuộn.
   - **Prefill (MỚI):** `openFind(prefill?: string)` — nếu `prefill` non-empty thì `query.value = prefill` rồi `runFind()` (đồng bộ, không cần debounce vì đây là hành động chủ động); vẫn bump `focusTick` để `PreviewFindBar` focus + `select()`. Nếu không có prefill → giữ hành vi cũ (mở/focus). Cân nhắc thêm 1 action `setQuery(text)` để nhánh "bar đang mở + Cmd+F lần nữa có selection mới" thay query + chạy tìm.
3. **Logic prefill selection (ở `usePreviewModal`, nhánh Cmd+F markdown-render):**
   - **Nguồn:** `const sel = window.getSelection()?.toString() ?? ''`.
   - **Điều kiện áp dụng:** selection sau `trim()` không rỗng **VÀ** anchor/focus node của selection nằm TRONG surface markdown (`.mdbody`) — kiểm tra `mdbody.contains(selection.anchorNode)` (hoặc `getRange!.commonAncestorContainer`). Nếu không thỏa → gọi `openFind()` không tham số.
   - **Chuẩn hóa + cắt:** trim + gộp whitespace (`sel.replace(/\s+/g, ' ').trim()`); nếu chứa xuống dòng → chỉ lấy tới hết dòng đầu; **cắt ≤200 ký tự**. Truyền chuỗi kết quả vào `openFind(prefilled)`.
   - **Bar đang mở sẵn (Cmd+F lần nữa):** nếu có selection hợp lệ mới → `find.setQuery(prefilled)` + chạy tìm + bump `focusTick` (select-all); else chỉ bump `focusTick` (focus + select query hiện có).
   - Chỉ áp cho markdown-render; Monaco/PDF không đụng (đã có prefill native).
4. **Component `PreviewFindBar.vue`** thin: nhận state qua props/ctrl, emit events; màu qua `useTheme()`. Render trong `.pvcard` khi `findOpen && item.kind==='markdown' && view==='render'`.
5. **Wiring phím:** trong `onKeyGuarded`, thêm nhánh `Cmd/Ctrl+F` (capture):
   ```
   if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
     if (isMarkdownRender) { e.preventDefault(); openOrFocusFindWithSelection() }
     else if (showCode)    { e.preventDefault(); ctrl.focusMonacoFind() }
     // pdf: KHÔNG preventDefault → nhường Chromium
     // còn lại: no-op
   }
   ```
   Và trong `onKey` Esc: chèn `if (findOpen) return closeFind()` **trước** rename/confirm/back/close.
6. **Reset:** trong watch `item` (đã có ở `usePreviewModal`) + watch `view` → `closeFind()` (đóng + clearMatches) TRƯỚC khi Vue re-render `.mdbody`.
7. **Không** đụng Monaco/PDF ngoài việc **không preventDefault** cho PDF và gọi `focusFind()` cho Monaco.

Điểm mấu chốt: **thanh search AWOG chỉ ở markdown-render**, Monaco/PDF dùng find native của chúng — một mảnh UI + một util nhỏ, không rủi ro security, không ADR.

## Task plan (PM)

> Owner: `dev` = developer, `QA` = qa-tester. Feature thuần UI — **không cần ADR** (quyết định Monaco đã chốt, gộp vào T2). Chạm 3 file mới + sửa 3 file hiện có + 2 file i18n.

**T1. Tạo util `find-in-dom.ts`** — **M** — dev — depends: none
- File: `apps/desktop/ui-next/utils/find-in-dom.ts` (mới); tách/export `buildTextIndex` từ `utils/quote-highlight.ts`.
- `findAllRanges(root, needle, matchCase): Range[]` (lặp `indexOf`, literal substring KHÔNG regex, NFC), `wrapMatches(ranges): HTMLElement[]` (wrap `<mark class="findmatch">` phải-qua-trái), `clearMatches(root)` (unwrap + `normalize()`).
- Acceptance: trả **tất cả** occurrence; wrap/unwrap không để DOM rác; `quote-highlight.ts` không hồi quy; typecheck sạch.

**T2. Expose `focusFind()` từ `MonacoViewer.vue`** — **S** — dev — depends: none _(quyết định TL)_
- `focusFind(): boolean` = `editor.focus()` + `getAction('actions.find')?.run()`, guard null → boolean; `defineExpose({ focusFind })`.
- Acceptance: mở find widget kể cả focus chưa ở editor → `true`; chưa ready → `false`, không throw.

**T3. Composable `usePreviewFind`** — **M** — dev — depends: T1
- File: `composables/usePreviewFind.ts` (mới).
- State: `findOpen`, `query` (debounce ~120ms), `matchCase`, `matches`, `currentIndex`. Actions: `openFind(prefill?)`/`closeFind`/`runFind`/`nextMatch`/`prevMatch` (wrap-around)/`applyCurrent` (**chỉ** class current, không scroll) + cuộn tách riêng chỉ gọi từ next/prev.
- Acceptance: query rỗng→clear (AC-7); no-match→`0/0` (AC-6); match-case live giữ current (AC-5); wrap-around 2 chiều (AC-4); **runFind KHÔNG auto-scroll** (AC-2); next/prev cuộn (AC-3); `openFind(prefill)` set query + chạy tìm (AC-14).

**T4. Component `PreviewFindBar.vue`** — **S** — dev — depends: T3
- Overlay absolute góc trên-phải trong `.pvcard`; input autofocus + counter (`0/0` viền `--danger`) + toggle `Aa` + `‹`/`›` (disable total=0) + `×`; màu qua `useTheme()`, icon lucide; render khi `findOpen && kind==='markdown' && view==='render'`. Enter=next, Shift+Enter=prev, Cmd/Ctrl+F=focus+select.
- Acceptance: AC-1/2/3/6; không hardcode hex; ≤~250 dòng.

**T5. Wiring phím `usePreviewModal` + gắn ref `PreviewModal.vue`** — **S** — dev — depends: T2, T3, T4
- `monacoRef = shallowRef<{focusFind():boolean}|null>(null)` (export). Nhánh Cmd/Ctrl+F (capture): markdown-render→preventDefault+stopPropagation+open/focus thanh AWOG **+ prefill selection** (đọc `window.getSelection()`, guard `.mdbody`, normalize+cắt ≤200 ký tự); `showCode`→`monacoRef.value?.focusFind()`→true thì preventDefault (chưa ready→KHÔNG, nhường browser); pdf→nhường; else no-op. Esc: `if(findOpen) return closeFind()` **TRƯỚC** rename/confirm/back/close (sau popover translate). `PreviewModal.vue`: `ref="monacoRef"` lên `<MonacoViewer>`, mount `<PreviewFindBar>`, destructure `monacoRef`.
- Acceptance: AC-1/8/9/10/13/14.

**T6. Reset search khi đổi item/view** — **S** — dev — depends: T5
- Watch `item` + watch `view` → `closeFind()` (unwrap + reset) **TRƯỚC** khi Vue re-render `.mdbody`; rời markdown-render → đóng thanh AWOG.
- Acceptance: AC-11; không sót `<mark>`; minimize/restore về không-search.

**T7. i18n `common.preview.find.*` (en + vi)** — **S** — dev — depends: none _(song song)_
- Khóa: `placeholder`, `matchCase`, `noResults`, `next`, `prev`, `close`.
- Acceptance: đủ 2 ngôn ngữ; FindBar dùng khóa (không literal).

**T8. QA — AC-1..14 + edge + lint/typecheck** — **M** — QA — depends: T1–T7
- Verify 14 AC; edge: file lớn ~4MB/debounce, match-case live (AC-5), NFC phân biệt dấu (AC-12), đổi item reset (AC-11), wrap-around (AC-4), Monaco/PDF nhường (AC-9/10), no-op bề mặt không hỗ trợ (AC-13), Esc order (AC-8), **runFind không auto-scroll** (AC-2), next/prev cuộn (AC-3), **prefill selection** (AC-14). `pnpm lint` (0 error) + `pnpm typecheck`.

### Thứ tự thực thi
`T1 ∥ T2 ∥ T7 → T3 → T4 → T5 → T6 → T8`

### Tổng effort
3×S + 3×M (dev) + 1×S (i18n) + 1×M (QA) ≈ **~4–5 ngày người**. Tổng **M**, không ADR.
