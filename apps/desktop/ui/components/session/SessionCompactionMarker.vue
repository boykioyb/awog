<template>
  <div class="flex flex-col items-center gap-1.5 py-1 select-none">
    <button
      type="button"
      class="inline-flex items-center gap-2 px-3 py-1 rounded-full transition text-[1em]"
      :style="{ background: t.bgSubtle, color: t.textDim, border: `1px solid ${t.border}` }"
      :title="open ? tr('session.compaction.hide') : tr('session.compaction.view')"
      @click="open = !open"
    >
      <Archive :size="13" :style="{ color: t.accent }" />
      <span>{{ tr('session.compaction.marker', { count: foldedCount }) }}</span>
      <component :is="open ? ChevronUp : ChevronDown" :size="13" />
    </button>
    <div
      v-if="open"
      class="w-full max-w-2xl rounded-lg px-3 py-2.5 text-[1em] whitespace-pre-wrap leading-relaxed"
      :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
    >
      {{ compaction.summary }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { Archive, ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { SessionCompaction } from '~/types'

// Compaction marker (ADR 0047): a divider-style chip shown just before the first
// message kept in the model context. Older turns above it stay visible in the
// transcript; only the model context was cut. Click to reveal the summary the
// model now sees in place of those turns.
defineProps<{
  compaction: SessionCompaction
  // Number of earlier messages folded behind the summary (display only).
  foldedCount: number
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const open = ref(false)
</script>
