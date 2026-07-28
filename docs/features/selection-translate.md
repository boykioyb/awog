# Selection-to-Translate — dịch khi bôi đen text

Bôi đen (highlight) một đoạn text → hiện nút **Translate** floating cạnh vùng chọn → click →
popover hiển thị bản dịch. Không phá message gốc (non-destructive). Tái dùng hạ tầng translate
one-shot đã có ([ADR 0049](../decisions/0049-github-issues-and-prs-via-gh-cli.md), `gh.translate`).

## Phạm vi

| Surface | Vùng bắt selection | Ghi chú |
|---|---|---|
| Session chat | Transcript ([SessionDetail.vue](../../apps/desktop/ui-next/components/session/SessionDetail.vue)) | Nút Translate đứng cạnh nút Quote trong action bar floating |
| Preview modal | Markdown **render** (`.mdbody`) trong [PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue) | Chỉ vùng prose đã render |

**Ngoài phạm vi (MVP):** iframe HTML sandbox (opaque-origin — `getSelection()` của parent không
bắt được) và Monaco (`text/code` — có selection model riêng). Có thể bổ sung sau qua selection
API của Monaco.

## Hành vi

- **Ngôn ngữ đích:** ưu tiên cố định (mặc định `vi`) + toggle `vi / en / ja` ngay trong popover.
  Lựa chọn nhớ qua `localStorage` (`awog.translate.lang`) — pref UX renderer thuần, không đi IPC.
- **Model/account:** cấu hình ở **Settings → Defaults → Dịch thuật** (slice `translate` trong
  settings store, persist localStorage). Mặc định `followAppDefault: true` (dùng model của session:
  project → app default). Tắt → ghim `provider / account / model` riêng (mặc định gợi ý model rẻ
  `claude-haiku-4-5`). Xem [useTranslateSettings.ts](../../apps/desktop/ui-next/composables/useTranslateSettings.ts).
- **Hiển thị:** popover floating neo theo rect vùng chọn (dưới selection, lật lên trên khi selection
  nằm thấp), có loading spinner → bản dịch (plain text, `white-space: pre-wrap`) → nút Copy.
  Lỗi hiển thị nút Retry.
- **Cache:** theo `(lang, sourceText)` — toggle ngôn ngữ đã dịch rồi không gọi lại model.
- **Đóng:** click ra ngoài (backdrop), ESC.
- Text đã đúng ngôn ngữ đích → model trả nguyên văn (xử lý ở system prompt).

## Kiến trúc

Singleton pattern (giống `usePreview` + `PreviewModal`):

- **`useSelectionTranslate()`** ([composables/useSelectionTranslate.ts](../../apps/desktop/ui-next/composables/useSelectionTranslate.ts))
  — state module-level (active/lang/loading/result/error/copied + cache), `open(text, rect, projectId?)`,
  `setLang`, `retry`, `close`, `copyResult`. `resolveLlm`: setting `translate` được ghim thắng →
  không thì `projectId → project.llmDefaults → app defaults`.
  Export `TranslateLang` + `LANG_LABEL` (dùng chung với [useProjectGh.ts](../../apps/desktop/ui-next/composables/useProjectGh.ts)).
- **`SelectionTranslatePopover.vue`** ([components/common/](../../apps/desktop/ui-next/components/common/SelectionTranslatePopover.vue))
  — render popover kết quả; mount **một lần** ở [layouts/default.vue](../../apps/desktop/ui-next/layouts/default.vue).
- **Nút trigger** là markup host-local (Session gộp cạnh Quote; Preview là 1 nút riêng) — mỗi host
  tự bắt selection rồi gọi `open(...)`.

## Backend

- **`text.translate`** ([sidecar methods](../../apps/desktop/sidecar/src/methods/text.translate.ts)) —
  RPC trung lập tên cho app-wide. Cùng contract với `gh.translate`.
- **`runtime/translate.ts`** — lõi dùng chung (`translateText(args, { preferCheap })`): prompt
  source-agnostic (dịch TỪ mọi ngôn ngữ SANG target, không coi từ ngoại ngữ là identifier, cấm
  refuse/return-nguyên-văn khi khác ngôn ngữ), giữ nguyên markdown/code.
  - `gh.translate` → `preferCheap: true` (dịch issue/PR hàng loạt → ưu tiên `claude-haiku-4-5`, fallback model yêu cầu).
  - `text.translate` → `preferCheap: false` (**dùng thẳng model đã resolve** để setting model có hiệu lực và chất lượng tốt; KHÔNG ép haiku).

## Security

Text bôi đen là **L1** → gửi tới model API (host allowlist) như `gh.translate`. Không sink mới
(không path/exec/fetch tùy ý), không rò API key (vẫn ở sidecar). Kết quả render **plain text**
(không `v-html`).
