# Feature — UI Design System (primitive layer kiểu shadcn)

> Quyết định gốc: [ADR 0041](../decisions/0041-in-house-design-system-shadcn-style.md). Tài liệu này là **catalog primitive + migration plan** sống cùng code.

## Mục tiêu

Thay 532 `<button>` viết tay + style trôi dạt bằng một **lớp primitive dùng chung** ở `apps/desktop/ui/components/ui/`, mượn design language của shadcn (radius, focus-visible ring, variant/size) nhưng dựng trên `useTheme`/`useGlass` tokens — **không** thêm dependency.

## Nguyên tắc kỹ thuật

- **Theme qua CSS variable + scoped `<style>`.** Primitive set CSS var (vd `--btn-bg`, `--btn-fg`, `--btn-ring`) từ token rồi để scoped style tiêu thụ. Đây là cách duy nhất biểu diễn `:hover`/`:focus-visible`/`:active`/`:disabled` (inline `:style` không làm được).
- **Variant = computed map**, không `cva`.
- **Auto-import:** `nuxt.config.ts` đặt `pathPrefix: false` → file `components/ui/AppButton.vue` vẫn dùng là `<AppButton>` (không prefix `Ui`).
- **`text-[1em]`** cho nhãn đọc được (scale theo Appearance), **`text-[12px]`** cho badge/hint (xem [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md)).

## Catalog primitive

### `AppButton` — [components/ui/AppButton.vue](../../apps/desktop/ui/components/ui/AppButton.vue)

| Prop | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `variant` | `default \| secondary \| outline \| ghost \| ghostDanger \| danger \| link` | `default` | `default` = accent đặc; `danger` = đỏ đặc (destructive); `ghostDanger` = icon delete (hover mới đỏ) |
| `size` | `xs \| sm \| md \| lg \| icon` | `md` | `icon` = vuông cho nút chỉ-icon; `xs` = micro-control inline (byline) |
| `block` | `boolean` | `false` | full-width |
| `disabled` | `boolean` | `false` | |
| `type` | `button \| submit \| reset` | `button` | |
| `loading` | `boolean` | `false` | hiện spinner, tự `disabled` |
| `active` | `boolean` | `false` | toolbar toggle đang bật → fg sáng accent (chỉ variant không-đặc) |

Slot: `default` (nhãn), `icon` (icon leading). Emit: `click`.

**Variant → token:**

| Variant | bg | fg | hover bg | border | dùng cho |
|---|---|---|---|---|---|
| `default` | `accent` | `accentText` | `accentHover` | `accent` | hành động chính (Save, Confirm) |
| `secondary` | `bgElevated` | `text` | `bgHover` | `border` | hành động phụ trung tính |
| `outline` | trong suốt | `text` | `bgHover` | `borderStrong` | viền, ít nổi |
| `ghost` | trong suốt | `textDim`→`text` | `bgHover` | — | icon-only, toolbar, Cancel (rest mờ khớp convention header) |
| `ghostDanger` | trong suốt | `textDim`→`danger` | `dangerBg` | — | nút icon destructive (Delete) ở header — rest mờ, hover mới đỏ |
| `danger` | `danger` | `#fff` | đậm hơn | `danger` | xoá/destructive xác nhận |
| `link` | — | `accent` | underline | — | link inline |

### `AppCard` — [components/ui/AppCard.vue](../../apps/desktop/ui/components/ui/AppCard.vue)

Bề mặt nâng (qua `useGlass().elevated`, tôn trọng toggle liquid-glass), `rounded-xl`, border hairline. Slot: `default`, `header`, `footer`. Prop `padded` (mặc định true) — tắt khi nội dung tự lo padding (vd list).

## Migration plan (tăng dần)

Thứ tự ưu tiên theo mật độ button + độ hiển thị:

1. **Sessions** (đang làm — proof slice ở [SessionMessageItem.vue](../../apps/desktop/ui/components/session/SessionMessageItem.vue)): edit save/cancel, rewind confirm/cancel.
2. **`*Detail.vue` header** (Agents/Skills/MCP/Rules/Commands…): icon-only → `<AppButton variant="ghost" size="icon">`.
3. **Modal footer** (`BaseModal` `#footer`): Cancel = `ghost`/`secondary`, Confirm = `default`/`danger`.
4. **Composer / editor toolbars.**
5. **Settings.**
6. Gom `AppInput`/`AppSelect`/`AppToggle` về `components/ui/`.

**Mapping pattern cũ → mới:**

| Cũ | Mới |
|---|---|
| `class="awog-copy-btn"` + `:style="{ color: t.textFaint }"` | `<AppButton variant="ghost" size="icon">` |
| `class="p-1.5 rounded transition"` icon header | `<AppButton variant="ghost" size="icon">` |
| `:style="{ background: t.accent, color: t.accentText }"` | `<AppButton>` (default) |
| `:style="{ background: t.dangerBg, color: t.danger }"` confirm | `<AppButton variant="danger">` |
| `:style="{ color: t.textDim }"` text Cancel | `<AppButton variant="ghost">` |

## Definition of done (mỗi đợt migrate)

- [ ] Không còn `<button>` viết tay trong khu vực đã migrate (trừ trường hợp đặc biệt có comment).
- [ ] `pnpm typecheck` + `pnpm lint` = 0 error.
- [ ] Kiểm tra mắt dark + light, focus ring hiện qua bàn phím (Tab).
- [ ] Cập nhật bảng catalog ở trên nếu thêm prop/variant.
