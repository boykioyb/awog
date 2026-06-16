<template>
  <div v-if="items.length > 0" class="mb-1.5 flex flex-col gap-1">
    <div class="flex items-center gap-1.5 px-1">
      <Clock :size="11" :style="{ color: t.textDim }" />
      <span class="text-[12px] font-medium" :style="{ color: t.textDim }">
        {{ tr('session.queue.title') }} ({{ items.length }})
      </span>
      <button
        type="button"
        class="ml-auto text-[12px] px-1 rounded transition"
        :style="{ color: t.textDim }"
        :title="tr('session.queue.clear')"
        @click="store.clearQueue(session.id)"
      >
        {{ tr('session.queue.clear') }}
      </button>
    </div>

    <div
      v-for="(item, i) in items"
      :key="item.id"
      class="inline-flex items-start gap-1.5 px-2 py-1 rounded w-full"
      :style="{ background: t.bgSubtle, color: t.text, border: `1px solid ${t.border}` }"
    >
      <!-- FIFO position — matches the auto-send order. -->
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
          background: t.border,
          color: t.textDim,
        }"
      >
        {{ i + 1 }}
      </span>
      <span class="flex-1 min-w-0">
        <span class="block truncate" :style="{ color: t.text }">
          {{ item.commandInvocation || truncateForChip(item.text) || '—' }}
        </span>
        <span
          v-if="metaLine(item)"
          class="block text-[12px] truncate"
          :style="{ color: t.textFaint }"
        >
          {{ metaLine(item) }}
        </span>
      </span>
      <button
        type="button"
        class="text-[1em] inline-flex items-center flex-shrink-0"
        :style="{ color: t.textDim }"
        :title="tr('session.queue.remove')"
        @click="store.removeQueued(session.id, item.id)"
      >
        <X :size="10" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Clock, X } from 'lucide-vue-next'
import { computed } from 'vue'
import type { Session, SessionQueuedMessage } from '~/types'
import { truncateForChip } from '~/utils/follow-up'

const props = defineProps<{ session: Session }>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useSessionsStore()

const items = computed<SessionQueuedMessage[]>(() => store.queuedMessages(props.session.id))

// Secondary line: attachment + quote counts so a queued message that carries
// more than plain text reads clearly in the chip.
const metaLine = (item: SessionQueuedMessage): string => {
  const bits: string[] = []
  if (item.attachments?.length) bits.push(`📎 ${item.attachments.length}`)
  if (item.followUps?.length) bits.push(`❝ ${item.followUps.length}`)
  return bits.join('  ')
}
</script>
