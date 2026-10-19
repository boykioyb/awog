# Chuyển UI sang 100% shadcn-vue

**Trạng thái:** đang thực hiện trên nhánh `feature/shadcn-ui` (2026-10-18). Tailwind đã nâng lên v4, layout chuyển sang block `sidebar-07`, theme Cute chỉ còn là bộ biến màu.

## Vì sao

App từng có năm lớp style chồng nhau: `prototype.css` (5.850 dòng), `app-shell.css`, `theme-cute.css` vá 124 class, cầu nối shadcn, cộng 54.000 dòng `<style scoped>` với 5.480 tên class tự đặt. Spacing không có thang (41 giá trị px, 1.402 chỗ px lẻ), chiều cao control 9 kiểu, 670 `<button>` thô. Kết quả là mỗi màn một kiểu. Đích đến: **mọi phần khung UI dựng bằng component shadcn-vue + utility Tailwind ngữ nghĩa**, không còn CSS tự viết.

## Định nghĩa "xong" cho một file `.vue`

`node scripts/check-shadcn-migration.mjs <file>` (chạy trong `apps/desktop/ui-next`) không còn báo gì, tức là:

1. **Không còn `<style>`**. Ngoại lệ hợp lệ duy nhất: style cho DOM của thư viện bên thứ ba mà class không chạm tới được (xterm, Monaco, VueFlow, KaTeX, Mermaid, HTML markdown render ra), `@keyframes` không có trong `tw-animate-css`, hoặc mask/selector Tailwind không diễn đạt nổi. Khi đó giữ block, **dòng đầu trong block là comment `/* style-ok: <lý do> */`**, và block chỉ chứa đúng phần ngoại lệ.
2. **Không còn control thô** `<button>`, `<input>`, `<select>` khi có component tương đương (bảng dưới). Ngoại lệ (hàng list cả dòng là một vùng bấm, grip kéo resize, input file ẩn…) ghi `<!-- raw-ok: <lý do> -->` ngay dòng trên.
3. **Không còn class skin cũ** từ `prototype.css` / `app-shell.css` (`.btn`, `.chip`, `.tag`, `.ni`, `.li`, `.card`, `.sech`…). Thay bằng component hoặc utility. Class mà **JavaScript đọc** (querySelector, `closest()`, `OVERLAYS` trong `useEmbeddedBrowser.ts`, tour, test) thì giữ làm "hook" và ghi `<!-- hook-ok: <ai đọc> -->` ngay dòng trên. **Trước khi xoá một class, `rg` tên nó trong `.ts`/`.vue`** để chắc không có JS nào phụ thuộc.
4. **Không còn màu thô**: không hex, không `bg-(--bgEl)` / `text-[var(--textDim)]`, không `useTheme()` tô `:style`, không rẽ nhánh `data-theme-family` / `useThemeFamily()`.
5. **Không còn px tự đặt** (`p-[7px]`, `h-[26px]`, `text-[11px]`). Ngoại lệ hình học thật (caret, swatch, đuôi bong bóng) ghi `px-ok:`.

Ngoại lệ có chủ đích của mục 4: `useTheme()` chỉ để đọc/ghi trạng thái (`isDark` cho Monaco/Mermaid, chọn accent, cỡ chữ) ghi `// theme-ok: <lý do>` ngay dòng trên; hex là **dữ liệu** (bảng màu người dùng chọn, màu entity, CSS bên trong iframe sandbox) ghi `// hex-ok: <lý do>`.

## Bảng thay thế

### Control → component (`components/ui/*`, auto-import)

