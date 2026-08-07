import { ref, shallowRef, watch } from 'vue'
import { clearMatches, findAllRanges, wrapMatches } from '~/utils/find-in-dom'

// Find-in-page state for the PreviewModal's rendered markdown (`.mdbody`). Owns the
// query + highlight marks; the modal wires the ⌘F/Esc keys and mounts PreviewFindBar.
// `getRoot` returns the current search surface (the `.mdbody` element) or null when no
// markdown-render is showing. Only ONE preview is open at a time, so a single instance
// per usePreviewModal is enough.
const DEBOUNCE_MS = 120
const CURRENT_CLASS = 'findmatch--current'

export function usePreviewFind(getRoot: () => HTMLElement | null) {
  const findOpen = ref(false)
  const query = ref('')
  const matchCase = ref(false)
  // Marks in document order; current is the one styled/scrolled-to.
  const matches = shallowRef<HTMLElement[]>([])
  const currentIndex = ref(0)
  // Bumped to ask PreviewFindBar to (re)focus + select its input — on open and on a
  // second ⌘F while already open.
  const focusTick = ref(0)

  let timer: ReturnType<typeof setTimeout> | null = null
  function cancelTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  // Mark the current match (colour swap) WITHOUT scrolling — a fresh find must not
  // yank the viewport (AC-2). Scrolling only happens on explicit next/prev.
  function applyCurrent() {
    const list = matches.value
    list.forEach((m, i) => m.classList.toggle(CURRENT_CLASS, i === currentIndex.value))
  }
  // Bring the current match into view — only when the user actively navigates.
  function scrollToCurrent() {
    matches.value[currentIndex.value]?.scrollIntoView({ block: 'center' })
  }

  function runFind() {
    const root = getRoot()
    if (root) clearMatches(root)
    matches.value = []
    currentIndex.value = 0
    if (!root || !query.value.trim()) return
    matches.value = wrapMatches(findAllRanges(root, query.value, matchCase.value))
    if (matches.value.length) applyCurrent()
  }

  function scheduleFind() {
    cancelTimer()
    timer = setTimeout(runFind, DEBOUNCE_MS)
  }

  // Open (or re-focus) the find bar. `prefill` seeds the query from the user's text
  // selection (⌘F while text is selected) and searches immediately; empty → keep the
  // existing query. Always bumps focusTick so the input focuses + selects all.
  function openFind(prefill?: string) {
    findOpen.value = true
    if (prefill && prefill.trim()) {
      query.value = prefill
      runFind()
    }
    focusTick.value++ // focus + select the input (also on a repeat ⌘F)
  }
  function closeFind() {
    cancelTimer()
    const root = getRoot()
    if (root) clearMatches(root)
    matches.value = []
    currentIndex.value = 0
    query.value = ''
    findOpen.value = false
  }

  function nextMatch() {
    const n = matches.value.length
    if (!n) return
    currentIndex.value = (currentIndex.value + 1) % n
    applyCurrent()
    scrollToCurrent()
  }
  function prevMatch() {
    const n = matches.value.length
    if (!n) return
    currentIndex.value = (currentIndex.value - 1 + n) % n
    applyCurrent()
    scrollToCurrent()
  }

  // Query typing → debounced re-find; match-case toggle → immediate re-find.
  watch(query, () => {
    if (findOpen.value) scheduleFind()
  })
  watch(matchCase, () => {
    if (findOpen.value) runFind()
  })

  return {
    findOpen,
    query,
    matchCase,
    matches,
    currentIndex,
    focusTick,
    openFind,
    closeFind,
    nextMatch,
    prevMatch,
  }
}
