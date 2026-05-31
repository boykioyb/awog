<template>
  <button
    class="group flex items-center gap-2 w-full px-2 py-1 transition select-none"
    :style="rowStyle"
    @click="emit('select')"
    @contextmenu.prevent="(ev: MouseEvent) => emit('context', ev)"
  >
    <component :is="icon" v-if="icon" :size="12" :style="{ color: iconColor, flexShrink: 0 }" />
    <span
      class="text-[1em] flex-1 truncate text-left"
      :class="mono ? 'font-mono' : ''"
      :style="{ color: labelColor }"
    >
      {{ label }}
    </span>
    <span
      v-if="hint"
      class="text-[12px] flex-shrink-0 font-mono leading-none"
      :style="{ color: hintColor }"
    >
      {{ hint }}
    </span>
    <span
      v-if="badge !== null && badge !== undefined"
      class="text-[12px] flex-shrink-0 px-1.5 py-0.5 rounded font-medium font-mono leading-none inline-flex items-center justify-center"
      :style="{ ...badgeStyle, minWidth: '18px' }"
    >
      {{ badge }}
    </span>
  </button>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

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
})

const emit = defineEmits<{
  select: []
  context: [event: MouseEvent]
}>()

const { t } = useTheme()

const basePaddingLeft = computed(() => 8 + props.indent * 14)

const rowStyle = computed(() => ({
  paddingLeft: `${basePaddingLeft.value}px`,
  paddingRight: '8px',
  background: props.active ? t.value.bgHover : 'transparent',
  borderLeft: `2px solid ${props.active ? t.value.accent : 'transparent'}`,
  cursor: 'pointer',
}))

const iconColor = computed(() => {
  if (props.iconTone === 'accent') return t.value.accent
  if (props.iconTone === 'dim') return t.value.textDim
  return props.active ? t.value.text : t.value.textDim
})

const labelColor = computed(() => (props.active ? t.value.text : t.value.textMuted))
const hintColor = computed(() => t.value.textDim)

const badgeStyle = computed(() => {
  if (props.badgeTone === 'warning') {
    return {
      background: t.value.warningBg,
      color: t.value.warning,
    }
  }
  if (props.badgeTone === 'danger') {
    return {
      background: t.value.dangerBg,
      color: t.value.danger,
    }
  }
  return {
    background: t.value.bgInput,
    color: t.value.textMuted,
  }
})
</script>
