<template>
  <div class="relative flex-1 flex flex-col min-h-0">
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto px-4 md:px-6 py-5 min-h-0"
      :class="isEmpty ? 'flex flex-col items-center justify-center' : 'space-y-4'"
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
          :session="session"
          :message="msg"
          :now="now"
          @open-attachment="(att: SessionAttachment) => emit('openAttachment', att)"
        />
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

  <CodeZoomModal
    v-if="codeZoom"
    :source="codeZoom.source"
    :language="codeZoom.language"
    @close="codeZoom = null"
  />
</template>

<script setup lang="ts">
import { ArrowDown, ArrowUp, AtSign, Bot, MessagesSquare, Quote, Slash } from 'lucide-vue-next'
import type { Session, SessionAttachment, SessionMessage, SessionStep } from '~/types'
import {
  ANSWER_QUESTION_KEY,
  RESOLVE_PLAN_KEY,
  SELECT_STEP_KEY,
  SELECTED_STEP_ID_KEY,
} from '~/utils/step-context'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { decodeMermaidSource, renderMermaidIn } from '~/utils/mermaid'
import { applyFollowUpAnchors, type FollowUpAnchor } from '~/utils/follow-up-anchor'
import { decodeSource } from '~/utils/markdown'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import { useSessionInfoPanelStore } from '~/stores/sessionInfoPanel'

const props = defineProps<{
  session: Session
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
const store = useSessionsStore()
const panel = useWorkspacePanelStore()
const infoPanel = useSessionInfoPanelStore()
const sidecar = useSidecar()

const scrollRef = useTemplateRef<HTMLElement>('scrollRef')

// Floating scroll controls — visible only when the list overflows and the user
// is away from that edge.
const canScrollUp = ref(false)
const canScrollDown = ref(false)
// "Stick to bottom": while the user sits at (or near) the bottom we keep the view
// pinned to the latest line so a streaming reply — and its final flush — stay in
// view without manual scrolling. Scrolling up releases the pin so reading earlier
// text isn't yanked back down.
const STICK_THRESHOLD_PX = 80
const stickToBottom = ref(true)
const updateScrollState = () => {
  const el = scrollRef.value
  if (!el) {
    canScrollUp.value = false
    canScrollDown.value = false
    return
  }
  const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
  const scrollable = el.scrollHeight - el.clientHeight > 16
  canScrollUp.value = scrollable && el.scrollTop > 8
  canScrollDown.value = scrollable && distanceFromBottom > 8
  stickToBottom.value = distanceFromBottom <= STICK_THRESHOLD_PX
}
const scrollToBottom = () => {
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}
// Re-pin to the latest line, but only while still stuck — called on every content
// mutation (streaming chunks, step clusters, the final reply flush) so the view
// follows the answer to the end.
const maybeStickToBottom = () => {
  if (stickToBottom.value) scrollToBottom()
}
const scrollToEdge = (edge: 'top' | 'bottom') => {
  const el = scrollRef.value
  if (!el) return
  el.scrollTo({ top: edge === 'top' ? 0 : el.scrollHeight, behavior: 'smooth' })
}
onMounted(() =>
  nextTick(() => {
    // Open a session at its latest message rather than the top.
    scrollToBottom()
    updateScrollState()
  }),
)

// Cmd+K search palette deep-link: scroll to + briefly outline the requested
// message once it lives in this list, then clear the request. nextTick because
// the target session may have just been selected (this list re-rendering for
// it). immediate so a request set before this list mounts is still honoured.
watch(
  () => store.pendingScrollMessageId,
  (id) => {
    if (!id || !props.messages.some((m) => m.id === id)) return
    void nextTick(() => {
      const el = scrollRef.value?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(id)}"]`,
      )
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.style.transition = 'outline-color 0.4s ease'
        el.style.outline = `2px solid ${t.value.accent}`
        el.style.outlineOffset = '3px'
        el.style.borderRadius = '8px'
        setTimeout(() => {
          el.style.outline = '2px solid transparent'
          setTimeout(() => {
            el.style.removeProperty('outline')
            el.style.removeProperty('outline-offset')
            el.style.removeProperty('border-radius')
            el.style.removeProperty('transition')
          }, 400)
        }, 1400)
      }
      store.pendingScrollMessageId = null
    })
  },
  { immediate: true },
)

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

// Inline plan-card Approve/Reject → sessions store. Closes over the active
// session id so StepItem only needs to pass (stepId, decision).
provide(RESOLVE_PLAN_KEY, (stepId, decision) => {
  const sid = store.selectedSessionId
  if (sid) store.resolvePlan(sid, stepId, decision)
})

