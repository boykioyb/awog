# Copy MD — copy raw markdown của đoạn đang bôi đen

Bôi đen (highlight) một đoạn text đã render markdown → nút **Copy MD** trong action bar floating →
clipboard nhận **markdown gốc** của đúng đoạn đó (giữ `**bold**`, `` `code` ``, fence, bảng, `$…$`,
`[text](url)`), thay vì text đã bị làm phẳng mà browser copy mặc định.

⌘C không đổi hành vi: vẫn copy plain text như trước. Copy MD là hành động tường minh, đứng cạnh
**Quote** + **Translate** ([selection-translate.md](./selection-translate.md)).

## Phạm vi

| Surface | Vùng bắt selection | Nguồn markdown |
|---|---|---|
| Session chat | Transcript ([SessionDetail.vue](../../apps/desktop/ui-next/components/session/SessionDetail.vue)) | Text block của message (`msgs[i].blocks[].text`, hoặc `msgs[i].text` với user/system) |
| Preview modal | Markdown **render** (`.mdbody`) trong [PreviewModal.vue](../../apps/desktop/ui-next/components/common/PreviewModal.vue) | `effectiveText` — nội dung file `.md` |

**Ngoài phạm vi:** iframe HTML sandbox (opaque-origin), Monaco (`text/code` — đã là raw sẵn),
selection vắt qua **nhiều message** (action bar chỉ hiện khi selection nằm trong một message —
điều kiện `[data-mi]` của `resolveSelectionQuote`).

## Hành vi

- Nút chỉ hiện khi có selection hợp lệ (cùng gate với Quote/Translate). Click → clipboard, nút đổi
  thành **Đã sao chép** ~1.4s (bar không tự đóng — feedback nằm ngay chỗ vừa click), reset khi có
  selection mới hoặc khi đổi item preview.
- **Không định vị được nguồn** → fallback copy plain text của selection (không bao giờ copy rỗng).
- **Không dịch/đọc thêm gì:** thuần renderer, không IPC, không gọi model.
- Clipboard bị chặn (permission) → giữ bar nguyên trạng để user copy tay.

## Cách map selection → raw markdown

[utils/selection-markdown.ts](../../apps/desktop/ui-next/utils/selection-markdown.ts) —
`rawMarkdownForSelection(sources, selected)`.

Không serialize DOM ngược về markdown: **source vẫn nằm trong state**, nên cắt trực tiếp source cho
ra đúng byte model/tác giả đã viết. Bản serialize lại chỉ ra được markdown "tương đương", và còn phải
xử lý riêng span của Shiki, MathML của KaTeX, SVG của mermaid (đều không mang theo source).

1. **Skeleton** — chuẩn hoá 2 bên về "chỉ chữ + số, lowercase", kèm map index → offset trong source.
   Mọi dấu markdown là punctuation nên rơi khỏi **cả hai** vế → needle plain tìm được trong source
   có markup, và selection vắt qua nhiều block vẫn liền mạch (`\n\n## ` vô hình với skeleton).
2. **Pass 1 — contiguous** `indexOf`. Đủ cho phần lớn case (prose, heading, list, code block).
3. **Pass 2 — gap-tolerant.** Phần source **không được render** (URL trong `[text](url)`, `src` của
   ảnh) vẫn nằm trong skeleton của source → selection vắt qua link không còn liền mạch. Pass này
   khớp theo subsequence, anchor 4 ký tự đầu, cho phép nhảy qua ≤ 160 ký tự mỗi gap (giới hạn tổng
   theo độ dài needle), thử **mọi** vị trí anchor nên đoán sai lần đầu không mất match.
4. **Nới biên về ranh giới markdown** — để đoạn copy vẫn là markdown hợp lệ:
   - Gắn lại dấu câu mà selection kết thúc bằng (`.`, `?`, `)`) — skeleton đã bỏ nó.
   - Hút cụm delimiter inline khi **đối xứng hai đầu** (`**x**`, `` `x` ``, `$x$`); yêu cầu đối xứng
     là thứ giữ cho `snake_case` không bị dính `_` lẻ, và `$5 và $10` không bị hiểu là math.
   - Selection bắt đầu ở đầu **nội dung** của một dòng → hút marker block của dòng đó (`- `, `1. `,
     `## `, `> `, `- [x] `), giữ nguyên indent (item lồng dán ra vẫn lồng).
5. **Nhiều nguồn ứng viên** (assistant turn có nhiều text run) → thử lần lượt, lấy nguồn khớp đầu tiên.

Trade-off đã chấp nhận (KISS): nếu đúng đoạn plain text đó xuất hiện **nhiều lần** trong cùng source,
lấy occurrence đầu — nội dung copy vẫn là chính đoạn đó. Selection nằm **trong** một code fence trả
về phần code (không kèm ``` fence) — fence đầy đủ đã có nút Copy riêng trên code block.

## Security

Không sink mới: chỉ đọc state đã có trong renderer + ghi `navigator.clipboard`. Không path/exec/fetch,
không IPC, không `v-html` (chuỗi trả về là text đi vào clipboard).
