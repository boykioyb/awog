# 0055 — Thay highlight.js bằng Shiki cho syntax highlight markdown render

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-26
- **Người quyết định:** tech-lead (theo yêu cầu user)

## Bối cảnh

Code block trong markdown render của AWOG (transcript Session, PreviewModal, Library, Editor
viewer) đi qua [useMarkdown.ts](../../apps/desktop/ui-next/composables/useMarkdown.ts) →
`marked` + **highlight.js** (`highlight.js/lib/common`). Token màu được khai bằng CSS palette
(`--violet`/`--add`/…).

Vấn đề người dùng gặp với **code block lệnh shell không khai báo ngôn ngữ**:

- Để bù cho fence không tag, `useMarkdown` từng gọi `hljs.highlightAuto()`. Auto-detect **đoán
  nhầm** một list lệnh shell thành **SQL** (relevance 5, thắng bash) → SQL grammar bôi bậy:
  `local`/`check`/`default` thành keyword, `/` `-` thành operator, `7`/`0` thành number. Kết quả
  highlight lỗ chỗ, sai ngữ nghĩa.
- highlight.js dùng grammar **regex, ít ngữ cảnh** → dễ false-positive (vd từ `local` trong path
  `amplify/bff/local/…`). Grammar TextMate (VS Code) phân tích theo ngữ cảnh nên không vướng.

User muốn chất lượng highlight **kiểu VS Code** và đầy đủ. [ADR 0053](0053-monaco-themes-dependency.md)
khi cân nhắc đã ghi rõ: *"Shiki là highlighter (TextMate grammar) cho render tĩnh"* — đúng use
case này (render markdown tĩnh, không phải editor tương tác).

Ràng buộc:
- **Repo rule:** không thêm dependency lớn khi chưa có ADR/đồng thuận
  ([.claude/rules/security.md](../../.claude/rules/security.md)).
- **Invariant #5 (no telemetry / no CDN):** grammar + theme phải bundle local, không tải runtime.
- **Invariant #8 (no eval):** không `eval`/dynamic-require trên payload không tin.

## Quyết định

Gỡ **`highlight.js`**, thêm **`shiki`** (`^4.3.0`, MIT, repo chính thức `shikijs/shiki`) vào
`apps/desktop/ui-next`. `useMarkdown` highlight code qua Shiki:

- **Singleton highlighter** tạo một lần qua `createHighlighter({ themes:['github-dark',
  'github-light'], langs: SHIKI_LANGS })`. Mỗi grammar/theme là **chunk lazy** (Vite tách), chỉ
  nạp các ngôn ngữ curated (TS/JS/JSON/bash/python/vue/yaml/sql/diff/go/rust…).
- **JS regex engine (không WASM):** dùng `createJavaScriptRegexEngine({ forgiving: true })` thay vì
  oniguruma WASM. Lý do: tránh hẳn class lỗi nạp WASM dưới Electron đóng gói (`app://` + sandbox cần
  CSP `wasm-unsafe-eval`); `forgiving` bỏ qua pattern grammar không compile được thay vì throw.
- **Bất đồng bộ → reactive upgrade:** `createHighlighter` async (nạp grammar). Trước khi sẵn sàng,
  mọi fence render **plain escaped**; khi xong, ref `ready` lật → computed của consumer re-render
  (plain → highlighted). `renderMarkdown` đọc `ready` + `useTheme().isDark` nên re-render cả khi đổi
  dark/light. Init lỗi (bất kỳ lý do) → `console.warn` + giữ plain (non-fatal).
- **Fence không tag → mặc định `shell`.** Trong transcript trợ lý code, fence trống gần như luôn là
  lệnh terminal → highlight như bash (grammar TextMate context-aware: tô command/flag/comment đúng,
  KHÔNG bắt `local` trong path thành keyword). Lang lạ / `text`/`txt`/`plaintext` → plain escaped.
  **KHÔNG auto-detect** (đoán sai giữa nhiều ngôn ngữ chính là root cause của bản SQL bậy) — chỉ
  chọn một default hợp lý cho fence trống.
- **Theme:** `github-dark` / `github-light` theo `isDark` của app. Shiki tô màu token bằng inline
  style; **background + chrome** (border/radius/padding) lấy từ style `.mdinline`/`.mdbody` quanh
  block (giữ "code card" theo token app). Output Shiki do ta sinh, code text đã escape → an toàn
  cho `v-html`/`innerHTML` (cùng trust boundary cũ).

Thẩm định an toàn (theo rule): MIT · org `shikijs` (powering VitePress/Astro/nhiều dự án lớn,
download rất cao) · không phải gói mới publish / không dấu hiệu typosquat · grammar/theme **data
bundle local** + JS regex engine (không WASM, không network), không `eval` trên payload workspace.

## Phương án đã cân nhắc

- **Giữ highlight.js, bỏ auto-detect** (fence không tag → plain) — không thêm dep, sửa ngay được
  cái sai SQL; nhưng không nâng chất lượng cho code **có tag** (vẫn regex grammar, vẫn false-positive
  như `local`). User muốn chất lượng VS Code → loại.
- **Monaco `editor.colorize`** — loại: vẫn cần biết trước ngôn ngữ (không auto-detect → untagged vẫn
  plain), kéo chunk Monaco lớn vào **mọi** transcript, async per-block dễ race khi streaming 30fps;
  Monaco mạnh ở editor tương tác, phí cho snippet tĩnh.
- **Tinh chỉnh auto-detect (subset/threshold)** — loại: không tin cậy, bản chất đoán ngôn ngữ trên
  đoạn ngắn luôn dễ sai.

## Hệ quả

- **Tích cực:**
  - Highlight chất lượng VS Code (TextMate, context-aware) cho code **có tag** — hết false-positive
    kiểu `local`/SQL.
  - Bundle local, không CDN/telemetry/eval → giữ invariant #5/#8.
  - Grammar/theme lazy theo ngôn ngữ → không phình initial bundle.
  - Theo dark/light của app qua `github-dark`/`github-light`.
- **Tiêu cực / Trade-off:**
  - Thêm dependency `shiki`; gỡ `highlight.js`. Dùng JS regex engine → không kéo WASM.
  - Init async → lần render đầu (mở session/preview) có thể thấy block plain trong khoảnh khắc rồi
    "nâng cấp" thành highlighted. Block đã finalize chỉ xảy ra một lần khi mở.
  - Fence **không tag** highlight như shell. Block trống chứa nội dung không-phải-shell (vd JSON
    thuần, output) có thể bị tô vài token hơi lệch — chấp nhận được vì đa số fence trống là lệnh,
    và bash grammar không sinh "rác" như auto-detect đoán SQL.
- **Việc cần làm tiếp:**
  - `pnpm audit` sau cài (chạy trong PR).
  - Cân nhắc cho người dùng chọn theme code (như Monaco preview, [ADR 0053](0053-monaco-themes-dependency.md))
    nếu có nhu cầu — hiện cố định theo dark/light.

## Tham chiếu

- [ADR 0053](0053-monaco-themes-dependency.md) — monaco-themes (đã nêu Shiki hợp cho render tĩnh)
- [useMarkdown.ts](../../apps/desktop/ui-next/composables/useMarkdown.ts) — điểm tích hợp
- [.claude/rules/security.md](../../.claude/rules/security.md) — quy trình thêm dependency
- Upstream: https://github.com/shikijs/shiki (MIT)
