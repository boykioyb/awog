<template>
  <div
    v-if="active"
    class="absolute left-0 right-0 bottom-0 flex items-center gap-2 px-3 h-[3px] pointer-events-none"
  >
    <!-- Determinate fill OR indeterminate pulse, full-width strip anchored to
         the header's bottom border. Layout never shifts because the strip is
         absolutely positioned. -->
    <div
      v-if="active.pct !== null"
      class="h-full transition-all duration-200 pointer-events-none"
      :style="{ width: `${active.pct}%`, background: t.accent }"
    />
    <div
      v-else
      class="absolute inset-0 animate-pulse pointer-events-none"
      :style="{ background: t.accent, opacity: 0.5 }"
    />

    <!-- Hover-revealed status pill + cancel button, anchored top-right of the
         strip so it overlaps the header content without reserving width. -->
    <div
      class="absolute right-2 -top-7 flex items-center gap-2 px-2 py-1 rounded text-[0.71em] pointer-events-auto shadow-lg"
      :style="{
        background: t.bgPanel,
        color: t.textDim,
        border: `1px solid ${t.border}`,
      }"
    >
      <span class="font-mono uppercase">{{ active.op }}</span>
      <span class="whitespace-nowrap">{{ label }}</span>
      <button
        class="p-0.5 rounded transition"
        :style="cancelStyle"
        title="Cancel"
        aria-label="Cancel"
        @mouseenter="hover = true"
        @mouseleave="hover = false"
        @click="onCancel"
      >
        <X :size="11" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'

const { t } = useTheme()
const store = useGitStore()
const hover = ref(false)

const active = computed(() => {
  if (!store.progressOp) return null
  return {
    op: store.progressOp,
    phase: store.progressPhase,
    pct: store.progressPct,
  }
})

const label = computed(() => {
  if (!active.value) return ''
  const phase = active.value.phase ?? 'working'
  const pct = active.value.pct
  if (pct === null) return `${phase}…`
  return `${phase}… ${pct}%`
})

const cancelStyle = computed(() => ({
  background: hover.value ? t.value.dangerBg : 'transparent',
  color: hover.value ? t.value.danger : t.value.textDim,
  border: `1px solid ${hover.value ? t.value.dangerBorder : 'transparent'}`,
}))

const onCancel = () => {
  if (active.value) store.cancel(active.value.op)
}
</script>
