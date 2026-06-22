<!--
  Right-docked, drag-to-resize detail drawer for an issue / PR (ADR 0049).
  Header carries title (translatable), #number, state badge, author, labels,
  "Open on GitHub", and for PRs base ← head + Draft. Body + each comment render
  through TranslatableMarkdown (markdown via MarkdownRenderer, never raw v-html).
  A language tab bar (Original / Vietnamese / English) switches the whole thread
  view; the default tab is the original and switching to a language lazily
  translates every segment into it.

  Resize: a left-edge drag handle adjusts width between MIN/MAX, persisted to
  localStorage (same imperative mousedown-drag pattern as the session composer
  grip / git sidebar).
-->
<template>
  <div
    class="absolute top-0 right-0 bottom-0 flex flex-col z-20"
    :style="{
      width: `${width}px`,
      background: t.bgPanel,
      borderLeft: `1px solid ${t.border}`,
      boxShadow: `-8px 0 24px ${t.shadow}`,
    }"
  >
    <!-- Resize handle (left edge) -->
    <div
      class="absolute top-0 left-0 bottom-0 w-1 cursor-col-resize z-10"
      :style="{ background: resizing ? t.accent : 'transparent' }"
      @mousedown="onResizeStart"
    />

    <!-- Header -->
    <div class="flex-shrink-0 p-4" :style="{ borderBottom: `1px solid ${t.border}` }">
      <div class="flex items-start gap-2 mb-2">
        <div class="flex-1 min-w-0">
          <TranslatableMarkdown
            v-if="thread"
            :text="thread.title"
            :view-lang="viewLang"
            :translation="segmentTranslation('title')"
          />
        </div>
        <button
          class="p-1 rounded transition flex-shrink-0"
          :style="{ color: t.textDim }"
          :title="tr('common.close')"
          @click="emit('close')"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <X :size="15" />
        </button>
      </div>

      <div v-if="thread" class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-mono leading-none" :style="{ color: t.textFaint }">
          #{{ thread.number }}
        </span>
        <span
          class="text-[12px] font-medium leading-none px-1.5 py-0.5 rounded"
          :style="stateBadgeStyle(thread.state)"
        >
          {{ stateLabel(thread.state) }}
        </span>
        <span
          v-if="thread.isDraft"
          class="text-[12px] leading-none px-1.5 py-0.5 rounded"
          :style="{ background: t.bgActive, color: t.textDim }"
        >
          {{ tr('project.github.draft') }}
        </span>
        <span class="text-[12px] leading-none" :style="{ color: t.textDim }">
          @{{ thread.author.login }}
        </span>
        <span
          v-if="kind === 'pr' && thread.baseRefName && thread.headRefName"
          class="text-[12px] font-mono leading-none inline-flex items-center gap-1"
          :style="{ color: t.textDim }"
        >
          {{ thread.baseRefName }}
          <ArrowLeft :size="10" />
          {{ thread.headRefName }}
        </span>
      </div>

      <div v-if="thread && thread.labels.length" class="flex items-center gap-1.5 flex-wrap mt-2">
        <span
          v-for="lb in thread.labels"
          :key="lb.name"
          class="text-[12px] leading-none px-1.5 py-0.5 rounded"
          :style="labelStyle(lb.color)"
        >
          {{ lb.name }}
        </span>
      </div>

      <div v-if="thread" class="flex items-center gap-3 mt-3">
        <button
          class="text-[1em] inline-flex items-center gap-1.5 transition"
          :style="{ color: t.textDim }"
          @click="openOnGitHub"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <ExternalLink :size="12" />
          {{ tr('project.github.open_on_github') }}
        </button>
      </div>
    </div>

    <!-- Language tabs: Original / Vietnamese / English. Switching to a language
         tab lazily translates every segment of the thread into that language. -->
    <div
      v-if="thread"
      class="flex-shrink-0 flex items-center gap-1 px-4"
      :style="{ borderBottom: `1px solid ${t.border}` }"
    >
      <button
        v-for="tabOpt in langTabs"
        :key="tabOpt.value"
        class="px-3 py-2 text-[1em] transition"
        :style="{
          color: viewLang === tabOpt.value ? t.text : t.textDim,
          borderBottom: `2px solid ${viewLang === tabOpt.value ? t.accent : 'transparent'}`,
          marginBottom: '-1px',
        }"
        @click="emit('set-view-lang', tabOpt.value)"
      >
        {{ tabOpt.label }}
      </button>
    </div>

    <!-- Body + comments -->
    <div class="flex-1 overflow-y-auto min-h-0 p-4 space-y-5">
      <div
        v-if="loading"
        class="flex items-center justify-center gap-2 py-12 text-[1em]"
        :style="{ color: t.textDim }"
      >
        <Loader2 :size="14" class="animate-spin" />
        {{ tr('project.github.loading') }}
      </div>

      <template v-else-if="thread">
        <div
          class="rounded p-3"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <div
            class="text-[12px] uppercase tracking-wider font-medium mb-2"
            :style="{ color: t.textDim }"
          >
            {{ tr('project.github.description') }}
          </div>
          <TranslatableMarkdown
            :text="thread.body || tr('project.github.no_body')"
            :view-lang="viewLang"
            :translation="segmentTranslation('body')"
          />
        </div>

        <div v-if="thread.comments.length">
          <div
            class="text-[12px] uppercase tracking-wider font-medium mb-2"
            :style="{ color: t.textDim }"
          >
            {{ tr('project.github.comments', { n: thread.comments.length }) }}
          </div>
          <div class="space-y-3">
            <div
              v-for="(c, i) in thread.comments"
              :key="i"
              class="rounded p-3"
              :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
            >
              <div class="flex items-center gap-2 mb-1.5">
                <span class="text-[12px] leading-none font-medium" :style="{ color: t.text }">
                  @{{ c.author.login }}
                </span>
                <span class="text-[12px] leading-none" :style="{ color: t.textFaint }">
                  {{ formatTime(c.createdAt) }}
                </span>
              </div>
              <TranslatableMarkdown
                :text="c.body"
                :view-lang="viewLang"
                :translation="segmentTranslation(i)"
              />
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { ArrowLeft, ExternalLink, Loader2, X } from 'lucide-vue-next'
import type { GhThread, GhThreadKind, GhThreadState } from '~/types'
import type { GhSegmentId, GhSegmentState, ViewLang } from '~/composables/useProjectGh'
import { formatTime } from '~/utils/time'

