# 0020 — Syntax-highlight code block trong chat bằng highlight.js

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-02
- **Người quyết định:** AWOG team

## Bối cảnh

Reply của assistant trong Sessions render markdown qua `marked` → chuỗi HTML → `MarkdownStreamBody` đổ vào `v-html` (xem [sessions.md](../features/sessions.md)). Code block (fence ```` ``` ````) trước đây ra `<pre><code>` đơn sắc, không tô màu cú pháp → khó đọc, nhất là khối dài.

Ràng buộc:

- **Pipeline là string-HTML + `v-html`**, không phải render theo Vue component. Mọi giải pháp phải sinh ra HTML (hoặc xử lý hậu-render trên DOM), không mount component con cho từng block.
- **Streaming**: `MarkdownStreamBody` re-render HTML theo throttle khi text chảy về → highlighter chạy lặp lại, cần **đồng bộ + rẻ**.
- **Theme-aware**: light/dark vừa được wire (mermaid theo theme, [ADR-less change]); màu code phải đổi theo appearance, lý tưởng là **không re-render** khi đổi theme.
- Repo **chưa có** thư viện highlight nào (kể cả Monaco không nằm trong `dependencies`). Thêm dep cần cân nhắc ([CLAUDE.md](../../CLAUDE.md) — không thêm dep lớn tùy tiện).

## Quyết định

Dùng **`highlight.js`** (`highlight.js/lib/common`, ~37 ngôn ngữ phổ biến) highlight ngay trong **renderer `code()` của marked** ([utils/markdown.ts](../../apps/desktop/ui/utils/markdown.ts)):

- Có `lang` và `hljs.getLanguage(lang)` → `hljs.highlight(text, { language, ignoreIllegals: true })`; ngược lại → `hljs.highlightAuto(text)`.
- Trả về `<pre><code class="hljs language-<lang>">…</code></pre>`. hljs **tự escape** source và chỉ bọc token trong `<span class="hljs-*">` → không tạo bề mặt XSS (đúng invariant L1); `lang` được sanitize trước khi nhét vào `class`.
- Màu token định nghĩa trong [main.css](../../apps/desktop/ui/assets/css/main.css) theo bảng kiểu GitHub, **theme-aware bằng CSS `light-dark()`**. Vì `useTheme` đã set `color-scheme` theo theme trên `documentElement`, `light-dark()` tự chọn màu → **đổi dark↔light không cần re-render** (khác mermaid — SVG màu "đóng băng" nên phải vẽ lại).

## Phương án đã cân nhắc

- **CodeMirror** (gợi ý ban đầu) — là **editor**, không phải static highlighter. Hiển thị read-only phải mount 1 `EditorView` cho **mỗi** code block (qua MutationObserver) hoặc đổi cả pipeline chat sang render component. Nặng RAM, phức tạp; chỉ đáng nếu cần code block **edit được** (không phải nhu cầu hiện tại). → từ chối.
- **Shiki** — chất lượng như VS Code, dual light/dark built-in. Nhưng **async + nặng** (WASM oniguruma + grammars), không dùng được trong renderer `marked` đồng bộ → phải hậu-render quét DOM như mermaid, và bundle to. → từ chối cho MVP (có thể nâng cấp sau nếu cần màu cao cấp hơn).
- **highlight.js** — đồng bộ, nhẹ, nhúng thẳng renderer, theme qua CSS. → **chọn**.

## Hệ quả

- **Tích cực:**
  - Đổi tối thiểu (1 file `markdown.ts` + CSS), hợp kiến trúc `v-html` + streaming.
  - Theme-aware "miễn phí" qua `light-dark()`, không tốn re-render khi đổi theme.
  - Áp dụng cho **mọi** bề mặt `.awog-md` (chat, subagent drawer, MarkdownBodyView) vì dùng chung `renderMarkdown`.
  - `pnpm audit`: 0 vulnerability; `highlight.js` là package phổ biến, repo chính thức.
- **Tiêu cực / Trade-off:**
  - `lib/common` chỉ gồm ~37 ngôn ngữ; ngôn ngữ hiếm (vue, dockerfile, nginx…) sẽ về plain. Cần nhiều hơn → đổi sang full `highlight.js` (nặng hơn).
  - `light-dark()` cần webview hiện đại (Tauri WKWebView macOS gần đây OK; fallback: token về màu chữ base — vẫn đọc được).
  - Highlight lặp lại mỗi lần `MarkdownStreamBody` re-render khi streaming (chấp nhận được — block nhỏ, hljs nhanh; throttle 120ms).
- **Việc cần làm tiếp:** cân nhắc full language pack hoặc Shiki nếu người dùng cần ngôn ngữ ngoài common; theo dõi bundle size.

## Tham chiếu

- Feature: [docs/features/sessions.md → Markdown rendering](../features/sessions.md)
- [utils/markdown.ts](../../apps/desktop/ui/utils/markdown.ts), [assets/css/main.css](../../apps/desktop/ui/assets/css/main.css)
- highlight.js: https://highlightjs.org
