<template>
  <div class="flex items-center gap-3">
    <span
      class="grid size-8.5 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
    >
      <slot name="icon" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="text-base font-semibold">{{ title }}</div>
      <div class="mt-0.5 text-sm text-dim">{{ desc }}</div>
    </div>
    <Badge v-if="status" variant="outline" class="shrink-0 text-muted-foreground">
      <span class="size-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-faint'" />
      {{ status }}
    </Badge>
  </div>
</template>

<script setup lang="ts">
// Đầu thẻ nhà cung cấp trong Settings → Models: ô icon + tên + mô tả + badge trạng thái
// kết nối (tuỳ chọn). Dùng chung cho thẻ Anthropic / OpenAI / Google / endpoint tuỳ chỉnh
// / danh mục model.
withDefaults(
  defineProps<{
    title: string
    desc: string
    status?: string
    connected?: boolean
  }>(),
  { status: '', connected: false },
)
</script>
