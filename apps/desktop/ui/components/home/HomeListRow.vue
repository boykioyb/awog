<template>
  <component
    :is="interactive ? 'button' : 'div'"
    :type="interactive ? 'button' : undefined"
    class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition text-left"
    :style="rootStyle"
    @click="interactive && emit('select')"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <span
      v-if="dot"
      class="flex-shrink-0 w-1.5 h-1.5 rounded-full"
      :class="pulse ? 'animate-pulse' : ''"
      :style="{ background: dotColor }"
    />
    <span class="flex-1 min-w-0 truncate text-[1em]" :style="{ color: t.text }">
      {{ label }}
    </span>
    <span
      v-if="meta"
      class="flex-shrink-0 text-[12px] font-mono leading-none"
      :style="{ color: t.textDim }"
    >
      {{ meta }}
    </span>
  </component>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string
    // Right-aligned secondary text (time / status hint).
    meta?: string
    // Show a leading status dot.
    dot?: boolean
    // Pulse the dot (live work).
    pulse?: boolean
    // Status tone for the dot.
    tone?: 'default' | 'accent' | 'warning' | 'danger'
    // Clickable row (emits `select`).
    interactive?: boolean
  }>(),
  { meta: undefined, dot: false, pulse: false, tone: 'default', interactive: false },
)

const emit = defineEmits<{
  (e: 'select'): void
}>()

const { t } = useTheme()
const hover = ref(false)

const dotColor = computed(() => {
  switch (props.tone) {
    case 'warning':
      return t.value.warning
    case 'danger':
      return t.value.danger
    case 'accent':
      return t.value.accent
    default:
      return t.value.textDim
  }
})

const rootStyle = computed(() => ({
  background: props.interactive && hover.value ? t.value.bgHover : 'transparent',
  cursor: props.interactive ? 'pointer' : 'default',
}))
</script>
