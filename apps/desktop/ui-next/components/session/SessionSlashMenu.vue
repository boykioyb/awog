<template>
  <!-- Khung popover: bề mặt popover + hairline + bóng vừa, item dày p-1. Nhãn đầu +
       gợi ý cuối ghim ngoài vùng cuộn; danh sách tự cuộn (gõ `/` trơn có thể > 80 hàng). -->
  <div
    class="mb-2 flex max-h-[min(340px,42vh)] flex-col overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
  >
    <div class="flex-none px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
      {{ t('sessions.composer.slashCommands') }}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- Lưới 3 cột để tên / mô tả / tag thẳng cột qua mọi hàng. Cột 1 rộng cố định
           theo rem (scale theo cỡ chữ Appearance) nên mô tả bắt đầu cùng một x; tên dài
           thì cắt (tên đủ ở tooltip). -->
      <div
        v-for="(c, i) in items"
        :key="c.key"
        class="grid cursor-pointer grid-cols-[10.5rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-sm px-2 py-1 text-sm"
        :class="{ 'bg-accent text-accent-foreground': i === active }"
        @mousedown.prevent="emit('select', i)"
        @mouseenter="emit('hover', i)"
      >
        <!-- mono-ok: slash command là chuỗi người dùng gõ nguyên văn -->
        <span class="truncate font-mono text-primary" :title="`/${c.label}`">/{{ c.label }}</span>
        <span class="min-w-0 truncate text-muted-foreground" :title="c.desc">{{ c.desc }}</span>
        <Badge
          variant="outline"
          class="justify-self-end rounded-sm border-transparent px-1.5 uppercase tracking-wide"
          :class="TAG_CLASS[c.kind]"
        >
          {{ t(`sessions.composer.kind.${c.kind}`) }}
        </Badge>
      </div>
    </div>
    <div class="mt-0.5 flex-none border-t px-2 pt-1 pb-0.5 text-xs text-faint">
      {{ t('sessions.composer.slashHint') }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Slash `/` autocomplete dropdown (§2). Real sources: built-in session commands
// (mode/compact/style — dispatched as actions) + user commands + skills (inserted
// as `/id`, expanded on send) + the Claude CLI's own commands (/goal, /context…,
// sent verbatim for the CLI to run — Claude SDK branch only). The composer owns the
// textarea + arrow-key nav and passes `active` (highlighted index) down; this
// renders + emits select(index)/hover.
import type { SlashItem } from './session-composer-commands'

defineProps<{ items: SlashItem[]; active: number }>()
const emit = defineEmits<{
  select: [i: number]
  hover: [i: number]
}>()
const { t } = useI18n()

// Màu tag theo loại: builtin = primary, command = info, skill = lavender, Claude
// CLI = warning. Chữ + nền nhạt cùng một màu.
const TAG_CLASS: Record<SlashItem['kind'], string> = {
  builtin: 'bg-primary/15 text-primary',
  command: 'bg-info/15 text-info',
  skill: 'bg-lavender/15 text-lavender',
  cli: 'bg-warning/15 text-warning',
}
</script>
