<template>
  <Button
    variant="ghost"
    size="xs"
    class="h-5 min-w-0 gap-1 px-1.5 text-sm font-normal [&_svg]:size-3.5"
    :class="
      active
        ? 'bg-selected text-primary hover:bg-selected hover:text-primary'
        : 'text-muted-foreground hover:text-foreground'
    "
  >
    <slot />
  </Button>
</template>

<script setup lang="ts">
// Chip của status bar: Button ghost ép về 20px (status bar cao 26px, size nhỏ nhất
// của Button là 28px). Dùng chung cho mọi chip trong components/shell (branch,
// context, project, style, usage, Files/Browser/Terminal). `active` = khung tương
// ứng đang mở → accent-tint, không fill xám. Attr ngoài (`title`, `@click`,
// `aria-*`, PopoverTrigger/HoverCardTrigger as-child) rơi xuống Button.
// Template KHÔNG mở đầu bằng comment: ở dev comment gốc biến root thành fragment,
// `$el` thành text node — StatusUsageRing đọc `$el` để nhận ra click vào chính chip.
defineProps<{ active?: boolean }>()
</script>
