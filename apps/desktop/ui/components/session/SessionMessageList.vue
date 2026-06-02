<template>
  <div class="relative flex-1 flex flex-col min-h-0">
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto px-4 md:px-6 py-4 min-h-0"
      :class="isEmpty ? 'flex flex-col items-center justify-center' : 'space-y-3'"
      @click="onContentClick"
      @scroll="updateScrollState"
    >
      <div
        v-if="isEmpty"
        class="flex flex-col items-center gap-5 max-w-md text-center select-none px-6"
      >
        <div
          class="ws-empty-orb flex items-center justify-center rounded-2xl"
          :style="{
            width: '72px',
            height: '72px',
            background: t.bgSubtle,
            border: `1px solid ${t.border}`,
            color: t.accent,
          }"
        >
          <MessagesSquare :size="30" :stroke-width="1.5" />
        </div>
        <div class="space-y-1.5">
          <p class="text-[1em] font-semibold" :style="{ color: t.text }">
            {{ tr('session.empty.title') }}
          </p>
          <p class="text-[1em] leading-relaxed" :style="{ color: t.textDim }">
            {{ tr('session.empty.subtitle') }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2 justify-center">
          <span
            v-for="hint in hints"
            :key="hint.token"
            class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[1em]"
            :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
          >
            <component :is="hint.icon" :size="12" :style="{ color: t.accent }" />
            <span class="font-mono">{{ hint.token }}</span>
          </span>
        </div>
      </div>

      <template v-else>
        <SessionMessageItem
          v-for="msg in messages"
          :key="msg.id"
          :message="msg"
          :now="now"
          @open-attachment="(att: SessionAttachment) => emit('openAttachment', att)"
        />

        <div
          v-for="agentId in pendingAgentIds"
          :key="`pending-${agentId}`"
          class="flex gap-1.5 items-center"
        >
          <Activity :size="11" class="animate-pulse" :style="{ color: t.textDim }" />
          <span class="text-[1em]" :style="{ color: t.textDim }">
            {{ agentName(agentId) }} đang phản hồi...
          </span>
        </div>
      </template>
    </div>

    <!-- Floating scroll controls — appear only when the list overflows and
         you're away from that edge. -->
    <div class="absolute right-3 bottom-3 z-10 flex flex-col gap-1.5">
      <button
        v-if="canScrollUp"
        type="button"
        class="w-8 h-8 inline-flex items-center justify-center rounded-full shadow-md transition"
        :style="{ background: t.bgElevated, color: t.textDim, border: `1px solid ${t.border}` }"
        :title="tr('session.scroll.top')"
        @click="scrollToEdge('top')"
      >
        <ArrowUp :size="15" />
      </button>
      <button
        v-if="canScrollDown"
        type="button"
        class="w-8 h-8 inline-flex items-center justify-center rounded-full shadow-md transition"
        :style="{ background: t.bgElevated, color: t.textDim, border: `1px solid ${t.border}` }"
        :title="tr('session.scroll.bottom')"
        @click="scrollToEdge('bottom')"
      >
        <ArrowDown :size="15" />
      </button>
    </div>
  </div>

  <Teleport to="body">
    <button
      v-if="quotePopup"
      type="button"
      class="fixed z-50 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[1em] shadow-lg transition"
      :style="{
        top: `${quotePopup.top}px`,
        left: `${quotePopup.left}px`,
        background: t.bgElevated,
        color: t.text,
        border: `1px solid ${t.border}`,
      }"
      @mousedown.prevent
      @click="openFollowUpDraft"
    >
      <Quote :size="11" :style="{ color: t.accent }" />
      Quote &amp; follow up
    </button>
  </Teleport>

  <SessionFollowUpNoteModal
    v-if="followUpDraft"
    :selected-text="followUpDraft.text"
    :top="followUpDraft.top"
    :left="followUpDraft.left"
    @save="saveFollowUp"
    @cancel="followUpDraft = null"
  />

  <MermaidZoomModal
    v-if="mermaidZoomSource"
    :source="mermaidZoomSource"
    @close="mermaidZoomSource = null"
  />
</template>

<script setup lang="ts">
import {
  Activity,
  ArrowDown,
  ArrowUp,
  AtSign,
  Bot,
  MessagesSquare,
  Quote,
  Slash,
} from 'lucide-vue-next'
import type { SessionAttachment, SessionMessage, SessionStep } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { decodeMermaidSource, renderMermaidIn } from '~/utils/mermaid'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'

const props = defineProps<{
  messages: SessionMessage[]
  pendingAgentIds: string[]
}>()

const emit = defineEmits<{
  openAttachment: [attachment: SessionAttachment]
}>()

const { t, themeName } = useTheme()
const { t: tr } = useI18n()

// Empty state: no messages and nothing streaming yet.
const isEmpty = computed(() => props.messages.length === 0 && props.pendingAgentIds.length === 0)

