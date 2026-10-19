<template>
  <!-- Section phẳng (không nền xám) — hairline + thụt lề đọc cả lượt chạy thành một khối. -->
  <div>
    <!-- Group header (proto ProtoStepGroup parity): chevron + count pill +
         "Steps completed" + failed/running counts + one-line live preview of
         what the turn is doing. Click toggles the activity body. -->
    <!-- raw-ok: header nhóm cả dòng là một vùng bấm, cùng dáng hàng step -->
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground select-none transition-colors hover:bg-accent motion-reduce:transition-none"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <Icon
        name="chev"
        class="size-3.5 flex-none text-muted-foreground/60 transition-transform motion-reduce:transition-none"
        :class="[collapsed ? '-rotate-90' : '']"
      />
      <!-- Ô đếm (proto: cao 16, rộng tối thiểu 18, viền bo), số thẳng cột. -->
      <span
        class="inline-flex h-4 min-w-4.5 flex-none items-center justify-center rounded-sm border px-1 text-xs text-muted-foreground tabular-nums"
      >
        {{ entries.length }}
      </span>
      <!-- Nhãn + bộ đếm giữ bề rộng tự nhiên, không co/xuống dòng. Chỉ preview (flex-auto,
           min-w-0) được cắt "…", để một preview dài liền mạch (lệnh shell một dòng)
           không ép "N bước" thành cột chữ. -->
      <span class="flex-none whitespace-nowrap">{{ t('sessions.turn.stepsCompleted') }}</span>
      <span v-if="failedCount > 0" class="flex-none whitespace-nowrap text-destructive">
        {{ t('sessions.turn.errorCount', { count: failedCount }) }}
      </span>
      <!-- Đếm đang chạy — chữ primary + vòng cung mảnh (không xoay glyph).
           px-ok: nét vòng 1.5px là hình vẽ. -->
      <span
        v-if="runningCount > 0"
        class="inline-flex flex-none items-center gap-1 whitespace-nowrap text-primary"
      >
        <span
          class="size-3 flex-none animate-spin rounded-full border-[1.5px] border-transparent border-t-primary motion-reduce:animate-none"
        />
        {{ t('sessions.bg.summary.running', { n: runningCount }) }}
      </span>
      <!-- Preview đang chạy — một dòng, cắt "…", nửa độ đậm (preview mờ dần của craft). -->
      <span v-if="!isFallbackPreview" class="min-w-0 flex-auto truncate text-muted-foreground/60">
        {{ preview }}
      </span>
    </button>
    <Collapse :open="!collapsed">
      <!-- Body: tree indent — a left hairline rail groups the run as one unit. Lề trái
           ~11px để rail thẳng dưới chevron của header (craft TurnCard tree indent). -->
      <div class="mt-0.5 ml-2.75 flex flex-col gap-0.5 border-l pl-3">
        <template v-for="e in entries" :key="e.key">
          <SessionStepItem v-if="e.kind === 'step'" :block="e.step" :msg-eid="msgEid" />
          <!-- Extended-thinking: collapsible reasoning, italic muted body —
               each block toggles independently by its stable key. Header là một hàng
               trơn như step; RAIL chỉ thuộc về thân đã mở, thụt dưới cột icon. -->
          <div v-else-if="e.kind === 'thinking'">
            <!-- raw-ok: header thinking cả dòng là một vùng bấm, cùng dáng hàng step -->
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground select-none transition-colors hover:bg-accent motion-reduce:transition-none italic"
              :aria-expanded="thinkOpen.has(e.key)"
              @click="toggleThink(e.key)"
            >
              <Icon
                name="chev"
                class="size-3 flex-none text-muted-foreground/50 transition-transform motion-reduce:transition-none"
                :class="[thinkOpen.has(e.key) ? '' : '-rotate-90']"
              />
              <Icon name="brain" class="size-3.5 flex-none text-muted-foreground" />
              {{ t('sessions.thinking') }}
            </button>
            <div
              v-if="thinkOpen.has(e.key)"
              class="mt-0.5 mb-1 ml-6 border-l-2 pl-2.5 text-xs leading-(--lh-prose) whitespace-pre-wrap text-muted-foreground italic"
            >
              {{ e.text }}
            </div>
          </div>
          <!-- Intermediate commentary (text the model wrote before a tool). Dimmed so it
               reads as an activity, not the final answer. `streaming` is threaded through
               so the stream-end flush fires here too: without it these blocks keep
               props.streaming=false, the flush watch never runs, and a run whose renderSrc
               was pinned mid-stream stays truncated until the app restarts (same defect the
               response block's flush fixes). Cùng lề với hàng step (proto `px-1.5 py-1`)
               để chữ thẳng hàng với tên tool phía trên/dưới. -->
          <div v-else class="px-1.5 py-1 opacity-75">
            <SessionTextBlock :text="e.text" :streaming="streaming" />
          </div>
        </template>
      </div>
    </Collapse>
  </div>
</template>

<script setup lang="ts">
// The collapsible "N steps · <preview>" activity section of an assistant turn
// (ADR 0061, Pha 3). Generalises the old SessionCluster: instead of only plain tool
// steps, it collapses tool steps + extended-thinking + intermediate commentary text
// into one unit, matching craft's TurnCard body. Collapsed by default (AWOG steps
// are closed by default) and follows the transcript-wide fold-all broadcast.
import type { StepBlock } from '~/composables/useSessionsData'

// A pre-narrowed render entry so the template never narrows a union via property
// access (vue-tsc friendly). Built by SessionMessageItem's grouping.
export type ActivityEntry =
  | { key: string; kind: 'step'; step: StepBlock }
  | { key: string; kind: 'thinking'; text: string }
  | { key: string; kind: 'text'; text: string }

const props = defineProps<{
  entries: ActivityEntry[]
  preview: string
  streaming?: boolean
  // Persisted id (eid, ADR 0074) của message chứa lượt này — SessionStepItem cần
  // nó để fetch detail deferred qua sessions.stepDetail.
  msgEid?: string
}>()
const { t } = useI18n()

// Header counts (proto ProtoStepGroup parity): failed tint destructive, live
// running count gets a spinner.
const failedCount = computed(
  () => props.entries.filter((e) => e.kind === 'step' && e.step.status === 'error').length,
)
const runningCount = computed(
  () => props.entries.filter((e) => e.kind === 'step' && e.step.status === 'running').length,
)

// When the turn settles, getPreviewText falls back to the label the header
// already renders ("Steps completed" + optional error suffix — the latter is
// also shown by .tfail). Printing it again in .tprev reads as a duplicated
// label, so hide the preview whenever it IS that fallback.
const isFallbackPreview = computed(() =>
  props.preview.startsWith(t('sessions.turn.stepsCompleted')),
)

// Collapsed-by-default: header click toggles the body (Collapse đóng thân).
const collapsed = ref(true)

// Follow the transcript-wide collapse-all / expand-all broadcast (manual clicks
// still toggle locally until the next broadcast). Mirrors SessionStepItem's fold wiring.
const fold = useStepFold()
watch(
  () => fold.signal.seq,
  () => {
    collapsed.value = fold.signal.mode !== 'expand'
  },
)

// Per-thinking-block expansion, keyed by the entry's stable key so multiple thinking
// blocks toggle independently and keep state across streaming re-groups.
const thinkOpen = reactive(new Set<string>())
function toggleThink(key: string) {
  if (thinkOpen.has(key)) thinkOpen.delete(key)
  else thinkOpen.add(key)
}
</script>
