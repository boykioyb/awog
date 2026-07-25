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
- **Font-size:**
  - **Body text dùng `text-[1em]`** (scale theo `--font-size-base` từ Appearance setting; default 12px, range `FONT_SIZE_MIN`=12 → `FONT_SIZE_MAX`=18 ở [composables/useAppearanceDom.ts](../../apps/desktop/ui-next/composables/useAppearanceDom.ts)). Không `text-xs`/`text-sm`/`text-[<1em]` cho text đọc được — để người dùng tự chỉnh cỡ qua setting thay vì hardcode nhỏ.
  - **Badge/hint/count chip = `text-[12px]` fixed** (không em, không scale). Áp dụng cho: numeric badge (dirty count, ahead/behind), section count `(N)`, status hint inline (`current`, `↑2`, `↓33`). Kèm `font-mono leading-none` + `minWidth: 18px` khi là pill số để box vuông cân.
  - **Section/group label** (uppercase header trong sidebar/section): giữ `text-[1em]` — là header, không phải badge.
  - Pixel-fixed lớn (`text-[80px]`, hero, empty state) OK — intentional.

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
