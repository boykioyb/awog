# Design rules — hệ shadcn (proto → production)

> Spec sống cho refactor shadcn-vue. Bộ quy tắc này được **extract từ prototype đang
> chạy** (`pages/proto/sessions` + `components/ui/` + `components/proto/`) — không phải
> lý thuyết. Khi migrate production, mọi surface mới tuân theo bảng dưới; lệch thì phải
> ghi chú lý do.
>
> Supersede phần visual của [ui-design-system.md](./ui-design-system.md) (đã chết) và
> kế thừa tinh thần token-guard của [ADR 0079](../decisions/0079-native-macos-shell-and-design-tokens.md).

## 1. Nguyên tắc

1. **Component chỉ đọc tên var chuẩn** (`--background`, `--primary`, `--border`…).
   Giá trị nằm ở theme layer — một file CSS duy nhất cấp toàn bộ var. Muốn đổi look
   (stock zinc ↔ alias token AWOG) chỉ sửa theme layer, không động component.
2. **Không `dark:` variant.** Dark/light là hai giá trị var trên `body.proto-shadcn`
   vs `body.proto-shadcn.light` — cùng cơ chế `body.light` với app, lật bằng class,
   không bằng class tiện ích trên từng element.
3. **Nguyên mẫu shadcn trước, AWOG sau.** Khi mâu thuẫn, follow cấu trúc của
   ui.shadcn.com (composition, slot, data-state) rồi mới map token; không port ngược
   class-name AWOG vào primitive.
4. **Density theo density sẵn có của vùng.** Transcript/list = dense (xs/12px, size-3
   icon); dialog/form = roomy (sm/14px, size-4 icon). Không một scale chung.

## 2. Typography

| Token | Giá trị | Dùng cho |
|---|---|---|
| font-sans | `'Geist Variable'` (bundle `@fontsource-variable/geist`) | toàn bộ UI |
| font-mono | stack Tailwind mặc định (`ui-monospace…`) | code, path, diff, token counts |
| `text-xs` | 12px / lh 16px | meta, label nhỏ, badge, timestamp |
| `text-sm` | 14px / lh 20px | body, button, input, list item |
| `text-base` | 16px / lh 24px | hiếm — chỉ nội dung đọc dài |
| `text-[10px]`/`[11px]` + `uppercase tracking-wide font-semibold` | — | section label (`PATH`, `INPUT`, `OUTPUT`), group header |
| `tabular-nums` | modifier | mọi số đếm/thời gian/token — chống nhảy cột |
| weight | `font-medium` (500) nhãn/nút · `font-semibold` (600) title | — |

> ⚠️ **Quyết định treo — font-size scaling.** Scale trên là **px cứng** (stock shadcn),
> nên Appearance → Font size (12–18px, rem-based qua `--font-size-base`) **không ảnh
> hưởng** proto page. Hai hướng: (a) giữ stock px, bỏ scaling; (b) alias scale về
> `var(--fs-*)` pairs theo convention AWOG cũ — cần quyết trước khi sweep production.

## 3. Radius

Một `--radius: 0.625rem` (10px), các bậc derive:

| Class | Giá trị | Dùng cho |
|---|---|---|
| `rounded-sm` | 6px | badge, chip, inline element |
| `rounded-md` | 8px | button, input, menu item, tab |
| `rounded-lg` | 10px | card, dialog, dropdown panel |
| `rounded-xl` | 14px | preview card, modal lớn |
| `rounded-full` | — | avatar, pill, status dot |

## 4. Màu (oklch, neutral/zinc)

Bộ var chuẩn shadcn — dark scope `body.proto-shadcn`, light scope `.light` (giá trị
đầy đủ ở [proto-shadcn.css](../../apps/desktop/ui-next/assets/css/proto-shadcn.css)):

| Var | Dark | Light | Vai trò |
|---|---|---|---|
| `--background` | 0.145 | 1 | nền app |
| `--card` | 0.205 | 1 | bề mặt nâng nhẹ |
| `--popover` | 0.269 | 1 | menu/dropdown/modal |
| `--primary` | **0.922 (trắng)** | **0.205 (đen)** | nút chính, badge active — monochrome, không màu |
| `--muted-foreground` | 0.708 | 0.556 | chữ phụ, icon mờ, meta |
| `--border` | white/10% | 0.922 | hairline |
| `--input` | white/15% | 0.922 | viền ô nhập (đậm hơn border) |
| `--ring` | 0.556 | 0.708 | focus-visible |
| `--sidebar`/`--sidebar-*` | 0.205 | 0.985 | sidebar tách tone khỏi background |
| `--success`/`--warning`/`--info`/`--destructive` | xem file | xem file | status — neutral palette không mang |

Quy tắc dùng:
- **`primary` = monochrome** (đen/trắng) — không tô accent màu. Accent màu (emerald
  AWOG) nếu quay lại thì đi qua theme layer, không qua class `bg-accent` lung tung.
- **Selection = `bg-accent` + `text-accent-foreground`** — wash trung tính, không
  `accentDim` emerald.
- **Diff**: `bg-success/10 text-success` (add) / `bg-destructive/10 text-destructive` (del).
- **Fail/destructive** `text-destructive`; running `text-primary` + ring quay.

## 5. Icon (lucide-vue-next)

| Size | px | Dùng cho |
|---|---|---|
| `size-2.5`/`size-3` | 10/12 | dense inline (× trên tab, status dot trong step) |
| `size-3.5` | 14 | **mặc định** — button icon, tab icon, step icon |
| `size-4` | 16 | header icon, empty state nhỏ |
| `size-5`+ | 20+ | empty state lớn, hero |

