<template>
  <div class="mt-2">
    <!-- Per-cluster collapse toggle, rendered inline at this run's position in
         the reply. The summary ("ran N commands · read N files") doubles as the
         toggle; each cluster holds its own expand state (one ref per component
         instance), so a turn with several reason→act runs toggles each run
         independently instead of one shared switch. Default COLLAPSED so the
         turn reads as a clean document. -->
    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-[12px] py-0.5 px-1.5 -ml-1.5 rounded transition hover:bg-white/5"
      :style="{ color: t.textDim }"
      @click="expanded = !expanded"
    >
      <Info :size="11" />
      <span>{{ summary }}</span>
      <Activity
        v-if="hasRunningStep"
        :size="10"
        class="animate-pulse"
        :style="{ color: t.accent }"
      />
      <ChevronDown
        :size="10"
        :style="{
          transform: expanded ? 'none' : 'rotate(-90deg)',
          transition: 'transform 0.15s',
        }"
      />
    </button>

    <!-- Claude-Code-style timeline: flat vertical list, no box — each step's own
         status icon is the bullet, a thin left rail groups the run. Each row is a
         single truncated line; the full output is one click away in the detail. -->
    <div
      v-if="expanded"
      class="mt-1 space-y-1 text-[12px] pl-3"
      :style="{ borderLeft: `2px solid ${t.border}` }"
    >
      <StepItem v-for="s in steps" :key="s.id" :step="s" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Activity, ChevronDown, Info } from 'lucide-vue-next'
import type { SessionStep } from '~/types'
import { stepsSummary } from '~/utils/steps-summary'

const props = defineProps<{
  steps: SessionStep[]
}>()

const { t } = useTheme()

// Per-cluster collapse state — local to this instance, so sibling clusters in
// the same turn open/close independently. Default collapsed ("đóng sẵn").
const expanded = ref(false)

const summary = computed(() => stepsSummary(props.steps))

const hasRunningStep = computed((): boolean =>
  props.steps.some((s) => s.status === 'running' || s.status === undefined),
)
</script>
