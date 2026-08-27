import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue'
import type { Session, SessionMessage } from '~/composables/useSessionsData'
import type { TranscriptSurface } from '~/composables/useTranscriptSurface'
import { normalizeSearchText, searchableSegments } from '~/utils/transcript-text'
import { clearMatches, findAllRanges, wrapMatches } from '~/utils/find-in-dom'
import { pushActionToast } from '~/composables/useActionToasts'

// Find-in-session for SessionDetail (docs/features/session-transcript-navigation.md §4).
//
// TWO LAYERS THAT MUST NOT MIX:
//   DATA — searches `s.msgs`, the WHOLE session including turns the transcript never
//          mounted. It alone decides `n/N`, next/prev and wrap-around, and it may not
//          fail. This is why the browser's own ⌘F is useless here and why we do NOT
//          reuse usePreviewFind (DOM-first, single root, everything rendered).
//   DOM  — wraps `<mark class="findmatch">` inside the ONE message holding the current
//          match. Pure decoration: it may silently do nothing.
// Axis rule (ADR 0074): revealing + scrolling to the match is a COMMITMENT, the <mark>
// is BEST-EFFORT. When the DOM disagrees with the data we still jump to the message and
// simply skip the highlight — `N` never changes because of the DOM.
const DEBOUNCE_MS = 120
const CURRENT_CLASS = 'findmatch--current'

// One occurrence of the needle in the session. `segIndex`/`occurrence` keep matches
// inside the same message distinct (and ordered) without holding on to DOM nodes.
export type SessionFindMatch = { msgIndex: number; segIndex: number; occurrence: number }