const hints = [
  { token: '@file', icon: AtSign },
  { token: '$agent', icon: Bot },
  { token: '/command', icon: Slash },
]
const workspace = useWorkspaceStore()
const store = useSessionsStore()
const panel = useWorkspacePanelStore()
const sidecar = useSidecar()

const scrollRef = ref<HTMLElement | null>(null)

// Floating scroll controls — visible only when the list overflows and the user
// is away from that edge.
const canScrollUp = ref(false)
const canScrollDown = ref(false)
const updateScrollState = () => {
  const el = scrollRef.value
  if (!el) {
    canScrollUp.value = false
    canScrollDown.value = false
    return
  }
  const scrollable = el.scrollHeight - el.clientHeight > 16
  canScrollUp.value = scrollable && el.scrollTop > 8
  canScrollDown.value = scrollable && el.scrollHeight - el.clientHeight - el.scrollTop > 8
}
const scrollToEdge = (edge: 'top' | 'bottom') => {
  const el = scrollRef.value
  if (!el) return
  el.scrollTo({ top: edge === 'top' ? 0 : el.scrollHeight, behavior: 'smooth' })
}
onMounted(() => nextTick(updateScrollState))

// Selection-driven "Quote & follow up" popup. We watch document selectionchange
// and only surface the button when the entire range sits inside a single agent
// message body (data-agent-message-id). Position is anchored to the end of the
// selection — viewport coords, since the popup is teleported to body.
const followUpController = inject(FOLLOW_UP_KEY, null)
const quotePopup = ref<{ messageId: string; text: string; top: number; left: number } | null>(null)

const closestAgentMessageId = (node: Node | null): string | null => {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  while (el) {
    const id = el.dataset?.agentMessageId
    if (id) return id
    el = el.parentElement
  }
  return null
}

const onSelectionChange = () => {
  if (!followUpController) {
    quotePopup.value = null
    return
  }
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    quotePopup.value = null
    return
  }
  const range = sel.getRangeAt(0)
  const startMsg = closestAgentMessageId(range.startContainer)
  const endMsg = closestAgentMessageId(range.endContainer)
  if (!startMsg || startMsg !== endMsg) {
    quotePopup.value = null
    return
  }
  const text = sel.toString().trim()
  if (!text) {
    quotePopup.value = null
    return
  }
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return
  quotePopup.value = {
    messageId: startMsg,
    text,
    // 6px gap below the selection; clamp left into viewport.
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(window.innerWidth - 160, rect.left)),
  }
}

// Clicking "Quote & follow up" opens a note modal anchored to the selection
// (position captured now, since the modal's textarea steals focus and clears
// the live selection). The follow-up is added only on Save — so the composer
// chip arrives already annotated instead of empty.
const followUpDraft = ref<{ messageId: string; text: string; top: number; left: number } | null>(
  null,
)

const openFollowUpDraft = () => {
  const popup = quotePopup.value
  if (!popup || !followUpController) return
  followUpDraft.value = {
    messageId: popup.messageId,
    text: popup.text,
    // Clamp so the ~220px-tall card stays on screen even near the bottom edge.
    top: Math.min(popup.top, window.innerHeight - 240),
    left: Math.max(8, Math.min(window.innerWidth - 348, popup.left)),
  }
  quotePopup.value = null
  window.getSelection()?.removeAllRanges()
}

const saveFollowUp = (note: string) => {
  const draft = followUpDraft.value
  if (!draft || !followUpController) {
    followUpDraft.value = null
    return
  }
  followUpController.add({ messageId: draft.messageId, selectedText: draft.text, note })
  followUpDraft.value = null
}

// StepItem reads SELECT_STEP_KEY via inject. We shadow the provide here so Task
// steps open the subagent drawer; every other step delegates to SessionChat's
// step-detail drawer (captured before we re-provide). Without the delegation,
// clicking a read/edit/run step would do nothing.
const parentSelectStep = inject(SELECT_STEP_KEY, null)
const selectedStepId = ref<string | null>(null)
provide(SELECTED_STEP_ID_KEY, selectedStepId)
provide(SELECT_STEP_KEY, (step: SessionStep) => {
  if (step.kind === 'tool' && step.tool === 'task') {
    // Find which message owns this step. Sessions are short — linear scan is fine.
    const owner = props.messages.find((msg: SessionMessage) =>
      msg.steps?.some((s: SessionStep) => s.id === step.id),
    )
    if (!owner) return
    const session = store.selectedSession
    if (!session) return
    selectedStepId.value = step.id
    store.openSubagentDrawer(session.id, owner.id, step.id)
    return
  }
  // read / edit / run / search / … → open the floating step-detail drawer.
  selectedStepId.value = step.id
  parentSelectStep?.(step)
})

const agentName = (id: string) => workspace.agentById(id)?.name ?? 'Agent'

// Single ticker shared across all streaming messages — children read `now`
// via prop so we don't create one interval per bubble.
const now = ref(Date.now())
const hasStreaming = computed(() =>
  props.messages.some((m: SessionMessage) => m.startedAt && !m.completedAt),
)
let nowTimer: ReturnType<typeof setInterval> | null = null

