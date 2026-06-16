# 0041 — Design system in-house kiểu shadcn trên nền `useTheme` tokens

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-16
- **Người quyết định:** tech-lead (user chốt hướng)

## Bối cảnh

Tổng thể style UI bị đánh giá là "chưa ổn". Quét codebase `apps/desktop/ui/` cho thấy nguyên nhân gốc **không** nằm ở theme tokens mà ở việc **thiếu lớp primitive dùng chung**:

- **219** component `.vue`, trong đó **207** gọi `useTheme()` và **209** dùng inline `:style`.
- **532** thẻ `<button>` viết tay rải rác — mỗi nơi tự đặt padding/radius/hover/focus → trôi dạt, không nhất quán.
- Chỉ có **3** primitive: [AppInput.vue](../../apps/desktop/ui/components/AppInput.vue), [AppSelect.vue](../../apps/desktop/ui/components/AppSelect.vue), [AppToggle.vue](../../apps/desktop/ui/components/AppToggle.vue). Không có `Button`, `Card`, `Dialog` chuẩn.
- Inline `:style` **không biểu diễn được** `:hover` / `:focus-visible` → đa số nút thiếu focus ring (a11y) và hover dựa trên class hardcode (vd `.awog-copy-btn` dùng `rgba(255,255,255,0.06)` cứng, không theo theme).

Ràng buộc quan trọng:

1. App là **Vue 3 / Nuxt 4**. [ui.shadcn.com](https://ui.shadcn.com/) là **React-only** — không dùng trực tiếp được. Bản Vue là `shadcn-vue` (dựng trên `reka-ui`).
2. [CLAUDE.md](../../CLAUDE.md) + [principles.md](../../.claude/rules/principles.md): **không thêm UI lib lớn khi chưa có ADR**; đã chọn Tailwind + lucide thay component library.
3. Hệ theme hiện có ([themes.ts](../../apps/desktop/ui/utils/themes.ts) + [useTheme.ts](../../apps/desktop/ui/composables/useTheme.ts) + [useGlass.ts](../../apps/desktop/ui/composables/useGlass.ts)) **giàu hơn** theming mặc định của shadcn: ~60 token semantic, dark/light, surface-depth, accent override, liquid-glass. Đây là tài sản phải **giữ**, không vứt.

## Quyết định

Xây **design system in-house theo phong cách shadcn**, đặt ở `apps/desktop/ui/components/ui/`, dựng **trên** `useTheme`/`useGlass` tokens. **Không** thêm `reka-ui` / `class-variance-authority` / `tailwind-merge`.

Nguyên tắc của lớp primitive:

1. **Mượn design language của shadcn, không mượn code:** radius nhất quán, `:focus-visible` ring rõ ràng, spacing/height scale theo size (`sm`/`md`/`lg`/`icon`), variant API (`default`/`secondary`/`outline`/`ghost`/`danger`/`link`).
2. **Theme-driven qua CSS variables:** mỗi primitive set CSS var (vd `--btn-bg`, `--btn-fg`, `--btn-ring`) từ `useTheme` rồi để **scoped `<style>`** tiêu thụ — nhờ đó biểu diễn được `:hover`/`:active`/`:focus-visible`/`:disabled` mà inline `:style` không làm được. Đây là điểm nâng cấp cốt lõi so với pattern cũ.
3. **Variant = computed map**, không cần `cva`: AWOG style đi qua token (inline/var) chứ qua class-string, nên `cva` (vốn ghép class-string) ít giá trị; một `computed` map `(variant,size) → vars/class` là đủ và đúng codebase (giống cách [AppInput.vue](../../apps/desktop/ui/components/AppInput.vue) đã làm).
4. **Migrate tăng dần (incremental):** primitive mới sống cạnh code cũ; thay thế theo từng khu vực (Sessions → Settings → Git → …). App luôn build/chạy được trong suốt quá trình. Không rewrite một đợt.
5. **App\* hiện có gom dần về `components/ui/`** (AppInput/AppSelect/AppToggle) khi đi qua — Boy Scout, không churn ép.

Bộ primitive khởi đầu: `AppButton`, `AppCard` (đợt này). Kế tiếp theo nhu cầu: `AppCard*` parts, `AppTabs`, `AppTooltip`, `AppBadge`, `AppDialog` (gói lại trên [BaseModal.vue](../../apps/desktop/ui/components/BaseModal.vue)).

## Phương án đã cân nhắc

- **Option A — shadcn-vue thật (reka-ui) + bridge token.** Thêm `reka-ui`/`cva`/`tailwind-merge`, bắc cầu `useTheme` → CSS var chuẩn shadcn, migrate 207 component sang class-based. *Từ chối (cho giai đoạn này):* thêm dep lớn (cần cân nhắc kỹ chuỗi supply), phải hoà giải hệ theme giàu hiện có với theming đơn-accent của shadcn, churn lớn. Có thể tái xét sau nếu cần a11y primitives phức tạp (combobox, menu ARIA đầy đủ).
- **Option B — migrate shadcn-vue toàn phần một đợt.** *Từ chối:* đụng 207 component cùng lúc, rủi ro regression diện rộng (mất surface-depth/accent/glass), nhiều tuần.
- **Option C — polish có mục tiêu, không đổi kiến trúc.** *Từ chối:* không giải nguyên nhân gốc (thiếu primitive) → style vẫn tiếp tục trôi dạt khi thêm tính năng mới.
- **Option D (chọn) — design system in-house kiểu shadcn trên token sẵn có.** Giải đúng gốc, giữ theme system, không thêm dep, rủi ro thấp, migrate dần.

## Hệ quả

- **Tích cực:**
  - Một nguồn duy nhất cho button/card → bán kính, padding, hover, focus ring **nhất quán** toàn app.
  - `:focus-visible` ring chuẩn → a11y tốt hơn ngay.
  - Hover/focus theo **theme token** thay vì rgba hardcode.
  - Không thêm dependency → không mở rộng surface bảo mật/supply-chain ([security.md](../../.claude/rules/security.md)).
  - Giữ trọn hệ theme 20+ biến thể + glass.
- **Tiêu cực / Trade-off:**
  - Hai pattern (primitive mới ↔ inline-style cũ) **cùng tồn tại** trong thời gian migrate → cần kỷ luật để hội tụ.
  - Tự bảo trì primitive (không có cộng đồng shadcn-vue lo a11y giúp). Chấp nhận vì phạm vi primitive nhỏ.
- **Việc cần làm tiếp:**
  - Migrate dần 532 `<button>` → `AppButton`, ưu tiên `*Detail.vue` header + composer + modal footer.
  - Bổ sung `AppBadge`, `AppTabs`, `AppTooltip`, `AppDialog` khi gặp nhu cầu lặp (Rule of Three).
  - Gom `AppInput`/`AppSelect`/`AppToggle` về `components/ui/`.
  - Cập nhật [docs/features/ui-design-system.md](../features/ui-design-system.md) khi thêm primitive.

## Tham chiếu

- Feature: [docs/features/ui-design-system.md](../features/ui-design-system.md)
- Liên quan: [docs/features/theme-system.md](../features/theme-system.md), [docs/features/ui-consolidation-refactor.tasks.md](../features/ui-consolidation-refactor.tasks.md)
- Coding: [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md) (UI patterns), [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md)
- Ngoài: [shadcn/ui](https://ui.shadcn.com/) (React, tham chiếu design language), [shadcn-vue](https://www.shadcn-vue.com/) (Vue port, đã cân nhắc ở Option A)
