# 0044 — Áp dụng shadcn-vue thật (reka-ui) + bridge theme AWOG

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-16
- **Người quyết định:** tech-lead (user chốt: "Cài shadcn-vue THẬT")
- **Quan hệ:** Tiến hoá từ [ADR 0041](0041-in-house-design-system-shadcn-style.md). 0041 chọn Option D (in-house *kiểu* shadcn); ADR này chuyển sang **Option A** (shadcn-vue chính chủ). Lớp primitive in-house (AppButton/AppCard) trở thành facade mỏng bọc component shadcn-vue.

## Bối cảnh

ADR 0041 dựng AppButton/AppCard *mô phỏng* shadcn (variant API + focus ring) trên `useTheme` tokens, KHÔNG dùng thư viện. User xác nhận muốn **shadcn-vue thật**: component chính chủ (Button/Card/Dialog/Select/Tabs/Tooltip… dựng trên `reka-ui`), có đúng "look" + a11y đầy đủ — không chỉ giống API.

Ràng buộc: phải **giữ hệ theme AWOG** (emerald + 20+ preset accent/background + surface-depth + liquid-glass + dark/light reactive). Không được thay bằng theming neutral tĩnh của shadcn.

## Quyết định

1. **Thêm shadcn-vue stack:** `reka-ui` (headless primitives), `class-variance-authority` (cva), `clsx`, `tailwind-merge` (→ `cn()`), `tailwindcss-animate`. Component shadcn-vue được **copy vào repo** (`components/ui/<name>/`) — "own the component", tự sửa được.

2. **Bridge theme thay vì theming tĩnh:** KHÔNG dùng block `:root`/`.dark` HSL cứng của shadcn. Thay vào đó:
   - `tailwind.config.ts` map color token shadcn (`background`/`foreground`/`primary`/`secondary`/`muted`/`accent`/`destructive`/`border`/`input`/`ring`/`card`/`popover`) → `rgb(var(--awog-<x>) / <alpha-value>)` (định dạng RGB channels để hỗ trợ opacity modifier như `bg-primary/90` mà shadcn dùng).
   - [useTheme.ts](../../apps/desktop/ui/composables/useTheme.ts) (client effect) convert mỗi token `t` (hex) → "r g b" channels và set `--awog-<x>`. → Component shadcn phản ứng **sống** theo theme AWOG (emerald, preset, surface-depth, dark/light). Glass surfaces vẫn do `useGlass` lo.

3. **AppButton/AppCard thành facade:** [components/ui/AppButton.vue](../../apps/desktop/ui/components/ui/AppButton.vue) bọc/re-export Button shadcn-vue, map variant/size AWOG (`danger→destructive`, `md→default`, thêm `ghostDanger`/`xs`/`active`/`loading`/`block` vào cva khi cần). → ~114 usage `<AppButton>` đã migrate ở 0041 **không phải sửa lại**.

## Phương án đã cân nhắc

- **Giữ in-house (ADR 0041 Option D)** — *từ chối:* user muốn shadcn thật (look + a11y primitives), không chỉ API.
- **shadcn-vue + theming HSL tĩnh chuẩn** — *từ chối:* mất hệ theme AWOG (emerald/preset/glass/surface-depth). Bridge giữ được cả hai.
- **Migrate 1-1 mọi component sang shadcn ngay** — *từ chối:* rủi ro cao; làm tăng dần (foundation + Button/Card trước, mở rộng sau).

## Hệ quả

- **Tích cực:** component chính chủ shadcn-vue (a11y đầy đủ qua reka-ui), "look" shadcn thật, vẫn giữ theme AWOG sống qua bridge, 114 usage cũ giữ nguyên (facade).
- **Tiêu cực / Trade-off:** +5 dependency (đã kiểm: reka-ui = kế thừa radix-vue, cva/clsx/tailwind-merge/tailwindcss-animate đều phổ biến, an toàn). Hai cơ chế surface song song (glass `useGlass` ↔ shadcn token) — cần kỷ luật. Bridge hex→rgb là điểm tích hợp phải bảo trì.
- **Việc cần làm tiếp:**
  - Thêm dần primitive shadcn-vue: Dialog (thay BaseModal), Select (thay AppSelect), Tabs, Tooltip, DropdownMenu (thay ContextMenu), Badge, Input.
  - infosec review khi đụng dep mới.
  - Cập nhật [docs/features/ui-design-system.md](../features/ui-design-system.md).

## Tham chiếu

- [ADR 0041](0041-in-house-design-system-shadcn-style.md), [docs/features/ui-design-system.md](../features/ui-design-system.md)
- [shadcn-vue](https://www.shadcn-vue.com/), [reka-ui](https://reka-ui.com/)