Không `w-`/`h-` trần; không font-awesome. Stroke mặc định 2.

## 6. Spacing & control heights

- Scale Tailwind stock: `p-1.5`(6) `p-2`(8) `p-2.5`(10) `p-3`(12) `p-4`(16).
- Height conventions: `h-7` control nhỏ (project tab) · `h-8` strip · `h-9` form
  control + tab trigger · `h-11` detail header · `size-6` icon-button micro ·
  `iconSm` icon-button chuẩn.
- Section gap trong panel: `gap-1.5`/`gap-2` dense, `gap-4` roomy.
- List item padding `px-2 py-1.5`; card `p-3`/`p-4`.

## 7. Idioms đã chốt trong proto (giữ khi migrate)

- **Header không wrap** — `overflow-hidden` + title `min-w-0 truncate` + mọi nút
  `shrink-0`; tác vụ phụ vào `⋯` DropdownMenu (không đẩy nút thứ ba lên hàng).
- **Tab strip workspace (§3.5)**: tab inactive chỉ icon (`title` giữ nhãn), label
  chỉ trên tab active; `×` hiện trên active/hover với `visibility` (không nhảy
  layout); `+` menu re-add view; chuột phải → dock picker (left/right/bottom).
- **Step row**: icon tool + tên + target mono (dir ellipsize, filename `shrink-0`;
  command trần truncate nguyên cụm) + result chip (`+N` xanh / `−N` đỏ — token split
  kiểu `SessionStepResult`) + `Ns` elapsed + chevron.
- **Running ring**: icon tĩnh + vòng cung `-inset-[3px] border-t-primary animate-spin`
  quay quanh — không quay glyph.
- **TabsContent phải có `data-[state=inactive]:hidden`** — `[hidden]` attr thua
  `display:flex` (specificity) → panel ẩn vẫn chiếm chỗ.
- **Modal/preview**: một instance dùng chung mount ở page (`useProtoPreview`) — chip
  sâu trong transcript/composer/workspace mở không prop-drill.
- **Focus**: `focus-visible:ring-1 ring-ring` — không outline browser mặc định.

## 8. Cấm / tránh

- `dark:` variant — mọi lớp phải flip qua var.
- Hardcode màu hex trong component — mọi màu đi qua var.
- `text-[13px]`/`pl-5.5` kiểu arbitrary ngoài thang — dùng token scale; `pl-5.5` không
  tồn tại (Tailwind 3) — đã từng là bug thật.
- `@click.stop` trên `DropdownMenuContent`/`ContextMenuContent` — content teleport ra
  body, listener thừa + warning Vue.
- Quay `animate-spin` trên icon glyph — dùng vòng ring quanh icon.
- Map `rgb(from var(--x) …)` cho var đã mang alpha (`--border`, `--input` dark) — mất
  alpha; map `var()` trần.

## 9. Quyết định đã chốt cho production (2026-10)

| Câu hỏi | Quyết định | Cơ chế |
|---|---|---|
| Look | **Zinc surfaces + emerald accent** (hybrid) | [shadcn-bridge.css](../../apps/desktop/ui-next/assets/css/shadcn-bridge.css): tầng 1 alias brand/status về AWOG (primary emerald, ring, destructive…) — flip light/cute miễn phí; tầng 2 zinc oklch cho surfaces/text (gated `body:not([cute])`); tầng 3 alias lại cho theme-cute. Bridge phải đặt trên `body`, KHÔNG `:root` — var() resolve tại element khai báo, trên :root sẽ kẹt dark |
| `--accent` collision | `--accent` giữ emerald AWOG; wash riêng **`--accent-wash`** | tailwind `accent` → `--accent-wash` (=`--bgHover`); proto css cũng define |
| Focus ring | `--ring` → `--accentBorder` (emerald 42%) | giữ identity AWOG |
| Font | `--sans`/`--code` hiện hữu — Geist là opt-in Appearance | tailwind `font-sans`→`var(--sans)`, `font-mono`→`var(--code)` |
| Radius | `--radius` → `--r-btn` (10px = stock) | sm6/md8/lg10/xl14 khớp `--r-*` |
| Mode | `body.light` hiện hữu — **không** đổi sang `.dark` | alias qua var AWOG nên không cần đụng |
| Scope đợt 1 | Sessions + app shell | các màn khác đợt sau |

### Var map production (bridge)

`--background→--bg` · `--foreground→--text` · `--card/--popover→--bgEl` ·
`--primary→--accent` · `--primary-foreground→--accentText` · `--secondary→--bgEl` ·
`--muted→--bgSubtle` · `--muted-foreground→--textMuted` · `--accent-wash→--bgHover` ·
`--destructive→--danger` · `--input→--borderStrong` · `--ring→--accentBorder` ·
`--sidebar→--bgPanel` · `--success→--green` · `--warning→--amber` · `--info→--blue` ·
`--radius→--r-btn`. Ngoài muted-foreground còn `text-dim` (`--textDim`) / `text-faint`
(`--textFaint`) cho 2 nấc mờ hơn.

### Tên component trùng (vẫn treo — xử theo đợt)

`ContextMenu`, `Dialog`, `Select`… legacy cùng tên shadcn — không được add bản
`ui/` trùng tên khi bản legacy còn sống (auto-import sẽ resolve nhầm). Production
tiếp tục dùng `components/common/*` legacy cho tới khi bản đó được migrate/xoá.