// Inline AskUserQuestion card → sessions store. Closes over the active session
// id so SessionQuestionCard only needs to pass (stepId, answers).
provide(ANSWER_QUESTION_KEY, (stepId, answers) => {
  const sid = store.selectedSessionId
  if (sid) store.answerQuestion(sid, stepId, answers)
})

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
// Inline SVG icons for the injected code-block actions. lucide is a Vue
// component lib (unusable inside the v-html'd markup), so we inline the glyph
// paths and let CSS drive the stroke via currentColor — same approach as the
// mermaid zoom button in utils/mermaid.ts.
const ICON_COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const ICON_CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
const ICON_EXPAND =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>'

// Inject copy + expand buttons into every freshly-rendered `.awog-code-block`
// (markdown.ts emits the wrapper; buttons live here so the click handlers + i18n
// stay in one place). Idempotent via the data-decorated guard, so re-running on
// each v-html flush during streaming is cheap — same resilience model as the
// mermaid re-scan below.
const decorateCodeBlocks = () => {
  const root = scrollRef.value
  if (!root) return
  root.querySelectorAll<HTMLElement>('.awog-code-block:not([data-decorated])').forEach((block) => {
    block.dataset.decorated = 'true'
    const bar = document.createElement('div')
    bar.className = 'awog-code-actions'

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className = 'awog-code-copy'
    copyBtn.title = tr('session.code.copy')
    copyBtn.setAttribute('aria-label', tr('session.code.copy'))
    copyBtn.innerHTML = ICON_COPY

    const expandBtn = document.createElement('button')
    expandBtn.type = 'button'
    expandBtn.className = 'awog-code-expand'
    expandBtn.title = tr('session.code.expand')
    expandBtn.setAttribute('aria-label', tr('session.code.expand'))
    expandBtn.innerHTML = ICON_EXPAND

    bar.appendChild(copyBtn)
    bar.appendChild(expandBtn)
    block.appendChild(bar)
  })
}

// Numbered anchor badges (①②③) for "Quote & follow up". Desired set for a given
// agent message = every follow-up that quotes it, numbered within its batch:
// already-sent ones live on later user messages (message.followUps), in-flight
// ones live in the composer controller (pending). Same fu.id across both keeps
// the badge stable through the send transition.
const desiredAnchorsFor = (messageId: string): FollowUpAnchor[] => {
  const out: FollowUpAnchor[] = []
  props.messages.forEach((m: SessionMessage) => {
    if (m.role !== 'user' || !m.followUps?.length) return
    m.followUps.forEach((fu, i) => {
      if (fu.messageId === messageId)
        out.push({ id: fu.id, selectedText: fu.selectedText, label: String(i + 1) })
    })
  })
  const pending = followUpController?.pending.value ?? []
  pending.forEach((fu, i) => {
    if (fu.messageId === messageId)
      out.push({ id: fu.id, selectedText: fu.selectedText, label: String(i + 1) })
  })
  return out
}

// Reconcile anchor badges across every rendered agent-message body. Steps can
// split one message into multiple `[data-agent-message-id]` blocks, so we group
// them and let applyFollowUpAnchors search across the lot for each quote.
const decorateFollowUpAnchors = () => {
  const root = scrollRef.value
  if (!root) return
  const blocksById = new Map<string, HTMLElement[]>()
  root.querySelectorAll<HTMLElement>('[data-agent-message-id]').forEach((el) => {
    const id = el.dataset.agentMessageId
    if (!id) return
    const list = blocksById.get(id)
    if (list) list.push(el)
    else blocksById.set(id, [el])
  })
  blocksById.forEach((blocks, id) => applyFollowUpAnchors(blocks, desiredAnchorsFor(id)))
}

