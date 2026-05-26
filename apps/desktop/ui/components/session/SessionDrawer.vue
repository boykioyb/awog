<template>
  <Teleport to="body">
    <div
      v-if="open && step"
      class="fixed inset-0 z-40 flex items-stretch justify-end"
      :style="{ background: t.overlay }"
      @click.self="emit('close')"
    >
      <SessionStepDetail :step="step" floating @close="emit('close')" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionStep } from '~/types'

const props = defineProps<{
  open: boolean
  step: SessionStep | null
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useTheme()

const enabled = computed(() => props.open && props.step !== null)
useEscape(() => emit('close'), { enabled })
</script>
