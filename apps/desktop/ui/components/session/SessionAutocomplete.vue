<template>
  <div
    v-if="items.length > 0"
    class="rounded-md overflow-hidden"
    :style="{
      background: t.bgPanel,
      border: `1px solid ${t.borderStrong}`,
      boxShadow: `0 8px 24px ${t.shadow}`,
      maxHeight: '280px',
      overflowY: 'auto',
    }"
  >
    <div
      class="px-2.5 py-1 text-[1em] uppercase tracking-wider flex items-center justify-between"
      :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
    >
      <span>{{ title }}</span>
      <span class="font-mono normal-case" :style="{ color: t.textFaint }">
        ↑↓ navigate · ↵ pick · esc close
      </span>
    </div>
    <button
      v-for="(item, i) in items"
      :key="`${item.kind}-${item.id}`"
      class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
      :style="{
        background: i === activeIndex ? t.bgActive : 'transparent',
        color: t.text,
      }"
      @mouseenter="emit('hover', i)"
      @mousedown.prevent="emit('pick', item)"
    >
      <component
        :is="item.icon"
        :size="11"
        class="flex-shrink-0"
        :style="{ color: tokenColor(item.kind) }"
      />
      <span class="flex-1 min-w-0 truncate">{{ item.label }}</span>
      <span
        v-if="item.hint"
        class="font-mono text-[1em] truncate"
        :style="{ color: t.textDim, maxWidth: '50%' }"
      >
        {{ item.hint }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { LucideIcon } from 'lucide-vue-next'
import type { SessionTokenKind } from '~/types'

export interface AutoItem {
  kind: SessionTokenKind
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  insertHandle: string
}

defineProps<{
  title: string
  items: AutoItem[]
  activeIndex: number
}>()

const emit = defineEmits<{
  pick: [item: AutoItem]
  hover: [index: number]
}>()

const { t } = useTheme()

const tokenColor = (kind: SessionTokenKind) => {
  if (kind === 'agent') return t.value.warning
  if (kind === 'skill') return t.value.accent
  if (kind === 'file') return t.value.info
  return t.value.success
}
</script>
