// Chuỗi class Tailwind dùng chung cho cây `components/capture/*` — thay stylesheet global
// `cap-*` cũ trong pages/network-capture.vue. Chỉ những khối lặp ở ≥ 3 component mới vào
// đây; class dùng một chỗ viết thẳng trong template. Giữ literal (không ghép chuỗi) để
// Tailwind quét được.

// Khung một tab chi tiết (Headers, Cookies, Timing…) và một khối trong tab.
export const CAP_TAB = 'flex flex-col pb-3'
export const CAP_SEC = 'p-2'
export const CAP_SEC_TITLE =
  'mb-1.5 flex items-center gap-2 text-sm font-semibold text-muted-foreground'

// Dòng ghi chú / trạng thái rỗng.
export const CAP_NOTE = 'px-2.5 py-1.5 text-dim'
export const CAP_NOTE_WARN = 'px-2.5 py-1.5 text-warning'
export const CAP_NOTE_BAD = 'px-2.5 py-1.5 text-destructive wrap-anywhere'
export const CAP_EMPTY = 'p-6 text-center text-dim'

// Thanh công cụ nhỏ đầu khối (nút chế độ xem, copy…).
export const CAP_BAR = 'flex flex-wrap items-center gap-1.5 px-2 py-1.5'

// Khối code: header/body/JWT là nội dung người dùng copy-paste ⇒ mono.
export const CAP_PRE =
  'm-0 max-h-[60vh] overflow-auto rounded-sm bg-muted px-2 py-1.5 font-mono whitespace-pre-wrap wrap-anywhere'

// Bảng key/value (shadcn `Table`): hàng sát, ô thẳng hàng trên, cột tên co theo nội dung.
// Descendant variant thắng padding/chiều cao mặc định của TableHead/TableCell.
export const CAP_KV =
  'w-full [&_td]:py-0.5 [&_td]:pr-2 [&_td]:pl-0 [&_td]:align-top [&_th]:h-auto [&_th]:w-[1%] [&_th]:py-0.5 [&_th]:pr-2 [&_th]:pl-0 [&_th]:align-top [&_th]:font-normal [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_thead_th]:text-dim'

// Trạng thái BẬT của nút outline (toggle, chip lọc, chế độ xem): accent-tint theo quy tắc
// selection của dự án — không nền xám.
export const CAP_ON = 'border-selected-border bg-selected text-foreground hover:bg-selected'

// Hàng list bấm được cả dòng, đang chọn = accent-tint + thanh accent 2px bên trái.
export const CAP_ROW_SEL = 'bg-selected shadow-[inset_2px_0_0_var(--color-primary)]'