let mermaidTimer: ReturnType<typeof setTimeout> | null = null
let mermaidObserver: MutationObserver | null = null
// Enhance the rendered reply markup: decorate code blocks + follow-up anchors
// (sync) + render any mermaid diagrams (async). Debounced so a burst of streaming
// mutations coalesces.
const scheduleContentEnhance = () => {
  if (mermaidTimer) clearTimeout(mermaidTimer)
  mermaidTimer = setTimeout(() => {
    mermaidTimer = null
    decorateCodeBlocks()
    decorateFollowUpAnchors()
    renderMermaidIn(scrollRef.value, {
      zoomLabel: tr('session.mermaid.zoom'),
      dark: themeName.value === 'dark',
    })
  }, 100)
}
onMounted(() => {
  scheduleContentEnhance()
  if (scrollRef.value) {
    // Every reply-body mutation (streaming chunk, step cluster, v-html flush)
    // pins us to the bottom when stuck, then schedules the (debounced) mermaid +
    // code-block enhancement. Stick first so the view tracks the reply with no lag.
    mermaidObserver = new MutationObserver(() => {
      maybeStickToBottom()
      scheduleContentEnhance()
    })
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
  scheduleContentEnhance()
})

// Composing a follow-up (add / remove / reorder) changes which anchor badges the
// source message should carry — re-decorate on every change to the pending set.
watch(
  () => followUpController?.pending.value,
  () => scheduleContentEnhance(),
  { deep: true },
)

// Delegated click handler for the v-html'd reply body (no Vue listeners inside).
// Handles four affordances: the mermaid zoom button, code-block copy + expand
// buttons, and markdown links — which must NOT hijack the webview. External URLs
// open in the system browser; workspace-relative paths (e.g. `apps/api/foo.py#L42`)
// open the Files panel and jump to the line.
const mermaidZoomSource = ref<string | null>(null)
const codeZoom = ref<{ source: string; language: string } | null>(null)
// Holds the timer that reverts a copy button from its "copied" state.
let copyResetTimer: ReturnType<typeof setTimeout> | null = null
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

  // Code-block copy: write the raw (decoded) source to the clipboard and flash a
  // check icon. The button is plain DOM (injected by decorateCodeBlocks), so we
  // swap its markup directly rather than through Vue state.
  const copyBtn = target.closest<HTMLElement>('.awog-code-copy')
  if (copyBtn) {
    const encoded = copyBtn.closest<HTMLElement>('.awog-code-block')?.dataset.source
    if (encoded) {
      navigator.clipboard
        .writeText(decodeSource(encoded))
        .then(() => {
          copyBtn.classList.add('is-copied')
          copyBtn.innerHTML = ICON_CHECK
          copyBtn.title = tr('session.code.copied')
          if (copyResetTimer) clearTimeout(copyResetTimer)
          copyResetTimer = setTimeout(() => {
            copyBtn.classList.remove('is-copied')
            copyBtn.innerHTML = ICON_COPY
            copyBtn.title = tr('session.code.copy')
          }, 1500)
        })
        .catch(() => {})
    }
    return
  }

  // Code-block expand: open the full-screen viewer with the raw source + language.
  const expandBtn = target.closest('.awog-code-expand')
  if (expandBtn) {
    const block = expandBtn.closest<HTMLElement>('.awog-code-block')
    const encoded = block?.dataset.source
    if (encoded) {
      try {
        codeZoom.value = { source: decodeSource(encoded), language: block?.dataset.lang ?? '' }
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
  // Otherwise a workspace-relative file reference. Open it in the Files panel and
  // highlight the referenced line range. The range may live in the href fragment
  // (`#L138`, `#L138-L144`, `#L138-144`, GitHub `#L138C1-L144C5`) or — when the
  // href only carries the start line — in the visible label (e.g. `…:138-144`).
  const sessionId = store.selectedSessionId
  if (!sessionId) return
  const hashIdx = href.indexOf('#')
  const path = (hashIdx >= 0 ? href.slice(0, hashIdx) : href).replace(/^\/+/, '')
  const frag = hashIdx >= 0 ? href.slice(hashIdx) : ''
  const fragMatch = frag.match(/L(\d+)(?:C\d+)?(?:[-–]L?(\d+)(?:C\d+)?)?/i)
  let line = fragMatch ? Number(fragMatch[1]) : null
  let endLine = fragMatch && fragMatch[2] ? Number(fragMatch[2]) : null
  if (endLine == null) {
    const labelMatch = (anchor.textContent ?? '').match(/:(\d+)\s*[-–]\s*(\d+)/)
    if (labelMatch) {
      line = Number(labelMatch[1])
      endLine = Number(labelMatch[2])
    }
  }
  if (path) {
    // Opening the Files drawer — close the Info panel so they don't stack on
    // the right edge.
    infoPanel.close(sessionId)
    panel.requestOpenFile(sessionId, path, line, endLine)
  }
}

onUnmounted(() => {
  if (copyResetTimer) clearTimeout(copyResetTimer)
})

watch(
  () => props.messages.length,
  async () => {
    // A new message (user send / fresh agent reply) → follow it: re-pin and jump
    // to the bottom regardless of where the user had scrolled.
    stickToBottom.value = true
    await nextTick()
    scrollToBottom()
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
