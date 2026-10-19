// Class Tailwind dùng chung cho các hàng/nút lặp lại trong Git Manager (danh sách
// thay đổi, zone Unstaged/Staged, file của commit, nhật ký lệnh). Gom một chỗ để
// mọi hàng file trong Git trông giống hệt nhau — thay cho skin `.gfile`/`.gsti`/
// `.gstage`/`.gsecbtn` cũ của prototype.css / app-shell.css.

// Hàng file cao cố định 28px: danh sách thay đổi được quét chứ không đọc, nên hàng
// thư mục và hàng file cùng một nhịp. `group/file` để nút stage hiện khi hover hàng.
export const FILE_ROW =
  'group/file flex h-7 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-sm hover:bg-accent'
// Hàng đang mở diff (hoặc đang nằm trong multi-select): nền wash + thanh primary 2px.
// Multi-select chỉ là highlight thuần — KHÔNG phải trạng thái stage.
export const FILE_ROW_ON = 'bg-accent shadow-[inset_2px_0_0_var(--color-primary)]'

// Chữ trạng thái porcelain (M/A/D/R/…) — hộp cố định + số tabular để tên file
// luôn bắt đầu cùng một x. Màu đi theo StatusVisual.cls.
export const STATUS_LETTER =
  'grid w-3.5 flex-none place-items-center text-xs font-semibold tabular-nums'

export const FILE_NAME = 'min-w-0 flex-1 truncate'
// Phần thư mục của path (code → mono) + phần tên file.
export const FILE_DIR = 'font-mono text-xs text-muted-foreground'
export const FILE_BASE = 'font-medium'

// Nút stage/unstage/discard cuối hàng: luôn chiếm chỗ (chỉ đổi opacity) để hiện ra
// không làm hàng nhảy; hiện khi hover hàng hoặc khi hàng đang chọn.
export const ROW_ACT =
  'size-5 rounded-sm text-muted-foreground opacity-0 pointer-events-none transition-opacity group-hover/file:pointer-events-auto group-hover/file:opacity-100 hover:border-ring hover:text-primary motion-reduce:transition-none'
export const ROW_ACT_SHOWN = 'pointer-events-auto opacity-100'
export const ROW_ACT_DISCARD = 'hover:border-destructive hover:text-destructive'

// Header zone (Unstaged / Staged / Conflicted): chevron + nhãn + số đếm.
export const ZONE_HEAD = 'mt-1.5 flex h-7.5 cursor-pointer items-center gap-1.5 px-2.5 select-none'
export const ZONE_LABEL = 'font-sans text-xs font-semibold text-muted-foreground'
export const ZONE_COUNT = 'text-xs text-faint tabular-nums'
export const ZONE_EMPTY = 'pt-0.5 pr-3 pb-2 pl-7 text-xs text-faint'

// Chevron thu gọn: xoay -90° khi đóng.
export const CHEV = 'size-3 flex-none text-faint transition-transform'

// Nút nhỏ cấp zone/header (Stage all, Copy, Clear…) — viền trung tính, chữ nhỏ.
export const SEC_BTN =
  'h-auto gap-1 rounded-sm px-2 py-0.5 font-sans font-normal text-muted-foreground hover:border-input [&_svg]:size-3'
// Biến thể "Stage": nghiêng accent khi hover vì là động từ chính của zone.
export const SEC_BTN_STAGE = 'hover:border-ring hover:bg-primary/15 hover:text-primary'
