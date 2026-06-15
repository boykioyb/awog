<template>
  <div class="flex flex-col gap-1.5">
    <button
      v-for="(fu, i) in followUps"
      :key="fu.id"
      type="button"
      class="flex items-start gap-2 rounded-lg px-2 py-1.5 w-full text-left"
      :style="{ background: `${t.accent}14`, border: `1px solid ${t.accent}40` }"
      :title="tr('session.followup.reveal')"
      @click="revealFollowUpAnchor(fu.id)"
    >
      <!-- The number ties this quote to the ① anchor badge in the source message. -->
      <span
        class="inline-flex items-center justify-center font-mono leading-none flex-shrink-0"
        :style="{
          minWidth: '16px',
          height: '16px',
          marginTop: '1px',
          padding: '0 4px',
          borderRadius: '8px',
          fontSize: '11px',
          fontWeight: 700,
          background: t.accent,
          color: t.accentText,
        }"
      >
        {{ i + 1 }}
      </span>
      <div class="min-w-0 flex-1 pl-2" :style="{ borderLeft: `2px solid ${t.accent}` }">
        <div class="text-[1em] italic awog-fu-quote" :style="{ color: t.textDim }">
          {{ truncateForChip(fu.selectedText, 220) }}
        </div>
        <div
          v-if="fu.note"
          class="text-[1em] mt-0.5 whitespace-pre-wrap"
          :style="{ color: t.text }"
        >
          {{ fu.note }}
        </div>
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { SessionFollowUp } from '~/types'
import { truncateForChip } from '~/utils/follow-up'
import { revealFollowUpAnchor } from '~/utils/follow-up-anchor'

defineProps<{
  followUps: SessionFollowUp[]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
</script>

<style scoped>
/* Clamp long quotes to a few lines in the bubble — the full text still reaches
   the model via message.text. */
.awog-fu-quote {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
