<template>
  <!-- Teleport to body: mounted deep in the transcript subtree but rendered as a
       top-level full-window overlay (escapes any ancestor stacking context / overflow),
       mirroring PreviewModal. Click the scrim (@click.self) or Esc / the header × to close. -->
  <Teleport to="body">
    <!-- Overlay phủ cả cửa sổ: scrim kín, thẻ kéo tràn mép (như PreviewModal). z-470:
         lượt-fullscreen mở được từ trong board item (`.wsed-ovl` 160) và peek full
         (`.apeek.full` 400) nên phải nổi trên cả hai; vẫn dưới preview 480 vì preview
         mở được TỪ đây (link/ảnh trong lượt). `.ftovl` được useSessionFind.ts đọc để
         nhường phím ⌘F cho overlay này.
         hook-ok: `.ovl.on` (OVERLAYS của useEmbeddedBrowser.ts), `.ftovl` (useSessionFind) -->
    <div class="ovl on ftovl" :class="OVERLAY_CLASS" @click.self="emit('close')">
      <div class="relative flex size-full flex-col overflow-hidden bg-background">
        <!-- Lề ngang bằng header PreviewModal — chừa chỗ cho nút cửa sổ OS mà overlay này
             phủ lên (app-shell.css công bố hai dải inset). -->
        <div
          class="flex items-center gap-2 border-b py-2.5 pr-[calc(14px+var(--titlebar-inset-end))] pl-[calc(14px+var(--titlebar-inset-start))] text-foreground"
        >
          <Icon name="layers" class="size-3.5" />
          <span class="min-w-0 truncate font-semibold">{{ title }}</span>
          <span
            v-if="streaming"
            class="inline-flex flex-none items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span class="inline-block size-2 rounded-full bg-primary opacity-50" />
            {{ t('sessions.message.waiting') }}
          </span>
          <span class="flex-1" />
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground hover:text-foreground"
            :class="{ 'bg-accent text-foreground': findOpen }"
            :title="t('common.search')"
            :aria-label="t('common.search')"
            @click="toggleFind"
          >
            <Icon name="search" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground hover:text-foreground"
            :title="t('common.close')"
            @click="emit('close')"
          >
            <Icon name="x" />
          </Button>
        </div>

        <!-- Find-in-turn (⌘/Ctrl+F or the header search button): floats below the header,
             clear of the OS window controls, over the body without shifting layout. Same
             FindBar + DOM-wrap engine as the PreviewModal / transcript find. -->
        <!-- Neo cỡ 0 cho FindBar nổi (`.pvfind` của nó absolute top/right): dời xuống
             dưới hàng header cho khỏi đè nút tìm/đóng; thẻ là tổ tiên định vị. -->
        <div v-if="findOpen" class="absolute top-11 right-4 z-5">
          <FindBar
            v-model:query="findQuery"
            v-model:match-case="findMatchCase"
            :total="findMatches.length"
            :current="findMatches.length ? findCurrentIndex + 1 : 0"
            :focus-tick="findFocusTick"
            :placeholder="t('sessions.find.placeholder')"
            @next="nextMatch"
            @prev="prevMatch"
            @close="closeFind"
          />
        </div>

        <!-- Internal scroll region. Renders the SAME body tree as the transcript by
             reusing the parent's `grouped` computed (DRY — no grouping logic duplicated).
             Auto-scrolls to the bottom while streaming ONLY when the user is already at the
             bottom (3.c). -->
        <div
          ref="scrollEl"
          class="min-h-0 flex-1 overflow-auto px-5.5 pt-6.5 pb-15"
          @scroll="onScroll"
        >
          <!-- Cột lượt căn giữa, bề rộng đọc thoải mái như transcript. -->
          <div class="mx-auto flex w-full max-w-220 flex-col gap-2">
            <template v-for="(g, gi) in grouped" :key="g.key">
              <SessionTurnActivities
                v-if="g.type === 'activities'"
                :entries="g.entries"
                :preview="g.preview"
                :msg-eid="msgEid"
              />
              <SessionTextBlock
                v-else-if="g.type === 'text'"
                :text="g.text"
                :highlights="highlightsForBlock(g.blockIndex)"
                :streaming="streaming"
                :caret="streaming && gi === grouped.length - 1"
                :bubble="false"
              />
              <SessionStepItem v-else-if="g.type === 'todo'" :block="g.step" />
              <SessionBrowserCard v-else-if="g.type === 'browser'" :block="g.step" />
              <!-- Lỗi của lượt (chỉ đọc trong overlay — không có nút thử lại). -->
              <div
                v-else-if="g.type === 'error'"
                class="my-1 flex items-start gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2.5"
              >
                <Icon name="alert" class="mt-px size-4 flex-none text-destructive" />
                <div class="min-w-0 leading-(--lh-md) wrap-anywhere text-foreground">
                  {{ g.text }}
                </div>
              </div>
              <!-- Gates render read-only here (3.d) — answer / approve in the transcript. -->
              <!-- Model-initiated surfaces (#24/#26/#27/#34): the transcript renders
                   these as their own cards, so the read-only overlay must too — the
                   gate-card fallback draws nothing for them. Follow-ups are the one
                   exception: they are an affordance for the live composer, which is
                   not reachable from here, so they stay hidden on purpose. -->
              <SessionChapterMark
                v-else-if="g.type === 'gate' && g.gate.kind === 'chapter'"
                :block="g.gate"
              />
              <SessionSharedFiles
                v-else-if="g.type === 'gate' && g.gate.kind === 'files'"
                :block="g.gate"
              />
              <SessionTaskSuggestion
                v-else-if="g.type === 'gate' && g.gate.kind === 'suggestion'"
                :block="g.gate"
              />
              <SessionFollowupSuggestions
                v-else-if="g.type === 'gate' && g.gate.kind === 'followups'"
                :block="g.gate"
                :is-last="false"
              />
              <SessionFindings
                v-else-if="g.type === 'gate' && g.gate.kind === 'findings'"
                :block="g.gate"
              />
              <SessionGateCard v-else :block="g.gate" />
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Fullscreen overlay for a WHOLE assistant turn (UI-3): activities + intermediate blocks
// + gates + final response, rendered exactly like the transcript. Unlike the response-only
// PreviewModal (openFullscreen), this reuses the parent's reactive `grouped` so the overlay
// updates in realtime as the turn streams. Present-only: gates are read-only (3.d), activity
// collapse state stays as in the transcript (3.a — each SessionTurnActivities keeps its own).
import type { Grouped } from './SessionMessageItem.vue'
import type { BlockHighlight } from './SessionTextBlock.vue'

const props = defineProps<{
  title: string
  grouped: Grouped[]
  streaming: boolean
  msgEid?: string
  highlightsForBlock: (blockIndex: number) => BlockHighlight[]
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

// Utility của overlay (đè lên `.ovl` cũ — utilities thắng layer legacy): kéo tràn mép,
// không đệm, scrim tối.
const OVERLAY_CLASS = 'fixed inset-0 z-470 flex items-stretch bg-black/55 p-0'

// Auto-scroll to the bottom on new stream deltas, but only when the user is already
// pinned to the bottom — if they scrolled up to read, stay put (3.c).
const scrollEl = useTemplateRef<HTMLElement>('scrollEl')
const atBottom = ref(true)
const onScroll = () => {
  const el = scrollEl.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

// Cheap trigger that still tracks realtime: the block count AND the text length of the
// last block. While the model appends deltas into the same trailing block the array
// length stays constant — watching length alone would regress realtime autoscroll (③),
// so we include the last block's text length as the streaming signal.
watch(
  () => {
    const g = props.grouped
    const last = g[g.length - 1]
    return [g.length, last && 'text' in last ? last.text.length : 0]
  },
  () => {
    if (!props.streaming || !atBottom.value) return
    nextTick(() => {
      const el = scrollEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
)

// Find-in-turn — DOM-based over the scroll body, same engine as the PreviewModal find.
// Destructure so the template unwraps the refs.
const {
  findOpen,
  query: findQuery,
  matchCase: findMatchCase,
  matches: findMatches,
  currentIndex: findCurrentIndex,
  focusTick: findFocusTick,
  openFind,
  closeFind,
  nextMatch,
  prevMatch,
  runFind,
} = usePreviewFind(() => scrollEl.value)

function toggleFind() {
  if (findOpen.value) closeFind()
  else openFind()
}

// The turn may still be streaming: SessionMarkdownHtml rebuilds the trailing block's
// innerHTML on each delta, wiping find marks there (finalized blocks keep theirs). Re-wrap
// when the structure changes or streaming ends so the counter + highlights settle.
watch(
  () => [props.grouped.length, props.streaming] as const,
  () => {
    if (findOpen.value) nextTick(() => runFind())
  },
)

// ⌘/Ctrl+F opens find. Capture + preventDefault so the browser's own find never opens;
// SessionDetail's transcript find (also a window-capture listener) defers to this overlay
// via its `.ftovl` guard, so it won't open behind us.
function onFindKey(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
  if (e.key !== 'f' && e.key !== 'F') return
  e.preventDefault()
  e.stopPropagation()
  openFind()
}

// Esc closes the find bar first (if open), then the overlay on a second press.
const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (findOpen.value) {
    e.preventDefault()
    e.stopPropagation()
    closeFind()
    return
  }
  e.stopPropagation()
  emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onFindKey, true)
  window.addEventListener('keydown', onKey)
  nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onFindKey, true)
  window.removeEventListener('keydown', onKey)
})
</script>
