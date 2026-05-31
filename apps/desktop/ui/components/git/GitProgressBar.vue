<template>
  <div
    class="flex items-center gap-2 text-[1em] px-2 py-1 rounded"
    :style="{ background: t.bgInput, border: `1px solid ${t.border}`, color: t.textDim }"
  >
    <span class="font-mono uppercase">{{ progress.op }}</span>
    <div
      class="relative w-32 h-1.5 rounded overflow-hidden"
      :style="{ background: t.bgPanel, border: `1px solid ${t.border}` }"
    >
      <!-- Determinate: width = pct. Indeterminate: full-width with pulse. -->
      <div
        v-if="progress.pct !== null"
        class="h-full transition-all duration-200"
        :style="{ width: `${progress.pct}%`, background: t.accent }"
      />
      <div
        v-else
        class="absolute inset-0 animate-pulse"
        :style="{ background: t.accent, opacity: 0.5 }"
      />
    </div>
    <span class="whitespace-nowrap">{{ label }}</span>
    <button
      class="ml-1 p-0.5 rounded transition"
      :style="cancelStyle"
      title="Cancel"
      aria-label="Cancel"
      @mouseenter="hover = true"
      @mouseleave="hover = false"
      @click="emit('cancel')"
    >
      <X :size="11" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { GitStreamingOp } from '~/composables/useGitApi'

type Progress = { op: GitStreamingOp; phase: string | null; pct: number | null }

const props = defineProps<{ progress: Progress }>()

const emit = defineEmits<{ cancel: [] }>()

const { t } = useTheme()
const hover = ref(false)

const label = computed(() => {
  const phase = props.progress.phase ?? 'working'
  const pct = props.progress.pct
  if (pct === null) return `${phase}…`
  return `${phase}… ${pct}%`
})

const cancelStyle = computed(() => ({
  background: hover.value ? t.value.dangerBg : 'transparent',
  color: hover.value ? t.value.danger : t.value.textDim,
  border: `1px solid ${hover.value ? t.value.dangerBorder : 'transparent'}`,
}))
</script>
