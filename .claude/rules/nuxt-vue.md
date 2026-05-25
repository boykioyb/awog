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
- Component dài > ~250 dòng → tách subcomponent.

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
