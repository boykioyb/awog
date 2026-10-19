<template>
  <!-- Nhóm nút liền viền trên vbar của doc: chọn chế độ (Xem trước | Sửa, Sơ đồ |
       Mã nguồn) hoặc thao tác (Thu nhỏ | Vừa khung | Phóng to). `active` = nút
       đang bật (không có thì mọi nút ở trạng thái thường). Nhóm cao cố định 24px
       (vbar 32px) — Button ép `h-full` để không cao theo --ctrl-h. -->
  <span
    class="flex h-6 flex-none items-stretch overflow-hidden rounded-sm border border-border"
    role="group"
  >
    <Button
      v-for="o in options"
      :key="o.id"
      variant="ghost"
      size="xs"
      class="h-full rounded-none px-2.5 font-normal not-first:border-l"
      :class="active === o.id ? 'bg-muted text-foreground' : 'text-dim hover:text-foreground'"
      :title="o.title"
      :aria-pressed="active === undefined ? undefined : active === o.id"
      @click="emit('select', o.id)"
    >
      {{ o.label }}
    </Button>
  </span>
</template>

<script setup lang="ts" generic="T extends string">
defineProps<{
  options: readonly { id: T; label: string; title?: string }[]
  active?: T | null
}>()
const emit = defineEmits<{ select: [id: T] }>()
</script>
