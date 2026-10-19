<template>
  <span
    class="inline-block flex-none rounded-full"
    :class="SIZE_CLASS[size]"
    :style="dotStyle"
    :title="tooltip"
  />
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

// 7px / 9px — chấm trạng thái nhỏ theo thang spacing (0.25 = 1px).
const SIZE_CLASS = { sm: 'size-1.75', md: 'size-2.25' } as const

// Màu lấy từ bảng SOURCE_STATUS_COLORS dùng chung (token theme) — một nguồn cho mọi
// chỗ vẽ trạng thái source.
const dotStyle = computed(() => ({ background: SOURCE_STATUS_COLORS[props.status] }))

const tooltip = computed(() => {
  const label = t('connections.status.' + props.status)
  if (props.status === 'failed' && props.errorMessage) return `${label}: ${props.errorMessage}`
  return label
})
</script>
