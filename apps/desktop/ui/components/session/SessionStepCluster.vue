<template>
  <!-- Step cluster (Claude-Code style): a compact card that folds a reason→act
       run behind a one-line "N steps · …" summary. COLLAPSED by default so the
       turn reads as a clean document; each instance owns its expand state so a
       turn with several runs toggles each independently. -->
  <div class="mt-2 overflow-hidden rounded-xl" :style="{ border: `1px solid ${t.border}` }">
    <!-- Summary header doubles as the toggle. -->
    <button
      type="button"
      class="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-mono transition"
      :style="{ background: t.bgSubtle, color: t.textDim }"
      @click="expanded = !expanded"
    >
      <ChevronDown
        :size="13"
        class="flex-shrink-0"
        :style="{
          color: t.textFaint,
          transform: expanded ? 'none' : 'rotate(-90deg)',
          transition: 'transform 0.15s',
        }"
      />
      <span class="min-w-0 truncate text-left">{{ summary }}</span>
      <Activity
        v-if="hasRunningStep"
        :size="10"
        class="flex-shrink-0 animate-pulse"
        :style="{ color: t.accent }"
      />
    </button>

    <!-- Body: flat list of one-line step rows. Full output is one click away in
         the step detail drawer. -->
    <div v-if="expanded" class="px-2 pb-2 pt-0.5 space-y-1 text-[12px]">
      <StepItem v-for="s in steps" :key="s.id" :step="s" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Activity, ChevronDown } from 'lucide-vue-next'
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
