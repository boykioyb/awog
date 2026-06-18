<template>
  <button
    class="group flex w-full items-center gap-2 rounded-md py-1 pr-2 text-[1em] transition-colors"
    :class="
      active
        ? 'bg-accent text-accent-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    "
    :style="{ paddingLeft: `${basePaddingLeft}px` }"
    @click="emit('select')"
    @contextmenu.prevent="(ev: MouseEvent) => emit('context', ev)"
  >
    <component
      :is="icon"
      v-if="icon"
      :size="12"
      class="shrink-0"
      :class="iconTone === 'accent' ? 'text-primary' : ''"
    />
    <span
      class="flex-1 truncate text-left"
      :class="[mono ? 'font-mono' : '', highlight ? 'font-medium text-primary' : '']"
    >
      {{ label }}
    </span>
    <span v-if="hint" class="shrink-0 font-mono text-[12px] leading-none text-muted-foreground">
      {{ hint }}
    </span>
    <Badge
      v-if="badge !== null && badge !== undefined"
      :variant="badgeVariant"
      size="sm"
      class="font-mono"
    >
      {{ badge }}
    </Badge>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import { Badge } from '~/components/ui/badge'

type IconTone = 'normal' | 'dim' | 'accent'
type BadgeTone = 'warning' | 'danger' | 'accent'

type Props = {
  label: string
  icon?: Component
  iconTone?: IconTone
  active?: boolean
  indent?: number
  hint?: string | null
  badge?: number | string | null
  badgeTone?: BadgeTone
  mono?: boolean
  // Emphasise the label (accent color + medium weight) — e.g. current branch.
  highlight?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  icon: undefined,
  iconTone: 'normal',
  active: false,
  indent: 0,
  hint: null,
  badge: null,
  badgeTone: 'accent',
  mono: false,
  highlight: false,
})

const emit = defineEmits<{
  select: []
  context: [event: MouseEvent]
}>()

const basePaddingLeft = computed(() => 8 + props.indent * 14)

// AWOG badge tone → shadcn Badge variant. Neutral (accent) → `outline`: filled
// neutral chips (secondary/muted) are invisible on a card in this theme (card ≈
// secondary ≈ #161616), so a hairline border is what reads.
const badgeVariant = computed<'warning' | 'destructive' | 'outline'>(() => {
  if (props.badgeTone === 'warning') return 'warning'
  if (props.badgeTone === 'danger') return 'destructive'
  return 'outline'
})
</script>