watch(
  hasStreaming,
  (active: boolean) => {
    if (active && !nowTimer) {
      nowTimer = setInterval(() => {
        now.value = Date.now()
      }, 100)
    } else if (!active && nowTimer) {
      clearInterval(nowTimer)
      nowTimer = null
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (nowTimer) {
    clearInterval(nowTimer)
    nowTimer = null
  }
})

// selectionchange fires globally — we filter inside the handler to only act
// on selections rooted in an agent message body.
onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onUnmounted(() => document.removeEventListener('selectionchange', onSelectionChange))

// Mermaid blocks live inside the v-html'd reply markup. MarkdownStreamBody
// re-renders that markup on its own throttle (streaming chunks, then a final
// flush when the turn ends), which can wipe an already-rendered SVG and race a
// one-shot render — the cause of diagrams intermittently staying as raw code.
// A MutationObserver makes it resilient: any DOM change (new message, chunk,
// v-html flush) re-scans for unrendered `.awog-mermaid` after a short debounce.
// renderMermaidIn skips blocks already rendered / already-failed on the same
// source, so re-scans are cheap and incomplete mid-stream source retries later.
let mermaidTimer: ReturnType<typeof setTimeout> | null = null
let mermaidObserver: MutationObserver | null = null
const scheduleMermaidRender = () => {
  if (mermaidTimer) clearTimeout(mermaidTimer)
  mermaidTimer = setTimeout(() => {
    mermaidTimer = null
    renderMermaidIn(scrollRef.value, {
      zoomLabel: tr('session.mermaid.zoom'),
      dark: themeName.value === 'dark',
    })
  }, 100)
}
onMounted(() => {
  scheduleMermaidRender()
  if (scrollRef.value) {
    mermaidObserver = new MutationObserver(scheduleMermaidRender)
    mermaidObserver.observe(scrollRef.value, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }
})
onUnmounted(() => {
  mermaidObserver?.disconnect()
  if (mermaidTimer) clearTimeout(mermaidTimer)
})

// Theme switch: re-render already-drawn diagrams so colors follow the new
// appearance (they're baked-in SVG, not CSS-driven). Clearing the markers makes
// the blocks eligible again; renderMermaidIn redraws from their data-source.
watch(themeName, () => {
  scrollRef.value?.querySelectorAll<HTMLElement>('.awog-mermaid[data-rendered]').forEach((el) => {
    delete el.dataset.rendered
    delete el.dataset.mermaidTried
  })
  scheduleMermaidRender()
})

// Delegated click handler for the v-html'd reply body (no Vue listeners inside).
// Handles two affordances: the mermaid zoom button, and markdown links — which
// must NOT hijack the webview. External URLs open in the system browser;
// workspace-relative paths (e.g. `apps/api/foo.py#L42`) open the Files panel and
// jump to the line.
const mermaidZoomSource = ref<string | null>(null)
const onContentClick = (ev: MouseEvent) => {
  const target = ev.target as HTMLElement | null
  if (!target) return

  const zoom = target.closest('.awog-mermaid-zoom')
  if (zoom) {
    const encoded = zoom.closest<HTMLElement>('.awog-mermaid')?.dataset.source
    if (encoded) {
      try {
        mermaidZoomSource.value = decodeMermaidSource(encoded)
      } catch {
        // Malformed source — ignore the click rather than open an empty modal.
      }
    }
    return
  }

  const anchor = target.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''
  // In-page anchors / empty hrefs: leave to the browser (harmless no-op).
  if (!href || href.startsWith('#')) return
  ev.preventDefault()
  // Any scheme (http:, https:, mailto:, vscode:…) → hand off to the OS so the
  // app webview is never navigated away.
  if (/^[a-z][\w+.-]*:/i.test(href)) {
    sidecar.openExternal(href).catch(() => {})
    return
  }
  // Otherwise a workspace-relative file reference. Strip the fragment, pull the
  // first line from `#L<n>` / `#L<a>-L<b>`, and open it in the Files panel.
  const sessionId = store.selectedSessionId
  if (!sessionId) return
  const hashIdx = href.indexOf('#')
  const path = (hashIdx >= 0 ? href.slice(0, hashIdx) : href).replace(/^\/+/, '')
  const lineMatch = hashIdx >= 0 ? href.slice(hashIdx).match(/L(\d+)/i) : null
  const line = lineMatch ? Number(lineMatch[1]) : null
  if (path) panel.requestOpenFile(sessionId, path, line)
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    updateScrollState()
  },
)
</script>

<style scoped>
/* Gentle float + breathing glow on the empty-state orb. */
.ws-empty-orb {
  animation: ws-empty-float 4s ease-in-out infinite;
}
@keyframes ws-empty-float {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.85;
  }
  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ws-empty-orb {
    animation: none;
  }
}
</style>

<!-- Markdown styles (.awog-md) + .awog-copy-btn moved to assets/css/main.css so
     they apply globally — subagent drawer, permission card, etc. all need them. -->