export function useSessionFind(options: {
  session: () => Session
  // The surface ref SessionDetail owns — it provides it, so it cannot inject it.
  surface: TranscriptSurface
  // False for a <KeepAlive>-cached detail that is no longer on screen: it must not
  // answer ⌘F / Esc for the session the user is actually looking at.
  isActive: () => boolean
}) {
  const { session, surface, isActive } = options
  const store = useSessionsStore()
  const { t } = useI18n()
  const preview = usePreview()
  const { scrollToMessage } = useSessionScroll(surface)

  const findOpen = ref(false)
  const query = ref('')
  const matchCase = ref(false)
  const matches = shallowRef<SessionFindMatch[]>([])
  const currentIndex = ref(0)
  // Bumped to ask FindBar to (re)focus + select its input (open, and every repeat ⌘F).
  const focusTick = ref(0)
  // The transcript is lazy-loaded (ADR 0048). Until it is here, the honest answer is
  // "loading", never `0/0` — that would claim the session has no such text (AC-F2).
  const loading = ref(false)

  const total = computed(() => matches.value.length)
  const current = computed(() => (matches.value.length ? currentIndex.value + 1 : 0))
  const status = computed(() => (loading.value ? t('sessions.find.loading') : ''))

  // ── DOM layer (decoration only) ───────────────────────────────────────────────
  // The single message currently carrying highlights, so cleanup is scoped to it: a
  // `normalize()` over the whole transcript would also coalesce text nodes other
  // features hold Ranges into (quote highlights).
  let markedEl: HTMLElement | null = null

  function messageEl(msgIndex: number): HTMLElement | null {
    return surface.value?.root()?.querySelector<HTMLElement>(`[data-mi="${msgIndex}"]`) ?? null
  }

  // Sub-trees of a message row that may receive a mark — mirrors the data surface of
  // `searchableSegments`, so a highlight never lands on a byline, a tool detail or a
  // thinking block (which are not searched in the first place).
  function highlightRoots(el: HTMLElement, role: SessionMessage['role']): HTMLElement[] {
    if (role === 'assistant') return Array.from(el.querySelectorAll<HTMLElement>('.blk.txt'))
    if (role === 'user') {
      const bubble = el.querySelector<HTMLElement>('.mu')
      return bubble ? [bubble] : []
    }
    return [el]
  }

  function clearHighlight() {
    const el = markedEl
    markedEl = null
    // Unwrapped even when the element is no longer in the document: <KeepAlive> parks a
    // deactivated detail in a detached container, and marks left behind there would come
    // back on screen with it. Unwrapping a detached subtree is harmless.
    if (el) clearMatches(el)
  }

  // Decorate the message holding the current match. Every no-op path here is legal —
  // the jump already happened, only the paint is missing.
  function highlightCurrent(scrollIntoView = false) {
    const match = matches.value[currentIndex.value]
    if (!match) return
    const msg = session().msgs[match.msgIndex]
    if (!msg) return
    // A streaming reply re-parses its markdown every frame: Vue would patch over the
    // injected <mark> and could duplicate its text (AC-F15).
    if (msg.role === 'assistant' && msg.streaming) return
    const el = messageEl(match.msgIndex)
    if (!el) return
    const needle = normalizeSearchText(query.value)
    if (!needle) return
    const marks: HTMLElement[] = []
    for (const root of highlightRoots(el, msg.role)) {
      marks.push(...wrapMatches(findAllRanges(root, needle, matchCase.value)))
    }
    if (!marks.length) return
    markedEl = el
    // Nth match WITHIN this message ≈ nth mark in document order. Drift (rendered text
    // differs from the stored text) at worst styles the wrong occurrence — never a
    // wrong message, and never the counter.
    const nth = matches.value.filter((m) => m.msgIndex === match.msgIndex).indexOf(match)
    const cur = marks[nth] ?? marks[0]
    cur?.classList.add(CURRENT_CLASS)
    // A long answer scrolls inside its own bubble → centre the mark, not just the row.
    if (scrollIntoView) cur?.scrollIntoView({ block: 'center' })
  }

  // ── DATA layer (source of truth) ──────────────────────────────────────────────
  function runFind() {
    clearHighlight()
    const needle = normalizeSearchText(query.value)
    if (!needle || loading.value) {
      matches.value = []
      currentIndex.value = 0
      return
    }
    const needleCmp = matchCase.value ? needle : needle.toLowerCase()
    const found: SessionFindMatch[] = []
    session().msgs.forEach((m, msgIndex) => {
      for (const seg of searchableSegments(m)) {
        const hay = matchCase.value ? seg.text : seg.text.toLowerCase()
        let from = 0
        for (let occurrence = 0; ; occurrence++) {
          const idx = hay.indexOf(needleCmp, from)
          if (idx < 0) break
          found.push({ msgIndex, segIndex: seg.segIndex, occurrence })
          from = idx + needleCmp.length // needle is non-empty → always advances
        }
      }
    })
    matches.value = found
    currentIndex.value = 0
    // Typing must not move the viewport (AC-F4): decorate only if the first match's
    // message happens to be mounted already; never reveal, never scroll.
    highlightCurrent()
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  function cancelTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  function scheduleFind() {
    cancelTimer()
    timer = setTimeout(runFind, DEBOUNCE_MS)
  }

  // ── Navigation ────────────────────────────────────────────────────────────────
  // Guard against overlapping runs: each step awaits a reveal (which mounts turns).
  let navigating = false

  async function step(delta: 1 | -1) {
    const n = matches.value.length
    if (!n || navigating) return
    navigating = true
    try {
      const start = currentIndex.value
      clearHighlight()
      // At most ONE full cycle: if every match refuses to reveal (pathological — the
      // transcript was cut under us) we stop instead of spinning forever (AC-F22).
      for (let k = 1; k <= n; k++) {
        const idx = (((start + delta * k) % n) + n) % n
        const match = matches.value[idx]
        if (!match) continue
        const res = await scrollToMessage(match.msgIndex)
        // A new turn (or a truncation) recomputed the list while we awaited.
        if (matches.value[idx] !== match) return
        if (res === 'ok') {
          currentIndex.value = idx
          highlightCurrent(true)
          return
        }
      }
      currentIndex.value = start
      highlightCurrent()
      pushActionToast(t('sessions.find.notFoundJump'), 'error')
    } finally {
      navigating = false
    }
  }
  const nextMatch = () => void step(1)
  const prevMatch = () => void step(-1)

  // ── Open / close ──────────────────────────────────────────────────────────────
  async function openFind() {
    findOpen.value = true
    focusTick.value++ // focus + select, also on a repeat ⌘F while already open
    const s = session()
    if (s.loaded || loading.value) return
    loading.value = true
    try {
      await store.ensureLoaded(s.id)
    } finally {
      loading.value = false
    }
    if (findOpen.value) runFind()
  }

  function closeFind() {
    if (!findOpen.value) return
    cancelTimer()
    clearHighlight()
    matches.value = []
    currentIndex.value = 0
    query.value = ''
    findOpen.value = false
  }

  watch(query, () => {
    if (findOpen.value) scheduleFind()
  })
  // Match-case is a deliberate click → recompute immediately, still without scrolling.
  watch(matchCase, () => {
    if (findOpen.value) runFind()
  })

  // A new turn arrives / the transcript is truncated or reloaded. Default `pre` flush
  // runs this BEFORE Vue re-renders, so marks are removed while their nodes are still
  // the ones we wrapped — no orphans (AC-F21).
  watch([() => session().msgs, () => session().msgs.length], () => {
    if (!findOpen.value) return
    clearHighlight()
    if (!loading.value) runFind()
  })

  // ── Keyboard (owned here so the 1400-line SessionDetail stays a template) ──────
  // ⌘/Ctrl+F on CAPTURE so the browser's own find never gets the chance to open.
  function onFindKey(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
    if (e.key !== 'f' && e.key !== 'F') return
    if (!isActive()) return
    // Yield to surfaces that already have a real find: the preview modal (its own
    // handler runs on bubble) and Monaco / xterm inside the workspace panel. The
    // composer textarea is NOT one of them — browser-find is useless there (AC-F18/19).
    if (preview.current.value) return
    const el = document.activeElement
    if (el instanceof HTMLElement && el.closest('.monaco-editor, .xterm')) return
    e.preventDefault()
    e.stopPropagation()
    void openFind()
  }

  // Esc order (§6.4): a modal/popover on top closes first. Those handlers call
  // preventDefault when they act, so `defaultPrevented` gives us the priority for
  // free — as long as this listener is registered after theirs (SessionDetail calls
  // this composable below its own useEscToClose for that reason).
  function onEscKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    if (!isActive() || !findOpen.value || preview.current.value) return
    e.preventDefault()
    closeFind()
  }

  onMounted(() => {
    window.addEventListener('keydown', onFindKey, true)
    window.addEventListener('keydown', onEscKey)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onFindKey, true)
    window.removeEventListener('keydown', onEscKey)
    closeFind()
  })
  // Switching session swaps this cached detail out. React on the ACTIVE flag (pre-flush,
  // i.e. before the tree re-renders) rather than only on onDeactivated, which fires after
  // <KeepAlive> already parked the subtree (AC-F17).
  watch(
    () => isActive(),
    (active) => {
      if (!active) closeFind()
    },
  )
  onDeactivated(closeFind)

  return {
    findOpen,
    query,
    matchCase,
    total,
    current,
    status,
    focusTick,
    openFind,
    closeFind,
    nextMatch,
    prevMatch,
  }
}
