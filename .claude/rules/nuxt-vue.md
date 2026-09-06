# Nuxt / Vue / Pinia / Tailwind

## Đặt tên

| Đối tượng | Convention | Ví dụ |
|---|---|---|
| Component | `PascalCase.vue` | `TaskListItem.vue` |
| Page/layout | `kebab-case.vue` | `pages/tasks/index.vue` |
| Composable | `useXxx.ts` | `useTheme.ts` |
| Pinia store file | `xxx.ts`, export `useXxxStore` | `stores/workspace.ts` |
| Custom event | `kebab-case` | `@select-task` |

## Component

- **`<script setup lang="ts">` luôn luôn.** Cấm Options API.
- `defineProps` + `withDefaults` + **type-only**.
- `defineEmits` **type-only**.
- Thứ tự block: `<template>` → `<script setup>` → `<style>` (hiếm dùng).
- Tránh `v-html`. Cần render HTML → đi qua component dedicated.
- `computed` cho derived; `watch` chỉ khi cần side effect.
- `ref` cho primitive / thay nguyên khối; `reactive` cho object mutate nhiều field.
- **Props readonly** — đừng mutate `props.x`, emit event.
- Component/SFC dài > ~250 dòng → tách subcomponent **và** đẩy logic vào composable (xem [Composable](#composable)).

## Composable

- **Tên + vị trí:** `useXxx.ts` trong `composables/` → auto-import (không `import` trong page/component). Không gọi composable ở module top-level.
- **Page-controller pattern:** page/SFC vượt ~250 dòng → đẩy **toàn bộ** state + computed + handler vào một composable `useXxxManager()` (đặt trong [composables/](../../apps/desktop/ui-next/composables/)). Page chỉ còn `<template>` + `const { ... } = useXxxManager()`. Template ref (`ref="sidebarRef"`), `onMounted`, `watch` đặt được trong composable (đăng ký trên instance gọi nó).
- **Composable dùng chung cho UI lặp:** pattern lặp giữa nhiều trang → 1 composable (vd [`useToasts`](../../apps/desktop/ui-next/composables/useToasts.ts) gom toast của agents + skills). Rule of Three: 2 copy = tín hiệu, 3 = bắt buộc tách.
- **Thin template:** composable trả về đúng thứ template bind. Vue compiler tự transform write tới destructured ref trong template thành `.value =` (`editing = true`, `pendingDelete = null`) → **không cần** setter riêng.
- **SoC:** composable orchestrate state/IPC; không `import fs`/SDK (đi qua sidecar). Markup lặp tách thành component con (vd trong [components/agent/](../../apps/desktop/ui-next/components/agent/)), không nhồi vào composable.

## Pinia store

- **Composition style:** `defineStore('name', () => { ... })`.
- State (ref) / getters (computed) / actions (function) tách rõ trong return.
- Một store = một bounded context (`workspace` ≠ `settings`).
- Không gọi store ở module top-level.
- Action async đặt tên rõ: `fetchTasks`, `runTask`.

## Tailwind + theme

- **Class Tailwind** cho layout/spacing/typography.
- **Inline `:style`** cho **màu theme** từ `useTheme()`:

```vue
<div
  class="px-4 py-2 rounded-md"
  :style="{ background: t.bg, color: t.text, border: `1px solid ${t.border}` }"
/>
```

- **Không hardcode hex** trong class. Theme color **phải** đi qua `useTheme()`.
- `assets/css/main.css` chỉ chứa reset/scrollbar/base.

## UI patterns

- **Detail header buttons:** mọi action button trong `*Detail.vue` header row (Edit/Delete/Duplicate/Test/Restart…) dùng cùng icon-only style. Class `p-1.5 rounded transition`, icon size `13`, color mặc định `t.textDim`, hover bgHover+text (hoặc dangerBg+danger cho destructive). `title` attribute bắt buộc thay text label. **Không** mix text+border (`px-3 py-1.5`) với icon-only trong cùng row.
- **Editor textareas:** `<textarea>` trong `*Editor.vue` cho content dài (description, body, systemPrompt, command, args) dùng `resize-y min-h-[<rem>]` — không `resize-none`. Chat composer / single-purpose modal input giữ `resize-none` (ghi comment lý do).
- **Font-size + line-height + radius: dùng CSS token, KHÔNG hardcode** ([ADR 0079](../../docs/decisions/0079-native-macos-shell-and-design-tokens.md)). `pnpm lint` chạy `scripts/check-design-tokens.mjs` và **fail** nếu vi phạm.
  - **Type scale — 6 bậc:** `var(--fs-xs)` 11 · `var(--fs-sm)` 12 · `var(--fs-md)` 13 (body) · `var(--fs-lg)` 15 · `var(--fs-xl)` 17 · `var(--fs-2xl)` 22 (@base 13). Khai bằng `calc(var(--font-size-base) ± Npx)` nên ra **px nguyên ở mọi base** 12→18 (Appearance). **Cấm `font-size: <n>rem`** — rem lẻ rơi vào nửa pixel và macOS render nhoè.
  - **Leading — 7 bậc:** `var(--lh-xs)` 16 · `var(--lh-sm)` 18 · `var(--lh-md)` 20 · `var(--lh-lg)` 22 · `var(--lh-xl)` 24 · `var(--lh-2xl)` 28 · `var(--lh-prose)` 22 (@base 13). **Cấm `line-height` là hệ số lẻ không đơn vị** — hệ số nhân lại với font-size (`1.5` × 13px = 19.5px) nên trả nửa pixel về đúng chỗ type scale vừa khử; giá trị có đơn vị kế thừa thành **độ dài cố định**. Khai `font-size: var(--fs-X)` ⇒ khai luôn `line-height: var(--lh-X)`; `font-size` px cố định ⇒ `line-height` px nguyên; văn bản dài dùng `--lh-prose`. Hệ số **nguyên** (`line-height: 1`) vẫn hợp lệ.
  - **Radius — 6 bậc:** `var(--r-xs)` 6 · `var(--r-sm)` 8 · `var(--r-btn)` 10 · `var(--r-card)` 14 · `var(--r-panel)` 16 · `var(--r-pill)`. **Cấm `border-radius: <n>px`**. `50%` và `0` vẫn hợp lệ.
  - **`em` vẫn dùng được** cho cỡ chữ tương đối với cha (icon inline, superscript) — khác ngữ nghĩa token, guard không bắt. **`px` cố định** hợp lệ cho badge/hint không muốn scale theo Appearance.
  - **Ngoại lệ:** khi con số px CHÍNH LÀ hình dạng (caret, swatch nhỏ, góc gần vuông làm đuôi bong bóng chat), giữ px và ghi `/* design-token-ok: <lý do> */` ngay trên dòng đó.
- **Monospace chỉ cho code** ([ADR 0079](../../docs/decisions/0079-native-macos-shell-and-design-tokens.md) D3). Tiêu chí: *nội dung này người dùng có copy-paste vào terminal/editor không?* Có (code, diff, path, SHA, lệnh shell, env var) → `var(--code)` + ghi `/* mono-ok: <lý do> */`. Không (timestamp, count, badge, chip, nhãn, initials) → font hệ thống. Cần **căn số thẳng cột** thì dùng `font-variant-numeric: tabular-nums` (hoặc class `.tnum`), KHÔNG dùng mono.
- **Section/group label** viết sentence-case, **không `text-transform: uppercase`**, không `letter-spacing` rộng. All-caps chỉ giữ cho nhãn kỹ thuật ngắn (tag ngôn ngữ code, badge trạng thái).
- **Selection state** (`.ni.on` / `.li.on` / row đang chọn) = **accent-tint** `--accentDim` + `--accentBorder` + thanh accent 2px. **Không** dùng nền xám `--bgActive` — đã thử và bị bác.
- Pixel-fixed lớn (hero, empty state) OK — intentional.

Chi tiết + bảng `rows → min-h`: [docs/coding/nuxt-frontend.md#ui-patterns](../../docs/coding/nuxt-frontend.md#ui-patterns).

## Routing

- File-based. Dynamic: `[param].vue`.
- Trang fullscreen: `definePageMeta({ layout: false })`.
- Navigate: `navigateTo()`, không `router.push`.

## VueFlow

- Node + edge → store (hoặc local ref nếu scope một page).
- Truy cập instance qua `useVueFlow()`, không pass qua props.

## Performance

- Tránh `watch` deep object lớn → ưu tiên `computed`.
- `shallowRef`/`shallowReactive` cho object lớn không cần reactivity sâu (Monaco, VueFlow graph).

Chi tiết: [docs/coding/nuxt-frontend.md](../../docs/coding/nuxt-frontend.md).
