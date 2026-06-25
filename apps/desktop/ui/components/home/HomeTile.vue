<template>
  <component
    :is="to ? 'button' : 'div'"
    :type="to ? 'button' : undefined"
    class="flex flex-col rounded-lg overflow-hidden text-left transition h-full"
    :style="rootStyle"
    @click="onClick"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <!-- Header: icon + title + optional count badge -->
    <div class="flex items-center gap-2 px-3.5 pt-3 pb-2">
      <div
        class="flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0"
        :style="{ background: t.bgSubtle, color: accentColor }"
      >
        <component :is="icon" :size="14" :stroke-width="1.75" />
      </div>
      <span class="text-[1em] font-medium truncate" :style="{ color: t.text }">{{ title }}</span>
      <span
        v-if="badge !== undefined && badge !== null"
        class="ml-auto flex items-center justify-center px-1.5 h-[18px] rounded-full text-[12px] font-mono leading-none"
        :style="badgeStyle"
      >
        {{ badge }}
      </span>
      <ChevronRight
        v-if="to"
        :size="14"
        class="flex-shrink-0 transition-opacity"
        :style="{
          color: t.textDim,
          opacity: hover ? 1 : 0,
          marginLeft: badge === undefined ? 'auto' : '0',
        }"
      />
    </div>

    <!-- Body slot -->
    <div class="flex-1 min-h-0 px-3.5 pb-3">
      <slot />
    </div>
  </component>
</template>

<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    icon: unknown
    title: string
    // Numeric count chip in the header. Omit to hide.
    badge?: number | string | null
    // Route to navigate to on click. Omit → non-interactive tile.
    to?: string
    // Tint the header icon + count chip with the accent or a status color.
    tone?: 'default' | 'accent' | 'warning' | 'danger'
  }>(),
  { badge: undefined, to: undefined, tone: 'default' },
)

const emit = defineEmits<{
  (e: 'activate'): void
}>()

const { t } = useTheme()
const hover = ref(false)

const accentColor = computed(() => {
  switch (props.tone) {
    case 'warning':
      return t.value.warning
    case 'danger':
      return t.value.danger
    case 'accent':
      return t.value.accent
    default:
      return t.value.textMuted
  }
})

const badgeStyle = computed(() => {
  const tone = props.tone
  if (tone === 'warning') return { background: t.value.warning, color: t.value.bg }
  if (tone === 'danger') return { background: t.value.danger, color: t.value.bg }
  if (tone === 'accent') return { background: t.value.accent, color: t.value.accentText }
  return { background: t.value.bgSubtle, color: t.value.textMuted }
})

const rootStyle = computed(() => ({
  background: hover.value && props.to ? t.value.bgHover : t.value.bgPanel,
  border: `1px solid ${hover.value && props.to ? t.value.borderStrong : t.value.border}`,
  cursor: props.to ? 'pointer' : 'default',
}))

const onClick = () => {
  emit('activate')
  if (props.to) void navigateTo(props.to)
}
</script>
