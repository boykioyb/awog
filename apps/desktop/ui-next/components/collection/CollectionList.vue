<template>
  <!-- List-grid dùng chung (khuôn Multica ListGrid): header label mảnh sticky
       + body cuộn. Parent truyền `cols` (grid-template-columns) MỘT lần —
       header và mọi `.cl-row` slot cùng ăn var(--cl-cols). Row là 2-line
       identity 64px: [avatar | name+desc] | ...cột phụ... | kebab.
       `cl-row` / `cl-row.cur` / `cl-cell` là API class cho phần tử trong slot (agents,
       board, teams dùng) — style của chúng khai bằng variant `[&_.cl-row]` ở body. -->
  <div class="flex min-h-0 flex-auto flex-col" :style="{ '--cl-cols': cols }">
    <div
      v-if="$slots.head"
      class="sticky top-0 z-2 grid h-8.5 flex-none grid-cols-(--cl-cols) items-center gap-x-3 border-b bg-background px-4 [&>*]:truncate [&>*]:text-xs [&>*]:font-medium [&>*]:text-muted-foreground"
    >
      <slot name="head" />
    </div>
    <div
      class="min-h-0 flex-auto overflow-y-auto [scrollbar-width:thin] [&_.cl-cell]:flex [&_.cl-cell]:min-w-0 [&_.cl-cell]:items-center [&_.cl-cell]:gap-2 [&_.cl-cell]:truncate [&_.cl-cell]:text-sm [&_.cl-cell]:text-muted-foreground [&_.cl-row]:grid [&_.cl-row]:h-16 [&_.cl-row]:cursor-pointer [&_.cl-row]:grid-cols-(--cl-cols) [&_.cl-row]:items-center [&_.cl-row]:gap-x-3 [&_.cl-row]:border-b [&_.cl-row]:px-4 [&_.cl-row]:transition-colors [&_.cl-row:hover]:bg-accent [&_.cl-row.cur]:bg-primary/10"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  // grid-template-columns — vd '24px minmax(220px,1fr) 140px 28px'
  cols: string
}>()
</script>
