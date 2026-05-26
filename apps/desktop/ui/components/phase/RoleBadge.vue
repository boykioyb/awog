<template>
  <div
    class="rounded font-semibold flex-shrink-0 inline-flex items-center justify-center uppercase tracking-wide"
    :style="{
      height: height + 'px',
      minWidth: height + 'px',
      padding: isShort ? '0' : '0 8px',
      fontSize: fontSize + 'px',
      lineHeight: '1',
      letterSpacing: '0.02em',
      background: t.bgInput,
      border: `1px solid ${t.border}`,
      color: t.textMuted,
      fontFamily: '-apple-system, BlinkMacSystemFont, Inter, sans-serif',
    }"
  >
    {{ role }}
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    role: string
    size?: 'sm' | 'md'
  }>(),
  { size: 'md' },
)

const { t } = useTheme()

const height = computed(() => (props.size === 'sm' ? 20 : 24))
const fontSize = computed(() => (props.size === 'sm' ? 9 : 10))
const isShort = computed(() => (props.role || '').length <= 3)
</script>
