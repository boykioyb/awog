<template>
  <span class="ssdot" :style="dotStyle" :title="tooltip" />
</template>

<script setup lang="ts">
// A small colored connection-status dot with a native tooltip (ADR 0060 P5 —
// Craft's SourceStatusIndicator, adapted to ui-next). The color comes from the
// shared SOURCE_STATUS_COLORS palette (theme CSS tokens); the tooltip is the
// localized status label, suffixed with the error message on a failed status.
// The status→status derivation lives in `deriveStatus` (stores/connections.ts).
import { computed } from 'vue'
import { SOURCE_STATUS_COLORS, type SourceConnectionStatus } from '~/stores/connections'

const props = withDefaults(
  defineProps<{
    status?: SourceConnectionStatus
    errorMessage?: string
    size?: 'sm' | 'md'
  }>(),
  { status: 'untested', errorMessage: '', size: 'sm' },
)

const { t } = useI18n()

const SIZE_PX = { sm: 7, md: 9 } as const

const dotStyle = computed(() => ({
  width: `${SIZE_PX[props.size]}px`,
  height: `${SIZE_PX[props.size]}px`,
  background: SOURCE_STATUS_COLORS[props.status],
}))

const tooltip = computed(() => {
  const label = t('connections.status.' + props.status)
  if (props.status === 'failed' && props.errorMessage) return `${label}: ${props.errorMessage}`
  return label
})
</script>

<style scoped>
.ssdot {
  display: inline-block;
  flex: 0 0 auto;
  border-radius: 50%;
}
</style>
