# 0053 — Adopt `monaco-themes` cho theme picker của Preview code viewer

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-25
- **Người quyết định:** tech-lead (theo yêu cầu user)

## Bối cảnh

[PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue) dùng
[MonacoViewer.vue](../../apps/desktop/ui-next/components/common/MonacoViewer.vue) (read-only)
để xem file text/code và markdown-raw. Hiện viewer **tự suy theme từ CSS token** của app
(dark/light + accent) nhưng định nghĩa theme với `rules: []` — tức **không tô màu syntax
token** (keyword/string/comment…), chỉ kế thừa palette mặc định `vs`/`vs-dark`. Kết quả: màu
cú pháp nhạt, không khớp với phần markdown-render (highlight.js dùng `--violet`/`--add`/…),
và người dùng không chọn được color scheme.

User muốn thêm **setting theme dành riêng cho Monaco** trong giao diện preview, với một bộ
theme **phong phú kiểu VSCode** (Dracula, Monokai, GitHub, Solarized, Nord…), và setting ghi
xuống **global settings** của AWOG (`~/.awog/settings.json`, [ADR 0045](0045-settings-json-file-persistence.md)).

Ràng buộc:
- **Repo rule:** không thêm dependency lớn khi chưa có ADR/đồng thuận
  ([.claude/rules/security.md](../../.claude/rules/security.md) — mục "Khi commit thêm dependency").
- **Invariant #5 (no telemetry / no CDN):** theme phải bundle local, không tải runtime từ mạng.
- **Invariant #8 (no eval):** không nạp theme bằng `eval`/dynamic-require trên payload không tin.

## Quyết định

Thêm dependency **`monaco-themes`** (`^0.4.8`, MIT) vào `apps/desktop/ui-next`.

`monaco-themes` là **package data-only**: mỗi theme là một file JSON tuân thủ shape
`monaco.editor.IStandaloneThemeData` (`base`, `inherit`, `rules`, `colors`) — nạp thẳng qua
`monaco.editor.defineTheme(id, data)`. Không có runtime code thực thi, không network.

Cách dùng trong AWOG:
- Curated ~16 theme phổ biến, mỗi theme một **dynamic `import()`** (string literal) trong
  `useMonacoTheme` → mỗi theme là 1 chunk, load **lazy** đúng theme đang chọn, không nhồi vào
  initial bundle.
- **Lưu ý resolution:** package `exports` map của `monaco-themes` **chỉ** expose `.`
  (`parseTmTheme`) — bare deep import `monaco-themes/themes/X.json` bị Node/Vite chặn dù file
  tồn tại trên đĩa. Thêm **Vite alias** `monaco-themes/themes` → thư mục thật
  (`nuxt.config.ts`) để bypass exports map. Type cho JSON import khai ambient ở
  [types/monaco-themes.d.ts](../../apps/desktop/ui-next/types/monaco-themes.d.ts).
- Theme `defineTheme` rồi `setTheme` trong [MonacoViewer.vue](../../apps/desktop/ui-next/components/common/MonacoViewer.vue).
- Giữ nguyên option **"Follow app"** (mặc định) — derive theme từ CSS token như hiện tại; các
  giá trị curated là tuỳ chọn người dùng tự bật.

Setting theme đang chọn persist vào `~/.awog/settings.json` (key `monacoPreviewTheme`) qua
`settings.get`/`settings.set` ([ADR 0045](0045-settings-json-file-persistence.md)); xem
composable `useMonacoTheme`.

Thẩm định an toàn (theo rule): MIT · ~52k downloads/tuần · repo `brijeshb42/monaco-themes`
(uy tín, lâu đời) · không phải gói mới publish / không dấu hiệu typosquat · data-only.

## Phương án đã cân nhắc

- **Tự viết `rules` token cho 1–2 theme từ CSS token** (không thêm dep) — loại: chỉ ra được
  1 palette "follow app", không đáp ứng yêu cầu "bộ theme phong phú kiểu VSCode"; tự maintain
  rules cho nhiều ngôn ngữ là công sức lớn và dễ lệch.
- **Chỉ dùng 4 built-in của Monaco** (`vs`/`vs-dark`/`hc-black`/`hc-light`) — loại: user đã
  chốt muốn curated themes (Dracula/Monokai/…); 4 built-in không đủ.
- **Copy vài file theme JSON vào repo thay vì add dep** — loại: mất nguồn cập nhật/đồng nhất,
  vẫn là cùng dữ liệu nhưng quản lý thủ công; dep MIT data-only nhẹ và rõ ràng hơn (KISS).
- **Shiki** — loại: Shiki là highlighter (TextMate grammar) cho render tĩnh, không phải theme
  cho editor tương tác; thay highlighter là quyết định lớn hơn, ngoài phạm vi.

## Hệ quả

- **Tích cực:**
  - Người dùng chọn được color scheme quen thuộc; màu syntax đầy đủ thay vì palette nhạt.
  - Data-only, bundle local → không vi phạm invariant #5/#8.
  - Lazy-load từng theme JSON → không phình initial bundle.
- **Tiêu cực / Trade-off:**
  - Thêm 1 dependency (chấp nhận theo ADR này).
  - Theme curated **không** tự đổi theo dark/light của app (chúng cố định) — chỉ "Follow app"
    mới phản ứng theme app. Đây là hành vi kỳ vọng (user chọn theme tức là cố định).
- **Việc cần làm tiếp:**
  - Chốt danh sách curated theme (mã trong `useMonacoTheme`).
  - `pnpm audit` sau cài (đã chạy trong PR).

## Tham chiếu

- [ADR 0045](0045-settings-json-file-persistence.md) — persistence `~/.awog/settings.json`
- [ADR 0021](0021-monaco-code-editor.md) — Monaco editor
- Feature: [docs/features/preview-modal-actions.md](../features/preview-modal-actions.md)
- [.claude/rules/security.md](../../.claude/rules/security.md) — quy trình thêm dependency
- Upstream: https://github.com/brijeshb42/monaco-themes (MIT)
