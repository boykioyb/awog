<template>
  <!-- Collection page header — khuôn Multica: icon tile + title (kèm count)
       + tagline muted bên phải + actions slot (nút New primary). -->
  <header class="flex h-14 flex-none items-center gap-2.5 border-b px-5">
    <span
      class="inline-flex size-7.5 flex-none items-center justify-center rounded-md border bg-muted text-muted-foreground"
    >
      <Icon :name="icon" class="size-4" />
    </span>
    <div class="flex min-w-0 flex-col">
      <span
        class="inline-flex items-baseline gap-1.5 text-base font-semibold tracking-tight text-foreground"
      >
        {{ title }}
        <Badge
          v-if="count != null"
          variant="secondary"
          class="bg-muted px-1.5 py-px text-muted-foreground"
        >
          {{ count }}
        </Badge>
      </span>
      <span v-if="tagline" class="truncate text-xs text-muted-foreground">{{ tagline }}</span>
    </div>
    <span class="flex-1" />
    <slot />
  </header>
</template>

<script setup lang="ts">
import Icon from '~/components/Icon.vue'

defineProps<{
  icon: string
  title: string
  tagline?: string
  count?: number
}>()
</script>