const props = defineProps<{
  kind: GhThreadKind
  thread: GhThread | null
  loading: boolean
  viewLang: ViewLang
  segmentTranslation: (id: GhSegmentId) => GhSegmentState | null
}>()

const emit = defineEmits<{
  close: []
  'set-view-lang': [lang: ViewLang]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const sidecar = useSidecar()

const langTabs = computed<{ value: ViewLang; label: string }[]>(() => [
  { value: 'orig', label: tr('project.github.view_original') },
  { value: 'vi', label: tr('project.github.view_vi') },
  { value: 'en', label: tr('project.github.view_en') },
])

// ── Resize ──
const STORAGE_KEY = 'awog.projectGh.drawerWidth.v1'
const MIN_WIDTH = 360
const MAX_WIDTH = 900
const DEFAULT_WIDTH = 480

const clampWidth = (n: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n))

const loadWidth = (): number => {
  if (!import.meta.client) return DEFAULT_WIDTH
  const raw = Number(window.localStorage.getItem(STORAGE_KEY))
  return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : DEFAULT_WIDTH
}

const width = ref(loadWidth())
const resizing = ref(false)
let startX = 0
let startWidth = 0

const onResizeMove = (e: MouseEvent) => {
  // Dragging the left edge leftward (smaller clientX) widens the drawer.
  width.value = clampWidth(startWidth + (startX - e.clientX))
}

const onResizeEnd = () => {
  if (!resizing.value) return
  resizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  if (import.meta.client) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(width.value))
    } catch {
      // Storage full/disabled — non-fatal, width just won't persist.
    }
  }
}

const onResizeStart = (e: MouseEvent) => {
  e.preventDefault()
  startX = e.clientX
  startWidth = width.value
  resizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
})

const stateLabel = (state: GhThreadState): string => {
  if (state === 'MERGED') return tr('project.github.state_merged')
  if (state === 'CLOSED') return tr('project.github.state_closed')
  return tr('project.github.state_open')
}

const stateBadgeStyle = (state: GhThreadState): CSSProperties => {
  if (state === 'MERGED') return { background: t.value.infoBg, color: t.value.info }
  if (state === 'CLOSED') return { background: t.value.dangerBg, color: t.value.danger }
  return { background: t.value.bgActive, color: t.value.success }
}

const labelStyle = (hex: string): CSSProperties => {
  const valid = /^[0-9a-fA-F]{6}$/.test(hex)
  if (!valid) return { background: t.value.bgActive, color: t.value.textDim }
  return { background: `#${hex}22`, color: t.value.textMuted, border: `1px solid #${hex}55` }
}

const openOnGitHub = () => {
  if (props.thread?.url) sidecar.openExternal(props.thread.url).catch(() => {})
}
</script>