| Trước | Sau |
|---|---|
| nút hành động, `.btn`, `.xxx-btn` | `Button` — variant `default` (CTA chính, mỗi vùng tối đa 1) · `secondary` · `outline` · `ghost` (toolbar, hành động phụ) · `destructive` · `danger` (nguy hiểm nhưng không phải CTA) · `link`; size `default` · `sm` · `xs` · `lg` · `icon` · `iconMd` · `iconSm` |
| nút chỉ có icon | `Button variant="ghost" size="iconMd"` (toolbar) / `iconSm` (dày đặc), luôn có `title` hoặc `Tooltip` + `aria-label` |
| ô nhập | `Input` · nhiều dòng `Textarea` · nhãn `Label` |
| dropdown chọn giá trị | `AppSelect` (API cũ giữ nguyên, ruột là shadcn `Select`) hoặc `Select` + `SelectTrigger` + `SelectContent` + `SelectItem` |
| checkbox / radio / bật tắt | `Checkbox` · `RadioGroup` + `RadioGroupItem` · `Switch` (`v-model:checked`, KHÔNG `v-model` trơn) |
| segmented control, nhóm nút chọn 1 | `ToggleGroup` + `ToggleGroupItem` (hoặc `Tabs` nếu đổi nội dung bên dưới) |
| tab | `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent` |
| chip, tag, badge trạng thái | `Badge` — variant `default` · `secondary` · `outline` · `destructive`; màu trạng thái thêm class (`bg-success/10 text-success border-success/30`…) |
| card, khối nội dung có viền | `Card` + `CardHeader` + `CardTitle` + `CardDescription` + `CardContent` + `CardFooter` |
| modal | `Dialog` + `DialogContent` + `DialogHeader` + `DialogTitle` + `DialogFooter`; xác nhận xoá → `AlertDialog` |
| panel trượt cạnh | `Sheet` |
| popover / menu | `Popover` · `DropdownMenu` · `ContextMenu` (`AppContextMenu` giữ API) · `HoverCard` |
| vùng thu gọn | `Collapsible` / `Accordion` |
| tooltip | `Tooltip` + `TooltipTrigger` + `TooltipContent` (provider có sẵn ở layout) |
| đường kẻ | `Separator` (không `border-b` lẻ để làm divider) |
| thanh tiến độ, skeleton, phím tắt | `Progress` · `Skeleton` · `Kbd` |
| bảng | `Table` + `TableHeader` + `TableRow` + `TableHead` + `TableBody` + `TableCell` |
| thông báo inline | `Alert` + `AlertTitle` + `AlertDescription` |
| vùng cuộn | `ScrollArea` khi cần thanh cuộn đẹp; còn lại `overflow-auto` |

### Màu → utility ngữ nghĩa (khai trong `assets/css/main.css`)

| Ý nghĩa | Utility |
|---|---|
| nền app / panel / card / popover | `bg-background` · `bg-sidebar` · `bg-card` · `bg-popover` |
| nền phụ, vùng nhạt | `bg-muted` |
| hover wash | `hover:bg-accent hover:text-accent-foreground` |
| **đang chọn** (row, tab dọc) | `bg-selected` + `border-selected-border` (hoặc `ring-1 ring-selected-border`) — KHÔNG dùng nền xám |
| chữ chính / phụ / mờ / rất mờ | `text-foreground` · `text-muted-foreground` · `text-dim` · `text-faint` |
| brand / CTA / link nổi | `bg-primary text-primary-foreground` · `text-primary` |
| viền / viền ô nhập / focus | `border-border` (mặc định của `border`) · `border-input` · `ring-ring` |
| lỗi / thành công / cảnh báo / thông tin | `destructive` · `success` · `warning` · `info` (dùng kiểu `bg-success/10 text-success`) |
| phụ màu tím | `lavender` |
| diff git | `text-diff-add` · `text-diff-del` · `text-diff-mod` |

Cần màu không có trong bảng → **dừng, ghi vào báo cáo**, không tự pha.

### Spacing, kích thước, chữ

- **Spacing**: thang Tailwind mặc định. Ưu tiên `0.5 · 1 · 1.5 · 2 · 3 · 4 · 6 · 8` (2/4/6/8/12/16/24/32px). Padding hàng list `px-2 py-1.5`; padding panel `p-3` hoặc `p-4`; khoảng cách trong toolbar `gap-1`; giữa các khối `gap-3` / `gap-4`. Số px lẻ cũ (7, 9, 11, 13) làm tròn về bậc gần nhất.
- **Chiều cao control / hàng**: `h-ctrl` (36 @13px) · `h-ctrl-sm` (32) · `h-ctrl-xs` (28) · `h-ctrl-lg` (40); vuông thì `size-ctrl-sm`… Hàng list dùng `min-h-ctrl-xs` hoặc `min-h-ctrl-sm`.
- **Chữ**: chỉ `text-xs` (11) · `text-sm` (12) · `text-base` (13, chữ thân) · `text-lg` · `text-xl` · `text-2xl` — đã bám `--fs-*` nên theo Appearance. Leading đi kèm sẵn, không thêm `leading-*` trừ văn bản dài (`leading-relaxed`).
- **Đậm**: chỉ `font-normal` · `font-medium` · `font-semibold`. Không 550 / 650 / `font-bold`.
- **Bo góc**: `rounded-sm` · `rounded-md` · `rounded-lg` · `rounded-xl` · `rounded-full`.
- **Đổ bóng**: `shadow-xs` · `shadow-sm` · `shadow-md` · `shadow-lg`.
- **Icon** lucide: `class="size-3.5"` (14) · `size-4` (16, mặc định) · `size-5` (20). Trong `Button` icon tự về `size-4`.
- **Monospace** chỉ cho code/path/SHA/lệnh: `font-mono`.
- **Nhãn nhóm** viết sentence-case, `text-xs font-medium text-muted-foreground`, không `uppercase`.
- **z-index**: giữ đúng band hiện có (page ≤61, detail 80/81, drawer 90–92, modal 100–300). Component shadcn đã chỉnh: popper `z-180`, dialog/sheet `z-170`.

## Bẫy riêng của AWOG

- **Không đặt cùng một nhóm utility ở cả `class` tĩnh lẫn `:class` trên thẻ HTML thường.** Vue chỉ nối chuỗi, không gộp: `class="max-w-30"` + `:class="on && 'max-w-0'"` cho ra cả hai, và utility nào đứng sau trong CSS mới thắng — không phải cái theo điều kiện. Đặt nhóm đó CHỈ trong nhánh điều kiện (`:class="on ? 'max-w-0' : 'max-w-30'"`). Component dùng `cn()` (Button, Badge, Input…) thì an toàn vì tailwind-merge gộp. Component tự đặt class gốc rồi nhận thêm class từ cha cũng dính lỗi này (vd gốc `flex-none` + cha truyền `flex-1`) — đừng hardcode nhóm mà chỗ đặt mới quyết được.

- **Template ref trên component shadcn** trả về instance, không phải element: đọc `?.$el` (`useTemplateRef<{ $el: HTMLElement }>`). `data-*`, `aria-*`, `title`, `@click` vẫn đi xuống phần tử gốc.
- **Vùng kéo cửa sổ**: thanh trên cùng cần `[-webkit-app-region:drag]`, control trong đó `[-webkit-app-region:no-drag]`; overlay phủ lên thanh trên cũng phải `no-drag`.
- **Trình duyệt nhúng vẽ đè DOM**: overlay/modal mới phải có selector trong `OVERLAYS` của `composables/useEmbeddedBrowser.ts`. Đổi class của overlay cũ thì cập nhật selector ở đó (file đó do người điều phối sửa; ghi vào báo cáo).
- **`ContextMenu` mở bằng click** phải `@click.stop`.
- **KeepAlive 2 lớp**: không đổi vòng đời component, không thêm `onUnmounted` cho effect singleton.
- **Không đổi hành vi**: không đổi props/emits/logic/i18n key/route. Chỉ đổi markup + class. Chuỗi hiển thị vẫn qua `t()`.
- **Không thêm dependency**. Không sửa `components/ui/*`, `assets/css/*`, `nuxt.config.ts` — cần gì thì ghi vào báo cáo.
- File > ~250 dòng sau khi chuyển: được tách subcomponent trong cùng thư mục; logic vẫn ở composable như cũ.

## Kiểm tra trước khi báo xong

```bash
cd apps/desktop/ui-next
node scripts/check-shadcn-migration.mjs <các file/thư mục của bạn>   # 0 vi phạm, hoặc chỉ còn ngoại lệ có comment
pnpm exec eslint <các file đã sửa>                                    # 0 error
pnpm exec prettier --write <các file đã sửa>
```

`pnpm typecheck` chạy toàn repo nên người điều phối chạy một lần ở cuối; trong lúc làm, tự soát kỹ import và tên component.

## Theme

- Theme = bộ biến. `shadcn-bridge.css` alias biến chuẩn shadcn (`--background`, `--primary`, `--sidebar`…) về token AWOG; `theme-cute.css` chỉ còn giá trị token. Không còn rule hình khối riêng cho Cute.
- Khi mọi màn đã chuyển, `prototype.css` / `app-shell.css` sẽ bị xoá dần phần không ai dùng, cuối cùng chỉ còn khai token.
